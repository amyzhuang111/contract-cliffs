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
ok(csv && csv.startsWith('contract,filer,counterparty,item,who_acts,date') && csv.includes('2026-12-16') && csv.includes('https://www.sec.gov/Archives/edgar/'), 'CSV export downloaded with dates and EDGAR URLs');
await page.click('#exIcs'); const ics = await waitFile(/\.ics$/);
ok(ics && ics.startsWith('BEGIN:VCALENDAR') && (ics.match(/BEGIN:VEVENT/g) || []).length === 7 && ics.includes('DTSTART;VALUE=DATE:20261216') && !ics.includes('20240302'), 'ICS export has 7 upcoming act-by events (no lapsed Synacor event)');
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
// Taste+Design checks: quotes normalised, review labels, lapsed rows, clause serif
await page.click('#setEdgar'); await page.waitForSelector('#queue li');
const quotes = [];
for (const c of edgar) { await page.click(`#cards .card[data-id="${c.id}"]`); await page.waitForSelector('#drawer.on'); await new Promise(r => setTimeout(r, 350)); quotes.push(...await page.$$eval('#drawer blockquote.clause', qs => qs.map(q => q.textContent))); await page.click('#close'); await new Promise(r => setTimeout(r, 350)); }
ok(quotes.length > 30 && !quotes.some(q => /“\s|\s”/.test(q)), `no whitespace inside curly quotes across ${quotes.length} quoted clauses`);
const rvs = await page.$$eval('#queue .rv', els => els.map(e => { const cs = getComputedStyle(e); const nx = e.nextElementSibling; return { t: e.textContent, fs: cs.fontSize, ls: cs.letterSpacing, tt: cs.textTransform, col: cs.color, bg: cs.backgroundColor, bw: cs.borderTopWidth, pad: cs.paddingLeft, rs: nx && nx.classList.contains('rvw') ? nx.textContent : '', rcol: nx ? getComputedStyle(nx).color : '' }; }));
ok(rvs.length >= 2 && rvs.every(r => r.t === 'Needs review' && r.fs === '11px' && r.ls === '1.54px' && r.tt === 'uppercase' && r.col === 'rgb(10, 10, 10)' && r.bg === 'rgba(0, 0, 0, 0)' && r.bw === '0px' && r.pad === '0px'), `needs-review labels: ink, 11px caps, 0.14em, no fill/border/pill (${rvs.length})`);
ok(rvs.every(r => /^ · \S/.test(r.rs) && r.rcol === 'rgb(107, 107, 107)'), 'each label is followed by a grey reason: ' + rvs.map(r => r.rs.trim()).join(' | '));
const nd = await page.$$eval('#queue li .d', ds => ds.filter(d => !/\d{4}/.test(d.textContent)).map(d => ({ t: d.textContent.trim(), c: getComputedStyle(d.querySelector('.nd') || d).color })));
ok(nd.length === 2 && nd.every(x => x.t === 'No date found' && x.c === 'rgb(107, 107, 107)'), 'undated rows read "No date found" in grey, no dash');
const c7 = await page.$eval('#queue li[data-id="c7"]', e => e.textContent.replace(/\s+/g, ' ')); ok(/Lapsed/.test(c7) && /31 May 2024/.test(c7) && /Expired \(all renewals used\)/.test(c7) && !/notice/i.test(c7), 'Synacor / Qwest row: Lapsed, Expired 31 May 2024 (all renewals used), no send-notice line');
await page.click('#cards .card[data-id="c7"]'); await page.waitForSelector('#drawer.on'); await new Promise(r => setTimeout(r, 350));
const c7d = await page.$eval('#drawer', e => e.textContent); ok(/Expired \(all renewals used\)/i.test(c7d) && !/Auto-renewal/i.test(c7d) && !/Non-renewal notice/i.test(c7d), 'Synacor drawer: expired, no auto-renewal or notice rows');
ok(await page.evaluate(() => document.activeElement?.id === 'close'), 'drawer moves focus to Close');
for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
ok(await page.evaluate(() => document.querySelector('#drawer').contains(document.activeElement)), 'Tab stays trapped inside the drawer');
await page.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 350));
ok(await page.evaluate(() => document.activeElement?.closest('[data-id="c7"]') != null), 'focus returns to the card on close');
ok((await page.$eval('#cards .card[data-id="c1"] .tile', e => e.textContent)) === 'CP', 'Cerus / Purolite tile reads CP');
ok(await page.$eval('#queue li .d', e => { const cs = getComputedStyle(e); return cs.fontSize === '22px' && /Bodoni/.test(cs.fontFamily) && /tabular-nums/.test(cs.fontVariantNumeric); }), 'queue dates: Bodoni 22px, tabular figures');
await page.click('#cards .card[data-id="c2"]'); await page.waitForSelector('#drawer.on'); await new Promise(r => setTimeout(r, 350));
ok(await page.$eval('#drawer blockquote.clause', e => { const cs = getComputedStyle(e); return /Source Serif 4/.test(cs.fontFamily) && cs.fontSize === '15px' && cs.lineHeight === '24px'; }) && await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('15px "Source Serif 4"'); }), 'clause quotes set in Source Serif 4, 15/24, self-hosted');
await page.click('#close'); await new Promise(r => setTimeout(r, 350));
// upload paths: generated PDF and DOCX conversions of real EDGAR filings (test/fixtures/README.md)
const fx = n => new URL('./fixtures/' + n, import.meta.url).pathname;
await (await page.$('#file')).uploadFile(fx('c6-vivos-msa.generated.pdf')); await page.waitForSelector('#drawer.on', { timeout: 20000 }); await new Promise(r => setTimeout(r, 500));
let dt = await page.$eval('#drawer', e => e.textContent);
ok(dt.includes('31 May 2027') && dt.includes('p. 2, lines 25–26') && dt.includes('at least sixty (60) days prior'), 'PDF upload: act-by 31 May 2027 cited "p. 2, lines 25–26"');
await page.click('#close'); await new Promise(r => setTimeout(r, 350));
await (await page.$('#file')).uploadFile(fx('c12-reborn-supply.generated.docx')); await page.waitForFunction(() => document.querySelector('#drawer.on h3')?.textContent.includes('reborn'), { timeout: 20000 }); await new Promise(r => setTimeout(r, 400));
dt = await page.$eval('#drawer', e => e.textContent);
ok(dt.includes('10 Jun 2028') && /¶ \d+/.test(dt), 'DOCX upload: act-by 10 Jun 2028 cited by paragraph');
await page.click('#close'); await new Promise(r => setTimeout(r, 350));
await page.click('[data-sample$=".pdf"]'); await page.waitForFunction(() => document.querySelectorAll('#cards .card').length === 3 && document.querySelector('#drawer.on h3')?.textContent.includes('c6-vivos'), { timeout: 20000 }); await new Promise(r => setTimeout(r, 400));
{ const sd = await page.$eval('#drawer', e => [e.className, e.querySelector('h3')?.textContent, [...e.querySelectorAll('.loc span')].map(x => x.textContent).slice(0, 4).join('|')].join(' / ')); ok(sd.includes('p. 2, lines 25–26'), 'sample PDF link runs the same upload path from the live site' + (sd.includes('p. 2, lines 25–26') ? '' : ': ' + sd)); }
await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#drawer.on')); await new Promise(r => setTimeout(r, 400)); await page.$eval('#setEdgar', b => b.click()); await page.waitForSelector('#queue li[data-id="c2"]');
// live NDA paste (typical SaaS/NDA wording)
await page.$eval('#paste', (e, v) => { e.value = v; }, 'MUTUAL NONDISCLOSURE AGREEMENT\nThis Mutual Nondisclosure Agreement is entered into as of November 2, 2026 (the "Effective Date") by and between Acme Corp. and Beta LLC.\nThe term of this Agreement is one (1) year from the Effective Date. This Agreement shall automatically renew for successive one (1) year periods unless either party gives written notice of non-renewal at least thirty (30) days prior to the end of the then-current term.');
await page.click('#addPaste'); await page.waitForSelector('#drawer.on'); await new Promise(r => setTimeout(r, 450));
dt = await page.$eval('#drawer', e => e.textContent);
ok(dt.includes('1 Nov 2027') && dt.includes('2 Oct 2027') && dt.includes('Who acts: Either party'), 'NDA paste ("term ... is one (1) year from"): term ends 1 Nov 2027, act by 2 Oct 2027, either party acts');
await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#drawer.on')); await new Promise(r => setTimeout(r, 350));
await page.$eval('#setEdgar', b => b.click()); await page.waitForSelector('#queue li[data-id="c2"]');
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
// invalid ?asof falls back to today with a notice
for (const bad of ['2026-13-45', '2026-02-30', 'banana']) {
  await page.goto(BASE + '/?asof=' + bad, { waitUntil: 'networkidle0' }); await page.waitForSelector('#queue li');
  const t = await page.evaluate(() => ({ st: document.querySelector('#status').textContent, q: document.querySelector('#queue').textContent, v: document.querySelector('#asof').value }));
  const today = new Date(); const td = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  ok(/Invalid as-of date/.test(t.st) && t.v === td && !/NaN|25\d\d/.test(t.q), `?asof=${bad} -> "Invalid as-of date, using today", no NaN or far-future dates`);
}
await page.goto(BASE + '/?asof=2026-10-19', { waitUntil: 'networkidle0' }); await page.waitForSelector('#queue li');
await page.$eval('#setMine', b => b.click()); await page.$eval('#exCsv', b => b.click()); await new Promise(r => setTimeout(r, 300));
ok(/Nothing to export yet/.test(await page.$eval('#status', e => e.textContent)), 'empty export says so instead of downloading a header-only file');
// 375px
await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
await page.goto(BASE + '/?asof=2026-10-19', { waitUntil: 'networkidle0' });
const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(ov <= 0, `no sideways scroll at 375 (overflow ${ov}px)`);
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'contract-cliffs-375.png'), fullPage: true });
const tiles = await page.$$eval('#cards .tile', ts => ts.slice(0, 4).map(t => { const r = t.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width), Math.round(r.height)]; }));
ok(tiles[0][0] !== tiles[1][0] && tiles[0][1] <= 175 && tiles[0][1] >= 140 && Math.abs(tiles[0][1] - tiles[0][2]) <= 1, `375: monogram tiles in 2 columns, 1:1 (${tiles[0][1]}x${tiles[0][2]})`);
await page.click('#cards .card[data-id="c2"]'); await new Promise(r => setTimeout(r, 400));
const ov2 = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, document.querySelector('#drawer').scrollWidth - document.querySelector('#drawer').clientWidth)); ok(ov2 <= 0, `no sideways scroll at 375 with drawer open (${ov2}px)`);
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'contract-cliffs-375-drawer.png') });
ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
