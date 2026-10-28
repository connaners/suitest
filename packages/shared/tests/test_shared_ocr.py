from __future__ import annotations

import base64
from unittest.mock import AsyncMock, MagicMock

import pytest
from suitest_shared.ocr import (
    build_detect_captcha_script,
    build_tiny_ocr_element_eval_script,
    build_tiny_ocr_solve_script,
    classify_ocr_output,
    clean_and_decode_base64,
    evaluate_math_expression,
    has_captcha_hint,
    is_submit_action,
    load_ocrad_source,
    solve_captcha_in_page,
)


def test_load_ocrad_source() -> None:
    code = load_ocrad_source()
    assert len(code) > 1000
    assert "OCRAD" in code


def test_evaluate_math_expression() -> None:
    assert evaluate_math_expression("12 + 5") == 17
    assert evaluate_math_expression("20 - 7 = ?") == 13
    assert evaluate_math_expression("6 x 8") == 48
    assert evaluate_math_expression("15 * 3") == 45
    assert evaluate_math_expression("100 / 4") == 25
    assert evaluate_math_expression("10 / 0") is None
    assert evaluate_math_expression("not an equation") is None


def test_classify_ocr_output() -> None:
    # Math expression
    math_res = classify_ocr_output("14 + 6 = ?")
    assert math_res["status"] == "solved"
    assert math_res["text"] == "20"
    assert math_res["source"] == "local_math"

    # Alphanumeric text
    alpha_res = classify_ocr_output("AB7X9Q")
    assert alpha_res["status"] == "solved"
    assert alpha_res["text"] == "AB7X9Q"
    assert alpha_res["source"] == "tiny_ocr"

    # Ambiguous or short
    short_res = classify_ocr_output("ab")
    assert short_res["status"] == "fallback"
    assert short_res["reason"] == "text_too_short_or_ambiguous"

    # Empty
    empty_res = classify_ocr_output("")
    assert empty_res["status"] == "fallback"


def test_build_scripts() -> None:
    eval_script = build_tiny_ocr_element_eval_script()
    assert "(img) =>" in eval_script
    assert "OCRAD" in eval_script

    solve_script = build_tiny_ocr_solve_script("img#captcha", "page")
    assert 'locator("img#captcha")' in solve_script
    assert "evalResult" in solve_script


def test_clean_and_decode_base64() -> None:
    raw = b"test-image-bytes"
    b64 = base64.b64encode(raw).decode("ascii")
    assert clean_and_decode_base64(b64) == raw
    assert clean_and_decode_base64(f"data:image/png;base64,{b64}") == raw
    assert clean_and_decode_base64("") == b""


def test_captcha_detector_helpers() -> None:
    assert is_submit_action("button#login-submit", "browser_click")
    assert is_submit_action("button.btn-masuk", "browser_click")
    assert not is_submit_action("button#cancel", "browser_click")
    assert not is_submit_action("button#login", "browser_type")

    assert has_captcha_hint("input[name='captcha']")
    assert has_captcha_hint(None, "kode keamanan")
    assert not has_captcha_hint("input[name='username']")

    script = build_detect_captcha_script("#captcha_code")
    assert "isCaptchaField" in script
    assert "#captcha_code" in script


@pytest.mark.asyncio
async def test_solve_captcha_in_page_solved() -> None:
    page = MagicMock()
    locator = MagicMock()
    locator.wait_for = AsyncMock()
    locator.evaluate = AsyncMock(
        side_effect=[
            True,
            {"status": "solved", "text": "4591", "source": "tiny_ocr"},
        ]
    )
    page.locator.return_value = locator

    res = await solve_captcha_in_page(page, "#img-captcha")
    assert res["status"] == "solved"
    assert res["text"] == "4591"
    assert res["source"] == "tiny_ocr"


@pytest.mark.asyncio
async def test_solve_captcha_in_page_fallback() -> None:
    page = MagicMock()
    locator = MagicMock()
    locator.wait_for = AsyncMock()
    locator.evaluate = AsyncMock(
        side_effect=[
            True,
            {"status": "fallback", "reason": "ocr_result_ambiguous", "image_base64": ""},
        ]
    )
    locator.screenshot = AsyncMock(return_value=b"pngdata")
    page.locator.return_value = locator

    res = await solve_captcha_in_page(page, "#img-captcha")
    assert res["status"] == "fallback"
    assert res["reason"] == "ocr_result_ambiguous"
    assert "data:image/png;base64," in res["image_base64"]
