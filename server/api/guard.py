"""
AI compliance and security guard.

Provides prompt injection detection, content filtering, input validation,
output sanitization, and audit logging for AI requests.
"""

import hashlib
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from django.conf import settings

logger = logging.getLogger("api.guard")

_ENGLISH_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?(prior\s+|previous\s+)?instructions",
    r"ignore\s+(your\s+)?(training|programming|rules)",
    r"forget\s+(all\s+)?(prior\s+|previous\s+)?instructions",
    r"forget\s+(your\s+)?(training|programming|rules)",
    r"system\s+prompt",
    r"your\s+(system\s+)?prompt\s+is",
    r"reveal\s+your\s+(system\s+)?prompt",
    r"show\s+your\s+instructions",
    r"what\s+are\s+your\s+instructions",
    r"\bDAN\b",
    r"jailbreak",
    r"you\s+are\s+now\s+",
    r"from\s+now\s+on\s+you\s+are",
    r"you\s+have\s+been\s+changed\s+to",
    r"act\s+as\s+(if\s+)?you\s+are",
    r"pretend\s+to\s+be",
    r"roleplay\s+as",
    r"\n\s*\{\s*\"role\s*\"\s*:\s*\"system\"",
    r"<\|im_start\|>\s*system",
    r"\[\s*system\s*\]",
    r"<<SYS>>",
    r"\{\{system\}\}",
    r"base64\s+decode",
    r"rot13",
    r"url\s+decode",
    r"repeat\s+(the\s+words\s+)?above",
    r"repeat\s+your\s+(instructions|prompt)",
    r"output\s+(the\s+)?(text\s+)?above",
    r"print\s+(the\s+)?(previous|first)\s+\w+",
    r"instead\s+of.*you\s+must",
    r"do\s+not.*instead",
    r"your\s+new\s+(goal|task|objective)\s+is",
    r"override.*instruction",
]

_CHINESE_INJECTION_PATTERNS = [
    r"忽略.*指令",
    r"忽略.*(设定|规则|要求)",
    r"忘记.*指令",
    r"忘记.*(设定|规则|要求)",
    r"不要.*(遵守|遵循).*规则",
    r"无视.*(设定|规则|限制)",
    r"系统提示",
    r"你的.*提示词",
    r"告诉我.*提示词",
    r"显示.*指令",
    r"你现在.*是",
    r"从现在开始.*你",
    r"你已经被.*改为",
    r"扮演",
    r"假装.*是",
    r"假设你",
    r"重复.*上面",
    r"重复.*(内容|文字)",
    r"输出.*上面",
    r"打印.*之前",
    r"角色.*系统",
    r"系统.*角色",
]

_ALL_INJECTION_PATTERNS = [
    re.compile(pattern, re.IGNORECASE | re.UNICODE)
    for pattern in (_ENGLISH_INJECTION_PATTERNS + _CHINESE_INJECTION_PATTERNS)
]

_PROHIBITED_TOPIC_PATTERNS = [
    r"\b(政治|政府|共产党|领导人|政治局|中央)",
    r"\bpolitical\s+(interference|subversion|regime\s+change)",
    r"\b(赌博|博彩|赌球|六合彩|私彩)",
    r"\b(how\s+to\s+)?(hack|crack|bypass|exploit)\s+",
    r"\b(毒品|贩毒|吸毒|制毒)",
    r"\b(武器|枪支|弹药|爆炸物)",
    r"(投资|股票|基金|理财).*必(赚|胜|涨)",
    r"(医疗|诊断|治疗|用药).*(建议|方案)",
    r"guaranteed.*(return|profit|cure)",
    r"一定.*(死亡|灾难|事故|破产)",
    r"(必然|肯定|绝对).*(发生|出现)",
    r"( definite| guaranteed).*(death|disaster|accident)",
    r"(改命|换命|借运|偷运|转运仪式)",
    r"(血祭|活人|献祭)",
    r"(sacrifice|ritual).*blood",
]

_COMPILED_PROHIBITED_PATTERNS = [
    re.compile(pattern, re.IGNORECASE | re.UNICODE)
    for pattern in _PROHIBITED_TOPIC_PATTERNS
]

MAX_PROMPT_LENGTH = getattr(settings, "GUANWO_MAX_PROMPT_LENGTH", 4000)
MAX_CHART_DATA_LENGTH = getattr(settings, "GUANWO_MAX_CHART_DATA_LENGTH", 50000)
VALID_READING_TYPES = {"bazi", "zwds", "liu_yao", "dream", "fortune", "analyze", "chat", "general"}

_COMPLIANCE_DISCLAIMERS = {
    "bazi": (
        "\n\n---\n"
        "【免责声明】本内容由 AI 生成，仅供娱乐参考，不构成任何决策建议。"
        "八字命理属于传统文化范畴，其解读结果不具有科学依据，请勿据此做出重要人生决定。"
        "如有健康、法律、财务等方面的问题，请咨询相关专业机构。"
    ),
    "zwds": (
        "\n\n---\n"
        "【免责声明】本内容由 AI 生成，仅供娱乐参考，不构成任何决策建议。"
        "紫微斗数属于传统文化范畴，其解读结果不具有科学依据，请勿据此做出重要人生决定。"
        "如有健康、法律、财务等方面的问题，请咨询相关专业机构。"
    ),
    "liu_yao": (
        "\n\n---\n"
        "【免责声明】本内容由 AI 生成，仅供娱乐参考，不构成任何决策建议。"
        "六爻占卜属于传统文化范畴，其结果不具有科学依据，请勿据此做出重要人生决定。"
    ),
    "dream": (
        "\n\n---\n"
        "【免责声明】本内容由 AI 生成，仅供娱乐参考，不构成任何决策建议。"
        "梦境解读属于心理学和传统文化交叉范畴，不具有医学诊断价值。"
    ),
    "fortune": (
        "\n\n---\n"
        "【免责声明】本内容由 AI 生成，仅供娱乐参考，不构成任何决策建议。"
        "流年运势属于传统文化范畴，其结果不具有科学依据。"
    ),
    "analyze": (
        "\n\n---\n"
        "【免责声明】本内容由 AI 生成，仅供娱乐参考，不构成任何决策建议。"
        "命理分析属于传统文化范畴，其结果不具有科学依据。"
    ),
    "chat": (
        "\n\n---\n"
        "【免责声明】本内容由 AI 生成，仅供娱乐参考，不构成任何决策建议。"
    ),
    "general": (
        "\n\n---\n"
        "【免责声明】本内容由 AI 生成，仅供娱乐参考，不构成任何决策建议。"
        "如有健康、法律、财务等方面的问题，请咨询相关专业机构。"
    ),
}

_SYSTEM_LEAKAGE_PATTERNS = [
    re.compile(r"\[System:\s*.*?\]", re.DOTALL | re.IGNORECASE),
    re.compile(r"<system>.*?</system>", re.DOTALL | re.IGNORECASE),
    re.compile(r"\{\{system\}\}.*?\{\{/system\}\}", re.DOTALL | re.IGNORECASE),
    re.compile(r"<<SYS>>.*?<</SYS>>", re.DOTALL | re.IGNORECASE),
    re.compile(r"You are a helpful assistant.*?(?=\n\n|\Z)", re.DOTALL | re.IGNORECASE),
    re.compile(r"As an AI (language model|assistant).*?(?=\n\n|\Z)", re.DOTALL | re.IGNORECASE),
    re.compile(r"AI system prompt.*?(?=\n\n|\Z)", re.DOTALL | re.IGNORECASE),
]


@dataclass
class ValidationResult:
    is_allowed: bool
    reason: Optional[str] = None
    rule_violated: Optional[str] = None
    risk_score: int = 0
    details: Optional[Dict] = None

    def __post_init__(self):
        if self.details is None:
            self.details = {}


class AIComplianceGuard:
    """AI compliance and security guard."""

    def __init__(self):
        self._injection_patterns = _ALL_INJECTION_PATTERNS
        self._prohibited_patterns = _COMPILED_PROHIBITED_PATTERNS
        self._leakage_patterns = _SYSTEM_LEAKAGE_PATTERNS

    def validate_request(
        self,
        prompt: str,
        reading_type: str = "general",
        chart_data: Optional[str] = None,
    ) -> ValidationResult:
        length_result = self._validate_length(prompt, chart_data)
        if not length_result.is_allowed:
            return length_result

        type_result = self._validate_reading_type(reading_type)
        if not type_result.is_allowed:
            return type_result

        injection_result = self._detect_injection(prompt)
        if not injection_result.is_allowed:
            return injection_result

        content_result = self._filter_content(prompt)
        if not content_result.is_allowed:
            return content_result

        max_risk = max(
            length_result.risk_score,
            injection_result.risk_score,
            content_result.risk_score,
        )
        return ValidationResult(
            is_allowed=True,
            risk_score=max_risk,
            details={"checks_passed": ["length", "type", "injection", "content"]},
        )

    def validate_messages(
        self,
        messages: List[Dict[str, str]],
        reading_type: str = "general",
        chart_data: Optional[str] = None,
    ) -> ValidationResult:
        combined = "\n".join(
            f"{m.get('role', 'user')}: {m.get('content', '')}"
            for m in messages
        )
        return self.validate_request(combined, reading_type, chart_data)

    def sanitize_output(self, text: str) -> str:
        """Sanitize AI output before sending to the client."""
        if not text:
            return text

        for pattern in self._leakage_patterns:
            text = pattern.sub("", text)

        text = re.sub(r"\n{4,}", "\n\n\n", text)
        text = re.sub(r" {3,}", "  ", text)
        text = re.sub(r"\[\w+:\s*.*?\]", "", text, flags=re.DOTALL)

        return text.strip()

    def add_compliance_wrapper(self, text: str, reading_type: str = "general") -> str:
        """Add regulatory compliance disclaimer to AI output."""
        if not text:
            return text

        disclaimer = _COMPLIANCE_DISCLAIMERS.get(
            reading_type, _COMPLIANCE_DISCLAIMERS["general"]
        )

        if "免责声明" in text or "本内容由 AI 生成" in text:
            return text

        return text + disclaimer

    def log_audit_entry(
        self,
        user_id: Optional[str],
        prompt: str,
        output: str,
        model: str,
        reading_type: str = "general",
        tokens_used: Optional[int] = None,
        duration_ms: Optional[float] = None,
        metadata: Optional[Dict] = None,
    ) -> None:
        """Log an AI interaction for regulatory audit trail."""
        prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
        output_preview = output[:500] if output else ""
        if len(output) > 500:
            output_preview += "..."

        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": "ai_interaction",
            "user_id": user_id or "anonymous",
            "prompt_hash": prompt_hash,
            "output_preview": output_preview,
            "model": model,
            "reading_type": reading_type,
            "tokens_used": tokens_used,
            "duration_ms": duration_ms,
        }

        if metadata:
            log_entry["metadata"] = metadata

        logger.info("AI audit entry", extra=log_entry)

    def _validate_length(
        self, prompt: str, chart_data: Optional[str] = None
    ) -> ValidationResult:
        if len(prompt) > MAX_PROMPT_LENGTH:
            return ValidationResult(
                is_allowed=False,
                reason=f"Prompt exceeds maximum length of {MAX_PROMPT_LENGTH} characters",
                rule_violated="input_length",
                details={"prompt_length": len(prompt), "max_length": MAX_PROMPT_LENGTH},
            )

        if chart_data and len(chart_data) > MAX_CHART_DATA_LENGTH:
            return ValidationResult(
                is_allowed=False,
                reason=f"Chart data exceeds maximum length of {MAX_CHART_DATA_LENGTH} characters",
                rule_violated="chart_data_length",
                details={"chart_data_length": len(chart_data), "max_length": MAX_CHART_DATA_LENGTH},
            )

        return ValidationResult(is_allowed=True, risk_score=0)

    def _validate_reading_type(self, reading_type: str) -> ValidationResult:
        if reading_type not in VALID_READING_TYPES:
            return ValidationResult(
                is_allowed=False,
                reason=f"Invalid reading type: {reading_type}",
                rule_violated="invalid_reading_type",
                details={"valid_types": list(VALID_READING_TYPES)},
            )
        return ValidationResult(is_allowed=True, risk_score=0)

    def _detect_injection(self, prompt: str) -> ValidationResult:
        for pattern in self._injection_patterns:
            match = pattern.search(prompt)
            if match:
                matched_text = match.group(0)
                logger.warning(
                    "Prompt injection detected",
                    extra={"matched_pattern": matched_text[:50]},
                )
                return ValidationResult(
                    is_allowed=False,
                    reason="Invalid input detected. Please rephrase your request.",
                    rule_violated="prompt_injection",
                    risk_score=95,
                    details={"detection": True},
                )

        return ValidationResult(is_allowed=True, risk_score=0)

    def _filter_content(self, prompt: str) -> ValidationResult:
        for pattern in self._prohibited_patterns:
            match = pattern.search(prompt)
            if match:
                matched_text = match.group(0)
                category = self._classify_prohibited_content(matched_text)
                logger.warning(
                    "Prohibited content detected",
                    extra={"matched_text": matched_text[:50], "content_category": category},
                )
                return ValidationResult(
                    is_allowed=False,
                    reason="This request contains content that cannot be processed.",
                    rule_violated="prohibited_content",
                    risk_score=85,
                    details={"content_category": category},
                )

        return ValidationResult(is_allowed=True, risk_score=0)

    @staticmethod
    def _classify_prohibited_content(matched_text: str) -> str:
        text_lower = matched_text.lower()
        if any(kw in text_lower for kw in ["政治", "政府", "共产党", "领导人", "political"]):
            return "political_content"
        if any(kw in text_lower for kw in ["赌博", "博彩", "赌球", "六合彩"]):
            return "gambling"
        if any(kw in text_lower for kw in ["毒品", "贩毒", "吸毒"]):
            return "drugs"
        if any(kw in text_lower for kw in ["武器", "枪支", "弹药"]):
            return "weapons"
        if any(kw in text_lower for kw in ["投资", "股票", "基金", "理财"]):
            return "unqualified_financial_advice"
        if any(kw in text_lower for kw in ["医疗", "诊断", "治疗", "用药"]):
            return "unqualified_medical_advice"
        if any(kw in text_lower for kw in ["改命", "换命", "血祭", "献祭"]):
            return "extreme_superstition"
        return "other_prohibited"


_default_guard: Optional[AIComplianceGuard] = None


def get_ai_guard() -> AIComplianceGuard:
    global _default_guard
    if _default_guard is None:
        _default_guard = AIComplianceGuard()
    return _default_guard
