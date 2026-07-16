# Backlog — smaller deferred items

Things we've discussed and consciously parked, with enough context to pick up cold.
Bigger efforts have their own plans: [DIT watch-folder ingest](dit-watch-folder-ingest.md),
[NLE integrations](nle-integrations.md).

---

## 1 · Auto-deinterlace the review proxy
**Deferred by choice · small**

Interlaced sources (1080i25/i29.97) transcode without any deinterlace filter, so
the review proxy shows **combing artifacts**. Markers are unaffected — ffprobe
reports frames not fields (1080i25 → 25 fps), so comment→frame math is correct.

*Fix:* probe `field_order` in `parse_probe()`; when it's interlaced (`tt/bb/tb/bt`),
prepend `yadif` (or `bwdif`) to each branch filter in `build_hls_command()`. Only
applies to interlaced sources; progressive footage is untouched.

---

## 2 · Reconcile the two retention systems
**Needs a decision · small**

After the upstream v1.4.1 merge, two jobs run on ~the same 30-day window:

| Job | Time | Does |
|---|---|---|
| `purge_expired_data` (ours, POPIA) | 03:30 | **Anonymises** users soft-deleted past `RETENTION_ERASE_AFTER_DAYS`; purges share activity past `RETENTION_ACTIVITY_DAYS` |
| `cleanup_soft_deleted` (upstream GC) | 03:00 | **Hard-deletes** rows soft-deleted past `SOFT_DELETE_RETENTION_DAYS` + reclaims their S3 objects |

They're complementary (hard-delete is stronger erasure; ours also scrubs
denormalised emails in activity logs), but running both on the same window is
untidy. **Decide:** keep both, fold the POPIA anonymisation into upstream's
cleanup, or disable one.

**Footgun to fix regardless:** `RETENTION_ERASE_AFTER_DAYS=0` currently means
"anonymise everything already-deleted *immediately*" — the opposite of "off".
Upstream's convention is `0`/negative = disabled. Add that guard so the value
can't backfire, and so auto-anonymisation can be turned off entirely (leaving
erasure to the manual POPIA endpoint).

> Reminder of intent: **active and deactivated users are never touched** — only
> users an admin explicitly deleted (soft-deleted) are in scope.

---

## 3 · Refresh-token rotation + revocation
**Deferred · medium**

Refresh tokens last 7 days and **cannot be revoked** — logout is client-side only,
so a stolen refresh token stays valid until expiry. Deactivating a user *does*
block them on the next request, which limits the blast radius.

*Fix:* a token store (rotation + denylist/jti), which needs an Alembic migration.
Raised in the security review; not urgent for a LAN/Tailscale deployment.

---

## 4 · FCPXML as an alternative FCP export
**Conditional · small**

FCP currently exports **`.fiojson`** to match the Frame.io reference — but that
format is **Frame.io-proprietary** (their importer's payload), not something FCP
ingests natively. If the FCP workflow can't take it, add back standard **FCPXML**
(previously implemented and working) as a second FCP option. Decide after a real
import test.

---

## 5 · Media metadata for audio + images
**Small**

The metadata fix persists fps/resolution/duration for **video** only.
`_process_audio` / `_process_image` still don't record duration or dimensions.
Low impact (markers only need video fps), but the inspector would be more complete.
The `backfill_media_metadata` task is likewise video-only.

---

## 6 · Zero host-coupling for media (proxy media through the app)
**Explicitly declined · large**

`S3_PUBLIC_ENDPOINT` is the one remaining setting that must contain a
browser-reachable host, because media is served **directly from MinIO via
presigned URLs** (a presigned URL can't be relative — the host is part of the
signature). Everything else is host-independent.

Removing it entirely means proxying every segment/thumbnail through the API,
which adds real load. Declined as not worth it — revisit only if the storage
address changes often enough to hurt.

---

## 7 · Public access for external reviewers
**Situational**

Email links use `FRONTEND_URL`, and in-app access is host-independent — but a
Tailscale/LAN address **won't open for reviewers outside the network**. When
external review starts, you'll need a public domain (or Cloudflare Tunnel) +
HTTPS, and `FRONTEND_URL=https://…`. See
[deployment.md](../deployment.md#remote-access--reverse-proxy-lan--tailscale--custom-nginx).
