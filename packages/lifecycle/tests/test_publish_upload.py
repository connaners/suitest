"""Artifact scratch is removed only after blob upload AND result commit."""

from __future__ import annotations

from pathlib import Path

from suitest_lifecycle.models import Mode, StepResult
from suitest_lifecycle.models import TestOutcome as Outcome
from suitest_lifecycle.models import TestResult as Result
from suitest_lifecycle.paths import build_paths
from suitest_lifecycle.publish import (
    _artifact,
    _cleanup_committed_result,
    _resolve_url,
    cleanup_transient_media,
)


class _OkUploader:
    def upload_file(self, path: str, *, content_type: str | None = None) -> str:
        return f"local://{Path(path).name}"


class _FailUploader:
    def upload_file(self, path: str, *, content_type: str | None = None) -> str:
        raise RuntimeError("network down / S3 unreachable")


def test_successful_upload_waits_for_result_commit_before_delete(tmp_path: Path) -> None:
    f = tmp_path / "run.webm"
    f.write_bytes(b"webm")
    url = _resolve_url(_OkUploader(), str(f), "video/webm")
    assert url == "local://run.webm"
    assert f.exists()  # blob alone can still become orphaned; result has not committed


def test_failed_upload_keeps_local_copy(tmp_path: Path) -> None:
    f = tmp_path / "run.webm"
    f.write_bytes(b"webm")
    url = _resolve_url(_FailUploader(), str(f), "video/webm")
    assert f.exists()  # NOT durable — must survive for the file:// ref
    assert url == f.resolve().as_uri()  # valid file:// URI on every OS


def test_artifact_reports_size_without_premature_delete(tmp_path: Path) -> None:
    f = tmp_path / "shot.png"
    f.write_bytes(b"12345")
    art = _artifact(_OkUploader(), str(f), "SCREENSHOT")
    assert art is not None
    assert art["sizeBytes"] == 5
    assert f.exists()


def test_committed_result_deletes_durable_scratch(tmp_path: Path) -> None:
    paths = build_paths(tmp_path / "out", Mode.FRONTEND)
    paths.ensure()
    video = paths.tmp_dir / "videos" / "TC001" / "run.webm"
    video.parent.mkdir(parents=True)
    video.write_bytes(b"video")
    shot = paths.tmp_dir / "TC001_step1.png"
    shot.write_bytes(b"png")
    final = paths.tmp_dir / "TC001_final.png"
    final.write_bytes(b"duplicate")
    result = Result(
        test_id="TC001",
        title="case",
        description="",
        status=Outcome.PASSED,
        duration_ms=1,
        video_path=str(video),
        screenshot_path=str(final),
        steps=[StepResult(1, "action", "open", Outcome.PASSED, screenshot_path=str(shot))],
    )
    payload = {
        "artifacts": [{"url": "local://video"}],
        "steps": [{"screenshot": "local://shot"}],
    }
    _cleanup_committed_result(result, payload, paths)
    assert not video.exists()
    # Per-step evidence stays: the sidecar keeps pointing at it and a later
    # sidecar-based publish re-uploads from these files.
    assert shot.exists()
    assert not final.exists()


def test_transient_cleanup_keeps_step_screenshots(tmp_path: Path) -> None:
    paths = build_paths(tmp_path / "out", Mode.FRONTEND)
    paths.ensure()
    shot = paths.tmp_dir / "TC001_step1.png"
    shot.write_bytes(b"png")
    clip = paths.tmp_dir / "videos" / "TC001" / "run.webm"
    clip.parent.mkdir(parents=True)
    clip.write_bytes(b"video")
    cleanup_transient_media(paths)
    assert shot.exists()
    assert not clip.exists()


def test_format_publish_error_auth_and_api() -> None:
    from suitest_lifecycle.http_client import SuitestAPIError
    from suitest_lifecycle.publish import _format_publish_error

    err_403 = SuitestAPIError(403, {"detail": "Role QA or higher required"})
    formatted_403 = _format_publish_error(err_403, prefix="connection error")
    assert "authorization error: SUITEST_API_KEY is invalid or lacks the QA role" in formatted_403
    assert "HTTP 403" in formatted_403

    err_401 = SuitestAPIError(401, "Invalid token")
    formatted_401 = _format_publish_error(err_401, prefix="connection error")
    assert "authorization error: SUITEST_API_KEY is invalid or lacks the QA role" in formatted_401
    assert "HTTP 401" in formatted_401

    err_500 = SuitestAPIError(500, "Internal Server Error")
    formatted_500 = _format_publish_error(err_500, prefix="connection error")
    assert "Suitest API error 500" in formatted_500

    exc_generic = ConnectionResetError("connection reset by peer")
    formatted_generic = _format_publish_error(exc_generic, prefix="connection error")
    assert "connection error: ConnectionResetError" in formatted_generic
