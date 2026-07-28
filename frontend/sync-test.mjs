/**
 * Two-browser check: does a host page turn land the guest on the same page?
 *
 * This is where a leaf-vs-spread index mix-up would surface as a silent
 * off-by-one — the 3D book counts leaves (cover included) while the wire
 * protocol counts spreads — so it is verified rather than assumed.
 */
import { chromium } from 'playwright';

// stdout is redirected to a file when this runs in the background, which makes
// node buffer it — a run that is killed on timeout then reports nothing at all.
// Flush every line so partial progress survives.
const log = (...a) => {
  process.stdout.write(`${a.join(' ')}\n`);
};

const BASE = process.env.BB_BASE || 'http://localhost:3020';
const ARGS = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--enable-unsafe-swiftshader',
];

const login = async (ctx) => {
  const p = await ctx.newPage();
  // Not 'networkidle': with two contexts and a live LiveKit socket the network
  // never goes idle, so that condition just burns the timeout.
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[placeholder="Your username"]', { timeout: 30000 });
  await p.fill('input[placeholder="Your username"]', 'demo-parent');
  await p.fill('input[placeholder="Your password"]', 'Demo123!');
  await Promise.all([
    p.waitForURL(/dashboard/, { timeout: 40000 }),
    p.evaluate(() => {
      [...document.querySelectorAll('button')]
        .filter((x) => x.textContent.trim() === 'Sign In')
        .pop()
        ?.click();
    }),
  ]);
  await p.waitForTimeout(2500);
  await p.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((b) => /accept all/i.test(b.textContent))
      ?.click();
  });
  return p;
};

const readPage = (pg) =>
  pg.evaluate(() => {
    const m = document.body.innerText.match(/Page (\d+) of (\d+)/);
    if (m) return `${m[1]}/${m[2]}`;
    const n = document.body.innerText.match(/(\d+)\s*\/\s*(\d+)/);
    return n ? n[0] : 'unknown';
  });

const browser = await chromium.launch({ args: ARGS });

const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const host = await login(hostCtx);

await host.evaluate(() => {
  [...document.querySelectorAll('button, a')]
    .find((x) => /^start session$/i.test(x.textContent.trim()))
    ?.click();
});
await host.waitForTimeout(1500);
await host.evaluate(() => {
  const s = document.querySelector('select');
  const o = [...s.options].find((o) => /moonlight/i.test(o.textContent));
  const set = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    'value',
  ).set;
  set.call(s, o.value);
  s.dispatchEvent(new Event('change', { bubbles: true }));
});
await host.waitForTimeout(600);
await host.evaluate(() => {
  const o = document.querySelector('.fixed.inset-0');
  [...(o || document).querySelectorAll('button')]
    .find((b) => /start session/i.test(b.textContent))
    ?.click();
});
await host.waitForTimeout(8000);

for (let i = 0; i < 8; i++) {
  if (/reading-room/.test(host.url())) break;
  await host.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((b) => /ready|start|join/i.test(b.textContent))
      ?.click();
  });
  await host.waitForTimeout(3500);
}
await host.waitForTimeout(9000);
log('host reached:', /reading-room/.test(host.url()) ? 'reading-room' : host.url());

const sessionId = host.url().match(/session\/([^/]+)/)?.[1];

// Second page in the SAME context, reusing the host's auth. A fresh context
// means a second login, a second WebGL context and a second LiveKit connection,
// which starves this machine and times out before the guest ever loads. What
// matters for this test is a distinct participant page receiving PAGE_TURN, and
// a second tab is exactly that.
const guest = await hostCtx.newPage();
await guest.goto(`${BASE}/session/${sessionId}/reading-room`, {
  waitUntil: 'domcontentloaded',
});
// Wait for the guest's book to actually render rather than a fixed sleep.
await guest
  .waitForFunction(() => /Page \d+ of \d+/.test(document.body.innerText), { timeout: 60000 })
  .catch(() => log('guest book did not render within 60s'));

log('before turn — host:', await readPage(host), '| guest:', await readPage(guest));

let matches = 0;
for (const n of [1, 2, 3]) {
  await host.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((b) => b.getAttribute('aria-label') === 'Next page')
      ?.click();
  });
  await host.waitForTimeout(3000);
  const h = await readPage(host);
  const g = await readPage(guest);
  const ok = h === g;
  if (ok) matches++;
  log(`after turn ${n} — host: ${h}  guest: ${g}  ${ok ? 'MATCH' : 'MISMATCH'}`);
}

log(matches === 3 ? 'PASS: host and guest stayed in sync' : `FAIL: ${3 - matches} mismatch(es)`);

await host.screenshot({ path: 'e2e-shots/sync-host.png' });
await guest.screenshot({ path: 'e2e-shots/sync-guest.png' });
await browser.close();
