// Opens the reading room once per themed book and screenshots it, so the
// per-book theming (backdrop, chrome mode, accent) can be checked at a glance.
// Run from frontend/:  node e2e-themes.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const FRONT = process.env.FRONT_BASE || 'http://localhost:3010';
const API = process.env.API_BASE || 'http://127.0.0.1:8300/api/v1';
const OUT = 'e2e-shots/themes';
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[themes]', ...a);

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const run = async () => {
  const t = (
    await (
      await fetch(`${API}/auth/login/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'demo-parent', password: 'Demo123!' }),
      })
    ).json()
  ).data.tokens;
  const hdr = { Authorization: `Bearer ${t.access}`, 'Content-Type': 'application/json' };
  const books = (await (await fetch(`${API}/books/`, { headers: hdr })).json()).data;
  const children = (await (await fetch(`${API}/children/`, { headers: hdr })).json()).data;

  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });

  for (const book of books.slice(0, 3)) {
    const s = (
      await (
        await fetch(`${API}/sessions/`, {
          method: 'POST',
          headers: hdr,
          body: JSON.stringify({
            book_id: book.id,
            child_profile_id: children[0].id,
            room_type: 'reading',
          }),
        })
      ).json()
    ).data;

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
    const click = (re) =>
      page.evaluate((src) => {
        const rx = new RegExp(src, 'i');
        const btn = [...document.querySelectorAll('button')].find((b) => rx.test(b.textContent || ''));
        if (btn) btn.click();
        return Boolean(btn);
      }, re);

    page.on('response', async (r) => {
      if (!r.url().includes('/pages/')) return;
      const body = await r.json().catch(() => null);
      log('api theme =', JSON.stringify(body?.meta?.theme ?? null).slice(0, 120));
    });
    await page.goto(`${FRONT}/session/${s.id}/lobby`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await click('Ready');
    await page
      .locator('button:has-text("Start Solo Session"), button:has-text("Start Session")')
      .first()
      .waitFor({ state: 'visible', timeout: 45000 })
      .catch(() => {});
    await click('Start (Solo )?Session');
    await page.waitForURL(/reading-room|activity/, { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(7000);

    const applied = await page.evaluate(() => {
      const el = document.querySelector('.room-root');
      if (!el) return 'no room-root';
      const cs = getComputedStyle(el);
      return {
        backdrop: el.getAttribute('data-backdrop'),
        chrome: el.getAttribute('data-chrome'),
        bg1: cs.getPropertyValue('--room-bg-1').trim(),
        bg2: cs.getPropertyValue('--room-bg-2').trim(),
        ink: cs.getPropertyValue('--room-ink').trim(),
      };
    });
    log(book.title, JSON.stringify(applied));
    await page.screenshot({ path: `${OUT}/${slug(book.title)}.png` });
    await ctx.close();
  }

  await browser.close();
  log('done →', OUT);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
