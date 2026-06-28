import json
import os
import socket
import unittest

from django.test import TestCase, Client
from django.conf import settings

from core.rate_limiter import SlidingWindowRateLimiter, build_rate_limit_key, get_client_ip
from api.quota import QuotaManager


def _redis_available() -> bool:
    """Return True if a Redis server is reachable for integration tests."""
    redis_url = getattr(settings, "REDIS_URL", None)
    if not redis_url:
        return False
    try:
        from django.core.cache import cache

        if not hasattr(cache, "client"):
            return False
        client = cache.client.get_client()
        return bool(client.ping())
    except Exception:
        return False


class RequestIDAndSecurityHeadersTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_request_id_header_is_set(self):
        response = self.client.get("/api/me")
        self.assertIn("X-Request-ID", response.headers)
        self.assertTrue(len(response.headers["X-Request-ID"]) > 0)

    def test_security_headers_present(self):
        response = self.client.get("/api/me")
        self.assertEqual(response.headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(response.headers.get("X-Frame-Options"), "DENY")
        self.assertIn("Content-Security-Policy", response.headers)
        self.assertIn("Referrer-Policy", response.headers)


class HealthEndpointTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_liveness_probe(self):
        response = self.client.get("/api/health/live/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"alive": True})

    def test_readiness_probe(self):
        response = self.client.get("/api/health/ready/")
        if _redis_available():
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json().get("ready"))
        else:
            # Without Redis the app is not considered ready.
            self.assertEqual(response.status_code, 503)

    def test_health_endpoint_structure(self):
        response = self.client.get("/api/health/")
        self.assertIn(response.status_code, (200, 503))
        data = response.json()
        self.assertIn("status", data)
        self.assertIn("services", data)
        self.assertIn("database", data["services"])


class RateLimiterFailOpenTest(TestCase):
    """Rate limiter must fail open when Redis is not configured."""

    def test_fail_open_when_no_redis(self):
        limiter = SlidingWindowRateLimiter()
        if limiter.is_redis_available:
            raise unittest.SkipTest("Redis is available; skip fail-open test")

        key = build_rate_limit_key("anon", "127.0.0.1", 60)
        allowed, remaining, retry_after = limiter.is_allowed(key, 10, 60)
        self.assertTrue(allowed)
        self.assertEqual(remaining, 10)
        self.assertEqual(retry_after, 0)


@unittest.skipUnless(_redis_available(), "Redis is not available")
class RateLimiterRedisTest(TestCase):
    """Integration tests for the Redis-backed sliding window rate limiter."""

    def setUp(self):
        self.limiter = SlidingWindowRateLimiter()
        self.key = f"ratelimit:test:{os.urandom(4).hex()}:1"

    def tearDown(self):
        try:
            self.limiter.reset(self.key)
        except Exception:
            pass

    def test_allow_requests_up_to_limit(self):
        limit = 3
        for _ in range(limit):
            allowed, remaining, _ = self.limiter.is_allowed(self.key, limit, 60)
            self.assertTrue(allowed)
            self.assertGreaterEqual(remaining, 0)

        allowed, remaining, retry_after = self.limiter.is_allowed(self.key, limit, 60)
        self.assertFalse(allowed)
        self.assertEqual(remaining, 0)
        self.assertGreater(retry_after, 0)

    def test_remaining_does_not_consume(self):
        limit = 5
        remaining, _ = self.limiter.get_remaining(self.key, limit, 60)
        self.assertEqual(remaining, limit)

        self.limiter.is_allowed(self.key, limit, 60)
        remaining, _ = self.limiter.get_remaining(self.key, limit, 60)
        self.assertEqual(remaining, limit - 1)


class QuotaFailOpenTest(TestCase):
    """Quota manager must fail open when Redis is not configured."""

    def test_fail_open_when_no_redis(self):
        manager = QuotaManager()
        if manager._is_redis_available:
            raise unittest.SkipTest("Redis is available; skip fail-open test")

        allowed, info = manager.check_quota(None, "127.0.0.1")
        self.assertTrue(allowed)
        self.assertEqual(info["tier"], "anon")
        self.assertGreater(info["remaining"], 0)


@unittest.skipUnless(_redis_available(), "Redis is not available")
class QuotaRedisTest(TestCase):
    """Integration tests for the daily AI quota manager."""

    def setUp(self):
        self.manager = QuotaManager()
        self.client_ip = f"192.0.2.{os.urandom(1)[0]}"

    def tearDown(self):
        try:
            self.manager.reset_daily(None, self.client_ip)
        except Exception:
            pass

    def test_anonymous_quota_consumption(self):
        allowed, info = self.manager.check_quota(None, self.client_ip)
        self.assertTrue(allowed)

        self.manager.consume_quota(None, self.client_ip)
        allowed, info = self.manager.check_quota(None, self.client_ip)
        self.assertTrue(allowed)
        self.assertEqual(info["used"], 1)

    def test_quota_reset(self):
        self.manager.consume_quota(None, self.client_ip)
        self.assertTrue(self.manager.reset_daily(None, self.client_ip))
        _, info = self.manager.check_quota(None, self.client_ip)
        self.assertEqual(info["used"], 0)


class ClientIPTest(TestCase):
    def test_x_forwarded_for_priority(self):
        class FakeRequest:
            META = {
                "HTTP_X_FORWARDED_FOR": "203.0.113.1, 70.41.3.18",
                "HTTP_X_REAL_IP": "198.51.100.1",
                "REMOTE_ADDR": "192.168.1.1",
            }

        self.assertEqual(get_client_ip(FakeRequest()), "203.0.113.1")

    def test_fallback_to_remote_addr(self):
        class FakeRequest:
            META = {"REMOTE_ADDR": "10.0.0.1"}

        self.assertEqual(get_client_ip(FakeRequest()), "10.0.0.1")
