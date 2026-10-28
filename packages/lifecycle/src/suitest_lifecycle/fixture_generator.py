"""Built-in Test Fixture Generator (suitest_create_dummy_file - Task 10).

Creates physically valid dummy files (PDF, ZIP, SHP, PNG/Image, GeoJSON)
with configurable size_kb and metadata for automated upload testing.
"""

from __future__ import annotations

import json
import struct
import zipfile
import zlib
from pathlib import Path
from typing import Any

from suitest_lifecycle.tool_result import envelope as _envelope


def _generate_pdf(out_path: Path, target_bytes: int, title: str = "Test Document") -> None:
    title_bytes = title.encode("utf-8")
    stream_content = b"BT /F1 24 Tf 100 700 Td (" + title_bytes + b") Tj ET"
    stream_len = len(stream_content)

    header = b"%PDF-1.4\n"
    obj1 = b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
    obj2 = b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
    obj3 = b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n"
    obj4 = (
        f"4 0 obj << /Length {stream_len} >> stream\n".encode("ascii")
        + stream_content
        + b"\nendstream\nendobj\n"
    )
    obj5 = b"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"

    body = header + obj1 + obj2 + obj3 + obj4 + obj5

    if len(body) < target_bytes - 180:
        pad_needed = target_bytes - 180 - len(body)
        body += b"% " + (b"0" * max(0, pad_needed)) + b"\n"
    offsets = [
        0,
        len(header),
        len(header + obj1),
        len(header + obj1 + obj2),
        len(header + obj1 + obj2 + obj3),
        len(header + obj1 + obj2 + obj3 + obj4),
    ]

    xref_offset = len(body)
    xref_entries = "".join(f"{off:010d} 00000 n \n" for off in offsets[1:])
    xref_table = f"xref\n0 6\n0000000000 65535 f \n{xref_entries}"
    trailer = f"trailer << /Size 6 /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n"
    final_data = body + xref_table.encode("ascii") + trailer.encode("ascii")
    if len(final_data) < target_bytes:
        final_data += b"% " + (b"0" * max(0, target_bytes - len(final_data) - 3)) + b"\n"
    out_path.write_bytes(final_data)


def _generate_zip(out_path: Path, target_bytes: int, filename: str) -> None:
    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr(
            "manifest.txt",
            f"Suitest Test Fixture: {filename}\nGenerated for automated form upload tests.\n",
        )
        needed = max(0, target_bytes - 200)
        if needed > 0:
            zf.writestr("payload.dat", b"0" * needed)


def _generate_shp(out_path: Path, target_bytes: int) -> None:
    # ESRI Shapefile 100-byte header:
    file_len_words = max(50, target_bytes // 2)
    header_be = struct.pack(">7i", 9994, 0, 0, 0, 0, 0, file_len_words)
    header_le = struct.pack("<2i8d", 1000, 1, 106.0, -6.0, 107.0, -5.0, 0.0, 0.0, 0.0, 0.0)
    raw = header_be + header_le
    if len(raw) < target_bytes:
        raw += b"\x00" * (target_bytes - len(raw))
    out_path.write_bytes(raw)


def _generate_image(out_path: Path, target_bytes: int) -> None:
    signature = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    ihdr_crc = struct.pack(">I", zlib.crc32(b"IHDR" + ihdr_data))
    ihdr = struct.pack(">I", 13) + b"IHDR" + ihdr_data + ihdr_crc

    raw_pixels = b"\x00\xff\x00\x00"
    compressed = zlib.compress(raw_pixels)
    idat_crc = struct.pack(">I", zlib.crc32(b"IDAT" + compressed))
    idat = struct.pack(">I", len(compressed)) + b"IDAT" + compressed + idat_crc

    iend = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", zlib.crc32(b"IEND"))
    base_png = signature + ihdr + idat + iend

    if len(base_png) < target_bytes:
        pad_needed = target_bytes - len(base_png)
        text_data = b"Comment\x00" + (b"P" * max(0, pad_needed - 20))
        text_crc = struct.pack(">I", zlib.crc32(b"tEXt" + text_data))
        text_chunk = struct.pack(">I", len(text_data)) + b"tEXt" + text_data + text_crc
        final_png = signature + ihdr + text_chunk + idat + iend
    else:
        final_png = base_png
    out_path.write_bytes(final_png)


def _generate_geojson(out_path: Path, target_bytes: int, filename: str) -> None:
    obj: dict[str, Any] = {
        "type": "FeatureCollection",
        "name": filename,
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [106.8456, -6.2088]},
                "properties": {"name": "Test Point", "id": 1},
            }
        ],
    }
    raw = json.dumps(obj, indent=2).encode("utf-8")
    if len(raw) < target_bytes:
        needed = max(0, target_bytes - len(raw))
        obj["features"][0]["properties"]["padding"] = "X" * needed
        raw = json.dumps(obj, indent=2).encode("utf-8")
    if len(raw) < target_bytes:
        raw += b"\n" + (b" " * max(0, target_bytes - len(raw) - 1)) + b"\n"
    out_path.write_bytes(raw)


def create_dummy_file(
    file_type: str,
    filename: str,
    size_kb: int = 1024,
    output_dir: str = "suitest-output/fixtures",
    metadata: dict[str, str] | None = None,
) -> Path:
    """Generate a physically valid dummy file of the requested format and size."""
    t = (file_type or "pdf").lower().strip(".")
    if t not in ("pdf", "zip", "shp", "image", "png", "jpg", "jpeg", "geojson"):
        raise ValueError(
            f"Unsupported fixture file_type '{file_type}'. Supported: pdf, zip, shp, image, geojson"
        )
    if size_kb < 1:
        size_kb = 1
    if size_kb > 51200:
        raise ValueError(f"size_kb ({size_kb}) exceeds maximum allowed (51200 KB / 50 MB)")

    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / filename

    target_bytes = size_kb * 1024
    meta = metadata or {}
    title = meta.get("title", f"Dummy {t.upper()} Document")

    if t == "pdf":
        _generate_pdf(out_path, target_bytes, title=title)
    elif t == "zip":
        _generate_zip(out_path, target_bytes, filename=filename)
    elif t == "shp":
        _generate_shp(out_path, target_bytes)
    elif t in ("image", "png", "jpg", "jpeg"):
        _generate_image(out_path, target_bytes)
    elif t == "geojson":
        _generate_geojson(out_path, target_bytes, filename=filename)

    return out_path


def suitest_create_dummy_file(
    type: str = "pdf",
    filename: str = "",
    size_kb: int = 1024,
    output_dir: str = "suitest-output/fixtures",
    metadata: dict[str, str] | None = None,
    **_: Any,
) -> dict[str, Any]:
    """MCP tool: create a physically valid dummy file on disk for upload testing."""
    if not filename:
        ext = "png" if type == "image" else type
        filename = f"dummy_{type}.{ext}"

    try:
        out_path = create_dummy_file(
            file_type=type,
            filename=filename,
            size_kb=size_kb,
            output_dir=output_dir,
            metadata=metadata,
        )
        size_actual_kb = round(out_path.stat().st_size / 1024, 1)
        return _envelope(
            success=True,
            summary=f"Created {type.upper()} fixture at '{out_path}' ({size_actual_kb} KB)",
            data={
                "path": str(out_path),
                "filename": filename,
                "type": type,
                "size_bytes": out_path.stat().st_size,
                "size_kb": size_actual_kb,
            },
            artifacts=[str(out_path)],
        )
    except Exception as exc:
        return _envelope(
            success=False,
            summary=f"Failed to create dummy file: {exc}",
            errors=[str(exc)],
        )


__all__ = ["create_dummy_file", "suitest_create_dummy_file"]
