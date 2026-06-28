# =============================================================================
# GuanWo (观我) — Django Backend Docker Image
# =============================================================================
# Multi-stage production build.
#
# Build:
#   docker build -t guanwo-django:latest ./server
#
# Run:
#   docker run -e DJANGO_SETTINGS_MODULE=server.settings \
#              -e DATABASE_URL=postgres://... \
#              -e REDIS_URL=redis://... \
#              -e DEEPSEEK_API_KEY=... \
#              -p 8000:8000 \
#              guanwo-django:latest
# =============================================================================

# ---------------------------------------------------------------------------
# STAGE 1: Build Dependencies
# ---------------------------------------------------------------------------
FROM python:3.13-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    libssl-dev \
    cargo \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY requirements.txt ./

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --upgrade pip setuptools wheel && \
    pip install -r requirements.txt

# ---------------------------------------------------------------------------
# STAGE 2: Runtime Image
# ---------------------------------------------------------------------------
FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH="/app" \
    DJANGO_SETTINGS_MODULE=server.settings

# Install runtime dependencies and create non-root user.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    libssl3 \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r guanwo -g 1000 \
    && useradd -r -g guanwo -u 1000 guanwo \
    && mkdir -p /app /data/static /data/media /tmp/guanwo \
    && chown -R guanwo:guanwo /app /data /tmp/guanwo

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app

# environs.read_env expects a .env file at BASE_DIR.parent (/app).
# Create an empty one so import does not fail in the container.
RUN touch /app/.env && chown guanwo:guanwo /app/.env

COPY --chown=guanwo:guanwo . ./

# Collect static files at build time.
RUN DJANGO_SECRET_KEY=build-time-only-secret \
    DATABASE_URL=sqlite:////tmp/build.db \
    ENVIRONMENT=development \
    python manage.py collectstatic --noinput --clear

USER guanwo

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8000/api/health/ || exit 1

# Run migrations then start Gunicorn with Uvicorn workers on the ASGI app.
CMD ["sh", "-c", "python manage.py migrate --noinput && \
    gunicorn \
    -w ${GUNICORN_WORKERS:-4} \
    -k uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:8000 \
    --timeout ${GUNICORN_TIMEOUT:-300} \
    --keep-alive ${GUNICORN_KEEPALIVE:-5} \
    --max-requests ${GUNICORN_MAX_REQUESTS:-1000} \
    --max-requests-jitter ${GUNICORN_MAX_REQUESTS_JITTER:-100} \
    --access-logfile - \
    --error-logfile - \
    server.asgi:application"]

# ---------------------------------------------------------------------------
# Build Arguments
# ---------------------------------------------------------------------------
ARG APP_VERSION=unknown
ENV APP_VERSION=${APP_VERSION}
