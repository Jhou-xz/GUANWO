# Hermes Agent 部署指令：观我 (GuanWo)

> 把本仓库 `https://github.com/Jhou-xz/GUANWO` 自动部署到指定 VPS，完成 SSL、数据库、Redis、Nginx、Django 的全套生产环境搭建。

---

## 1. 任务目标

在目标 Ubuntu VPS 上执行一次**无人值守**的 GuanWo 生产部署，最终可通过 `https://<DOMAIN>/` 正常访问前端与 API。

---

## 2. 前置检查（执行前确认）

Hermes 在运行部署脚本前，必须确认以下条件满足；**任一不满足则停止并报告用户**：

1. 目标服务器是 **Ubuntu 22.04 LTS 或更新版本**。
2. 你当前以 **root** 身份运行，或具有 **passwordless sudo**。
3. 域名 `<DOMAIN>` 的 DNS **A 记录** 已指向目标 VPS 的公网 IP。
4. 云服务商安全组 / 防火墙已放行 **TCP 22、80、443**。
5. 已从用户处获取到以下信息：
   - `DOMAIN`：要部署的域名，如 `guanwo.app`
   - `EMAIL`：用于 Let's Encrypt 的邮箱
   - `DEEPSEEK_API_KEY`：DeepSeek API Key
   - `SERVER_IP`：VPS 公网 IP（可选，脚本会自动探测）
   - `WECHAT_APP_ID`、`WECHAT_APP_SECRET`：微信登录（可选）
   - `SUPERUSER_USERNAME`、`SUPERUSER_EMAIL`、`SUPERUSER_PASSWORD`：Django 管理员（可选）

---

## 3. 一键执行命令

在目标 VPS 上执行以下命令（将环境变量替换为真实值）：

```bash
export DOMAIN="your-domain.com"
export EMAIL="admin@your-domain.com"
export DEEPSEEK_API_KEY="sk-your-deepseek-key"
# 可选：
export SERVER_IP="1.2.3.4"
export WECHAT_APP_ID="wx-..."
export WECHAT_APP_SECRET="..."
export SUPERUSER_USERNAME="admin"
export SUPERUSER_EMAIL="admin@your-domain.com"
export SUPERUSER_PASSWORD="your-strong-admin-password"

# 拉取最新部署脚本并执行
curl -fsSL https://raw.githubusercontent.com/Jhou-xz/GUANWO/main/docker/scripts/hermes-deploy.sh \
  -o /tmp/hermes-deploy.sh && bash /tmp/hermes-deploy.sh
```

> 若仓库为私有，或你希望使用本地版本，可改为：
> ```bash
> git clone --depth 1 https://github.com/Jhou-xz/GUANWO.git /opt/guanwo
> cd /opt/guanwo
> bash docker/scripts/hermes-deploy.sh
> ```

---

## 4. 脚本会做什么

脚本 `docker/scripts/hermes-deploy.sh` 会按顺序完成：

| 步骤 | 动作 |
|------|------|
| 1 | 安装 `git`、`curl`、`openssl`、`ufw`、`cron` |
| 2 | 安装 Docker Engine 与 Docker Compose 插件（如尚未安装） |
| 3 | 将代码克隆/更新到 `/opt/guanwo` |
| 4 | 生成 `docker/.env.production`（含随机 Django Secret Key 与数据库密码） |
| 5 | 申请 Let's Encrypt SSL 证书 |
| 6 | 构建并启动 Nginx、Django、PostgreSQL、Redis 容器 |
| 7 | 执行数据库迁移与 `collectstatic` |
| 8 | 创建 Django 超级管理员（如未存在） |
| 9 | 配置 UFW 防火墙（仅开放 22/80/443） |
| 10 | 配置每日备份与 SSL 自动续期定时任务 |
| 11 | 访问 `https://<DOMAIN>/api/health/` 验证服务可用 |

---

## 5. 成功标准

脚本结束时，Hermes 应确认：

```bash
curl -fsS https://<DOMAIN>/api/health/
```

返回 HTTP 200 且 JSON 中 `status` 为 `ok`。

同时浏览器访问 `https://<DOMAIN>/` 应能看到 GuanWo 前端页面，
访问 `https://<DOMAIN>/admin/` 能用脚本输出的管理员账号登录。

---

## 6. 部署后需要人工检查/配置的事项

请把以下结果汇报给用户：

1. **管理员账号**：脚本会自动输出或随机生成。如果是随机生成，提醒用户尽快登录后台修改密码。
2. **环境变量文件**：`/opt/guanwo/docker/.env.production` 已生成并设为 `600` 权限，请勿提交到 Git。
3. **微信登录**：如果用户未提供 `WECHAT_APP_ID/SECRET`，告知其后续可在 `.env.production` 中补充并重启服务。
4. **Sentry**：如需错误追踪，在 `.env.production` 填入 `SENTRY_DSN` 后执行 `cd /opt/guanwo && make restart`。
5. **备份**：每日凌晨 3 点自动备份到 `/opt/guanwo/backups/`，建议用户配置同步到 OSS/S3。

---

## 7. 失败处理与日志

如果部署失败，Hermes 应：

1. **不要重复盲目执行**，先收集日志：
   ```bash
   cd /opt/guanwo
   docker compose -f docker/docker-compose.yml logs django --tail 100
   docker compose -f docker/docker-compose.yml logs nginx --tail 100
   docker compose -f docker/docker-compose.yml logs postgres --tail 50
   ```
2. **常见原因**：
   - `DJANGO_SECRET_KEY` 等环境变量缺失 → 检查 `/opt/guanwo/docker/.env.production`
   - 域名未解析 → DNS A 记录未生效
   - 80 端口未放行 → Certbot 验证失败
   - DeepSeek API Key 未填 → Django 启动失败
3. 将日志关键片段与错误信息整理后汇报给用户，等待进一步指令。

---

## 8. 后续更新指令

当用户需要更新代码时，Hermes 可执行：

```bash
cd /opt/guanwo
bash docker/scripts/deploy.sh
```

该脚本会自动拉取最新代码、备份数据库、构建镜像、迁移并滚动更新。

---

## 9. 常用命令速查

```bash
cd /opt/guanwo

# 查看所有容器状态
docker compose -f docker/docker-compose.yml ps

# 查看日志
make logs
make logs-django
make logs-nginx
make logs-postgres

# 重启
make restart

# 手动备份
make backup

# 进入 Django 容器 shell
docker compose -f docker/docker-compose.yml exec django bash

# 创建额外管理员
docker compose -f docker/docker-compose.yml exec django python manage.py createsuperuser
```
