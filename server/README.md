# 观我后端（server/）

一份**地域无关的 Hono 应用**：把前端算好的命盘 JSON 序列化成 prompt，流式中转 DeepSeek，并兜底合规净化 + 限流。无数据库、无账号、无支付——它是一层薄而硬的 AI 中继。

> 为什么不是 Django：排盘引擎在前端（TS），后端只序列化已算好的 `命盘`、共享 `src/engine` 的类型；换 Python 等于重写整个序列化层并制造类型断层。Web 标准（fetch + ReadableStream）让同一份 `app.fetch` 跑遍 Workers / 函数计算 / Node。详见提交记录里的决策。

## 结构

| 文件 | 作用 |
|---|---|
| `app.ts` | 核心：`createApp({apiKey, limiter?})` → Hono 应用，全部 `/api/*` 路由 + 校验 + 限流 + 错误兜底 + 日志 |
| `deepseek.ts` | DeepSeek 流式中继（超时 / 中止 / 合规净化 / 优雅收尾） |
| `compliance.ts` | 合规净化器（红线词流式抹除，跨 chunk 安全） |
| `ratelimit.ts` | `RateLimiter` 接口 + 内存固定窗口实现（多实例需换 KV，见下） |
| `*Prompt.ts` | 各场景 prompt 构造（依赖 `src/engine/aiformat` 做无损序列化） |
| `node.ts` | **生产入口（Node / 阿里云·腾讯云函数计算 / 自建）** + 静态伺服 dist |
| `worker.ts` | **生产入口（Cloudflare Workers）** |
| `vitePlugin.ts` | 开发入口：把 Hono 挂进 Vite dev server，只接管 `/api/*` |

## 路由

全部 `POST`，请求体 JSON，响应 `text/plain` 流式（除 health）。

| 路由 | 入参 | 上限 token |
|---|---|---|
| `/api/reading` | `命盘` | 800 |
| `/api/dream` | `{命盘?, 视角:'传统'|'心理', messages[]}` | 1400 |
| `/api/chat` | `{命盘, 解读?, messages[]}` | 700 |
| `/api/fortune` | `{命盘, 流年}` | 默认 |
| `/api/analyze` | `{命盘, 系统:'八字'|'紫微'}` | 1800 |
| `GET /api/health` | — | 返回 `{ok:true}` |

错误约定：请求体无效 / 命盘畸形 → `400`；请求体 > 96KB → `413`；超频 → `429`（带 `Retry-After`）；未配置 key → `500`；上游非 2xx → `502`；上游超时 / 失败 → `504`。

## 环境变量

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | **必填**。缺失时所有 `/api/*` 返回 500。key 不出服务端、绝不写日志。 |
| `PORT` | 仅 Node 入口，默认 `8787`。 |
| `WECHAT_APPID` / `WECHAT_SECRET` | 微信网页授权。**两者都配才启用微信登录**（否则入口关闭、账号其余功能正常）。secret 只在服务端。回调域名需在微信后台白名单。 |

本地放 `.env`（已 gitignore），dev 由 Vite 的 `loadEnv` 注入；生产由进程环境注入。

## 账号 / 云端同步（本地优先、登录可选）

- **数据层**：Drizzle（Postgres 方言）。dev/prod 当前都用 PGlite（进程内 Postgres，持久化到 `.pgdata`，已 gitignore）。**上量请把 `node.ts` 里的 `createDevDb` 换成注入托管 Postgres**（`drizzle-orm/postgres-js` 连 RDS / Neon），schema 不变。
- **会话**：httpOnly + SameSite=Lax cookie，token 只存 SHA-256 哈希；登录类接口更严限流；写操作校验 Origin。
- **模型**：账号 ≠ 同步。登录只拿身份；同步是登录后**独立 opt-in**（默认关），开启前有明确同意；提供 关闭同步 / 删单盘 / 注销（真删全部，PIPL 删除权）。
- **路由**：`/api/me`、`/api/auth/wechat[/callback]`、`/api/auth/logout`、`/api/auth/dev`（仅 dev）、`/api/charts`(列)、`/api/charts/sync`(双向合并)、`/api/charts/delete`、`/api/account/delete`。AI 接口始终免登录。
- **dev 测试**：`devLogin: true`（vitePlugin 已开）下可 `POST /api/auth/dev` 绕过微信跑通整条链路。

## 运行

```bash
npm run dev        # 开发：Vite + 后端中间件，:5180
npm run typecheck  # tsc 双工程：前端(tsconfig.json) + 后端(tsconfig.server.json)
npm run build      # typecheck && vite build → 产出 dist/
npm start          # 生产（Node）：伺服 dist + /api，:8787（DEEPSEEK_API_KEY=xxx npm start，须从项目根或经 npm 启动）
npm test           # vitest：引擎 + 后端单测 + HTTP 集成测试 + renderRich（38 项）
```

注：`build`/`typecheck` 同时检查 `server/`（经 `tsconfig.server.json`）——后端类型错误会让构建失败，不再静默漏过。静态资源（哈希文件名）永久强缓存、`index.html` 不缓存（发版即时生效）。

Cloudflare Workers：以 `worker.ts` 为入口 `wrangler deploy`，key 用 `wrangler secret put DEEPSEEK_API_KEY`；前端静态走 Pages/assets。

## 部署须知（上线前务必读）

1. **限流靠真实 IP——必须置于可信反向代理之后。**
   限流 key 取自 `cf-connecting-ip` → `x-real-ip` → `x-forwarded-for`（仅兜底，可伪造）。
   自建 Node / 函数计算若**前面没有注入可信 `x-real-ip` 的反代（Nginx/网关/CDN）**，攻击者换 IP 即可绕过限流。Workers 上 `cf-connecting-ip` 平台自动注入，无需额外配置。

2. **多实例 / 无状态扩缩容下，内存限流失效。**
   `memoryRateLimiter` 每实例各持一份计数，`max:20/min` 会被放大成 `20×实例数`。上量前实现一个 KV/Redis 版 `RateLimiter`（接口已隔离在 `ratelimit.ts`，业务码不动），在 `createApp({limiter})` 注入即可。

3. **同源部署，否则需配 CORS。**
   当前无 CORS 头。Node 入口同进程伺服 dist（同源）、Workers 只暴露 `/api`——都同源，OK。
   若改成「海外 Pages + 独立域 Workers」这类**跨域**部署，需在 `createApp` 加 CORS 白名单。

4. **优雅退出已内置（Node 入口）。** 收到 `SIGTERM/SIGINT` 停止收新连接、让在途流式收尾，10s 兜底强退——滚动部署时正在生成的用户最多被延迟 10s 切断。

## 内置防护（已实现，无需额外配置）

- **上游超时**：连接或两次 token 间隔超 45s 即判上游卡死并中止（`deepseek.ts` 空闲超时）。
- **客户端断开 → 中止上游**：用户离开即停止 DeepSeek 流，不白烧 token。
- **请求体硬上限 96KB**：按真实字节流式累计、超限即断（不信任 `content-length`）。
- **合规净化**：红线营销/决定论词在流式输出里就地抹除（跨 chunk 安全），prompt 红线为第一层、此为兜底。
- **可观测**：每请求一行 `[req] 方法 路由 状态 耗时`；上游错误 `[relay] 上游 N: …`；超时 `[relay] …超时`；未捕获异常 `[err] …`（均不含 key）。

## 不在后端范围内（下一阶段）

账号 / 云端命盘持久化 / 支付——属「地域相关、按接口另加」的数据层，建议独立成服务（如 Postgres + 一薄层），与本中继并存，而非塞进来。当前命盘 / 对话 / 缓存都存在前端 localStorage。
