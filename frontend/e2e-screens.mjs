// Captures the six screens the client mocked up, at the exact viewport their
// exports were taken at (1920x928), so each shot can be diffed against its PNG.
//
// Run: node e2e-screens.mjs      (backend :8300, frontend :3020)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const FRONT = process.env.FRONT_BASE || 'http://localhost:3020';
const API = process.env.API_BASE || 'http://127.0.0.1:8300/api/v1';
const OUT = 'e2e-screens';
mkdirSync(OUT, { recursive: true });

// The client's exports are 1920x928 of *content*; matching it exactly is what
// makes the pixel diff meaningful.
const VIEWPORT = { width: 1920, height: 928 };

const log = (...a) => console.log('[screens]', ...a);
const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  log('shot:', name);
};

async function tokens(username, password) {
  const res = await fetch(`${API}/auth/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const b = await res.json();
  if (!b?.data?.tokens?.access) throw new Error(`login ${username} failed`);
  return b.data.tokens;
}

async function createSession(authHdr, roomType) {
  const books = (await (await fetch(`${API}/books/`, { headers: authHdr })).json()).data ?? [];
  const children = (await (await fetch(`${API}/children/`, { headers: authHdr })).json()).data ?? [];
  const book =
    roomType === 'reading'
      ? (books.find((b) => b.room_type === 'reading') ?? books[0])
      : (books.find((b) => b.room_type === 'activity' || b.room_type === 'hybrid') ?? books[0]);
  const created = (
    await (
      await fetch(`${API}/sessions/`, {
        method: 'POST',
        headers: authHdr,
        body: JSON.stringify({ book_id: book.id, child_profile_id: children[0].id, room_type: roomType }),
      })
    ).json()
  ).data;
  log('session', created.id, book.title, roomType);
  return { sid: created.id, pid: created.host_participant_id, book };
}

/** Lobby → Ready → Start, landing in the room with LiveKit connected. */
async function enterRoom(ctx, sid) {
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') log('ERR:', m.text().slice(0, 160));
  });
  await page.goto(`${FRONT}/session/${sid}/lobby`, { waitUntil: 'domcontentloaded' });
  await page
    .locator('button:has-text("Essential only"), button:has-text("Accept all")')
    .first()
    .click({ timeout: 3000 })
    .catch(() => {});
  await page.waitForTimeout(2500);

  const ready = page.locator('button:has-text("Ready")').first();
  if (await ready.count()) await ready.click().catch(() => {});

  const start = page
    .locator('button:has-text("Start Solo Session"), button:has-text("Start Session")')
    .first();
  await start.waitFor({ state: 'visible', timeout: 20000 }).catch(() => log('no start button'));
  if (await start.count()) await start.click().catch(() => {});

  await page
    .waitForURL(/\/(activity|reading-room)/, { timeout: 25000 })
    .catch(() => log('no nav; url=' + page.url()));
  // A session holds a LiveKit socket open, so `networkidle` never fires.
  await page.waitForTimeout(9000);
  return page;
}

const run = async () => {
  const t = await tokens('demo-parent', 'Demo123!');
  const authHdr = { Authorization: `Bearer ${t.access}`, 'Content-Type': 'application/json' };

  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--enable-unsafe-swiftshader',
    ],
  });

  // ── Reading room ──────────────────────────────────────────────────────────
  {
    const { sid, pid } = await createSession(authHdr, 'reading');
    const ctx = await browser.newContext({ viewport: VIEWPORT, permissions: ['camera', 'microphone'] });
    await ctx.addInitScript(
      ([a, r, s, p]) => {
        localStorage.setItem('bb_access_token', a);
        localStorage.setItem('bb_refresh_token', r);
        localStorage.setItem(`bb_participant_${s}`, p);
      },
      [t.access, t.refresh, sid, pid],
    );
    const page = await enterRoom(ctx, sid);
    await shot(page, '1-reading-room');
    await ctx.close();
  }

  // ── Activity room: picker, then each of the four panes ────────────────────
  {
    const { sid, pid } = await createSession(authHdr, 'activity');
    const ctx = await browser.newContext({ viewport: VIEWPORT, permissions: ['camera', 'microphone'] });
    await ctx.addInitScript(
      ([a, r, s, p]) => {
        localStorage.setItem('bb_access_token', a);
        localStorage.setItem('bb_refresh_token', r);
        localStorage.setItem(`bb_participant_${s}`, p);
      },
      [t.access, t.refresh, sid, pid],
    );
    const page = await enterRoom(ctx, sid);
    await shot(page, '2-activity-list');

    const wanted = [
      ['Story Quest', '3-story-quest'],
      ['Place & Play', '4-place-play'],
      ['Discovery Spots', '5-discovery-spots'],
      ['Create Together', '6-create-together'],
    ];
    for (const [label, name] of wanted) {
      // The filter pills carry the same words as the cards, so matching on the
      // label alone hit a pill and never opened anything. Cards are labelled
      // "<Type>: <Activity title>", so anchor on that shape.
      const card = page
        .getByRole('button', {
          name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}:\\s`, 'i'),
        })
        .first();
      if (!(await card.count())) {
        log('card not found:', label);
        continue;
      }
      await card.click({ force: true }).catch(() => {});
      await page.waitForTimeout(3500);

      // Discovery Spots is mocked up with a spot already open, so open one.
      if (name.includes('discovery')) {
        const spot = page.getByRole('button', { name: /discovery spot|spot \d/i }).first();
        if (await spot.count()) {
          await spot.click({ force: true }).catch(() => {});
          await page.waitForTimeout(1200);
        }
      }

      await shot(page, name);

      const back = page.getByRole('button', { name: /back to the activity list/i }).first();
      if (await back.count()) {
        await back.click().catch(() => {});
        await page.waitForTimeout(2500);
      } else {
        log('no back button after', name);
      }
    }
    await ctx.close();
  }

  await browser.close();
  log('done →', OUT);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
