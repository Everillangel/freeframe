# Film & DIT Workflow — a primer for engineers

_Read this before [dit-watch-folder-ingest.md](dit-watch-folder-ingest.md). It
explains the world this software lives in, so the technical choices in that plan
read as **consequences of how film production actually works** rather than
arbitrary preferences. No film knowledge assumed._

---

## 1. The one thing to internalise: the footage is irreplaceable

Everything else follows from this.

A feature film or commercial shoots for a fixed number of days on a schedule that
cost a fortune to assemble: cast, crew, locations, permits, catering, equipment
rental, daylight. A single shoot day commonly costs **£20k–£500k+**. The actors,
the crane, the closed-off street, the sunset — they are gone when the day ends.

The camera records to a **memory card**. Until that card's contents are safely
copied and _verified_ in multiple places, **one dropped card, one corrupt file,
one "I'll reformat this, it's backed up… wasn't it?" is a lost shot that can never
be recreated.** People are fired for this. Productions carry insurance for it.

So the guiding value of on-set data handling is not speed, and definitely not
convenience — it is **provable integrity**. Hold that thought; it explains why
this app treats checksums as sacred and refuses to ever be the only copy.

> **Engineering echo:** this is why the plan says *"FreeFrame is not the backup,"*
> mounts the source **read-only**, indexes files **in place** instead of copying
> them, and makes checksum verification a **gate**, not a nice-to-have.

---

## 2. The 60-second map: shoot → delivery

```
  ON SET                     POST-PRODUCTION
 ┌────────┐   cards    ┌──────────┐   proxies   ┌─────────┐  notes  ┌──────────┐
 │ Camera │ ────────►  │   DIT    │ ──────────► │ Editor  │ ◄─────► │ Review   │
 │        │            │ offload  │             │ (cut)   │         │ director │
 └────────┘            │ + verify │             └────┬────┘         │ /client  │
                       │ + backup │                  │              └──────────┘
                       └────┬─────┘             picture lock         ▲
                            │                        │               │
                       master copies            ┌────▼─────┐    ◄────┘  FreeFrame
                       (NAS / LTO /             │ Conform  │           lives HERE
                        shuttle drives)         │ + Color  │           (the review loop)
                                                │ + Sound  │
                                                └────┬─────┘
                                                     ▼
                                                 Delivery
                                              (cinema / TV /
                                               streamer / web)
```

**FreeFrame / Frame.io is the "Review" box** — the loop where a director, producer,
editor, or client watches the cut and leaves **timecoded notes**, which then have
to travel back into the editor's software. Everything to the left of it (getting
footage off the camera and into a watchable, editable state) is the world the
**DIT ingest feature** reaches into.

---

## 3. A day on set: where the files come from

The camera department is a small team:

- **DP / Cinematographer** — decides how it looks. Not touching files.
- **Camera Operator** — runs the camera.
- **1st AC (focus puller)** — keeps it sharp.
- **2nd AC / Loader** — manages the **cards**: labels them, tracks which are
  shot/offloaded/wiped, hands them to the DIT. Keeps the **camera report**.
- **DIT (Digital Imaging Technician)** — the subject of this document.

Film is shot in **takes**. Each take is a **clip** — a file (or a bundle of files,
see §7) on the card. A card fills up; the loader swaps in a fresh one and passes
the full card to the DIT. This happens continuously through the day. By wrap, a
production might have generated **0.5–4 TB** across many cards.

Crucially, the footage arrives in the camera manufacturer's own **folder structure
and naming**, e.g.:

```
A001_08071230_C003.RDC/         ← RED: a clip is a DIRECTORY of files
A camera, reel 001, clip 003

B002C0014_240708_R1AB.mov       ← ARRI: a single ProRes/MXF file
```

There is no universal layout. It differs by camera brand, by production's naming
convention, and by how the DIT sets up their software. **This is why the ingest
plan detects structure instead of assuming `Project/Day/Camera`.**

---

## 4. The DIT, in depth

The DIT sits at a cart (a rolling workstation with drives, monitors, sometimes a
color-calibrated display) near set. Their job splits into two halves; individual
DITs lean one way or the other:

### 4a. Data management (the part this app cares about)

This is a disciplined copy-and-verify loop, repeated for every card, all day:

1. **Offload** — copy the card's contents to a working drive.
2. **Verify** — read *back* what was written and compare a **checksum** (a hash of
   every file) against the source. A copy that "looks done" is not trusted until
   the hashes match. This catches truncated files, bad cables, dying drives.
3. **Multiply** — the **3-2-1 rule**: **3** copies, on **2** different kinds of
   media, with **1** kept offsite/off-cart. Typically: the cart's working drive, a
   **shuttle drive** that travels to post, and often **LTO tape** (archival) or a
   second drive.
4. **Report** — record what was offloaded, checksums, any card issues. Only then
   does the loader get the OK to **reformat and reuse** that card.

The DIT does **not** use a web page for this. They use purpose-built software that
automates the verify-and-multiply dance:

| Tool | Made by | Notes |
|---|---|---|
| **Silverstack** | Pomfort | High end; also does look management, QC, reporting |
| **ShotPut Pro** | Imagine Products | The classic dedicated offload-and-verify tool |
| **Hedge** | Hedge | Fast, simple, popular; multi-destination in one pass |
| **YoYotta** | YoYotta | Mac; strong LTO/archival |

These tools write a **checksum manifest** alongside the footage when a verified
offload completes — most importantly an **MHL** (Media Hash List; the standardised
form is **ASC MHL**), an XML sidecar listing every file and its hash.

> **Two engineering echoes, both load-bearing:**
> 1. The DIT expects to **offload and walk away**. A system that demands they open
>    a website and configure a job per card would be ignored on a real set. Hence
>    the plan's **zero-config SMB watch folder**, with the control panel as an
>    *override*, not a gate.
> 2. **The MHL only appears after a verified copy finishes.** So "an MHL covering
>    this file just landed" is a stronger, cleaner *"the copy is complete and
>    good"* signal than watching a file's size stop changing. The plan uses it as
>    the ingest trigger.

> **A hash-algorithm gotcha:** MD5 was the historical default, but modern tools
> increasingly write **xxHash64** because it's ~10× faster on multi-TB days. The
> plan therefore stores the algorithm per file and never assumes MD5.

### 4b. Look management (context, mostly out of scope)

Many DITs also handle on-set colour: applying a **LUT** or **CDL** (small files
describing a colour transform) so the monitors — and later the dailies — show the
intended look rather than the flat, desaturated **log** image the camera records.
These look files travel with the footage as sidecars. _The ingest plan notes them
but treats applying them as optional._

---

## 5. Why "proxies" exist, and offline vs online

The camera originals are **enormous and unplayable by normal software**. A RED or
ARRI RAW file, or even ProRes, will not open in a browser and will choke a laptop.
So post-production runs on **proxies** — smaller, easier copies:

- **Review proxies** — low-res streamable video for _watching and commenting_
  (what FreeFrame serves as HLS). Quality only needs to be "good enough to judge
  performance and framing."
- **Editorial proxies** — medium-quality files (usually **ProRes** or **DNxHR**)
  the editor actually cuts with. These must be **frame-accurate and carry the
  original's identity** (filename, timecode, reel) because of the next concept.

**Offline → online, and "conform":**

- The editor cuts the film using **editorial proxies** — this is the **offline
  edit**. Fast, light, done on modest hardware.
- When the cut is locked ("**picture lock**"), the edit is **conformed**: the
  editing software relinks every shot in the timeline back to the **full-quality
  camera originals** for finishing (colour grade, VFX, delivery). This is the
  **online**.
- Relinking works by matching **filename + timecode + reel/tape name**. If the
  editorial proxy didn't preserve those, the conform breaks and someone spends
  days fixing it by hand.

> **Engineering echo:** this is exactly why the plan makes the **editorial ProRes
> proxy a separate deliverable** from the review proxy, and insists it carry the
> **same basename, embedded timecode, and reel** as the camera original. The HLS
> review proxy is useless for conform; the editorial proxy is useless for the web
> player. Different codec, different destination, different lifecycle — one ingest,
> two outputs.

---

## 6. The review loop — where this software earns its place

Once there's a cut (even a rough one), people who aren't the editor need to watch
it and give feedback: the director, producer, showrunner, agency, client, brand.
Historically this meant emailing files or sitting in a room. **Frame.io** made it
a web app: upload the cut, everyone watches in a browser and leaves comments
**pinned to an exact frame/timecode**. FreeFrame is a self-hosted version of that.

The vital detail: a note like _"tighten this at 00:01:04:12"_ is worthless to the
editor as prose — they need it as a **marker on their timeline** in Avid / Premiere
/ Resolve / Final Cut. So the notes must **round-trip back into the NLE** in that
editor's native marker format.

> **Engineering echo:** this is the **comment-export feature** — and why it matches
> each NLE's real format (Resolve EDL, Premiere xmeml, Avid locators, FCP), and why
> **frame rate is load-bearing**: a marker's position is a frame number derived from
> `time × fps`. Guess the fps wrong and every note lands on the wrong frame. (This
> bug has bitten the codebase twice; see the handover.)

---

## 7. "One clip = one file" is a lie — the shapes footage takes

A coder's instinct is `1 file = 1 asset`. Camera media breaks that constantly:

| Shape | What it is | Example |
|---|---|---|
| **Single file** | The easy case | `B002C0014.mov`, `.mxf`, `.braw` |
| **Directory-as-clip** | One clip *is a folder* of internal files | RED `A001_C003.RDC/`, Sony `XDROOT/` |
| **Image sequence** | One shot = thousands of numbered frames | `shot_00001.dpx … shot_14400.dpx`, EXR |
| **Spanned / chaptered** | One take split across files (card-fill or 4 GB FAT32 limit) | GoPro `GH010123`, `GH020123` |

Treat a 14,400-frame DPX sequence as 14,400 assets and you've flooded the project
with junk and broken every downstream assumption.

> **Engineering echo:** the plan adds `source_kind` (file / directory / sequence /
> spanned) and dedupes on **clip identity**, not file path.

---

## 8. The formats you'll meet (rough mental model)

- **Camera RAW** — sensor data, maximum quality/flexibility, needs the vendor's
  SDK to decode. `ARRIRAW`, `REDCODE/R3D`, `Blackmagic RAW/.braw`, Sony `X-OCN`,
  Canon `Cinema RAW Light`, `ProRes RAW`. Big, unplayable by normal software.
- **Mezzanine / edit codecs** — high quality but manageable; what proxies and
  masters are made in. **ProRes** (Apple, ubiquitous) and **DNxHR/DNxHD** (Avid).
- **Delivery codecs** — small, for final output/streaming. **H.264 / H.265**.
- **Timecode** — `HH:MM:SS:FF`, the address of every frame. **Drop-frame** vs
  **non-drop** is an NTSC (29.97/59.94 fps) accounting trick to keep clock time
  honest; get it wrong and long timelines drift. **Reel/tape name** identifies
  which source a shot came from.

> **Engineering echo:** RAW decoding is a licensing/OS minefield (some SDKs are
> Linux-hostile or gated), which is why the plan proposes **decoder tiers** and
> leans on a **DaVinci Resolve Studio node** ($295, decodes everything) rather than
> integrating five vendor SDKs. **But most houses hand over ProRes/DNxHR dailies,
> not RAW** — so this may not be needed at all. That open question is the single
> biggest driver of scope.

---

## 9. The domain → code cheat sheet

The whole point of this document, in one table:

| Because, in the real world… | …the software must |
|---|---|
| Footage is irreplaceable and huge | **Never move or duplicate the master**; index in place, mount read-only, hold only proxies |
| Integrity is the DIT's entire job | Treat **checksums as a gate**; verify against the DIT's MHL; a mismatch is an **incident**, not a log line |
| DITs offload with their own tools and walk away | Provide a **zero-config watch folder**; the control panel is an override, never required |
| The MHL is written only after a good copy | Use **MHL arrival as the completion trigger**; size/mtime is the fallback |
| Layout differs per camera / house / job | **Detect** structure with a universal fallback; never hardcode `Project/Day/Cam` |
| A clip can be a folder or a frame sequence | Model **`source_kind`**; group into one asset; dedupe on clip identity |
| Editors conform proxies back to originals | Editorial proxy must preserve **filename + timecode + reel** |
| Browsers can't play RAW/ProRes | **Proxy-first**: make something watchable fast, full quality later |
| Notes must land on the editor's timeline | Export comments as **native NLE markers**, with the **correct fps** |
| RAW decode is a licensing/OS minefield | **Tiered decoders**; prefer a Resolve node; confirm whether RAW even arrives |

---

## 10. The judgment calls you'll actually face

When building the ingest feature, these are the real decisions — and the domain
reality that should steer them:

1. **"Do these houses send RAW or dailies?"** — *Ask before building decoders.* If
   they hand over ProRes/DNxHR (very common), stock ffmpeg covers everything and
   Tiers 1–3 are wasted effort. This one answer reshapes the whole feature.
2. **"What do I trust as 'the copy is finished'?"** — Prefer the **MHL**. Falling
   back to size/mtime on an SMB share is genuinely unreliable (coarse timestamps,
   flaky change notifications).
3. **"What's one asset?"** — Get **clip grouping** right or you drown the UI. It's
   the highest-risk piece of detection.
4. **"How paranoid about integrity?"** — Very. A checksum mismatch should **stop**
   and shout, never silently retry or half-import. This mirrors how a DIT would
   react, and it's what earns the tool trust on a real production.
5. **"Whose format does the editor want?"** — Confirm per cutting room (e.g. Avid
   houses often want **DNxHR/MXF**, not ProRes). Build editorial output as
   **pluggable presets**, not hardcoded ProRes.

If you remember only one sentence: **this tool is entering a workflow whose entire
culture is built around never losing a frame — so correctness, integrity, and
staying out of the DIT's way beat cleverness and speed every time.**
