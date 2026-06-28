#!/usr/bin/env bash
# =============================================================================
# GuanWo (观我) — SSL Certificate Auto-Renewal Script
# =============================================================================
# Usage:     ./certbot-renew.sh
# Purpose:   Renew Let's Encrypt certificates and reload Nginx
# Schedule:  Runs via cron twice daily (Let's Encrypt recommendation)
#            0 0,12 * * * /opt/guanwo/docker/scripts/certbot-renew.sh
# Idempotent: Yes — certbot renew only acts when needed
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
#  CONFIGURATION
# ---------------------------------------------------------------------------
DEPLOY_DIR="${DEPLOY_DIR:-/opt/guanwo}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/docker-compose.yml}"
LOG_FILE="${LOG_FILE:-/var/log/guanwo-certbot.log}"
NOTIFY_WEBHOOK="${NOTIFY_WEBHOOK:-}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-admin@your-domain.com}"
DOMAIN="${DOMAIN:-your-domain.com}"

# ---------------------------------------------------------------------------
#  COLOR CODES
# ---------------------------------------------------------------------------
readonly C_RESET='\033[0m'
readonly C_GREEN='\033[0;32m'
readonly C_RED='\033[0;31m'
readonly C_YELLOW='\033[1;33m'
readonly C_BLUE='\033[0;34m'

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    echo -e "$msg"
    mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
    echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}
success() { log "${C_GREEN}✓ $*${C_RESET}"; }
error()   { log "${C_RED}✗ ERROR: $*${C_RESET}"; }
warn()    { log "${C_YELLOW}⚠ WARN: $*${C_RESET}"; }
info()    { log "${C_BLUE}ℹ $*${C_RESET}"; }
step()    { log "${C_BLUE}→ $*${C_RESET}"; }

# ---------------------------------------------------------------------------
#  NOTIFICATIONS
# ---------------------------------------------------------------------------
notify() {
    local status="$1"
    local message="$2"

    [[ -z "$NOTIFY_WEBHOOK" ]] && return 0

    local payload="{\"text\": \"GuanWo Certbot [$status]: $message\"}"
    curl -s -X POST -H 'Content-type: application/json' \
        --data "$payload" "$NOTIFY_WEBHOOK" > /dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
#  MAIN RENEWAL
# ---------------------------------------------------------------------------
main() {
    step "═══════════════════════════════════════════════════"
    step "  GuanWo SSL Certificate Renewal — $(date)"
    step "═══════════════════════════════════════════════════"

    cd "$DEPLOY_DIR" || exit 1

    local cert_dir="${DEPLOY_DIR}/docker/nginx/ssl"
    local cert_checksum_before cert_checksum_after

    cert_checksum_before=$(find "$cert_dir" -name "*.pem" -type f -exec sha256sum {} + 2>/dev/null | sort | sha256sum | awk '{print $1}')

    info "Running certbot renew..."
    docker run --rm \
        -v "guanwo_certbot_data:/etc/letsencrypt" \
        -v "${DEPLOY_DIR}/docker/certbot/www:/var/www/certbot" \
        -v "${cert_dir}:/etc/nginx/ssl" \
        certbot/certbot:latest \
        renew --webroot --webroot-path /var/www/certbot --quiet --no-random-sleep-on-renew 2>&1 || true

    local live_dir="${DEPLOY_DIR}/docker/certbot/conf/live/${DOMAIN}"
    if [[ -d "${cert_dir}" ]] && [[ -d "${live_dir}" ]]; then
        info "Checking for renewed certificates for ${DOMAIN}..."

        if [[ -f "${live_dir}/fullchain.pem" ]] && [[ -f "${live_dir}/privkey.pem" ]]; then
            cp -L "${live_dir}/fullchain.pem" "${cert_dir}/fullchain.pem"
            cp -L "${live_dir}/privkey.pem" "${cert_dir}/privkey.pem"
            if [[ -f "${live_dir}/chain.pem" ]]; then
                cp -L "${live_dir}/chain.pem" "${cert_dir}/chain.pem"
            fi
            info "Certificates copied to ${cert_dir}/"
        else
            warn "Expected certificate files not found in ${live_dir}"
        fi
    fi

    cert_checksum_after=$(find "$cert_dir" -name "*.pem" -o -name "*.crt" -o -name "*.key" | sort | xargs sha256sum 2>/dev/null | sha256sum | awk '{print $1}')

    if [[ "$cert_checksum_before" != "$cert_checksum_after" ]]; then
        step "Certificates were updated — reloading Nginx..."

        if docker compose -f "$COMPOSE_FILE" ps nginx 2>/dev/null | grep -q "running\|Up"; then
            docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -s reload
            success "Nginx reloaded with new certificates"
            notify "success" "SSL certificates renewed and Nginx reloaded for ${DOMAIN}."
        else
            warn "Nginx container not running. Starting services..."
            docker compose -f "$COMPOSE_FILE" up -d nginx
        fi
    else
        info "No certificate changes detected. Nginx reload not needed."
    fi

    local expiry_date expiry_days
    if [[ -f "${cert_dir}/fullchain.pem" ]]; then
        expiry_date=$(openssl x509 -enddate -noout -in "${cert_dir}/fullchain.pem" 2>/dev/null | cut -d= -f2)
        expiry_days=$(openssl x509 -checkend $((30 * 86400)) -noout -in "${cert_dir}/fullchain.pem" 2>/dev/null && echo "30+" || echo "<30")
        info "Certificate for ${DOMAIN} expires: ${expiry_date} (${expiry_days} days)"
    fi

    success "Certificate renewal check completed"
}

# ---------------------------------------------------------------------------
#  CLI
# ---------------------------------------------------------------------------
case "${1:-}" in
    --help|-h)
        cat <<EOF
Usage: $(basename "$0") [OPTIONS]

GuanWo SSL Certificate Auto-Renewal Script

Options:
    --help, -h      Show this help message
    --force         Force renewal even if not due

This script is designed to run via cron twice daily.
Certbot will only renew certificates when they are within 30 days of expiry.
EOF
        exit 0
        ;;
    --force)
        step "Forcing certificate renewal..."
        cd "$DEPLOY_DIR" || exit 1
        docker run --rm \
            -v "guanwo_certbot_data:/etc/letsencrypt" \
            -v "${DEPLOY_DIR}/docker/certbot/www:/var/www/certbot" \
            certbot/certbot:latest \
            renew --force-renew --webroot --webroot-path /var/www/certbot --quiet || true
        shift
        main
        ;;
    *)
        main "$@"
        ;;
esac
