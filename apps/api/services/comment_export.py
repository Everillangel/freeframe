"""Export timecoded comments as NLE marker files.

Produces marker/locator files that import into the major editors:

- ``csv``     Generic spreadsheet-friendly CSV (also handy for Premiere/Resolve).
- ``edl``     CMX3600 EDL with ``*LOC:`` marker lines — DaVinci Resolve, Avid,
              Premiere all read markers from these.
- ``fcpxml``  Final Cut Pro X FCPXML markers (also imported by Resolve/Premiere).
- ``avid``    Avid Media Composer tab-delimited locator (.txt) file.

Timecodes are non-drop-frame (SMPTE ``HH:MM:SS:FF``) computed from the media's
frame rate. Comment times are stored in seconds, so a frame rate is required for
frame accuracy — the caller supplies it from the media file (defaulting to 30).
"""

import csv as _csv
import io
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from xml.sax.saxutils import escape, quoteattr


@dataclass
class Marker:
    """A single exportable comment marker."""
    seconds: float
    end_seconds: Optional[float]
    author: str
    body: str
    resolved: bool
    created_at: Optional[datetime]


# ── Timecode helpers ────────────────────────────────────────────────────────

def nominal_fps(fps: float) -> int:
    """Integer frame count per second used for SMPTE timecodes (e.g. 30 for 29.97)."""
    return max(1, round(fps))


def seconds_to_tc(seconds: float, fps: float) -> str:
    """Convert seconds to non-drop-frame SMPTE timecode ``HH:MM:SS:FF``."""
    n = nominal_fps(fps)
    total_frames = int(round(max(0.0, seconds) * fps))
    frames = total_frames % n
    total_seconds = total_frames // n
    ss = total_seconds % 60
    mm = (total_seconds // 60) % 60
    hh = total_seconds // 3600
    return f"{hh:02d}:{mm:02d}:{ss:02d}:{frames:02d}"


def _frame_duration(fps: float) -> tuple[int, int]:
    """Return (numerator, denominator) seconds-per-frame for FCPXML rational time.

    Integer rates -> 1/fps. NTSC rates (23.976, 29.97, 59.94) -> 1001/(nominal*1000).
    """
    n = nominal_fps(fps)
    if abs(fps - n) < 0.01:
        return (1, n)
    # NTSC fractional rate check: nominal * 1000 / 1001
    if abs(fps - (n * 1000.0 / 1001.0)) < 0.1:
        return (1001, n * 1000)
    # Fallback: microsecond-resolution rational
    return (max(1, round(1_000_000 / fps)), 1_000_000)


def _to_frames(seconds: float, fps: float) -> int:
    return int(round(max(0.0, seconds) * fps))


def _one_line(text: str) -> str:
    """Flatten a comment body to a single line for line-oriented formats."""
    return " ".join((text or "").split())


def _csv_safe(value: str) -> str:
    """Neutralise CSV/formula injection.

    A cell beginning with =, +, -, @, or a control char can be executed as a
    formula by Excel/Sheets/Numbers. Prefix such cells with a single quote so
    they are treated as text on import.
    """
    s = "" if value is None else str(value)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + s
    return s


# ── CSV ─────────────────────────────────────────────────────────────────────

def build_csv(markers: list[Marker], asset_name: str, fps: float) -> str:
    buf = io.StringIO()
    w = _csv.writer(buf)
    w.writerow(["Timecode In", "Timecode Out", "Seconds", "Frame", "Author",
                "Comment", "Resolved", "Created At"])
    for m in markers:
        tc_in = seconds_to_tc(m.seconds, fps)
        tc_out = seconds_to_tc(m.end_seconds, fps) if m.end_seconds is not None else ""
        w.writerow([
            tc_in,
            tc_out,
            f"{m.seconds:.3f}",
            _to_frames(m.seconds, fps),
            _csv_safe(m.author),
            _csv_safe(_one_line(m.body)),
            "yes" if m.resolved else "no",
            m.created_at.isoformat() if m.created_at else "",
        ])
    return buf.getvalue()


# ── EDL (CMX3600) ───────────────────────────────────────────────────────────

def build_edl(markers: list[Marker], asset_name: str, fps: float) -> str:
    """CMX3600 EDL with one 1-frame event + ``*LOC:`` marker line per comment."""
    n = nominal_fps(fps)
    lines = [f"TITLE: {_one_line(asset_name)[:70]}", "FCM: NON-DROP FRAME", ""]
    for i, m in enumerate(markers, start=1):
        start_f = _to_frames(m.seconds, fps)
        if m.end_seconds is not None:
            end_f = max(_to_frames(m.end_seconds, fps), start_f + 1)
        else:
            end_f = start_f + 1
        tc_in = seconds_to_tc(start_f / fps, fps)
        tc_out = seconds_to_tc(end_f / fps, fps)
        event = f"{i:03d}"
        lines.append(f"{event}  AX       V     C        {tc_in} {tc_out} {tc_in} {tc_out}")
        # Marker color/name/comment. Resolve/Avid read the *LOC line as a marker.
        note = _one_line(f"{m.body} ({m.author})")
        lines.append(f"*LOC: {tc_in} WHITE  {note}")
        lines.append(f"* FROM CLIP NAME: {_one_line(asset_name)}")
        lines.append("")
    return "\n".join(lines) + "\n"


# ── Avid locator (.txt) ─────────────────────────────────────────────────────

def build_avid(markers: list[Marker], fps: float, track: str = "V1",
               color: str = "red") -> str:
    """Avid Media Composer tab-delimited locator file.

    Columns: Name(author)  Timecode  Track  Color  Comment
    """
    rows = []
    for m in markers:
        tc = seconds_to_tc(m.seconds, fps)
        comment = _one_line(m.body)
        rows.append("\t".join([m.author or "Reviewer", tc, track, color, comment]))
    return "\n".join(rows) + "\n"


# ── FCPXML ──────────────────────────────────────────────────────────────────

def build_fcpxml(markers: list[Marker], asset_name: str, fps: float,
                 width: int, height: int, duration_seconds: float) -> str:
    fd_num, fd_den = _frame_duration(fps)
    frame_dur = f"{fd_num}/{fd_den}s"

    def rational(seconds: float) -> str:
        frames = _to_frames(seconds, fps)
        num = frames * fd_num
        return f"{num}/{fd_den}s" if num else "0s"

    total_frames = max(1, _to_frames(duration_seconds or 0, fps))
    seq_duration = f"{total_frames * fd_num}/{fd_den}s"
    w = width or 1920
    h = height or 1080
    name = _one_line(asset_name) or "FreeFrame Asset"

    marker_xml = []
    for m in markers:
        start = rational(m.seconds)
        if m.end_seconds is not None and m.end_seconds > m.seconds:
            dur_frames = max(1, _to_frames(m.end_seconds, fps) - _to_frames(m.seconds, fps))
        else:
            dur_frames = 1
        dur = f"{dur_frames * fd_num}/{fd_den}s"
        value = _one_line(f"{m.body} - {m.author}") if m.author else _one_line(m.body)
        completed = ' completed="1"' if m.resolved else ""
        # Resolved comments export as to-do markers so their state survives.
        tag = "marker"
        marker_xml.append(
            f'          <{tag} start={quoteattr(start)} duration={quoteattr(dur)} '
            f'value={quoteattr(value or "Comment")}{completed}/>'
        )
    markers_block = "\n".join(marker_xml)

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFExportFormat" frameDuration="{frame_dur}" width="{w}" height="{h}"/>
    <asset id="r2" name={quoteattr(name)} start="0s" duration="{seq_duration}" hasVideo="1" format="r1" videoSources="1"/>
  </resources>
  <library>
    <event name="FreeFrame Export">
      <project name={quoteattr(name + " - Comments")}>
        <sequence format="r1" duration="{seq_duration}" tcStart="0s" tcFormat="NDF">
          <spine>
            <asset-clip ref="r2" name={quoteattr(name)} offset="0s" start="0s" duration="{seq_duration}" format="r1">
{markers_block}
            </asset-clip>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
"""


# ── Dispatcher ──────────────────────────────────────────────────────────────

FORMATS = {
    "csv":    ("text/csv", "csv"),
    "edl":    ("application/octet-stream", "edl"),
    "avid":   ("text/plain", "txt"),
    "fcpxml": ("application/xml", "fcpxml"),
}


def export(fmt: str, markers: list[Marker], asset_name: str, fps: float,
           width: int = 1920, height: int = 1080,
           duration_seconds: float = 0.0) -> tuple[str, str, str]:
    """Build the export. Returns (content, media_type, filename)."""
    if fmt not in FORMATS:
        raise ValueError(f"Unsupported format: {fmt}")
    media_type, ext = FORMATS[fmt]

    if fmt == "csv":
        content = build_csv(markers, asset_name, fps)
    elif fmt == "edl":
        content = build_edl(markers, asset_name, fps)
    elif fmt == "avid":
        content = build_avid(markers, fps)
    else:  # fcpxml
        content = build_fcpxml(markers, asset_name, fps, width, height, duration_seconds)

    safe = "".join(c if c.isalnum() or c in "-_ " else "_" for c in (asset_name or "comments")).strip() or "comments"
    filename = f"{safe}_comments.{ext}"
    return content, media_type, filename
