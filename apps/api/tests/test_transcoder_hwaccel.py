"""Tests for the hardware-accelerated HLS command builder (pure, no ffmpeg run)."""

from pathlib import Path

from packages.transcoder.ffmpeg_transcoder import (
    build_hls_command,
    detect_hwaccel,
    resolve_hwaccel,
    QUALITY_MAP,
    HWACCELS,
)

QUALITIES = ["1080p", "720p", "360p"]


def _cmd(mode, has_audio=True, qualities=QUALITIES):
    return build_hls_command("INPUT", Path("/tmp/hls"), qualities, mode, has_audio)


def test_cpu_uses_x264_and_crf():
    s = " ".join(_cmd("none"))
    assert "libx264" in s
    assert "-crf" in s
    assert "-b:v:0" not in s  # CPU uses CRF, not bitrate


def test_vaapi_encoder_device_and_hwupload():
    cmd = _cmd("vaapi")
    assert "h264_vaapi" in cmd
    assert "-vaapi_device" in cmd
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "hwupload" in fc  # frames uploaded to the GPU before encode
    assert "-b:v:0" in cmd


def test_qsv_encoder_and_device_init():
    cmd = _cmd("qsv")
    assert "h264_qsv" in cmd
    assert "-init_hw_device" in cmd


def test_nvenc_encoder_no_dri_device():
    cmd = _cmd("nvenc")
    assert "h264_nvenc" in cmd
    # nvenc accepts system-memory frames; it doesn't need a /dev/dri device init
    assert "-vaapi_device" not in cmd
    assert "-init_hw_device" not in cmd


def test_unknown_mode_falls_back_to_cpu():
    assert "libx264" in " ".join(_cmd("bogus"))


def test_no_audio_maps_video_only():
    cmd = _cmd("none", has_audio=False)
    assert "a:0" not in " ".join(cmd)
    assert cmd[cmd.index("-var_stream_map") + 1] == "v:0 v:1 v:2"


def test_cpu_output_is_browser_decodable():
    """Regression: 10-bit/4:2:2 sources must be forced to 8-bit 4:2:0, and audio
    to AAC, or the browser can't decode the segments (hls.js mediaError)."""
    cmd = _cmd("none", has_audio=True)
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "format=yuv420p" in fc          # 8-bit 4:2:0, browser-decodable
    assert "-c:a" in cmd and "aac" in cmd  # re-encode audio (source may be PCM)
    assert "-ac" in cmd                    # downmix multichannel to stereo


def test_nvenc_and_qsv_also_force_yuv420p():
    for mode in ("nvenc", "qsv"):
        fc = _cmd(mode)[_cmd(mode).index("-filter_complex") + 1]
        assert "format=yuv420p" in fc, mode


def test_vaapi_keeps_nv12_not_yuv420p():
    # VAAPI uploads nv12 to the GPU; it must NOT also force the CPU yuv420p path.
    fc = _cmd("vaapi")[_cmd("vaapi").index("-filter_complex") + 1]
    assert "format=nv12" in fc and "hwupload" in fc
    assert "format=yuv420p" not in fc


def test_no_audio_skips_audio_codec():
    cmd = _cmd("none", has_audio=False)
    assert "-c:a" not in cmd


def test_var_stream_map_pairs_audio_when_present():
    cmd = _cmd("vaapi", has_audio=True)
    assert cmd[cmd.index("-var_stream_map") + 1] == "v:0,a:0 v:1,a:1 v:2,a:2"


def test_all_supported_modes_build():
    for mode in HWACCELS:
        assert build_hls_command("IN", Path("/tmp"), ["720p"], mode, True)
    assert set(HWACCELS) == {"none", "vaapi", "qsv", "nvenc"}
    assert set(QUALITY_MAP) == {"1080p", "720p", "360p"}


def test_resolve_hwaccel_forces_and_auto_detects():
    # Explicit values pass through; unknown becomes CPU
    assert resolve_hwaccel("vaapi") == "vaapi"
    assert resolve_hwaccel("nvenc") == "nvenc"
    assert resolve_hwaccel("bogus") == "none"
    assert resolve_hwaccel(None) == "none"
    # "auto" resolves to a concrete, buildable back-end (CPU on machines with no GPU)
    detected = resolve_hwaccel("auto")
    assert detected in HWACCELS
    assert detect_hwaccel() in HWACCELS
    # whatever auto picks must produce a valid command
    assert build_hls_command("IN", Path("/tmp"), ["720p"], detected, True)
