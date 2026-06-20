import puppeteer from 'puppeteer';

const BASE = process.env.AUDIT_BASE || 'http://localhost:5180';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function audit(url, dark, label, clickSearch = false) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }]);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch(()=>{});
  await sleep(3000);
  if (clickSearch) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => /查詢|搜尋|search/i.test(x.textContent||'') && x.offsetParent);
      if (b) b.click();
    });
    await sleep(4500);
  }

  const rows = await page.evaluate(() => {
    // canvas-normalize any CSS color (incl. oklch) to {r,g,b,a}
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    function norm(col) {
      try {
        ctx.clearRect(0,0,1,1); ctx.fillStyle = '#000'; ctx.fillStyle = col;
        ctx.fillRect(0,0,1,1);
        const d = ctx.getImageData(0,0,1,1).data;
        return { r: d[0], g: d[1], b: d[2], a: d[3]/255 };
      } catch { return null; }
    }
    function over(fg, bg){ const a=fg.a; return { r:fg.r*a+bg.r*(1-a), g:fg.g*a+bg.g*(1-a), b:fg.b*a+bg.b*(1-a), a:1 }; }
    function lum({r,g,b}){ const f=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);}; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); }
    function ratio(a,b){ const L1=lum(a),L2=lum(b); return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); }

    const white = { r:255,g:255,b:255,a:1 };
    const out = [];
    const seen = new Set();
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) {
      const txt = n.textContent.trim();
      if (!txt) continue;
      const el = n.parentElement; if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      // nearest non-transparent bg ancestor, composited over white
      let bgEl = el, bg = white;
      const stack = [];
      while (bgEl) { stack.push(getComputedStyle(bgEl).backgroundColor); bgEl = bgEl.parentElement; }
      for (let i = stack.length - 1; i >= 0; i--) {
        const c = norm(stack[i]); if (c && c.a > 0) bg = over(c, bg);
      }
      const fg = norm(cs.color); if (!fg) continue;
      const fgO = fg.a < 1 ? over(fg, bg) : fg;
      const fs = parseFloat(cs.fontSize), fw = parseInt(cs.fontWeight)||400;
      const cr = ratio(fgO, bg);
      const large = fs >= 24 || (fs >= 18.66 && fw >= 700);
      const min = large ? 3 : 4.5;
      const cls = (typeof el.className==='string'?el.className:'').slice(0,80);
      const key = cls + '|' + cs.color + '|' + Math.round(fs) + '|' + Math.round(cr*10);
      if (seen.has(key)) continue; seen.add(key);
      if (cr < min) out.push({ cr:+cr.toFixed(2), min, fs, fw, text: txt.slice(0,28), color: cs.color, cls });
    }
    out.sort((a,b)=>a.cr-b.cr);
    return out;
  });

  await browser.close();
  console.log(`\n===== ${label} — ${rows.length} text styles below WCAG AA =====`);
  for (const r of rows.slice(0, 30)) {
    console.log(`  ${r.cr}:1 (need ${r.min}) ${r.fs}px/${r.fw} "${r.text}"`);
    console.log(`      ${r.color}  .${r.cls}`);
  }
}

await audit(`${BASE}/`, false, 'HOME light');
await audit(`${BASE}/`, true, 'HOME dark');
await audit(`${BASE}/`, false, 'RESULTS light', true);
