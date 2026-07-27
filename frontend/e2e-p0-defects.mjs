// P0 defect scan: drives BOTH the Reading Room and the Activity Room at three
// viewports, capturing screenshots, console errors, failed requests, and layout
// metrics (overflow, video-vs-book area share, control counts).
// Run from frontend/:  node e2e-p0-defects.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const FRONT = process.env.FRONT_BASE || 'http://localhost:3000';
const API = process.env.API_BASE || 'http://127.0.0.1:8001/api/v1';
const OUT = 'e2e-shots/p0';
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const report = [];
const log = (...a) => console.log('[p0]', ...a);

async function tokens(username, password) {
  const res = await fetch(`${API}/auth/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const b = await res.json();
  if (!b?.data?.tokens?.access) throw new Error(`login ${username} failed: ${JSON.stringify(b).slice(0, 200)}`);
  return b.data.tokens;
}

async function createSession(authHdr, roomType) {
  const books = (await (await fetch(`${API}/books/`, { headers: authHdr })).json()).data ?? [];
  const children = (await (await fetch(`${API}/children/`, { headers: authHdr })).json()).data ?? [];
  if (!books.length) throw new Error('no books seeded');
  if (!children.length) throw new Error('no child profiles seeded');
  const book =
    roomType === 'activity'
      ? books.find((b) => b.room_type === 'activity' || b.room_type === 'hybrid') ?? books[0]
      : books.find((b) => b.room_type === 'reading' || b.room_type === 'hybrid') ?? books[0];
  const res = await fetch(`${API}/sessions/`, {
    method: 'POST',
    headers: authHdr,
    body: JSON.stringify({ book_id: book.id, child_profile_id: children[0].id, room_type: roomType }),
  });
  const body = await res.json();
  if (!body?.data?.id) throw new Error(`create ${roomType} session failed: ${JSON.stringify(body).slice(0, 300)}`);
  return { session: body.data, book };
}

// Measures what actually landed on screen: does the page scroll sideways, how
// much area do video tiles claim vs the book, and how many controls compete.
async function measure(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const area = (el) => {
      const r = el.getBoundingClientRect();
      return Math.max(0, r.width) * Math.max(0, r.height);
    };
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return (
        r.width > 4 &&
        r.height > 4 &&
        s.visibility !== 'hidden' &&
        s.display !== 'none' &&
        parseFloat(s.opacity || '1') > 0.05 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.top < innerHeight &&
        r.left < innerWidth
      );
    };
    const videos = [...document.querySelectorAll('video')].filter(visible);
    const canvases = [...document.querySelectorAll('canvas')].filter(visible);
    const imgs = [...document.querySelectorAll('img')].filter(visible);
    const bookCandidates = [...canvases, ...imgs].sort((a, b) => area(b) - area(a));
    const buttons = [...document.querySelectorAll('button, [role="button"], a[href]')].filter(visible);
    const smallTargets = buttons.filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width < 44 || r.height < 44;
    });
    // Elements poking past the right edge cause the horizontal scroll.
    const overflowers = [...document.querySelectorAll('*')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > de.clientWidth + 2;
      })
      .slice(0, 8)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: (el.className?.toString?.() || '').slice(0, 90),
        right: Math.round(el.getBoundingClientRect().right),
      }));
    const viewportArea = innerWidth * innerHeight;
    return {
      scrollW: de.scrollWidth,
      clientW: de.clientWidth,
      horizontalScroll: de.scrollWidth > de.clientWidth + 2,
      overflowers,
      videoCount: videos.length,
      videoAreaPct: +((videos.reduce((s, v) => s + area(v), 0) / viewportArea) * 100).toFixed(1),
      bookAreaPct: bookCandidates.length ? +((area(bookCandidates[0]) / viewportArea) * 100).toFixed(1) : 0,
      canvasCount: canvases.length,
      controlCount: buttons.length,
      smallTargetCount: smallTargets.length,
      smallTargetLabels: smallTargets
        .slice(0, 10)
        .map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30)),
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  });
}

async function driveRoom(browser, { label, roomType, tok }) {
  const authHdr = { Authorization: `Bearer ${tok.access}`, 'Content-Type': 'application/json' };
  const { session, book } = await createSession(authHdr, roomType);
  log(label, 'session', session.id, 'book', book.title, book.room_type);

  for (const vp of VIEWPORTS) {
    const entry = {
      room: label,
      viewport: vp.name,
      size: `${vp.width}x${vp.height}`,
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      url: null,
      metrics: null,
      notes: [],
    };
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      permissions: ['camera', 'microphone'],
      isMobile: vp.name === 'mobile',
      hasTouch: vp.name !== 'desktop',
    });
    await ctx.addInitScript(
      ([a, r, s, p]) => {
        localStorage.setItem('bb_access_token', a);
        localStorage.setItem('bb_refresh_token', r);
        localStorage.setItem(`bb_participant_${s}`, p);
      },
      [tok.access, tok.refresh, session.id, session.host_participant_id],
    );
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') entry.consoleErrors.push(m.text().slice(0, 220));
    });
    page.on('pageerror', (e) => entry.pageErrors.push(String(e).slice(0, 220)));
    page.on('requestfailed', (r) => {
      const u = r.url();
      if (!/livekit|wss:/.test(u)) entry.failedRequests.push(`${r.failure()?.errorText} ${u.slice(0, 120)}`);
    });

    try {
      await page.goto(`${FRONT}/session/${session.id}/lobby`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page
        .locator('button:has-text("Essential only"), button:has-text("Accept all")')
        .first()
        .click({ timeout: 2500 })
        .catch(() => {});
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${OUT}/${label}-${vp.name}-01-lobby.png`, fullPage: false });

      const ready = page.locator('button:has-text(\"Ready\")').first();
      if (await ready.count()) await ready.click({ timeout: 5000 }).catch(() => entry.notes.push('Ready click failed'));
      else entry.notes.push('no Ready button');

      const start = page
        .locator('button:has-text("Start Solo Session"), button:has-text("Start Session"), button:has-text("Start")')
        .first();
      await start.waitFor({ state: 'visible', timeout: 20000 }).catch(() => entry.notes.push('Start button never appeared'));
      if (await start.count()) await start.click({ timeout: 5000 }).catch(() => entry.notes.push('Start click failed'));

      await page
        .waitForURL(/\/(activity|reading-room|room)/, { timeout: 25000 })
        .catch(() => entry.notes.push(`no navigation into room; stuck at ${page.url()}`));
      await page.waitForTimeout(7000);
      entry.url = page.url();
      await page.screenshot({ path: `${OUT}/${label}-${vp.name}-02-room.png`, fullPage: false });
      entry.metrics = await measure(page);

      // Try a page turn / next control to see whether the core action works.
      const next = page
        .locator('button[aria-label*="next" i], button:has-text("Next")')
        .first();
      if (await next.count()) {
        await next.click({ timeout: 4000 }).catch(() => entry.notes.push('next-page click failed'));
        await page.waitForTimeout(1800);
        await page.screenshot({ path: `${OUT}/${label}-${vp.name}-03-after-next.png`, fullPage: false });
      } else {
        entry.notes.push('no next-page control found');
      }
    } catch (e) {
      entry.notes.push(`FATAL: ${String(e).slice(0, 200)}`);
    }

    report.push(entry);
    log(label, vp.name, 'errors:', entry.consoleErrors.length, 'notes:', entry.notes.join(' | ') || 'none');
    await ctx.close();
  }
}

const run = async () => {
  const tok = await tokens(process.env.BB_USER || 'demo-parent', process.env.BB_PASS || 'Demo123!');
  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  for (const cfg of [
    { label: 'reading', roomType: 'reading' },
    { label: 'activity', roomType: 'activity' },
  ]) {
    await driveRoom(browser, { ...cfg, tok }).catch((e) => {
      log('room failed:', cfg.label, String(e).slice(0, 200));
      report.push({ room: cfg.label, fatal: String(e).slice(0, 300) });
    });
  }
  await browser.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  log('done →', OUT);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
