#!/usr/bin/env bash
# =============================================================================
# GuanWo (观我) — Hermes Agent 一键部署脚本
# =============================================================================
# 作用：在全新的 Ubuntu VPS 上自动完成 GuanWo 的生产部署。
# 用法（由 Hermes 代理执行）：
#
#   export DOMAIN=your-domain.com
#   export EMAIL=admin@your-domain.com
#   export DEEPSEEK_API_KEY=sk-...
#   export SERVER_IP=1.2.3.4           # 可选，默认自动探测
#   export WECHAT_APP_ID=...           # 可选
#   export WECHAT_APP_SECRET=...       # 可选
#   export SUPERUSER_USERNAME=admin    # 可选
#   export SUPERUSER_EMAIL=...         # 可选
#   export SUPERUSER_PASSWORD=...      # 可选，不填则随机生成
#   bash docker/scripts/hermes-deploy.sh
#
# 前置条件：
#   - Ubuntu 22.04 LTS 或更新
#   - 以 root 身份运行（或具有 passwordless sudo）
#   - 域名 DNS A 记录已指向该 VPS
#   - 防火墙/安全组已放行 22、80、443
# =============================================================================

set -euo pipefail

# =============================================================================
# 配置（可覆盖）
# =============================================================================
DEPLOY_DIR="${DEPLOY_DIR:-/opt/guanwo}"
REPO_URL="${REPO_URL:-https://github.com/Jhou-xz/GUANWO.git}"
COMPOSE_FILE="${DEPLOY_DIR}/docker/docker-compose.yml"
ENV_FILE="${DEPLOY_DIR}/docker/.env.production"

# =============================================================================
# 颜色输出
# =============================================================================
readonly C_GREEN='\033[0;32m'
readonly C_YELLOW='\033[1;33m'
readonly C_RED='\033[0;31m'
readonly C_BLUE='\033[0;34m'
readonly C_NC='\033[0m'

info()  { echo -e "${C_BLUE}[INFO]${C_NC}  $*"; }
ok()    { echo -e "${C_GREEN}[OK]${C_NC}    $*"; }
warn()  { echo -e "${C_YELLOW}[WARN]${C_NC}  $*"; }
error() { echo -e "${C_RED}[ERROR]${C_NC} $*" >&2; }

# =============================================================================
# 参数校验
# =============================================================================
require_env() {
    local name="$1"
    local value="${!name:-}"
    if [[ -z "$value" ]]; then
        error "缺少必要环境变量: $name"
        exit 1
    fi
}

require_env DOMAIN
require_env EMAIL
require_env DEEPSEEK_API_KEY

if [[ -z "${SERVER_IP:-}" ]]; then
    info "SERVER_IP 未提供，正在自动探测公网 IP..."
    SERVER_IP=$(curl -s -m 10 https://api.ipify.org || curl -s -m 10 https://ifconfig.me || true)
    if [[ -z "$SERVER_IP" ]]; then
        error "无法自动探测 SERVER_IP，请手动设置后重试"
        exit 1
    fi
    ok "探测到公网 IP: $SERVER_IP"
fi

# =============================================================================
# STEP 1: 安装依赖与 Docker
# =============================================================================
info "Step 1/9: 安装系统依赖与 Docker..."

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates openssl ufw cron >/dev/null 2>&1 || {
    error "安装系统依赖失败"
    exit 1
}

if ! command -v docker >/dev/null 2>&1; then
    info "Docker 未安装，正在安装..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker >/dev/null 2>&1
    systemctl start docker
    ok "Docker 安装完成: $(docker --version)"
else
    ok "Docker 已安装: $(docker --version)"
fi

if ! docker compose version >/dev/null 2>&1; then
    error "Docker Compose 插件不可用"
    exit 1
fi
ok "Docker Compose 已就绪: $(docker compose version --short)"

# =============================================================================
# STEP 2: 克隆/更新代码
# =============================================================================
info "Step 2/9: 拉取/更新代码到 ${DEPLOY_DIR}..."

if [[ -d "${DEPLOY_DIR}/.git" ]]; then
    git -C "$DEPLOY_DIR" fetch origin
    git -C "$DEPLOY_DIR" reset --hard origin/main
    ok "代码已更新到最新 main"
else
    git clone --depth 1 "$REPO_URL" "$DEPLOY_DIR"
    ok "代码已克隆到 ${DEPLOY_DIR}"
fi

# =============================================================================
# STEP 3: 生成生产环境变量
# =============================================================================
info "Step 3/9: 生成生产环境变量..."

mkdir -p "${DEPLOY_DIR}/docker"

if [[ ! -f "$ENV_FILE" || "${FORCE_ENV:-0}" == "1" ]]; then
    DJANGO_SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(50))")
    POSTGRES_PASSWORD=$(openssl rand -hex 32)

    SUPERUSER_USERNAME="${SUPERUSER_USERNAME:-admin}"
    SUPERUSER_EMAIL="${SUPERUSER_EMAIL:-admin@${DOMAIN}}"
    if [[ -z "${SUPERUSER_PASSWORD:-}" ]]; then
        SUPERUSER_PASSWORD=$(openssl rand -hex 16)
        GENERATED_ADMIN_PASSWORD=1
    fi

    cat > "$ENV_FILE" <<EOF
ENVIRONMENT=production
DEBUG=False
DJANGO_SECRET_KEY=${DJANGO_SECRET_KEY}
ALLOWED_HOSTS=${DOMAIN},www.${DOMAIN},localhost,127.0.0.1
DJANGO_SETTINGS_MODULE=server.settings
SERVER_IP=${SERVER_IP}
DATABASE_URL=postgres://guanwo:${POSTGRES_PASSWORD}@postgres:5432/guanwo
POSTGRES_DB=guanwo
POSTGRES_USER=guanwo
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
REDIS_URL=redis://redis:6379/0
CSRF_TRUSTED_ORIGINS=https://${DOMAIN},https://www.${DOMAIN}
CORS_ALLOWED_ORIGINS=https://${DOMAIN},https://www.${DOMAIN}
DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}
DEEPSEEK_API_BASE=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
WECHAT_APP_ID=${WECHAT_APP_ID:-}
WECHAT_APP_SECRET=${WECHAT_APP_SECRET:-}
WECHAT_REDIRECT_URI=https://${DOMAIN}/api/auth/wechat/callback/
RATE_LIMIT_ENABLED=True
RATE_LIMIT_ANONYMOUS_DAILY=3
RATE_LIMIT_FREE_DAILY=10
SENTRY_DSN=${SENTRY_DSN:-}
DOMAIN_NAME=${DOMAIN}
CERTBOT_EMAIL=${EMAIL}
DJANGO_SUPERUSER_USERNAME=${SUPERUSER_USERNAME}
DJANGO_SUPERUSER_EMAIL=${SUPERUSER_EMAIL}
DJANGO_SUPERUSER_PASSWORD=${SUPERUSER_PASSWORD}
EOF

    chmod 600 "$ENV_FILE"
    ok "环境变量已写入 ${ENV_FILE}（权限 600）"
else
    ok "已存在 ${ENV_FILE}，跳过生成（如需覆盖请设置 FORCE_ENV=1）"
fi

# =============================================================================
# STEP 4: SSL 证书申请
# =============================================================================
info "Step 4/9: 申请 Let's Encrypt SSL 证书..."

bash "${DEPLOY_DIR}/docker/scripts/init-letsencrypt.sh" "$DOMAIN" "$EMAIL" production

# =============================================================================
# STEP 5: 构建并启动服务
# =============================================================================
info "Step 5/9: 构建并启动 Docker 服务..."

cd "$DEPLOY_DIR"
docker compose -f "$COMPOSE_FILE" up -d --build

# 等待 PostgreSQL 与 Redis 就绪
info "等待数据库与缓存就绪..."
sleep 10

# 最大等待 60 秒
for i in {1..12}; do
    if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U guanwo >/dev/null 2>&1; then
        ok "PostgreSQL 已就绪"
        break
    fi
    sleep 5
    if [[ $i -eq 12 ]]; then
        error "PostgreSQL 未在 60 秒内就绪"
        docker compose -f "$COMPOSE_FILE" logs postgres --tail 50
        exit 1
    fi
done

# =============================================================================
# STEP 6: 数据库迁移与静态文件
# =============================================================================
info "Step 6/9: 执行数据库迁移与收集静态文件..."

docker compose -f "$COMPOSE_FILE" exec -T django python manage.py migrate --noinput
docker compose -f "$COMPOSE_FILE" exec -T django python manage.py collectstatic --noinput --clear

ok "迁移与静态文件处理完成"

# =============================================================================
# STEP 7: 创建管理员账号
# =============================================================================
info "Step 7/9: 创建 Django 超级管理员..."

if docker compose -f "$COMPOSE_FILE" exec -T django python manage.py shell -c "from django.contrib.auth import get_user_model; User = get_user_model(); print(User.objects.filter(username='${SUPERUSER_USERNAME:-admin}').exists())" 2>/dev/null | grep -q "True"; then
    warn "管理员账号已存在，跳过创建"
else
    docker compose -f "$COMPOSE_FILE" exec -T django python manage.py createsuperuser --noinput || {
        warn "自动创建管理员失败，请手动执行 createsuperuser"
    }
fi

# =============================================================================
# STEP 8: 配置防火墙与定时任务
# =============================================================================
info "Step 8/9: 配置 UFW 防火墙与定时任务..."

ufw default deny incoming >/dev/null 2>&1 || true
ufw default allow outgoing >/dev/null 2>&1 || true
ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true
ok "UFW 防火墙已启用（仅开放 22/80/443）"

CRON_FILE="/etc/cron.d/guanwo"
cat > "$CRON_FILE" <<EOF
# GuanWo automated maintenance
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Daily backup at 03:00
0 3 * * * root bash ${DEPLOY_DIR}/docker/scripts/backup.sh >> /var/log/guanwo-backup.log 2>&1

# SSL renewal check twice daily
0 2,14 * * * root bash ${DEPLOY_DIR}/docker/scripts/certbot-renew.sh >> /var/log/guanwo-certbot.log 2>&1
EOF
chmod 644 "$CRON_FILE"
ok "定时任务已写入 ${CRON_FILE}"

# =============================================================================
# STEP 9: 健康检查
# =============================================================================
info "Step 9/9: 执行最终健康检查..."

HEALTH_URL="https://${DOMAIN}/api/health/"
for i in {1..12}; do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
        ok "健康检查通过: ${HEALTH_URL}"
        break
    fi
    sleep 5
    if [[ $i -eq 12 ]]; then
        warn "健康检查未在 60 秒内通过，请查看日志:"
        warn "  docker compose -f ${COMPOSE_FILE} logs django --tail 50"
        warn "  docker compose -f ${COMPOSE_FILE} logs nginx --tail 50"
    fi
done

# =============================================================================
# 部署完成摘要
# =============================================================================
echo ""
echo "==================================================================="
echo "  观我 (GuanWo) 部署完成"
echo "==================================================================="
echo ""
echo "  前端地址:      https://${DOMAIN}/"
echo "  管理后台:      https://${DOMAIN}/admin/"
echo "  API 文档:      https://${DOMAIN}/api/docs"
echo "  健康检查:      https://${DOMAIN}/api/health/"
echo "  部署目录:      ${DEPLOY_DIR}"
echo "  环境变量:      ${ENV_FILE}"
echo "  备份目录:      ${DEPLOY_DIR}/backups"
echo ""
if [[ "${GENERATED_ADMIN_PASSWORD:-0}" == "1" ]]; then
    echo "  管理员账号:    ${SUPERUSER_USERNAME:-admin}"
    echo "  管理员邮箱:    ${SUPERUSER_EMAIL:-admin@${DOMAIN}}"
    echo "  管理员密码:    ${SUPERUSER_PASSWORD}"
    echo "  ⚠️  请登录后尽快修改此随机密码"
    echo ""
fi
echo "  常用命令:"
echo "    cd ${DEPLOY_DIR} && make logs"
echo "    cd ${DEPLOY_DIR} && make restart"
echo "    cd ${DEPLOY_DIR} && make backup"
echo ""
echo "==================================================================="
