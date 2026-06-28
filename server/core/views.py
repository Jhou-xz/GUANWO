"""
Health check endpoints.
"""

import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Dict

import httpx
from django.conf import settings
from django.db import DatabaseError, connection
from django.http import JsonResponse
from ninja import Router

from core.rate_limiter import SlidingWindowRateLimiter

logger = logging.getLogger("core.health")

_START_TIME = time.time()

router = Router(tags=["Core"])


async def _check_database() -> Dict[str, str]:
    """Check PostgreSQL/SQLite connectivity."""
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _db_check_sync)
        return result
    except Exception as exc:
        logger.error("Database health check failed", exc_info=True)
        return {"status": "error", "error": str(exc)}


def _db_check_sync() -> Dict[str, str]:
    """Synchronous DB check running in its own connection and closing it."""
    from django.db import connections

    try:
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT 1")
            row = cursor.fetchone()
            if row and row[0] == 1:
                result = {"status": "ok"}
            else:
                result = {"status": "error", "error": "Unexpected query result"}
    except DatabaseError as exc:
        result = {"status": "error", "error": str(exc)}
    finally:
        connections["default"].close()

    return result


async def _check_redis() -> Dict[str, str]:
    """Check Redis connectivity."""
    try:
        limiter = SlidingWindowRateLimiter()
        pong = await asyncio.get_event_loop().run_in_executor(
            None, _redis_ping_sync, limiter
        )
        if pong:
            return {"status": "ok"}
        return {"status": "error", "error": "Redis ping returned unexpected result"}
    except Exception as exc:
        logger.error("Redis health check failed", exc_info=True)
        return {"status": "error", "error": str(exc)}


def _redis_ping_sync(limiter: SlidingWindowRateLimiter):
    """Synchronous Redis ping to run in executor."""
    try:
        return limiter._client.ping()
    except Exception:
        client = limiter._client
        return client.ping()


async def _check_deepseek() -> Dict[str, str]:
    """Check DeepSeek API connectivity with a lightweight probe."""
    api_key = getattr(settings, "DEEPSEEK_API_KEY", None)
    if not api_key:
        return {"status": "error", "error": "DEEPSEEK_API_KEY not configured"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://api.deepseek.com/models",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Accept": "application/json",
                },
            )
            if response.status_code == 200:
                data = response.json()
                if "data" in data and len(data["data"]) > 0:
                    return {"status": "ok"}
                return {"status": "error", "error": "Invalid API response structure"}
            elif response.status_code == 401:
                return {"status": "error", "error": "Invalid API key"}
            else:
                return {
                    "status": "error",
                    "error": f"HTTP {response.status_code}: {response.text[:200]}",
                }
    except httpx.TimeoutException:
        return {"status": "error", "error": "Request timed out after 10s"}
    except httpx.ConnectError as exc:
        return {"status": "error", "error": f"Connection failed: {str(exc)}"}
    except Exception as exc:
        logger.error("DeepSeek health check failed", exc_info=True)
        return {"status": "error", "error": str(exc)}


def _get_git_commit() -> str:
    """Get the current git commit hash."""
    commit = os.environ.get("GIT_COMMIT", "")
    if commit:
        return commit[:8]

    try:
        git_dir = os.path.join(settings.BASE_DIR, ".git")
        head_file = os.path.join(git_dir, "HEAD")
        if os.path.exists(head_file):
            with open(head_file, "r") as f:
                ref = f.read().strip()
                if ref.startswith("ref:"):
                    ref_path = ref.split(" ")[1]
                    ref_file = os.path.join(git_dir, ref_path)
                    if os.path.exists(ref_file):
                        with open(ref_file, "r") as rf:
                            return rf.read().strip()[:8]
                else:
                    return ref[:8]
    except Exception:
        pass

    return "unknown"


def _format_uptime(seconds: int) -> str:
    """Format uptime seconds into a human-readable string."""
    days, remainder = divmod(seconds, 86400)
    hours, remainder = divmod(remainder, 3600)
    minutes, _ = divmod(remainder, 60)

    parts = []
    if days > 0:
        parts.append(f"{days}d")
    if hours > 0:
        parts.append(f"{hours}h")
    if minutes > 0:
        parts.append(f"{minutes}m")

    return " ".join(parts) if parts else "0m"


@router.get("/health/", auth=None, summary="Health Check")
async def health_check(request):
    """
    Comprehensive health check endpoint.

    Verifies connectivity to PostgreSQL, Redis, and DeepSeek API.
    """
    start_time = time.time()

    db_result, redis_result, deepseek_result = await asyncio.gather(
        _check_database(),
        _check_redis(),
        _check_deepseek(),
        return_exceptions=True,
    )

    if isinstance(db_result, BaseException):
        db_result = {"status": "error", "error": str(db_result)}
    if isinstance(redis_result, BaseException):
        redis_result = {"status": "error", "error": str(redis_result)}
    if isinstance(deepseek_result, BaseException):
        deepseek_result = {"status": "error", "error": str(deepseek_result)}

    services = {
        "database": db_result,
        "redis": redis_result,
        "deepseek_api": deepseek_result,
    }

    critical_services = ["database", "redis"]
    critical_ok = all(services[s]["status"] == "ok" for s in critical_services)

    overall_status = "ok" if critical_ok else "error"

    uptime_seconds = int(time.time() - _START_TIME)
    check_duration_ms = round((time.time() - start_time) * 1000, 2)

    version = getattr(settings, "APP_VERSION", "0.0.0")

    response_data = {
        "status": overall_status,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "version": version,
        "git_commit": _get_git_commit(),
        "uptime_seconds": uptime_seconds,
        "uptime_human": _format_uptime(uptime_seconds),
        "services": services,
        "check_duration_ms": check_duration_ms,
    }

    status_code = 200 if overall_status == "ok" else 503

    return JsonResponse(response_data, status=status_code)


@router.get("/health/ready/", auth=None, summary="Readiness Probe")
async def readiness_probe(request):
    """Kubernetes-style readiness probe."""
    db_ok = (await _check_database()).get("status") == "ok"
    redis_ok = (await _check_redis()).get("status") == "ok"

    if db_ok and redis_ok:
        return JsonResponse({"ready": True})
    return JsonResponse({"ready": False}, status=503)


@router.get("/health/live/", auth=None, summary="Liveness Probe")
async def liveness_probe(request):
    """Kubernetes-style liveness probe."""
    return JsonResponse({"alive": True})
