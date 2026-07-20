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

NTSC30 = 30000 / 1001  # 29.97
NTSC60 = 60000 / 1001  # 59.94


def test_frames_and_tc():
    # 30.52s @ 25fps -> frame 763 -> 00:00:30:13 (matches the Resolve reference)
    assert ce.to_frames(30.52, 25) == 763
    assert ce.seconds_to_tc(30.52, 25) == "00:00:30:13"


# ── Drop-frame timecode (NTSC) ───────────────────────────────────────────────

def test_dropframe_rate_detection():
    assert ce.is_dropframe_rate(NTSC30)
    assert ce.is_dropframe_rate(NTSC60)
    for rate in (24, 25, 30, 50, 60, 24000 / 1001):  # 23.976 has no DF standard
        assert not ce.is_dropframe_rate(rate)


def test_dropframe_known_smpte_vectors():
    def tc(frames, fps=NTSC30, df=True):
        return ce.seconds_to_tc(frames / fps, fps, drop_frame=df)

    assert tc(0) == "00:00:00:00"
    assert tc(1799) == "00:00:59:29"
    assert tc(1800) == "00:01:00:02"       # frames 00,01 dropped at minute 1
    assert tc(17982) == "00:10:00:00"      # no drop on every 10th minute
    assert tc(107892) == "01:00:00:00"     # exactly one hour


def test_dropframe_corrects_ndf_drift():
    # One hour of 29.97 reads ~3.6s early in non-drop; drop-frame realigns it.
    one_hour = 107892 / NTSC30
    assert ce.seconds_to_tc(one_hour, NTSC30, drop_frame=False) == "00:59:56:12"
    assert ce.seconds_to_tc(one_hour, NTSC30, drop_frame=True) == "01:00:00:00"


def test_resolve_drop_frame_auto_and_override():
    assert ce.resolve_drop_frame(NTSC30, None) is True    # auto: NTSC -> DF
    assert ce.resolve_drop_frame(25, None) is False       # auto: PAL -> NDF
    assert ce.resolve_drop_frame(NTSC30, False) is False  # forced NDF
    assert ce.resolve_drop_frame(25, True) is True        # forced DF


def test_edl_fcm_header_follows_dropframe():
    m = [ce.Marker(30.52, None, "A", "x", False, None)]
    assert "FCM: DROP FRAME" in ce.export("resolve", m, "t", NTSC30)[0]
    assert "FCM: NON DROP FRAME" in ce.export("resolve", m, "t", 25)[0]
    # explicit override wins over auto-detection
    assert "FCM: NON DROP FRAME" in ce.export("resolve", m, "t", NTSC30, drop_frame=False)[0]


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
    assert set(ce.FORMATS) == {"resolve", "premiere", "avid", "fcp", "fcpxml", "csv"}


def test_unsupported_format_raises():
    try:
        ce.export("srt", _markers(), "x", 25)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError")


def test_empty_markers_stays_valid():
    for fmt in ("resolve", "premiere", "avid", "fcp", "fcpxml", "csv"):
        content, _, _ = ce.export(fmt, [], "Empty", 25, duration_seconds=10.0)
        assert isinstance(content, str) and content
        if fmt in ("premiere", "avid", "fcpxml"):
            minidom.parseString(content)
        if fmt == "fcp":
            assert json.loads(content)["comments"] == []
        if fmt == "fcpxml":
            # header must survive an empty marker list (the gap still closes)
            assert "<fcpxml" in content and "</gap>" in content


# ── FCPXML ───────────────────────────────────────────────────────────────────

def test_fcpxml_wellformed_and_markers():
    content, media_type, filename = ce.export(
        "fcpxml", _markers(), "Scene 1.mov", 25, duration_seconds=60.0)
    assert media_type == "application/xml"
    assert filename == "FCPXML Scene 1.fcpxml"
    doc = minidom.parseString(content)
    fmt_el = doc.getElementsByTagName("format")[0]
    assert fmt_el.getAttribute("frameDuration") == "1/25s"
    seq = doc.getElementsByTagName("sequence")[0]
    assert seq.getAttribute("tcFormat") == "NDF"
    mk = doc.getElementsByTagName("marker")
    assert len(mk) == len(_markers())
    # markers must live inside the gap, or FCP ignores them
    assert doc.getElementsByTagName("gap")[0].getElementsByTagName("marker")


def test_fcpxml_ntsc_rates_are_exact_fractions():
    """A rounded rate drifts every marker — NTSC must stay 1001/N000."""
    c, _, _ = ce.export("fcpxml", _markers(), "x", 30000 / 1001, duration_seconds=10.0)
    assert 'frameDuration="1001/30000s"' in c
    assert 'tcFormat="DF"' in c  # 29.97 is drop-frame by default
    c, _, _ = ce.export("fcpxml", _markers(), "x", 24000 / 1001, duration_seconds=10.0)
    assert 'frameDuration="1001/24000s"' in c
    assert 'tcFormat="NDF"' in c  # 23.976 has no drop-frame standard
    c, _, _ = ce.export("fcpxml", _markers(), "x", 50, duration_seconds=10.0)
    assert 'frameDuration="1/50s"' in c


def test_fcpxml_escapes_attributes():
    markers = [ce.Marker(1.0, None, 'Bob "The Cut"', 'fix <this> & "that"', False, None)]
    content, _, _ = ce.export("fcpxml", markers, "x", 25, duration_seconds=5.0)
    minidom.parseString(content)  # would raise if quotes/ampersands leaked
    assert "&quot;" in content and "&amp;" in content


def test_fcpxml_resolved_marker_marked_completed():
    markers = [ce.Marker(1.0, None, "A", "done", True, None)]
    content, _, _ = ce.export("fcpxml", markers, "x", 25, duration_seconds=5.0)
    assert 'completed="1"' in content


def test_fcpxml_range_marker_gets_duration():
    markers = [ce.Marker(1.0, 3.0, "A", "range", False, None)]
    content, _, _ = ce.export("fcpxml", markers, "x", 25, duration_seconds=10.0)
    mk = minidom.parseString(content).getElementsByTagName("marker")[0]
    assert mk.getAttribute("start") == "25/25s"       # 1.0s @25fps
    assert mk.getAttribute("duration") == "50/25s"    # 2.0s span
