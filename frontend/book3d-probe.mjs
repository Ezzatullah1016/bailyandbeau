// Which book renderer actually mounts — the R3F canvas or the static fallback?
import { chromium } from '@playwright/test';
const FRONT='http://localhost:3020', API='http://127.0.0.1:8300/api/v1';
const log=(...a)=>console.log('[book3d]',...a);

const t=await(await fetch(`${API}/auth/login/`,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({username:'demo-parent',password:'Demo123!'})})).json();
const a=t.data.tokens.access,r=t.data.tokens.refresh;
const H={Authorization:`Bearer ${a}`,'Content-Type':'application/json'};
const books=(await(await fetch(`${API}/books/`,{headers:H})).json()).data;
const kids=(await(await fetch(`${API}/children/`,{headers:H})).json()).data;
const book=books.find(b=>b.room_type==='reading')??books[0];
const s=(await(await fetch(`${API}/sessions/`,{method:'POST',headers:H,
  body:JSON.stringify({book_id:book.id,child_profile_id:kids[0].id,room_type:'reading'})})).json()).data;

// Real GPU path where available; SwiftShader only as the documented fallback.
const br=await chromium.launch({args:[
  '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
  '--enable-unsafe-swiftshader','--use-gl=angle',
]});
const ctx=await br.newContext({viewport:{width:1600,height:950},permissions:['camera','microphone']});
await ctx.addInitScript(([a,r,sid,pid])=>{localStorage.setItem('bb_access_token',a);
  localStorage.setItem('bb_refresh_token',r);localStorage.setItem(`bb_participant_${sid}`,pid);},
  [a,r,s.id,s.host_participant_id]);
const page=await ctx.newPage();
page.on('console',m=>{ if(m.type()==='error') log('ERR:',m.text().slice(0,180)); });
page.on('pageerror',e=>log('PAGEERROR:',String(e).slice(0,220)));

await page.goto(`${FRONT}/session/${s.id}/lobby`,{waitUntil:'domcontentloaded'});
await page.locator('button:has-text("Essential only"), button:has-text("Accept all")').first().click({timeout:3000}).catch(()=>{});
await page.waitForTimeout(2000);
const rd=page.locator('button:has-text("Ready")').first(); if(await rd.count()) await rd.click().catch(()=>{});
const st=page.locator('button:has-text("Start Solo Session"), button:has-text("Start Session")').first();
await st.waitFor({state:'visible',timeout:20000}).catch(()=>{}); if(await st.count()) await st.click().catch(()=>{});
await page.waitForURL(/reading-room/,{timeout:25000}).catch(()=>{});
await page.waitForTimeout(10000);

log('browser WebGL:', await page.evaluate(() => {
  try { const c=document.createElement('canvas');
    const gl=c.getContext('webgl2')||c.getContext('webgl');
    if(!gl) return 'none';
    const d=gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'ok (renderer masked)';
  } catch(e){ return 'threw: '+e.message; }
}));

const info = await page.evaluate(() => {
  const canvases = Array.from(document.querySelectorAll('canvas'));
  return {
    canvasCount: canvases.length,
    canvases: canvases.map((c) => ({
      cls: c.className || '(none)',
      w: c.width, h: c.height,
      // A live R3F canvas has a WebGL context attached.
      gl: (() => { try { return Boolean(c.getContext('webgl2') || c.getContext('webgl')); } catch { return 'err'; } })(),
    })),
    // The static fallback renders <img> page scans instead.
    fallbackImgs: document.querySelectorAll('img[alt^="Page"]').length,
  };
});
log('DOM:', JSON.stringify(info, null, 2));

// Did the page PNGs actually load in the browser?
const imgs = await page.evaluate(async () => {
  const urls = [...document.querySelectorAll('*')].length; // touch DOM
  const probe = 'http://127.0.0.1:8300/media/book-pages/';
  const entries = performance.getEntriesByType('resource')
    .filter((e) => e.name.includes('/media/book-pages/'))
    .map((e) => ({ name: e.name.split('/').pop(), size: e.transferSize, dur: Math.round(e.duration) }));
  return { count: entries.length, entries: entries.slice(0, 6), probe, urls };
});
log('page-image requests:', JSON.stringify(imgs, null, 2));
await page.screenshot({ path: 'e2e-screens/book3d-probe.png' });
await br.close();
