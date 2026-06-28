#!/usr/bin/env bash
# =============================================================================
# GuanWo (观我) — Let's Encrypt SSL Certificate Provisioning Script
# =============================================================================
# Usage:   ./init-letsencrypt.sh [DOMAIN] [EMAIL] [staging|production]
# Example: ./init-letsencrypt.sh your-domain.com admin@your-domain.com production
#
# Uses Certbot with webroot authentication (port 80 challenge via nginx).
# =============================================================================

set -euo pipefail

# =============================================================================
# CONFIGURATION
# =============================================================================
DOMAIN="${1:-your-domain.com}"
LETSENCRYPT_EMAIL="${2:-admin@your-domain.com}"
ENVIRONMENT="${3:-production}"

DOMAINS=("$DOMAIN" "www.$DOMAIN")
PRIMARY_DOMAIN="$DOMAIN"
SSL_DIR="/etc/nginx/ssl"
WEBROOT_PATH="/var/www/certbot"
CERTBOT_IMAGE="certbot/certbot:v2.11.0"
COMPOSE_PROJECT="guanwo"
NGINX_CONTAINER="${COMPOSE_PROJECT}-nginx"

# =============================================================================
# STYLING
# =============================================================================
readonly COLOR_GREEN='\033[0;32m'
readonly COLOR_YELLOW='\033[1;33m'
readonly COLOR_RED='\033[0;31m'
readonly COLOR_BLUE='\033[0;34m'
readonly COLOR_NC='\033[0m'

log_info()  { echo -e "${COLOR_BLUE}[INFO]${COLOR_NC}  $*"; }
log_ok()    { echo -e "${COLOR_GREEN}[OK]${COLOR_NC}    $*"; }
log_warn()  { echo -e "${COLOR_YELLOW}[WARN]${COLOR_NC}  $*"; }
log_error() { echo -e "${COLOR_RED}[ERROR]${COLOR_NC} $*" >&2; }

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================
command_exists() {
    command -v "$1" &> /dev/null
}

check_docker() {
    if ! command_exists docker; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi

    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running or you lack permissions."
        exit 1
    fi

    log_ok "Docker is installed and running."
}

check_compose() {
    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not installed."
        exit 1
    fi
    log_ok "Docker Compose found."
}

# =============================================================================
# PRE-FLIGHT CHECKS
# =============================================================================
echo ""
echo "==================================================================="
echo "  GuanWo (观我) — SSL Certificate Provisioning"
echo "  Environment: $ENVIRONMENT"
echo "  Domains: ${DOMAINS[*]}"
echo "==================================================================="
echo ""

check_docker
check_compose

if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
    log_error "Invalid environment: '$ENVIRONMENT'"
    log_error "Usage: $0 [DOMAIN] [EMAIL] [staging|production]"
    exit 1
fi

if [[ "$ENVIRONMENT" == "staging" ]]; then
    log_warn "Using Let's Encrypt STAGING server."
    log_warn "Certificates will NOT be trusted by browsers — for testing only."
    log_warn ""
fi

# =============================================================================
# STEP 1: Check for Existing Certificates
# =============================================================================
echo ""
log_info "Step 1/6: Checking for existing certificates..."

CERTBOT_CERT_DIR="${DEPLOY_DIR:-$(pwd)}/docker/nginx/ssl"
FULLCHAIN_PATH="${CERTBOT_CERT_DIR}/fullchain.pem"
PRIVKEY_PATH="${CERTBOT_CERT_DIR}/privkey.pem"

mkdir -p "$CERTBOT_CERT_DIR"

if [[ -f "$FULLCHAIN_PATH" && -f "$PRIVKEY_PATH" ]]; then
    log_warn "Certificates already exist at ${CERTBOT_CERT_DIR}/"
    log_warn "If you want to re-issue, delete them first:"
    log_warn "  rm -rf ${CERTBOT_CERT_DIR}/*.pem"
    log_warn "Skipping certificate request. Will verify renewal setup only."
    SKIP_CERT_REQUEST=true
else
    SKIP_CERT_REQUEST=false
    log_info "No existing certificates found. Will request new ones."
fi

# =============================================================================
# STEP 2: Create Directory Structure
# =============================================================================
echo ""
log_info "Step 2/6: Creating directory structure..."

CERTBOT_WEBROOT_DIR="${DEPLOY_DIR:-$(pwd)}/docker/certbot/www"
mkdir -p "$CERTBOT_WEBROOT_DIR"
log_ok "Webroot directory: ${CERTBOT_WEBROOT_DIR}/"

if [[ ! -f "$FULLCHAIN_PATH" ]]; then
    log_info "Creating temporary self-signed certificate for nginx startup..."

    openssl req -x509 -nodes -newkey rsa:2048 \
        -keyout "${CERTBOT_CERT_DIR}/privkey.pem" \
        -out "${CERTBOT_CERT_DIR}/fullchain.pem" \
        -subj "/CN=${PRIMARY_DOMAIN}" \
        -days 1 2>/dev/null

    log_ok "Temporary self-signed certificate created."
    log_warn "This will be REPLACED by the real Let's Encrypt certificate."
fi

# =============================================================================
# STEP 3: Generate DH Parameters
# =============================================================================
echo ""
log_info "Step 3/6: Checking Diffie-Hellman parameters..."

DHPARAM_PATH="${CERTBOT_CERT_DIR}/dhparam.pem"

if [[ -f "$DHPARAM_PATH" ]]; then
    DHPARAM_SIZE=$(wc -c < "$DHPARAM_PATH")
    log_ok "DH parameters already exist (${DHPARAM_SIZE} bytes)."
else
    log_info "Generating 2048-bit DH parameters (this may take a few minutes)..."

    openssl dhparam -out "$DHPARAM_PATH" 2048

    log_ok "DH parameters generated at ${DHPARAM_PATH}"
fi

if [[ ! -f "${CERTBOT_CERT_DIR}/chain.pem" ]]; then
    log_info "Creating chain.pem from fullchain..."
    cp "$FULLCHAIN_PATH" "${CERTBOT_CERT_DIR}/chain.pem"
    log_ok "chain.pem created."
fi

# =============================================================================
# STEP 4: Ensure Nginx is Running
# =============================================================================
echo ""
log_info "Step 4/6: Ensuring Nginx is running..."

COMPOSE_FILE="${DEPLOY_DIR:-$(pwd)}/docker/docker-compose.yml"

if docker ps --format '{{.Names}}' | grep -q "${NGINX_CONTAINER}"; then
    log_ok "Nginx container is running."
else
    log_warn "Nginx container not running. Starting it now..."
    docker compose -f "$COMPOSE_FILE" up -d nginx || {
        log_error "Failed to start Nginx container."
        exit 1
    }

    sleep 3

    if docker ps --format '{{.Names}}' | grep -q "${NGINX_CONTAINER}"; then
        log_ok "Nginx container started successfully."
    else
        log_error "Nginx container failed to start. Check logs:"
        log_error "  docker compose -f ${COMPOSE_FILE} logs nginx"
        exit 1
    fi
fi

# =============================================================================
# STEP 5: Request Certificate from Let's Encrypt
# =============================================================================
if [[ "$SKIP_CERT_REQUEST" == true ]]; then
    echo ""
    log_info "Step 5/6: SKIPPED (certificates already exist)"
else
    echo ""
    log_info "Step 5/6: Requesting certificate from Let's Encrypt..."
    log_info "This requires port 80 to be accessible from the internet."

    CERTBOT_ARGS=(
        certonly
        --webroot
        --webroot-path "$WEBROOT_PATH"
        --email "$LETSENCRYPT_EMAIL"
        --agree-tos
        --no-eff-email
        --keep-until-expiring
        --non-interactive
    )

    if [[ "$ENVIRONMENT" == "staging" ]]; then
        CERTBOT_ARGS+=(--staging)
    fi

    for domain in "${DOMAINS[@]}"; do
        CERTBOT_ARGS+=(--domain "$domain")
    done

    log_info "Running Certbot with args: ${CERTBOT_ARGS[*]}"

    docker run --rm \
        --name certbot-run \
        -v "${CERTBOT_WEBROOT_DIR}:${WEBROOT_PATH}" \
        -v "${CERTBOT_CERT_DIR}:${SSL_DIR}" \
        -v "guanwo_certbot_data:/etc/letsencrypt" \
        "$CERTBOT_IMAGE" \
        "${CERTBOT_ARGS[@]}"

    CERTBOT_EXIT_CODE=$?

    if [[ $CERTBOT_EXIT_CODE -ne 0 ]]; then
        echo ""
        log_error "Certbot failed with exit code $CERTBOT_EXIT_CODE"
        log_error "Common causes:"
        log_error "  1. Port 80 not accessible (firewall/security group)"
        log_error "  2. DNS A record not pointing to this server"
        log_error "  3. Rate limit exceeded (use 'staging' mode for testing)"
        exit 1
    fi

    log_ok "Certificate requested successfully!"

    log_info "Copying certificates to nginx SSL directory..."

    CERTBOT_LIVE_DIR="/etc/letsencrypt/live/${PRIMARY_DOMAIN}"

    docker run --rm \
        -v "guanwo_certbot_data:/etc/letsencrypt" \
        -v "${CERTBOT_CERT_DIR}:${SSL_DIR}" \
        --entrypoint /bin/sh \
        "$CERTBOT_IMAGE" \
        -c "
            if [[ -f '${CERTBOT_LIVE_DIR}/fullchain.pem' ]]; then
                cp '${CERTBOT_LIVE_DIR}/fullchain.pem' '${SSL_DIR}/fullchain.pem'
                cp '${CERTBOT_LIVE_DIR}/privkey.pem' '${SSL_DIR}/privkey.pem'
                cp '${CERTBOT_LIVE_DIR}/chain.pem' '${SSL_DIR}/chain.pem'
                echo 'CERTS_COPIED'
            else
                echo 'CERTS_NOT_FOUND'
                exit 1
            fi
        "

    COPY_RESULT=$?

    if [[ $COPY_RESULT -eq 0 ]]; then
        log_ok "Certificates copied to ${CERTBOT_CERT_DIR}/"
    else
        log_error "Failed to copy certificates from Certbot."
        exit 1
    fi

    CERT_EXPIRY=$(openssl x509 -enddate -noout -in "$FULLCHAIN_PATH" | cut -d= -f2)
    log_info "Certificate expires: $CERT_EXPIRY"
fi

# =============================================================================
# STEP 6: Reload Nginx
# =============================================================================
echo ""
log_info "Step 6/6: Reloading Nginx..."

docker exec "$NGINX_CONTAINER" nginx -s reload 2>/dev/null || {
    log_warn "Could not reload Nginx automatically."
    log_warn "Run manually: docker exec ${NGINX_CONTAINER} nginx -s reload"
}

echo ""
echo "==================================================================="
log_ok "SSL Certificate Setup Complete!"
echo ""
echo "  Domains:       ${DOMAINS[*]}"
echo "  SSL Directory: ${CERTBOT_CERT_DIR}/"
echo "  Environment:   ${ENVIRONMENT}"
echo ""
echo "  Auto-renewal:  Configured via docker/certbot-renew.sh"
echo ""
echo "==================================================================="
