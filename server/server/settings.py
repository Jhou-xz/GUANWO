"""
GuanWo (观我) - Django Settings
================================
Production-hardened settings that preserve the existing api app and auth model.

The existing User model (api.User) is a plain Django model, not AbstractUser.
Authentication is handled via session['user_id'] in api/api.py.
This settings file supports both development (SQLite, no Redis) and production
(PostgreSQL, Redis, HTTPS) via environment variables.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import List

from environs import Env

# ---------------------------------------------------------------------------
# Build Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
env = Env()
env.read_env(os.path.join(BASE_DIR.parent, ".env"))

ENVIRONMENT = env.str("ENVIRONMENT", default="development").lower()
IS_PRODUCTION = ENVIRONMENT == "production"

# ---------------------------------------------------------------------------
# Core Django Settings
# ---------------------------------------------------------------------------
ROOT_URLCONF = "server.urls"
WSGI_APPLICATION = "server.wsgi.application"
ASGI_APPLICATION = "server.asgi.application"

# Secret key — required in production, fallback in development
SECRET_KEY = env.str(
    "DJANGO_SECRET_KEY",
    default="django-insecure-dev-key-change-me-in-production-12345",
)

# Debug is forced False in production; controlled by env in development
DEBUG = False if IS_PRODUCTION else env.bool("DEBUG", default=True)

# Allowed hosts from environment; development allows all
ALLOWED_HOSTS: List[str] = env.list(
    "ALLOWED_HOSTS",
    default=[] if IS_PRODUCTION else ["*"],
)
if IS_PRODUCTION:
    # Always include container hostnames for internal health checks
    ALLOWED_HOSTS.extend(["django", "localhost", "127.0.0.1"])
    server_ip = env.str("SERVER_IP", default=None)
    if server_ip:
        ALLOWED_HOSTS.append(server_ip)

# ---------------------------------------------------------------------------
# Installed Applications
# ---------------------------------------------------------------------------
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "ninja",
    "corsheaders",
    "core.apps.CoreConfig",
    "api.apps.ApiConfig",
]

# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "core.middleware.RequestIDMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "core.middleware.GuanWoAuthMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "core.middleware.SecurityHeadersMiddleware",
    "core.middleware.RequestLoggingMiddleware",
    "core.middleware.RateLimitMiddleware",
]

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
DATABASE_URL = env.str("DATABASE_URL", default=None)

if DATABASE_URL:
    DATABASES = {
        "default": {
            **env.dj_db_url("DATABASE_URL"),
            "CONN_MAX_AGE": env.int("DB_CONN_MAX_AGE", default=60),
            "CONN_HEALTH_CHECKS": True,
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

# ---------------------------------------------------------------------------
# Cache & Sessions (Redis when available)
# ---------------------------------------------------------------------------
REDIS_URL = env.str("REDIS_URL", default=None)

if REDIS_URL:
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": REDIS_URL,
            "OPTIONS": {
                "CLIENT_CLASS": "django_redis.client.DefaultClient",
                "SOCKET_CONNECT_TIMEOUT": 5,
                "SOCKET_TIMEOUT": 5,
                "CONNECTION_POOL_KWARGS": {"max_connections": 100},
                "RETRY_ON_TIMEOUT": False,
            },
            "KEY_PREFIX": env.str("CACHE_KEY_PREFIX", default="guanwo"),
        }
    }
    SESSION_ENGINE = "django.contrib.sessions.backends.cache"
    SESSION_CACHE_ALIAS = "default"
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.dummy.DummyCache",
        }
    }
    SESSION_ENGINE = "django.contrib.sessions.backends.db"

# Session cookie settings
SESSION_COOKIE_NAME = "gw_sess"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 30 * 86400  # 30 days
SESSION_COOKIE_SECURE = env.bool("SESSION_COOKIE_SECURE", default=IS_PRODUCTION)

# ---------------------------------------------------------------------------
# CSRF / CORS
# ---------------------------------------------------------------------------
CSRF_COOKIE_NAME = "gw_csrftoken"
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = env.bool("CSRF_COOKIE_SECURE", default=IS_PRODUCTION)
CSRF_TRUSTED_ORIGINS: List[str] = env.list(
    "CSRF_TRUSTED_ORIGINS",
    default=["https://guanwo.app", "https://www.guanwo.app"] if IS_PRODUCTION else [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:8000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8000",
    ],
)

if IS_PRODUCTION:
    server_ip = env.str("SERVER_IP", default=None)
    if server_ip:
        CSRF_TRUSTED_ORIGINS.append(f"https://{server_ip}")

CORS_ALLOWED_ORIGINS: List[str] = env.list(
    "CORS_ALLOWED_ORIGINS",
    default=["https://guanwo.app", "https://www.guanwo.app"] if IS_PRODUCTION else [],
)
if not IS_PRODUCTION:
    CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = [
    "accept",
    "accept-encoding",
    "authorization",
    "content-type",
    "dnt",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
    "x-request-id",
]

# ---------------------------------------------------------------------------
# Security Headers
# ---------------------------------------------------------------------------
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True
X_FRAME_OPTIONS = "DENY"

SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=False)
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=31536000 if IS_PRODUCTION else 0)
SECURE_HSTS_INCLUDE_SUBDOMAINS = IS_PRODUCTION
SECURE_HSTS_PRELOAD = IS_PRODUCTION

USE_X_FORWARDED_HOST = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
NUMBER_OF_PROXIES = env.int("NUMBER_OF_PROXIES", default=1)

# ---------------------------------------------------------------------------
# Static & Media Files
# ---------------------------------------------------------------------------
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ---------------------------------------------------------------------------
# Internationalization
# ---------------------------------------------------------------------------
LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "Asia/Shanghai"
USE_I18N = True
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------------------------------------------------------------------------
# Password Validators (used by admin staff accounts only)
# ---------------------------------------------------------------------------
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ---------------------------------------------------------------------------
# Logging — Structured JSON to stdout
# ---------------------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "()": "pythonjsonlogger.jsonlogger.JsonFormatter",
            "format": (
                "%(asctime)s %(levelname)s %(name)s %(message)s "
                "%(pathname)s %(lineno)d %(funcName)s"
            ),
        },
        "simple": {
            "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json" if IS_PRODUCTION else "simple",
            "stream": "ext://sys.stdout",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO" if IS_PRODUCTION else "DEBUG",
    },
    "loggers": {
        "django.request": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
        "django.db.backends": {
            "handlers": ["console"],
            "level": "WARNING" if IS_PRODUCTION else "DEBUG",
            "propagate": False,
        },
        "api": {
            "handlers": ["console"],
            "level": "INFO" if IS_PRODUCTION else "DEBUG",
            "propagate": False,
        },
        "core": {
            "handlers": ["console"],
            "level": "INFO" if IS_PRODUCTION else "DEBUG",
            "propagate": False,
        },
    },
}

# ---------------------------------------------------------------------------
# Request Body Limits
# ---------------------------------------------------------------------------
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024  # 10 MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024   # 5 MB

# ---------------------------------------------------------------------------
# External Services
# ---------------------------------------------------------------------------
DEEPSEEK_API_KEY = env.str("DEEPSEEK_API_KEY", default=None)
DEEPSEEK_API_BASE = env.str("DEEPSEEK_API_BASE", default="https://api.deepseek.com/v1")
DEEPSEEK_MODEL = env.str("DEEPSEEK_MODEL", default="deepseek-chat")
DEEPSEEK_MAX_TOKENS = env.int("DEEPSEEK_MAX_TOKENS", default=2048)
DEEPSEEK_TIMEOUT = env.float("DEEPSEEK_TIMEOUT", default=60.0)

WECHAT_APP_ID = env.str("WECHAT_APP_ID", default=None)
WECHAT_APP_SECRET = env.str("WECHAT_APP_SECRET", default=None)
WECHAT_REDIRECT_URI = env.str(
    "WECHAT_REDIRECT_URI",
    default="https://guanwo.app/api/auth/wechat/callback/",
)

# ---------------------------------------------------------------------------
# Rate Limiting & Quota
# ---------------------------------------------------------------------------
RATE_LIMIT_ENABLED = env.bool("RATE_LIMIT_ENABLED", default=True)
RATE_LIMIT_GENERAL_RPM = env.int("RATE_LIMIT_GENERAL_RPM", default=60)
RATE_LIMIT_AI_RPM = env.int("RATE_LIMIT_AI_RPM", default=10)
RATE_LIMIT_ANONYMOUS_DAILY = env.int("RATE_LIMIT_ANONYMOUS_DAILY", default=3)
RATE_LIMIT_FREE_DAILY = env.int("RATE_LIMIT_FREE_DAILY", default=10)
RATE_LIMIT_PREMIUM_DAILY = env.int("RATE_LIMIT_PREMIUM_DAILY", default=10000)

# ---------------------------------------------------------------------------
# Sentry
# ---------------------------------------------------------------------------
SENTRY_DSN = env.str("SENTRY_DSN", default=None)
APP_VERSION = env.str("APP_VERSION", default="0.1.0")

if SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.django import DjangoIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        release=APP_VERSION,
        environment=ENVIRONMENT,
        integrations=[
            DjangoIntegration(
                middleware_spans=True,
                signals_spans=False,
                http_methods_to_capture=["GET", "POST", "PUT", "DELETE"],
            ),
            LoggingIntegration(level="INFO", event_level="ERROR"),
        ],
        traces_sample_rate=env.float("SENTRY_TRACES_SAMPLE_RATE", default=0.1),
        profiles_sample_rate=env.float("SENTRY_PROFILES_SAMPLE_RATE", default=0.05),
        send_default_pii=True,
        before_send=lambda event, hint: _sentry_sanitize(event),
    )


def _sentry_sanitize(event):
    if "request" in event and "data" in event["request"]:
        data = event["request"]["data"]
        if isinstance(data, dict):
            for key in ["password", "token", "secret", "api_key", "apikey", "key"]:
                if key in data:
                    data[key] = "[REDACTED]"
    return event


# ---------------------------------------------------------------------------
# Admin / Email
# ---------------------------------------------------------------------------
ADMINS = env.list("ADMINS", default=[])
MANAGERS = ADMINS
EMAIL_BACKEND = env.str(
    "EMAIL_BACKEND",
    default="django.core.mail.backends.console.EmailBackend",
)
DEFAULT_FROM_EMAIL = env.str("DEFAULT_FROM_EMAIL", default="noreply@guanwo.app")
SERVER_EMAIL = env.str("SERVER_EMAIL", default="errors@guanwo.app")

# ---------------------------------------------------------------------------
# Production Safety Checks
# ---------------------------------------------------------------------------
if IS_PRODUCTION:
    if not SECRET_KEY or SECRET_KEY.startswith("django-insecure") or SECRET_KEY.startswith("change-me"):
        raise RuntimeError(
            "FATAL: DJANGO_SECRET_KEY is not set or uses the default placeholder. "
            "Set a strong secret key via the DJANGO_SECRET_KEY environment variable."
        )

    if not DEEPSEEK_API_KEY:
        raise RuntimeError(
            "FATAL: DEEPSEEK_API_KEY is not set. "
            "Set it via the DEEPSEEK_API_KEY environment variable."
        )
