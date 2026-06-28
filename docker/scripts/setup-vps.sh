#!/usr/bin/env bash
# =============================================================================
# GuanWo (观我) — One-Time VPS Setup Script
# =============================================================================
# Usage:     ./setup-vps.sh
# Purpose:   Prepare a fresh Ubuntu VPS for GuanWo deployment
# WARNING:   Run this ONCE on a fresh VPS. It installs system packages
#            and modifies system configuration.
# Idempotent: Partially — safe to re-run most sections.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
#  CONFIGURATION
# ---------------------------------------------------------------------------
DEPLOY_USER="${DEPLOY_USER:-guanwo}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/guanwo}"
REPO_URL="${REPO_URL:-}"
DOMAIN="${DOMAIN:-your-domain.com}"
SERVER_IP="${SERVER_IP:-}"
GITHUB_USER="${GITHUB_USER:-}"
USE_ALIYUN_MIRROR="${USE_ALIYUN_MIRROR:-true}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-admin@your-domain.com}"

# ---------------------------------------------------------------------------
#  COLOR CODES
# ---------------------------------------------------------------------------
readonly C_RESET='\033[0m'
readonly C_GREEN='\033[0;32m'
readonly C_RED='\033[0;31m'
readonly C_YELLOW='\033[1;33m'
readonly C_BLUE='\033[0;34m'
readonly C_CYAN='\033[0;36m'

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    echo -e "$msg"
}
success() { log "${C_GREEN}✓ $*${C_RESET}"; }
error()   { log "${C_RED}✗ ERROR: $*${C_RESET}"; }
warn()    { log "${C_YELLOW}⚠ WARN: $*${C_RESET}"; }
info()    { log "${C_BLUE}ℹ $*${C_RESET}"; }
step()    { log "${C_CYAN}→ $*${C_RESET}"; }

# ---------------------------------------------------------------------------
#  SECTION: System Update
# ---------------------------------------------------------------------------
section_system_update() {
    step "[1/10] Updating system packages..."

    export DEBIAN_FRONTEND=noninteractive

    if [[ "$USE_ALIYUN_MIRROR" == "true" ]]; then
        info "Using Aliyun Ubuntu mirror..."
        sudo sed -i 's/archive.ubuntu.com/mirrors.aliyun.com/g' /etc/apt/sources.list
        sudo sed -i 's/security.ubuntu.com/mirrors.aliyun.com/g' /etc/apt/sources.list
    fi

    sudo apt-get update
    sudo apt-get upgrade -y
    sudo apt-get install -y \
        curl wget git vim htop unzip \
        apt-transport-https ca-certificates \
        gnupg lsb-release \
        software-properties-common \
        logrotate \
        cron \
        ufw \
        tzdata

    sudo timedatectl set-timezone Asia/Shanghai || true

    success "System packages updated"
}

# ---------------------------------------------------------------------------
#  SECTION: Docker & Docker Compose
# ---------------------------------------------------------------------------
section_docker() {
    step "[2/10] Installing Docker and Docker Compose..."

    sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

    if [[ ! -f /usr/share/keyrings/docker-archive-keyring.gpg ]]; then
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
            sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    fi

    echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] \
        https://download.docker.com/linux/ubuntu \
        $(lsb_release -cs) stable" | \
        sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    sudo systemctl start docker
    sudo systemctl enable docker

    sudo groupadd docker 2>/dev/null || true
    sudo usermod -aG docker "$USER" || true

    id "$DEPLOY_USER" &>/dev/null && sudo usermod -aG docker "$DEPLOY_USER" || true

    docker --version
    docker compose version

    success "Docker and Docker Compose installed"
    warn "You may need to log out and back in for docker group changes to take effect."
}

# ---------------------------------------------------------------------------
#  SECTION: Create Deployment User
# ---------------------------------------------------------------------------
section_deploy_user() {
    step "[3/10] Creating deployment user: ${DEPLOY_USER}..."

    if id "$DEPLOY_USER" &>/dev/null; then
        warn "User ${DEPLOY_USER} already exists. Skipping creation."
    else
        sudo useradd -m -s /bin/bash -G docker,sudo "$DEPLOY_USER"
        info "User ${DEPLOY_USER} created. Set password with: sudo passwd ${DEPLOY_USER}"
    fi

    sudo mkdir -p "/home/${DEPLOY_USER}/.ssh"

    if [[ -f ~/.ssh/authorized_keys ]]; then
        sudo cp ~/.ssh/authorized_keys "/home/${DEPLOY_USER}/.ssh/authorized_keys"
        sudo chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
        sudo chmod 700 "/home/${DEPLOY_USER}/.ssh"
        sudo chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
        info "SSH authorized_keys copied to ${DEPLOY_USER}"
    fi

    success "Deployment user ${DEPLOY_USER} ready"
}

# ---------------------------------------------------------------------------
#  SECTION: Create Deployment Directory & Clone Repository
# ---------------------------------------------------------------------------
section_clone_repo() {
    step "[4/10] Setting up deployment directory..."

    sudo mkdir -p "$DEPLOY_DIR"

    if [[ ! -d "${DEPLOY_DIR}/.git" ]]; then
        if [[ -z "$REPO_URL" ]]; then
            warn "REPO_URL not set. Please provide your repository URL:"
            read -r -p "Repository URL: " REPO_URL
        fi

        info "Cloning repository: ${REPO_URL}..."
        sudo git clone "$REPO_URL" "$DEPLOY_DIR"
    else
        info "Repository already cloned at ${DEPLOY_DIR}. Pulling latest..."
        cd "$DEPLOY_DIR" && sudo git pull origin main || true
    fi

    sudo chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "$DEPLOY_DIR"

    success "Deployment directory ready: ${DEPLOY_DIR}"
}

# ---------------------------------------------------------------------------
#  SECTION: Environment Configuration
# ---------------------------------------------------------------------------
section_environment() {
    step "[5/10] Setting up environment configuration..."

    cd "$DEPLOY_DIR"

    if [[ -f "docker/.env.production" ]]; then
        info "docker/.env.production already exists."
        warn "Review and update it manually if needed."
        return 0
    fi

    if [[ ! -f "docker/.env.example" ]]; then
        error "docker/.env.example not found. Cannot create .env.production."
        return 1
    fi

    info "Copying .env.example to .env.production..."
    cp docker/.env.example docker/.env.production

    DJANGO_SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))' 2>/dev/null || openssl rand -hex 32)
    POSTGRES_PASSWORD=$(openssl rand -hex 16)

    sed -i "s|your-secret-key-here|${DJANGO_SECRET_KEY}|g" docker/.env.production
    sed -i "s|your-secure-postgres-password-here|${POSTGRES_PASSWORD}|g" docker/.env.production
    sed -i "s|your-domain.com|${DOMAIN}|g" docker/.env.production
    sed -i "s|admin@your-domain.com|${LETSENCRYPT_EMAIL}|g" docker/.env.production

    echo ""
    echo "═══════════════════════════════════════════════════════"
    echo "  Configure External Service Keys"
    echo "═══════════════════════════════════════════════════════"

    read -r -p "DeepSeek API Key [leave blank to fill later]: " deepseek_key
    if [[ -n "$deepseek_key" ]]; then
        sed -i "s|sk-your-deepseek-api-key-here|${deepseek_key}|g" docker/.env.production
    fi

    read -r -p "WeChat App ID [leave blank to fill later]: " wechat_appid
    if [[ -n "$wechat_appid" ]]; then
        sed -i "s|wx-your-app-id-here|${wechat_appid}|g" docker/.env.production
    fi

    read -r -p "WeChat App Secret [leave blank to fill later]: " wechat_secret
    if [[ -n "$wechat_secret" ]]; then
        sed -i "s|your-wechat-app-secret-here|${wechat_secret}|g" docker/.env.production
    fi

    read -r -p "Sentry DSN [leave blank to skip]: " sentry_dsn
    if [[ -n "$sentry_dsn" ]]; then
        sed -i "s|your-sentry-dsn-here|${sentry_dsn}|g" docker/.env.production
    fi

    echo ""
    warn "Remember to review docker/.env.production and fill in any remaining values!"
    warn "Command: vim ${DEPLOY_DIR}/docker/.env.production"

    chmod 600 docker/.env.production

    success "Environment configuration created"
}

# ---------------------------------------------------------------------------
#  SECTION: SSL Certificates (Let's Encrypt)
# ---------------------------------------------------------------------------
section_ssl() {
    step "[6/10] Setting up SSL certificates..."

    cd "$DEPLOY_DIR"

    if [[ -f "docker/scripts/init-letsencrypt.sh" ]]; then
        info "Running Let's Encrypt initialization..."
        bash docker/scripts/init-letsencrypt.sh "$DOMAIN" "$LETSENCRYPT_EMAIL"
    else
        warn "init-letsencrypt.sh not found. Manual SSL setup required."

        mkdir -p docker/nginx/ssl

        info "Generating temporary self-signed certificate..."
        openssl req -x509 -nodes -days 1 -newkey rsa:2048 \
            -keyout docker/nginx/ssl/temp.key \
            -out docker/nginx/ssl/temp.crt \
            -subj "/CN=${DOMAIN}" \
            -addext "subjectAltName=DNS:${DOMAIN},DNS:www.${DOMAIN}" 2>/dev/null || true
    fi

    success "SSL setup completed"
}

# ---------------------------------------------------------------------------
#  SECTION: Firewall (UFW)
# ---------------------------------------------------------------------------
section_firewall() {
    step "[7/10] Configuring firewall..."

    sudo ufw --force reset
    sudo ufw default deny incoming
    sudo ufw default allow outgoing

    sudo ufw allow 22/tcp comment 'SSH'
    sudo ufw allow 80/tcp comment 'HTTP'
    sudo ufw allow 443/tcp comment 'HTTPS'

    if [[ -n "${ADMIN_IP:-}" ]]; then
        sudo ufw allow from "$ADMIN_IP" to any port 22
    fi

    echo "y" | sudo ufw enable
    sudo ufw status verbose

    success "Firewall configured (22, 80, 443 allowed)"
}

# ---------------------------------------------------------------------------
#  SECTION: Initial Build & Start
# ---------------------------------------------------------------------------
section_initial_deploy() {
    step "[8/10] Building and starting services for the first time..."

    cd "$DEPLOY_DIR"

    info "Building frontend static files..."
    docker build -f Dockerfile.frontend -t guanwo-frontend:tmp .
    rm -rf dist
    container_id=$(docker create guanwo-frontend:tmp)
    docker cp "${container_id}:/usr/share/nginx/html" ./dist
    docker rm "$container_id"

    info "Building Docker images..."
    docker compose -f docker/docker-compose.yml build --no-cache

    info "Starting services..."
    docker compose -f docker/docker-compose.yml up -d

    info "Waiting for PostgreSQL..."
    sleep 10

    info "Running initial database migrations..."
    docker compose -f docker/docker-compose.yml run --rm django \
        python manage.py migrate --noinput

    info "Collecting static files..."
    docker compose -f docker/docker-compose.yml run --rm django \
        python manage.py collectstatic --noinput

    echo ""
    echo "═══════════════════════════════════════════════════════"
    read -r -p "Create Django superuser now? [y/N]: " create_su
    if [[ "$create_su" =~ ^[Yy]$ ]]; then
        docker compose -f docker/docker-compose.yml run --rm django \
            python manage.py createsuperuser
    fi

    success "Initial deployment completed"
    info "Services should be accessible at: http://${SERVER_IP:-your-server-ip}/"
}

# ---------------------------------------------------------------------------
#  SECTION: Cron Jobs
# ---------------------------------------------------------------------------
section_cron() {
    step "[9/10] Setting up cron jobs..."

    local cron_file="/tmp/guanwo-cron"

    cat > "$cron_file" <<EOF
# GuanWo (观我) — Scheduled Tasks
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Daily database backup at 3:00 AM
0 3 * * * ${DEPLOY_USER} cd ${DEPLOY_DIR} && bash docker/scripts/backup.sh >> /var/log/guanwo-backup.log 2>&1

# SSL certificate renewal check twice daily
0 0,12 * * * ${DEPLOY_USER} cd ${DEPLOY_DIR} && bash docker/scripts/certbot-renew.sh >> /var/log/guanwo-certbot.log 2>&1

# Weekly Docker system cleanup (Sundays at 4 AM)
0 4 * * 0 root docker system prune -f --volumes >> /var/log/guanwo-cleanup.log 2>&1
EOF

    sudo crontab "$cron_file"
    rm -f "$cron_file"

    success "Cron jobs configured"
    info "  • Daily backup: 3:00 AM"
    info "  • SSL renewal: 12:00 AM, 12:00 PM"
    info "  • Docker cleanup: Sunday 4:00 AM"
}

# ---------------------------------------------------------------------------
#  SECTION: Log Rotation
# ---------------------------------------------------------------------------
section_logrotate() {
    step "[10/10] Setting up log rotation..."

    sudo tee /etc/logrotate.d/guanwo > /dev/null <<'EOF'
/var/log/guanwo-*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0644 root root
    sharedscripts
    postrotate
        /bin/kill -HUP $(cat /var/run/rsyslogd.pid 2>/dev/null) 2>/dev/null || true
    endscript
}
EOF

    success "Log rotation configured (14 days retention, daily rotation)"
}

# ---------------------------------------------------------------------------
#  MAIN
# ---------------------------------------------------------------------------
main() {
    echo ""
    step "═══════════════════════════════════════════════════"
    step "  GuanWo (观我) — VPS Setup"
    step "  This script prepares a fresh Ubuntu server"
    step "═══════════════════════════════════════════════════"
    echo ""

    if [[ ! -f /etc/os-release ]]; then
        error "Cannot determine OS. This script requires Ubuntu 22.04 LTS."
        exit 1
    fi

    source /etc/os-release
    info "Detected OS: ${NAME} ${VERSION_ID}"

    if [[ "$ID" != "ubuntu" ]]; then
        warn "This script is designed for Ubuntu. Proceed with caution."
    fi

    if [[ $EUID -ne 0 ]] && ! sudo -n true 2>/dev/null; then
        error "This script must run as root or with passwordless sudo."
        exit 1
    fi

    if [[ -z "$REPO_URL" ]]; then
        echo ""
        read -r -p "Git repository URL (e.g., git@github.com:user/guanwo.git): " REPO_URL
    fi
    if [[ -z "$DOMAIN" ]] || [[ "$DOMAIN" == "your-domain.com" ]]; then
        read -r -p "Your domain name (e.g., your-domain.com): " DOMAIN
    fi

    echo ""
    echo "Configuration Summary:"
    echo "  Domain:        ${DOMAIN}"
    echo "  Deploy User:   ${DEPLOY_USER}"
    echo "  Deploy Dir:    ${DEPLOY_DIR}"
    echo "  Repo URL:      ${REPO_URL}"
    echo ""
    read -r -p "Continue with setup? [y/N]: " confirm

    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        warn "Setup cancelled."
        exit 0
    fi

    section_system_update
    section_docker
    section_deploy_user
    section_clone_repo
    section_environment
    section_ssl
    section_firewall
    section_initial_deploy
    section_cron
    section_logrotate

    echo ""
    success "═══════════════════════════════════════════════════"
    success "  VPS Setup Complete!"
    success "═══════════════════════════════════════════════════"
    echo ""
    info "Next steps:"
    info "  1. Review env file:  vim ${DEPLOY_DIR}/docker/.env.production"
    info "  2. Setup GitHub Actions secrets (see .github/workflows/deploy.yml)"
    info "  3. Configure DNS A record: ${DOMAIN} → $(curl -s ifconfig.me || echo 'YOUR_SERVER_IP')"
    info "  4. First deploy:     cd ${DEPLOY_DIR} && bash docker/scripts/deploy.sh"
    echo ""
    warn "IMPORTANT: Log out and back in for Docker group changes to take effect."
    echo ""
}

# Allow running individual sections
case "${1:-}" in
    --help|-h)
        cat <<EOF
Usage: $(basename "$0") [section]

GuanWo VPS One-Time Setup Script

Sections:
    system      Update system packages
    docker      Install Docker and Docker Compose
    user        Create deployment user
    clone       Clone repository
    env         Setup environment variables
    ssl         Setup SSL certificates
    firewall    Configure UFW firewall
    deploy      Initial build and deploy
    cron        Setup cron jobs
    logrotate   Setup log rotation

Without arguments, runs all sections in order.
EOF
        exit 0
        ;;
    system)     section_system_update ;;
    docker)     section_docker ;;
    user)       section_deploy_user ;;
    clone)      section_clone_repo ;;
    env)        section_environment ;;
    ssl)        section_ssl ;;
    firewall)   section_firewall ;;
    deploy)     section_initial_deploy ;;
    cron)       section_cron ;;
    logrotate)  section_logrotate ;;
    *)          main "$@" ;;
esac
