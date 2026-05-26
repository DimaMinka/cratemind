---
trigger: always_on
---

# CrateMind Agent Instructions: Engine DJ Database & Architecture Specification

This document contains key technical decisions, architectural constraints, and a detailed specification of the Engine DJ database integration. Any agent working on this repository must strictly adhere to these rules.

---

## 1. Architectural Context

CrateMind is a semi-automatic audio classifier designed to organize a music library into vibe-based folders ("crates") using the Gemini API, a Retrieval-Augmented Generation (RAG) memory layer, and an interactive TUI (built with React/Ink).

### Core Principles:
* **User-First (Semi-Automatic)**: The user retains ultimate control. All critical bootstrap/scanning actions require explicit user confirmation (`[Y/n]`). If the LLM confidence score falls below `CONFIDENCE_THRESHOLD`, the process blocks and spins up a `ManualOverride` UI (multi-select folder checklist).
* **Safe Manual Override (Empty Routing)**: When resolving a manual override with no folders selected, the original track must not be deleted or routed. It must remain untouched in the incoming directory (`Incoming`), and the system should log the skip action and proceed to the next item.
* **Few-Shot RAG Memory**: Before classifying a new track, the system retrieves up to `RAG_EXAMPLES_PER_FOLDER` (default: 2) sorted examples for each vibe folder. These are injected into the Gemini prompt as highly relevant few-shot exemplars to align classification with the user's library style.
* **Bootstrap Scanning**: On startup, the system scans the active `SORTED_DIR` to construct the RAG memory dynamically. This makes the memory collection-agnostic (switching between temporary and main folders seamlessly) and prevents stale index states.

---

## 2. Engine DJ Database Specification

> [!IMPORTANT]  
> **Engine DJ uses the SQLite database engine**, NOT NoSQL!

### Engine DJ File Structures:
* **Main Metadata DB**: `~/Music/Engine Library/Database2/m.db` (macOS default location). Contains tracks, playlists, histories, and primary metadata.
* **Performance DB**: `~/Music/Engine Library/Database2/p.db`. Contains beatgrids, hot cues, loops, and waveforms.

### Critical Database Access Rules:
1. **STRICTLY READ-ONLY ACCESS**: 
   CrateMind must NEVER perform write operations, modify the schema, or insert/update records in the Engine DJ database files (`m.db` or `p.db`). Doing so may corrupt the database, making it unreadable by Denon DJ hardware or Engine DJ software.
   * *Implementation*: SQLite connections must be opened using `better-sqlite3` with the `{ readonly: true }` flag.
2. **Attaching Databases**:
   If performance cues or waveform metrics are required in the future, developers should use the standard SQLite `ATTACH DATABASE` statement to attach `p.db` to the `m.db` connection.
3. **Database Paths & Configuration**:
   The default database path is defined via the `ENGINE_DB_PATH` constant in `src/config.ts` and can be overridden via `.env` (crucial for external USB drives where the library sits at `/Volumes/DRIVENAME/Engine Library/Database2/m.db`).

---

## 3. Key Schema: `Track` Table in `m.db`

The `Track` table is utilized for rapid RAG bootstrap scanning, bypassing the need for slow file-system ID3 tag extractions.

### Essential Columns in `Track`:
* `id` (`INTEGER PRIMARY KEY`) — Unique track identifier inside Engine DJ.
* `path` (`TEXT`) — Absolute file path on disk. Used to match files against `SORTED_DIR`.
* `filename` (`TEXT`) — Plain filename of the track (e.g., `song.wav`).
* `title` (`TEXT`) — Track title (if empty, falls back to the filename).
* `artist` (`TEXT`) — Artist name.
* `album` (`TEXT`) — Album title (optional).
* `comment` (`TEXT`) — User-defined tags, comments, or genre remarks.

---

## 4. Engine DJ Bootstrap Integration Workflow

Upon initialization, CrateMind executes the following detection and import pipeline:

1. **Database Detection**: 
   Verifies if the database exists at `ENGINE_DB_PATH`.
2. **Querying Tracks**:
   * If available, invoke `EngineDBService.getTracksInPath(SORTED_DIR)`.
   * SQL Query to fetch sorted examples inside a specific directory:
     ```sql
     SELECT id, path, filename, title, artist 
     FROM Track 
     WHERE path LIKE ? || '%'
     ```
     (where the parameter corresponds to the absolute path of `SORTED_DIR`).
3. **Performance Optimization**:
   Querying the SQLite database takes milliseconds, avoiding the need to recursively crawl the file system and parse ID3 tags from hundreds of audio files.
4. **Graceful Fallback**:
   If the Engine DJ database is missing or inaccessible (e.g., when run on a machine without Engine DJ or when an external drive is not plugged in), CrateMind gracefully falls back to a recursive folder crawl using direct file-system reads and ID3 tag parsers.

---

## 5. Development Guidelines for Agents

* **Dependency Management**: Ensure `better-sqlite3` and `@types/better-sqlite3` are correctly configured.
* **Avoid Circular Imports**: Do not import `UIService` or `useStore` directly inside `EngineDBService` or `RAGService` to prevent circular dependency breaks in ESM. Use parameters, events, or state updates downstream.
* **TUI Transparency**: Clearly differentiate between tracks already indexed in the Engine DJ database and raw untracked audio files detected on the disk.
* **Collaborative Testing & Interactive Verification**: 
  Once development phases are completed, the agent MUST establish a collaborative verification process before final completion.
  * Provide interactive verification scripts or sandbox CLI testing steps (e.g., temporary/mock database and directories) that the developer can easily execute themselves.
  * Print clear, formatted diagnostic logs or summaries during tests so the developer can visually confirm that SQLite, RAG, and UI state layers function perfectly.
  * Walk through the verification results step-by-step with the developer, explaining exactly how to run, observe, and validate the correct behavior.

---

## 6. GitHub MCP Integration & Token Conservation

* **Tool Usage Optimization**: CrateMind utilizes the `github-mcp-server` plugin tools where applicable for repository operations, issue tracking, and metadata queries. This helps optimize token consumption inside Gemini by delegating specialized workflows to efficient MCP tools rather than executing general, expensive LLM semantic parsing/generation cycles.
