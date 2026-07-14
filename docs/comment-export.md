# NLE Comment Export

Export a review's timecoded comments as marker files that import into the major
editors, so notes made in FreeFrame land back on the timeline in your NLE. The
files are modelled on **Frame.io's own exports** — one native format per editor.
Frame numbers/timecodes are frame-accurate, derived from the media's frame rate.

## Formats

| Program option | File | Format | Imports into |
|---|---|---|---|
| **Premiere Pro** | `.xml` | FCP7 XML (xmeml) with a marker color-matte | Adobe Premiere Pro |
| **DaVinci Resolve** | `.edl` | CMX3600 EDL (`@author` + `\|C:\|M:\|D:` metadata) | DaVinci Resolve |
| **Avid Media Composer** | `.xml` | Avid StreamItems (OMFI locator attributes) | Avid Media Composer |
| **Final Cut Pro** | `.fiojson` | Frame.io JSON marker payload | Final Cut Pro (via a Frame.io-style importer) |
| **Spreadsheet** | `.csv` | Timecode, frame, author, comment | Excel / Sheets / generic |

Only **top-level, timecoded** comments for the selected version are exported.
Timecodes are non-drop-frame SMPTE (`HH:MM:SS:FF`).

## Using it (UI)

In the review view's comment panel toolbar, click the **Download** icon and pick
your editor. The file downloads immediately, named like Frame.io's
(`Resolve <asset>.edl`). The export covers the version you're currently viewing.

## Using it (API)

```
GET /assets/{asset_id}/comments/export?format=premiere|resolve|avid|fcp|csv
```

| Param | Default | Meaning |
|---|---|---|
| `format` | `csv` | One of `premiere`, `resolve`, `avid`, `fcp`, `csv`. |
| `version_id` | latest ready version | Which version's comments to export. |
| `fps` | media's detected fps, else 30 | Frame rate used for frames/timecodes. |
| `include_resolved` | `true` | Set `false` to omit resolved comments. |

Requires an authenticated user with access to the asset. Returns the file as a
download (`Content-Disposition: attachment`).

## Importing into each editor

- **Premiere Pro** — File → Import the `.xml`; it opens as a sequence with the
  markers on the timeline (and on a "Marker Color Matte" clip, mirroring Frame.io).
- **DaVinci Resolve** — right-click the clip/timeline → **Import → Timeline
  Markers from EDL** (or import the EDL); markers land at their timecodes.
- **Avid Media Composer** — in the Markers/Locators window, **Import** the `.xml`.
  Track defaults to `V1`, colour to Blue.
- **Final Cut Pro** — the `.fiojson` is Frame.io's payload; import it with your
  Frame.io-style FCP marker workflow.

## Notes & assumptions

- Timecodes start at `00:00:00:00`. If your NLE timeline starts at `01:00:00:00`,
  offset accordingly on import.
- Frame rate comes from the media file; for sources with unknown fps it defaults
  to 30 — pass `fps=` to override (e.g. `fps=25` for PAL, `fps=23.976`).
- The `.fiojson` format is Frame.io-proprietary; if your FCP workflow can't take
  it, tell us and we'll add standard **FCPXML** as an option.
