// Every screen this branch touched, exercised against the running app.
//
// Asserts behaviour, not pixels: routes load, controls that look live are live,
// controls with nothing behind them are gone, and the fixes from this branch
// hold. Run: node e2e-full-sweep.mjs   (backend :8300, frontend :3020)
import { chromium } from '@playwright/test';

const FRONT = process.env.FRONT_BASE || 'http://localhost:3020';
const API = process.env.API_BASE || 'http://127.0.0.1:8300/api/v1';
const VIEW = { width: 1600, height: 950 };
const log = (...a) => console.log('[sweep]', ...a);

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  log(`${pass ? 'PASS' : 'FAIL'} - ${name}${detail ? `  (${detail})` : ''}`);
}
function skip(name, why) {
  results.push({ name, pass: true, skipped: true });
  log(`SKIP - ${name}  (${why})`);
}

async function tokens(u, p) {
  const r = await fetch(`${API}/auth/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  });
  const b = await r.json();
  if (!b?.data?.tokens?.access) throw new Error(`login ${u} failed`);
  return b.data.tokens;
}

const run = async () => {
  const t = await tokens('demo-parent', 'Demo123!');
  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--enable-unsafe-swiftshader',
    ],
  });
  const ctx = await browser.newContext({ viewport: VIEW, permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(
    ([a, r]) => {
      localStorage.setItem('bb_access_token', a);
      localStorage.setItem('bb_refresh_token', r);
    },
    [t.access, t.refresh],
  );

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 160));
  });

  const go = async (path) => {
    await page.goto(`${FRONT}${path}`, { waitUntil: 'domcontentloaded' });
    await page
      .locator('button:has-text("Essential only"), button:has-text("Accept all")')
      .first()
      .click({ timeout: 2500 })
      .catch(() => {});
    /*
     * Wait for the page's own content, not a fixed delay. Every dashboard route
     * renders a full-screen spinner while it fetches, so a timed wait raced the
     * data and asserted against the loading state.
     */
    await page
      .locator('.animate-spin')
      .first()
      .waitFor({ state: 'detached', timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(1200);
  };

  // Routes load at all.
  /*
   * Markers target each page's own content, not its sidebar nav link — every
   * route's name appears in the nav on every route, so a bare `text=/Library/i`
   * matched the link and told us nothing about whether the page rendered.
   */
  const ROUTES = [
    ['/dashboard', 'text=/Recent Sessions|Start a Session|Welcome/i'],
    ['/dashboard/library', 'text=/books ·|adventures/i'],
    ['/dashboard/sessions', 'text=/Session History/i'],
    ['/dashboard/billing', 'text=/Billing & Subscription|Current Plan/i'],
    ['/dashboard/settings', 'text=/Profile|Account/i'],
    ['/privacy', 'text=/Privacy Policy/i'],
    ['/terms', 'text=/Terms of Service/i'],
    ['/onboarding/plan', 'text=/Continue to Payment|Skip for now/i'],
    ['/onboarding/child', 'text=/Age|child/i'],
  ];
  for (const [path, marker] of ROUTES) {
    await go(path);
    const ok = await page
      .locator(marker)
      .first()
      .isVisible({ timeout: 6000 })
      .catch(() => false);
    check(`route loads: ${path}`, ok);
  }

  // The stray literal committed inside the sidebar avatar's JSX.
  await go('/dashboard');
  const dashText = await page.locator('body').innerText();
  check('no stray image filename rendered on the dashboard', !dashText.includes('image.png'));

  // "View All" had no handler and no href.
  const viewAll = page.locator('a:has-text("View All"), button:has-text("View All")').first();
  if (await viewAll.count()) {
    const tag = await viewAll.evaluate((e) => e.tagName);
    const href = await viewAll.getAttribute('href');
    check(
      'View All is a real link to the sessions page',
      tag === 'A' && (href ?? '').includes('/dashboard/sessions'),
      `${tag} href=${href}`,
    );
  } else {
    check('View All is a real link to the sessions page', false, 'control not found');
  }

  // Completed rows carried an overflow button with no handler and no endpoint.
  const bareBtns = await page.locator('table button:not([aria-label])').count();
  check('no unlabelled overflow button on session rows', bareBtns === 0, `found ${bareBtns}`);

  // The favourite heart: accessible name, and it actually toggles.
  await go('/dashboard/library');
  const heartSel = 'button[aria-label*="favourites"]';
  if (await page.locator(heartSel).count()) {
    const before = await page.locator(heartSel).first().getAttribute('aria-pressed');
    await page.locator(heartSel).first().click().catch(() => {});
    await page.waitForTimeout(2200);
    const after = await page.locator(heartSel).first().getAttribute('aria-pressed');
    const toast = await page
      .locator('[role="status"]')
      .innerText()
      .catch(() => '');
    /*
     * Either outcome is correct, and both are the point of the fix: the heart
     * flips when the server accepts, and stays put *with a toast* when it does
     * not. What must never happen is a silent flip on a rejected write, which is
     * exactly what this used to do.
     */
    const flipped = before !== after;
    const refused = /could not/i.test(toast) && before === after;
    check(
      'favourite toggle either commits or reports refusal',
      flipped || refused,
      flipped ? `${before} -> ${after}` : `held at ${after}, toast=${JSON.stringify(toast)}`,
    );
    if (flipped) {
      await page.locator(heartSel).first().click().catch(() => {});
      await page.waitForTimeout(1600);
    }
  } else {
    check('favourite toggle either commits or reports refusal', false, 'no labelled heart found');
  }

  // The chip used a text glyph where the repo requires a real icon.
  const chipText = await page
    .locator('button:has-text("Favourites")')
    .first()
    .innerText()
    .catch(() => '');
  check(
    'favourites chip uses an icon rather than a text glyph',
    !chipText.includes('♥'),
    JSON.stringify(chipText),
  );

  // Copy Invite swallowed both its fetch and its clipboard failure.
  await go('/dashboard/sessions');
  const copy = page.locator('button:has-text("Copy Invite")').first();
  if (await copy.count()) {
    await copy.click().catch(() => {});
    await page.waitForTimeout(2600);
    const toast = await page
      .locator('[role="status"]')
      .innerText()
      .catch(() => '');
    check('Copy Invite reports a result either way', /copied|could not/i.test(toast), JSON.stringify(toast));
  } else {
    skip('Copy Invite reports a result either way', 'no copyable session in the seed');
  }

  // The GDPR export was an anchor to a same-origin path with no bearer token.
  await go('/dashboard/settings');
  const exportBtn = page.locator('button:has-text("Export my data")').first();
  const isButton = (await exportBtn.count()) > 0;
  check('data export is a button rather than a same-origin link', isButton);
  const resp = await fetch(`${API}/me/export/`, {
    headers: { Authorization: `Bearer ${t.access}` },
  });
  check('data export endpoint answers an authed request', resp.ok, `HTTP ${resp.status}`);

  // Deleting a child profile fired on a single click.
  const remove = page.locator('button[aria-label^="Remove "]').first();
  if (await remove.count()) {
    let asked = false;
    page.once('dialog', (d) => {
      asked = true;
      d.dismiss().catch(() => {});
    });
    await remove.click().catch(() => {});
    await page.waitForTimeout(1800);
    check('removing a child profile asks for confirmation', asked);
  } else {
    skip('removing a child profile asks for confirmation', 'no child profile in the seed');
  }

  // Checkout treated a Stripe error as success; the skip is the honest path.
  await go('/onboarding/plan');
  check('plan page offers an explicit skip', (await page.locator('button:has-text("Skip for now")').count()) > 0);

  // The emoji avatar picker sent nothing and nothing rendered a child's avatar.
  await go('/onboarding/child');
  const childText = await page.locator('body').innerText();
  check('child setup no longer shows the emoji avatar picker', !/Pick an Avatar/i.test(childText));
  check('no Help Center link, which had no route', !/Help Cent(er|re)/i.test(childText));

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  const skipped = results.filter((r) => r.skipped).length;
  log(
    `\n${results.length - failed.length - skipped}/${results.length - skipped} checks passed` +
      (skipped ? ` (${skipped} skipped)` : ''),
  );
  if (errors.length) {
    log(`\nconsole/page errors seen (${errors.length} total, unique below):`);
    [...new Set(errors)].slice(0, 8).forEach((e) => log('  -', e));
  }
  if (failed.length) {
    log('FAILED: ' + failed.map((f) => f.name).join(' | '));
    process.exitCode = 1;
  }
};

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
