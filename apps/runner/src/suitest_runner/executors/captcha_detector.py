"""DOM CAPTCHA Detector matching Suitest heuristics.

Re-exported from suitest_shared.ocr.captcha_detector for backwards compatibility.
"""

from __future__ import annotations

from suitest_shared.ocr.captcha_detector import (
    CAPTCHA_HINT_PATTERN,
    SUBMIT_TRIGGER_PATTERN,
    CaptchaDetectResult,
    build_detect_captcha_script,
    has_captcha_hint,
    is_submit_action,
)

__all__ = [
    "CAPTCHA_HINT_PATTERN",
    "SUBMIT_TRIGGER_PATTERN",
    "CaptchaDetectResult",
    "build_detect_captcha_script",
    "has_captcha_hint",
    "is_submit_action",
]
