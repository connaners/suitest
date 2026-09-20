"""Complete test suite for Adaptive Secure S3 Streaming Gateway (Issue #221).

Verifies the 39 test matrix:
- Group A: Smart Endpoint Detection (Tests 1-7)
- Group B: HMAC Media Token Lifecycle & Tampering (Tests 8-15)
- Group C: HTTP Range & Video Scrubbing Parser (Tests 16-22)
- Group D: Caching & ETag (304 Not Modified) (Tests 23-25)
- Group E: MIME Type Whitelisting & Content-Disposition (Tests 26-30)
- Group F: Tenancy Isolation, Anti-SSRF, & Auth Multi-Client (Tests 31-37)
- Group G: Backward Compatibility (Legacy Schemas) (Tests 38-39)
"""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any

import aioboto3
import pytest
from sqlalchemy import select
from suitest_api.routers.runs import _parse_http_range, _safe_filename
from suitest_api.services.file_storage import (
    create_media_token,
    is_internal_s3_endpoint,
    verify_media_token,
)
from suitest_db.models.audit import AuditLog
from suitest_db.models.case import TestCase
from suitest_db.models.project import Project, Suite
from suitest_db.models.run import Artifact, Run, RunStep
from suitest_db.models.user import User
from suitest_db.models.workspace import Workspace
from suitest_shared.domain.enums import (
    ArtifactKind,
    CaseSource,
    RunStatus,
    RunTrigger,
    StepOutcome,
)

if TYPE_CHECKING:
    from api_harness import ApiDb


class _MockS3Body:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.pos = 0

    async def __aenter__(self) -> _MockS3Body:
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        pass

    async def read(self, n: int = -1) -> bytes:
        if n == -1 or n is None:
            chunk = self.data[self.pos :]
            self.pos = len(self.data)
            return chunk
        chunk = self.data[self.pos : self.pos + n]
        self.pos += len(chunk)
        return chunk


class _MockS3Client:
    def __init__(self, objects: dict[str, tuple[bytes, str, str]] | None = None) -> None:
        # key: "{bucket}/{key}" -> (data, content_type, etag)
        self.objects = objects or {}
        self.calls: list[dict[str, Any]] = []
        self.error_on_head: Exception | None = None

    async def generate_presigned_url(
        self, action: str, Params: dict[str, Any], ExpiresIn: int
    ) -> str:
        self.calls.append({"action": action, "Params": Params, "ExpiresIn": ExpiresIn})
        return f"https://cdn.example.com/{Params['Bucket']}/{Params['Key']}?X-Amz-Signature=stub"

    async def head_object(self, Bucket: str, Key: str) -> dict[str, Any]:
        if self.error_on_head is not None:
            raise self.error_on_head
        obj_key = f"{Bucket}/{Key}"
        if obj_key in self.objects:
            data, content_type, etag = self.objects[obj_key]
        else:
            data, content_type, etag = (b"default-s3-data", "image/png", "mock-etag-001")
        return {
            "ContentLength": len(data),
            "ContentType": content_type,
            "ETag": f'"{etag}"',
        }

    async def get_object(self, Bucket: str, Key: str, Range: str | None = None) -> dict[str, Any]:
        obj_key = f"{Bucket}/{Key}"
        if obj_key in self.objects:
            data, content_type, etag = self.objects[obj_key]
        else:
            data, content_type, etag = (b"default-s3-data", "image/png", "mock-etag-001")

        full_len = len(data)
        content_range: str | None = None
        if Range and Range.startswith("bytes="):
            r = Range.removeprefix("bytes=")
            start_str, _, end_str = r.partition("-")
            start = int(start_str) if start_str else 0
            end = int(end_str) if end_str else len(data) - 1
            data = data[start : end + 1]
            content_range = f"bytes {start}-{end}/{full_len}"

        res: dict[str, Any] = {
            "Body": _MockS3Body(data),
            "ContentLength": len(data),
            "ContentType": content_type,
            "ETag": f'"{etag}"',
        }
        if content_range:
            res["ContentRange"] = content_range
        return res


@pytest.fixture()
def mock_s3(monkeypatch: pytest.MonkeyPatch) -> _MockS3Client:
    s3_client = _MockS3Client()

    @asynccontextmanager
    async def _client_factory(
        _self: object, _service: str, **_kwargs: Any
    ) -> AsyncIterator[_MockS3Client]:
        yield s3_client

    monkeypatch.setattr(aioboto3.Session, "client", _client_factory)
    return s3_client


async def _seed_hierarchy(
    api_db: ApiDb,
    *,
    email: str,
    slug: str,
    artifact_url: str,
    mime_type: str = "image/png",
    size_bytes: int = 100,
    kind: ArtifactKind = ArtifactKind.SCREENSHOT,
) -> tuple[User, Workspace, Run, Artifact]:
    user = await api_db.seed_user(email=email)
    ws = await api_db.member_workspace(user, slug=slug)
    proj = Project(workspace_id=ws.id, slug=f"{slug}-p", name="P")
    await api_db.add_all([proj])
    suite = Suite(project_id=proj.id, name="S", order=0)
    await api_db.add_all([suite])
    case = TestCase(
        suite_id=suite.id, public_id=f"TC-{slug[:6].upper()}", name="c", source=CaseSource.MANUAL
    )
    run = Run(
        public_id=f"RUN-{slug[:6].upper()}",
        project_id=proj.id,
        name="r",
        trigger=RunTrigger.MANUAL,
    )
    await api_db.add_all([case, run])
    step = RunStep(run_id=run.id, case_id=case.id, step_order=1, outcome=StepOutcome.PASS)
    await api_db.add_all([step])
    art = Artifact(
        run_step_id=step.id,
        kind=kind,
        url=artifact_url,
        size_bytes=size_bytes,
        mime_type=mime_type,
    )
    await api_db.add_all([art])
    return user, ws, run, art


# ==============================================================================
# Group A: Smart Endpoint Detection (Unit & Configuration Tests)
# ==============================================================================


def test_internal_s3_endpoint_docker_service_name() -> None:
    assert is_internal_s3_endpoint("http://minio:9000") is True
    assert is_internal_s3_endpoint("http://s3:9000") is True
    assert is_internal_s3_endpoint("http://minio") is True
    assert is_internal_s3_endpoint("minio:9000") is True


def test_internal_s3_endpoint_localhost() -> None:
    assert is_internal_s3_endpoint("http://localhost:9000") is True
    assert is_internal_s3_endpoint("http://127.0.0.1:9000") is True
    assert is_internal_s3_endpoint("http://[::1]:9000") is True


def test_internal_s3_endpoint_private_rfc1918() -> None:
    assert is_internal_s3_endpoint("http://10.0.1.20:9000") is True
    assert is_internal_s3_endpoint("http://172.18.0.5:9000") is True
    assert is_internal_s3_endpoint("http://192.168.1.50:9000") is True


def test_internal_s3_endpoint_dot_local_and_internal() -> None:
    assert is_internal_s3_endpoint("http://storage.local:9000") is True
    assert is_internal_s3_endpoint("http://minio.internal:9000") is True


def test_internal_s3_endpoint_public_cloud() -> None:
    assert is_internal_s3_endpoint("https://s3.amazonaws.com") is False
    assert is_internal_s3_endpoint("https://acc.r2.cloudflarestorage.com") is False
    assert is_internal_s3_endpoint("https://storage.googleapis.com") is False


@pytest.mark.asyncio
async def test_public_endpoint_override(
    api_db: ApiDb, mock_s3: _MockS3Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SUITEST_S3_PUBLIC_ENDPOINT", "https://cdn.example.com")
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="pub-override@example.com",
        slug="pub-override",
        artifact_url="s3://suitest-artifacts/runs/r1/shot.png",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert "https://cdn.example.com" in data["url"]


@pytest.mark.asyncio
async def test_force_gateway_override(
    api_db: ApiDb, mock_s3: _MockS3Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SUITEST_S3_ENDPOINT", "https://s3.amazonaws.com")
    monkeypatch.setenv("SUITEST_S3_FORCE_GATEWAY", "true")
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="force-gw@example.com",
        slug="force-gw",
        artifact_url="s3://suitest-artifacts/runs/r1/shot.png",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw" in data["url"]
    assert "token=" in data["url"]


# ==============================================================================
# Group B: HMAC Media Token Lifecycle & Tampering Edge Cases
# ==============================================================================


def test_media_token_success() -> None:
    now = int(time.time())
    token = create_media_token("r1", "a1", "w1", now + 300)
    assert verify_media_token(token, "r1", "a1", "w1") is True


def test_media_token_expired() -> None:
    now = int(time.time())
    token = create_media_token("r1", "a1", "w1", now - 10)
    assert verify_media_token(token, "r1", "a1", "w1") is False


def test_media_token_tampered_signature() -> None:
    now = int(time.time())
    token = create_media_token("r1", "a1", "w1", now + 300)
    tampered = token[:-4] + "dead"
    assert verify_media_token(tampered, "r1", "a1", "w1") is False


def test_media_token_mismatched_artifact_id() -> None:
    now = int(time.time())
    token = create_media_token("r1", "a1", "w1", now + 300)
    assert verify_media_token(token, "r1", "a2", "w1") is False


def test_media_token_mismatched_run_id() -> None:
    now = int(time.time())
    token = create_media_token("r1", "a1", "w1", now + 300)
    assert verify_media_token(token, "r2", "a1", "w1") is False


def test_media_token_mismatched_workspace_id() -> None:
    now = int(time.time())
    token = create_media_token("r1", "a1", "w1", now + 300)
    assert verify_media_token(token, "r1", "a1", "w2") is False


def test_media_token_wrong_secret() -> None:
    now = int(time.time())
    token = create_media_token("r1", "a1", "w1", now + 300, secret="secret-alpha")
    assert verify_media_token(token, "r1", "a1", "w1", secret="secret-beta") is False


def test_media_token_empty_and_garbage_strings() -> None:
    assert verify_media_token(None, "r1", "a1", "w1") is False
    assert verify_media_token("", "r1", "a1", "w1") is False
    assert verify_media_token("garbage", "r1", "a1", "w1") is False
    assert verify_media_token("abc.def", "r1", "a1", "w1") is False
    assert verify_media_token(".12345", "r1", "a1", "w1") is False
    assert verify_media_token("9999999999.", "r1", "a1", "w1") is False


# ==============================================================================
# Group C: HTTP Range & Video Scrubbing Parser
# ==============================================================================


def test_range_standard_slice() -> None:
    assert _parse_http_range("bytes=0-499", 1000) == (0, 499)


def test_range_open_ended() -> None:
    assert _parse_http_range("bytes=500-", 1000) == (500, 999)


def test_range_suffix() -> None:
    assert _parse_http_range("bytes=-200", 1000) == (800, 999)


def test_range_start_out_of_bounds() -> None:
    with pytest.raises(Exception) as exc_info:
        _parse_http_range("bytes=2000-3000", 1000)
    assert getattr(exc_info.value, "status_code", None) == 416


def test_range_inverted_order() -> None:
    with pytest.raises(Exception) as exc_info:
        _parse_http_range("bytes=500-200", 1000)
    assert getattr(exc_info.value, "status_code", None) == 416


def test_range_multipart_protection() -> None:
    with pytest.raises(Exception) as exc_info:
        _parse_http_range("bytes=0-10, 20-30", 1000)
    assert getattr(exc_info.value, "status_code", None) == 416


def test_range_malformed_ignored() -> None:
    assert _parse_http_range("bytes=foo-bar", 1000) is None
    assert _parse_http_range("invalid-header", 1000) is None


# ==============================================================================
# Group D: Caching & ETag (304 Not Modified)
# ==============================================================================


@pytest.mark.asyncio
async def test_etag_generated_on_first_request(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/test.png"] = (
        b"\x89PNG-12345",
        "image/png",
        "etag-v1",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="etag-gen@example.com",
        slug="etag-gen",
        artifact_url="s3://suitest-artifacts/runs/r1/test.png",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 200
    assert "etag" in resp.headers
    assert "etag-v1" in resp.headers["etag"]
    assert "max-age" in resp.headers.get("cache-control", "")


@pytest.mark.asyncio
async def test_etag_304_not_modified(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/test.png"] = (
        b"\x89PNG-12345",
        "image/png",
        "etag-match",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="etag-304@example.com",
        slug="etag-304",
        artifact_url="s3://suitest-artifacts/runs/r1/test.png",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id, "If-None-Match": '"etag-match"'},
        )
    assert resp.status_code == 304
    assert len(resp.content) == 0


@pytest.mark.asyncio
async def test_etag_mismatched_returns_fresh(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/test.png"] = (
        b"\x89PNG-fresh",
        "image/png",
        "etag-fresh",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="etag-mismatch@example.com",
        slug="etag-mismatch",
        artifact_url="s3://suitest-artifacts/runs/r1/test.png",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id, "If-None-Match": '"old-stale-etag"'},
        )
    assert resp.status_code == 200
    assert resp.content == b"\x89PNG-fresh"
    assert "etag-fresh" in resp.headers["etag"]


# ==============================================================================
# Group E: MIME Type Whitelisting & Content-Disposition
# ==============================================================================


@pytest.mark.asyncio
async def test_mime_safe_images_inline(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/shot.webp"] = (
        b"WEBP-DATA",
        "image/webp",
        "etag-webp",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="mime-img@example.com",
        slug="mime-img",
        artifact_url="s3://suitest-artifacts/runs/r1/shot.webp",
        mime_type="image/webp",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 200
    assert resp.headers["content-disposition"].startswith("inline")


@pytest.mark.asyncio
async def test_mime_safe_videos_inline(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/vid.mp4"] = (
        b"MP4-DATA",
        "video/mp4",
        "etag-mp4",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="mime-vid@example.com",
        slug="mime-vid",
        artifact_url="s3://suitest-artifacts/runs/r1/vid.mp4",
        mime_type="video/mp4",
        kind=ArtifactKind.VIDEO,
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 200
    assert resp.headers["content-disposition"].startswith("inline")
    assert "media-src 'self'" in resp.headers.get("content-security-policy", "")


@pytest.mark.asyncio
async def test_mime_dangerous_svg_attachment(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/shot.svg"] = (
        b"<svg></svg>",
        "image/svg+xml",
        "etag-svg",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="mime-svg@example.com",
        slug="mime-svg",
        artifact_url="s3://suitest-artifacts/runs/r1/shot.svg",
        mime_type="image/svg+xml",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 200
    assert resp.headers["content-disposition"].startswith("attachment")
    assert "sandbox" in resp.headers.get("content-security-policy", "")


@pytest.mark.asyncio
async def test_mime_dangerous_html_attachment(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/report.html"] = (
        b"<html></html>",
        "text/html",
        "etag-html",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="mime-html@example.com",
        slug="mime-html",
        artifact_url="s3://suitest-artifacts/runs/r1/report.html",
        mime_type="text/html",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 200
    assert resp.headers["content-disposition"].startswith("attachment")


@pytest.mark.asyncio
async def test_query_param_download_forces_attachment(
    api_db: ApiDb, mock_s3: _MockS3Client
) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/shot.png"] = (
        b"\x89PNG-IMG",
        "image/png",
        "etag-png",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="mime-down@example.com",
        slug="mime-down",
        artifact_url="s3://suitest-artifacts/runs/r1/shot.png",
        mime_type="image/png",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw?download=true",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 200
    assert resp.headers["content-disposition"].startswith("attachment")


# ==============================================================================
# Group F: Tenancy Isolation, Anti-SSRF, & Auth Multi-Client
# ==============================================================================


@pytest.mark.asyncio
async def test_cross_workspace_blocked(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    _user_a, _ws_a, run_a, art_a = await _seed_hierarchy(
        api_db,
        email="cross-a@example.com",
        slug="cross-ws-a",
        artifact_url="s3://suitest-artifacts/runs/r1/shot.png",
    )
    user_b = await api_db.seed_user(email="cross-b@example.com")
    ws_b = await api_db.member_workspace(user_b, slug="cross-ws-b")

    # User B attempts to access Workspace A's artifact
    async with api_db.client(user_b) as c:
        resp = await c.get(
            f"/api/v1/runs/{run_a.id}/artifacts/{art_a.id}/raw",
            headers={"X-Workspace-Id": ws_b.id},
        )
    assert resp.status_code in (403, 404)


@pytest.mark.asyncio
async def test_foreign_s3_bucket_blocked(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="ssrf-bucket@example.com",
        slug="ssrf-bucket",
        artifact_url="s3://foreign-company-bucket/secret.png",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_key_path_traversal_blocked(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="ssrf-trav@example.com",
        slug="ssrf-trav",
        artifact_url="s3://suitest-artifacts/runs/../../etc/passwd",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_auth_via_session_cookie(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/cookie.png"] = (
        b"COOKIE-DATA",
        "image/png",
        "etag-cookie",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="auth-cookie@example.com",
        slug="auth-cookie",
        artifact_url="s3://suitest-artifacts/runs/r1/cookie.png",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw?workspaceId={ws.id}",
        )
    assert resp.status_code == 200
    assert resp.content == b"COOKIE-DATA"


@pytest.mark.asyncio
async def test_auth_via_hmac_token(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/token.png"] = (
        b"TOKEN-DATA",
        "image/png",
        "etag-token",
    )
    _user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="auth-token@example.com",
        slug="auth-token",
        artifact_url="s3://suitest-artifacts/runs/r1/token.png",
    )
    now = int(time.time())
    token = create_media_token(run.id, art.id, ws.id, now + 300)

    # Completely unauthenticated client (no cookie, no session)
    async with api_db.client(None) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw?workspaceId={ws.id}&token={token}&expires={now + 300}"
        )
    assert resp.status_code == 200
    assert resp.content == b"TOKEN-DATA"


@pytest.mark.asyncio
async def test_auth_via_api_key(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    from suitest_api.services.api_key_service import create_api_key

    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="auth-key@example.com",
        slug="auth-key",
        artifact_url="s3://suitest-artifacts/runs/r1/key.png",
    )
    async with api_db.maker() as session:
        _, raw_key = await create_api_key(
            session,
            workspace_id=ws.id,
            user_id=str(user.id),
            name="CI Key",
        )
        await session.commit()

    # Unauthenticated client using X-API-Key
    async with api_db.client(None) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}",
            headers={"X-API-Key": raw_key},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert "token=" in data["url"]


@pytest.mark.asyncio
async def test_auth_unauthenticated_rejected(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    _user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="auth-none@example.com",
        slug="auth-none",
        artifact_url="s3://suitest-artifacts/runs/r1/none.png",
    )
    async with api_db.client(None) as c:
        resp = await c.get(f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw?workspaceId={ws.id}")
    assert resp.status_code == 401


# ==============================================================================
# Group G: Backward Compatibility (Legacy Schemas)
# ==============================================================================


@pytest.mark.asyncio
async def test_legacy_file_scheme(
    api_db: ApiDb, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SUITEST_ARTIFACTS_DIR", str(tmp_path))
    file_path = tmp_path / "legacy_fixture.png"
    file_path.write_bytes(b"\x89PNG-legacy-file")

    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="legacy-file@example.com",
        slug="legacy-file",
        artifact_url=f"file://{file_path}",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 200
    assert resp.content == b"\x89PNG-legacy-file"


@pytest.mark.asyncio
async def test_file_scheme_outside_root_blocked(
    api_db: ApiDb, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root_dir = tmp_path / "artifacts"
    root_dir.mkdir()
    monkeypatch.setenv("SUITEST_ARTIFACTS_DIR", str(root_dir))

    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    outside_file = outside_dir / "secret.txt"
    outside_file.write_bytes(b"SECRET_DATA")

    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="outside-root@example.com",
        slug="outside-root",
        artifact_url=f"file://{outside_file}",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_double_encoded_path_traversal_blocked(api_db: ApiDb) -> None:
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="double-traversal@example.com",
        slug="double-traversal",
        artifact_url="s3://suitest-artifacts/runs/%252e%252e/secret.png",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 400
    assert "invalid key path" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_s3_storage_error_returns_502(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.error_on_head = RuntimeError("MinIO connection reset")
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="s3-down@example.com",
        slug="s3-down",
        artifact_url="s3://suitest-artifacts/runs/r1/shot.png",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 502
    assert resp.json()["detail"] == "storage backend unavailable"


@pytest.mark.asyncio
async def test_local_scheme(api_db: ApiDb, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUITEST_ARTIFACTS_DIR", str(tmp_path))
    local_rel = "runs/r1/local_shot.png"
    target_file = tmp_path / local_rel
    target_file.parent.mkdir(parents=True, exist_ok=True)
    target_file.write_bytes(b"\x89PNG-local-compat")

    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="local-compat@example.com",
        slug="local-compat",
        artifact_url=f"local://{local_rel}",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 200
    assert resp.content == b"\x89PNG-local-compat"


@pytest.mark.asyncio
async def test_malformed_s3_url_without_slash_rejected(api_db: ApiDb) -> None:
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="malformed-s3@example.com",
        slug="malformed-s3",
        artifact_url="s3://bucketonlywithoutkey",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 400
    assert "invalid s3 url" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_empty_s3_key_rejected(api_db: ApiDb) -> None:
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="empty-key@example.com",
        slug="empty-key",
        artifact_url="s3://suitest-artifacts/",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 400
    assert "invalid key path" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_etag_wildcard_and_multi_match(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/etag-wild.png"] = (
        b"ETAG-DATA",
        "image/png",
        "etag-valid-123",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="etag-wild@example.com",
        slug="etag-wild",
        artifact_url="s3://suitest-artifacts/runs/r1/etag-wild.png",
    )
    async with api_db.client(user) as c:
        # Wildcard *
        resp_wild = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id, "If-None-Match": "*"},
        )
        assert resp_wild.status_code == 304

        # Multi-etag comma separated list
        resp_multi = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id, "If-None-Match": '"other-etag", "etag-valid-123"'},
        )
        assert resp_multi.status_code == 304


@pytest.mark.asyncio
async def test_case_insensitive_range_header(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/range-case.bin"] = (
        b"0123456789ABCDEF",
        "application/octet-stream",
        "etag-range",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="range-case@example.com",
        slug="range-case",
        artifact_url="s3://suitest-artifacts/runs/r1/range-case.bin",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id, "Range": "BYTES=0-3"},
        )
    assert resp.status_code == 206
    assert resp.content == b"0123"


def test_internal_s3_endpoint_link_local_and_unspecified() -> None:
    assert is_internal_s3_endpoint("http://169.254.169.254:9000") is True
    assert is_internal_s3_endpoint("http://0.0.0.0:9000") is True


@pytest.mark.asyncio
async def test_key_url_encoded_path_traversal_blocked(
    api_db: ApiDb, mock_s3: _MockS3Client
) -> None:
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="traversal-s3@example.com",
        slug="traversal-s3",
        artifact_url="s3://suitest-artifacts/runs/%2e%2e/%2e%2e/etc/passwd",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 400
    assert "invalid key path" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_local_url_encoded_path_traversal_blocked(
    api_db: ApiDb,
) -> None:
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="traversal-local@example.com",
        slug="traversal-local",
        artifact_url="local://%2e%2e/%2e%2e/etc/passwd",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 404
    assert "artifact not found" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_access_control_expose_headers_present(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/expose.png"] = (
        b"PNG-DATA",
        "image/png",
        "etag-expose",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="expose@example.com",
        slug="expose",
        artifact_url="s3://suitest-artifacts/runs/r1/expose.png",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 200
    expose = resp.headers.get("Access-Control-Expose-Headers", "")
    assert "Content-Range" in expose
    assert "Accept-Ranges" in expose
    assert "Content-Length" in expose
    assert "ETag" in expose


@pytest.mark.asyncio
async def test_range_header_too_long_rejected(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/long-range.bin"] = (
        b"0123456789",
        "application/octet-stream",
        "etag-lr",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="long-range@example.com",
        slug="long-range",
        artifact_url="s3://suitest-artifacts/runs/r1/long-range.bin",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id, "Range": "bytes=" + "0" * 600},
        )
    assert resp.status_code == 400
    assert "Range header too long" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_range_header_whitespace_tolerance(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/ws-range.bin"] = (
        b"0123456789ABCDEF",
        "application/octet-stream",
        "etag-ws",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="ws-range@example.com",
        slug="ws-range",
        artifact_url="s3://suitest-artifacts/runs/r1/ws-range.bin",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id, "Range": "bytes = 0 - 3"},
        )
    assert resp.status_code == 206
    assert resp.content == b"0123"


@pytest.mark.asyncio
async def test_if_range_matching_and_mismatched(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/ifrange.bin"] = (
        b"0123456789",
        "application/octet-stream",
        "etag-ifrange-current",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="ifrange@example.com",
        slug="ifrange",
        artifact_url="s3://suitest-artifacts/runs/r1/ifrange.bin",
    )
    async with api_db.client(user) as c:
        # Matching If-Range -> 206 Partial Content
        resp_match = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={
                "X-Workspace-Id": ws.id,
                "Range": "bytes=0-3",
                "If-Range": '"etag-ifrange-current"',
            },
        )
        assert resp_match.status_code == 206
        assert resp_match.content == b"0123"

        # Mismatched If-Range -> 200 OK full content per RFC 9110 Section 13.1.8
        resp_mismatch = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={
                "X-Workspace-Id": ws.id,
                "Range": "bytes=0-3",
                "If-Range": '"etag-old-outdated"',
            },
        )
        assert resp_mismatch.status_code == 200
        assert resp_mismatch.content == b"0123456789"


@pytest.mark.asyncio
async def test_head_method_request(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/head-test.webm"] = (
        b"WEBM-VIDEO-STREAM-PAYLOAD",
        "video/webm",
        "etag-head-001",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="head-test@example.com",
        slug="head-test",
        artifact_url="s3://suitest-artifacts/runs/r1/head-test.webm",
        mime_type="video/webm",
        kind=ArtifactKind.VIDEO,
    )
    async with api_db.client(user) as c:
        resp = await c.head(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 200
    assert resp.content == b""
    assert resp.headers["Content-Type"].startswith("video/webm")
    assert resp.headers["Accept-Ranges"] == "bytes"
    assert resp.headers["Content-Length"] == str(len(b"WEBM-VIDEO-STREAM-PAYLOAD"))


@pytest.mark.asyncio
async def test_get_artifact_signed_url_external_bucket_forbidden(
    api_db: ApiDb,
) -> None:
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="ext-bucket@example.com",
        slug="ext-bucket",
        artifact_url="s3://evil-attacker-bucket/runs/r1/leak.png",
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 403
    assert "access to external bucket forbidden" in resp.json()["detail"]


def test_safe_filename_hardening() -> None:
    # Strips CRLF, non-ascii, quotes, path separators
    assert _safe_filename("path/to/my video\r\n.webm") == "my video.webm"
    assert _safe_filename('file"with"quotes.mp4') == "filewithquotes.mp4"
    assert _safe_filename("test\x00file.png") == "testfile.png"
    # Unicode stripped to ensure clean ASCII header
    assert _safe_filename("vidéo_café.mp4") == "vido_caf.mp4"
    # Long filename truncated to 128 chars
    long_name = "a" * 200 + ".webm"
    cleaned = _safe_filename(long_name)
    assert len(cleaned) <= 128


@pytest.mark.asyncio
async def test_security_logging_on_access_rejections(
    api_db: ApiDb, caplog: pytest.LogCaptureFixture
) -> None:
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="sec-log@example.com",
        slug="sec-log",
        artifact_url="s3://suitest-artifacts/runs/r1/sec.png",
    )
    with caplog.at_level(logging.WARNING):
        async with api_db.client(user) as c:
            resp = await c.get(
                f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw?workspaceId={ws.id}&token=invalid-token"
            )
        assert resp.status_code == 401
        assert any("invalid or expired media token" in r.message for r in caplog.records)


@pytest.mark.asyncio
async def test_immutable_cache_control_on_terminal_runs(
    api_db: ApiDb, mock_s3: _MockS3Client
) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/final.png"] = (
        b"PNG-DATA",
        "image/png",
        "etag-final",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="cache-term@example.com",
        slug="cache-term",
        artifact_url="s3://suitest-artifacts/runs/r1/final.png",
    )
    # Set run status to PASS (terminal)
    async with api_db.maker() as s:
        db_run = await s.get(Run, run.id)
        assert db_run is not None
        db_run.status = RunStatus.PASS
        await s.commit()

    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 200
    assert resp.headers["cache-control"] == "private, max-age=86400, immutable"


@pytest.mark.asyncio
async def test_rfc5987_filename_header(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/vidéo_café.mp4"] = (
        b"VIDEO-DATA",
        "video/mp4",
        "etag-video-utf8",
    )
    user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="utf8-fn@example.com",
        slug="utf8-fn",
        artifact_url="s3://suitest-artifacts/runs/r1/vidéo_café.mp4",
        mime_type="video/mp4",
        kind=ArtifactKind.VIDEO,
    )
    async with api_db.client(user) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw",
            headers={"X-Workspace-Id": ws.id},
        )
    assert resp.status_code == 200
    cd = resp.headers["content-disposition"]
    assert 'filename="vido_caf.mp4"' in cd
    assert "filename*=UTF-8''vid%C3%A9o_caf%C3%A9.mp4" in cd


@pytest.mark.asyncio
async def test_token_stream_audit_log_created(api_db: ApiDb, mock_s3: _MockS3Client) -> None:
    mock_s3.objects["suitest-artifacts/runs/r1/audit_stream.png"] = (
        b"AUDIT-STREAM-PNG",
        "image/png",
        "etag-audit-stream",
    )
    _user, ws, run, art = await _seed_hierarchy(
        api_db,
        email="token-audit@example.com",
        slug="token-audit",
        artifact_url="s3://suitest-artifacts/runs/r1/audit_stream.png",
    )
    now = int(time.time())
    token = create_media_token(run.id, art.id, ws.id, now + 300)
    async with api_db.client(None) as c:
        resp = await c.get(
            f"/api/v1/runs/{run.id}/artifacts/{art.id}/raw?workspaceId={ws.id}&token={token}&expires={now + 300}",
        )
    assert resp.status_code == 200
    assert resp.content == b"AUDIT-STREAM-PNG"

    async with api_db.maker() as s:
        stmt = select(AuditLog).where(
            AuditLog.workspace_id == ws.id,
            AuditLog.action == "artifact.stream",
            AuditLog.resource_id == art.id,
        )
        res = await s.execute(stmt)
        logs = res.scalars().all()
        assert len(logs) == 1
        assert logs[0].metadata["token_auth"] is True
        assert logs[0].metadata["run_id"] == run.id


@pytest.mark.asyncio
async def test_media_token_domain_separation() -> None:
    import hashlib
    import hmac

    # Raw HMAC without domain separation must NOT validate against create_media_token
    raw_secret = "dev-secret-change-me"
    now = int(time.time()) + 300
    payload = f"2:r1:2:a1:2:w1:{now}".encode()
    forged_sig = hmac.new(raw_secret.encode(), payload, hashlib.sha256).hexdigest()
    forged_token = f"{now}.{forged_sig}"

    # Verify fails because create/verify_media_token uses domain-separated key
    assert not verify_media_token(forged_token, "r1", "a1", "w1", expires_at=now, secret=raw_secret)

    valid_token = create_media_token("r1", "a1", "w1", now, secret=raw_secret)
    assert verify_media_token(valid_token, "r1", "a1", "w1", expires_at=now, secret=raw_secret)
