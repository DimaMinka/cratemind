import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { useStore } from '../../src/services/UIService.js';
import { resetDBForTests } from '../../src/services/LocalDBService.js';
import { PocketBridgeService } from '../../src/services/pocket/PocketBridgeService.js';

describe('Tier 2 Integration: pocketBridgeServer', () => {
  let tempDir: string;
  let incomingDir: string;
  let sortedDir: string;
  let previewCacheDir: string;
  let bridge: PocketBridgeService;
  let port: number;
  let baseUrl: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cratemind-bridge-test-'));
    incomingDir = path.join(tempDir, 'Incoming');
    sortedDir = path.join(tempDir, 'Sorted');
    previewCacheDir = path.join(tempDir, 'previews');

    fs.mkdirSync(incomingDir, { recursive: true });
    fs.mkdirSync(sortedDir, { recursive: true });
    fs.mkdirSync(previewCacheDir, { recursive: true });

    process.env.CRATEMIND_DB_PATH = path.join(tempDir, 'test.db');
    resetDBForTests();

    bridge = new PocketBridgeService({
      port: 0, // Ephemeral port
      host: '127.0.0.1',
      incomingDir,
      sortedDir,
      cacheDir: previewCacheDir
    });

    await bridge.start(0, '127.0.0.1');
    port = bridge.getPort();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await bridge.stop();
    resetDBForTests();
    delete process.env.CRATEMIND_DB_PATH;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on temp dir
    }
  });

  beforeEach(() => {
    useStore.setState({
      isTelegramDownloading: false,
      isIndexingVibes: false,
      isLLMAnalyzing: false,
      driveSyncProgress: null
    });
  });

  afterEach(() => {
    useStore.setState({
      isTelegramDownloading: false,
      isIndexingVibes: false,
      isLLMAnalyzing: false,
      driveSyncProgress: null
    });
  });

  it('TC-BR-01: Ephemeral Port Startup & Teardown binds and reports dynamic port', async () => {
    expect(port).toBeGreaterThan(0);
    expect(bridge.getServer()).not.toBeNull();
  });

  it('TC-BR-02: GET /api/health (Idle) reports healthy status and zero active tasks', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.isBusy).toBe(false);
    expect(data.activeTask).toBeNull();
    expect(typeof data.incomingCount).toBe('number');
    expect(typeof data.ragCount).toBe('number');
  });

  it('TC-BR-03: GET /api/health (Telegram Busy) reports isBusy: true and activeTask', async () => {
    useStore.setState({ isTelegramDownloading: true });

    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.isBusy).toBe(true);
    expect(data.activeTask).toBe('Telegram downloading');
  });

  it('TC-BR-04: GET /api/batch standard fetch returns valid PocketBatchManifest', async () => {
    fs.writeFileSync(path.join(incomingDir, 'Track1.mp3'), 'AUDIO_DATA_1');
    fs.writeFileSync(path.join(incomingDir, 'Track2.wav'), 'AUDIO_DATA_2');

    const res = await fetch(`${baseUrl}/api/batch`);
    expect(res.status).toBe(200);

    const manifest = await res.json();
    expect(manifest.batchId).toBeDefined();
    expect(manifest.tracks.length).toBeGreaterThanOrEqual(2);
    expect(manifest.totalTracks).toBeGreaterThanOrEqual(2);
  });

  it('TC-BR-05: GET /api/batch?limit=1 enforces query parameter limit', async () => {
    const res = await fetch(`${baseUrl}/api/batch?limit=1`);
    expect(res.status).toBe(200);

    const manifest = await res.json();
    expect(manifest.tracks.length).toBe(1);
  });

  it('TC-BR-06: GET /api/audio/:id Byte Range (0-1023) returns HTTP 206 Partial Content', async () => {
    const audioFilename = 'SampleRange.mp3';
    const audioPath = path.join(incomingDir, audioFilename);
    const audioBuffer = Buffer.alloc(5000, 0x55);
    fs.writeFileSync(audioPath, audioBuffer);

    const id = Buffer.from(audioFilename, 'utf-8').toString('base64url');

    const res = await fetch(`${baseUrl}/api/audio/${id}`, {
      headers: { Range: 'bytes=0-1023' }
    });

    expect(res.status).toBe(206);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-range')).toMatch(/^bytes 0-1023\/\d+$/);
    expect(res.headers.get('content-length')).toBe('1024');

    const chunk = await res.arrayBuffer();
    expect(chunk.byteLength).toBe(1024);
  });

  it('TC-BR-07: GET /api/audio/:id Open-Ended Range returns HTTP 206 for suffix', async () => {
    const audioFilename = 'SampleOpenRange.mp3';
    const audioPath = path.join(incomingDir, audioFilename);
    const audioBuffer = Buffer.alloc(3000, 0xaa);
    fs.writeFileSync(audioPath, audioBuffer);

    const id = Buffer.from(audioFilename, 'utf-8').toString('base64url');

    const res = await fetch(`${baseUrl}/api/audio/${id}`, {
      headers: { Range: 'bytes=1000-' }
    });

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toMatch(/^bytes 1000-\d+\/\d+$/);
    const chunk = await res.arrayBuffer();
    expect(chunk.byteLength).toBeGreaterThan(0);
  });

  it('TC-BR-08: GET /api/audio/:id Full File delivery without Range header returns HTTP 200', async () => {
    const audioFilename = 'SampleFull.mp3';
    const audioPath = path.join(incomingDir, audioFilename);
    const audioBuffer = Buffer.alloc(2048, 0xbb);
    fs.writeFileSync(audioPath, audioBuffer);

    const id = Buffer.from(audioFilename, 'utf-8').toString('base64url');

    const res = await fetch(`${baseUrl}/api/audio/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBe('bytes');

    const fullData = await res.arrayBuffer();
    expect(fullData.byteLength).toBeGreaterThan(0);
  });

  it('TC-BR-09: GET /api/audio/:id Unsatisfiable Range returns HTTP 416', async () => {
    const audioFilename = 'Sample416.mp3';
    const audioPath = path.join(incomingDir, audioFilename);
    fs.writeFileSync(audioPath, Buffer.alloc(100, 0xcc));

    const id = Buffer.from(audioFilename, 'utf-8').toString('base64url');

    const res = await fetch(`${baseUrl}/api/audio/${id}`, {
      headers: { Range: 'bytes=99999999-' }
    });

    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toMatch(/^bytes \*\/\d+$/);
  });

  it('TC-BR-10: GET /api/audio/:id Unknown Track ID returns HTTP 404', async () => {
    const unknownId = Buffer.from('NonExistentSong.mp3', 'utf-8').toString('base64url');

    const res = await fetch(`${baseUrl}/api/audio/${unknownId}`);
    expect(res.status).toBe(404);
  });

  it('TC-BR-11: POST /api/commit returns HTTP 409 Conflict when a task is active', async () => {
    useStore.setState({ isIndexingVibes: true });

    const res = await fetch(`${baseUrl}/api/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batchId: 'batch-test-conflict',
        decisions: []
      })
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('busy');
    expect(body.activeTask).toBe('Vibes indexing');
  });

  it('TC-BR-12: POST /api/commit processes valid commit and routes files with HTTP 200', async () => {
    const filename = 'IntegrationRoute.mp3';
    fs.writeFileSync(path.join(incomingDir, filename), 'AUDIO_INTEGRATION');

    const res = await fetch(`${baseUrl}/api/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batchId: 'batch-test-valid',
        decisions: [
          {
            trackId: '101',
            filename,
            status: 'tagged',
            selectedFolders: ['club party']
          }
        ]
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.routedCount).toBe(1);
    expect(fs.existsSync(path.join(sortedDir, 'club party', filename))).toBe(true);
  });

  it('TC-BR-13: serves sw.js/manifest with no-cache, /assets/* with immutable max-age, and exposes buildHash in /api/health', async () => {
    const swRes = await fetch(`${baseUrl}/sw.js`);
    expect(swRes.status).toBe(200);
    expect(swRes.headers.get('cache-control')).toBe('no-cache, no-store, must-revalidate');

    const manifestRes = await fetch(`${baseUrl}/manifest.webmanifest`);
    expect(manifestRes.status).toBe(200);
    expect(manifestRes.headers.get('cache-control')).toBe('no-cache, no-store, must-revalidate');

    const assetsDir = path.resolve('dist/pocket-web/assets');
    if (fs.existsSync(assetsDir)) {
      const assetFile = fs.readdirSync(assetsDir).find((f) => f.endsWith('.js'));
      if (assetFile) {
        const assetRes = await fetch(`${baseUrl}/assets/${assetFile}`);
        expect(assetRes.status).toBe(200);
        expect(assetRes.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      }
    }

    const healthRes = await fetch(`${baseUrl}/api/health`);
    expect(healthRes.status).toBe(200);
    expect(healthRes.headers.get('cache-control')).toBe('no-cache, no-store, must-revalidate');
    const healthBody = (await healthRes.json()) as { version?: string; buildHash?: string };
    expect(healthBody.version).toBe('0.1.0');
    expect(typeof healthBody.buildHash).toBe('string');
    expect(healthBody.buildHash!.length).toBeGreaterThan(0);
  });
});
