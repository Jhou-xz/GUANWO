# Comprehensive Codebase Report: `ai-suanming-main`

**Location:** `/Users/jiashuhou/Desktop/ai-suanming-main`
**Report generated:** 2026-06-24

---

## 1. Project Overview

**Name:** 观我 (Guān Wǒ / GuanWo) — "AI 命理" (tentative)

**What it does:** A Chinese-language astrology/destiny exploration web app. The core promise is: *"引擎像瑞士钟表一样准，AI 像老朋友一样懂你"* ("The engine is as precise as a Swiss watch; the AI is like an old friend who understands you").

- **MVP scope:** Bazi (八字 / Four Pillars) + Zi Wei Dou Shu (紫微斗数). Qi Zheng Si Yu (七政四余) is planned for v2.
- **Target users:** Young Chinese speakers, "chill", no mysticism.
- **Product form:** Web demo first, with the engine written in TypeScript so it can be reused across platforms.

Core user flow:
1. User inputs birth data.
2. Frontend **chart engine** computes a deterministic "命盘 JSON".
3. Backend AI relay streams an interpretation from DeepSeek.
4. Frontend renders the chart + interpretation, supports follow-up chat, yearly fortune, dream interpretation, and Liu Yao (六爻) hexagrams.

**Important architectural inconsistency:** The README and `server/README.md` describe a **Hono/Node.js backend** (with files like `server/node.ts`, `server/app.ts`, `server/ratelimit.ts`). The *actual* code in `server/` is a **Python/Django + Django-Ninja backend**. Several package scripts and test files reference the non-existent Node backend.

---

## 2. Tech Stack

### Frontend
| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript |
| Build tool | Vite 7 |
| Testing | Vitest 4 |
| UI | Custom CSS (`src/styles.css`, ~1,200 lines), no component library |
| Routing | Minimal manual (`/terms`, `/privacy`) |

### Backend (actual implementation)
| Layer | Technology |
|---|---|
| Runtime | Python 3.13 |
| Framework | Django 5.x + Django-Ninja 1.6 |
| ASGI server | Gunicorn + Uvicorn workers |
| Database | PostgreSQL (via `psycopg2-binary`) / SQLite fallback |
| HTTP client | `httpx` |
| Env loading | `python-dotenv` |

### Backend (documented/planned but not present)
| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 18 |
| Framework | Hono 4 |
| DB ORM | Drizzle ORM |
| Embedded DB dev | PGlite |
| Server | `@hono/node-server` / Cloudflare Workers |

### Astrology Engine (frontend/TypeScript)
| Library | Purpose |
|---|---|
| `lunar-typescript` | Solar/lunar calendar, Bazi pillars, jieqi |
| `iztro` | Zi Wei Dou Shu chart calculation |
| Custom code | Shensha, Dayun, Liunian, Liuyao, solar-time correction, "GuanWo personality" typing |

### External Services
- **DeepSeek API** (`api.deepseek.com`) — streaming chat completions for interpretations.
- **WeChat OAuth** — optional WeChat login.
- **Google Fonts** — loaded from `fonts.googleapis.com`.

---

## 3. Directory Structure

```
ai-suanming-main/
├── .github/workflows/ci.yml       # GitHub Actions CI (Node only)
├── .pgdata/                       # Local PostgreSQL/PGlite data (~38 MB, gitignored but present)
├── design/                        # Third-party design system reference repo (awesome-design-md-main)
├── dist/                          # Vite build output (~1.1 MB)
├── docs/                          # 10 product/architecture/compliance Markdown docs
├── node_modules/                  # npm dependencies (~188 MB)
├── public/                        # favicon.svg only (og-cover.png referenced but missing)
├── server/                        # Python/Django backend
│   ├── api/                       # Django app: models, API, migrations, prompts, DeepSeek relay
│   ├── server/                    # Django project settings, urls, asgi, wsgi
│   ├── .venv/                     # Python virtual env (~83 MB)
│   ├── Dockerfile                 # Python backend image
│   ├── manage.py
│   ├── requirements.txt
│   ├── README.md                  # *Still describes Hono/Node backend*
│   ├── app.test.ts                # Tests for non-existent Hono app
│   ├── auth.test.ts, server.test.ts, wechat.test.ts, db/store.test.ts
│   └── worker.ts                  # CF Workers entry that imports non-existent './app'
├── src/                           # React + engine source
│   ├── components/                # UI components (BaziBoard, ZiweiBoard, Chat, Reading, etc.)
│   ├── engine/                    # Pure-function astrology engine + tests
│   ├── App.tsx                    # Main application shell
│   ├── main.tsx                   # React entry
│   ├── account.ts                 # API client for auth/sync
│   ├── stream.ts                  # Shared streaming fetch helper
│   ├── styles.css                 # Single-file design system (~78 KB)
│   └── ...
├── Dockerfile.frontend            # Multi-stage Node + Nginx build
├── docker-compose.yml             # Postgres + Django backend + Nginx frontend
├── nginx.conf                     # Nginx default config (HTTP, proxies /api → backend)
├── index.html                     # HTML shell with SEO/social meta
├── package.json                   # npm scripts & deps
├── tsconfig.json                  # Frontend TypeScript config (includes only src/)
├── vite.config.ts                 # Vite + dev proxy to localhost:8000
├── vitest.config.ts               # Vitest config (excludes server/**)
├── .env                           # Real env file present but unreadable (sensitive)
└── .env.example                   # Env template
```

---

## 4. Architecture Patterns

**Pattern:** Monolithic full-stack web app, front/back separated by API.

### Key Layers

| Layer | Location | Responsibility |
|---|---|---|
| **Frontend (SPA)** | `src/` | React UI, state management, localStorage persistence, chart visualization, streaming display |
| **Chart Engine** | `src/engine/` | Pure functions: birth input → deterministic 命盘 JSON. Runs entirely in browser. |
| **API Relay** | `server/api/api.py` | Django-Ninja routes for auth, sync, and AI endpoints |
| **AI Relay** | `server/api/deepseek.py` | Streams DeepSeek completions, applies compliance redaction |
| **Prompts** | `server/api/prompts.py` | Builds system prompts and serializes chart JSON into LLM text |
| **Compliance** | `server/api/compliance.py` | Regex-based redaction of forbidden words |
| **Models/Data** | `server/api/models.py` | User accounts, charts |
| **Config** | `server/server/settings.py`, `.env` | Django settings + env vars |

### Data Flow
1. Browser computes chart via `src/engine/index.ts`.
2. Chart JSON is stored in `localStorage` by default.
3. For interpretation, frontend POSTs chart JSON to `/api/reading`.
4. Backend builds prompt from chart, calls DeepSeek streaming API, redacts output, streams text to browser.
5. Optional: user logs in → charts sync to Postgres via `/api/charts/sync`.

### Notable Design Principles
- **Engine/AI isolation:** deterministic engine produces JSON; AI only interprets, never recalculates.
- **Local-first:** charts live in browser localStorage unless user opts into cloud sync.
- **Compliance-first:** prompt-level guardrails + server-side redaction layer.

---

## 5. Key Files and Entry Points

### Frontend
- **Entry:** `/Users/jiashuhou/Desktop/ai-suanming-main/src/main.tsx`
- **App shell:** `/Users/jiashuhou/Desktop/ai-suanming-main/src/App.tsx` (757 lines, handles all views, auth, sync)
- **HTML:** `/Users/jiashuhou/Desktop/ai-suanming-main/index.html`
- **Engine entry:** `/Users/jiashuhou/Desktop/ai-suanming-main/src/engine/index.ts`
- **Types contract:** `/Users/jiashuhou/Desktop/ai-suanming-main/src/engine/types.ts`
- **Streaming client:** `/Users/jiashuhou/Desktop/ai-suanming-main/src/stream.ts`
- **Account API client:** `/Users/jiashuhou/Desktop/ai-suanming-main/src/account.ts`

### Backend
- **Django settings:** `/Users/jiashuhou/Desktop/ai-suanming-main/server/server/settings.py`
- **URL router:** `/Users/jiashuhou/Desktop/ai-suanming-main/server/server/urls.py`
- **API routes:** `/Users/jiashuhou/Desktop/ai-suanming-main/server/api/api.py`
- **Models:** `/Users/jiashuhou/Desktop/ai-suanming-main/server/api/models.py`
- **DeepSeek relay:** `/Users/jiashuhou/Desktop/ai-suanming-main/server/api/deepseek.py`
- **Prompts:** `/Users/jiashuhou/Desktop/ai-suanming-main/server/api/prompts.py`
- **Compliance redactor:** `/Users/jiashuhou/Desktop/ai-suanming-main/server/api/compliance.py`
- **WeChat OAuth:** `/Users/jiashuhou/Desktop/ai-suanming-main/server/api/wechat.py`
- **Migrations:** `/Users/jiashuhou/Desktop/ai-suanming-main/server/api/migrations/0001_initial.py`

### Build/Deploy
- **Frontend Dockerfile:** `/Users/jiashuhou/Desktop/ai-suanming-main/Dockerfile.frontend`
- **Backend Dockerfile:** `/Users/jiashuhou/Desktop/ai-suanming-main/server/Dockerfile`
- **Compose:** `/Users/jiashuhou/Desktop/ai-suanming-main/docker-compose.yml`
- **Nginx config:** `/Users/jiashuhou/Desktop/ai-suanming-main/nginx.conf`
- **CI:** `/Users/jiashuhou/Desktop/ai-suanming-main/.github/workflows/ci.yml`

### API Endpoints (Django-Ninja)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/me` | Current user info |
| POST | `/api/auth/dev` | Dev login bypass |
| POST | `/api/auth/register` | Username/password registration |
| POST | `/api/auth/login` | Username/password login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/wechat` | Initiate WeChat OAuth |
| GET | `/api/auth/wechat/callback` | WeChat OAuth callback |
| POST | `/api/account/delete` | Delete account + data |
| GET | `/api/charts` | List user charts |
| POST | `/api/charts/sync` | Sync charts |
| POST | `/api/charts/delete` | Delete one chart |
| POST | `/api/credits/recharge` | Mock recharge |
| POST | `/api/reading` | Stream Bazi/Ziwei interpretation |
| POST | `/api/chat` | Follow-up chat (requires login + credits) |
| POST | `/api/fortune` | Yearly fortune |
| POST | `/api/analyze` | Deep analysis (Bazi or Ziwei) |
| POST | `/api/dream` | Dream interpretation |
| POST | `/api/liuyao` | Liu Yao hexagram interpretation |

---

## 6. Dependencies and External Services

### Production Dependencies
| Package | Version | Purpose |
|---|---|---|
| `react` / `react-dom` | ^18.3.1 | UI |
| `hono` | ^4.12.25 | *Listed* but unused by current Python backend |
| `@hono/node-server` | ^2.0.5 | *Listed* but unused |
| `drizzle-orm` | ^0.45.2 | *Listed* but unused by current backend |
| `postgres` | ^3.4.9 | *Listed* but unused |
| `@electric-sql/pglite` | ^0.5.3 | *Listed* but unused by current backend |
| `iztro` | ^2.4.4 | Zi Wei engine |
| `lunar-typescript` | ^1.7.3 | Bazi/calendar engine |
| `tsx` | ^4.22.4 | TS execution (for non-existent Node backend) |

### Python Dependencies
| Package | Purpose |
|---|---|
| Django 5.x | Web framework |
| django-ninja | API layer |
| psycopg2-binary | PostgreSQL driver |
| python-dotenv | Env loading |
| httpx | External HTTP calls |
| gunicorn | WSGI/ASGI server |
| uvicorn | ASGI worker |

### External APIs
- **DeepSeek** (`https://api.deepseek.com/chat/completions`) — required for all AI features.
- **WeChat OAuth** (`https://open.weixin.qq.com/...`, `https://api.weixin.qq.com/...`) — optional login.

### Databases
- **PostgreSQL** — intended production database.
- **SQLite** — fallback when `DATABASE_URL` is not set.

---

## 7. Environment / Configuration

### Env vars (from `.env.example` and code)
| Variable | Required? | Used in | Notes |
|---|---|---|---|
| `DEEPSEEK_API_KEY` | Yes | `server/api/api.py` | Missing → AI endpoints return 500 |
| `DATABASE_URL` | Strongly recommended | `server/server/settings.py` | Missing → falls back to SQLite |
| `DJANGO_SECRET_KEY` | Yes | `server/server/settings.py` | Has insecure default in code |
| `DEBUG` | No | `server/server/settings.py` | Defaults to `True` if unset |
| `SESSION_COOKIE_SECURE` | No | `server/server/settings.py` | Defaults to `False` |
| `SECURE_SSL_REDIRECT` | No | `server/server/settings.py` | Defaults to `False` |
| `WECHAT_APPID` | Optional | `server/api/wechat.py` | Both required for WeChat login |
| `WECHAT_SECRET` | Optional | `server/api/wechat.py` | |
| `WECHAT_REDIRECT` | Optional | Not actually used in code | |
| `PORT` | No | Documented for Node, unused by Django | |

### Config Management
- `.env` file at repo root (gitignored, but **exists on disk**).
- `python-dotenv` loads `.env` in `server/server/settings.py`.
- Docker Compose passes env vars into containers.
- Vite dev proxy reads env for local dev.

### Secrets Handling Observations
- `.env` is gitignored (good).
- DeepSeek key is intended to be server-only.
- Django secret key has a hardcoded insecure default.
- WeChat secret is server-only.
- However, `.pgdata/` contains a full PostgreSQL data directory including `pg_hba.conf` and `postgresql.conf` — this should not be committed or deployed.

---

## 8. Build / Deployment Artifacts

### Docker
- **Frontend image:** Multi-stage Node 20 slim → Nginx alpine. Builds `dist/` and serves with custom `nginx.conf`.
- **Backend image:** Python 3.13 slim. Runs migrations then Gunicorn + Uvicorn workers on port 8000.
- **Compose:** Defines `db` (Postgres 15 alpine), `backend` (Django), `frontend` (Nginx). Exposes frontend on port 80.

### npm Scripts
```json
"dev": "vite"                    // frontend dev server :5180, proxies /api to :8000
"typecheck": "tsc --noEmit"      // frontend TS only
"build": "npm run typecheck && vite build"
"preview": "vite preview"
"start": "node --import tsx server/node.ts"  // BROKEN — server/node.ts does not exist
"db:generate": "drizzle-kit generate"        // BROKEN — no drizzle config
"test": "vitest run"             // frontend/engine tests only; server/** excluded
```

### CI/CD
- `.github/workflows/ci.yml`: Runs `npm ci`, `typecheck`, `test`, `build` on Ubuntu with Node 22.
- **Does not test or lint the Python backend.**
- **Does not run Django tests or migrations.**

### Other Artifacts
- `dist/` — pre-built frontend assets present.
- `package-lock.json` — present.
- `vitest.config.ts` — explicitly excludes `server/**`.

---

## 9. Security Observations

### Issues (should be fixed before production)

1. **Insecure Django defaults**
   - `SECRET_KEY` falls back to `'django-insecure-default-key-for-local-dev-123456789'`.
   - `DEBUG` defaults to `True`.
   - `ALLOWED_HOSTS = ['*']` — accepts any Host header.
   - `SESSION_COOKIE_SECURE` defaults to `False`.

2. **Hardcoded credentials in Docker Compose**
   - `POSTGRES_PASSWORD: guanwo_password`
   - `DATABASE_URL=postgres://guanwo_user:guanwo_password@db:5432/guanwo`
   - These are fine for local dev but must be env-driven for any shared environment.

3. **No HTTPS enforcement in containerized setup**
   - Compose exposes HTTP on port 80.
   - `SECURE_SSL_REDIRECT=False`, `SESSION_COOKIE_SECURE=False`.

4. **Django admin exposed**
   - `/admin/` is mounted in `urls.py`. If used, it needs strong auth, IP restriction, and a non-default path.

5. **Rate limiter is in-memory and trusts `X-Forwarded-For`**
   - `api_limiter` is a Python dict; resets on restart; ineffective across multiple backend instances.
   - IP is taken from `HTTP_X_FORWARDED_FOR` without validating a trusted proxy first — spoofable.

6. **No CORS configuration**
   - Currently same-origin (Nginx proxy), but if frontend and backend are ever split across domains, CORS will be needed.

7. **Request body size check is order-dependent**
   - `get_json_body_dict` checks `len(request.body) > 96*1024` **after** Django has already read the full body into memory. Django's `DATA_UPLOAD_MAX_MEMORY_SIZE` should also be set.

8. **Input validation is shallow**
   - Chart JSON is accepted as arbitrary `dict` and passed directly to prompt builders.
   - `Chart.chart_json` stores arbitrary text in the database.

9. **Mock payment endpoint**
   - `/api/credits/recharge` simply adds credits without any real payment verification.

10. **Dead/ broken code that could confuse deployment**
    - `server/node.ts`, `server/app.ts`, `server/ratelimit.ts`, `server/db/schema.ts`, `server/vitePlugin.ts` are referenced but **do not exist**.
    - `package.json` `start` script is broken.
    - `server/worker.ts` imports `./app` which doesn't exist.

### Good Practices Observed

- `.env` is gitignored.
- DeepSeek key is kept server-side.
- Compliance redaction layer for forbidden words (`改运`, `转运`, `消灾`, etc.).
- Prompt-level guardrails against medical/legal/investment advice and fatalism.
- Sessions use `httpOnly` + `SameSite=Lax`.
- Passwords hashed with Django's `make_password`.
- CSRF state used for WeChat OAuth.
- `sync_delete_user_account` wraps deletion in a transaction.
- `input_too_long` helper and 96 KB body limit attempt to bound request sizes.

---

## 10. Deployment Readiness / VPS Recommendations

### Current State: Not Production-Ready

The app can run locally with `docker-compose up`, but several blockers exist for a public VPS deployment.

### Concrete VPS Deployment Plan

#### 1. Fix the Broken Build/Start Scripts
- **Decision needed:** Either finish the Hono/Node backend (matching docs/tests) **or** remove all references to it and commit to the Django backend.
- If keeping Django:
  - Delete or update `server/README.md`.
  - Fix/remove `server/worker.ts`, `server/*.test.ts`.
  - Update `package.json` `start` script to not reference `server/node.ts`.
  - Remove unused Node deps (`hono`, `drizzle-orm`, `postgres`, `@electric-sql/pglite`, `@hono/node-server`, `tsx`) or keep only if needed.
  - Add a `Dockerfile`/`docker-compose` healthcheck and a `start` command for Django.

#### 2. Harden Django
In `server/server/settings.py`:
```python
DEBUG = os.environ.get('DEBUG', 'False').lower() == 'true'
SECRET_KEY = os.environ['DJANGO_SECRET_KEY']  # fail if missing
ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', 'your-domain.com').split(',')
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
DATA_UPLOAD_MAX_MEMORY_SIZE = 96 * 1024
```
- Move `/admin/` to a non-default path or restrict by IP.
- Disable admin if not needed.

#### 3. Use a Real Database
- Use managed Postgres (RDS, Neon, Supabase, self-hosted Postgres on VPS).
- Never ship the `.pgdata/` directory.
- Run migrations as a separate init step, not only inside the running container CMD.
- Enable automated backups and PITR.

#### 4. Reverse Proxy + SSL
- Use **Nginx** or **Caddy** as the edge reverse proxy.
- Terminate TLS with Let's Encrypt (certbot or Caddy's automatic HTTPS).
- Forward only to HTTPS upstream; set `X-Forwarded-Proto: https`.
- Inject a trusted `X-Real-IP` header for rate limiting.

Example Caddyfile:
```caddy
your-domain.com {
    reverse_proxy localhost:80
}
```

Or Nginx:
```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;
    ssl_certificate /etc/letsencrypt/...;
    ssl_certificate_key /etc/letsencrypt/...;

    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### 5. Process Management
- Use **systemd** service units or **Docker Compose with restart policies**.
- For Python: `systemd` running Gunicorn + Uvicorn behind Nginx.
- For Node (if restored): `pm2` or `systemd`.
- Ensure graceful shutdown handling.

#### 6. Rate Limiting
- Replace in-memory limiter with **Redis-backed** sliding window or use a WAF/CDN rate limit.
- If staying in-memory, place backend behind a single-instance constraint or accept the limitation.

#### 7. Secrets Management
- Do not commit `.env`.
- On VPS, use:
  - Docker secrets / Compose env file with `600` permissions.
  - Or a secrets manager (HashiCorp Vault, AWS Secrets Manager, etc.).
- Rotate `DJANGO_SECRET_KEY`, `DEEPSEEK_API_KEY`, `WECHAT_SECRET`.

#### 8. Monitoring & Logging
- Add structured logging (JSON) to Django.
- Monitor:
  - DeepSeek API latency/error rate.
  - 4xx/5xx rates.
  - Rate-limit hits.
  - Disk usage (Postgres).
- Use `prometheus-client` + Grafana, or a hosted APM.

#### 9. Backups
- Daily automated Postgres dumps to object storage (S3, R2, etc.).
- Test restore procedure before going live.

#### 10. CI/CD
- Extend `.github/workflows/ci.yml` to:
  - Run Django tests (`python manage.py test`).
  - Lint Python (`ruff`/`flake8`/`black`).
  - Build and push Docker images.
  - Run DB migration checks.
- Add a separate deploy workflow (SSH + `docker-compose pull && up`, or use a platform).

#### 11. Compliance & Legal
- Host full `/terms` and `/privacy` pages (already in `main.tsx`).
- Add age-gate / minor restriction.
- Get legal review for Chinese regulatory wording.
- Sign DeepSeek DPA and update privacy policy third-party section.

#### 12. Scaling Considerations
- The astrology engine runs in the browser — good, offloads compute.
- Backend is stateless except for in-memory rate limiter. Replace that for horizontal scaling.
- DeepSeek calls are the main bottleneck and cost center; consider:
  - Caching interpretations for identical charts.
  - Token usage alerting.
  - Fallback model if DeepSeek is down.

#### 13. Missing Pieces to Build Before Launch
- Real payment integration (WeChat Pay / Alipay) instead of `/api/credits/recharge` mock.
- Email/password reset flow.
- Input sanitization and chart JSON schema validation.
- Distributed rate limiter.
- Production-ready logging/monitoring.
- Python backend tests and CI integration.
- Resolve Node/Django backend divergence.

---

## Summary

`ai-suanming-main` is a thoughtful, compliance-aware MVP for a Chinese AI astrology product with a solid frontend engine and a clear product vision. However, it is currently in a **transitional/inconsistent state**: the documentation and some tests describe a Hono/Node backend that does not exist, while the working backend is Python/Django. Before deploying to a VPS, the team should resolve this divergence, harden Django configuration, add proper CI for Python, switch to managed Postgres, set up HTTPS/reverse proxy, replace the in-memory rate limiter, and implement real payments and monitoring.
