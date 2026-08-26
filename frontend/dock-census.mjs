// The acceptance test for the dock: every screen's tool list, against the six
// client mockups. Each expected row was read directly off its PNG.
//
// Run: node dock-census.mjs   (backend :8300, frontend :3020)
import { chromium } from '@playwright/test';

const FRONT = process.env.FRONT_BASE || 'http://localhost:3020';
const API = process.env.API_BASE || 'http://127.0.0.1:8300/api/v1';
const VIEWPORT = { width: 1920, height: 928 };
const log = (...a) => console.log('[census]', ...a);

// What each mockup shows, left to right, before the primary CTA. Mic/Camera and
// the room controls that live behind "More" are not listed: this asserts the
// inline set, which is what the mockups fix.
const EXPECTED = {
  reading: ['Library', 'Pen', 'Highlight', 'Eraser', 'Reactions', 'Mic', 'Participants'],
  picker: ['Library', 'Pen', 'Highlight', 'Eraser', 'Reactions', 'Mic', 'Participants'],
  quiz: ['Select', 'Pen', 'Eraser', 'Reactions', 'Shapes', 'Undo', 'Redo'],
  drag_drop: ['Select', 'Reactions', 'Undo', 'Redo'],
  hotspot: ['Select', 'Pen', 'Eraser', 'Reactions', 'Fill', 'Shapes', 'Undo', 'Redo'],
  // Shapes and Fill are gated on the authored `allow_shapes` / `allow_fill`, so a
  // seeded activity that leaves one off legitimately shows one fewer button.
  drawing: ['Select', 'Pen', 'Eraser', 'Reactions', 'Fill', 'Shapes', 'Undo', 'Redo'],
};

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `\n        ${detail}` : ''}`);
}

async function tokens(u, p) {
  const r = await fetch(`${API}/auth/login/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  });
  const b = await r.json();
  if (!b?.data?.tokens?.access) throw new Error('login failed');
  return b.data.tokens;
}

/** Authored activity configs for a book, so the census can read its flags. */
async function activitiesFor(H, bookId) {
  const r = await fetch(`${API}/books/${bookId}/activities/`, { headers: H });
  const b = await r.json().catch(() => ({}));
  return (b?.data ?? []).map((a) => ({
    title: a.title ?? a.config?.ui?.title ?? '',
    payload: a.config?.payload ?? {},
  }));
}

async function createSession(H, roomType) {
  const books = (await (await fetch(`${API}/books/`, { headers: H })).json()).data ?? [];
  const kids = (await (await fetch(`${API}/children/`, { headers: H })).json()).data ?? [];
  const book = roomType === 'reading'
    ? (books.find((b) => b.room_type === 'reading') ?? books[0])
    : (books.find((b) => b.room_type === 'activity' || b.room_type === 'hybrid') ?? books[0]);
  const d = (await (await fetch(`${API}/sessions/`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ book_id: book.id, child_profile_id: kids[0].id, room_type: roomType }),
  })).json()).data;
  return { sid: d.id, pid: d.host_participant_id, bookId: book.id };
}

async function enterRoom(ctx, sid) {
  const page = await ctx.newPage();
  await page.goto(`${FRONT}/session/${sid}/lobby`, { waitUntil: 'domcontentloaded' });
  await page.locator('button:has-text("Essential only"), button:has-text("Accept all")')
    .first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const rd = page.locator('button:has-text("Ready")').first();
  if (await rd.count()) await rd.click().catch(() => {});
  const st = page.locator('button:has-text("Start Solo Session"), button:has-text("Start Session")').first();
  await st.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  if (await st.count()) await st.click().catch(() => {});
  await page.waitForURL(/\/(activity|reading-room)/, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(9000);
  return page;
}

/** Inline dock labels, in order. */
async function inlineTools(page) {
  return page.locator('[role="toolbar"][aria-label="Session tools"] > button span:last-child')
    // The participant-count badge is also a trailing span, so numeric-only
    // labels are dropped rather than counted as a tool.
    .evaluateAll((els) =>
      els.map((e) => (e.textContent || '').trim()).filter((s) => s && !/^\d+$/.test(s)),
    );
}

const run = async () => {
  const t = await tokens('demo-parent', 'Demo123!');
  const H = { Authorization: `Bearer ${t.access}`, 'Content-Type': 'application/json' };
  const browser = await chromium.launch({ args: [
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader',
  ]});

  const ctxFor = async (sid, pid) => {
    const ctx = await browser.newContext({ viewport: VIEWPORT, permissions: ['camera', 'microphone'] });
    await ctx.addInitScript(([a, r, s, p]) => {
      localStorage.setItem('bb_access_token', a);
      localStorage.setItem('bb_refresh_token', r);
      localStorage.setItem(`bb_participant_${s}`, p);
    }, [t.access, t.refresh, sid, pid]);
    return ctx;
  };

  // Compare as a set: inline order follows the array, and the mockups agree on
  // membership rather than on exact index.
  const compare = (screen, got, who = '', authoredOff = []) => {
    const want = EXPECTED[screen].filter((t) => !authoredOff.includes(t));
    const norm = (a) => [...a].map((s) => s.replace(/^Muted$/, 'Mic').replace(/^No cam$/, 'Camera')).sort();
    const g = norm(got), w = norm(want);
    const missing = w.filter((x) => !g.includes(x));
    const extra = g.filter((x) => !w.includes(x));
    check(`${screen}${who ? ` (${who})` : ''}: dock matches the mockup`,
      missing.length === 0 && extra.length === 0,
      missing.length || extra.length
        ? `missing=[${missing}] extra=[${extra}]\n        got=[${got}]`
        : `[${got}]`);
  };

  {
    const { sid, pid } = await createSession(H, 'reading');
    const ctx = await ctxFor(sid, pid);
    const page = await enterRoom(ctx, sid);
    compare('reading', await inlineTools(page));
    await page.screenshot({ path: 'e2e-screens/census-reading.png' });
    await ctx.close();
  }

  {
    const { sid, pid, bookId } = await createSession(H, 'activity');
    const authored = await activitiesFor(H, bookId);
    const ctx = await ctxFor(sid, pid);
    const page = await enterRoom(ctx, sid);
    compare('picker', await inlineTools(page));
    await page.screenshot({ path: 'e2e-screens/census-picker.png' });

    // Each activity card is labelled "<Type>: <Title>".
    const n = await page.locator('button[aria-label*=": "]').count();
    for (let i = 0; i < n; i++) {
      const cards = page.locator('button[aria-label*=": "]');
      const label = await cards.nth(i).getAttribute('aria-label');
      const kind = /^Story Quest/.test(label) ? 'quiz'
        : /^Place & Play/.test(label) ? 'drag_drop'
        : /^Discovery Spots/.test(label) ? 'hotspot'
        : /^Create Together/.test(label) ? 'drawing' : null;
      if (!kind) continue;
      await cards.nth(i).click().catch(() => {});
      await page.waitForTimeout(3500);
      /*
       * Shapes and Fill are authored per activity, so an activity that leaves one
       * off shows one fewer button by design. Read the flags from the API rather
       * than treating that as a mismatch.
       */
      /*
       * Only the drawing pane reads authored tool flags — its `allow_shapes`,
       * `allow_fill` and `allow_eraser`, with shapes and the eraser off unless
       * the author opted in. The ink overlay used by the quiz and hotspot panes
       * offers a fixed set, so their expectations are not filtered.
       */
      const cfg =
        kind === 'drawing'
          ? authored.find((a) => a.title && (label ?? '').includes(a.title))
          : undefined;
      const off = [];
      if (cfg) {
        if (!cfg.payload?.allow_shapes) off.push('Shapes');
        if (cfg.payload?.allow_fill === false) off.push('Fill');
        if (!cfg.payload?.allow_eraser) off.push('Eraser');
      }
      compare(kind, await inlineTools(page), label ?? '', off);
      await page.screenshot({ path: `e2e-screens/census-${kind}.png` });
      /*
       * Return to the picker by its exact label, and wait for the picker's own
       * heading before reading the next card. Matching `header button` loosely
       * hit the cover-art frame instead, so the run carried on inside the same
       * activity and reported one type's dock under another type's name.
       */
      await page.locator('button[aria-label="Back to the activity list"]').click().catch(() => {});
      await page
        .getByText('Choose Your Adventure', { exact: false })
        .waitFor({ state: 'visible', timeout: 10000 })
        .catch(() => log('WARN: never returned to the picker'));
      await page.waitForTimeout(1200);
    }
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  log(`\n${results.length - failed.length}/${results.length} screens match`);
  if (failed.length) process.exitCode = 1;
};

run().catch((e) => { console.error(e); process.exitCode = 1; });
