"""Tests for source-media metadata parsing (ffprobe -> MediaFile fields).

Frame rate is load-bearing: marker exports convert comment times to frames with
it, so a wrong/missing fps silently shifts every exported timecode.
"""

import json

from packages.transcoder.ffmpeg_transcoder import parse_probe


def test_pal_25fps():
    probe = json.dumps({
        "streams": [{"width": 1920, "height": 1080, "r_frame_rate": "25/1", "duration": "6937.36"}],
        "format": {"duration": "6937.36"},
    })
    m = parse_probe(probe)
    assert m["fps"] == 25.0
    assert m["width"] == 1920 and m["height"] == 1080
    assert m["duration_seconds"] == 6937.36


def test_ntsc_fractional_rates():
    m = parse_probe(json.dumps({"streams": [{"r_frame_rate": "24000/1001"}]}))
    assert abs(m["fps"] - 23.976) < 0.001
    m = parse_probe(json.dumps({"streams": [{"r_frame_rate": "30000/1001"}]}))
    assert abs(m["fps"] - 29.97) < 0.01


def test_duration_falls_back_to_container():
    m = parse_probe(json.dumps({
        "streams": [{"width": 3840, "height": 2160, "r_frame_rate": "25/1"}],
        "format": {"duration": "120.5"},
    }))
    assert m["duration_seconds"] == 120.5


def test_avg_frame_rate_used_when_r_missing():
    m = parse_probe(json.dumps({"streams": [{"avg_frame_rate": "50/1"}]}))
    assert m["fps"] == 50.0


def test_malformed_input_never_raises():
    assert parse_probe("") == {}
    assert parse_probe("not json") == {}
    assert parse_probe(None) == {}
    assert parse_probe(json.dumps({"streams": []})) == {}
    # zero denominator must not divide-by-zero
    assert "fps" not in parse_probe(json.dumps({"streams": [{"r_frame_rate": "0/0"}]}))
