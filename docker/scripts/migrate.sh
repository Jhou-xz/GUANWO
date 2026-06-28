#!/usr/bin/env bash
# =============================================================================
# GuanWo (观我) — Database Migration Helper Script
# =============================================================================
# Usage:     ./migrate.sh [command] [options]
# Purpose:   Simplified database migration management for solo developer
# Commands:  status, run, backup-run, show, rollback [app_name migration_name]
# Idempotent: status/show are safe; run/backup-run/rollback are DESTRUCTIVE
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
#  CONFIGURATION
# ---------------------------------------------------------------------------
DEPLOY_DIR="${DEPLOY_DIR:-/opt/guanwo}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/docker-compose.yml}"
DJANGO_SERVICE="${DJANGO_SERVICE:-django}"
LOG_FILE="${LOG_FILE:-/var/log/guanwo-migrate.log}"

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
    mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
    echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}
success() { log "${C_GREEN}✓ $*${C_RESET}"; }
error()   { log "${C_RED}✗ ERROR: $*${C_RESET}"; }
warn()    { log "${C_YELLOW}⚠ WARN: $*${C_RESET}"; }
info()    { log "${C_BLUE}ℹ $*${C_RESET}"; }
step()    { log "${C_CYAN}→ $*${C_RESET}"; }

# ---------------------------------------------------------------------------
#  HELPER: Run Django management command in container
# ---------------------------------------------------------------------------
django_cmd() {
    cd "$DEPLOY_DIR"
    docker compose -f "$COMPOSE_FILE" exec -T "$DJANGO_SERVICE" python manage.py "$@"
}

# ---------------------------------------------------------------------------
#  COMMAND: Show pending migration status
# ---------------------------------------------------------------------------
cmd_status() {
    step "Checking migration status..."

    info "Apps with pending migrations:"
    django_cmd showmigrations --plan 2>/dev/null | grep "\[ ]" || info "  (none — all migrations applied)"

    echo ""
    info "All migrations (applied = [X], pending = [ ]):"
    django_cmd showmigrations
}

# ---------------------------------------------------------------------------
#  COMMAND: Run migrations
# ---------------------------------------------------------------------------
cmd_run() {
    step "Running database migrations..."

    info "Planned migrations:"
    django_cmd showmigrations --plan 2>/dev/null | grep "\[ ]" || info "  (none pending)"

    echo ""
    read -r -p "Continue with migration? [y/N]: " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        warn "Migration cancelled by user."
        exit 0
    fi

    info "Applying migrations..."
    django_cmd migrate --noinput "$@"
    success "Migrations applied successfully."

    echo ""
    django_cmd showmigrations
}

# ---------------------------------------------------------------------------
#  COMMAND: Backup first, then run migrations
# ---------------------------------------------------------------------------
cmd_backup_run() {
    step "Creating backup before running migrations..."

    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_dir="${DEPLOY_DIR}/backups"
    local backup_file="${backup_dir}/pre_migration_${timestamp}.sql.gz"

    mkdir -p "$backup_dir"

    info "Backup file: ${backup_file}"

    cd "$DEPLOY_DIR"
    set -a
    # shellcheck source=/dev/null
    source <(grep -v '^#' docker/.env.production | grep -v '^$' | sed 's/^export //')
    set +a

    DB_USER="${DB_USER:-guanwo}"
    DB_NAME="${DB_NAME:-guanwo}"

    if docker compose -f "$COMPOSE_FILE" ps postgres 2>/dev/null | grep -q "running\|Up"; then
        docker compose -f "$COMPOSE_FILE" exec -T postgres \
            pg_dump -h localhost -U "$DB_USER" -d "$DB_NAME" --clean --if-exists \
            | gzip > "$backup_file"
        success "Pre-migration backup created: ${backup_file}"
    else
        warn "PostgreSQL not running. Proceeding without backup."
    fi

    echo ""
    cmd_run "$@"
}

# ---------------------------------------------------------------------------
#  COMMAND: Show migration SQL without running it
# ---------------------------------------------------------------------------
cmd_show() {
    local app_name="${1:-}"
    local migration_name="${2:-}"

    if [[ -z "$app_name" ]]; then
        warn "Usage: show <app_name> [migration_name]"
        warn "Example: show api 0001_initial"
        exit 1
    fi

    if [[ -n "$migration_name" ]]; then
        step "Showing SQL for migration: ${app_name}.${migration_name}"
        django_cmd sqlmigrate "$app_name" "$migration_name"
    else
        step "Showing all migration SQL for app: ${app_name}"
        local pending_migs
        pending_migs=$(django_cmd showmigrations "$app_name" 2>/dev/null | grep "\[ ]" | awk '{print $3}' || true)

        if [[ -z "$pending_migs" ]]; then
            info "No pending migrations for ${app_name}"
        else
            for mig in $pending_migs; do
                step "SQL for ${app_name}.${mig}:"
                django_cmd sqlmigrate "$app_name" "$mig"
                echo ""
            done
        fi
    fi
}

# ---------------------------------------------------------------------------
#  COMMAND: Rollback a specific migration
# ---------------------------------------------------------------------------
cmd_rollback() {
    local app_name="${1:-}"
    local migration_name="${2:-}"

    if [[ -z "$app_name" ]] || [[ -z "$migration_name" ]]; then
        warn "Usage: rollback <app_name> <migration_name>"
        warn "Example: rollback api 0001_initial"
        exit 1
    fi

    step "Creating backup before rollback..."
    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="${DEPLOY_DIR}/backups/pre_rollback_${timestamp}.sql.gz"
    mkdir -p "${DEPLOY_DIR}/backups"

    cd "$DEPLOY_DIR"
    set -a
    # shellcheck source=/dev/null
    source <(grep -v '^#' docker/.env.production | grep -v '^$' | sed 's/^export //')
    set +a

    DB_USER="${DB_USER:-guanwo}"
    DB_NAME="${DB_NAME:-guanwo}"

    docker compose -f "$COMPOSE_FILE" exec -T postgres \
        pg_dump -h localhost -U "$DB_USER" -d "$DB_NAME" --clean --if-exists \
        | gzip > "$backup_file"
    success "Pre-rollback backup: ${backup_file}"

    echo ""
    step "Rolling back ${app_name} to ${migration_name}..."
    warn "This will undo all migrations AFTER ${migration_name} for app '${app_name}'"

    read -r -p "Are you sure? Type 'yes' to continue: " confirm
    if [[ "$confirm" != "yes" ]]; then
        warn "Rollback cancelled."
        exit 0
    fi

    django_cmd migrate "$app_name" "$migration_name"
    success "Rollback completed: ${app_name} → ${migration_name}"

    echo ""
    info "Migration status after rollback:"
    django_cmd showmigrations "$app_name"
}

# ---------------------------------------------------------------------------
#  COMMAND: Handle migration conflicts (merge migrations)
# ---------------------------------------------------------------------------
cmd_merge() {
    local app_name="${1:-}"

    if [[ -z "$app_name" ]]; then
        warn "Usage: merge <app_name>"
        exit 1
    fi

    step "Creating merge migration for: ${app_name}"
    warn "This should only be used when multiple developers created conflicting migrations."

    read -r -p "Create merge migration for ${app_name}? [y/N]: " confirm

    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        django_cmd makemigrations --merge "$app_name"
        success "Merge migration created. Review it before applying:"
        info "Run: ./migrate.sh run ${app_name}"
    fi
}

# ---------------------------------------------------------------------------
#  COMMAND: Fake a migration
# ---------------------------------------------------------------------------
cmd_fake() {
    local app_name="${1:-}"
    local migration_name="${2:-}"

    if [[ -z "$app_name" ]] || [[ -z "$migration_name" ]]; then
        warn "Usage: fake <app_name> <migration_name>"
        exit 1
    fi

    step "Faking migration: ${app_name}.${migration_name}"
    warn "This marks the migration as applied WITHOUT running SQL!"

    read -r -p "Are you sure? Type 'yes' to continue: " confirm

    if [[ "$confirm" == "yes" ]]; then
        django_cmd migrate --fake "$app_name" "$migration_name"
        success "Migration ${app_name}.${migration_name} marked as applied (faked)."
    fi
}

# ---------------------------------------------------------------------------
#  MAIN — Route to subcommand
# ---------------------------------------------------------------------------
main() {
    cd "$DEPLOY_DIR" || exit 1

    if ! docker compose -f "$COMPOSE_FILE" ps postgres 2>/dev/null | grep -q "running\|Up"; then
        warn "PostgreSQL is not running. Starting dependent services..."
        docker compose -f "$COMPOSE_FILE" up -d postgres redis
        sleep 3
    fi

    local command="${1:-status}"
    shift || true

    case "$command" in
        status|st)
            cmd_status
            ;;
        run|r)
            cmd_run "$@"
            ;;
        backup-run|br)
            cmd_backup_run "$@"
            ;;
        show|sql)
            cmd_show "$@"
            ;;
        rollback|rb|down)
            cmd_rollback "$@"
            ;;
        merge|mkmerge)
            cmd_merge "$@"
            ;;
        fake)
            cmd_fake "$@"
            ;;
        help|--help|-h)
            cat <<EOF
Usage: $(basename "$0") <command> [options]

GuanWo Database Migration Helper

Commands:
    status (st)         Show migration status for all apps
    run (r)             Run pending migrations (with confirmation)
    backup-run (br)     Create backup, then run migrations
    show <app> [mig]    Show SQL for a migration (dry-run review)
    rollback <app> <mig>  Rollback app to specific migration
    merge <app>         Create merge migration for conflicts
    fake <app> <mig>    Mark migration as applied without running SQL
    help                Show this help

Examples:
    $(basename "$0") status              # Check all migrations
    $(basename "$0") show api            # Show SQL for pending api migrations
    $(basename "$0") run                 # Run all pending migrations
    $(basename "$0") backup-run          # Backup DB, then run migrations
    $(basename "$0") rollback api 0001   # Rollback api to 0001
EOF
            ;;
        *)
            error "Unknown command: ${command}"
            info "Run '$(basename "$0") help' for usage."
            exit 1
            ;;
    esac
}

main "$@"
