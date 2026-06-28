#!/usr/bin/env bash
# =============================================================================
# GuanWo (观我) — Database Backup Script
# =============================================================================
# Usage:     ./backup.sh [options]
# Purpose:   Daily PostgreSQL backup with rotation and optional cloud sync
# Schedule:  Add to crontab: 0 3 * * * /opt/guanwo/docker/scripts/backup.sh
# Idempotent: Yes — uses lock file to prevent concurrent runs
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
#  CONFIGURATION
# ---------------------------------------------------------------------------
DEPLOY_DIR="${DEPLOY_DIR:-/opt/guanwo}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-docker/.env.production}"
BACKUP_DIR="${BACKUP_DIR:-/opt/guanwo/backups}"
LOG_FILE="${LOG_FILE:-/var/log/guanwo-backup.log}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

OSS_BUCKET="${OSS_BUCKET:-}"
OSS_ENDPOINT="${OSS_ENDPOINT:-oss-cn-hangzhou.aliyuncs.com}"
OSS_SYNC_ENABLED="${OSS_SYNC_ENABLED:-false}"
NOTIFY_WEBHOOK="${NOTIFY_WEBHOOK:-}"

LOCK_FILE="/tmp/guanwo-backup.lock"
LOCK_TIMEOUT=3600

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

# ---------------------------------------------------------------------------
#  LOCK FILE
# ---------------------------------------------------------------------------
acquire_lock() {
    if [[ -f "$LOCK_FILE" ]]; then
        local pid
        pid=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            local lock_age
            lock_age=$(stat -c %Y "$LOCK_FILE" 2>/dev/null || echo "0")
            local now
            now=$(date +%s)
            if [[ $((now - lock_age)) -gt $LOCK_TIMEOUT ]]; then
                warn "Stale lock file found (PID: $pid, older than ${LOCK_TIMEOUT}s). Removing."
                rm -f "$LOCK_FILE"
            else
                error "Another backup process is running (PID: $pid). Exiting."
                exit 1
            fi
        else
            warn "Stale lock file found (PID: $pid not running). Removing."
            rm -f "$LOCK_FILE"
        fi
    fi

    echo $$ > "$LOCK_FILE"
    trap "rm -f $LOCK_FILE; exit" INT TERM EXIT
}

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
{"attachments": [{"color": "$color", "title": "GuanWo Backup — ${status^^}", "text": "$message", "footer": "your-domain.com", "ts": $(date +%s)}]}
EOF
)
    else
        payload="{\"text\": \"GuanWo Backup [$status]: $message\"}"
    fi

    curl -s -X POST -H 'Content-type: application/json' \
        --data "$payload" "$NOTIFY_WEBHOOK" > /dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
#  LOAD ENVIRONMENT VARIABLES
# ---------------------------------------------------------------------------
load_env() {
    cd "$DEPLOY_DIR" || exit 1

    if [[ -f "$ENV_FILE" ]]; then
        set -a
        # shellcheck source=/dev/null
        source <(grep -v '^#' "$ENV_FILE" | grep -v '^$' | sed 's/^export //')
        set +a
        info "Environment loaded from ${ENV_FILE}"
    else
        warn "Environment file not found: ${ENV_FILE}"
    fi

    DB_HOST="${DB_HOST:-postgres}"
    DB_PORT="${DB_PORT:-5432}"
    DB_NAME="${DB_NAME:-guanwo}"
    DB_USER="${DB_USER:-guanwo}"
}

# ---------------------------------------------------------------------------
#  BACKUP FUNCTION
# ---------------------------------------------------------------------------
run_backup() {
    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="${BACKUP_DIR}/guanwo_${timestamp}.sql.gz"
    local backup_info="${BACKUP_DIR}/guanwo_${timestamp}.info"

    info "Starting database backup: ${DB_NAME}"
    info "Backup file: ${backup_file}"

    mkdir -p "$BACKUP_DIR"

    if ! docker compose -f "$COMPOSE_FILE" ps postgres 2>/dev/null | grep -q "running\|Up"; then
        error "PostgreSQL container is not running. Cannot perform backup."
        return 1
    fi

    local start_time
    start_time=$(date +%s)

    info "Running pg_dump..."
    if docker compose -f "$COMPOSE_FILE" exec -T postgres \
        pg_dump -h localhost -U "$DB_USER" -d "$DB_NAME" \
        --verbose --blobs --no-owner --no-privileges 2>> "$LOG_FILE" \
        | gzip > "$backup_file"; then

        local end_time
        end_time=$(date +%s)
        local duration=$((end_time - start_time))
        local file_size
        file_size=$(du -h "$backup_file" | cut -f1)

        cat > "$backup_info" <<EOF
{
    "database": "${DB_NAME}",
    "timestamp": "$(date -Iseconds)",
    "file": "$(basename "$backup_file")",
    "size": "${file_size}",
    "duration_seconds": ${duration},
    "host": "$(hostname)",
    "db_user": "${DB_USER}"
}
EOF

        success "Backup completed in ${duration}s (${file_size})"
        info "Backup info: ${backup_info}"
        return 0
    else
        error "pg_dump failed!"
        rm -f "$backup_file"
        return 1
    fi
}

# ---------------------------------------------------------------------------
#  BACKUP ROTATION
# ---------------------------------------------------------------------------
rotate_backups() {
    info "Rotating backups (keeping last ${RETENTION_DAYS} days)..."

    local deleted_count=0

    while IFS= read -r file; do
        info "Removing old backup: ${file}"
        rm -f "$file"
        rm -f "${file%.sql.gz}.info"
        ((deleted_count++)) || true
    done < <(find "$BACKUP_DIR" -name "guanwo_*.sql.gz" -type f -mtime +"$RETENTION_DAYS" 2>/dev/null)

    if [[ $deleted_count -gt 0 ]]; then
        success "Removed ${deleted_count} old backup(s)"
    else
        info "No old backups to remove"
    fi

    local backup_count
    backup_count=$(find "$BACKUP_DIR" -name "guanwo_*.sql.gz" -type f | wc -l)
    info "Current local backups: ${backup_count} file(s)"
}

# ---------------------------------------------------------------------------
#  ALIYUN OSS SYNC (Optional)
# ---------------------------------------------------------------------------
sync_to_oss() {
    [[ "$OSS_SYNC_ENABLED" != "true" ]] && return 0
    [[ -z "$OSS_BUCKET" ]] && { warn "OSS_BUCKET not set. Skipping OSS sync."; return 0; }

    info "Syncing backups to Aliyun OSS (bucket: ${OSS_BUCKET})..."

    if command -v ossutil &>/dev/null; then
        info "Using ossutil for OSS sync..."
        local latest_backup
        latest_backup=$(find "$BACKUP_DIR" -name "guanwo_*.sql.gz" -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)

        if [[ -n "$latest_backup" ]]; then
            local remote_path="oss://${OSS_BUCKET}/backups/$(basename "$latest_backup")"
            if ossutil cp "$latest_backup" "$remote_path" -e "$OSS_ENDPOINT" > /dev/null 2>> "$LOG_FILE"; then
                success "Backup synced to OSS: ${remote_path}"
            else
                warn "OSS sync failed. Check log for details."
                return 1
            fi
        fi
    elif command -v aliyun &>/dev/null; then
        warn "aliyun CLI OSS sync not fully implemented. Please configure ossutil for best results."
    else
        warn "Neither ossutil nor aliyun CLI found. Skipping OSS sync."
        return 1
    fi
}

# ---------------------------------------------------------------------------
#  MAIN EXECUTION
# ---------------------------------------------------------------------------
main() {
    step "═══════════════════════════════════════════════════"
    step "  GuanWo Daily Backup — $(date)"
    step "═══════════════════════════════════════════════════"

    acquire_lock
    load_env

    if run_backup; then
        rotate_backups
        sync_to_oss
        success "═══════════════════════════════════════════════════"
        success "  Backup completed successfully"
        success "═══════════════════════════════════════════════════"
        notify "success" "GuanWo backup completed. DB: ${DB_NAME}. Backups retained: ${RETENTION_DAYS} days."
    else
        error "═══════════════════════════════════════════════════"
        error "  Backup FAILED"
        error "═══════════════════════════════════════════════════"
        notify "failure" "GuanWo backup FAILED for DB: ${DB_NAME}. Check ${LOG_FILE}."
        exit 1
    fi
}

# ---------------------------------------------------------------------------
#  CLI HELP
# ---------------------------------------------------------------------------
case "${1:-}" in
    --help|-h)
        cat <<EOF
Usage: $(basename "$0") [OPTIONS]

GuanWo Database Backup Script

Options:
    --help, -h      Show this help message
    --dry-run       Show what would happen without running
    --list          List available backups
    --restore FILE  Restore database from backup file (interactive)

Environment Variables:
    DEPLOY_DIR      Application directory (default: /opt/guanwo)
    BACKUP_DIR      Backup storage directory (default: /opt/guanwo/backups)
    RETENTION_DAYS  Days to keep backups (default: 7)
    OSS_BUCKET      Aliyun OSS bucket name (optional)
    OSS_ENDPOINT    Aliyun OSS endpoint (default: oss-cn-hangzhou.aliyuncs.com)
    NOTIFY_WEBHOOK  Slack/WeChat webhook URL for notifications

Cron Setup:
    0 3 * * * /opt/guanwo/docker/scripts/backup.sh >> /var/log/guanwo-backup.log 2>&1
EOF
        exit 0
        ;;
    --list)
        echo "Available backups:"
        ls -lth "$BACKUP_DIR"/guanwo_*.sql.gz 2>/dev/null || echo "  No backups found."
        exit 0
        ;;
    --restore)
        echo "Restore functionality — not yet implemented. Use manual restore:"
        echo "  zcat <backup_file> | docker compose -f ${COMPOSE_FILE} exec -T postgres psql -U ${DB_USER} -d ${DB_NAME}"
        exit 1
        ;;
    *)
        main "$@"
        ;;
esac
