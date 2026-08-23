# ClipForge AI

An AI-assisted short-form video tool. This repository currently contains the
**MVP foundation**: a real, working pipeline that takes a long video and
produces a genuine vertical 9:16 MP4 clip you can preview and download.

> **Honesty policy.** Everything described as working here has been executed and
> verified against real video files. Features that cannot run in this
> environment are listed as unavailable and are **not** simulated, stubbed or
> faked anywhere in the product. The app itself reports its own capabilities at
> runtime via `GET /api/capabilities`.

---

## What works today

| Feature | State | Notes |
| --- | --- | --- |
| Video upload & storage | **Live** | Validated, stored on disk, tracked in SQLite |
| Media inspection | **Live** | Duration, resolution, fps, codecs, audio presence |
| Real clip cutting | **Live** | Cuts a real segment, re-encodes to H.264/AAC |
| 9:16 vertical reframing | **Live** | True 1080×1920 canvas, scale + pad, never stretched |
| Audio preservation | **Live** | Kept when the source has audio; no fake silent track |
| Preview & download | **Live** | HTTP range requests so the player can seek |
| Transcription | **Unavailable** | Whisper weights cannot be downloaded (network/TLS blocked) |
| Scene / shot detection | **Unavailable** | OpenCV cannot load `libGL.so.1`; `apt` unavailable |
| AI highlight detection & scoring | **Planned** | Depends on transcription — no invented scores are shown |
| Burned-in captions | **Planned** | Depends on transcription |
| Multiple clips per project | **Planned** | Schema and renderer are structured for it |

---

## The FFmpeg constraint (important)

This environment has **no system `ffmpeg` and no system `ffprobe`**, and `apt`
cannot be used. ClipForge therefore uses the static FFmpeg binary shipped by the
[`imageio-ffmpeg`](https://pypi.org/project/imageio-ffmpeg/) Python package,
installed into a local virtualenv.

* The binary is resolved by `server/media/ffmpeg-locator.ts`.
* **There is deliberately no fallback to `ffmpeg` on `PATH`.** If the verified
  binary is missing the app reports the feature as unavailable rather than
  silently degrading.
* Because `imageio-ffmpeg` ships **only** `ffmpeg` (no `ffprobe`), media
  metadata is parsed from the banner that `ffmpeg -i` writes to stderr. This is
  real demuxer output; any field that cannot be determined is reported as
  `null` rather than guessed.

Override the binary explicitly with `CLIPFORGE_FFMPEG=/path/to/ffmpeg`.

---

## Getting started

```bash
# 1. Install JS dependencies
npm install

# 2. Provision the verified FFmpeg binary (creates .venv, installs imageio-ffmpeg)
npm run setup:ffmpeg

# 3. Run the API (:8787) and the web app (:5173) together
npm run dev
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` to the API
process, so the browser only ever uses relative URLs.

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | API + web together |
| `npm run dev:api` / `npm run dev:web` | Run either half alone |
| `npm run build` | Typecheck then production build |
| `npm run typecheck` | Type-check both the browser and server projects |
| `npm run lint` | ESLint |
| `npm test` | Full test suite (includes real video encode/decode) |
| `npm run setup:ffmpeg` | Install/verify the FFmpeg binary |

---

## Architecture

Deliberately modular, so AI features can be layered on without rewrites.

```
server/
  config.ts                 paths, limits, allow-lists
  index.ts                  Express app wiring
  media/
    ffmpeg-locator.ts       finds + probes the imageio-ffmpeg binary
    ffmpeg-runner.ts        safe spawn(); argv arrays, never a shell
    inspect.ts              metadata parsing (no ffprobe available)
    clip-renderer.ts        real cut + 9:16 scale/pad, atomic output
  db/
    database.ts             node:sqlite connection + schema
    projects-repo.ts        all SQL; row -> DTO mapping
  jobs/render-queue.ts      render job state + real FFmpeg progress
  storage/paths.ts          traversal guards, filename sanitising
  routes/                   projects.ts, capabilities.ts

src/
  api/                      client.ts (relative URLs), types.ts
  components/               TopBar, StatusPill, ProgressBar, CapabilityPanel
  pages/                    DashboardPage, NewProjectPage, ProjectPage
  lib/format.ts             display formatting
  styles/global.css         mobile-first styling
```

### Data flow

```
upload → inspect (real decode) → create project (SQLite)
       → configure clip (start / length / aspect)
       → render with FFmpeg → verify output → preview / download
```

---

## Security

* **No shell, ever.** FFmpeg is invoked with `spawn(binary, argv[])` and
  `shell: false`. Filenames containing spaces, `;`, `$(...)` or quotes are inert
  data. A test asserts this with a canary file that a shell would have deleted.
* **No user-controlled FFmpeg arguments.** The client sends only a start time, a
  duration and an aspect enum; every value is range-checked and the filter graph
  is built server-side.
* **No path traversal.** The browser only ever sends a UUID. Paths are built
  server-side and re-validated with `assertInside()`.
* **Upload validation.** Extension allow-list, MIME check, size cap (512 MB
  default), and a real decode check — files that are not decodable video are
  rejected and deleted.
* **No server paths leak to the browser.** The project DTO deliberately omits
  `source_path` / `output_path`.

---

## Persistence

Local SQLite via Node's built-in `node:sqlite`. No remote database, no Supabase,
no API keys. The `projects` table stores id, name, source filename/path, output
path, status, error message, media/output JSON and timestamps.

Runtime state lives in `data/` (gitignored): `uploads/`, `outputs/`, `tmp/` and
`clipforge.db`.

---

## Testing

```bash
npm test
```

35 tests, including **real** video work — synthetic sources are encoded with the
actual FFmpeg binary, rendered, then decoded again to verify the result. Tests
never assume success from an exit code alone; they assert on the output file
(existence, size, `ftyp` box, dimensions, duration, audio streams).

Covered: 9:16 output is exactly 1080×1920 with audio preserved; silent sources
produce video-only output; portrait sources are letterboxed not stretched;
duration clamping; and failure handling for missing files, non-video files,
audio-only files, out-of-range start times, invalid parameters and
shell-metacharacter filenames.

---

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API port |
| `CLIPFORGE_FFMPEG` | auto | Explicit FFmpeg binary path |
| `CLIPFORGE_DATA_DIR` | `./data` | Runtime state directory |
| `CLIPFORGE_DB` | `<data>/clipforge.db` | SQLite file |
| `CLIPFORGE_MAX_UPLOAD` | `536870912` | Max upload bytes |
| `CLIPFORGE_API_TARGET` | `http://127.0.0.1:8787` | Vite proxy target |

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness |
| `GET` | `/api/capabilities` | Real probed capabilities |
| `GET` | `/api/projects` | List projects |
| `POST` | `/api/projects` | Upload video (multipart `video`) |
| `GET` | `/api/projects/:id` | Project + live job state |
| `POST` | `/api/projects/:id/process` | Start a render |
| `GET` | `/api/projects/:id/output` | Stream the clip (range supported) |
| `GET` | `/api/projects/:id/download` | Download the clip |
| `DELETE` | `/api/projects/:id` | Delete project and files |

---

## Known limitations

1. **No transcription / captions / AI scoring.** Blocked by model download
   restrictions. Not faked.
2. **No scene detection.** OpenCV cannot load in this environment.
3. **Clip selection is manual.** Automatic "viral moment" detection needs
   transcription first.
4. **One clip per project**, replaced on re-render.
5. **In-process job state.** Render progress is held in memory, so a server
   restart mid-render loses progress (the project row still records the status).
6. **Vertical mode letterboxes** rather than smart-cropping; content-aware
   reframing requires subject tracking.
