import React from 'react';

export const PocketHelpCard: React.FC = () => {
  return (
    <section className="bg-neutral-900/80 border border-neutral-800 rounded-lg p-3 space-y-3 font-sans text-xs">
      <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
        <span className="font-bold tracking-wider text-white">QUICK CONTROLS &amp; GESTURES</span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
          MANUAL
        </span>
      </div>

      {/* DJ Play Button */}
      <div className="space-y-1">
        <span className="font-bold text-[#00FF00] font-mono text-[11px] block">
          ▶ DJ TRANSPORT BUTTON (64×64)
        </span>
        <ul className="text-neutral-300 space-y-0.5 pl-2 text-[11px] leading-relaxed">
          <li>
            <strong className="text-white">1 Tap:</strong> Play / Pause audio preview.
          </li>
          <li>
            <strong className="text-white">Double-Tap:</strong> Quick rewind{' '}
            <code className="text-[#00FFFF]">-30s</code>.
          </li>
          <li>
            <strong className="text-white">Hold (350ms+):</strong> Fast-forward{' '}
            <code className="text-[#00FFFF]">+10s</code> (repeats while held).
          </li>
        </ul>
      </div>

      {/* Vibe Pads */}
      <div className="space-y-1">
        <span className="font-bold text-[#FFFF00] font-mono text-[11px] block">
          ▦ VIBE PADS (3×7 MATRIX)
        </span>
        <ul className="text-neutral-300 space-y-0.5 pl-2 text-[11px] leading-relaxed">
          <li>
            <strong className="text-white">1 Tap:</strong> Multi-select crates with category neon
            glow (<span className="text-[#00FFFF]">Nature</span>,{' '}
            <span className="text-[#FFFF00]">Party</span>,{' '}
            <span className="text-[#FF00FF]">Cosmic</span>,{' '}
            <span className="text-[#D4D4D4]">Genres</span>).
          </li>
          <li>
            <strong className="text-white">Hold (450ms):</strong> Instant 1-tap route &amp;
            auto-play next track.
          </li>
        </ul>
      </div>

      {/* Playback & Decision Logic */}
      <div className="space-y-1">
        <span className="font-bold text-[#00FFFF] font-mono text-[11px] block">
          ⚡ PLAYBACK &amp; ROUTING FLOW
        </span>
        <ul className="text-neutral-300 space-y-0.5 pl-2 text-[11px] leading-relaxed">
          <li>
            <strong className="text-white">Auto-Play:</strong> Next track starts playing immediately
            after routing or skipping.
          </li>
          <li>
            <strong className="text-white">1× Smart Replay:</strong> If crates are selected when a
            track finishes, it replays once from 00:00, then stops.
          </li>
          <li>
            <strong className="text-white">Swipe Left / SKIP:</strong> Leaves original file
            untouched in Incoming directory.
          </li>
        </ul>
      </div>

      {/* Telemetry & Lock Screen */}
      <div className="space-y-1">
        <span className="font-bold text-[#FF00FF] font-mono text-[11px] block">
          ◎ TELEMETRY &amp; HARDWARE CONTROLS
        </span>
        <ul className="text-neutral-300 space-y-0.5 pl-2 text-[11px] leading-relaxed">
          <li>
            <strong className="text-white">Badges:</strong>{' '}
            <span className="text-[#00FFFF] font-mono">RAG XX%</span> library acoustic match ·{' '}
            <span className="text-[#FF00FF] font-mono">YT MATCH</span> playlist scout.
          </li>
          <li>
            <strong className="text-white">16-Bar Waveform:</strong> Structural energy phases (INTR
            → DRP → BRK → OUT).
          </li>
          <li>
            <strong className="text-white">iOS Lock Screen:</strong> System MediaSession integration
            supports hardware play/pause, seek, and track skip.
          </li>
        </ul>
      </div>
    </section>
  );
};
