from __future__ import annotations

import json
import zipfile
from pathlib import Path

from suitest_lifecycle.fixture_generator import (
    create_dummy_file,
    suitest_create_dummy_file,
)
from suitest_lifecycle.mcp_server import _tool_schema


def test_dummy_file_schema() -> None:
    schema = _tool_schema("suitest_create_dummy_file")
    assert schema["name"] == "suitest_create_dummy_file"
    assert "inputSchema" in schema
    props = schema["inputSchema"].get("properties", {})
    assert "type" in props
    assert "size_kb" in props
    assert "filename" in props


def test_generate_pdf(tmp_path: Path) -> None:
    pdf_path = create_dummy_file(
        file_type="pdf",
        filename="proposal.pdf",
        size_kb=50,
        output_dir=str(tmp_path),
        metadata={"title": "Proposal Teknis PT Pemohon"},
    )
    assert pdf_path.is_file()
    assert pdf_path.stat().st_size >= 50 * 1024
    raw = pdf_path.read_bytes()
    assert raw.startswith(b"%PDF-1.4")
    assert b"%%EOF" in raw
    assert b"Proposal Teknis PT Pemohon" in raw


def test_generate_zip(tmp_path: Path) -> None:
    zip_path = create_dummy_file(
        file_type="zip",
        filename="archive.zip",
        size_kb=20,
        output_dir=str(tmp_path),
    )
    assert zip_path.is_file()
    assert zip_path.stat().st_size >= 20 * 1024
    with zipfile.ZipFile(zip_path, "r") as zf:
        names = zf.namelist()
        assert "manifest.txt" in names
        assert "payload.dat" in names


def test_generate_shp(tmp_path: Path) -> None:
    shp_path = create_dummy_file(
        file_type="shp",
        filename="gis_area.shp",
        size_kb=10,
        output_dir=str(tmp_path),
    )
    assert shp_path.is_file()
    assert shp_path.stat().st_size >= 10 * 1024
    raw = shp_path.read_bytes()
    assert raw[:4] == b"\x00\x00\x27\x0a"


def test_generate_image(tmp_path: Path) -> None:
    img_path = create_dummy_file(
        file_type="image",
        filename="foto_ktp.png",
        size_kb=15,
        output_dir=str(tmp_path),
    )
    assert img_path.is_file()
    assert img_path.stat().st_size >= 15 * 1024
    raw = img_path.read_bytes()
    assert raw.startswith(b"\x89PNG\r\n\x1a\n")


def test_generate_geojson(tmp_path: Path) -> None:
    geo_path = create_dummy_file(
        file_type="geojson",
        filename="locations.geojson",
        size_kb=5,
        output_dir=str(tmp_path),
    )
    assert geo_path.is_file()
    data = json.loads(geo_path.read_text(encoding="utf-8"))
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) >= 1


def test_suitest_create_dummy_file_envelope(tmp_path: Path) -> None:
    res = suitest_create_dummy_file(
        type="pdf",
        filename="doc.pdf",
        size_kb=2,
        output_dir=str(tmp_path),
    )
    assert res["success"] is True
    assert "Created PDF fixture" in res["summary"]
    assert len(res["artifacts"]) == 1
    assert Path(res["artifacts"][0]).is_file()

    # Invalid type error envelope
    res_err = suitest_create_dummy_file(type="exe", filename="bad.exe")
    assert res_err["success"] is False
    assert "Unsupported fixture file_type" in res_err["summary"]
