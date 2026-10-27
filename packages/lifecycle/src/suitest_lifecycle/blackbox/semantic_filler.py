"""Semantic Smart Form Filler (Pilar 2) — Contextual Synthetic Form Data.

Replaces random / generic "test" inputs with validation-compliant data:
- NIB: 13 digits
- NPWP: 16 digits
- NIK/KTP: 16 digits
- Phone: 081234567890
- Email: RFC-compliant email (qa+... @example.com)
- Nominal/Luas/Price: positive number
- Date: ISO YYYY-MM-DD
- URL: valid HTTP/HTTPS URL
- Company/Name/Address: contextual Indonesian/Enterprise realistic values
"""

from __future__ import annotations

import datetime
import re
from typing import Any

_NIB_RE = re.compile(r"\b(nib|nomor\s*induk\s*berusaha)\b", re.I)
_NPWP_RE = re.compile(r"\b(npwp|nomor\s*pokok\s*wajib\s*pajak|tax\s*id)\b", re.I)
_NIK_RE = re.compile(r"\b(nik|ktp|no\s*identitas|id\s*card)\b", re.I)
_PHONE_RE = re.compile(
    r"\b(phone|telp|telepon|hp|handphone|mobile|wa|whatsapp|nomor\s*hp|no\s*hp)\b",
    re.I,
)
_EMAIL_RE = re.compile(r"\b(email|surel|e-mail)\b", re.I)
_NOMINAL_RE = re.compile(
    r"\b(nominal|harga|price|amount|luas|biaya|tarif|salary|gaji|nilai|total|anggaran)\b",
    re.I,
)
_NUMBER_RE = re.compile(r"\b(qty|quantity|jumlah|kuantitas|count|unit)\b", re.I)
_DATE_RE = re.compile(r"\b(date|tanggal|tgl|birth|dob|jadwal|schedule)\b", re.I)
_URL_RE = re.compile(r"\b(url|website|web|link|situs)\b", re.I)
_POSTAL_RE = re.compile(r"\b(kodepos|kode\s*pos|zip|postal)\b", re.I)
_ADDRESS_RE = re.compile(r"\b(address|alamat|domisili|lokasi|location)\b", re.I)
_COMPANY_RE = re.compile(r"\b(company|perusahaan|instansi|badan\s*usaha|nama\s*pt|pt|cv)\b", re.I)
_NAME_RE = re.compile(r"\b(name|nama|fullname|nama\s*lengkap|author|pic)\b", re.I)
_DESC_RE = re.compile(
    r"\b(notes|catatan|keterangan|desc|description|deskripsi|pesan|message|alasan|reason)\b",
    re.I,
)


def synthesize_semantic_value(
    kind: str = "input",
    label: str = "",
    name: str = "",
    placeholder: str = "",
) -> str:
    """Synthesize a schema-compliant realistic string for a form input element."""
    k = (kind or "").lower()
    combined = f"{name or ''} {label or ''} {placeholder or ''}".lower()

    if _NIB_RE.search(combined):
        return "0123456789012"
    if _NPWP_RE.search(combined):
        return "0123456789012345"
    if _NIK_RE.search(combined):
        return "3171012345670001"
    if k == "email" or _EMAIL_RE.search(combined):
        return "qa+automation@example.com"
    if k == "tel" or _PHONE_RE.search(combined):
        return "081234567890"
    if _NOMINAL_RE.search(combined):
        return "100000"
    if k == "number" or _NUMBER_RE.search(combined):
        return "1"
    if k == "date" or _DATE_RE.search(combined):
        return datetime.date.today().isoformat()
    if k == "url" or _URL_RE.search(combined):
        return "https://example.com"
    if _POSTAL_RE.search(combined):
        return "12345"
    if _ADDRESS_RE.search(combined):
        return "Jl. Jenderal Sudirman No. 42"
    if _COMPANY_RE.search(combined):
        return "PT Enterprise Testing Global"
    if _NAME_RE.search(combined):
        return "Budi Santoso"
    if k == "textarea" or _DESC_RE.search(combined):
        return "Keterangan uji coba sistem otomatis enterprise"

    return "Test Value"


def synthesize_for_element(el: Any) -> str:
    """Synthesize form value from an ElementInfo or similar duck-typed object."""
    kind = getattr(el, "input_type", "") or getattr(el, "kind", "input")
    label = getattr(el, "label", "") or getattr(el, "aria_label", "")
    name = getattr(el, "name", "")
    placeholder = getattr(el, "placeholder", "")
    return synthesize_semantic_value(
        kind=kind,
        label=label,
        name=name,
        placeholder=placeholder,
    )
