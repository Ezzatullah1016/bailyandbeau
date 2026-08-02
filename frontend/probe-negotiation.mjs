// Traces LiveKit connection lifecycle across the lobby -> room transition to
// locate what closes the engine mid-negotiation.
// Run from frontend/:  node probe-negotiation.mjs
import { chromium } from '@playwright/test';

const FRONT = process.env.FRONT_BASE || 'http://localhost:3020';
const API = process.env.API_BASE || 'http://127.0.0.1:8300/api/v1';
const log = (...a) => console.log('[neg]', ...a);

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
  const kids = (await (await fetch(`${API}/children/`, { headers: hdr })).json()).data;
  const s = (
    await (
      await fetch(`${API}/sessions/`, {
        method: 'POST',
        headers: hdr,
        body: JSON.stringify({
          book_id: books[0].id,
          child_profile_id: kids[0].id,
          room_type: 'reading',
        }),
      })
    ).json()
  ).data;

  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['camera', 'microphone'],
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
  const t0 = Date.now();
  const stamp = () => String(Date.now() - t0).padStart(6);

  page.on('console', (m) => {
    const txt = m.text();
    if (/Negotiation|closed engine|ChunkLoad|RSC/.test(txt)) log(stamp(), 'CONSOLE:', txt.slice(0, 110));
  });
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) log(stamp(), 'NAVIGATED:', f.url().replace(FRONT, ''));
  });
  // Websocket lifecycle is the ground truth for what the engine is doing.
  page.on('websocket', (ws) => {
    log(stamp(), 'WS OPEN  :', ws.url().slice(0, 70));
    ws.on('close', () => log(stamp(), 'WS CLOSE :', ws.url().slice(0, 70)));
  });

  const click = (re) =>
    page.evaluate((src) => {
      const rx = new RegExp(src, 'i');
      const btn = [...document.querySelectorAll('button')].find((b) => rx.test(b.textContent || ''));
      if (btn) btn.click();
      return Boolean(btn);
    }, re);

  await page.goto(`${FRONT}/session/${s.id}/lobby`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  log(stamp(), 'clicking Ready');
  await click('Ready');
  await page
    .locator('button:has-text("Start Solo Session"), button:has-text("Start Session")')
    .first()
    .waitFor({ state: 'visible', timeout: 45000 })
    .catch(() => log('start never appeared'));
  log(stamp(), 'clicking Start');
  await click('Start (Solo )?Session');
  await page.waitForTimeout(14000);
  log(stamp(), 'final url:', page.url().replace(FRONT, ''));

  await browser.close();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
