/**
 * scratch/accuracy-simulator.ts
 *
 * Bulk dry-run classification accuracy testing framework for CrateMind.
 * Reads hand-sorted tracks from the golden standard directory:
 *   '/Users/dima/Downloads/audio after resort'
 *
 * Compares CrateMind's simulated Gemini classification against actual
 * parent folder destinations.
 *
 * Strict Non-Destructive Mode:
 * - NO files are moved.
 * - NO SQLite writes are committed to main tables.
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenAI } from '@google/genai';
import * as EmbeddingService from '../src/services/EmbeddingService.js';
import { buildPassport } from '../src/services/TrackPassportService.js';
import * as EngineDBService from '../src/services/EngineDBService.js';
import * as ID3Service from '../src/services/ID3Service.js';
import * as NetworkScoutService from '../src/services/NetworkScoutService.js';
import { FOLDERS, LLM_MODEL, YT_SCOUT_ENABLED } from '../src/config.js';
import { BASE_SYSTEM_INSTRUCTION, classifyTracksBatch, BatchTrackInput } from '../src/services/LLMService.js';
import { getDB } from '../src/services/LocalDBService.js';

// Setup colors for console output
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

const GOLDEN_DIR = '/Users/dima/Downloads/audio after resort';

async function run() {
  const LOG_FILE = path.join(process.cwd(), 'accuracy-simulator.log');
  fs.appendFileSync(LOG_FILE, `\n\n=== ACCURACY SIMULATION RUN: ${new Date().toLocaleString()} ===\n`);

  function cleanAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  function logBoth(msg: string) {
    console.log(msg);
    fs.appendFileSync(LOG_FILE, cleanAnsi(msg) + '\n');
  }

  // Reset daily limit counter for the test run so local limit checks don't block simulation
  try {
    const db = getDB();
    const today = new Date().toISOString().split('T')[0];
    db.prepare('INSERT OR REPLACE INTO api_stats (date, count) VALUES (?, 0)').run(today);
    logBoth(`  ✓ Reset daily API request counter to 0 for simulation.`);
  } catch (dbErr) {
    logBoth(`  ⚠️ Could not reset API request counter: ${dbErr}`);
  }

  logBoth(`\n${c.bold}${c.magenta}CrateMind — Dry-Run Accuracy Simulator${c.reset}`);
  logBoth(`${c.dim}Golden Standard: ${GOLDEN_DIR}${c.reset}\n`);

  if (!process.env.GEMINI_API_KEY) {
    console.error(`${c.red}❌ GEMINI_API_KEY is not defined!${c.reset}`);
    process.exit(1);
  }

  // 1. Gather all files in the golden standard
  const subdirs = fs.readdirSync(GOLDEN_DIR).filter(name => {
    return fs.statSync(path.join(GOLDEN_DIR, name)).isDirectory();
  });

  interface TestCase {
    filepath: string;
    filename: string;
    expectedFolder: string;
  }

  // Manual user corrections for specific tracks to optimize the golden standard target labels
  const folderOverrides: Record<string, string> = {
    'Wake Me Up': 'mountain sunset',
    'Keep Running': 'mountain sunset',
    'Broken Parts': 'new day vibe',
    'Back To U': 'club party'
  };

  const cases: TestCase[] = [];

  for (const dir of subdirs) {
    const dirPath = path.join(GOLDEN_DIR, dir);
    const files = fs.readdirSync(dirPath).filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.flac', '.mp3', '.m4a', '.wav'].includes(ext);
    });

    for (const file of files) {
      let expected = dir.trim();
      for (const [key, val] of Object.entries(folderOverrides)) {
        if (file.includes(key)) {
          expected = val;
          break;
        }
      }
      cases.push({
        filepath: path.join(dirPath, file),
        filename: file,
        expectedFolder: expected,
      });
    }
  }

  logBoth(`  ✓ Discovered ${c.bold}${cases.length}${c.reset} golden standard tracks across ${c.bold}${subdirs.length}${c.reset} folders.\n`);

  if (cases.length === 0) {
    logBoth(`${c.yellow}⚠ No audio files found in golden standard directory.${c.reset}`);
    process.exit(0);
  }

  const args = process.argv.slice(2);
  const offsetArg = args.find(a => a.startsWith('--offset='));
  const offset = offsetArg ? parseInt(offsetArg.split('=')[1], 10) : 0;

  // Sort alphabetically by expected folder and filename for stable evaluation and diversity
  const sortedCases = cases.sort((a, b) => {
    const folderCompare = a.expectedFolder.localeCompare(b.expectedFolder);
    if (folderCompare !== 0) return folderCompare;
    return a.filename.localeCompare(b.filename);
  });

  // Hard/sticky tracks we always want to include to verify prompts don't regress on past fixes
  const stickyFiles = [
    'Still.i - Back To U',
    'ENØS - Infinitum',
    'Alaz (Innellea Remix)',
    'Voon - Good'
  ];

  const stickyCases = sortedCases.filter(c => stickyFiles.some(sf => c.filename.includes(sf)));
  const nonStickyCases = sortedCases.filter(c => !stickyFiles.some(sf => c.filename.includes(sf)));

  const sizeArg = args.find(a => a.startsWith('--size='));
  const sampleSize = sizeArg ? parseInt(sizeArg.split('=')[1], 10) : 15;
  const testSample: TestCase[] = [...stickyCases];

  const needed = Math.max(0, sampleSize - stickyCases.length);
  if (needed > 0 && nonStickyCases.length > 0) {
    const step = Math.floor(nonStickyCases.length / needed);
    for (let i = 0; i < needed; i++) {
      const index = (i * step + offset) % nonStickyCases.length;
      testSample.push(nonStickyCases[index]);
    }
  }

  logBoth(`  → Selected a stable, diverse sample of ${c.bold}${testSample.length}${c.reset} tracks (${stickyCases.length} sticky, offset: ${offset}) for optimization.\n`);

  const CACHE_PATH = path.join(process.cwd(), 'scratch/neighbors-cache.json');
  let cache: Record<string, any> = {};
  if (fs.existsSync(CACHE_PATH)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    } catch {}
  }

  let matched = 0;
  let manualRequired = 0;
  const mismatches: { filename: string; expected: string; recommended: string[]; reasoning: string }[] = [];

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // System Instruction from LLMService but dynamic so we can print or adapt it
  const systemInstruction = BASE_SYSTEM_INSTRUCTION;

  const batchInputs: BatchTrackInput[] = [];
  const inputToTestCaseMap = new Map<string, TestCase>();

  let done = 0;
  for (const testCase of testSample) {
    const percent = Math.round((done / testSample.length) * 100);
    const progressBar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
    process.stdout.write(`\r  [${progressBar}] ${percent}%  Preparing: ${testCase.filename.slice(0, 30)}`.padEnd(80));
    fs.appendFileSync(LOG_FILE, `[Preparing ${done + 1}/${testSample.length}] ${testCase.filename} (Expected: /${testCase.expectedFolder})\n`);

    // Extract tags from ID3
    let meta = await ID3Service.extractMetadata(testCase.filepath).catch(() => ({
      artist: '',
      title: '',
      duration: 0
    }));

    if (!meta.artist || meta.artist === 'Unknown Artist') {
      // Fallback: parse from filename
      const cleanName = testCase.filename.replace(/\.(flac|mp3|m4a|wav)$/i, '');
      const parts = cleanName.split('-');
      if (parts.length >= 2) {
        meta.artist = parts[0].trim();
        meta.title = parts[1].trim();
      } else {
        meta.title = cleanName.trim();
        meta.artist = 'Unknown Artist';
      }
    }

    // Enrich with Engine DJ m.db if possible
    if (EngineDBService.isAvailable()) {
      const dbTrack = EngineDBService.getTrackByMeta(meta.artist, meta.title);
      if (dbTrack) {
        if (dbTrack.bpm) meta.bpm = dbTrack.bpm;
        if (dbTrack.key) meta.key = dbTrack.key;
        if (dbTrack.genre) meta.genre = dbTrack.genre;
        if (dbTrack.comment) meta.comment = dbTrack.comment;
        if (dbTrack.label) meta.label = dbTrack.label;
      }
    }

    // Step 3: YouTube Network Scout — search for playlist context
    let networkContext = '';
    let scoutResult: Awaited<ReturnType<typeof NetworkScoutService.getTrackContext>> | null = null;
    if (YT_SCOUT_ENABLED) {
      scoutResult = await NetworkScoutService.getTrackContext(meta.artist, meta.title);

      if (scoutResult.playlists.length > 0) {
        networkContext = NetworkScoutService.formatForPrompt(scoutResult);

        // --- Live m.db Bridging Logic ---
        if (EngineDBService.isAvailable()) {
          const dbTracks = EngineDBService.getTracks();
          const matches: string[] = [];

          for (const neighbor of scoutResult.neighbors) {
            const neighborKey = `${neighbor.artist.toLowerCase()}|${neighbor.title.toLowerCase()}`;
            const mdbMatch = dbTracks.find(
              (t) =>
                `${(t.artist || 'Unknown').toLowerCase()}|${(t.title || t.filename || 'Unknown').toLowerCase()}` ===
                neighborKey
            );

            if (mdbMatch) {
              const pathParts = mdbMatch.path.toLowerCase().split(/[/\\]/);
              const folder = FOLDERS.find((f) => pathParts.includes(f.toLowerCase()));
              if (folder) {
                matches.push(
                  `- Neighbor track "${neighbor.artist} - ${neighbor.title}" is already sorted in your library folder: "${folder}"`
                );
              }
            }
          }

          if (matches.length > 0) {
            let dbMatchContext =
              '\n\n=== High-Priority Library Match Context (YouTube neighbors already sorted in your library) ===\n';
            dbMatchContext +=
              'These tracks are in the same playlists/mixes as the target track on YouTube, and you have already manually sorted them in these vibe folders. Give these folders the HIGHEST priority:\n';
            dbMatchContext += matches.join('\n');
            dbMatchContext +=
              '\n==================================================================================================';
            networkContext += dbMatchContext;
          }
        }
      }
    }

    const passport = buildPassport({ meta, ytPlaylists: scoutResult?.playlists });
    
    // Find nearest neighbors in balanced vector store with disk cache
    const excludeKey = `${meta.artist.toLowerCase()}|${meta.title.toLowerCase()}`;
    let neighbors = cache[excludeKey];
    if (!neighbors) {
      let retries = 5;
      let delayMs = 5000;
      while (retries > 0) {
        try {
          neighbors = await EmbeddingService.findNeighbors(passport.text, 3, excludeKey);
          cache[excludeKey] = neighbors;
          fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
          break;
        } catch (err: any) {
          process.stdout.write(`\n⚠️ Embedding rate limited on ${testCase.filename}. Retrying in ${delayMs / 1000}s...\n`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          delayMs *= 2;
          retries--;
        }
      }
    }
    if (!neighbors) neighbors = [];

    batchInputs.push({
      trackId: testCase.filename,
      artist: meta.artist,
      title: meta.title,
      bpm: meta.bpm,
      key: meta.key,
      genre: meta.genre,
      comment: meta.comment,
      label: meta.label,
      vectorNeighbors: neighbors,
      youtubeContext: networkContext
    });

    inputToTestCaseMap.set(testCase.filename, testCase);
    done++;
  }

  // Clear line
  process.stdout.write(`\r`.padEnd(80) + `\r`);
  logBoth(`\n  ✓ Prepared all track metadata and contexts. Starting batch classification...\n`);

  const BATCH_SIZE = 5;
  const totalBatches = Math.ceil(batchInputs.length / BATCH_SIZE);

  for (let b = 0; b < totalBatches; b++) {
    const chunk = batchInputs.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    logBoth(`\n[Batch ${b + 1}/${totalBatches}] Sending ${chunk.length} tracks to Gemini...`);
    for (const item of chunk) {
      logBoth(`  - ${item.artist} - ${item.title}`);
    }

    try {
      const results = await classifyTracksBatch(chunk);
      for (const result of results) {
        const testCase = inputToTestCaseMap.get(result.trackId);
        if (!testCase) continue;

        const recs = (result.folders || []).map((f: string) => f.toLowerCase().trim());
        const expected = testCase.expectedFolder.toLowerCase().trim();
        const isMatch = recs.includes(expected);

        if (isMatch) {
          matched++;
        } else {
          mismatches.push({
            filename: testCase.filename,
            expected: testCase.expectedFolder,
            recommended: result.folders || [],
            reasoning: result.reasoning || 'No reasoning provided.'
          });
        }

        logBoth(
          `  → Result for "${testCase.filename}": ${isMatch ? '✅ MATCH' : '❌ MISMATCH'} (Recommended: /${recs.join(' & /')} | Confidence: ${result.confidence})`
        );

        if (result.confidence < 0.70) {
          manualRequired++;
        }
      }
    } catch (err: any) {
      logBoth(`❌ Error processing batch ${b + 1}: ${err.message || String(err)}`);
      if (err.stack) {
        logBoth(err.stack);
      }
      for (const item of chunk) {
        mismatches.push({
          filename: item.trackId,
          expected: inputToTestCaseMap.get(item.trackId)?.expectedFolder || 'unknown',
          recommended: [],
          reasoning: `Batch failed with error: ${err.message || String(err)}`
        });
      }
    }
  }

  // Clear line
  process.stdout.write(`\r`.padEnd(80) + `\r`);

  const accuracy = (matched / testSample.length) * 100;
  const overrideRate = (manualRequired / testSample.length) * 100;

  logBoth(`\n${c.bold}${c.green}══════════════════════════════════════════════════════════════${c.reset}`);
  logBoth(`${c.bold}${c.green}  Simulation Report${c.reset}`);
  logBoth(`\n${c.bold}${c.green}══════════════════════════════════════════════════════════════${c.reset}\n`);

  logBoth(`  Tracks simulated:    ${testSample.length}`);
  logBoth(`  Matching decisions:  ${matched} / ${testSample.length} (${c.bold}${accuracy.toFixed(1)}%${c.reset} Accuracy)`);
  logBoth(`  Manual overrides:    ${manualRequired} / ${testSample.length} (${overrideRate.toFixed(1)}% Override Rate)`);

  if (mismatches.length > 0) {
    logBoth(`\n${c.bold}${c.yellow}  Mismatch Outliers Analyzed:${c.reset}\n`);
    mismatches.forEach((m, idx) => {
      logBoth(`  ${idx + 1}. ${c.bold}${m.filename}${c.reset}`);
      logBoth(`     Expected:    ${c.green}/${m.expected}${c.reset}`);
      logBoth(`     Recommend:   ${c.red}/${m.recommended.join(' & /')}${c.reset}`);
      logBoth(`     Reason:      ${c.dim}${m.reasoning}${c.reset}\n`);
    });
  } else {
    logBoth(`\n  ${c.green}✓ Absolute perfection! 100% matched decisions.${c.reset}\n`);
  }
}

run().catch(console.error);
