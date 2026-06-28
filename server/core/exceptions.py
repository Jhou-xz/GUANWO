"""
Custom exception classes for the GuanWo application.
"""


class GuanWoException(Exception):
    """Base exception for all GuanWo application errors."""

    status_code = 500
    default_message = "An internal server error occurred."
    error_code = "internal_error"

    def __init__(self, message=None, *, details=None, extra_headers=None):
        self.message = message or self.default_message
        self.details = details or {}
        self.extra_headers = extra_headers or {}
        super().__init__(self.message)

    def to_dict(self):
        error_dict = {
            "error": {
                "code": self.error_code,
                "message": self.message,
                "status": self.status_code,
            }
        }
        if self.details:
            error_dict["error"]["details"] = self.details
        return error_dict


class RateLimitExceeded(GuanWoException):
    """Raised when a user or IP exceeds the rate limit."""

    status_code = 429
    default_message = "Rate limit exceeded. Please try again later."
    error_code = "rate_limit_exceeded"

    def __init__(self, message=None, *, retry_after=None, scope=None, limit=None, **kwargs):
        details = kwargs.pop("details", {})
        if retry_after is not None:
            details["retry_after"] = retry_after
        if scope is not None:
            details["scope"] = scope
        if limit is not None:
            details["limit"] = limit

        extra_headers = kwargs.pop("extra_headers", {})
        if retry_after is not None:
            extra_headers["Retry-After"] = str(int(retry_after))
            extra_headers["X-RateLimit-Retry-After"] = str(int(retry_after))

        super().__init__(
            message=message,
            details=details,
            extra_headers=extra_headers,
            **kwargs,
        )


class QuotaExceeded(GuanWoException):
    """Raised when a user exceeds their daily AI request quota."""

    status_code = 429
    default_message = "Daily AI request quota exceeded."
    error_code = "quota_exceeded"

    def __init__(self, message=None, *, tier=None, limit=None, used=None, resets_at=None, **kwargs):
        details = kwargs.pop("details", {})
        if tier is not None:
            details["tier"] = tier
        if limit is not None:
            details["limit"] = limit
        if used is not None:
            details["used"] = used
        if resets_at is not None:
            details["resets_at"] = resets_at

        super().__init__(message=message, details=details, **kwargs)


class AIProviderError(GuanWoException):
    """Raised when the AI provider (DeepSeek) returns an error or is unreachable."""

    status_code = 502
    default_message = "The AI service is temporarily unavailable. Please try again later."
    error_code = "ai_provider_error"

    def __init__(self, message=None, *, provider_status=None, provider_error=None, **kwargs):
        details = kwargs.pop("details", {})
        if provider_status is not None:
            details["provider_status"] = provider_status
        if provider_error is not None:
            details["provider_error"] = provider_error
        super().__init__(message=message, details=details, **kwargs)


class ComplianceViolation(GuanWoException):
    """Raised when input violates Chinese AI regulatory compliance rules."""

    status_code = 400
    default_message = "The request does not comply with content guidelines."
    error_code = "compliance_violation"

    def __init__(self, message=None, *, rule_violated=None, field=None, **kwargs):
        details = kwargs.pop("details", {})
        if rule_violated is not None:
            details["rule_violated"] = rule_violated
        if field is not None:
            details["field"] = field
        super().__init__(message=message, details=details, **kwargs)


class PromptInjectionDetected(ComplianceViolation):
    """Raised when a prompt injection attack is detected."""

    status_code = 400
    default_message = "Invalid input detected."
    error_code = "prompt_injection_detected"

    def __init__(self, message=None, *, pattern_matched=None, **kwargs):
        super().__init__(message=message, **kwargs)
        self._pattern_matched = pattern_matched


class AuthenticationRequired(GuanWoException):
    """Raised when an authenticated endpoint is accessed anonymously."""

    status_code = 401
    default_message = "Authentication required to access this resource."
    error_code = "authentication_required"
