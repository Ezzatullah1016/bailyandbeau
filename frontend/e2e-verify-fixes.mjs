// Verifies the fixes from the "make every control real" pass, live.
//
// This asserts behaviour rather than capturing pixels — every check below
// corresponds to a specific bug that shipped:
//
//   1. Dock ink tools appear while READING (they used to appear only inside an
//      activity, where the canvas they drive is not mounted).
//   2. Undo/Redo are disabled on a clean page and Undo enables after a stroke.
//   3. Inside an activity the ink tools are gone and the pane's own rail is the
//      tool surface.
//   4. The activity CTA is a live button, not the permanently-disabled
//      "Finished" a quiz used to end on.
//   5. Chat no longer covers the dock's primary CTA.
//
// Run: node e2e-verify-fixes.mjs      (backend :8300, frontend :3020)
import { chromium } from '@playwright/test';

const FRONT = process.env.FRONT_BASE || 'http://localhost:3020';
const API = process.env.API_BASE || 'http://127.0.0.1:8300/api/v1';
const VIEWPORT = { width: 1920, height: 928 };

const log = (...a) => console.log('[verify]', ...a);
const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
}

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
        body: JSON.stringify({
          book_id: book.id,
          child_profile_id: children[0].id,
          room_type: roomType,
        }),
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

/** The dock button carrying this label, wherever it sits (inline or overflow). */
async function dockTool(page, label) {
  const sel = `button:has(span:text-is("${label}"))`;
  const inline = page.locator(sel);
  if (await inline.count()) return inline.first();
  // Might be behind "More".
  const more = page.locator('button:has(span:text-is("More"))');
  if (await more.count()) {
    await more.first().click().catch(() => {});
    await page.waitForTimeout(400);
    const after = page.locator(sel);
    if (await after.count()) return after.first();
  }
  return null;
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

  // ── Reading room: the ink tools belong here ───────────────────────────────
  {
    const { sid, pid } = await createSession(authHdr, 'reading');
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      permissions: ['camera', 'microphone'],
    });
    await ctx.addInitScript(
      ([a, r, s, p]) => {
        localStorage.setItem('bb_access_token', a);
        localStorage.setItem('bb_refresh_token', r);
        localStorage.setItem(`bb_participant_${s}`, p);
      },
      [t.access, t.refresh, sid, pid],
    );
    const page = await enterRoom(ctx, sid);

    const pen = await dockTool(page, 'Pen');
    check('reading: Pen tool is present', Boolean(pen));

    const undo = await dockTool(page, 'Undo');
    check('reading: Undo tool is present', Boolean(undo));
    if (undo) {
      check('reading: Undo starts disabled on a clean page', await undo.isDisabled());
    }

    const redo = await dockTool(page, 'Redo');
    if (redo) check('reading: Redo starts disabled', await redo.isDisabled());

    /*
     * Drawing needs a connected room: LiveKit drops repeatedly in headless
     * Chromium here, and while it is reconnecting the canvas is disabled, so a
     * stroke never commits. Only attempt the stroke check when the room is
     * actually live, otherwise this reports an environment failure as a UI one.
     */
    const live = (await page.locator('text=/Reconnecting|Disconnected|Connecting/').count()) === 0;
    if (!live) log('SKIP — room never connected; stroke check not attempted');
    if (pen && live) {
      await pen.click().catch(() => {});
      await page.waitForTimeout(600);
      const canvas = page.locator('canvas').last();
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(1200);
      }
      // Re-resolve rather than reusing the earlier handle: Undo lives behind
      // "More" at this width, and that menu closes on an outside click (which
      // drawing on the canvas is).
      const undo2 = await dockTool(page, 'Undo');
      if (undo2) {
        const stillDisabled = await undo2.isDisabled();
        // A dropped LiveKit socket means no stroke was committed, which is an
        // environment failure rather than a UI one — say which it is.
        const banner = page.locator('text=/Reconnecting|Disconnected|Connecting/');
        const socketDown = (await banner.count()) > 0;
        check(
          'reading: Undo enables after a stroke',
          !stillDisabled,
          socketDown ? 'LiveKit socket was down — stroke never committed' : '',
        );
      }
    }

    await page.screenshot({ path: 'e2e-screens/verify-reading.png' });
    await ctx.close();
  }

  // ── Activity room: pane owns the tools; the CTA must be live ──────────────
  {
    const { sid, pid } = await createSession(authHdr, 'activity');
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      permissions: ['camera', 'microphone'],
    });
    await ctx.addInitScript(
      ([a, r, s, p]) => {
        localStorage.setItem('bb_access_token', a);
        localStorage.setItem('bb_refresh_token', r);
        localStorage.setItem(`bb_participant_${s}`, p);
      },
      [t.access, t.refresh, sid, pid],
    );
    const page = await enterRoom(ctx, sid);

    // Enter the first activity from the picker.
    const card = page.locator('button[aria-label*=":"]').first();
    if (await card.count()) {
      await card.click().catch(() => {});
      await page.waitForTimeout(3500);
    }

    const penInActivity = page.locator('button:has(span:text-is("Pen"))');
    check(
      'activity: dock ink tools are absent (canvas is the pane\'s)',
      (await penInActivity.count()) === 0,
    );

    // The primary CTA must exist and not be a dead end.
    const cta = page
      .locator(
        'button:has-text("Complete Activity"), button:has-text("Reveal Answer"), ' +
          'button:has-text("Next Question"), button:has-text("How Did We Do?"), ' +
          'button:has-text("Finish Quiz")',
      )
      .first();
    const hasCta = (await cta.count()) > 0;
    check('activity: a primary CTA is published', hasCta);
    if (hasCta) {
      const label = (await cta.innerText()).trim();
      check(
        'activity: CTA is not the old permanently-disabled "Finished"',
        !/^finished$/i.test(label),
        `label="${label}"`,
      );
    }

    // Chat must not sit on top of the CTA.
    const chat = await dockTool(page, 'Chat');
    if (chat && hasCta) {
      await chat.click().catch(() => {});
      await page.waitForTimeout(900);
      const dialog = page.locator('[role="dialog"][aria-label="Session chat"]');
      if (await dialog.count()) {
        const cb = await dialog.first().boundingBox();
        const tb = await cta.boundingBox();
        const overlaps =
          cb && tb && !(cb.y + cb.height < tb.y || tb.y + tb.height < cb.y) &&
          !(cb.x + cb.width < tb.x || tb.x + tb.width < cb.x);
        check('activity: chat does not cover the dock CTA', !overlaps);
      }
    }

    await page.screenshot({ path: 'e2e-screens/verify-activity.png' });
    await ctx.close();
  }

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    log('FAILED:', failed.map((f) => f.name).join(' | '));
    process.exitCode = 1;
  }
};

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
