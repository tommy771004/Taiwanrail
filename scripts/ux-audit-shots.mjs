import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const BASE = process.env.AUDIT_BASE || 'http://localhost:5180';
const OUT = path.resolve('ux-audit/screenshots');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
  tablet:  { width: 768,  height: 1024, deviceScaleFactor: 1, isMobile: false },
  mobile:  { width: 390,  height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  small:   { width: 320,  height: 720, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function shoot(page, name, full = true) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full });
  console.log('shot', name);
}

async function newPage(browser, vp, dark = false) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }]);
  page.on('console', m => { if (m.type() === 'error') console.log('  [pageerr]', m.text().slice(0,160)); });
  return page;
}

async function gotoSettle(page, url, settle = 2800) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await sleep(settle);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  // ---- 1. Home (zh, HSR default) across all breakpoints, light ----
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    const page = await newPage(browser, vp);
    await gotoSettle(page, `${BASE}/`);
    await shoot(page, `home-zh-hsr-${vpName}`);
    await page.close();
  }

  // ---- 2. Home dark mode (desktop + mobile) ----
  for (const vpName of ['desktop', 'mobile']) {
    const page = await newPage(browser, VIEWPORTS[vpName], true);
    await gotoSettle(page, `${BASE}/`);
    await shoot(page, `home-zh-dark-${vpName}`);
    await page.close();
  }

  // ---- 3. English home ----
  for (const vpName of ['desktop', 'mobile']) {
    const page = await newPage(browser, VIEWPORTS[vpName]);
    await gotoSettle(page, `${BASE}/en/`);
    await shoot(page, `home-en-${vpName}`);
    await page.close();
  }

  // ---- 4. Train (TRA) mode ----
  for (const vpName of ['desktop', 'mobile']) {
    const page = await newPage(browser, VIEWPORTS[vpName]);
    await gotoSettle(page, `${BASE}/?transport=train`);
    await shoot(page, `home-train-${vpName}`);
    await page.close();
  }

  // ---- 5. Search results + expanded card (desktop + mobile) ----
  for (const vpName of ['desktop', 'mobile']) {
    const page = await newPage(browser, VIEWPORTS[vpName]);
    await gotoSettle(page, `${BASE}/`, 3500);
    // Try to click the main search button by scanning buttons for search-ish text
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const target = btns.find(b => /查詢|搜尋|search/i.test(b.textContent || '') && b.offsetParent !== null);
      if (target) { target.click(); return target.textContent.trim().slice(0,30); }
      return null;
    });
    console.log('  search btn:', clicked);
    await sleep(4500);
    await shoot(page, `results-zh-${vpName}`);

    // Expand first train card
    const expanded = await page.evaluate(() => {
      const card = document.querySelector('[id^="train-card-"]');
      if (card) { card.click(); return true; }
      return false;
    });
    console.log('  expanded card:', expanded);
    await sleep(2500);
    await shoot(page, `results-expanded-${vpName}`);
    await page.close();
  }

  // ---- 6. Station picker modal (mobile) ----
  {
    const page = await newPage(browser, VIEWPORTS.mobile);
    await gotoSettle(page, `${BASE}/`, 3500);
    const opened = await page.evaluate(() => {
      // origin station button usually shows a station name; click first combobox-ish button in search panel
      const btns = [...document.querySelectorAll('button, [role="button"]')];
      const t = btns.find(b => /站|station/i.test(b.getAttribute('aria-label')||'') ) || btns[0];
      return false;
    });
    await page.close();
  }

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
