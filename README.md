# CrateMind 🧠🎶

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D%2018.0.0-blue.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Gemini API](https://img.shields.io/badge/Gemini%20API-PRO-orange.svg)](https://ai.google.dev/)
[![Ink TUI](https://img.shields.io/badge/Ink-React--TUI-green.svg)](https://github.com/vadimdemedes/ink)

**CrateMind** is a semi-automatic audio classifier and intelligent library organizer designed to categorize your music library into atmosphere-based folders ("crates") using the Gemini API, a Retrieval-Augmented Generation (RAG) memory layer, and an interactive, premium terminal user interface (TUI) built with React and Ink.

---

## 🌟 Key Features

* **Telegram Bulk Downloader (GramJS Userbot)**:
  * Sync and download tracks from defined Telegram channels/chats.
  * **Smart Batching**: Integrates with the file watcher to queue downloads and wait for a full `BATCH_SIZE` (default: 5) chunk of tracks before starting analysis, optimizing Gemini API daily limits and preventing rate exhaustion.
  * **Strict Deduplication**: Automatically checks the `./Incoming` folder, the recursive `./Sorted` folder (including skipped files), and the **Engine DJ SQLite Database** before downloading to avoid duplicate tracks.
  * **Download-Only Mode**: Press `[D]` in the interactive prompt when starting sync to download files from Telegram to `Incoming` without spawning any LLM or classification tasks (useful for bulk loading tracks to process later).
  * **Automatic Mix Protection**: Automatically checks audio duration and skips tracks exceeding a configurable limit (default: 20 minutes) to avoid downloading long DJ mixes or podcasts.
* **LLM-Driven Vibe Categorization**:
  * Automatically classifies tracks into **21 custom atmospheric vibe folders** (e.g., *mountain sunset*, *magic forest*, *desert vibe*, *nargila vibe*, *club party*, *galaxy trip*).
* **Few-Shot RAG Memory**:
  * Crawls the sorted collection on startup to build a semantic few-shot exemplar database in a local SQLite file (`cratemind.db`).
  * Injects relevant sorted examples into the Gemini prompt for highly accurate, library-aligned classifications.
  * **Unlimited Storage**: The memory capacity limits have been removed, allowing CrateMind to retain all historical user classifications and confirmations indefinitely without any automatic eviction or shifting.
* **Self-Reflective RAG (Prompt Adaptation)**:
  * Automatically learns from your manual overrides, generating inline prompt adjustments to align the LLM's classification criteria with your precise taste.
* **Engine DJ Integration (Strictly Read-Only)**:
  * Seamless connection to Denon DJ's SQLite database (`m.db`) to retrieve track playlists, directories, BPM, and keys.
  * **Smart Metadata Fallback**: Automatically parses the artist name and track title from the filename for tracks that have missing metadata tags in the Engine DJ database, preventing them from falling back to "Unknown Artist" and enabling accurate vector matching.
  * Bypasses Gemini API costs for tracks already classified/organized in Engine DJ or matching existing backup rules.
* **Offline Audio Analysis (macOS)**:
  * Automatic BPM estimation and musical key detection (Camelot format) using local CLI tools (`aubio` and `keyfinder-cli`) when metadata tags are missing.
  * Writes calculated BPM/Key back to source tags (ID3v2/Vorbis Comments) using safe FFmpeg stream copying before routing.
* **User-First Manual Override**:
  * If the LLM confidence score falls below `0.99`, or when running in **Force Manual Mode**, CrateMind prompts you with a beautiful multi-select checkbox TUI with pre-selected recommendations.
  * Skipped (unmarked) tracks are safely routed to a dedicated `Sorted/skipped` folder.
* **Automatic Log Rotation**:
  * Capped local logging size to prevent infinite disk usage. The file `cratemind.log` is automatically rotated and backed up as `cratemind.old.log` when it reaches 5MB.
* **Native Audio Preview**:
  * Native background previews via `ffplay` with pause/resume and precise seeking hotkeys.

---

## 🛠️ Technical Architecture

CrateMind is built on a clean service-oriented modular architecture:

* **TrackWatcher**: Chokidar-based file watcher and queue manager (using `p-queue` for sequential task execution). Handles batch accumulation during Telegram downloads and startup leftover filtering.
* **TelegramService**: Manages connection, message pagination, download progress callbacks (in 25% increments), and duplicate checking.
* **TrackProcessor**: Linear pipeline coordinator handling ID3 extraction, YouTube scouting, RAG checks, LLM queries, and physical file routing.
* **NetworkScoutService**: Gathers playlist context from YouTube to discover neighboring tracks in live mixes to warm the cache.
* **RAGService**: Memory layer persisting classification history to local SQLite and building prompt contexts.
* **EngineDBService**: Strictly read-only connection to Engine DJ SQLite database (`m.db`) using process-lifetime caching.
* **AubioService**: Establishes tempo and key estimates on macOS.
* **ID3Service**: Fast metadata reader (via `music-metadata`) and safe tag writer. Uses a local database metadata cache to speed up bootstrap scans.
* **EmbeddingService**: Generates vector embeddings (`gemini-embedding-2`) and runs cosine similarity searches to match tracks.
* **LLMService**: Interfaces with the Gemini API with structured Zod schema output validation, daily request limit checks, and offline cache fallbacks.
* **UIService**: Manages TUI states via a Zustand state store and mounts the Ink rendering loop.

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

* `[Space]` — Pause/Resume audio preview
* `[←] / [→]` — Seek 10s backward/forward (Hold `Shift` to seek 30s)
* `[L]` — Reset daily API limits
* `[V]` — Run manual index DB vibe sync
* `[C]` — Simulate network/chaos mode (in Mock Mode)
* `[T]` — Start Telegram channel downloader sync
* `[Q]` — Quit CrateMind safely

---

## 🔮 Future Integration Plans

* **Model Context Protocol (MCP) Server**: Expose CrateMind's RAG memory and vibe-routing logic as an MCP server. This allows IDE agents to query library rules, inspect track metadata, and suggest playlist changes.
* **Antigravity SDK (AGY CLI) Integration**: Orchestrate autonomous multi-agent music curations. For example, let one subagent scour charts and new releases, while CrateMind acts as the local routing agent.
* **Streaming Playlists Import (Apple Music / Spotify)**: Automatically monitor or import tracklists from Apple Music and Spotify playlist URLs. The system can scrape track names and artists from the web pages, search and download high-quality audio files using `yt-dlp` directly into the `Incoming` folder, and run the RAG-vibe classification pipeline.

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.
