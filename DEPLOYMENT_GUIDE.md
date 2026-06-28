# 观我 (GuanWo) - 生产部署指南

> **目标**：把现有的 React + Django 命理/占星应用升级到可直接部署在生产 VPS 上的形态，**保留所有前端 UI 与业务功能不变**。

---

## 1. 项目简介

- **前端**：React 18 + TypeScript + Vite（原来的 SPA 完全保留）
- **后端**：Django 5 + Django-Ninja（异步 API）
- **数据库**：PostgreSQL（生产），本地开发可回退到 SQLite
- **缓存/会话/限流**：Redis
- **反向代理 / 静态资源**：Nginx
- **SSL**：Let's Encrypt（Certbot）
- **部署方式**：Docker Compose + 可选 GitHub Actions 自动部署

原来的所有页面、八字/紫微/六爻/解梦/AI 对话、微信登录、点数充值、命盘同步等功能全部保留。

---

## 2. 关键目录结构

```
ai-suanming-main/
├── client/                          # React 前端源码（未改动）
├── dist/                            # Vite 构建产物（部署时生成）
├── server/                          # Django 后端
│   ├── api/                         # 原有 API app（模型、视图、prompts、DeepSeek 透传）
│   ├── core/                        # 新增：中间件、限流、健康检查
│   ├── server/settings.py           # 生产级 settings（env 驱动）
│   └── Dockerfile                   # Django 生产镜像
├── Dockerfile.frontend              # 前端构建镜像（多阶段）
├── docker/
│   ├── docker-compose.yml           # 生产编排
│   ├── docker-compose.override.yml  # 本地开发覆盖
│   ├── .env.example                 # 生产环境变量模板
│   ├── .env.development.example     # 开发环境变量模板
│   ├── nginx/                       # Nginx 配置
│   └── scripts/                     # 部署、备份、SSL、迁移脚本
├── .github/workflows/deploy.yml     # CI/CD
└── Makefile                         # 常用命令 shortcuts
```

---

## 3. 生产架构

```
用户 → DNS → VPS (80/443)
            │
            ▼
        Nginx (SSL 终止、静态文件、限流)
            │
            ├── /api/*  ───────▶ Django + Gunicorn + Uvicorn (ASGI)
            │                        │
            │                        ▼
            │                    PostgreSQL
            │                        │
            │                    Redis (会话 / 缓存 / 限流)
            │
            └── 其它路由 ──────▶ React SPA (index.html)
```

### 安全与稳定性增强

| 层面 | 措施 |
|------|------|
| 网络 | 仅 Nginx 暴露 80/443；数据库、Redis、Django 不暴露 |
| HTTPS | Let's Encrypt 自动证书 + HSTS + OCSP Stapling |
| 限流 | Nginx `limit_req` + Django 滑动窗口限流（Redis） |
| 会话 | Redis 缓存会话，HttpOnly / Secure / SameSite |
| 头部 | CSP、X-Frame-Options、HSTS、Referrer-Policy 等 |
| 日志 | JSON 结构化日志 + 请求 ID 追踪 |
| 监控 | `/api/health/` 综合检查 DB/Redis/DeepSeek；Sentry 可选 |
| 备份 | 每日自动 PostgreSQL 备份 + 可选阿里云 OSS 同步 |
| CI/CD | GitHub Actions 自动测试 + 一键部署 |

---

## 4. 环境变量

生产环境文件位置：`docker/.env.production`

```bash
cp docker/.env.example docker/.env.production
# 然后编辑，填入真实值
```

### 必须填写的变量

| 变量 | 说明 |
|------|------|
| `DJANGO_SECRET_KEY` | `python -c "import secrets; print(secrets.token_urlsafe(50))"` |
| `ALLOWED_HOSTS` | 你的域名，如 `guanwo.app,www.guanwo.app` |
| `SERVER_IP` | VPS 公网 IP |
| `DATABASE_URL` | `postgres://guanwo:密码@postgres:5432/guanwo` |
| `POSTGRES_PASSWORD` | PostgreSQL root 密码 |
| `REDIS_URL` | `redis://redis:6379/0` |
| `DEEPSEEK_API_KEY` | 从 [DeepSeek 平台](https://platform.deepseek.com/) 获取 |
| `CSRF_TRUSTED_ORIGINS` | `https://guanwo.app,https://www.guanwo.app` |
| `CORS_ALLOWED_ORIGINS` | 同上 |
| `DOMAIN_NAME` | 主域名，用于 SSL |
| `CERTBOT_EMAIL` | Let's Encrypt 通知邮箱 |

### 可选变量

| 变量 | 说明 |
|------|------|
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | 微信登录 |
| `SENTRY_DSN` | 错误追踪 |
| `RATE_LIMIT_*` | 限流配额，默认一般够用 |

---

## 5. 首次部署（推荐：自动脚本）

### 5.1 准备 VPS

- 系统：Ubuntu 22.04 LTS 或更新
- 配置：建议 **2 vCPU / 4 GB 内存 / 40 GB SSD**
- 域名 DNS A 记录指向 VPS IP
- 防火墙放行 22、80、443

### 5.2 把代码放到 VPS

```bash
# 在本地或 VPS 上克隆项目
ssh root@YOUR_VPS_IP
git clone https://github.com/YOUR_NAME/guanwo.git /opt/guanwo
cd /opt/guanwo
```

### 5.3 运行一键初始化脚本

```bash
bash docker/scripts/setup-vps.sh
```

脚本会依次完成：

1. 更新系统、换阿里云源（可选）
2. 安装 Docker + Docker Compose
3. 创建部署用户 `guanwo`
4. 复制 `docker/.env.production` 并生成随机密钥和数据库密码
5. 申请 Let's Encrypt SSL 证书
6. 配置 UFW 防火墙
7. 构建并启动所有服务
8. 创建定时任务（备份、SSL 续期、清理）
9. 配置日志轮转

运行过程中会提示输入 DeepSeek API Key、微信 AppID/Secret 等信息，也可以后续再编辑 `docker/.env.production`。

### 5.4 创建超级管理员

```bash
cd /opt/guanwo
docker compose -f docker/docker-compose.yml exec django python manage.py createsuperuser
```

后台地址：`https://你的域名/admin/`

---

## 6. 后续更新部署

### 6.1 手动更新

```bash
cd /opt/guanwo
bash docker/scripts/deploy.sh
```

脚本会自动：拉代码 → 备份数据库 → 构建镜像 → 迁移 → 收集静态文件 → 健康检查 → 失败自动回滚。

### 6.2 使用 Makefile

```bash
# 启动
make up

# 查看日志
make logs
make logs-django

# 手动迁移 / 收集静态文件
make migrate
make static

# 备份
make backup

# 重启 / 停止
make restart
make down

# 开发模式
make up-dev
```

### 6.3 GitHub Actions 自动部署

仓库已包含 `.github/workflows/deploy.yml`。

需要在 GitHub 仓库设置 **Secrets**（Settings → Secrets and variables → Actions）：

| Secret | 含义 |
|--------|------|
| `SSH_PRIVATE_KEY` | 部署到 VPS 的 SSH 私钥 |
| `SERVER_IP` | VPS 公网 IP |
| `SERVER_USER` | 部署用户名（如 `guanwo`） |
| `DOMAIN` | 域名 |
| `SLACK_WEBHOOK` | 可选，部署通知 |

配置好后，每次 `git push` 到 `main` 分支都会自动跑测试并部署。

---

## 7. 本地开发

```bash
cd ai-suanming-main

# 1. 准备开发环境变量
cp docker/.env.development.example docker/.env.development

# 2. 启动数据库、Redis、Nginx、Django（带热重载）
make up-dev

# 3. 单独启动前端热重载（可选）
npm install
npm run dev
```

开发端口映射：

| 服务 | 地址 |
|------|------|
| 前端（通过 Nginx） | http://localhost:8080 |
| Django 直连 | http://localhost:8000 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

本地 `RATE_LIMIT_ENABLED=False`，不会触发限流，方便调试。

---

## 8. 健康检查与监控

| 端点 | 用途 |
|------|------|
| `https://你的域名/api/health/` | 综合状态：DB、Redis、DeepSeek |
| `https://你的域名/api/health/live/` | K8s 风格存活探针 |
| `https://你的域名/api/health/ready/` | K8s 风格就绪探针 |

生产 Nginx 与 Django 容器都配置了 healthcheck。

如果配置了 `SENTRY_DSN`，所有 ERROR 级别日志会自动上报到 Sentry。

---

## 9. 备份与恢复

### 自动备份

每天凌晨 3 点自动备份 PostgreSQL，保留 7 天：

```bash
# 手动验证
bash docker/scripts/backup.sh
```

备份文件：`/opt/guanwo/backups/guanwo_YYYYMMDD_HHMMSS.sql.gz`

### 恢复数据库

```bash
cd /opt/guanwo
# 先停止应用，防止写入
make down

# 恢复（会覆盖当前数据库）
gunzip < backups/guanwo_20260115_030000.sql.gz | \
  docker compose -f docker/docker-compose.yml exec -T postgres \
  psql -U guanwo -d guanwo

make up
```

---

## 10. SSL 证书管理

首次申请：

```bash
bash docker/scripts/init-letsencrypt.sh your-domain.com admin@your-domain.com production
```

测试环境（避免触发 Let's Encrypt 速率限制）：

```bash
bash docker/scripts/init-letsencrypt.sh your-domain.com admin@your-domain.com staging
```

自动续期已通过 cron 配置好，每天两次检查：

```bash
bash docker/scripts/certbot-renew.sh
```

---

## 11. 常见问题排查

### 容器启动后 `django` 健康检查失败

```bash
make logs-django
```

常见原因：
- `DJANGO_SECRET_KEY` 未设置或使用了占位符
- `DEEPSEEK_API_KEY` 未设置
- `DATABASE_URL` 或 `REDIS_URL` 错误
- PostgreSQL/Redis 还没准备好

### Nginx 报 502

```bash
make logs-nginx
make ps
```

通常是 Django 容器没有通过 healthcheck，检查上面列出的原因。

### SSL 证书申请失败

- 确认域名 DNS A 记录已指向 VPS
- 确认防火墙/安全组放行 80 端口
- 确认没有其它服务占用 80 端口

### 限流导致正常用户被拦

```bash
# 查看当前限流配置
docker compose -f docker/docker-compose.yml exec django python manage.py shell -c \
  "from django.conf import settings; print(settings.RATE_LIMIT_ANONYMOUS_DAILY, settings.RATE_LIMIT_FREE_DAILY)"
```

可调高 `RATE_LIMIT_*` 值或临时把 `RATE_LIMIT_ENABLED=False`（仅调试）。

---

## 12. 安全清单

- [ ] `docker/.env.production` 权限为 `600`，且未提交到 Git
- [ ] `DJANGO_SECRET_KEY` 是随机生成的强密钥
- [ ] `DEBUG=False`
- [ ] `ALLOWED_HOSTS` 只包含你的域名
- [ ] 已配置 HTTPS 并启用 HSTS
- [ ] 已配置 Sentry 或至少定期查看日志
- [ ] 已配置每日备份并验证恢复流程
- [ ] 已修改默认管理员密码
- [ ] VPS 防火墙只开放 22/80/443

---

## 13. 升级说明

本次改造没有重写任何业务逻辑，改动集中在：

1. `server/server/settings.py` - 生产级、env 驱动、安全头部、日志、Sentry
2. `server/core/` - 新增限流、安全头部、请求日志、请求 ID、健康检查中间件
3. `server/api/api.py` / `deepseek.py` / `guard.py` / `quota.py` - 接入限流、配额、AI 内容合规
4. `docker/`、`Dockerfile.frontend`、`server/Dockerfile` - 容器化生产部署
5. `.github/workflows/deploy.yml` - CI/CD
6. `package.json` - 清理已废弃的 Node 后端依赖

前端源码（`client/`、`index.html`、Vite 配置等）保持原样。

---

## 14. 技术支持/扩展阅读

- [Django 部署检查清单](https://docs.djangoproject.com/en/5.1/howto/deployment/checklist/)
- [Docker Compose 生产最佳实践](https://docs.docker.com/compose/production/)
- [Let's Encrypt 文档](https://letsencrypt.org/docs/)
- [DeepSeek API 文档](https://platform.deepseek.com/api-docs/)
