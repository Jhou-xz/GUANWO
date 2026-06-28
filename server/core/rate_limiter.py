"""
Redis-based sliding window rate limiter.

Implements a high-performance sliding window counter using Redis Lua scripts
for atomic operations, preventing race conditions under concurrent load.
"""

import hashlib
import logging
import time
from typing import Optional, Tuple

from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger("core.rate_limiter")

# Lua script for atomic increment + expiry check
_SLIDING_WINDOW_LUA = """
local key = KEYS[1]
local now = tonumber(KEYS[2])
local window = tonumber(KEYS[3])
local limit = tonumber(KEYS[4])

local window_start = now - window
redis.call('ZREMRANGEBYSCORE', key, 0, window_start)

local current = redis.call('ZCARD', key)

local allowed = 0
if current < limit then
    allowed = 1
    redis.call('ZADD', key, now, now .. ':' .. redis.call('INCR', key .. ':seq'))
    redis.call('EXPIRE', key, window)
end

local ttl = redis.call('TTL', key)
if ttl < 0 then ttl = window end

return {current + allowed, allowed, ttl}
"""

# Lua script to get current count and reset time without consuming
_GET_COUNT_LUA = """
local key = KEYS[1]
local now = tonumber(KEYS[2])
local window = tonumber(KEYS[3])

local window_start = now - window
redis.call('ZREMRANGEBYSCORE', key, 0, window_start)

local current = redis.call('ZCARD', key)
local ttl = redis.call('TTL', key)
if ttl < 0 then ttl = 0 end

return {current, ttl}
"""


class SlidingWindowRateLimiter:
    """
    Sliding window rate limiter backed by Redis.

    Uses Redis sorted sets (ZSET) to track request timestamps within a
    sliding time window. Lua scripts ensure atomic operations.

    If Redis is unavailable (e.g. development with DummyCache), the limiter
    fails open and allows all requests.
    """

    def __init__(self, redis_client=None):
        self._redis = redis_client
        self._lua_sha: Optional[str] = None
        self._count_lua_sha: Optional[str] = None
        self._scripts_loaded = False

    @property
    def is_redis_available(self) -> bool:
        """Check if the configured Django cache backend is Redis."""
        return hasattr(cache, "client")

    @property
    def _client(self):
        if self._redis is None:
            if not self.is_redis_available:
                raise AttributeError("Cache backend does not support Redis client interface")
            self._redis = cache.client.get_client()
        return self._redis

    def _load_scripts(self) -> None:
        if self._scripts_loaded:
            return
        if not self.is_redis_available:
            return
        try:
            self._lua_sha = self._client.script_load(_SLIDING_WINDOW_LUA)
            self._count_lua_sha = self._client.script_load(_GET_COUNT_LUA)
            self._scripts_loaded = True
        except Exception:
            logger.error("Failed to load rate limiter Lua scripts", exc_info=True)
            self._scripts_loaded = False

    def is_allowed(
        self,
        key: str,
        limit: int,
        window: int,
    ) -> Tuple[bool, int, int]:
        """
        Check if a request is allowed under the rate limit.

        Returns:
            Tuple of (allowed, remaining_requests, retry_after_seconds).
        """
        if not self.is_redis_available:
            return True, limit, 0

        now = int(time.time())

        try:
            self._load_scripts()

            if self._lua_sha:
                result = self._client.evalsha(
                    self._lua_sha,
                    4,
                    key,
                    str(now),
                    str(window),
                    str(limit),
                )
            else:
                result = self._client.eval(
                    _SLIDING_WINDOW_LUA,
                    4,
                    key,
                    str(now),
                    str(window),
                    str(limit),
                )

            count, allowed, ttl = result
            remaining = max(0, limit - count)
            retry_after = 0 if allowed == 1 else ttl

            return bool(allowed), remaining, retry_after

        except Exception as exc:
            logger.error(
                "Rate limiter Redis error",
                extra={"key": key, "limit": limit, "window": window, "error": str(exc)},
            )
            # Fail open: allow the request if Redis is down
            return True, limit, 0

    def get_remaining(self, key: str, limit: int, window: int) -> Tuple[int, int]:
        """Get remaining requests without consuming a slot."""
        if not self.is_redis_available:
            return limit, 0

        now = int(time.time())

        try:
            self._load_scripts()

            if self._count_lua_sha:
                result = self._client.evalsha(
                    self._count_lua_sha,
                    3,
                    key,
                    str(now),
                    str(window),
                )
            else:
                result = self._client.eval(
                    _GET_COUNT_LUA,
                    3,
                    key,
                    str(now),
                    str(window),
                )

            count, ttl = result
            remaining = max(0, limit - count)
            return remaining, ttl

        except Exception as exc:
            logger.error(
                "Rate limiter get_remaining error",
                extra={"key": key, "error": str(exc)},
            )
            return limit, 0

    def reset(self, key: str) -> None:
        """Reset the rate limit counter for a key."""
        if not self.is_redis_available:
            return

        try:
            self._client.delete(key)
            self._client.delete(f"{key}:seq")
        except Exception as exc:
            logger.error("Rate limiter reset error", extra={"key": key, "error": str(exc)})


def get_client_ip(request) -> str:
    """
    Extract the real client IP from a Django request.

    Checks X-Forwarded-For header first (when behind Nginx), then falls
    back to X-Real-IP and REMOTE_ADDR.
    """
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded_for:
        ip = x_forwarded_for.split(",")[0].strip()
    else:
        x_real_ip = request.META.get("HTTP_X_REAL_IP")
        if x_real_ip:
            ip = x_real_ip
        else:
            ip = request.META.get("REMOTE_ADDR", "unknown")

    return ip


def hash_identifier(identifier: str) -> str:
    """Hash an identifier for use in Redis keys."""
    return hashlib.sha256(identifier.encode("utf-8")).hexdigest()[:16]


def build_rate_limit_key(scope: str, identifier: str, window: int) -> str:
    """Build a standardized rate limit key for Redis."""
    hashed = hash_identifier(identifier)
    return f"ratelimit:{scope}:{hashed}:{window}"


_default_limiter: Optional[SlidingWindowRateLimiter] = None


def get_limiter() -> SlidingWindowRateLimiter:
    """Get the singleton rate limiter instance."""
    global _default_limiter
    if _default_limiter is None:
        _default_limiter = SlidingWindowRateLimiter()
    return _default_limiter
