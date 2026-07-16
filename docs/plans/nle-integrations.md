# Plan — NLE App Integrations (Premiere / Resolve / Avid / Final Cut)

**Status:** not started · **Priority:** medium · **Size:** large

## Goal

Editors work inside their NLE instead of a browser: see the FreeFrame comment
list in a panel, click a comment to jump the playhead, push markers to the
timeline, and pull/push versions — the Frame.io panel experience.

## Reality check

This is **four separate products**, not one feature. Each is a different language,
toolchain, SDK and distribution channel. There is very little shared code beyond
the API client.

| Target | Tech | Distribution | Difficulty |
|---|---|---|---|
| **Premiere Pro** | **UXP** panel (JS/HTML/CSS); CEP is the legacy path | Adobe plugin (UXP/ZXP), or side-load for internal use | 🟢 Most tractable |
| **DaVinci Resolve** | **Workflow Integration Plugin** — JS in an Electron-ish webview + Resolve's **Python/Lua scripting API** | Drop-in plugin folder | 🟢 Tractable (**needs Resolve *Studio***) |
| **Final Cut Pro** | **Workflow Extension** — a real **macOS app** (Swift/ObjC, Xcode) | Signed + **notarized**, needs an Apple Developer account + a Mac to build | 🟠 Heavier |
| **Avid Media Composer** | Avid **Panel SDK / ACS** | Requires Avid partner/SDK access | 🔴 Hardest, gated |

**Recommendation: prove one first.** Build **Resolve or Premiere** end-to-end,
learn what the shared core needs, then port. Don't commit to all four up front.

## Prerequisite: auth + a stable API surface (do this first)

The panels are just API clients, but today's auth doesn't suit desktop apps:

- Auth is **JWT access (15 min) + refresh (7 days)**, designed for a browser.
  A panel needs **long-lived, revocable credentials**.
- **Build API tokens / PATs** (per-user, named, revocable, scoped) *before* any
  panel work. This is a small backend feature and unblocks all four.
- Consider a device-code / "paste this code" pairing flow so editors don't type
  passwords into a panel.
- Freeze/version the endpoints the panels rely on (assets, versions, comments,
  markers export, upload) — panels ship on their own release cycle and can't be
  refactored in lockstep.

## Shared core (write once, reuse per target)

- **API client**: auth/pairing, list projects/assets/versions, fetch comments,
  post comments, download proxy/original.
- **Marker mapping**: we already generate native marker data per NLE — reuse
  `comment_export` (frames are absolute in Premiere/Avid/FCP; only EDL/CSV care
  about drop-frame). See [comment-export.md](../comment-export.md).
- **Timecode/frame conversion**: comment seconds ↔ frames using the asset's real
  fps (now stored — see the metadata work).

## Per-target notes

### Premiere Pro (UXP) — suggested first
- Panel lists comments; click → `setPlayerPosition` on the sequence.
- Push markers via the DOM API (or import our xmeml).
- UXP is the future; CEP is deprecated but has more examples. Choose UXP.

### DaVinci Resolve — also a good first
- Workflow Integration Plugin (webview) + the Python scripting API
  (`Resolve.GetProjectManager()...`), which can add timeline markers directly —
  cleaner than EDL import.
- ⚠️ **Workflow Integrations require Resolve Studio** (not the free version).

### Final Cut Pro
- Workflow Extension runs *inside* FCP as a macOS app; needs Xcode, a signing
  identity and notarization. Budget for Apple developer overhead, not just code.
- Marker push is limited compared to Premiere/Resolve; FCPXML round-trip may still
  be the practical path.

### Avid Media Composer
- Panel SDK access is gated behind an Avid partnership; assume a lead time.
- Fallback that works **today**: our Avid StreamItems XML locator export.

## Phases

1. **API tokens/PAT + pairing flow** (backend, small) — unblocks everything.
2. **Shared API client + marker mapping** extracted/documented.
3. **One panel end-to-end** (Resolve *or* Premiere): auth, comment list,
   click-to-seek, push markers.
4. Evaluate, then port to the second target.
5. FCP / Avid only if the value is proven — both carry real external overhead
   (Apple notarization; Avid SDK access).

## Interim (zero-integration) answer
The **marker exports already work today** for all four apps — editors import a
file rather than clicking in a panel. That covers the core "notes reach the
timeline" need while the panels are built.
