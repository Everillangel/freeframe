# Security Hardening & POPIA (South Africa) Guide

This guide covers the operational steps to secure a FreeFrame deployment and the
measures needed to process personal information lawfully under **POPIA** (the
Protection of Personal Information Act, 2013). It complements the code-level
controls shipped in the app.

> This is technical/operational guidance, **not legal advice**. POPIA also
> imposes legal duties (registering an Information Officer, a privacy policy)
> that software alone cannot satisfy — see [§7](#7-popia-operational-checklist).

---

## 1. Rotate every default secret (do this first)

The shipped defaults are for local development only. Before any real deployment,
change **all** of these in your `.env.prod`:

| Variable | Why it matters | Generate with |
|---|---|---|
| `JWT_SECRET` | Signs JWTs **and** encrypts share-link passwords. Default/leaked = forged admin sessions + recoverable share passwords. | `openssl rand -hex 64` |
| `S3_SECRET_KEY` / `S3_ACCESS_KEY` (MinIO root) | Full read/write to all media. | `openssl rand -hex 24` |
| `POSTGRES_PASSWORD` | Full database access (all PII). | `openssl rand -hex 24` |
| `REDIS_PASSWORD` | Sessions, magic codes, rate-limit state. | `openssl rand -hex 24` |

Per-client fleet (Option 1 deployments): **each client gets its own unique set.**
Never reuse secrets across client stacks — one leak must not cross tenants.

---

## 2. Keep MinIO private + TLS

Media contains personal information (faces, voices, client material). MinIO must
not be openly reachable.

- **Do not expose MinIO's port 9000 to the internet.** Keep it on the LAN/VPN
  between the FreeFrame host and the NAS. Remote reviewers reach media through
  the FreeFrame app (presigned URLs + the `/stream/hls` proxy), not MinIO
  directly.
- If remote reviewers need direct media access, put MinIO behind a TLS reverse
  proxy and set `S3_PUBLIC_ENDPOINT=https://media.yourdomain.com`, keeping
  `S3_ENDPOINT` on the internal address.
- FreeFrame keeps the bucket private and serves via presigned URLs and the HLS
  proxy. Verify no broad public-read policy remains on the bucket (`mc anonymous
  get local/<bucket>` should not report `download` for the whole bucket).

See [nas-storage.md](nas-storage.md) for the MinIO setup itself.

---

## 3. Real client IP behind Traefik (rate limiting)

FreeFrame throttles auth and API abuse per client IP. Behind a proxy, it must be
told how many proxies to trust so it reads the real client IP from
`X-Forwarded-For` rather than the proxy's own address.

- Set **`TRUSTED_PROXY_COUNT=1`** when using the bundled Traefik (the default).
- Set `0` only if the API is exposed directly with no proxy.
- If you add more proxy layers (e.g. Cloudflare → Traefik), increase the count
  to match, otherwise a client could spoof `X-Forwarded-For`.

No Traefik change is required — Traefik already appends the real client IP to
`X-Forwarded-For`, and the app selects the correct hop from the right.

---

## 4. Encrypt data at rest

POPIA s19 expects appropriate technical safeguards. The database and object
store hold personal data on disk:

- Enable **volume/dataset encryption on the NAS** for the folders backing MinIO
  and Postgres (ZFS/Btrfs native encryption, or LUKS on the host).
- Ensure backups/snapshots of those volumes are encrypted too.
- Keep TLS on all external traffic (Traefik auto-provisions Let's Encrypt when
  `DOMAIN` + `ACME_EMAIL` are set).

---

## 5. Tokens & sessions

- Access tokens are short-lived (15 min); refresh tokens last 7 days and are
  **not currently revocable** — treat refresh tokens as sensitive. If you need
  hard logout / revocation, that is a planned enhancement (token rotation +
  denylist).
- Deactivating a user (`/admin/users/{id}/deactivate`) blocks their access on
  the next request.

---

## 6. Built-in privacy controls (reference)

FreeFrame ships endpoints to service data-subject requests:

| Action | Endpoint | Who |
|---|---|---|
| Export my data | `GET /me/data-export` | Any authenticated user |
| Export a user's data | `GET /admin/privacy/users/{id}/data-export` | Superadmin |
| Export a guest's data | `GET /admin/privacy/guests/{id}/data-export` | Superadmin |
| Erase a user | `POST /admin/privacy/users/{id}/erase?purge_media=true` | Superadmin |
| Erase a guest | `POST /admin/privacy/guests/{id}/erase?purge_media=true` | Superadmin |

Erasure **anonymises** the person (name, email, credentials, avatar) across all
tables and scrubs denormalised copies in activity logs, keeping review history
intact. `purge_media=true` also deletes their uploaded comment attachments from
storage.

A daily retention job (`purge_expired_data`, Celery beat) anonymises users that
were soft-deleted more than `RETENTION_ERASE_AFTER_DAYS` ago and purges
share-link activity older than `RETENTION_ACTIVITY_DAYS`.

Set `NEXT_PUBLIC_PRIVACY_URL` (web) to show a link to your privacy policy on the
guest comment form.

---

## 7. POPIA operational checklist

Software can't satisfy these — they're your responsibility as the responsible
party:

- [ ] **Appoint and register an Information Officer** with the Information
      Regulator, and keep a PAIA manual.
- [ ] **Publish a privacy policy** (what you collect, why, retention, third
      parties, data-subject rights) and link it via `NEXT_PUBLIC_PRIVACY_URL`.
- [ ] **Consent/notice at collection** — the guest comment form shows a notice;
      ensure your policy backs it.
- [ ] **Operator agreements** — sign a data-processing agreement with any
      third-party operator (email provider, etc.).
- [ ] **Cross-border transfers (s72)** — keep media/DB in South Africa (the NAS
      helps). Watch email: AWS SES / US SMTP providers send reviewer email
      addresses abroad. Prefer a SA/EU provider or ensure adequate contractual
      protection.
- [ ] **Retention** — tune `RETENTION_*` to your policy; confirm the daily job
      runs (Celery `beat` service).
- [ ] **Breach response** — have a plan to notify the Regulator and affected
      data subjects (s22).
- [ ] **Access control** — grant project roles on least-privilege; review
      superadmins periodically.
