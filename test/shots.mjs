// Screenshots of the empty, ?demo=1 and 3-contract states at 1440 and 375. Usage: BASE_URL=... node test/shots.mjs <outdir>
import puppeteer from 'puppeteer-core'; import fs from 'node:fs';
const BASE = process.env.BASE_URL, out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const w of [1440, 375]) {
  const vp = w === 375 ? { width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { width: 1440, height: 900 };
  let p = await b.newPage(); await p.setViewport(vp); await p.goto(BASE + '/?asof=2026-10-19'); await sleep(1800); await p.screenshot({ path: `${out}/empty-${w}.png` }); await p.close();
  p = await b.newPage(); await p.setViewport(vp); await p.goto(BASE + '/?demo=1&asof=2026-10-19'); await p.waitForFunction(() => !document.querySelector('#answer').hidden); await sleep(2200); await p.screenshot({ path: `${out}/demo-${w}.png` });
  await p.click('#trySecond'); await p.waitForFunction(() => /2 contracts/.test(document.querySelector('#status').textContent)); await p.click('#trySecond'); await p.waitForFunction(() => /3 contracts/.test(document.querySelector('#status').textContent)); await sleep(1500);
  await p.screenshot({ path: `${out}/three-${w}.png` }); await p.close(); }
await b.close();
