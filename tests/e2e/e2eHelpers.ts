import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { PocketBridgeService } from '../../src/services/pocket/PocketBridgeService.js';
import { resetDBForTests } from '../../src/services/LocalDBService.js';

export function findChromeExecutable(): string {
  const envBin = process.env.CHROME_BIN || process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    envBin,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error('No Chrome executable found. Set CHROME_BIN or PUPPETEER_EXECUTABLE_PATH.');
}

export async function launchMobileBrowser(
  execPath?: string
): Promise<{ browser: Browser; page: Page }> {
  const executablePath = execPath || findChromeExecutable();
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true
  });
  return { browser, page };
}

export interface E2ESandbox {
  sandboxDir: string;
  incomingDir: string;
  sortedDir: string;
  dbPath: string;
  bridge: PocketBridgeService;
  port: number;
  baseUrl: string;
  cleanup: () => Promise<void>;
}

export async function setupE2ESandbox(): Promise<E2ESandbox> {
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cratemind-e2e-'));
  const incomingDir = path.join(sandboxDir, 'Incoming');
  const sortedDir = path.join(sandboxDir, 'Sorted');
  const dbPath = path.join(sandboxDir, 'cratemind.test.db');
  fs.mkdirSync(incomingDir, { recursive: true });
  fs.mkdirSync(sortedDir, { recursive: true });
  process.env.CRATEMIND_DB_PATH = dbPath;

  const distStatic = path.resolve('dist/pocket-web');
  const indexHtml = path.join(distStatic, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    throw new Error(
      `Compiled PWA not found at ${indexHtml}. Run 'npm run build:pocket' before executing E2E tests.`
    );
  }
  const staticDir = distStatic;

  const bridge = new PocketBridgeService({
    port: 0,
    host: '127.0.0.1',
    incomingDir,
    sortedDir,
    staticDir
  });
  const { port } = await bridge.start(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${port}`;

  const cleanup = async () => {
    try {
      await bridge.stop();
    } catch {}
    resetDBForTests();
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  };
  return { sandboxDir, incomingDir, sortedDir, dbPath, bridge, port, baseUrl, cleanup };
}
