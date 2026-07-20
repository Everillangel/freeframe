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
| **Final Cut Pro** | `.fcpxml` | FCPXML 1.9, markers on a media-less gap | Final Cut Pro 10.4+ natively |
| **Spreadsheet** | `.csv` | Timecode, frame, author, comment | Excel / Sheets / generic |

> **Two Final Cut options.** `fiojson` reproduces Frame.io's own payload, which
> is **proprietary to Frame.io** and needs a compatible importer. `fcpxml` is the
> standard interchange format FCP ingests natively — **use it if the fiojson
> import doesn't work for you.** NTSC rates are written as exact fractions
> (`1001/30000s`), never rounded, because FCP conforms the sequence to that value.

Only **top-level, timecoded** comments for the selected version are exported.
Timecodes are non-drop-frame SMPTE (`HH:MM:SS:FF`).

## Using it (UI)

In the review view's comment panel toolbar, click the **Download** icon and pick
your editor. The file downloads immediately, named like Frame.io's
(`Resolve <asset>.edl`). The export covers the version you're currently viewing.

## Using it (API)

```
GET /assets/{asset_id}/comments/export?format=premiere|resolve|avid|fcp|fcpxml|csv
```

| Param | Default | Meaning |
|---|---|---|
| `format` | `csv` | One of `premiere`, `resolve`, `avid`, `fcp`, `fcpxml`, `csv`. |
| `version_id` | latest ready version | Which version's comments to export. |
| `fps` | media's detected fps | Frame rate used for frames/timecodes. **Required if the media has none** — see below. |
| `include_resolved` | `true` | Set `false` to omit resolved comments. |
| `drop_frame` | auto (DF on NTSC) | Force drop-frame timecode on/off (EDL/CSV only). |

Requires an authenticated user with access to the asset. Returns the file as a
download (`Content-Disposition: attachment`).

### Unknown frame rate → `422`

If the version has **no stored frame rate** and you don't pass `fps`, the export
returns **422** (`fps_required`) instead of guessing. This is deliberate: every
format here embeds frame numbers or timecode, so assuming 30 fps silently shifts
every marker on 24/25/50 fps media — the export looks fine and is quietly wrong.

The UI handles this by prompting for the rate and retrying. To fix it properly,
run the metadata backfill so the rate is probed from the source:

```
POST /admin/backfill-media-metadata
```

## Importing into each editor

- **Premiere Pro** — File → Import the `.xml`; it opens as a sequence with the
  markers on the timeline (and on a "Marker Color Matte" clip, mirroring Frame.io).
- **DaVinci Resolve** — right-click the clip/timeline → **Import → Timeline
  Markers from EDL** (or import the EDL); markers land at their timecodes.
- **Avid Media Composer** — in the Markers/Locators window, **Import** the `.xml`.
  Track defaults to `V1`, colour to Blue.
- **Final Cut Pro** — the `.fiojson` is Frame.io's payload; import it with your
  Frame.io-style FCP marker workflow.

## Frame rate & drop-frame

The source frame rate is probed on upload and stored, so **whatever rate goes in
comes out** — 24, 25, 29.97, 50, 60 all round-trip. The transcode doesn't force a
rate, so the review proxy plays at the source rate too. You can see the detected
rate in the asset inspector ("Frame rate").

- **Premiere, Avid and FCP carry absolute frame numbers**, so they're immune to
  timecode conventions entirely.
- **The EDL (and CSV) use `HH:MM:SS:FF` strings**, so drop-frame matters. It's
  handled automatically: **29.97 / 59.94 → drop-frame** (`FCM: DROP FRAME`),
  everything else → non-drop. Override per export with `drop_frame=true|false`
  if your timeline differs. Without this, an hour of 29.97 lands ~3.6 s (108
  frames) out.
- **Interlaced sources** report frames (not fields) — 1080i25 → 25 fps — so
  markers are correct. Note the review proxy is **not** deinterlaced, so
  interlaced rushes may show combing during playback.

> If the inspector shows **"Frame rate: Unknown"**, the asset predates metadata
> capture and exports will assume 30 fps. An admin can run
> `POST /admin/backfill-media-metadata` to re-probe and fix it.

## Notes & assumptions

- Timecodes start at `00:00:00:00`. If your NLE timeline starts at `01:00:00:00`,
  offset accordingly on import.
- Frame rate comes from the media file; for sources with unknown fps it defaults
  to 30 — pass `fps=` to override (e.g. `fps=25` for PAL, `fps=23.976`).
- The `.fiojson` format is Frame.io-proprietary; if your FCP workflow can't take
  it, tell us and we'll add standard **FCPXML** as an option.
