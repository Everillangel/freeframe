"""Unit tests for NLE comment export (pure — no DB/S3 required).

Formats mirror real Frame.io exports: Resolve EDL, Premiere xmeml, Avid
StreamItems XML, FCP fiojson, plus CSV.
"""

import datetime
import json
import xml.dom.minidom as minidom

from apps.api.services import comment_export as ce


def _markers():
    return [
        ce.Marker(30.52, None, "Mahlogonolo Phahlamohlaka",
                  "For that we dont need Natasia and Roy", False,
                  datetime.datetime(2026, 7, 14, 7, 57)),
        ce.Marker(91.44, 95.0, "Guest Reviewer",
                  "Audio pop & <clip> here", True,
                  datetime.datetime(2026, 7, 14, 8, 5)),
    ]


# ── Timecode / frames ────────────────────────────────────────────────────────

def test_frames_and_tc():
    # 30.52s @ 25fps -> frame 763 -> 00:00:30:13 (matches the Resolve reference)
    assert ce.to_frames(30.52, 25) == 763
    assert ce.seconds_to_tc(30.52, 25) == "00:00:30:13"


# ── Resolve EDL ──────────────────────────────────────────────────────────────

def test_resolve_edl_structure():
    content, media_type, filename = ce.export("resolve", _markers(), "MTN CMD.mp4", 25)
    assert filename == "Resolve MTN CMD.edl"
    lines = content.splitlines()
    assert lines[0] == "TITLE: MTN CMD.mp4"
    assert lines[1] == "FCM: NON DROP FRAME"
    assert "001  001  C  V  00:00:30:13  00:00:30:13  00:00:30:13  00:00:30:13" in content
    assert "@Mahlogonolo Phahlamohlaka," in content
    assert "|C:ResolveColorPurple |M:Mahlogonolo Phahlamohlaka |D:0" in content


# ── Premiere xmeml ───────────────────────────────────────────────────────────

def test_premiere_xmeml_wellformed_and_markers():
    content, media_type, filename = ce.export("premiere", _markers(), "MTN CMD.mp4", 25, 1920, 1080, 6937.36)
    assert filename == "Premiere MTN CMD.xml"
    doc = minidom.parseString(content)  # valid XML even with & and < in a body
    markers = doc.getElementsByTagName("marker")
    # Frame.io duplicates markers on the color-matte clip and at sequence level
    assert len(markers) == 4
    m0 = markers[0]
    assert m0.getElementsByTagName("in")[0].firstChild.data == "763"
    assert m0.getElementsByTagName("out")[0].firstChild.data == "-1"
    assert m0.getElementsByTagName("pproColor")[0].firstChild.data == "4294741314"
    assert "<generatoritem" in content  # marker color matte present


# ── Avid StreamItems XML ─────────────────────────────────────────────────────

def test_avid_streamitems_wellformed():
    content, media_type, filename = ce.export("avid", _markers(), "MTN CMD.mp4", 25)
    assert filename == "Avid MC MTN CMD.xml"
    minidom.parseString(content)
    assert 'DOCTYPE Avid:StreamItems' in content
    assert content.count('<AvClass id="ATTR">') == 2  # one per marker
    assert "_ATN_CRM_USER" in content and "_ATN_CRM_TC" in content
    assert "_ATN_CRM_COM" in content


# ── FCP fiojson ──────────────────────────────────────────────────────────────

def test_fcp_fiojson_valid():
    content, media_type, filename = ce.export("fcp", _markers(), "MTN CMD.mp4", 25, 1920, 1080, 6937.36)
    assert filename == "FCP MTN CMD.fiojson"
    data = json.loads(content)
    assert data["asset"]["fps"] == 25.0
    assert data["asset"]["comment_count"] == 2
    assert len(data["comments"]) == 2
    c0 = data["comments"][0]
    assert c0["frame"] == 763.0
    assert c0["text"].startswith("For that")
    # resolved comment carries completed_at
    assert data["comments"][1]["completed_at"] is not None


# ── CSV ──────────────────────────────────────────────────────────────────────

def test_csv_header_and_injection_safe():
    markers = [ce.Marker(1.0, None, "=Evil", "=HYPERLINK(1)", False, None)]
    content, media_type, filename = ce.export("csv", markers, "x", 30)
    assert content.splitlines()[0].startswith("Timecode,Frame,Seconds,Author")
    assert "'=Evil" in content and "'=HYPERLINK" in content


# ── Dispatcher ───────────────────────────────────────────────────────────────

def test_formats_registry():
    assert set(ce.FORMATS) == {"resolve", "premiere", "avid", "fcp", "csv"}


def test_unsupported_format_raises():
    try:
        ce.export("srt", _markers(), "x", 25)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError")


def test_empty_markers_stays_valid():
    for fmt in ("resolve", "premiere", "avid", "fcp", "csv"):
        content, _, _ = ce.export(fmt, [], "Empty", 25, duration_seconds=10.0)
        assert isinstance(content, str) and content
        if fmt in ("premiere", "avid"):
            minidom.parseString(content)
        if fmt == "fcp":
            assert json.loads(content)["comments"] == []
