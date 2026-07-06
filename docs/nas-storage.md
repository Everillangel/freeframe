# NAS Storage (MinIO)

FreeFrame stores all media (uploads, transcoded HLS, thumbnails) through the **S3
API**. To keep your media physically on a NAS, run **MinIO** — a small
open-source S3-compatible server — on the NAS and point it at a folder on your
NAS volumes. FreeFrame then talks S3 to the NAS, so uploads, video streaming and
thumbnails keep working exactly as designed, **with no application code changes**.

```
Browser ──uploads/streams──►  MinIO (on the NAS)  ──stores files──►  NAS disks
FreeFrame API/worker ─S3 API─►  http://<nas-ip>:9000
```

---

## 1. Run MinIO on the NAS

Pick the path for your NAS. In all cases you are creating a **data folder** on the
NAS and exposing it on **port 9000** (S3 API) and **9001** (web console).

### Synology (DSM 7+)

1. Open **Container Manager** → **Registry**, search `minio/minio`, download the
   `latest` tag.
2. Create a shared folder for the data, e.g. `/volume1/freeframe`.
3. **Container Manager → Container → Create**, image `minio/minio`:
   - **Volume:** map `/volume1/freeframe` → `/data`.
   - **Port:** `9000 → 9000` and `9001 → 9001`.
   - **Environment:**
     - `MINIO_ROOT_USER` = a username you choose (this becomes `S3_ACCESS_KEY`)
     - `MINIO_ROOT_PASSWORD` = a strong password (this becomes `S3_SECRET_KEY`)
   - **Command / Execution:** `server /data --console-address ":9001"`

### QNAP

Use **Container Station** → **Create Application** with the Compose snippet in
§2 below (Container Station accepts Docker Compose YAML directly).

### TrueNAS SCALE

**Apps → Discover Apps → Custom App** (or the community MinIO chart). Set the data
storage to a dataset on your pool, the credentials as above, and expose ports
9000/9001.

### Unraid

**Apps (Community Applications)** → search **MinIO** → install the template. Set
the appdata/data path to a share on the array, set the root user/password, and
map ports 9000/9001.

### Any NAS with Docker / Portainer

```yaml
# minio-compose.yml — run on the NAS
services:
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"   # S3 API — FreeFrame connects here
      - "9001:9001"   # Web console — for you to manage buckets
    environment:
      MINIO_ROOT_USER: freeframe          # becomes S3_ACCESS_KEY
      MINIO_ROOT_PASSWORD: change-me-long  # becomes S3_SECRET_KEY
    volumes:
      - /path/on/nas/freeframe:/data       # media lives here on the NAS
    restart: unless-stopped
```

```bash
docker compose -f minio-compose.yml up -d
```

> If your NAS cannot run Docker at all, MinIO also ships as a single binary
> (`minio server /path/on/nas`), but Docker is the supported, low-maintenance
> route. If Docker is impossible on your NAS, use the native filesystem backend
> instead (out of scope here) or mount the NAS share into the FreeFrame host and
> run MinIO there against the mount.

---

## 2. Create the bucket

Open the MinIO console at `http://<nas-ip>:9001`, log in with the root
user/password, and **create a bucket** named `freeframe` (or whatever you set in
`S3_BUCKET`). FreeFrame also tries to create the bucket on startup, but making it
yourself avoids permission surprises.

---

## 3. Point FreeFrame at the NAS

In your `.env.prod` (or `.env` for dev), set:

```bash
S3_STORAGE=minio        # keep "minio" — NOT "s3". This tells FreeFrame to use S3_ENDPOINT.
S3_BUCKET=freeframe
S3_ACCESS_KEY=freeframe            # = MINIO_ROOT_USER
S3_SECRET_KEY=change-me-long       # = MINIO_ROOT_PASSWORD
S3_REGION=us-east-1
S3_ENDPOINT=http://<nas-ip>:9000        # how the API/worker reaches the NAS
S3_PUBLIC_ENDPOINT=http://<nas-ip>:9000  # how the browser reaches the NAS
```

- **`S3_STORAGE` must stay `minio`.** Setting it to `s3` makes FreeFrame ignore
  `S3_ENDPOINT` and talk to real AWS.
- **`S3_ENDPOINT`** is used server-side (API + transcoding worker) to read/write
  objects. Use the address those containers can reach — usually the NAS LAN IP.
- **`S3_PUBLIC_ENDPOINT`** is baked into presigned URLs the **browser** uses for
  direct uploads and HLS segment downloads. It must be reachable from users'
  machines. On a LAN this is the same NAS IP; if FreeFrame is exposed over the
  internet, this must be a publicly reachable MinIO address (see §5).

If both FreeFrame and the browser reach the NAS at the same address, the two
endpoints are identical.

Restart FreeFrame:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

---

## 4. Verify

1. Upload a video in FreeFrame. In the MinIO console you should see objects appear
   under `raw/...` immediately, then `processed/...` once transcoding finishes.
2. Play the video — HLS segments stream from the NAS.
3. Confirm the files are on the NAS volume you mapped to `/data`.

If uploads start but stall, or playback 403s, it's almost always
`S3_PUBLIC_ENDPOINT` pointing somewhere the browser can't reach — see below.

---

## 5. Notes & gotchas

- **Two endpoints, one cause of 90% of issues.** Server-side traffic uses
  `S3_ENDPOINT`; browser traffic uses `S3_PUBLIC_ENDPOINT`. If the browser can't
  reach the NAS address in `S3_PUBLIC_ENDPOINT`, uploads/streaming fail even
  though the server side is fine.
- **CORS is handled automatically.** On startup FreeFrame sets a CORS policy and a
  public-read policy on the `processed/` prefix of the bucket (for MinIO
  endpoints). The MinIO root credentials have permission to do this.
- **Exposing over the internet / HTTPS.** For remote reviewers, put MinIO behind a
  reverse proxy with TLS (e.g. Traefik or your NAS's built-in reverse proxy) and
  set `S3_PUBLIC_ENDPOINT=https://media.yourdomain.com`. Keep `S3_ENDPOINT` on the
  internal address for speed.
- **Backups.** Your media now lives in the MinIO data folder on the NAS — include
  that folder (and your Postgres volume) in the NAS backup/snapshot schedule.
- **Performance.** Transcoding streams the source from MinIO over the network;
  wired gigabit (or better) between the FreeFrame host and the NAS is recommended
  for large 4K files.
