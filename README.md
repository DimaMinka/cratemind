# CrateMind 🧠🎶

[![VibeTalent Badge](https://www.vibetalent.work/api/badge/dimaminka)](https://www.vibetalent.work/profile/dimaminka)

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D%2018.0.0-blue.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Gemini API](https://img.shields.io/badge/Gemini%20API-PRO-orange.svg)](https://ai.google.dev/)
[![Ink TUI](https://img.shields.io/badge/Ink-React--TUI-green.svg)](https://github.com/vadimdemedes/ink)

**CrateMind** is a semi-automatic audio classifier and intelligent library organizer designed to categorize your music library into atmosphere-based folders ("crates") using the Gemini API, a Retrieval-Augmented Generation (RAG) memory layer, and an interactive, premium terminal user interface (TUI) built with React and Ink.

---

## 🌟 Key Features

- **Telegram Bulk Downloader (GramJS Userbot)**:
  - Sync and download tracks from defined Telegram channels/chats.
  - **Smart Batching**: Integrates with the file watcher to queue downloads and wait for a full `BATCH_SIZE` (default: 5) chunk of tracks before starting analysis, optimizing Gemini API daily limits and preventing rate exhaustion.
  - **Strict Deduplication**: Automatically checks the `./Incoming` folder, the recursive `./Sorted` folder (including skipped files), and the **Engine DJ SQLite Database** before downloading to avoid duplicate tracks.
  - **Download-Only Mode**: Press `[D]` in the interactive prompt when starting sync to download files from Telegram to `Incoming` without spawning any LLM or classification tasks (useful for bulk loading tracks to process later).
  - **Automatic Mix Protection**: Automatically checks audio duration and skips tracks exceeding a configurable limit (default: 20 minutes) to avoid downloading long DJ mixes or podcasts.
  - **Snippet & Preview Filter**: Skips files that fall below a minimum file size threshold (default: 10 MB for lossless formats like `.flac`, `.wav` and 3 MB for lossy formats like `.mp3`) to prevent downloading low-quality snippets or previews.
- **Drive-to-Drive Mirror Synchronization (EngineDJ SD [Master] -> EngineDJ)**:
  - Smart dual-drive detection when pressing `[S]` (_Sync to Collection_). When both the master SD card and the target backup drive are mounted, CrateMind offers a dedicated option `[D] Mirror SD -> EngineDJ Drive`.
  - **4-Stage Pipeline & Telemetry**:
    - `[1/4] Checking obsolete & relocated tracks`: Performs smart relocation for tracks moved between crates (e.g., into `Atmosphere/` subcrates) directly on the target drive via instant local filesystem moves (`renameSync`), eliminating gigabytes of redundant USB transfers. Automatically scans `Removed from SD/` and recovers any active tracks back into `Music Collection/`. Only genuinely deleted tracks are archived into `Removed from SD/` with original folder structure preserved (never deleted).
    - `[2/4] Analyzing files (Dry-Run)`: Performs a quick dry-run scan to discover and count the exact number of new/modified audio tracks needing USB transfer.
    - `[3/4] Mirroring Music Collection`: Transfers audio files via targeted rsync (`--files-from`) with `--progress` and real-time carriage return stream parsing, displaying a live TUI banner (`SyncProgressBanner`) with an ASCII progress bar (`[████░░░░] 50% (50/100 tracks)`), current track filename, and monotonic real-time percentage updated file-by-file without block buffering lag.
    - `[4/4] Mirroring Engine Library & DB Rewrite`: Synchronizes `Engine Library` databases, cues, and loops, then automatically rewrites absolute paths in `m.db` and `hm.db` to match the target drive volume prefix.
  - **Smart Track Relocation & Zero Data Loss**: Tracks reorganized on the master SD card are instantly repositioned on the target drive without copying over USB. Truly deleted tracks are safely moved to `Removed from SD/` preserving folder hierarchy. If any previously archived track reappears or is detected on the master SD, it is automatically restored to its active crate.
  - **Automated Database Path Rewrite**: After mirroring `Engine Library`, CrateMind automatically rewrites all absolute file paths in `m.db` and `hm.db` from the master mount point to the target drive prefix, allowing Denon DJ hardware and Engine DJ software to load tracks standalone without missing-file errors.
  - **Configurable Paths**: Source, target, and archive directory paths can be customized via `.env` (`DRIVE_SYNC_SOURCE_PATH`, `DRIVE_SYNC_DEST_PATH`, `DRIVE_SYNC_ARCHIVE_DIR`).
- **LLM-Driven Vibe Categorization**:
  - Automatically classifies tracks into **21 custom atmospheric vibe folders** (e.g., _mountain sunset_, _magic forest_, _desert vibe_, _nargila vibe_, _club party_, _galaxy trip_).
- **Few-Shot RAG Memory**:
  - Crawls the sorted collection on startup to build a semantic few-shot exemplar database in a local SQLite file (`cratemind.db`).
  - Injects relevant sorted examples into the Gemini prompt for highly accurate, library-aligned classifications.
  - **Unlimited Storage**: The memory capacity limits have been removed, allowing CrateMind to retain all historical user classifications and confirmations indefinitely without any automatic eviction or shifting.
  - **Auto-classification tracking**: Every track automatically routed by Gemini (confidence ≥ threshold) is now saved to `rag_examples` with `source: 'auto'`, enabling accurate lifetime AI hit rate tracking.
- **Vibes.app Acoustic & Semantic Intelligence Storage**:
  - Connects strictly read-only to Vibes.app SQLite database (`vibes.sqlite`) to preload 57 curated vibes across 6 categories, spectral acoustics (sub-bass, mid, high, onset density), and 16-bin structural energy curves in 3 batch queries.
  - Stores permanent acoustic and structural profiles in CrateMind's local `track_intelligence` SQLite table, ensuring vibe and sound characteristics persist even if tracks are moved or removed from external apps.
- **2-Tier Local YouTube Network Scout**:
  - Eliminates YouTube Data API quota exhaustion via a local 2-tier lookup before calling external endpoints.
  - **Tier 1 (Exact Match)**: Instant indexed lookup against `yt_playlist_items(artist, title)` in local SQLite `cratemind.db`.
  - **Tier 2 (Token Overlap Fuzzy Match)**: Calculates Jaccard token overlap similarity across candidate mix items (70% title + 30% artist tokens, threshold ≥ 0.85) to catch minor spelling or label differences locally with zero API cost.
- **Self-Reflective RAG (Prompt Adaptation)**:
  - Automatically learns from your manual overrides, generating inline prompt adjustments to align the LLM's classification criteria with your precise taste.
- **Engine DJ Integration (Strictly Read-Only)**:
  - Seamless connection to Denon DJ's SQLite database (`m.db`) to retrieve track playlists, directories, BPM, and keys.
  - **Smart Metadata Fallback**: Automatically parses the artist name and track title from the filename for tracks that have missing metadata tags in the Engine DJ database, preventing them from falling back to "Unknown Artist" and enabling accurate vector matching.
  - Bypasses Gemini API costs for tracks already classified/organized in Engine DJ or matching existing backup rules.
- **Offline Audio Analysis (macOS)**:
  - Automatic BPM estimation and musical key detection (Camelot format) using local CLI tools (`aubio` and `keyfinder-cli`) when metadata tags are missing.
  - Writes calculated BPM/Key back to source tags (ID3v2/Vorbis Comments) using safe FFmpeg stream copying before routing.
- **User-First Manual Override**:
  - If the LLM confidence score falls below `0.99`, or when running in **Force Manual Mode**, CrateMind prompts you with a beautiful multi-select checkbox TUI with pre-selected recommendations.
  - Skipped (unmarked) tracks are safely routed to a dedicated `Sorted/skipped` folder.
- **Live Stats Header**:
  - Real-time `Incoming` counter updated instantly via chokidar `add`/`unlink` events — no polling.
  - Global lifetime stats pulled from `rag_examples`: total sorted, AI hits, manual fixes, and AI accuracy rate (auto ÷ classified).
  - AI accuracy is calculated over tracks actually processed by CrateMind (`auto + manual`) — bootstrap scan entries are excluded from the denominator.
- **Automatic Log Rotation**:
  - Capped local logging size to prevent infinite disk usage. The file `cratemind.log` is automatically rotated and backed up as `cratemind.old.log` when it reaches 5MB.
- **CrateMind Pocket (iOS Offline PWA & Local Mac Bridge)**:
  - Mobile-first offline vibe sorter PWA (`pocket-web/`) paired with a lightweight local macOS `node:https` / `node:http` bridge daemon (`src/services/pocket/`).
  - **Zero External Dependencies & Secure Context (HTTPS)**: Uses native Apple typography stacks (`-apple-system`, `SF Pro`, `SF Mono`) without external Google Fonts blocking offline boots, and serves over local HTTPS via `mkcert` / OpenSSL so iOS WebKit activates `navigator.serviceWorker` and persistent `CacheStorage` on LAN IP addresses.
  - **Instant Boot Splash & Watchdog**: Inline CSS/HTML boot screen inside `<div id="root">` (FCP < 30ms) paired with an emergency 3500ms recovery watchdog timer with one-tap shell reload and Service Worker cache reset.
  - **Local-First Hydration & Offline Outbox**: Instantly hydrates UI from IndexedDB (<50ms) before network queries, performs non-blocking bridge health checks with `AbortSignal.timeout(1500)`, and enqueues offline curation decisions in `pending_mutations` for auto-flushing upon Mac connection.
  - **Single-Bundle Vite & Workbox Range Streaming**: Rollup single-bundle output eliminates offline `ChunkLoadError`, while Workbox precaches all static shell assets with offline navigation fallbacks.
  - **Zero Cloud AI**: Strictly offline local intelligence using SQLite queries across `rag_examples`, 512-dim CLAP embeddings in `track_intelligence`, `yt_playlist_items`, and acoustic proximity (BPM/Camelot) — zero Gemini/LLM API calls.
  - **iOS Audio & Lockscreen Engine**: Reuses a single persistent `HTMLAudioElement` with lazy gesture-driven playback to comply with WebKit autoplay policies, `URL.revokeObjectURL()` cleanup, and `navigator.mediaSession` lockscreen controls (-10s, +30s, play/pause, next/prev).
  - **Offline IndexedDB Store**: Caches tracks, manifests, audio blobs, and sorting decisions via `idb` with `navigator.storage.persist()`, plus autonomous iPhone Files import and JSON export.
  - **Tactile DJ Pad Grid & Gestures**: 3x7 crate matrix fitting 390x844 with zero vertical scroll, multi-select tagging, 450ms long-press 1-tap routing, and swipe-left to skip.
  - **HTTP 206 Preview Streaming & Mutual Exclusion**: Compresses preview audio via FFmpeg (256kbps AAC) with `Accept-Ranges: bytes` partial content support, and enforces HTTP 409 Conflict locks when desktop tasks (Telegram download, Vibes indexing, Drive sync, or LLM analysis) are active.
- **Single Active Process & Universal Hotkey Interlocking**:
  - Guarantees strict mutual exclusion across all 4 major operations: Drive Mirroring / Sync (`SyncService`), Track Analysis / Gemini LLM routing (`TrackWatcher` / `TrackProcessor`), Telegram Bulk Downloader (`TelegramService`), and Vibe DB Indexing (`VibeIndexerService`).
  - When any heavy process is active (Drive Mirror, Vibe Indexing, or Telegram Download), conflicting hotkeys (`[Space]`, `[T]`, `[V]`, `[S]`, `[L]`, `[C]`) are locked, and the `BottomBar` dynamically renders a contextual status banner:
    - `[Drive Mirror in progress...] Hotkeys locked | [Q] Exit Sorter`
    - `[Vibe Indexing in progress...] Hotkeys locked | [Q] Exit Sorter`
    - `[Telegram Download in progress...] Hotkeys locked | [Q] Exit Sorter`
  - Blocks starting a Sync (`[S]`), Vibe Indexing (`[V]`), or Telegram Download (`[T]`) while the track analysis queue is active (`status === 'listening'` or `isLLMAnalyzing`), prompting the user to pause analysis first via `[Space]`.
  - Automatically defers pending watcher batches and resets listener status to `paused` if analysis is toggled during an active mirror, vibe indexing, or telegram download.

---

## 🛠️ Technical Architecture

CrateMind is built on a clean service-oriented modular architecture:

- **TrackWatcher**: Chokidar-based file watcher and queue manager (using `p-queue` for sequential task execution). Handles batch accumulation during Telegram downloads and startup leftover filtering.
- **TelegramService**: Manages connection, message pagination, download progress callbacks (in 25% increments), and duplicate checking.
- **TrackProcessor**: Linear pipeline coordinator handling ID3 extraction, YouTube scouting, RAG checks, LLM queries, and physical file routing.
- **NetworkScoutService**: Gathers playlist context from YouTube to discover neighboring tracks in live mixes to warm the cache.
- **RAGService**: Memory layer persisting classification history to local SQLite and building prompt contexts.
- **EngineDBService**: Strictly read-only connection to Engine DJ SQLite database (`m.db`) using process-lifetime caching.
- **VibesDBService**: Strictly read-only connection to Vibes.app SQLite database (`vibes.sqlite`). Preloads 57 curated vibes across 6 categories, measured acoustic band levels (sub-bass, mid, high, onset density), 16-bin structural energy shapes, and phase cues in zero-latency batch queries.
- **SpotifyService (Hard-Disabled)**: Spotify Web API integration is permanently hard-disabled due to closed Web API developer quotas and 403 restrictions. Superseded by Vibes.app acoustic physics and YouTube Network Scout.
- **AubioService**: Establishes tempo and key estimates on macOS.
- **ID3Service**: Fast metadata reader (via `music-metadata`) and safe tag writer. Uses a local database metadata cache to speed up bootstrap scans.
- **EmbeddingService**: Generates vector embeddings (`gemini-embedding-2`) and runs cosine similarity searches to match tracks.
- **LLMService**: Interfaces with the Gemini API (`gemini-3.5-flash-lite`) with native `responseSchema` structured output validation, RAG few-shot contextual injection, deterministic vibe-to-crate rules, and offline cache fallbacks.
- **SyncService & Modular Sync Subsystem**: Coordinates collection syncing (`Sorted/ -> SD`) and full Drive-to-Drive Mirroring (`EngineDJ SD -> EngineDJ`) through dedicated submodules in `src/services/sync/`:
  - `rsyncRunner`: Line-buffered stdout stream parsing, dry-run change detection, and audio file counting.
  - `archiveManager`: In-memory audio file indexing, smart zero-transfer crate relocation, and automatic recovery of active tracks from `Removed from SD/`.
  - `dbRewriter`: Fast Engine DJ SQLite database path rewriting (`m.db`, `hm.db`) via `better-sqlite3`.
- **UIService**: Manages TUI states via a Zustand state store and mounts the Ink rendering loop.
- **Pocket Bridge Subsystem (`src/services/pocket/` & `pocket-web/`)**:
  - `PocketBridgeService`: Lightweight `node:http` server (default port `8080` / `POCKET_PORT`) serving compiled PWA assets from `dist/pocket-web/` and REST endpoints.
  - `pocketDbQueries` & `pocketDbUtils`: Pure SQLite + in-memory cosine similarity & Camelot harmonic matching (zero external AI).
  - `pocketAudioPreview`: FFmpeg AAC preview cache and RFC 7233 `HTTP 206 Partial Content` byte-range streamer for iOS Safari.
  - `pocketManifestBuilder` & `pocketCommitProcessor`: Scans up to 30 incoming tracks, validates paths/crates, enforces `useStore` mutual exclusion (409 Conflict), leaves pending/unselected tracks untouched in `Incoming/`, routes decisions via `RoutingService`, and updates `RAGService`.
- **Process Mutual Exclusion & Concurrency Lock**: Enforces a strict single-active-process policy. Prevents resource conflicts between Drive Mirroring / Sync (`SyncService`), Track Analysis / Gemini LLM routing (`TrackWatcher` / `TrackProcessor`), Telegram downloads (`TelegramService`), and Vibe DB indexing. Dynamic hotkey interlocking (`useGlobalHotkeys`) and watcher-level concurrency locks guarantee safe single-task execution.

---

## 📱 CrateMind Pocket (iOS PWA & Wi-Fi Bridge)

CrateMind Pocket lets you curate tracks offline on your iPhone (e.g., on a flight or commute) and sync routing decisions back to your Mac over local Wi-Fi.

### Bridge REST API Endpoints

| Method | Endpoint         | Query / Headers                                                                                                                  | Status Codes & Behavior                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/health`    | —                                                                                                                                | `200 OK`: Returns `{ status: 'ok', uptime, incomingCount, ragCount, isBusy, activeTask }`.                                                                                                                                                                                                                                                                                                             |
| `GET`  | `/api/cert-ca`   | —                                                                                                                                | `200 OK`: Serves `cratemind-rootCA.pem` (`application/x-x509-ca-cert`) generated by `mkcert` for 1-tap installation on iPhone; `404` if not found.                                                                                                                                                                                                                                                     |
| `GET`  | `/api/batch`     | `?limit=30` (`1–30`, default `30`)<br>`&exclude=file1.mp3,file2.flac`                                                            | `200 OK`: Scans up to `limit` incoming tracks excluding any already loaded in client queue, enriched with ID3, Vibes.app 4-band/energy profiles, local SQLite RAG hints, and YT Scout neighbors (`PocketBatchManifest`). Supports cumulative batches (+30).                                                                                                                                            |
| `GET`  | `/api/audio/:id` | `:id` = `base64url(filename)`<br>Req: `Range: bytes=start-end`<br>Res: `Accept-Ranges: bytes`, `Content-Range`, `Content-Length` | `206 Partial Content` (with `Range`) or `200 OK` (full stream) serving FFmpeg 256kbps AAC `.m4a` (`audio/mp4`) previews with original-format fallback; `400` invalid filename/traversal, `404` missing file, `416` invalid range.                                                                                                                                                                      |
| `POST` | `/api/commit`    | Body: `{ batchId, decisions[] }` (`tagged` \| `skipped` \| `pending`)                                                            | `200 OK`: Validates tracks & crates (`21 FOLDERS` + `skipped`), routes tagged tracks, moves explicit skips to `Sorted/skipped/`, leaves `pending`/empty selections untouched in `Incoming/`, invalidates RAG cache, and adds `manual` examples. Returns `400` invalid crate/traversal/JSON, `409 Conflict` if desktop tasks (`Telegram`, `Vibes`, `Drive Sync`, `LLM`) are busy, `413` if body > 2 MB. |

### PWA Views & Touch Gestures (`pocket-web/`)

- **Sorter (`VibeSorterView`)**: 3x7 OLED dark DJ pad grid (54pt touch targets, 13px font labels, categorized by vibe color palette with alphabetical sorting inside each category, iOS safe-area insets padding, natural vertical scroll). Features:
  - **Auto-Play On Advance**: Routing (`Route & Next` or `450ms` 1-tap hold) or skipping automatically advances and begins playing the next preview track seamlessly.
  - **Category-Colored Active Glow**: Selected pads light up with their distinct neon category color (`Nature #00FFFF`, `Party/Groove #FFFF00`, `Cosmic/Deep #FF00FF`, `Genres/Utility #D4D4D4`) instead of a single uniform color.
  - **Smart 1× Auto-Replay**: If 1 or more crates are selected when a track finishes playing, the track restarts from `00:00` once to let you finalize your selection, then stops completely.
  - **DJ Transport Controls**: Square DJ-controller Play/Pause button (single tap to toggle playback, double tap to seek `-30s`, hold to seek `+10s` continuously).
  - **Waveform & Telemetry**: 16-segment `INTR/DRP/BRK/OUT` energy LED bar, duration/BPM/key badges, and `RAG XX%` and `YT MATCH` discovery badges.
  - **Tactile Gestures**: Tap for multi-select, **450ms long-press** for 1-tap instant route, and **swipe left** to skip.
- **Queue (`BatchQueueView`)**: Instant filterable queue (`All`, `Pending`, `Tagged`, `Skipped`) and batch commit trigger with zero UI clutter.
- **Sync (`SyncBridgeView`)**: Local Wi-Fi pull/commit controls with cumulative **"Add +30 More Tracks"** batch loading, IndexedDB storage meter, JSON decision export, dedicated **"Clear Cache & Queue"** action, and an embedded collapsible **"Quick Controls & Gestures"** accordion manual card (default collapsed, accessible `>= 44px` toggle) detailing all playback workflows, gestures, badge meanings, Queue re-tagging, and the 4-stage preview pipeline.

### End-to-End Audio Preview & Sync Pipeline

CrateMind Pocket uses a 4-stage architecture that keeps heavy master audio safe on your Mac while allowing lightweight, zero-latency curation on iPhone:

1. **Mac Scan & Enrichment (`Incoming/` → Manifest)**: Scans incoming audio (`WAV`, `FLAC`, `AIFF`, `MP3`), extracting ID3 tags, Camelot key, BPM, 16-bar energy profiles, and local RAG/YouTube scout similarity matches.
2. **FFmpeg Preview Transcoding (`.pocket-cache/previews/`)**: Converts master files into optimized 256kbps AAC (`.m4a`, 44.1kHz) previews cached by content hash at `.pocket-cache/previews/<sha256>.m4a` and streamed over LAN via RFC 7233 HTTP 206 byte ranges (4x parallel prefetch workers).
3. **iPhone Offline IndexedDB (`cratemind_pocket_db`)**: Persists metadata, waveforms, and compressed `.m4a` audio blobs in local IndexedDB. Works 100% offline (flights, commutes) with decisions queued in `pending_mutations`. Original master files on Mac remain untouched.
4. **Lossless Master Routing & Cleanup (`Incoming/` → `Sorted/`)**: On commit, only lightweight JSON decision payloads are transmitted. The Mac routes original lossless/master files into `Sorted/<crate>/` (or `Sorted/skipped/`), keeps pending files untouched in `Incoming/`, and the iPhone purges committed audio blobs to free device storage.

### iPhone PWA Setup & Usage

1. Build the Node backend (`dist/`) and the Vite PWA bundle (`dist/pocket-web/`):
   ```bash
   npm run build
   ```
2. (Optional, recommended for iOS) Generate local HTTPS certificates for your LAN IP:
   ```bash
   npm run pocket:certs
   ```
   _Tip for mkcert_: To install the root certificate on your iPhone, open `https://<MAC_LAN_IP>:8080/api/cert-ca` in Safari, install the profile in iOS Settings, and enable full trust in **Settings → General → About → Certificate Trust Settings**.
3. Start the local Wi-Fi bridge on your Mac:
   ```bash
   npm run pocket
   # or for isolated sandbox testing without touching ./Incoming, ./Sorted, or ./cratemind.db:
   npm run pocket:sandbox
   ```
4. Connect your iPhone to the same Wi-Fi network, open the printed **Network URL** (`https://<MAC_LAN_IP>:8080`) in Safari, and tap **Share → Add to Home Screen** to install CrateMind Pocket as a full-screen standalone PWA.
5. In the **Sync** tab, tap **Pull 30 Tracks from Mac (Wi-Fi)** to cache audio previews and metadata in IndexedDB. Once cached, the app works 100% offline anywhere without the Mac. When you sort tracks offline, decisions are queued in `pending_mutations` and automatically committed to your Mac when you reconnect to Wi-Fi.

### Pocket CLI & Test Commands

```bash
# Build both backend TypeScript (dist/) and Vite PWA bundle (dist/pocket-web/)
npm run build

# Generate local SSL/TLS certificates for local HTTPS
npm run pocket:certs

# Start the Mac Wi-Fi bridge daemon (HTTPS/HTTP on port 8080 or POCKET_PORT)
npm run pocket

# Boot an isolated interactive sandbox with tagged mock WAV tracks, 21 crates, temp DB, and LAN IP banner
npm run pocket:sandbox

# Run PWA development server with /api proxy to localhost:8080
npm run dev:pocket

# Type-check the PWA client
npm run check:pocket

# Run the full 4-tier Vitest suite (backend, client, and 390x844 mobile E2E)
npm test

# Run Pocket backend unit & HTTP 206/409 integration tests
npm run test:pocket

# Run Pocket PWA client store, audio engine, and UI gesture tests
npm run test:client

# Run headless Chrome 390x844 mobile layout E2E tests
npm run test:e2e
```

---

## 🚀 Getting Started

### Prerequisites

1. **Node.js** (v18 or higher)
2. **FFmpeg** (installed on your system PATH, required for tag editing and audio previews)
3. **Aubio & KeyFinder-CLI** (optional, for macOS offline BPM/Key analysis):
   ```bash
   brew install aubio keyfinder-cli
   ```

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/DimaMinka/cratemind.git
   cd cratemind
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Configuration

Create a `.env` file in the root directory (see `.env.example` as a template):

```env
# Gemini API Configuration
GEMINI_API_KEY=your_gemini_api_key

# Engine DJ SQLite Database Path (Optional)
ENGINE_DB_PATH=/path/to/Engine Library/Database2/m.db

# Vibes.app SQLite Database Path (Optional, defaults to ~/Library/Application Support/com.benmdg.vibes/vibes.sqlite)
VIBES_DB_PATH=/path/to/Library/Application Support/com.benmdg.vibes/vibes.sqlite


# YouTube Context Scout (Optional)
YOUTUBE_API_KEY=your_youtube_api_key

# Telegram Sync Userbot Configuration (Optional)
TELEGRAM_API_ID=your_telegram_api_id
TELEGRAM_API_HASH=your_telegram_api_hash
TELEGRAM_CHATS=-1001485372957,other_channel_id
# TELEGRAM_SESSION_STRING will be written automatically after running the login script

# Modes
MOCK_MODE=false
FORCE_MANUAL_MODE=true

# Mix Protection
MAX_TRACK_DURATION_MINUTES=20

# Sync Destination
SD_CARD_SYNC_PATH=/Volumes/EngineDJ SD/Music Collection/Atmosphere

# CrateMind Pocket HTTP Bridge & Test Isolation (Optional)
POCKET_PORT=8080
# CRATEMIND_DB_PATH=/path/to/isolated-cratemind.db
```

### Telegram Userbot Authentication

Before starting the main app for Telegram synchronization, authenticate your userbot to generate a persistent session key:

```bash
npm run telegram-login
```

Follow the prompts in your terminal (enter your phone number starting with `+`, followed by the code Telegram sends to your active apps, and your 2FA password if enabled). The script will automatically generate your session key and write it to your `.env` as `TELEGRAM_SESSION_STRING`.

---

## 💻 Running the Application

### Development Mode

Run the app in live development mode with hot-reloading support:

```bash
npm run dev
```

### Production Build

Build and run the compiled TypeScript files:

```bash
npm run build
npm start
```

---

## ⌨️ TUI Keyboard Controls

- `[Space]` — Pause/Resume active processing listener (starts/pauses folder analysis)
- `[P]` — Pause/Resume audio preview (during manual override)
- `[←] / [→]` — Seek 10s backward/forward (Hold `Shift` to seek 30s)
- `[L]` — Reset daily API limits
- `[V]` — Run manual index DB vibe sync
- `[C]` — Simulate network/chaos mode (in Mock Mode)
- `[T]` — Start Telegram channel downloader sync
- `[S]` — Sync to Collection via rsync (Syncs local `Sorted/` to SD, or runs full Drive-to-Drive mirror `[D]` if target drive is connected)
- `[Q]` — Quit CrateMind safely

> **Note on Universal Process Interlocking**: To protect disk I/O, network bandwidth, and Gemini API rate limits, only one major process can run at a time. While Drive Mirroring, Vibe Indexing, or Telegram Downloading is in progress, conflicting hotkeys are locked out and the bottom bar displays an alert banner. Starting any background task is likewise blocked if track analysis is actively listening or querying LLM.

---

## 🔮 Future Integration Plans

- **Model Context Protocol (MCP) Server**: Expose CrateMind's RAG memory and vibe-routing logic as an MCP server. This allows IDE agents to query library rules, inspect track metadata, and suggest playlist changes.
- **Antigravity SDK (AGY CLI) Integration**: Orchestrate autonomous multi-agent music curations. For example, let one subagent scour charts and new releases, while CrateMind acts as the local routing agent.
- **Streaming Playlists Import (Apple Music / Spotify)**: Automatically monitor or import tracklists from Apple Music and Spotify playlist URLs. The system can scrape track names and artists from the web pages, search and download high-quality audio files using `yt-dlp` directly into the `Incoming` folder, and run the RAG-vibe classification pipeline.
- **Local Audio ML & Vibes.app Engine Integration (Hybrid Local-First RAG)**:
  - **Inspiration & Ecosystem Partner**: Inspired by **[Vibes](https://vibesdj.io)** (developed by DJ/producer **Ben Modigell**, aka _"so I so"_), an offline-first DJ library management suite that champions Energy-Based Mixing and local audio intelligence.
  - **Zero-Shot Audio Embeddings (LAION-CLAP)**: Extract 512-dimensional audio embeddings directly on macOS to compare raw sound signatures against existing crate folders via cosine similarity, resolving "Unknown Artist / Track 01" files without text metadata.
  - **Structural Track Segmentation & Hot Cues**: Detect song phases (`intro`, `drop`, `verse`, `breakdown`, `outro`) using phrase boundaries (8/16 bars) and energy shifts, automatically tagging cues into Engine DJ (`PerformanceData.quickCues`).
  - **Apple Neural Engine Key & BPM**: Run hardware-accelerated musical key analysis (SKey via Apple CoreML) and downbeat tracking (Beat This!) completely offline.
  - **Two-Way Ecosystem Bridge with Vibes.app**: Ingest analyzed features (`energy`, `kick_strength`, `spectral_centroid`) from `vibes.sqlite` and synchronize Gemini-curated vibe sets back into the Vibes desktop UI.
- **Beatport Purchase Integration**: Automatically search Beatport for identified tracks to retrieve purchase links. The system can append these store links directly to the ID3 tags (e.g., inside the Comments or a custom URL frame) to streamline buying tracks for live DJ sets.

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.
