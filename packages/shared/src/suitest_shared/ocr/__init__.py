"""Shared OCR and CAPTCHA detection utilities."""

from suitest_shared.ocr.captcha_detector import (
    CAPTCHA_HINT_PATTERN,
    SUBMIT_TRIGGER_PATTERN,
    CaptchaDetectResult,
    build_detect_captcha_script,
    has_captcha_hint,
    is_submit_action,
)
from suitest_shared.ocr.tiny_ocr import (
    build_tiny_ocr_element_eval_script,
    build_tiny_ocr_solve_script,
    classify_ocr_output,
    clean_and_decode_base64,
    evaluate_math_expression,
    load_ocrad_source,
    parse_browser_eval_result,
    solve_captcha_in_page,
)

__all__ = [
    "CAPTCHA_HINT_PATTERN",
    "SUBMIT_TRIGGER_PATTERN",
    "CaptchaDetectResult",
    "build_detect_captcha_script",
    "build_tiny_ocr_element_eval_script",
    "build_tiny_ocr_solve_script",
    "classify_ocr_output",
    "clean_and_decode_base64",
    "evaluate_math_expression",
    "has_captcha_hint",
    "is_submit_action",
    "load_ocrad_source",
    "parse_browser_eval_result",
    "solve_captcha_in_page",
]
