import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Browser, type Page } from 'puppeteer-core';
import { setupE2ESandbox, launchMobileBrowser, type E2ESandbox } from './e2eHelpers.js';

describe('CrateMind Pocket Mobile Layout E2E (iPhone 390x844)', () => {
  let sandbox: E2ESandbox;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    sandbox = await setupE2ESandbox();
    const launcher = await launchMobileBrowser();
    browser = launcher.browser;
    page = launcher.page;
    await page.goto(sandbox.baseUrl, { waitUntil: 'domcontentloaded' });
    // If tracks are not loaded in sorter, navigate to sync and click pull button
    const pad = await page.$('.dj-pad');
    if (!pad) {
      const syncTab = await page.$('#tab-sync');
      if (syncTab) {
        await syncTab.click();
        const pullBtn = await page.waitForSelector('button::-p-text(Pull 30 Tracks from Mac)', {
          timeout: 4000
        });
        if (pullBtn) {
          await pullBtn.click();
          await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
        }
        const sorterTab = await page.$('#tab-sorter');
        if (sorterTab) await sorterTab.click();
      }
    }
    await page.waitForSelector('.dj-pad', { timeout: 10000 });
  }, 30000);

  afterAll(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (sandbox) await sandbox.cleanup().catch(() => {});
  });

  it('TC-E2E-01: Viewport dimensions render properly on mobile 390x844', async () => {
    const metrics = await page.evaluate(() => ({
      bodyScrollWidth: document.body.scrollWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      windowInnerHeight: window.innerHeight,
      windowInnerWidth: window.innerWidth
    }));

    expect(metrics.windowInnerWidth).toBe(390);
    expect(metrics.windowInnerHeight).toBe(844);
    expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(390);
    expect(metrics.docScrollWidth).toBeLessThanOrEqual(390);
  });

  it('TC-E2E-02: Top telemetry header renders within viewport with safe-area spacing', async () => {
    const headerVisible = await page.evaluate(() => {
      const header = document.querySelector('.header-telemetry');
      if (!header) return false;
      const rect = header.getBoundingClientRect();
      return rect.top >= 0 && rect.height > 0;
    });
    expect(headerVisible).toBe(true);
  });

  it('TC-E2E-03: Exactly 21 tactile DJ pads rendered in 3x7 grid', async () => {
    const padCount = await page.$$eval('.dj-pad', (elements) => elements.length);
    expect(padCount).toBe(21);
  });

  it('TC-E2E-04: Touch targets meet Apple HIG minimum size (>= 44px height, >= 80px width)', async () => {
    const pads = await page.$$eval('.dj-pad', (elements) =>
      elements.map((el) => {
        const r = el.getBoundingClientRect();
        return { height: r.height, width: r.width };
      })
    );

    expect(pads.length).toBe(21);
    for (const pad of pads) {
      expect(pad.height).toBeGreaterThanOrEqual(44);
      expect(pad.width).toBeGreaterThanOrEqual(80);
    }
  });

  it('TC-E2E-05: Viewport containment (all 21 pads fit within 390x844)', async () => {
    const boxes = await page.$$eval('.dj-pad', (elements) =>
      elements.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, height: r.height, width: r.width };
      })
    );

    expect(boxes.length).toBe(21);
    for (const box of boxes) {
      expect(box.y + box.height).toBeLessThanOrEqual(844);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
    }
  });

  it('TC-E2E-06: Segmented Control tab switching navigation', async () => {
    // Switch to Queue tab
    await page.click('#tab-queue');
    const queueVisible = await page.$eval(
      '#view-queue',
      (el) => getComputedStyle(el).display !== 'none'
    );
    const sorterHidden = await page.$eval(
      '#view-sorter',
      (el) => getComputedStyle(el).display === 'none'
    );
    expect(queueVisible).toBe(true);
    expect(sorterHidden).toBe(true);

    // Switch to Sync tab
    await page.click('#tab-sync');
    const syncVisible = await page.$eval(
      '#view-sync',
      (el) => getComputedStyle(el).display !== 'none'
    );
    const queueHidden = await page.$eval(
      '#view-queue',
      (el) => getComputedStyle(el).display === 'none'
    );
    expect(syncVisible).toBe(true);
    expect(queueHidden).toBe(true);

    // Switch back to Sorter tab
    await page.click('#tab-sorter');
    const sorterVisible = await page.$eval(
      '#view-sorter',
      (el) => getComputedStyle(el).display !== 'none'
    );
    const syncHidden = await page.$eval(
      '#view-sync',
      (el) => getComputedStyle(el).display === 'none'
    );
    expect(sorterVisible).toBe(true);
    expect(syncHidden).toBe(true);
  });

  it('TC-E2E-07: Multi-select interaction toggles active yellow glow and selection count', async () => {
    const pads = await page.$$('.dj-pad');
    const firstPad = pads[0];
    const secondPad = pads[1];

    // Select first pad
    await firstPad.click();
    let hasGlow1 = await firstPad.evaluate((el) => el.classList.contains('glow-yellow-active'));
    let routeText = await page.$eval('#btn-route', (el) => el.textContent || '');
    expect(hasGlow1).toBe(true);
    expect(routeText).toContain('(1 selected)');

    // Select second pad
    await secondPad.click();
    let hasGlow2 = await secondPad.evaluate((el) => el.classList.contains('glow-yellow-active'));
    routeText = await page.$eval('#btn-route', (el) => el.textContent || '');
    expect(hasGlow2).toBe(true);
    expect(routeText).toContain('(2 selected)');

    // Deselect first pad
    await firstPad.click();
    hasGlow1 = await firstPad.evaluate((el) => el.classList.contains('glow-yellow-active'));
    routeText = await page.$eval('#btn-route', (el) => el.textContent || '');
    expect(hasGlow1).toBe(false);
    expect(routeText).toContain('(1 selected)');

    // Deselect second pad
    await secondPad.click();
    hasGlow2 = await secondPad.evaluate((el) => el.classList.contains('glow-yellow-active'));
    routeText = await page.$eval('#btn-route', (el) => el.textContent || '');
    expect(hasGlow2).toBe(false);
    expect(routeText).toBe('Route & Next');
  });

  it('TC-E2E-08: Zero AI / Gemini copy policy across entire client DOM', async () => {
    const innerText = await page.evaluate(() => document.body.innerText);
    const forbiddenPattern = /\bAI\b|Gemini|LLM|Artificial Intelligence/i;
    expect(forbiddenPattern.test(innerText)).toBe(false);
  });

  it('TC-E2E-09: 450ms long-press gesture triggers 1-tap route, advances track, and suppresses release click', async () => {
    const initialTitle = await page.$eval('.track-title', (el) => el.textContent || '');
    const firstPad = (await page.$$('.dj-pad'))[0];
    const folderName = await firstPad.evaluate((el) => el.getAttribute('data-folder') || '');
    const box = await firstPad.boundingBox();
    expect(box).not.toBeNull();
    expect(folderName.length).toBeGreaterThan(0);

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.mouse.up();

    const nextTitle = await page.$eval('.track-title', (el) => el.textContent || '');
    expect(nextTitle).not.toBe(initialTitle);
    expect(nextTitle.length).toBeGreaterThan(0);

    // Verify release click was suppressed (next track starts with 0 selected folders)
    const routeText = await page.$eval('#btn-route', (el) => el.textContent || '');
    expect(routeText).toBe('Route & Next');

    // Verify Queue tab reflects TAGGED decision for the routed track
    await page.click('#tab-queue');
    const queueText = await page.$eval('#view-queue', (el) => el.textContent || '');
    expect(queueText).toContain('TAGGED');
    expect(queueText).toContain(folderName);
    await page.click('#tab-sorter');
  });

  it('TC-E2E-10: Swipe left gesture triggers skip and advances track', async () => {
    const titleBeforeSwipe = await page.$eval('.track-title', (el) => el.textContent || '');

    await page.evaluate(() => {
      const target = document.body;
      const startTouch = new Touch({ identifier: 1, target, clientX: 300, clientY: 400 });
      const endTouch = new Touch({ identifier: 1, target, clientX: 200, clientY: 400 });
      window.dispatchEvent(new TouchEvent('touchstart', { touches: [startTouch], bubbles: true }));
      window.dispatchEvent(
        new TouchEvent('touchend', { touches: [], changedTouches: [endTouch], bubbles: true })
      );
    });

    const titleAfterSwipe = await page.$eval('.track-title', (el) => el.textContent || '');
    expect(titleAfterSwipe).not.toBe(titleBeforeSwipe);
    expect(titleAfterSwipe.length).toBeGreaterThan(0);

    // Verify Queue tab reflects SKIPPED status for the skipped track
    await page.click('#tab-queue');
    const queueText = await page.$eval('#view-queue', (el) => el.textContent || '');
    expect(queueText).toContain('SKIPPED');
    await page.click('#tab-sorter');
  });
});
