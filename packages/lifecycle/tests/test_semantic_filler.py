from __future__ import annotations

import datetime

from suitest_lifecycle.blackbox.models import ElementInfo
from suitest_lifecycle.blackbox.semantic_filler import (
    synthesize_for_element,
    synthesize_semantic_value,
)


def test_synthesize_nib() -> None:
    val = synthesize_semantic_value(name="nib", label="Nomor Induk Berusaha")
    assert len(val) == 13
    assert val.isdigit()


def test_synthesize_npwp() -> None:
    val = synthesize_semantic_value(label="NPWP Perusahaan")
    assert len(val) == 16
    assert val.isdigit()


def test_synthesize_nik() -> None:
    val = synthesize_semantic_value(placeholder="Nomor KTP / NIK")
    assert len(val) == 16
    assert val.isdigit()


def test_synthesize_phone() -> None:
    val = synthesize_semantic_value(kind="tel", label="Nomor Telepon / WhatsApp")
    assert val.startswith("08")
    assert val.isdigit()


def test_synthesize_email() -> None:
    val = synthesize_semantic_value(kind="email")
    assert "@" in val
    assert val.endswith(".com")


def test_synthesize_nominal() -> None:
    val = synthesize_semantic_value(label="Nominal Biaya / Tarif")
    assert int(val) > 0


def test_synthesize_date() -> None:
    val = synthesize_semantic_value(kind="date")
    assert val == datetime.date.today().isoformat()


def test_synthesize_element_adapter() -> None:
    el_nib = ElementInfo(tag="input", name="txt_nib", placeholder="Masukkan 13 digit NIB")
    assert synthesize_for_element(el_nib) == "0123456789012"

    el_company = ElementInfo(tag="input", label="Nama PT / Perusahaan Pemohon")
    assert "PT" in synthesize_for_element(el_company)
