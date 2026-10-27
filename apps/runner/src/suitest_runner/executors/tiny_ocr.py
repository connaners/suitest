"""In-browser Tiny WASM OCR with Canvas Pixel Pre-Filter and Local Math Evaluator.

Re-exported from suitest_shared.ocr.tiny_ocr for backwards compatibility.
"""

from __future__ import annotations

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
    "build_tiny_ocr_element_eval_script",
    "build_tiny_ocr_solve_script",
    "classify_ocr_output",
    "clean_and_decode_base64",
    "evaluate_math_expression",
    "load_ocrad_source",
    "parse_browser_eval_result",
    "solve_captcha_in_page",
]
