"""
AI usage quota management system.

Tracks daily AI request quotas per user/IP using Redis.
Supports anonymous and authenticated tiers.
"""

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Dict, Optional, Tuple

from django.conf import settings

from core.rate_limiter import get_client_ip, hash_identifier

logger = logging.getLogger("api.quota")

DEFAULT_ANON_QUOTA = 3
DEFAULT_FREE_USER_QUOTA = 10
DEFAULT_PREMIUM_QUOTA = -1  # -1 means unlimited

QUOTA_KEY_PREFIX = "quota"


def _get_quota_config() -> Dict[str, int]:
    return {
        "anon": getattr(settings, "RATE_LIMIT_ANONYMOUS_DAILY", DEFAULT_ANON_QUOTA),
        "free": getattr(settings, "RATE_LIMIT_FREE_DAILY", DEFAULT_FREE_USER_QUOTA),
        "premium": getattr(settings, "RATE_LIMIT_PREMIUM_DAILY", DEFAULT_PREMIUM_QUOTA),
    }


def _get_tier(user, client_ip: Optional[str] = None) -> Tuple[str, int]:
    """
    Determine the user's quota tier.

    For the existing api.User model, premium is not yet implemented,
    so authenticated users are treated as free tier.
    """
    quotas = _get_quota_config()

    if user is None:
        return "anon", quotas["anon"]

    # Check for premium if the user model has is_premium and premium_expires_at
    is_premium = getattr(user, "is_premium", False)
    premium_expires = getattr(user, "premium_expires_at", None)
    if is_premium:
        if premium_expires is None:
            return "premium", quotas["premium"]
        if isinstance(premium_expires, datetime):
            if premium_expires.tzinfo is None:
                premium_expires = premium_expires.replace(tzinfo=timezone.utc)
            if premium_expires > datetime.now(timezone.utc):
                return "premium", quotas["premium"]

    return "free", quotas["free"]


def _build_quota_key(identifier: str, tier: str, quota_date: Optional[str] = None) -> str:
    today = quota_date or date.today().isoformat()
    hashed = hash_identifier(identifier)
    return f"{QUOTA_KEY_PREFIX}:{tier}:{hashed}:{today}"


def _get_user_identifier(user, client_ip: Optional[str] = None) -> str:
    if user is None:
        return client_ip or "unknown"
    return str(user.id)


class QuotaManager:
    """Manages daily AI request quotas."""

    def __init__(self, redis_client=None):
        self._redis = redis_client

    @property
    def _is_redis_available(self) -> bool:
        from django.core.cache import cache

        return hasattr(cache, "client")

    @property
    def _client(self):
        if self._redis is None:
            from django.core.cache import cache

            if not self._is_redis_available:
                raise RuntimeError("Cache backend does not support Redis client interface")
            self._redis = cache.client.get_client()
        return self._redis

    def _fail_open(self, user, client_ip: Optional[str] = None) -> Tuple[bool, Dict]:
        tier, limit = _get_tier(user, client_ip)
        return True, {
            "tier": tier,
            "limit": limit,
            "used": 0,
            "remaining": limit if limit != -1 else -1,
            "resets_at": self._get_reset_time().isoformat(),
        }

    def check_quota(
        self,
        user,
        client_ip: Optional[str] = None,
    ) -> Tuple[bool, Dict]:
        """Check if the user has remaining AI request quota (does not consume)."""
        tier, limit = _get_tier(user, client_ip)
        identifier = _get_user_identifier(user, client_ip)

        if limit == -1:
            info = {
                "tier": tier,
                "limit": -1,
                "used": 0,
                "remaining": -1,
                "resets_at": self._get_reset_time().isoformat(),
            }
            return True, info

        if not self._is_redis_available:
            return self._fail_open(user, client_ip)

        key = _build_quota_key(identifier, tier)

        try:
            used = self._client.get(key)
            used = int(used) if used is not None else 0
        except Exception as exc:
            logger.error(
                "Quota check Redis error",
                extra={"identifier": identifier, "tier": tier, "error": str(exc)},
            )
            return self._fail_open(user, client_ip)

        remaining = max(0, limit - used)
        allowed = remaining > 0

        info = {
            "tier": tier,
            "limit": limit,
            "used": used,
            "remaining": remaining,
            "resets_at": self._get_reset_time().isoformat(),
        }

        return allowed, info

    def consume_quota(
        self,
        user,
        client_ip: Optional[str] = None,
    ) -> Tuple[bool, Dict]:
        """Consume one quota slot for an AI request."""
        tier, limit = _get_tier(user, client_ip)
        identifier = _get_user_identifier(user, client_ip)

        if limit == -1:
            return True, {
                "tier": tier,
                "limit": -1,
                "used": 0,
                "remaining": -1,
                "resets_at": self._get_reset_time().isoformat(),
            }

        if not self._is_redis_available:
            return self._fail_open(user, client_ip)

        key = _build_quota_key(identifier, tier)

        try:
            new_used = self._client.incr(key)
            ttl = self._get_seconds_until_reset()
            self._client.expire(key, int(ttl))

            remaining = max(0, limit - new_used)

            info = {
                "tier": tier,
                "limit": limit,
                "used": int(new_used),
                "remaining": remaining,
                "resets_at": self._get_reset_time().isoformat(),
            }

            return remaining >= 0, info

        except Exception as exc:
            logger.error(
                "Quota consume Redis error",
                extra={"identifier": identifier, "tier": tier, "error": str(exc)},
            )
            return self._fail_open(user, client_ip)

    def get_remaining(self, user, client_ip: Optional[str] = None) -> Dict:
        _, info = self.check_quota(user, client_ip)
        return info

    def reset_daily(self, user, client_ip: Optional[str] = None) -> bool:
        """Reset the daily quota for a user."""
        tier, _ = _get_tier(user, client_ip)
        identifier = _get_user_identifier(user, client_ip)
        key = _build_quota_key(identifier, tier)

        if not self._is_redis_available:
            logger.warning("Quota reset skipped: Redis not available")
            return False

        try:
            self._client.delete(key)
            logger.info("Daily quota reset", extra={"identifier": identifier, "tier": tier})
            return True
        except Exception as exc:
            logger.error(
                "Quota reset error",
                extra={"identifier": identifier, "tier": tier, "error": str(exc)},
            )
            return False

    def _get_seconds_until_reset(self) -> int:
        """Seconds until quota resets at midnight Beijing time (UTC+8)."""
        now = datetime.now(timezone.utc)
        beijing_now = now + timedelta(hours=8)
        beijing_midnight = datetime(
            beijing_now.year, beijing_now.month, beijing_now.day,
            tzinfo=timezone.utc
        ) + timedelta(hours=16)

        if beijing_midnight <= now:
            beijing_midnight += timedelta(days=1)

        return int((beijing_midnight - now).total_seconds())

    def _get_reset_time(self) -> datetime:
        """Next quota reset time as UTC datetime (midnight Beijing time)."""
        now = datetime.now(timezone.utc)
        beijing_now = now + timedelta(hours=8)
        beijing_midnight = datetime(
            beijing_now.year, beijing_now.month, beijing_now.day,
            tzinfo=timezone.utc
        ) + timedelta(hours=16)

        if beijing_midnight <= now:
            beijing_midnight += timedelta(days=1)

        return beijing_midnight


_default_quota_manager: Optional[QuotaManager] = None


def get_quota_manager() -> QuotaManager:
    global _default_quota_manager
    if _default_quota_manager is None:
        _default_quota_manager = QuotaManager()
    return _default_quota_manager
