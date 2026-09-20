"""read_bytes and file_storage boundary enforcement tests (no S3 needed)."""

from __future__ import annotations

from pathlib import Path

import pytest
from suitest_api.services import file_storage


@pytest.mark.asyncio
async def test_read_bytes_file_scheme(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUITEST_ARTIFACTS_DIR", str(tmp_path))
    p = tmp_path / "shot.png"
    p.write_bytes(b"\x89PNGdata")
    got = await file_storage.read_bytes(f"file://{p}")
    assert got == b"\x89PNGdata"


@pytest.mark.asyncio
async def test_read_bytes_file_boundary_enforcement(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    art_dir = tmp_path / "artifacts"
    art_dir.mkdir()
    monkeypatch.setenv("SUITEST_ARTIFACTS_DIR", str(art_dir))

    outside = tmp_path / "secret.txt"
    outside.write_bytes(b"sensitive")

    # Direct access outside artifacts root
    assert await file_storage.read_bytes(f"file://{outside}") is None

    # Path traversal escaping artifacts root
    assert await file_storage.read_bytes(f"file://{art_dir}/../secret.txt") is None
    assert await file_storage.read_bytes(f"file://{art_dir}/%2e%2e/secret.txt") is None

    # Null byte injection
    assert await file_storage.read_bytes(f"file://{art_dir}/shot.png\x00.evil") is None


@pytest.mark.asyncio
async def test_read_bytes_local_scheme(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUITEST_ARTIFACTS_DIR", str(tmp_path))
    key = "uploads/ws1/abc/shot.png"
    target = tmp_path / key
    target.parent.mkdir(parents=True)
    target.write_bytes(b"localbytes")
    got = await file_storage.read_bytes(f"local://{key}")
    assert got == b"localbytes"


@pytest.mark.asyncio
async def test_read_bytes_local_boundary_enforcement(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    art_dir = tmp_path / "artifacts"
    art_dir.mkdir()
    monkeypatch.setenv("SUITEST_ARTIFACTS_DIR", str(art_dir))

    outside = tmp_path / "secret.txt"
    outside.write_bytes(b"sensitive")

    # Path traversal via local://
    assert await file_storage.read_bytes("local://../secret.txt") is None
    assert await file_storage.read_bytes("local://%2e%2e/secret.txt") is None
    assert await file_storage.read_bytes("local://sub/\x00secret.txt") is None


@pytest.mark.asyncio
async def test_read_bytes_s3_scheme_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUITEST_S3_BUCKET", "suitest-bucket")

    # Wrong bucket
    assert await file_storage.read_bytes("s3://other-bucket/runs/1/shot.png") is None

    # Traversal in S3 key
    assert await file_storage.read_bytes("s3://suitest-bucket/runs/../etc/passwd") is None
    assert await file_storage.read_bytes("s3://suitest-bucket/runs/..\\etc/passwd") is None

    # Unapproved prefix
    assert await file_storage.read_bytes("s3://suitest-bucket/private-keys/id_rsa") is None


@pytest.mark.asyncio
async def test_read_bytes_missing_returns_none(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SUITEST_ARTIFACTS_DIR", str(tmp_path))
    got = await file_storage.read_bytes(f"file://{tmp_path / 'nope.png'}")
    assert got is None


def test_local_path_boundary_enforcement(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    art_dir = tmp_path / "artifacts"
    art_dir.mkdir()
    monkeypatch.setenv("SUITEST_ARTIFACTS_DIR", str(art_dir))

    valid = file_storage.local_path("uploads/ws1/file.png")
    assert valid == (art_dir / "uploads/ws1/file.png").resolve()

    with pytest.raises(ValueError, match="escapes artifacts directory"):
        file_storage.local_path("../secret.txt")

    with pytest.raises(ValueError, match="escapes artifacts directory"):
        file_storage.local_path("uploads/../../secret.txt")


def test_key_in_workspace_traversal_detection() -> None:
    assert file_storage.key_in_workspace("uploads/ws1/sub/pic.png", "ws1") is True
    assert file_storage.key_in_workspace("uploads/ws2/sub/pic.png", "ws1") is False
    assert file_storage.key_in_workspace("uploads/ws1/../ws2/pic.png", "ws1") is False
    assert file_storage.key_in_workspace("uploads/ws1/%2e%2e/pic.png", "ws1") is False
    assert file_storage.key_in_workspace("uploads/ws1/..\\pic.png", "ws1") is False
    assert file_storage.key_in_workspace("uploads/ws1/\x00pic.png", "ws1") is False
