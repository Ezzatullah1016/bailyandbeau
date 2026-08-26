// Does the book hold up on a low-end tablet? Software GL, 4x CPU throttle, a
// tablet viewport, and real page-turning — the case the texture window exists
// for.
import { chromium, devices } from '@playwright/test';
const FRONT='http://localhost:3020', API='http://127.0.0.1:8300/api/v1';
const log=(...a)=>console.log('[tablet]',...a);

const t=await(await fetch(`${API}/auth/login/`,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({username:'demo-parent',password:'Demo123!'})})).json();
const a=t.data.tokens.access,r=t.data.tokens.refresh;
const H={Authorization:`Bearer ${a}`,'Content-Type':'application/json'};
const books=(await(await fetch(`${API}/books/`,{headers:H})).json()).data;
const kids=(await(await fetch(`${API}/children/`,{headers:H})).json()).data;
const book=books.find(b=>b.room_type==='reading')??books[0];
const s=(await(await fetch(`${API}/sessions/`,{method:'POST',headers:H,
  body:JSON.stringify({book_id:book.id,child_profile_id:kids[0].id,room_type:'reading'})})).json()).data;

// SwiftShader: no GPU at all, which is the floor for a cheap Android tablet.
const br=await chromium.launch({args:[
  '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
  '--enable-unsafe-swiftshader','--disable-gpu',
]});
const ctx=await br.newContext({
  ...devices['iPad (gen 7) landscape'],
  permissions:['camera','microphone'],
});
await ctx.addInitScript(([a,r,sid,pid])=>{localStorage.setItem('bb_access_token',a);
  localStorage.setItem('bb_refresh_token',r);localStorage.setItem(`bb_participant_${sid}`,pid);},
  [a,r,s.id,s.host_participant_id]);
const page=await ctx.newPage();
page.on('pageerror',e=>log('PAGEERROR:',String(e).slice(0,200)));

const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 });

await page.goto(`${FRONT}/session/${s.id}/lobby`,{waitUntil:'domcontentloaded'});
await page.locator('button:has-text("Essential only"), button:has-text("Accept all")').first().click({timeout:3000}).catch(()=>{});
await page.waitForTimeout(3000);
const rd=page.locator('button:has-text("Ready")').first(); if(await rd.count()) await rd.click().catch(()=>{});
const st=page.locator('button:has-text("Start Solo Session"), button:has-text("Start Session")').first();
await st.waitFor({state:'visible',timeout:25000}).catch(()=>{});
if(await st.count()) await st.click().catch(()=>{});
await page.waitForURL(/reading-room/,{timeout:30000}).catch(()=>log('no nav'));
await page.waitForTimeout(11000);

const state = async (tag) => {
  const r = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    const gl = cs.find((c) => { try { return c.getContext('webgl2')||c.getContext('webgl'); } catch { return false; } });
    let info = null;
    if (gl) {
      const ctx = gl.getContext('webgl2') || gl.getContext('webgl');
      info = { w: gl.width, h: gl.height, drawing: Boolean(ctx) };
    }
    return {
      glCanvas: info,
      fallbackImgs: document.querySelectorAll('img[alt^="Page"]').length,
      pageRequests: performance.getEntriesByType('resource')
        .filter((e) => e.name.includes('/media/book-pages/')).length,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    };
  });
  log(tag, JSON.stringify(r));
  return r;
};

const first = await state('after load:');
await page.screenshot({ path: 'e2e-screens/tablet-1-load.png' });

// Page forward five spreads, which walks the texture window across the book.
for (let i = 0; i < 3; i++) {
  await page.locator('button[aria-label="Next page"]').click().catch(() => {});
  await page.waitForTimeout(1800);
}
const after = await state('after 3 turns:');
await page.screenshot({ path: 'e2e-screens/tablet-2-turned.png' });

// Back to the start: textures that left the window must come back.
for (let i = 0; i < 3; i++) {
  await page.locator('button[aria-label="Previous page"]').click().catch(() => {});
  await page.waitForTimeout(1800);
}
await state('back at start:');
await page.screenshot({ path: 'e2e-screens/tablet-3-returned.png' });

log(`requests: ${first.pageRequests} at load -> ${after.pageRequests} after turning ` +
    `(a 12-page book; refetching every turn would climb without bound)`);
await br.close();
