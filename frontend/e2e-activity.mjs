// Drives the Activity Room at three viewports and screenshots the picker plus
// one live activity, so the activity experience can be reviewed alongside the
// reading room. Run from frontend/:  node e2e-activity.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const FRONT = process.env.FRONT_BASE || 'http://localhost:3010';
const API = process.env.API_BASE || 'http://127.0.0.1:8300/api/v1';
const OUT = 'e2e-shots/activity';
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[activity]', ...a);

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

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
  const book = books.find((b) => b.room_type === 'activity' || b.room_type === 'hybrid') ?? books[0];

  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });

  for (const vp of VIEWPORTS) {
    const s = (
      await (
        await fetch(`${API}/sessions/`, {
          method: 'POST',
          headers: hdr,
          body: JSON.stringify({
            book_id: book.id,
            child_profile_id: children[0].id,
            room_type: 'activity',
          }),
        })
      ).json()
    ).data;

    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      permissions: ['camera', 'microphone'],
      isMobile: vp.name === 'mobile',
      hasTouch: vp.name !== 'desktop',
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
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 120)));

    const click = (re) =>
      page.evaluate((src) => {
        const rx = new RegExp(src, 'i');
        const btn = [...document.querySelectorAll('button')].find((b) => rx.test(b.textContent || ''));
        if (btn) btn.click();
        return Boolean(btn);
      }, re);

    await page.goto(`${FRONT}/session/${s.id}/lobby`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await click('Ready');
    await page
      .locator('button:has-text("Start Solo Session"), button:has-text("Start Session")')
      .first()
      .waitFor({ state: 'visible', timeout: 45000 })
      .catch(() => {});
    await click('Start (Solo )?Session');
    await page.waitForURL(/activity|reading-room/, { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(7000);
    await page.screenshot({ path: `${OUT}/${vp.name}-01-picker.png` });

    // Enter the first activity so the activity card itself is captured too.
    const picked = await page.evaluate(() => {
      const card = document.querySelector('button[aria-label*=":"]');
      if (!card) return false;
      card.click();
      return true;
    });
    if (picked) {
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${OUT}/${vp.name}-02-activity.png` });
    }

    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const btns = [...document.querySelectorAll('button, [role="button"], a[href]')].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 4 && r.height > 4 && r.top < innerHeight && r.left < innerWidth;
      });
      return {
        hScroll: de.scrollWidth > de.clientWidth + 2,
        controls: btns.length,
        small: btns.filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width < 44 || r.height < 44;
        }).length,
        entered: Boolean(document.querySelector('.room-activity-card')),
      };
    });
    log(vp.name, JSON.stringify(m), 'errors:', errors.length);
    await ctx.close();
  }

  await browser.close();
  log('done →', OUT);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
