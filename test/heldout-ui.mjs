import puppeteer from 'puppeteer-core';
const BASE = process.env.BASE_URL; const files = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
for (const f of files) { const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 }); await p.goto(BASE + '/?asof=2026-10-19');
  await (await p.$('#file')).uploadFile(f);
  try { await p.waitForFunction(() => /^Read |Could not/.test(document.querySelector('#status').textContent), { timeout: 30000 }); } catch {}
  const r = await p.evaluate(() => { const a = document.querySelector('#answer'); return { st: document.querySelector('#status').textContent, name: a?.querySelector('.iname')?.textContent, b: a && !a.hidden ? [...a.querySelectorAll('.aleft > .lab, .hero-date, .wd, .cons, .next, .chip')].map(x => x.textContent.trim()).join(' | ') : '' }; });
  console.log('##', f.split('/').pop(), '|', r.name, '|', r.b.slice(0, 260)); await p.close(); }
await browser.close();
