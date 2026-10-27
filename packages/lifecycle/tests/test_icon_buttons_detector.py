from __future__ import annotations

from suitest_lifecycle.blackbox.detector import classify_button_intent
from suitest_lifecycle.blackbox.models import ElementInfo
from suitest_lifecycle.blackbox.selector import _accessible_name, describe


def test_icon_only_button_accessible_name() -> None:
    el_tooltip = ElementInfo(
        tag="button",
        tooltip="Klik untuk ubah data perizinan",
        is_icon_only=True,
    )
    assert _accessible_name(el_tooltip) == "Klik untuk ubah data perizinan"
    assert describe(el_tooltip) == "Klik untuk ubah data perizinan"

    el_icon = ElementInfo(
        tag="button",
        icon_hint="[icon:search]",
        is_icon_only=True,
    )
    assert _accessible_name(el_icon) == "[icon:search]"
    assert describe(el_icon) == "[icon:search]"


def test_classify_button_intent() -> None:
    # 1. Search
    btn_search = ElementInfo(tag="button", icon_hint="[icon:search]")
    assert classify_button_intent(btn_search) == "SEARCH"

    # 2. Lookup Modal
    btn_lookup = ElementInfo(tag="button", icon_hint="[lookup:kode_kbli]")
    assert classify_button_intent(btn_lookup) == "LOOKUP_MODAL"

    # 3. Edit
    btn_edit = ElementInfo(tag="button", tooltip="Ubah data pemohon", icon_hint="[icon:pencil]")
    assert classify_button_intent(btn_edit) == "EDIT"

    # 4. Create / Add
    btn_add = ElementInfo(tag="button", icon_hint="[icon:plus]")
    assert classify_button_intent(btn_add) == "CREATE"

    # 5. Delete / Destructive
    btn_del = ElementInfo(tag="button", text="Hapus Berkas")
    assert classify_button_intent(btn_del) == "DELETE"

    # 6. Upload
    btn_upload = ElementInfo(tag="button", tooltip="Upload Dokumen PDF", icon_hint="[icon:upload]")
    assert classify_button_intent(btn_upload) == "UPLOAD"

    # 7. Calendar
    btn_cal = ElementInfo(tag="button", icon_hint="[icon:calendar]")
    assert classify_button_intent(btn_cal) == "CALENDAR"

    # 8. Submit
    btn_sub = ElementInfo(tag="button", text="Kirim Permohonan")
    assert classify_button_intent(btn_sub) == "SUBMIT"
