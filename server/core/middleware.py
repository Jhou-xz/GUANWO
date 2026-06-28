"""
Django middleware for security, rate limiting, request logging, and GuanWo auth.
"""

import hashlib
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Callable, List, Tuple

from django.conf import settings
from django.http import HttpResponse, JsonResponse

from core.rate_limiter import (
    SlidingWindowRateLimiter,
    build_rate_limit_key,
    get_client_ip,
    get_limiter,
)

logger = logging.getLogger("core.request")
ai_logger = logging.getLogger("core.ai")

DEFAULT_RATE_LIMITS = {
    "anon": {"requests": 60, "window": 60},
    "auth": {"requests": 120, "window": 60},
    "ai_anon": {"requests": 5, "window": 60},
    "ai_auth": {"requests": 30, "window": 60},
}

AI_ENDPOINT_PREFIXES = getattr(
    settings,
    "GUANWO_AI_ENDPOINT_PREFIXES",
    ["/api/reading", "/api/dream", "/api/fortune", "/api/analyze", "/api/liuyao", "/api/chat"],
)

SKIP_RATE_LIMIT_PATHS = getattr(
    settings,
    "GUANWO_SKIP_RATE_LIMIT_PATHS",
    ["/api/health", "/api/health/", "/api/health/ready/", "/api/health/live/"],
)

SKIP_LOGGING_PATHS = getattr(
    settings,
    "GUANWO_SKIP_LOGGING_PATHS",
    ["/api/health", "/api/health/", "/api/health/ready/", "/api/health/live/"],
)


def _get_rate_limit_config(scope: str) -> Tuple[int, int]:
    """Get rate limit and window for a given scope from settings."""
    config = getattr(settings, "GUANWO_RATE_LIMITS", DEFAULT_RATE_LIMITS)
    scope_config = config.get(scope, DEFAULT_RATE_LIMITS.get(scope, {"requests": 60, "window": 60}))
    return scope_config["requests"], scope_config["window"]


class GuanWoAuthMiddleware:
    """
    Attach the GuanWo user (from api.User) to request.gw_user.

    The existing api.User model is not a Django AbstractUser, so Django's
    built-in AuthenticationMiddleware cannot attach it. This middleware
    looks up the user by request.session['user_id'] and attaches it as
    request.gw_user. Anonymous requests get gw_user = None.
    """

    def __init__(self, get_response: Callable):
        self.get_response = get_response

    def __call__(self, request):
        request.gw_user = None
        user_id = request.session.get("user_id")
        if user_id:
            try:
                from api.models import User
                request.gw_user = User.objects.get(id=user_id)
            except Exception:
                request.session.flush()
        return self.get_response(request)


class RateLimitMiddleware:
    """
    Per-IP and per-user rate limiting middleware.

    Uses Redis-backed sliding window counters. Different limits apply based on
    authentication status and whether the endpoint is an AI endpoint.
    """

    def __init__(self, get_response: Callable):
        self.get_response = get_response
        self.limiter = get_limiter()
        self.enabled = getattr(settings, "RATE_LIMIT_ENABLED", True)

    def __call__(self, request):
        if not self.enabled or self._should_skip(request):
            return self.get_response(request)

        scope, identifier = self._get_scope_and_identifier(request)
        limit, window = _get_rate_limit_config(scope)
        key = build_rate_limit_key(scope, identifier, window)

        allowed, remaining, retry_after = self.limiter.is_allowed(key, limit, window)

        if not allowed:
            logger.warning(
                "Rate limit exceeded",
                extra={
                    "scope": scope,
                    "identifier": self._hash_id(identifier),
                    "path": request.path,
                    "method": request.method,
                },
            )
            return self._build_rate_limit_response(scope, limit, retry_after)

        response = self.get_response(request)
        response["X-RateLimit-Limit"] = str(limit)
        response["X-RateLimit-Remaining"] = str(remaining)
        response["X-RateLimit-Window"] = str(window)

        return response

    def _should_skip(self, request) -> bool:
        return any(request.path == p or request.path.startswith(p.rstrip("/")) for p in SKIP_RATE_LIMIT_PATHS)

    def _get_scope_and_identifier(self, request) -> Tuple[str, str]:
        is_ai_endpoint = any(
            request.path.startswith(prefix) for prefix in AI_ENDPOINT_PREFIXES
        )

        user = getattr(request, "gw_user", None)
        if user is not None:
            scope = "ai_auth" if is_ai_endpoint else "auth"
            identifier = str(user.id)
        else:
            scope = "ai_anon" if is_ai_endpoint else "anon"
            identifier = get_client_ip(request)

        return scope, identifier

    @staticmethod
    def _hash_id(identifier: str) -> str:
        """Hash an identifier for logging (privacy protection)."""
        return hashlib.sha256(identifier.encode()).hexdigest()[:12]

    def _build_rate_limit_response(
        self, scope: str, limit: int, retry_after: int
    ) -> JsonResponse:
        data = {
            "error": {
                "code": "rate_limit_exceeded",
                "message": f"Too many requests. Please slow down and try again in {retry_after} seconds.",
                "status": 429,
                "details": {
                    "retry_after": retry_after,
                    "scope": scope,
                    "limit": limit,
                },
            }
        }
        response = JsonResponse(data, status=429)
        response["Retry-After"] = str(int(retry_after))
        response["X-RateLimit-Retry-After"] = str(int(retry_after))
        response["X-RateLimit-Limit"] = str(limit)
        response["X-RateLimit-Remaining"] = "0"

        return response


class SecurityHeadersMiddleware:
    """
    Add security headers to all HTTP responses.
    """

    DEFAULT_CSP_DIRECTIVES = {
        "default-src": "'self'",
        "script-src": "'self' 'unsafe-inline'",
        "style-src": "'self' 'unsafe-inline'",
        "img-src": "'self' data: https:",
        "font-src": "'self'",
        "connect-src": "'self'",
        "media-src": "'self'",
        "object-src": "'none'",
        "frame-ancestors": "'none'",
        "base-uri": "'self'",
        "form-action": "'self'",
        "upgrade-insecure-requests": "",
    }

    def __init__(self, get_response: Callable):
        self.get_response = get_response
        self.enabled = getattr(settings, "GUANWO_ENABLE_SECURITY_HEADERS", True)

    def __call__(self, request):
        response = self.get_response(request)

        if not self.enabled:
            return response

        csp = self._build_csp()
        if csp:
            response["Content-Security-Policy"] = csp

        response["X-Content-Type-Options"] = "nosniff"
        response["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response["Permissions-Policy"] = (
            "accelerometer=(), camera=(), geolocation=(), gyroscope=(), "
            "magnetometer=(), microphone=(), payment=(), usb=()"
        )
        response["X-Frame-Options"] = "DENY"
        response["X-XSS-Protection"] = "1; mode=block"

        if getattr(settings, "SECURE_SSL_REDIRECT", False):
            hsts_seconds = getattr(settings, "SECURE_HSTS_SECONDS", 31536000)
            hsts_value = f"max-age={hsts_seconds}"
            if getattr(settings, "SECURE_HSTS_INCLUDE_SUBDOMAINS", False):
                hsts_value += "; includeSubDomains"
            response["Strict-Transport-Security"] = hsts_value

        return response

    def _build_csp(self) -> str:
        directives = dict(self.DEFAULT_CSP_DIRECTIVES)
        custom_directives = getattr(settings, "GUANWO_CSP_DIRECTIVES", {})
        directives.update(custom_directives)

        parts = []
        for directive, value in directives.items():
            if value:
                parts.append(f"{directive} {value}")
            else:
                parts.append(directive)

        return "; ".join(parts)


class RequestLoggingMiddleware:
    """
    JSON structured logging of all HTTP requests with timing information.
    """

    def __init__(self, get_response: Callable):
        self.get_response = get_response
        self.slow_threshold_ms = getattr(
            settings, "GUANWO_SLOW_REQUEST_THRESHOLD_MS", 1000
        )

    def __call__(self, request):
        request.request_id = getattr(
            request, "request_id", uuid.uuid4().hex[:16]
        )

        should_skip = any(request.path == p or request.path.startswith(p.rstrip("/")) for p in SKIP_LOGGING_PATHS)

        start_time = time.time()
        response = self.get_response(request)
        duration_ms = round((time.time() - start_time) * 1000, 2)

        if not should_skip:
            self._log_request(request, response, duration_ms)

        response["X-Request-ID"] = request.request_id

        return response

    def _log_request(self, request, response, duration_ms: float) -> None:
        user = getattr(request, "gw_user", None)
        user_id = str(user.id) if user else "anonymous"

        client_ip = get_client_ip(request)
        hashed_ip = hashlib.sha256(client_ip.encode()).hexdigest()[:16]

        if response.status_code >= 500:
            log_level = "error"
        elif response.status_code >= 400:
            log_level = "warning"
        elif duration_ms > self.slow_threshold_ms:
            log_level = "warning"
        else:
            log_level = "info"

        user_agent = request.META.get("HTTP_USER_AGENT", "")
        if len(user_agent) > 200:
            user_agent = user_agent[:200] + "..."

        query_string = request.META.get("QUERY_STRING", "")
        if len(query_string) > 500:
            query_string = query_string[:500] + "..."

        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": log_level,
            "event": "http_request",
            "request_id": request.request_id,
            "method": request.method,
            "path": request.path,
            "query_string": query_string or None,
            "user_id": user_id,
            "client_ip_hash": hashed_ip,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
            "user_agent": user_agent or None,
            "content_length": response.get("Content-Length"),
            "slow": duration_ms > self.slow_threshold_ms,
        }

        log_entry = {k: v for k, v in log_entry.items() if v is not None}

        if log_level == "error":
            logger.error("HTTP request", extra=log_entry)
        elif log_level == "warning":
            logger.warning("HTTP request", extra=log_entry)
        else:
            logger.info("HTTP request", extra=log_entry)


class RequestIDMiddleware:
    """
    Attach a unique request ID to every incoming request.
    """

    def __init__(self, get_response: Callable):
        self.get_response = get_response

    def __call__(self, request):
        request_id = request.META.get("HTTP_X_REQUEST_ID", "")
        if not request_id:
            request_id = uuid.uuid4().hex[:16]

        request.request_id = request_id

        response = self.get_response(request)
        response["X-Request-ID"] = request_id

        return response
