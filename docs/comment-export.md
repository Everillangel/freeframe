# NLE Comment Export

Export a review's timecoded comments as marker/locator files that import into
the major editors, so notes made in FreeFrame land back on the timeline in your
NLE. Timecodes are **frame-accurate**, derived from the media's frame rate.

## Formats

| Format | File | Imports into | Notes |
|---|---|---|---|
| **CSV** | `.csv` | Spreadsheets, generic marker importers | Human-readable; formula-injection-safe. |
| **EDL** (CMX3600) | `.edl` | DaVinci Resolve, Avid, Premiere | Markers carried as `*LOC:` lines. |
| **FCPXML** | `.fcpxml` | Final Cut Pro (also Resolve, Premiere) | Resolved comments export as completed to-do markers. |
| **Avid locator** | `.txt` | Avid Media Composer | Tab-delimited: Name, TC, Track, Color, Comment. |

Timecodes are non-drop-frame SMPTE (`HH:MM:SS:FF`). Only **top-level, timecoded**
comments for the selected version are exported.

## Using it (UI)

In the review view's comment panel toolbar, click the **Download** icon and pick
a format. The file downloads immediately. The export covers the version you're
currently viewing.

## Using it (API)

```
GET /assets/{asset_id}/comments/export?format=csv|edl|fcpxml|avid
```

Query parameters:

| Param | Default | Meaning |
|---|---|---|
| `format` | `csv` | One of `csv`, `edl`, `fcpxml`, `avid`. |
| `version_id` | latest ready version | Which version's comments to export. |
| `fps` | media's detected fps, else 30 | Override the frame rate used for timecodes. |
| `include_resolved` | `true` | Set `false` to omit resolved comments. |

Requires an authenticated user with access to the asset. Returns the file as a
download (`Content-Disposition: attachment`).

## Importing into each editor

- **DaVinci Resolve** — import the **EDL** onto/next to the clip or timeline;
  markers appear as clip/timeline markers. FCPXML also works.
- **Avid Media Composer** — use the **`.txt`** locator file (Import markers).
  Track defaults to `V1`, color to `red`.
- **Premiere Pro** — import the **EDL** or **FCPXML**; markers come in on the
  sequence. CSV is handy for spreadsheet review.
- **Final Cut Pro** — import the **FCPXML**; markers attach to the clip.

## Notes & assumptions

- Timecodes start at `00:00:00:00`. If your NLE timeline starts at `01:00:00:00`,
  offset accordingly on import.
- Frame rate comes from the media file; for sources with unknown fps it defaults
  to 30 — pass `fps=` to override (e.g. `fps=25` for PAL, `fps=23.976`).
- Non-drop-frame timecode is used throughout.
