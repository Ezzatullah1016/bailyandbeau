// Captures the page-turn animation mid-flight to verify the curl renders.
// Run from frontend/:  node e2e-flip.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const FRONT = process.env.FRONT_BASE || 'http://localhost:3010';
const API = process.env.API_BASE || 'http://127.0.0.1:8300/api/v1';
const OUT = 'e2e-shots/flip';
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[flip]', ...a);

const run = async () => {
  const res = await fetch(`${API}/auth/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo-parent', password: 'Demo123!' }),
  });
  const t = (await res.json()).data.tokens;
  const hdr = { Authorization: `Bearer ${t.access}`, 'Content-Type': 'application/json' };
  const books = (await (await fetch(`${API}/books/`, { headers: hdr })).json()).data;
  const children = (await (await fetch(`${API}/children/`, { headers: hdr })).json()).data;
  const book = books.find((b) => b.room_type !== 'activity') ?? books[0];
  const s = (await (await fetch(`${API}/sessions/`, {
    method: 'POST',
    headers: hdr,
    body: JSON.stringify({ book_id: book.id, child_profile_id: children[0].id, room_type: 'reading' }),
  })).json()).data;

  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['camera', 'microphone'],
    reducedMotion: 'no-preference',
  });
  await ctx.addInitScript(
    ([a, r, sid, pid]) => {
      localStorage.setItem('bb_access_token', a);
      localStorage.setItem('bb_refresh_token', r);
      localStorage.setItem(`bb_participant_${sid}`, pid);
      localStorage.setItem('bb_cookie_consent', 'accepted');
    },
    [t.access, t.refresh, s.id, s.host_participant_id],
  );
  const page = await ctx.newPage();
  await page.goto(`${FRONT}/session/${s.id}/lobby`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  // Click via the DOM: Playwright's has-text matcher proved brittle against the
  // em-dash in "I'm Ready — Join Session".
  const clickByText = (re) =>
    page.evaluate((src) => {
      const rx = new RegExp(src, 'i');
      const btn = [...document.querySelectorAll('button')].find((b) => rx.test(b.textContent || ''));
      if (btn) btn.click();
      return Boolean(btn);
    }, re);

  log('ready clicked:', await clickByText('Ready'));
  // Wait for the lobby LiveKit connection rather than a fixed delay — connect
  // time varies a lot once several rooms are live.
  await page
    .locator('button:has-text("Start Solo Session"), button:has-text("Start Session")')
    .first()
    .waitFor({ state: 'visible', timeout: 45000 })
    .catch(() => log('start button never appeared'));
  log('start clicked:', await clickByText('Start (Solo )?Session'));
  await page.waitForURL(/reading-room|activity/, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(7000);
  await page.screenshot({ path: `${OUT}/00-before.png` });

  const next = page.locator('button[aria-label="Next spread"]').first();
  await next.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  if (!(await next.count())) {
    log('no next control found; url =', page.url());
    await page.screenshot({ path: `${OUT}/ERROR-state.png` });
    await browser.close();
    return;
  }
  const label = () =>
    page.evaluate(() => document.body.innerText.match(/Pages? [\d–-]+ of \d+/)?.[0] ?? '?');
  log('before:', await label());
  // The turn finishes faster than screenshot granularity. Slow the whole page
  // clock via CDP so both the CSS animation and the component's unmount timer
  // stretch together — patching only the CSS duration would leave the leaf
  // removed from the DOM part-way through the rotation.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.06 });
  // Click via the DOM — the Fabric annotation canvas sits over the spread and
  // can intercept a synthetic pointer event aimed at the arrow.
  await page.evaluate(() =>
    document.querySelector('button[aria-label="Next spread"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
    ),
  );
  // The component removes the leaf 460ms after the turn regardless of the
  // animation playback rate, so all samples must land inside that window.
  // Sample across the turn to confirm the 3D transform actually runs.
  for (const n of [1, 2, 3, 4]) {
    await page.waitForTimeout(45);
    await page.screenshot({ path: OUT + "/flip-" + n + ".png" });
    log("frame", n, await page.evaluate(() => {
      const el = document.querySelector(".room-book div[style*='preserve-3d']");
      if (!el) return "no-wrapper";
      const cs = getComputedStyle(el);
      return cs.transform.slice(0, 30) + " op=" + cs.opacity;
    }));
  }
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/99-after.png` });
  log('after:', await label());
  await browser.close();
  log('done →', OUT);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
