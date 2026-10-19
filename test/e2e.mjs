// Puppeteer e2e. Usage: BASE_URL=https://contract-cliffs.vercel.app node test/e2e.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const BASE = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const SHOTS = process.env.SHOTS || '';
const UA = 'Amy Zhuang amyzhuang111@gmail.com'; // SEC fair-access User-Agent for link checks
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m); } };
const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-dl-'));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
page.on('requestfailed', r => errors.push('requestfailed ' + r.url()));
await page.setViewport({ width: 1440, height: 1000 });
const cdp = await page.createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
await page.goto(BASE + '/?asof=2026-10-19', { waitUntil: 'networkidle0' });
const edgar = await (await fetch(BASE + '/data/edgar.json')).json();
ok(edgar.length >= 8 && edgar.length <= 12, `real set has ${edgar.length} contracts (8-12)`);
await page.waitForSelector('#queue li');
ok(await page.$eval('#setEdgar', b => b.textContent.trim() === 'Real public contracts (SEC EDGAR)' && b.getAttribute('aria-pressed') === 'true'), 'real set is loaded and labelled');
ok((await page.$$('#queue li')).length === 10, 'queue has 10 rows');
ok((await page.$$('#cards .card')).length === 10, '10 contract cards');
const st = await page.$eval('#status', e => e.textContent); ok(/10 contracts · 8 with a computed date · 2 need review/.test(st), 'counts: ' + st);
const first = await page.$eval('#queue li', e => e.textContent.replace(/\s+/g, ' ')); ok(/16 Dec 2026/.test(first) && /Schwazze/.test(first), 'top of queue is Star Brands / Schwazze, 16 Dec 2026');
const fonts = await page.evaluate(async () => { await document.fonts.ready; return [document.fonts.check('16px "Bodoni Moda"'), document.fonts.check('16px Geist')]; });
ok(fonts[0] && fonts[1], 'self-hosted Bodoni Moda and Geist loaded');
// drawers: every clause link goes to the exact EDGAR filing URL
for (const c of edgar) {
  await page.click(`#cards .card[data-id="${c.id}"]`); await page.waitForSelector('#drawer.on'); await new Promise(r => setTimeout(r, 450));
  const d = await page.$eval('#drawer', el => ({ quotes: [...el.querySelectorAll('blockquote.clause')].map(q => q.textContent), edgar: [...el.querySelectorAll('a.edgar')].map(a => a.href), saved: [...el.querySelectorAll('.loc a:not(.edgar)')].length }));
  ok(d.quotes.length > 0 && d.edgar.length === d.quotes.length + 1 && d.edgar.every(h => h === c.url), `${c.id}: ${d.quotes.length} quoted clauses, each linked to ${c.url}`);
  if (c.id === 'c2') ok(d.quotes.some(q => q.includes('not less than ninety (90) days prior to the end of the then-current term')), 'c2 drawer quotes the 90-day non-renewal clause');
  await page.click('#close'); await page.waitForFunction(() => !document.querySelector('#drawer.on')); await new Promise(r => setTimeout(r, 350));
}
// exports
const waitFile = async (re) => { for (let i = 0; i < 50; i++) { const f = fs.readdirSync(dl).find(n => re.test(n) && !n.endsWith('.crdownload')); if (f) return fs.readFileSync(path.join(dl, f), 'utf8'); await new Promise(r => setTimeout(r, 100)); } return null; };
await page.click('#exCsv'); const csv = await waitFile(/\.csv$/);
ok(csv && csv.startsWith('contract,filer,counterparty,item,date') && csv.includes('2026-12-16') && csv.includes('https://www.sec.gov/Archives/edgar/'), 'CSV export downloaded with dates and EDGAR URLs');
await page.click('#exIcs'); const ics = await waitFile(/\.ics$/);
ok(ics && ics.startsWith('BEGIN:VCALENDAR') && (ics.match(/BEGIN:VEVENT/g) || []).length === 8 && ics.includes('DTSTART;VALUE=DATE:20261216'), 'ICS export has 8 act-by events');
await page.click('#exPack'); const pk = await waitFile(/\.html$/); ok(pk && pk.includes('Diligence packet') && (pk.match(/<section>/g) || []).length === 10, 'diligence packet export');
// as-of control
await page.$eval('#asof', e => { e.value = '2027-01-01'; e.dispatchEvent(new Event('change')); });
ok(/Cerus/.test(await page.$eval('#queue li', e => e.textContent)), 'as-of 2027-01-01 moves Cerus / Purolite to the top');
await page.$eval('#asof', e => { e.value = '2026-10-19'; e.dispatchEvent(new Event('change')); });
// paste path
await page.type('#paste', 'This Agreement is entered into as of January 5, 2026 (the "Effective Date"). The Initial Term shall commence on the Effective Date and continue for one (1) year. This Agreement shall automatically renew for successive one (1) year terms unless either party provides written notice of non-renewal at least thirty (30) days prior to the end of the then-current term.');
await page.click('#addPaste'); await page.waitForSelector('#drawer.on'); await new Promise(r => setTimeout(r, 450));
ok((await page.$eval('#drawer', e => e.textContent)).includes('5 Dec 2026'), 'pasted contract: act-by 5 Dec 2026 (term ends 4 Jan 2027 minus 30 days)');
await page.click('#close'); await new Promise(r => setTimeout(r, 350)); await page.click('#setEdgar');
// links
const links = await page.$$eval('a[href]', as => as.map(a => a.href));
await page.click('#cards .card'); await new Promise(r => setTimeout(r, 450)); const dl2 = await page.$$eval('#drawer a[href]', as => as.map(a => a.href)); await page.click('#close'); await new Promise(r => setTimeout(r, 350));
const all = [...new Set([...links, ...dl2, ...edgar.map(c => c.url)])];
ok(!all.some(h => /example\.(com|org)|placeholder|lorem|^#$|javascript:|localhost(?!:4173)/i.test(h)), `no placeholder links among ${all.length}`);
const html = await page.content(); ok(!/example\.com|lorem ipsum|TODO/i.test(html), 'no placeholder text in page');
for (const h of all) { let s = 0; try { const r = await fetch(h, { headers: { 'User-Agent': UA }, redirect: 'follow' }); s = r.status; } catch (e) { s = String(e); } ok(s === 200, `200 ${h} (${s})`); await new Promise(r => setTimeout(r, 150)); }
const src = await browser.newPage(); await src.goto(BASE + '/source/?id=c2&from=352&to=355#L352', { waitUntil: 'networkidle0' });
ok((await src.$eval('#L353', e => e.className)) === 'hl', 'saved-text viewer highlights cited lines'); await src.close();
if (SHOTS) { await page.reload({ waitUntil: 'networkidle0' }); await page.screenshot({ path: path.join(SHOTS, 'contract-cliffs-1440.png'), fullPage: true }); await page.click('#cards .card[data-id="c5"]'); await new Promise(r => setTimeout(r, 400)); await page.screenshot({ path: path.join(SHOTS, 'contract-cliffs-1440-drawer.png') }); await page.click('#close'); }
// 375px
await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
await page.goto(BASE + '/?asof=2026-10-19', { waitUntil: 'networkidle0' });
const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(ov <= 0, `no sideways scroll at 375 (overflow ${ov}px)`);
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'contract-cliffs-375.png'), fullPage: true });
await page.click('#cards .card[data-id="c2"]'); await new Promise(r => setTimeout(r, 400));
const ov2 = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, document.querySelector('#drawer').scrollWidth - document.querySelector('#drawer').clientWidth)); ok(ov2 <= 0, `no sideways scroll at 375 with drawer open (${ov2}px)`);
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'contract-cliffs-375-drawer.png') });
ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
