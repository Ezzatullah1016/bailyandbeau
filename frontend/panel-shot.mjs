/** Opens the session panel and checks it for theming, overflow and duplicates. */
import { chromium } from 'playwright';

const BASE = process.env.BB_BASE || 'http://localhost:3020';
const b = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--enable-unsafe-swiftshader',
  ],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text());
});

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
  [...document.querySelectorAll('button')].find((b) => /accept all/i.test(b.textContent))?.click();
});
await p.waitForTimeout(600);
await p.evaluate(() => {
  [...document.querySelectorAll('button,a')]
    .find((x) => /^start session$/i.test(x.textContent.trim()))
    ?.click();
});
await p.waitForTimeout(1500);
await p.evaluate(() => {
  const s = document.querySelector('select');
  const o = [...s.options].find((o) => /moonlight/i.test(o.textContent));
  const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  set.call(s, o.value);
  s.dispatchEvent(new Event('change', { bubbles: true }));
});
await p.waitForTimeout(600);
await p.evaluate(() => {
  const o = document.querySelector('.fixed.inset-0');
  [...(o || document).querySelectorAll('button')]
    .find((b) => /start session/i.test(b.textContent))
    ?.click();
});
await p.waitForTimeout(9000);
for (let i = 0; i < 8; i++) {
  if (/reading-room/.test(p.url())) break;
  await p.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /ready|start|join/i.test(b.textContent))?.click();
  });
  await p.waitForTimeout(3500);
}
await p.waitForTimeout(9000);

// Open the panel from the rail's People button.
await p.evaluate(() => {
  [...document.querySelectorAll('button')]
    .find((b) => /people in this session/i.test(b.getAttribute('aria-label') || ''))
    ?.click();
});
await p.waitForTimeout(1800);

const probe = await p.evaluate(() => {
  const panel = document.querySelector('[role="dialog"]');
  if (!panel) return { found: false };
  const tiles = [...panel.querySelectorAll('.aspect-square')];
  const shapes = tiles.slice(0, 4).map((t) => {
    const r = t.getBoundingClientRect();
    return `${Math.round(r.width)}x${Math.round(r.height)}`;
  });
  const labels = [...panel.querySelectorAll('button')].map(
    (b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 24),
  );
  return {
    found: true,
    bg: getComputedStyle(panel).backgroundColor,
    panelOverflowX: panel.scrollWidth > panel.clientWidth + 1,
    scrollerOverflowX: [...panel.querySelectorAll('*')].some(
      (el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible',
    ),
    tiles: tiles.length,
    shapes,
    buttons: labels.filter(Boolean),
  };
});

console.log(JSON.stringify(probe, null, 1));
console.log('console errors:', errs.filter((e) => !/DataChannel|Abort handler|signal request/.test(e)).length);
await p.screenshot({ path: 'e2e-shots/panel.png' });
await b.close();
