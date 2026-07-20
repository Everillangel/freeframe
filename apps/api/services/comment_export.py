"""Export timecoded comments as NLE marker files, matching Frame.io's output.

One format per editor, modelled on real Frame.io exports:

- ``resolve``  DaVinci Resolve EDL (CMX3600 with @author + |C:|M:|D: metadata).
- ``premiere`` Adobe Premiere Pro FCP7 XML (xmeml) with a marker color-matte.
- ``avid``     Avid Media Composer StreamItems XML (OMFI locator attributes).
- ``fcp``      Final Cut Pro fiojson (Frame.io's JSON marker payload).
- ``fcpxml``   Final Cut Pro FCPXML 1.9 (standard interchange — use when the
               fiojson payload isn't accepted, since that format is Frame.io's
               own and not something FCP ingests natively).
- ``csv``      Generic spreadsheet CSV.

Only top-level, timecoded comments are exported. Frame numbers/timecodes are
derived from the media frame rate (non-drop-frame).
"""

import csv as _csv
import io
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from xml.sax.saxutils import escape


@dataclass
class Marker:
    """A single exportable comment marker."""
    seconds: float
    end_seconds: Optional[float]
    author: str
    body: str
    resolved: bool
    created_at: Optional[datetime]


# ── Timecode / frame helpers ─────────────────────────────────────────────────

def nominal_fps(fps: float) -> int:
    return max(1, round(fps))


def to_frames(seconds: float, fps: float) -> int:
    return int(round(max(0.0, seconds) * fps))


def is_dropframe_rate(fps: float) -> bool:
    """True for the NTSC rates that use drop-frame timecode (29.97, 59.94).

    23.976 is NTSC-fractional too but has no drop-frame standard — it's always
    non-drop. 24/25/30/50/60 are exact rates and never drop.
    """
    return abs(fps - 30000 / 1001) < 0.01 or abs(fps - 60000 / 1001) < 0.01


def seconds_to_tc(seconds: float, fps: float, drop_frame: bool = False) -> str:
    """SMPTE timecode HH:MM:SS:FF.

    Non-drop by default. With `drop_frame`, applies the NTSC drop-frame rule
    (skip 2 frames — 4 at 59.94 — at each minute except every 10th), which keeps
    the timecode aligned to wall-clock; without it, 29.97 material drifts ~3.6s
    per hour against a drop-frame timeline.
    """
    n = nominal_fps(fps)
    total = to_frames(seconds, fps)

    if drop_frame:
        drop = round(fps * 0.066666)          # 2 @ 29.97, 4 @ 59.94
        per_10min = round(fps * 600)          # 17982 @ 29.97
        per_min = n * 60 - drop               # 1798 @ 29.97
        d, m = divmod(total, per_10min)
        if m > drop:
            total += drop * 9 * d + drop * ((m - drop) // per_min)
        else:
            total += drop * 9 * d

    return f"{(total // (n*3600)) % 24:02d}:{(total // (n*60)) % 60:02d}:{(total // n) % 60:02d}:{total % n:02d}"


def resolve_drop_frame(fps: float, drop_frame: Optional[bool]) -> bool:
    """None = auto (drop-frame for NTSC rates); True/False forces it."""
    return is_dropframe_rate(fps) if drop_frame is None else bool(drop_frame)


def _one_line(text: str) -> str:
    return " ".join((text or "").split())


def _csv_safe(value: str) -> str:
    s = "" if value is None else str(value)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + s
    return s


def _edl_date(dt: Optional[datetime]) -> str:
    """Frame.io EDL date style, e.g. 'Jul 14 26 07:57am'."""
    if not dt:
        return ""
    s = dt.strftime("%b %d %y %I:%M%p")
    return s[:-2] + s[-2:].lower()


def _iso_z(dt: Optional[datetime]) -> Optional[str]:
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


# ── DaVinci Resolve — EDL ────────────────────────────────────────────────────

def build_resolve_edl(markers: list[Marker], asset_name: str, fps: float,
                      drop_frame: Optional[bool] = None) -> str:
    df = resolve_drop_frame(fps, drop_frame)
    fcm = "DROP FRAME" if df else "NON DROP FRAME"
    lines = [f"TITLE: {_one_line(asset_name)}", f"FCM: {fcm}", ""]
    for i, m in enumerate(markers, start=1):
        tc = seconds_to_tc(m.seconds, fps, drop_frame=df)
        lines.append(f"{i:03d}  001  C  V  {tc}  {tc}  {tc}  {tc}")
        lines.append(f"@{m.author or 'Reviewer'}, {_edl_date(m.created_at)}")
        note = _one_line(m.body)
        lines.append(f"{note} |C:ResolveColorPurple |M:{m.author or 'Reviewer'} |D:0")
        lines.append("")
    return "\n".join(lines) + "\n"


# ── Adobe Premiere Pro — FCP7 XML (xmeml) ────────────────────────────────────

_PPRO_COLOR = "4294741314"  # Frame.io's purple marker color


def _premiere_marker(m: Marker, fps: float) -> str:
    return (
        "  <marker>\n"
        f"    <comment>{escape(_one_line(m.body))}</comment>\n"
        f"    <name>{escape(m.author or 'Reviewer')}</name>\n"
        f"    <in>{to_frames(m.seconds, fps)}</in>\n"
        "    <out>-1</out>\n"
        f"    <pproColor>{_PPRO_COLOR}</pproColor>\n"
        "  </marker>"
    )


def build_premiere_xml(markers: list[Marker], asset_name: str, fps: float,
                       width: int, height: int, duration_seconds: float) -> str:
    n = nominal_fps(fps)
    ntsc = "TRUE" if abs(fps - n) > 0.01 else "FALSE"
    total = max(1, to_frames(duration_seconds or 0, fps))
    name = escape(_one_line(asset_name) or "FreeFrame Sequence")
    clip_markers = "\n".join(_premiere_marker(m, fps) for m in markers)
    seq_markers = "\n".join(_premiere_marker(m, fps) for m in markers)

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence">
    <duration>{total}</duration>
    <rate>
      <timebase>{n}</timebase>
      <ntsc>{ntsc}</ntsc>
    </rate>
    <name>{name}</name>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <rate>
              <timebase>{n}</timebase>
              <ntsc>{ntsc}</ntsc>
            </rate>
            <width>{width or 1920}</width>
            <height>{height or 1080}</height>
            <anamorphic>FALSE</anamorphic>
            <pixelaspectratio>square</pixelaspectratio>
            <fielddominance>none</fielddominance>
          </samplecharacteristics>
        </format>
        <track>
          <enabled>TRUE</enabled>
          <locked>FALSE</locked>
          <generatoritem id="clipitem-1">
            <name>Marker Color Matte</name>
            <enabled>TRUE</enabled>
            <duration>{total}</duration>
            <rate>
              <timebase>{n}</timebase>
              <ntsc>{ntsc}</ntsc>
            </rate>
            <start>0</start>
            <end>{total}</end>
            <in>0</in>
            <out>{total}</out>
            <alphatype>none</alphatype>
            <effect>
              <name>Color</name>
              <effectid>Color</effectid>
              <effectcategory>Matte</effectcategory>
              <effecttype>generator</effecttype>
              <mediatype>video</mediatype>
              <parameter authoringApp="PremierePro">
                <parameterid>fillcolor</parameterid>
                <name>Color</name>
                <value>
                  <alpha>0</alpha>
                  <red>0</red>
                  <green>0</green>
                  <blue>0</blue>
                </value>
              </parameter>
            </effect>
{clip_markers}
          </generatoritem>
        </track>
      </video>
    </media>
{seq_markers}
  </sequence>
</xmeml>
"""


# ── Avid Media Composer — StreamItems XML ────────────────────────────────────

def _avid_attr(kind: int, name: str, value, is_int: bool) -> str:
    attr = "IntAttribute" if is_int else "StringAttribute"
    vtype = "int32" if is_int else "string"
    val = value if is_int else escape(str(value))
    return (
        "    <ListElem>\n"
        f'      <AvProp id="ATTR" name="OMFI:ATTB:Kind" type="int32">{kind}</AvProp>\n'
        f'      <AvProp id="ATTR" name="OMFI:ATTB:Name" type="string">{name}</AvProp>\n'
        f'      <AvProp id="ATTR" name="OMFI:ATTB:{attr}" type="{vtype}">{val}</AvProp>\n'
        "    </ListElem>"
    )


def _avid_marker(m: Marker, fps: float) -> str:
    ts = int(m.created_at.timestamp()) if m.created_at else 0
    frame = to_frames(m.seconds, fps)
    items = "\n".join([
        _avid_attr(1, "_ATN_CRM_LONG_CREATE_DATE", ts, True),
        _avid_attr(2, "_ATN_CRM_COLOR", "Blue", False),
        _avid_attr(2, "_ATN_CRM_USER", m.author or "Reviewer", False),
        _avid_attr(2, "_ATN_CRM_COM", _one_line(m.body), False),
        _avid_attr(2, "_ATN_CRM_TC", str(frame), False),
        _avid_attr(2, "_ATN_CRM_TRK", "V1", False),
        _avid_attr(1, "_ATN_CRM_LENGTH", 1, True),
    ])
    return (
        '<AvClass id="ATTR">\n'
        '  <AvProp id="ATTR" name="__OMFI:ATTR:NumItems" type="int32">7</AvProp>\n'
        '  <List id="OMFI:ATTR:AttrRefs">\n'
        f"{items}\n"
        "    <ListElem/>\n"
        "  </List>\n"
        "</AvClass>"
    )


def build_avid_xml(markers: list[Marker], fps: float) -> str:
    blocks = "\n".join(_avid_marker(m, fps) for m in markers)
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n'
        '<!DOCTYPE Avid:StreamItems SYSTEM "AvidSettingsFile.dtd">\n'
        '<Avid:StreamItems xmlns:Avid="http://www.avid.com">\n'
        "<Avid:XMLFileData>\n"
        '<AvProp name="DomainMagic" type="string">Domain</AvProp>\n'
        '<AvProp name="DomainKey" type="char4">58424a44</AvProp>\n'
        f"{blocks}\n"
        "</Avid:XMLFileData></Avid:StreamItems>\n"
    )


# ── Final Cut Pro — fiojson (Frame.io JSON) ──────────────────────────────────

def build_fcp_fiojson(markers: list[Marker], asset_name: str, fps: float,
                      duration_seconds: float) -> str:
    payload = {
        "asset": {
            "name": _one_line(asset_name),
            "fps": float(fps),
            "duration": float(duration_seconds or 0.0),
            "frames": to_frames(duration_seconds or 0, fps),
            "comment_count": len(markers),
        },
        "comments": [
            {
                "text": m.body or "",
                "frame": float(to_frames(m.seconds, fps)),
                "timestamp": float(m.seconds),
                "duration": (float(m.end_seconds - m.seconds)
                             if m.end_seconds is not None and m.end_seconds > m.seconds else None),
                "inserted_at": _iso_z(m.created_at),
                "completed_at": _iso_z(m.created_at) if m.resolved else None,
                "parent_id": None,
                "annotation": None,
                "author": m.author or "Reviewer",
            }
            for m in markers
        ],
    }
    return json.dumps(payload, indent=2, ensure_ascii=False)


# ── Final Cut Pro — FCPXML (standard interchange) ────────────────────────────

def _fcpxml_frame_duration(fps: float) -> tuple[int, int]:
    """Frame duration as (numerator, denominator) for FCPXML `frameDuration`.

    NTSC-fractional rates must be expressed exactly (1001/30000s), never as a
    rounded decimal — FCP conforms the whole sequence to this value, so a
    rounded rate drifts every marker.
    """
    nominal = nominal_fps(fps)
    if abs(fps - nominal * 1000 / 1001) < 0.01:
        return 1001, nominal * 1000
    return 1, nominal


def _xml_attr(text: str) -> str:
    return escape(text or "", {'"': "&quot;", "'": "&apos;"})


def build_fcpxml(markers: list[Marker], asset_name: str, fps: float,
                 width: int = 1920, height: int = 1080,
                 duration_seconds: float = 0.0,
                 drop_frame: Optional[bool] = None) -> str:
    """FCPXML 1.9 — markers on a media-less gap, importable by FCP 10.4+.

    This is the *standard* interchange format, unlike the `fcp` fiojson export
    which reproduces Frame.io's proprietary payload. Marker positions are
    absolute frame counts, so `drop_frame` only affects the displayed tcFormat.
    """
    num, den = _fcpxml_frame_duration(fps)

    def rational(frames: int) -> str:
        return f"{frames * num}/{den}s"

    def span(m: Marker) -> tuple[int, int]:
        start = to_frames(m.seconds, fps)
        if m.end_seconds is not None and m.end_seconds > m.seconds:
            return start, max(1, to_frames(m.end_seconds, fps) - start)
        return start, 1

    spans = [span(m) for m in markers]
    last_end = max((s + d for s, d in spans), default=0)
    # Pad the gap past the last marker so FCP never clips one at the boundary.
    gap_frames = max(to_frames(duration_seconds or 0, fps), last_end + nominal_fps(fps) * 10)

    rows = []
    for m, (start, dur) in zip(markers, spans):
        attrs = [
            f'start="{rational(start)}"',
            f'duration="{rational(dur)}"',
            f'value="{_xml_attr(_one_line(m.body) or "Comment")}"',
        ]
        if m.author:
            attrs.append(f'note="{_xml_attr(m.author)}"')
        if m.resolved:
            attrs.append('completed="1"')
        rows.append(f'          <marker {" ".join(attrs)}/>')
    markers_xml = "\n".join(rows)

    title = _xml_attr(f"{os.path.splitext(asset_name or 'comments')[0]} — comments")
    tc_format = "DF" if resolve_drop_frame(fps, drop_frame) else "NDF"
    gap_dur = rational(gap_frames)

    header = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<!DOCTYPE fcpxml>\n"
        '<fcpxml version="1.9">\n'
        "  <resources>\n"
        f'    <format id="r1" frameDuration="{num}/{den}s" '
        f'width="{int(width or 1920)}" height="{int(height or 1080)}"/>\n'
        "  </resources>\n"
        "  <library>\n"
        '    <event name="FreeFrame Comments">\n'
        f'      <project name="{title}">\n'
        f'        <sequence format="r1" duration="{gap_dur}" '
        f'tcStart="0s" tcFormat="{tc_format}">\n'
        "          <spine>\n"
        f'            <gap name="Gap" offset="0s" start="0s" duration="{gap_dur}">\n'
    )
    footer = (
        "            </gap>\n"
        "          </spine>\n"
        "        </sequence>\n"
        "      </project>\n"
        "    </event>\n"
        "  </library>\n"
        "</fcpxml>\n"
    )
    return header + (markers_xml + "\n" if markers_xml else "") + footer


# ── CSV ──────────────────────────────────────────────────────────────────────

def build_csv(markers: list[Marker], fps: float, drop_frame: Optional[bool] = None) -> str:
    df = resolve_drop_frame(fps, drop_frame)
    buf = io.StringIO()
    w = _csv.writer(buf)
    w.writerow(["Timecode", "Frame", "Seconds", "Author", "Comment", "Resolved", "Created At"])
    for m in markers:
        w.writerow([
            seconds_to_tc(m.seconds, fps, drop_frame=df),
            to_frames(m.seconds, fps),
            f"{m.seconds:.3f}",
            _csv_safe(m.author),
            _csv_safe(_one_line(m.body)),
            "yes" if m.resolved else "no",
            _iso_z(m.created_at) or "",
        ])
    return buf.getvalue()


# ── Dispatcher ───────────────────────────────────────────────────────────────

# program -> (media_type, file extension)
FORMATS = {
    "resolve":  ("application/octet-stream", "edl"),
    "premiere": ("application/xml", "xml"),
    "avid":     ("application/xml", "xml"),
    "fcp":      ("application/json", "fiojson"),
    "fcpxml":   ("application/xml", "fcpxml"),
    "csv":      ("text/csv", "csv"),
}

# program -> download filename prefix (mirrors Frame.io's naming)
_PROGRAM_LABELS = {
    "resolve": "Resolve",
    "premiere": "Premiere",
    "avid": "Avid MC",
    "fcp": "FCP",
    "fcpxml": "FCPXML",
    "csv": "Comments",
}


def export(fmt: str, markers: list[Marker], asset_name: str, fps: float,
           width: int = 1920, height: int = 1080,
           duration_seconds: float = 0.0,
           drop_frame: Optional[bool] = None) -> tuple[str, str, str]:
    """Build the export. Returns (content, media_type, filename).

    `drop_frame` only affects timecode-string formats (EDL/CSV): None = auto
    (drop-frame for NTSC 29.97/59.94). Premiere/Avid/FCP carry absolute frame
    numbers, so they're unaffected by the drop-frame convention.
    """
    if fmt not in FORMATS:
        raise ValueError(f"Unsupported format: {fmt}")
    media_type, ext = FORMATS[fmt]

    if fmt == "resolve":
        content = build_resolve_edl(markers, asset_name, fps, drop_frame=drop_frame)
    elif fmt == "premiere":
        content = build_premiere_xml(markers, asset_name, fps, width, height, duration_seconds)
    elif fmt == "avid":
        content = build_avid_xml(markers, fps)
    elif fmt == "fcp":
        content = build_fcp_fiojson(markers, asset_name, fps, duration_seconds)
    elif fmt == "fcpxml":
        content = build_fcpxml(markers, asset_name, fps, width, height,
                               duration_seconds, drop_frame=drop_frame)
    else:  # csv
        content = build_csv(markers, fps, drop_frame=drop_frame)

    # Mirror Frame.io's "<Program> <asset name>.<ext>" (asset extension stripped).
    root = os.path.splitext(asset_name or "comments")[0]
    safe = "".join(c if c.isalnum() or c in "-_ " else " " for c in root).strip() or "comments"
    safe = " ".join(safe.split())
    filename = f"{_PROGRAM_LABELS[fmt]} {safe}.{ext}"
    return content, media_type, filename
