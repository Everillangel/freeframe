"""Unit tests for NLE comment export (pure — no DB/S3 required)."""

import datetime
import xml.dom.minidom as minidom

from apps.api.services import comment_export as ce


def _markers():
    return [
        ce.Marker(
            seconds=2.0,
            end_seconds=4.5,
            author="Thoryn Smit",
            body="Fix the color grade here, too warm",
            resolved=False,
            created_at=datetime.datetime(2026, 7, 6, 12, 0, 0),
        ),
        ce.Marker(
            seconds=61.53,
            end_seconds=None,
            author="Guest Reviewer",
            body="Audio pop at this cut & <clip>",
            resolved=True,
            created_at=datetime.datetime(2026, 7, 6, 12, 5, 0),
        ),
    ]


# ── Timecode math ────────────────────────────────────────────────────────────

def test_seconds_to_tc_integer_fps():
    assert ce.seconds_to_tc(0, 25) == "00:00:00:00"
    assert ce.seconds_to_tc(1, 25) == "00:00:01:00"
    # 1 hour + 1 minute + 1 second + 12 frames at 24fps
    assert ce.seconds_to_tc(3661 + 12 / 24, 24) == "01:01:01:12"


def test_seconds_to_tc_ntsc():
    # 29.97 non-drop rolls frame count with a nominal 30-frame second
    assert ce.seconds_to_tc(1, 29.97) == "00:00:01:00"
    assert ce.seconds_to_tc(0, 29.97) == "00:00:00:00"


def test_frame_duration_rationals():
    assert ce._frame_duration(25) == (1, 25)
    assert ce._frame_duration(30) == (1, 30)
    assert ce._frame_duration(29.97) == (1001, 30000)
    assert ce._frame_duration(23.976) == (1001, 24000)


# ── Formats ──────────────────────────────────────────────────────────────────

def test_csv_has_header_and_rows():
    content, media_type, filename = ce.export("csv", _markers(), "Hero Spot v3", 30)
    assert media_type == "text/csv"
    assert filename.endswith(".csv")
    lines = content.strip().splitlines()
    assert lines[0].startswith("Timecode In,Timecode Out")
    assert len(lines) == 3  # header + 2 markers
    assert "Thoryn Smit" in content
    assert "yes" in content  # resolved marker


def test_edl_structure():
    content, _, filename = ce.export("edl", _markers(), "Hero Spot v3", 29.97)
    assert filename.endswith(".edl")
    assert "TITLE: Hero Spot v3" in content
    assert "FCM: NON-DROP FRAME" in content
    assert "*LOC:" in content
    # One event line per marker (events numbered 001, 002)
    assert "001  AX" in content
    assert "002  AX" in content


def test_avid_is_tab_delimited():
    content, media_type, filename = ce.export("avid", _markers(), "Hero Spot v3", 25)
    assert filename.endswith(".txt")
    first = content.splitlines()[0].split("\t")
    # Name, Timecode, Track, Color, Comment
    assert len(first) == 5
    assert first[0] == "Thoryn Smit"
    assert first[2] == "V1"


def test_fcpxml_is_wellformed_and_escapes():
    content, media_type, filename = ce.export(
        "fcpxml", _markers(), "Spot & <Test>", 29.97, 1920, 1080, 90.0
    )
    assert filename.endswith(".fcpxml")
    # Parses as valid XML even with & and < in names/bodies
    doc = minidom.parseString(content)
    markers = doc.getElementsByTagName("marker")
    assert len(markers) == 2
    # Resolved comment exports as a completed to-do marker
    completed = [m for m in markers if m.getAttribute("completed") == "1"]
    assert len(completed) == 1
    # Marker start values land on exact frame boundaries (multiples of frameDuration)
    for m in markers:
        start = m.getAttribute("start")  # e.g. "60060/30000s"
        num = int(start.split("/")[0])
        assert num % 1001 == 0


def test_unsupported_format_raises():
    try:
        ce.export("srt", _markers(), "x", 30)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for unsupported format")


def test_empty_markers_still_produces_valid_output():
    for fmt in ("csv", "edl", "avid", "fcpxml"):
        content, _, _ = ce.export(fmt, [], "Empty", 30, duration_seconds=10.0)
        assert isinstance(content, str) and content
        if fmt == "fcpxml":
            minidom.parseString(content)  # must remain well-formed
