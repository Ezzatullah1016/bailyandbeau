/**
 * Drives a real reading session and inspects the 3D book.
 *
 * Checks the things that can only be verified in a browser: that WebGL actually
 * initialises, that the book fills the stage, that the control count is down,
 * and that no console errors appear during a page turn.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3020';
const OUT = 'e2e-shots/book3d';
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
];

const run = async () => {
  // Headless Chromium has no camera or microphone, and the lobby gates entry on
  // a media check. Fake devices let the session start; they also silence the
  // LiveKit DataChannel errors that a device-less browser otherwise emits.
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--enable-unsafe-swiftshader',
    ],
  });
  const results = [];

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));

    try {
      // Log in.
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
      await page.fill('input[placeholder="Your username"]', 'demo-parent');
      await page.fill('input[placeholder="Your password"]', 'Demo123!');
      await Promise.all([
        page.waitForURL(/dashboard/, { timeout: 30000 }),
        page.evaluate(() => {
          const btn = [...document.querySelectorAll('button')]
            .filter((b) => b.textContent?.trim() === 'Sign In')
            .pop();
          btn?.click();
        }),
      ]);

      // Dismiss the cookie banner — it overlays the page and swallows clicks.
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) =>
          /accept all|essential only/i.test(b.textContent || ''),
        );
        btn?.click();
      });
      await page.waitForTimeout(600);

      // "Start Session" opens a modal to pick a book and child; the second
      // button of the same name inside it actually creates the session.
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button, a')].find((b) =>
          /^start session$/i.test((b.textContent || '').trim()),
        );
        btn?.click();
      });
      await page.waitForTimeout(1200);

      // The modal uses native <select>s. The book choice decides the room:
      // "Colour Adventure" is an activity book and routes to /activity, so pick
      // a reading book explicitly rather than accepting the default.
      const picked = await page.evaluate(() => {
        const select = document.querySelector('select');
        if (!select) return 'no select';
        // Only "Moonlight Bedtime" is room_type='reading'. "Little Shapes" is
        // 'hybrid' and "Colour Adventure" is 'activity' — both route to the
        // activity room, not the reading room.
        const option = [...select.options].find((o) =>
          /moonlight bedtime/i.test(o.textContent || ''),
        );
        if (!option) return `no reading book in: ${[...select.options].map((o) => o.textContent).join('|')}`;
        // Assigning .value directly does not update React's controlled state —
        // go through the native setter so React's onChange sees the change.
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLSelectElement.prototype,
          'value',
        )?.set;
        setter?.call(select, option.value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return `picked ${option.textContent}`;
      });
      if (picked.startsWith('no ')) throw new Error(picked);
      await page.waitForTimeout(600);

      // Click the button inside the modal overlay specifically — the dashboard
      // has its own "Start Session" behind the backdrop, which intercepts
      // pointer events and makes a plain locator click time out.
      await Promise.all([
        page.waitForURL(/\/session\/[^/]+\/(lobby|reading-room)/, { timeout: 30000 }),
        page.evaluate(() => {
          const overlay = document.querySelector('.fixed.inset-0.z-\\[100\\]');
          const scope = overlay ?? document;
          const btn = [...scope.querySelectorAll('button')].find((b) =>
            /start session/i.test(b.textContent || ''),
          );
          btn?.click();
        }),
      ]);

      // Through the lobby. The primary button changes label in place
      // ("I'm Ready — Join Session" then a start action), so re-read the DOM
      // between clicks rather than assuming two distinct buttons.
      await page.waitForTimeout(2500);
      if (page.url().includes('/lobby')) {
        await page.waitForTimeout(4000);

        for (let attempt = 0; attempt < 8; attempt++) {
          if (/\/(reading-room|activity)$/.test(new URL(page.url()).pathname)) break;
          await page.evaluate(() => {
            const btn = [...document.querySelectorAll('button')].find((b) =>
              /ready|start|join|begin/i.test(b.textContent || ''),
            );
            btn?.click();
          });
          await page.waitForTimeout(3500);
        }
      }

      if (!page.url().includes('reading-room')) {
        throw new Error(`did not reach reading room, at ${page.url()}`);
      }

      // Let three.js boot and textures land.
      await page.waitForTimeout(9000);

      const probe = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        const gl =
          canvas &&
          (canvas.getContext('webgl2') || canvas.getContext('webgl'));
        const vpArea = window.innerWidth * window.innerHeight;
        const r = canvas?.getBoundingClientRect();

        const controls = [...document.querySelectorAll('button, [role="button"]')].filter(
          (el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== 'hidden' &&
              style.display !== 'none' &&
              Number(style.opacity) > 0.05
            );
          },
        );

        const tooSmall = controls.filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width < 44 || rect.height < 44;
        });

        return {
          hasCanvas: Boolean(canvas),
          webgl: Boolean(gl),
          canvasPct: r ? Math.round(((r.width * r.height) / vpArea) * 100) : 0,
          controls: controls.length,
          tooSmall: tooSmall.length,
          smallLabels: tooSmall
            .slice(0, 6)
            .map((el) => el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 22)),
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });

      await page.screenshot({ path: `${OUT}/${vp.name}-book.png` });

      // Turn a page and watch for errors during the animation.
      const beforeTurn = errors.length;
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find(
          (b) => b.getAttribute('aria-label') === 'Next page',
        );
        btn?.click();
      });
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `${OUT}/${vp.name}-turned.png` });

      const mem = await page.evaluate(() => {
        // Reported by three's renderer if it is reachable on the canvas.
        const c = document.querySelector('canvas');
        return c ? { w: c.width, h: c.height } : null;
      });

      results.push({
        vp: vp.name,
        ...probe,
        turnErrors: errors.length - beforeTurn,
        errors: errors.length,
        firstErrors: errors.slice(0, 3),
        mem,
      });
    } catch (err) {
      results.push({ vp: vp.name, fatal: String(err).slice(0, 200), errors: errors.length, firstErrors: errors.slice(0, 3) });
    }

    await ctx.close();
  }

  await browser.close();

  console.log('\nvp      | canvas | webgl | canvas% | ctrls | <44 | errs | turnErrs');
  console.log('--------|--------|-------|---------|-------|-----|------|---------');
  for (const r of results) {
    if (r.fatal) {
      console.log(`${r.vp.padEnd(7)} | FATAL: ${r.fatal}`);
      if (r.firstErrors?.length) r.firstErrors.forEach((e) => console.log('    err:', e.slice(0, 150)));
      continue;
    }
    console.log(
      `${r.vp.padEnd(7)} | ${String(r.hasCanvas).padEnd(6)} | ${String(r.webgl).padEnd(5)} | ${String(r.canvasPct).padEnd(7)} | ${String(r.controls).padEnd(5)} | ${String(r.tooSmall).padEnd(3)} | ${String(r.errors).padEnd(4)} | ${r.turnErrors}`,
    );
    if (r.smallLabels?.length) console.log('    small:', r.smallLabels.join(' · '));
    if (r.firstErrors?.length) r.firstErrors.forEach((e) => console.log('    err:', e.slice(0, 160)));
    if (r.overflow) console.log('    ⚠ horizontal overflow');
  }
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
