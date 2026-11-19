import React, { useState } from 'react';

export const PocketHelpCard: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <section className="bg-neutral-900/80 border border-neutral-800 rounded-lg p-3 space-y-2 font-sans text-xs">
      {/* Accessible Collapsible Header Toggle */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        aria-controls="pocket-help-content"
        className="w-full flex items-center justify-between min-h-[44px] text-left cursor-pointer select-none transition-colors group"
      >
        <div className="flex items-center gap-2">
          <span className="text-[#00FFFF] font-mono font-bold text-xs">
            {isExpanded ? '▼' : '▶'}
          </span>
          <span className="font-bold tracking-wider text-white text-xs group-hover:text-neutral-200">
            QUICK CONTROLS &amp; GESTURES
          </span>
        </div>
        <span className="text-[10px] font-mono px-2 py-1 rounded bg-neutral-800 text-neutral-300 font-bold border border-neutral-700">
          {isExpanded ? '[−] HIDE' : '[+] HELP'}
        </span>
      </button>

      {/* Collapsible Content */}
      {isExpanded && (
        <div id="pocket-help-content" className="space-y-3 pt-2 border-t border-neutral-800">
          {/* DJ Transport Button */}
          <div className="space-y-1">
            <span className="font-bold text-[#00FF00] font-mono text-[11px] block">
              ▶ DJ TRANSPORT BUTTON (64×64)
            </span>
            <ul className="text-neutral-300 space-y-1 pl-2 text-[11px] leading-relaxed">
              <li>
                <strong className="text-white">1 Tap:</strong> Play / Pause audio preview.
              </li>
              <li>
                <strong className="text-white">Double-Tap:</strong> Quick rewind{' '}
                <code className="text-[#00FFFF] font-mono">-30s</code>.
              </li>
              <li>
                <strong className="text-white">Hold (350ms+):</strong> Fast-forward{' '}
                <code className="text-[#00FFFF] font-mono">+10s</code> (repeats while held).
              </li>
            </ul>
          </div>

          {/* Vibe Pads */}
          <div className="space-y-1">
            <span className="font-bold text-[#FFFF00] font-mono text-[11px] block">
              ▦ VIBE PADS (3×7 MATRIX)
            </span>
            <ul className="text-neutral-300 space-y-1 pl-2 text-[11px] leading-relaxed">
              <li>
                <strong className="text-white">1 Tap:</strong> Multi-select crates with category
                neon glow (<span className="text-[#00FFFF]">Nature</span>,{' '}
                <span className="text-[#FFFF00]">Party</span>,{' '}
                <span className="text-[#FF00FF]">Cosmic</span>,{' '}
                <span className="text-[#D4D4D4]">Genres</span>).
              </li>
              <li>
                <strong className="text-white">Hold (450ms):</strong> Instant 1-tap route to crate
                &amp; auto-play next track.
              </li>
            </ul>
          </div>

          {/* Playback & Decision Logic */}
          <div className="space-y-1">
            <span className="font-bold text-[#00FFFF] font-mono text-[11px] block">
              ⚡ PLAYBACK &amp; ROUTING FLOW
            </span>
            <ul className="text-neutral-300 space-y-1 pl-2 text-[11px] leading-relaxed">
              <li>
                <strong className="text-white">Auto-Play:</strong> Next track starts playing
                immediately after Route &amp; Next, 450ms Hold, or SKIP.
              </li>
              <li>
                <strong className="text-white">1× Smart Replay:</strong> If 1+ crates are selected
                when a track finishes, it replays once from 00:00 to let you confirm, then stops.
              </li>
              <li>
                <strong className="text-white">Swipe Left / SKIP:</strong> Marks track as{' '}
                <span className="text-[#FF4444] font-mono">SKIPPED</span> (moved to{' '}
                <code>Sorted/skipped/</code> upon commit). Unmarked (<code>Pending</code>) tracks
                stay untouched in <code>Incoming/</code>.
              </li>
            </ul>
          </div>

          {/* Telemetry, Badges & Lock Screen */}
          <div className="space-y-1">
            <span className="font-bold text-[#FF00FF] font-mono text-[11px] block">
              ◎ BADGES, WAVEFORM &amp; HARDWARE CONTROLS
            </span>
            <ul className="text-neutral-300 space-y-1.5 pl-2 text-[11px] leading-relaxed">
              <li>
                <span className="text-[9px] font-mono px-1 py-0.5 bg-[#00FFFF] text-black font-bold rounded mr-1.5">
                  RAG XX%
                </span>
                <strong className="text-white">Library Acoustic Match:</strong> Similarity score
                computed against your indexed crates.
              </li>
              <li>
                <span className="text-[9px] font-mono px-1 py-0.5 bg-[#FF00FF] text-white font-bold rounded mr-1.5">
                  YT MATCH
                </span>
                <strong className="text-white">YouTube Playlist Scout:</strong> Discovered inside
                your scouted YouTube playlists.
              </li>
              <li>
                <strong className="text-white">16-Bar Waveform:</strong> Structural energy phases (
                <span className="text-[#00FF00]">INTR</span> →{' '}
                <span className="text-[#00FFFF]">DRP</span> →{' '}
                <span className="text-[#FFFF00]">BRK</span> →{' '}
                <span className="text-[#00FF99]">OUT</span>).
              </li>
              <li>
                <strong className="text-white">iOS Lock Screen &amp; Headset:</strong> System
                MediaSession controls support hardware play/pause, seek, and track skip.
              </li>
            </ul>
          </div>

          {/* Queue & Re-Tagging */}
          <div className="space-y-1">
            <span className="font-bold text-[#00FF99] font-mono text-[11px] block">
              ☰ QUEUE &amp; RE-TAGGING
            </span>
            <ul className="text-neutral-300 space-y-1 pl-2 text-[11px] leading-relaxed">
              <li>
                <strong className="text-white">Tap Any Track:</strong> Jumps back to Sorter on that
                track and restores its selected crates to review or re-tag before commit.
              </li>
              <li>
                <strong className="text-white">Filter Pills:</strong> Filter by <code>All</code>,{' '}
                <code>Pending</code>, <code>Tagged</code>, or <code>Skipped</code> to audit your
                batch before syncing.
              </li>
              <li>
                <strong className="text-white">Batch Commit:</strong> Tap the footer commit button
                directly inside Queue or Sync once decisions are ready.
              </li>
            </ul>
          </div>

          {/* Sync & Offline Persistence */}
          <div className="space-y-1">
            <span className="font-bold text-[#FFFF00] font-mono text-[11px] block">
              ⇄ SYNC &amp; OFFLINE STORAGE
            </span>
            <ul className="text-neutral-300 space-y-1 pl-2 text-[11px] leading-relaxed">
              <li>
                <strong className="text-white">Pull 30 Tracks (Wi-Fi):</strong> Fetches incoming
                previews and metadata over local Wi-Fi. Tapping again appends +30 tracks
                cumulatively without resetting existing queue progress.
              </li>
              <li>
                <strong className="text-white">100% Offline Persistence:</strong> Cached audio and
                metadata live in IndexedDB. Works on flights and commutes without Mac connection.
              </li>
              <li>
                <strong className="text-white">Commit to Mac:</strong> Moves tagged files to crate
                folders, skipped files to <code>/skipped/</code>, updates local library memory, and
                deletes committed audio cache from iPhone. If Mac is busy (<code>409</code>),
                decisions remain safe on iPhone to retry.
              </li>
              <li>
                <strong className="text-white">Offline Outbox:</strong> Offline decisions enqueue in{' '}
                <code>pending_mutations</code> and auto-commit once local Wi-Fi reconnects.
              </li>
              <li>
                <strong className="text-white">Export &amp; Reset:</strong> Export decisions as JSON
                for backup, or use <code>Clear Cache &amp; Queue</code> to wipe local device storage
                (never deletes files on Mac).
              </li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
};
