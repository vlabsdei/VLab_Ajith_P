/* Capture harness: renders scene.html to frames/frame_%05d.png deterministically.
   Usage: node capture.js  (run from this directory)                              */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const FRAMES = path.join(DIR, 'frames');
const SCENE_URL = 'file://' + path.join(DIR, 'scene.html').replace(/\\/g, '/');
const WIDTH = 1920, HEIGHT = 1080;

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
function findEdge() { for (const p of EDGE_CANDIDATES) { try { if (fs.existsSync(p)) return p; } catch (e) {} } return null; }

function pad(n, w) { return String(n).padStart(w, '0'); }

(async () => {
  if (!fs.existsSync(FRAMES)) fs.mkdirSync(FRAMES, { recursive: true });
  // clear any stale frames
  for (const f of fs.readdirSync(FRAMES)) { if (/^frame_\d+\.png$/.test(f)) fs.unlinkSync(path.join(FRAMES, f)); }

  const edge = findEdge();
  const launchOpts = {
    headless: 'new',
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars',
      '--force-color-profile=srgb', `--window-size=${WIDTH},${HEIGHT}`
    ]
  };
  if (edge) { launchOpts.executablePath = edge; console.log('Using Edge:', edge); }
  else { console.log('Edge not found — using puppeteer bundled Chromium'); }

  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
  page.on('console', m => { const t = m.text(); if (/error|fail|undefined/i.test(t)) console.log('PAGE:', t); });

  console.log('Loading scene:', SCENE_URL);
  await page.goto(SCENE_URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 60000 });

  const FPS = await page.evaluate('window.__FPS');
  const TOTAL = await page.evaluate('window.__TOTAL_FRAMES');
  const DUR = await page.evaluate('window.__DURATION');
  console.log(`Ready. FPS=${FPS} TOTAL=${TOTAL} DURATION=${DUR}s`);

  await page.evaluate('window.__CAPTURE = true');

  const clip = { x: 0, y: 0, width: WIDTH, height: HEIGHT };
  const t0 = Date.now();
  for (let i = 0; i < TOTAL; i++) {
    const t = i / FPS;
    await page.evaluate(tt => window.__setTime(tt), t);
    await page.screenshot({ path: path.join(FRAMES, `frame_${pad(i, 5)}.png`), clip, type: 'png' });
    if (i % 100 === 0 || i === TOTAL - 1) {
      const el = (Date.now() - t0) / 1000;
      const rate = (i + 1) / el;
      const eta = (TOTAL - i - 1) / rate;
      console.log(`frame ${i + 1}/${TOTAL}  ${el.toFixed(1)}s  ${rate.toFixed(1)} fps  ETA ${eta.toFixed(0)}s`);
    }
  }
  const secs = (Date.now() - t0) / 1000;
  console.log(`Done: ${TOTAL} frames in ${secs.toFixed(1)}s`);
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
