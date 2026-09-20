"""Server-side object storage for lifecycle / MCP uploads.

Lets an API-key client (the lifecycle publisher, an IDE's MCP server, CI) push
artifact bytes — videos, per-step screenshots — into the platform's object store
WITHOUT holding any ``SUITEST_S3_*`` credentials itself. The server owns the S3
config; the client only holds its API key. This keeps object-store secrets out
of every ``.mcp.json`` / CI environment.

Every object is namespaced under the caller's workspace
(``uploads/<workspace_id>/…``) so a key can only ever sign or delete its OWN
uploads — the read/delete paths reject any key outside that prefix.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import time
import uuid
from collections.abc import AsyncIterator
from io import BytesIO
from pathlib import Path
from typing import Any, BinaryIO
from urllib.parse import quote, urlparse

import aioboto3
import anyio

from suitest_api.settings import get_settings

SIGNED_URL_TTL_SECONDS = 3600
UPLOAD_ROOT = "uploads"


def is_internal_s3_endpoint(endpoint_url: str) -> bool:
    """True iff the S3 endpoint is an internal/Docker/private address.

    Detects:
    - localhost, 127.0.0.1, [::1], 0.0.0.0
    - dotless hostnames (Docker service names like 'minio')
    - hostnames ending in .local or .internal
    - RFC1918 private IPv4 addresses (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
    - Link-local (169.254.0.0/16) and IPv6 loopback / unique local addresses
    """
    if not endpoint_url or not isinstance(endpoint_url, str):
        return False
    try:
        endpoint_url = endpoint_url.strip()
        if "://" not in endpoint_url:
            endpoint_url = f"http://{endpoint_url}"
        parsed = urlparse(endpoint_url)
        hostname = parsed.hostname
        if not hostname:
            return False
        hostname = hostname.lower()
        if hostname in {"localhost", "minio"}:
            return True
        if hostname.endswith((".local", ".internal")):
            return True
        if "." not in hostname and not hostname.startswith("["):
            return True
        try:
            raw_ip = hostname.strip("[]")
            ip = ipaddress.ip_address(raw_ip)
            return bool(ip.is_loopback or ip.is_private or ip.is_unspecified or ip.is_link_local)
        except ValueError:
            return False
    except Exception:
        return False


def create_media_token(
    run_id: str,
    artifact_id: str,
    workspace_id: str,
    expires_at: int,
    *,
    secret: str | None = None,
) -> str:
    """Create a tamper-proof HMAC token for raw artifact streaming."""
    key = (secret if secret is not None else get_settings().auth_secret).encode()
    payload = (
        f"{len(run_id)}:{run_id}:{len(artifact_id)}:{artifact_id}:"
        f"{len(workspace_id)}:{workspace_id}:{expires_at}"
    ).encode()
    sig = hmac.new(key, payload, hashlib.sha256).hexdigest()
    return f"{expires_at}.{sig}"


def verify_media_token(
    token: str | None,
    run_id: str,
    artifact_id: str,
    workspace_id: str,
    *,
    expires_at: int | None = None,
    secret: str | None = None,
) -> bool:
    """Verify an HMAC media token against run, artifact, workspace, and expiry."""
    if not token or not isinstance(token, str):
        return False
    try:
        exp: int
        sig: str
        if "." in token:
            exp_part, sig = token.split(".", 1)
            exp = int(exp_part)
            if expires_at is not None and exp != expires_at:
                return False
        elif expires_at is not None:
            exp = expires_at
            sig = token
        else:
            return False

        current_ts = int(time.time())
        if current_ts > exp:
            return False

        key = (secret if secret is not None else get_settings().auth_secret).encode()
        expected_payload = (
            f"{len(run_id)}:{run_id}:{len(artifact_id)}:{artifact_id}:"
            f"{len(workspace_id)}:{workspace_id}:{exp}"
        ).encode()
        expected_sig = hmac.new(key, expected_payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(sig, expected_sig)
    except Exception:
        return False


def local_path(key: str) -> Path:
    """Absolute path a workspace-scoped key resolves to under ``artifacts_dir``.

    Uploads share the runner's artifacts root so the existing ``local://``
    read paths (``GET /runs/:id/artifacts/:id/raw``) serve them unchanged.
    """
    return Path(get_settings().artifacts_dir).resolve() / key


def workspace_prefix(workspace_id: str) -> str:
    """S3 key prefix that scopes every object to one workspace."""
    return f"{UPLOAD_ROOT}/{workspace_id}/"


def key_in_workspace(key: str, workspace_id: str) -> bool:
    """True iff ``key`` is a well-formed object under the workspace's prefix."""
    return key.startswith(workspace_prefix(workspace_id)) and ".." not in key


def object_id(key: str) -> str:
    """Short (≤64-char) id for a key — the uuid segment, for audit ``resource_id``."""
    parts = key.split("/")
    return parts[2] if len(parts) >= 3 else key[:64]


def _safe_name(name: str) -> str:
    """Reduce a client filename to a safe basename (no path, no separators)."""
    base = name.replace("\\", "/").split("/")[-1]
    cleaned = "".join(c for c in base if c.isalnum() or c in "._-")
    return cleaned or "file"


async def upload(
    *, workspace_id: str, filename: str, data: bytes, content_type: str
) -> tuple[str, str, int]:
    """Store bytes under the workspace prefix; return ``(url, key, size)``.

    ``server`` mode puts the object in S3 and returns an ``s3://`` URL. ``local``
    mode (npx bundle — no MinIO) writes under ``artifacts_dir`` and returns a
    ``local://`` URL, which the runs artifact routes already know how to serve.
    """
    return await upload_fileobj(
        workspace_id=workspace_id,
        filename=filename,
        source=BytesIO(data),
        size=len(data),
        content_type=content_type,
    )


async def upload_fileobj(
    *,
    workspace_id: str,
    filename: str,
    source: BinaryIO,
    size: int,
    content_type: str,
) -> tuple[str, str, int]:
    """Store a seekable stream without materialising it as one giant ``bytes``.

    Starlette spools large multipart parts to disk. Keeping that stream intact
    bounds API memory for both local SQLite/disk installs and S3 deployments.
    """
    settings = get_settings()
    key = f"{workspace_prefix(workspace_id)}{uuid.uuid4().hex}/{_safe_name(filename)}"
    if settings.mode == "local":
        path = local_path(key)
        source.seek(0)

        def _copy() -> None:
            import shutil

            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("wb") as destination:
                shutil.copyfileobj(source, destination, length=1024 * 1024)

        await anyio.to_thread.run_sync(_copy)
        return f"local://{key}", key, size
    source.seek(0)
    async with aioboto3.Session().client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
    ) as client:
        await client.put_object(
            Bucket=settings.s3_bucket, Key=key, Body=source, ContentType=content_type
        )
    return f"s3://{settings.s3_bucket}/{key}", key, size


async def presign_get(key: str) -> str:
    """GET URL for an object the caller already owns.

    ``server`` mode presigns against S3; ``local`` mode has no presigning, so it
    returns the raw streaming route on this same API (auth-gated there).
    """
    settings = get_settings()
    if settings.mode == "local":
        return f"/api/v1/files/raw?key={quote(key, safe='')}"
    return await presign_s3_get(
        settings.s3_bucket,
        key,
        expires_in=SIGNED_URL_TTL_SECONDS,
    )


async def presign_s3_get(bucket: str, key: str, *, expires_in: int) -> str:
    """Generate a download URL using the API's canonical S3 configuration."""
    settings = get_settings()
    endpoint = settings.s3_public_endpoint or settings.s3_endpoint
    async with aioboto3.Session().client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
    ) as client:
        url: str = await client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires_in,
        )
    return url


async def get_s3_object_meta(bucket: str, key: str) -> tuple[int, str, str | None]:
    """Return (size_bytes, mime_type, etag) for an S3 object."""
    settings = get_settings()
    async with aioboto3.Session().client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
    ) as client:
        resp = await client.head_object(Bucket=bucket, Key=key)
        size = int(resp.get("ContentLength", 0))
        content_type = str(resp.get("ContentType") or "application/octet-stream")
        etag = resp.get("ETag")
        if etag:
            etag = etag.strip('"')
        return size, content_type, etag


async def stream_s3_artifact(
    bucket: str,
    key: str,
    start_byte: int = 0,
    end_byte: int | None = None,
    chunk_size: int = 64 * 1024,
) -> AsyncIterator[bytes]:
    """Async generator streaming chunks directly from S3."""
    settings = get_settings()
    get_kwargs: dict[str, Any] = {"Bucket": bucket, "Key": key}
    if start_byte > 0 or end_byte is not None:
        range_header = f"bytes={start_byte}-"
        if end_byte is not None:
            range_header += f"{end_byte}"
        get_kwargs["Range"] = range_header

    async with aioboto3.Session().client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
    ) as client:
        resp = await client.get_object(**get_kwargs)
        stream = resp["Body"]
        async with stream:
            while True:
                chunk = await stream.read(chunk_size)
                if not chunk:
                    break
                yield chunk


async def read_bytes(url: str) -> bytes | None:
    """Read an artifact's raw bytes from its stored URL.

    Handles the three schemes the platform writes: ``local://<key>`` (npx/disk),
    ``file://<abs-path>`` (runner-local artifacts) and ``s3://<bucket>/<key>``
    (object store). Returns ``None`` when the object is missing — a caller
    embedding evidence should degrade to "no screenshot", never 500.
    """
    if url.startswith("file://"):
        path = Path(url[len("file://") :])
        return await _read_local(path)
    if url.startswith("local://"):
        return await _read_local(local_path(url[len("local://") :]))
    if url.startswith("s3://"):
        _, _, rest = url.partition("s3://")
        bucket, _, key = rest.partition("/")
        settings = get_settings()
        async with aioboto3.Session().client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name=settings.s3_region,
        ) as client:
            try:
                obj = await client.get_object(Bucket=bucket, Key=key)
                async with obj["Body"] as stream:
                    data: bytes = await stream.read()
                return data
            except Exception:  # missing/denied object → degrade gracefully
                return None
    return None


async def _read_local(path: Path) -> bytes | None:
    def _read() -> bytes | None:
        try:
            return path.read_bytes()
        except OSError:
            return None

    return await anyio.to_thread.run_sync(_read)


async def delete(key: str) -> None:
    """Delete one owned object."""
    settings = get_settings()
    if settings.mode == "local":
        local_path(key).unlink(missing_ok=True)
        return
    async with aioboto3.Session().client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
    ) as client:
        await client.delete_object(Bucket=settings.s3_bucket, Key=key)
