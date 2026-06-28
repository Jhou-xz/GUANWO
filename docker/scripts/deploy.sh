#!/usr/bin/env bash
# =============================================================================
# GuanWo (观我) — Main Deployment Script
# =============================================================================
# Usage:     ./deploy.sh [options]
# Purpose:   Git-based automated deployment for a solo developer
# Features:  Pull code → Backup DB → Build → Migrate → Health check → Cleanup
# Idempotent: Yes — safe to run multiple times
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
#  CONFIGURATION — Edit these variables for your environment
# ---------------------------------------------------------------------------
SERVER_IP="${SERVER_IP:-YOUR_SERVER_IP}"
DOMAIN="${DOMAIN:-your-domain.com}"
REPO_URL="${REPO_URL:-git@github.com:yourname/guanwo.git}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/guanwo}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-docker/.env.production}"
LOG_FILE="${LOG_FILE:-/var/log/guanwo-deploy.log}"
HEALTH_URL="${HEALTH_URL:-https://${DOMAIN}/api/health/}"
HEALTH_RETRIES="${HEALTH_RETRIES:-12}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

NOTIFY_WEBHOOK="${NOTIFY_WEBHOOK:-}"
ROLLBACK_DEPTH="${ROLLBACK_DEPTH:-5}"

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
    sudo mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
    echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

success() { log "${C_GREEN}✓ $*${C_RESET}"; }
error()   { log "${C_RED}✗ ERROR: $*${C_RESET}"; }
warn()    { log "${C_YELLOW}⚠ WARN: $*${C_RESET}"; }
info()    { log "${C_BLUE}ℹ $*${C_RESET}"; }
step()    { log "${C_CYAN}→ $*${C_RESET}"; }

# ---------------------------------------------------------------------------
#  NOTIFICATIONS
# ---------------------------------------------------------------------------
notify() {
    local status="$1"
    local message="$2"

    [[ -z "$NOTIFY_WEBHOOK" ]] && return 0

    local payload
    if [[ "$NOTIFY_WEBHOOK" == *"slack"* ]] || [[ "$NOTIFY_WEBHOOK" == *"hooks"* ]]; then
        local color="good"
        [[ "$status" == "failure" ]] && color="danger"
        payload=$(cat <<EOF
{
    "attachments": [{
        "color": "$color",
        "title": "GuanWo Deployment — ${status^^}",
        "text": "$message",
        "footer": "your-domain.com",
        "ts": $(date +%s)
    }]
}
EOF
)
    else
        payload="{\"text\": \"GuanWo Deployment [$status]: $message\"}"
    fi

    curl -s -X POST -H 'Content-type: application/json' \
        --data "$payload" "$NOTIFY_WEBHOOK" > /dev/null 2>&1 || warn "Failed to send notification"
}

# ---------------------------------------------------------------------------
#  CLEANUP on exit / error
# ---------------------------------------------------------------------------
cleanup() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        error "Deployment failed with exit code $exit_code"
        info "Check logs: $LOG_FILE"
        notify "failure" "Deployment failed on ${DOMAIN}. Exit code: $exit_code. Check ${LOG_FILE}."
    fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
#  PRE-DEPLOYMENT CHECKS
# ---------------------------------------------------------------------------
step "Starting GuanWo deployment — $(date)"
info "Server: ${SERVER_IP} | Domain: ${DOMAIN} | Dir: ${DEPLOY_DIR}"

if ! command -v docker &>/dev/null; then
    error "Docker is not installed. Run ./setup-vps.sh first."
    exit 1
fi
if ! docker info &>/dev/null; then
    error "Docker daemon is not running. Start with: sudo systemctl start docker"
    exit 1
fi
success "Docker is installed and running"

if ! docker compose version &>/dev/null; then
    error "Docker Compose is not installed. Run ./setup-vps.sh first."
    exit 1
fi
success "Docker Compose is available"

if [[ ! -d "$DEPLOY_DIR/.git" ]]; then
    error "Git repository not found at ${DEPLOY_DIR}. Run ./setup-vps.sh first."
    exit 1
fi
success "Git repository found at ${DEPLOY_DIR}"

if [[ ! -f "${DEPLOY_DIR}/${ENV_FILE}" ]]; then
    warn "Environment file not found: ${ENV_FILE}"
    warn "Copy from .env.example: cp docker/.env.example ${ENV_FILE}"
    exit 1
fi
success "Environment file found"

# ---------------------------------------------------------------------------
#  COMPOSE COMMAND
# ---------------------------------------------------------------------------
COMPOSE_CMD="docker compose -f ${COMPOSE_FILE}"

# ---------------------------------------------------------------------------
#  1. NAVIGATE TO DEPLOY DIRECTORY
# ---------------------------------------------------------------------------
cd "$DEPLOY_DIR"
info "Working directory: $(pwd)"

BEFORE_COMMIT=$(git rev-parse HEAD)
info "Current commit before deploy: ${BEFORE_COMMIT:0:8}"

# ---------------------------------------------------------------------------
#  2. PULL LATEST CODE
# ---------------------------------------------------------------------------
step "Pulling latest code from main branch..."
git fetch origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [[ "$LOCAL" == "$REMOTE" ]]; then
    warn "No new commits on origin/main. Local is already up to date."
    info "Continuing anyway — Docker build will use latest local code."
else
    git pull origin main
    success "Code updated: ${LOCAL:0:8} → ${REMOTE:0:8}"
fi

# ---------------------------------------------------------------------------
#  3. BUILD FRONTEND STATIC FILES
# ---------------------------------------------------------------------------
step "Building frontend static files..."
docker build -f Dockerfile.frontend -t guanwo-frontend:tmp .
rm -rf dist
container_id=$(docker create guanwo-frontend:tmp)
docker cp "${container_id}:/usr/share/nginx/html" ./dist
docker rm "$container_id"
docker rmi guanwo-frontend:tmp >/dev/null 2>&1 || true
success "Frontend static files built in ./dist"

# ---------------------------------------------------------------------------
#  4. BACKUP DATABASE BEFORE DEPLOYMENT
# ---------------------------------------------------------------------------
step "Creating pre-deployment database backup..."
BACKUP_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${DEPLOY_DIR}/backups"
BACKUP_FILE="${BACKUP_DIR}/pre_deploy_${BACKUP_TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-guanwo}"
DB_USER="${DB_USER:-guanwo}"
DB_PASSWORD="${DB_PASSWORD:-}"

if [[ -f "${DEPLOY_DIR}/${ENV_FILE}" ]] && [[ -z "$DB_PASSWORD" ]]; then
    set -a
    # shellcheck source=/dev/null
    source <(grep -v '^#' "${DEPLOY_DIR}/${ENV_FILE}" | grep -v '^$' | sed 's/^export //')
    set +a
fi

info "Backing up database: ${DB_NAME}..."
if $COMPOSE_CMD ps postgres 2>/dev/null | grep -q "running\|Up"; then
    $COMPOSE_CMD exec -T postgres \
        pg_dump -h localhost -U "$DB_USER" -d "$DB_NAME" --clean --if-exists \
        | gzip > "$BACKUP_FILE"
    success "Database backup created: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1))"
else
    warn "PostgreSQL container is not running. Skipping backup."
fi

# ---------------------------------------------------------------------------
#  5. BUILD DOCKER IMAGES
# ---------------------------------------------------------------------------
step "Building Docker images..."
$COMPOSE_CMD build --no-cache django
success "Docker images built successfully"

$COMPOSE_CMD pull postgres redis nginx

# ---------------------------------------------------------------------------
#  6. RUN DATABASE MIGRATIONS
# ---------------------------------------------------------------------------
step "Running database migrations..."
$COMPOSE_CMD up -d postgres redis

info "Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
    if $COMPOSE_CMD exec -T postgres \
        pg_isready -h localhost -U "$DB_USER" -q 2>/dev/null; then
        success "PostgreSQL is ready"
        break
    fi
    sleep 1
    if [[ $i -eq 30 ]]; then
        error "PostgreSQL failed to become ready within 30 seconds"
        exit 1
    fi
done

$COMPOSE_CMD run --rm django \
    python manage.py migrate --noinput
success "Database migrations completed"

# ---------------------------------------------------------------------------
#  7. COLLECT STATIC FILES
# ---------------------------------------------------------------------------
step "Collecting static files..."
$COMPOSE_CMD run --rm django \
    python manage.py collectstatic --noinput --clear
success "Static files collected"

# ---------------------------------------------------------------------------
#  8. RESTART SERVICES
# ---------------------------------------------------------------------------
step "Restarting services..."
$COMPOSE_CMD up -d --remove-orphans

sleep 5

info "Checking service status..."
$COMPOSE_CMD ps | grep -q "running\|Up" || {
    error "No services are running after docker compose up"
    exit 1
}

$COMPOSE_CMD ps
success "All services are running"

# ---------------------------------------------------------------------------
#  9. HEALTH CHECK
# ---------------------------------------------------------------------------
step "Running health check: ${HEALTH_URL}..."

HEALTH_OK=false
for i in $(seq 1 "$HEALTH_RETRIES"); do
    info "Health check attempt ${i}/${HEALTH_RETRIES}..."

    if curl -s -f -o /dev/null -w "%{http_code}" \
        --max-time 10 \
        -H "User-Agent: GuanWo-Deploy-HealthCheck" \
        "$HEALTH_URL" | grep -q "200"; then

        HEALTH_RESPONSE=$(curl -s --max-time 10 "$HEALTH_URL" || echo "{}")
        success "Health check PASSED"
        info "Response: ${HEALTH_RESPONSE}"
        HEALTH_OK=true
        break
    fi

    sleep "$HEALTH_INTERVAL"
done

# ---------------------------------------------------------------------------
#  10. ROLLBACK ON FAILURE
# ---------------------------------------------------------------------------
if [[ "$HEALTH_OK" == "false" ]]; then
    error "Health check FAILED after ${HEALTH_RETRIES} attempts"
    error "Initiating rollback to commit: ${BEFORE_COMMIT:0:8}..."

    step "Rolling back code..."
    git reset --hard "$BEFORE_COMMIT"

    step "Rebuilding with previous code..."
    $COMPOSE_CMD build --no-cache django

    step "Restoring database from pre-deploy backup..."
    if [[ -f "$BACKUP_FILE" ]]; then
        zcat "$BACKUP_FILE" | $COMPOSE_CMD exec -T postgres \
            psql -h localhost -U "$DB_USER" -d "$DB_NAME" -q
        success "Database restored from backup"
    else
        warn "No pre-deploy backup found. Database was not restored."
    fi

    step "Restarting with previous version..."
    $COMPOSE_CMD up -d

    sleep 10
    if curl -s -f -o /dev/null --max-time 10 "$HEALTH_URL"; then
        success "Rollback completed successfully. Services are healthy."
        notify "failure" "Deployment rolled back on ${DOMAIN}. Previous version restored and healthy."
    else
        error "CRITICAL: Rollback failed! Manual intervention required."
        notify "failure" "CRITICAL: Deployment AND rollback both failed on ${DOMAIN}! Immediate manual intervention required."
    fi
    exit 1
fi

# ---------------------------------------------------------------------------
#  11. POST-DEPLOYMENT CLEANUP
# ---------------------------------------------------------------------------
step "Running post-deployment cleanup..."

info "Removing dangling Docker images..."
docker image prune -f || warn "Failed to prune dangling images"

info "Cleaning up old Docker images for guanwo..."
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedAt}}' \
    | grep "guanwo" \
    | sort -k3 -r \
    | tail -n +3 \
    | awk '{print $2}' \
    | xargs -r docker rmi -f 2>/dev/null || true

docker builder prune -f --filter "until=168h" 2>/dev/null || true

info "Cleaning up old backups (retention: ${BACKUP_RETENTION_DAYS} days)..."
find "$BACKUP_DIR" -name "*.sql.gz" -type f -mtime +"$BACKUP_RETENTION_DAYS" -delete 2>/dev/null || true
success "Cleanup completed"

# ---------------------------------------------------------------------------
#  12. DEPLOYMENT SUMMARY
# ---------------------------------------------------------------------------
AFTER_COMMIT=$(git rev-parse HEAD)

success "═══════════════════════════════════════════════════"
success "  GuanWo Deployment Complete"
success "═══════════════════════════════════════════════════"
info "  Domain:      https://${DOMAIN}"
info "  Commit:      ${BEFORE_COMMIT:0:8} → ${AFTER_COMMIT:0:8}"
info "  Backup:      ${BACKUP_FILE}"
info "  Log file:    ${LOG_FILE}"
success "═══════════════════════════════════════════════════"

notify "success" "GuanWo deployed successfully on ${DOMAIN}. Commit: ${AFTER_COMMIT:0:8}."

exit 0
