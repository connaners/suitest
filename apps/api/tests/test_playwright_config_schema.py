"""Tests for PlaywrightConfig schema serialization and alias resolution."""

from suitest_api.schemas.run import PlaywrightConfig
from suitest_api.schemas.runs import CreateRunBody


def test_playwright_config_defaults() -> None:
    cfg = PlaywrightConfig()
    assert cfg.prevent_sleep is True
    assert cfg.model_dump(by_alias=True)["preventSleep"] is True
    assert cfg.model_dump(by_alias=False)["prevent_sleep"] is True


def test_playwright_config_accepts_camel_case() -> None:
    cfg = PlaywrightConfig.model_validate({"preventSleep": False, "screenshot": "on"})
    assert cfg.prevent_sleep is False
    assert cfg.screenshot == "on"
    assert cfg.model_dump(by_alias=True)["preventSleep"] is False


def test_playwright_config_accepts_snake_case() -> None:
    cfg = PlaywrightConfig.model_validate({"prevent_sleep": False, "video_quality": "720p"})
    assert cfg.prevent_sleep is False
    assert cfg.video_quality == "720p"
    assert cfg.model_dump(by_alias=True)["preventSleep"] is False


def test_create_run_body_parses_playwright_config() -> None:
    payload = {
        "projectId": "018f3a3a-1111-7000-8000-000000000001",
        "name": "Test Run",
        "selection": [{"caseId": "018f3a3a-2222-7000-8000-000000000002"}],
        "playwrightConfig": {"preventSleep": False},
    }
    body = CreateRunBody.model_validate(payload)
    assert body.playwright_config is not None
    assert body.playwright_config.prevent_sleep is False
