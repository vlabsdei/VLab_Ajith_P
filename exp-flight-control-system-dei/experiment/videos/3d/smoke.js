/* Smoke test: render one frame at the middle of each segment to _test/ for visual QA. */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const DIR = __dirname;
const OUT = path.join(DIR, '_test');
const SCENE_URL = 'file://' + path.join(DIR, 'scene.html').replace(/\\/g, '/');
const W = 1920, H = 1080;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TIMES = [2.5, 8.5, 16, 24, 31.5, 38.5, 45.5, 52.5, 58];

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: fs.existsSync(EDGE) ? EDGE : undefined,
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars',
      '--force-color-profile=srgb', `--window-size=${W},${H}`]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
  page.on('console', m => console.log('PAGE:', m.text()));
  await page.goto(SCENE_URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 60000 });
  await page.evaluate('window.__CAPTURE = true');
  for (let k = 0; k < TIMES.length; k++) {
    const t = TIMES[k];
    await page.evaluate(tt => window.__setTime(tt), t);
    await page.screenshot({ path: path.join(OUT, `seg_${k}_t${t}.png`), clip: { x: 0, y: 0, width: W, height: H }, type: 'png' });
    console.log('captured t=', t);
  }
  await browser.close();
  console.log('smoke done ->', OUT);
  process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
