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
ok(await page.$eval('#setEdgar', b => b.textContent.trim() === '10 real public contracts (SEC)' && b.getAttribute('aria-pressed') === 'true'), 'real set is loaded and labelled');
ok((await page.$$('#queue li[data-id]')).length === 10, 'queue has 10 rows');
ok((await page.$$('#cards .card')).length === 10, '10 contract cards');
const st = await page.$eval('#status', e => e.textContent); ok(/10 contracts · 8 with a computed date · 4 need review · 1 missed deadline/.test(st), 'counts: ' + st);
const order = await page.$$eval('#queue > li', ls => ls.map(l => l.dataset.id || (l.classList.contains('lgrp') ? 'LAPSED' : 'H:' + l.textContent.trim())));
ok(order.join(',') === 'H:Missed · deadline passed, not yet renewed,c3,H:Resolve first · needs review, no date,c13,c8,H:Later · 31–90 days,c5,H:Later · 91–365 days,c1,c6,H:Later · over a year,c4,c12,c2,LAPSED', 'priority order on the page: ' + order.join(','));
ok(/^Why it’s here MISSED: send-notice deadline passed 30 days ago · renews 19 Nov 2026/.test(await page.$eval('#queue li[data-id="c3"] .why-here', e => e.textContent.replace(/\s+/g, ' ').trim())), 'F1: Dragonfly shows the missed notice window at the top');
ok(await page.$eval('#queue li.lgrp details', e => !e.open) && /Expired \(1\)/.test(await page.$eval('#queue li.lgrp summary', e => e.textContent)), 'F9: expired rows collapsed under "Expired (1)"');
{ const st = await page.$eval('#status', e => e.textContent); const sv = await page.$$eval('#stats > div', ds => Object.fromEntries(ds.map(d => [d.querySelector('.lab').textContent, d.querySelector('.sv').textContent])));
  ok(st.includes(sv['Need review'] + ' need review'), `F3: status line and stats strip agree on need-review (${sv['Need review']})`); }
ok(!(await page.$$eval('#queue li[data-id]', ls => ls.filter(l => /\d{4}/.test(l.querySelector('.d').textContent) && /^Can’t tell/.test(l.querySelector('.s').textContent.trim().split('\n').pop().trim())).length)), 'F6: no dated row shows "none" confidence');
const why5 = await page.$eval('#queue li[data-id="c5"] .why-here', e => e.textContent.replace(/\s+/g, ' ').trim()); ok(why5 === 'Why it’s here Deadline in 58 days · miss it and it renews for 2 more years', 'row reason: ' + why5);
ok(/1\) Missed/.test(await page.$eval('#rule', e => e.textContent)) && /Priority rule/i.test(await page.$eval('.rule .lab', e => e.textContent)), 'Priority rule note is shown');
ok((await page.$eval('#queue li[data-id="c12"] .safe', e => e.textContent)) === 'Falls on a Saturday · send by Fri 9 Jun 2028 to be safe' && /10 Jun 2028/.test(await page.$eval('#queue li[data-id="c12"] .d', e => e.textContent)), 'weekend deadline: Reborn row keeps 10 Jun 2028 and says send by Fri 9 Jun 2028');
ok(/send by Fri 28 May 2027 to be safe/.test(await page.$eval('#cards .card[data-id="c6"]', e => e.textContent)) && /Memorial Day/.test(await page.$eval('#cards .card[data-id="c6"]', e => e.textContent)), 'holiday deadline: Vivos card flags Memorial Day');
ok(/weekends and US federal holidays flagged; local holidays not modelled/.test(await page.$eval('footer', e => e.textContent)), 'footer states the business-day rule');
{ const p4 = await browser.newPage(); await p4.goto(BASE + '/?asof=2027-09-18', { waitUntil: 'networkidle0' }); await p4.waitForSelector('#queue li[data-id="c3"]');
  const t = await p4.$eval('#queue li[data-id="c3"]', e => e.textContent.replace(/\s+/g, ' '));
  ok(/The last business day before it \(Fri 17 Sep 2027\) has passed\. Send today and confirm delivery\./.test(t) && !/to be safe/.test(t), 'as-of 2027-09-18: Dragonfly says send today, not "to be safe"'); await p4.close(); }
for (const w of [1440, 375]) { const pf = await browser.newPage(); await pf.setViewport({ width: w, height: w === 1440 ? 900 : 812 }); await pf.goto(BASE + '/', { waitUntil: 'networkidle0' }); await pf.waitForSelector('#queue li[data-id]');
  const m = await pf.evaluate(() => { const r = document.querySelector('#queue li[data-id]').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, rowsTop: [...document.querySelectorAll('#queue li[data-id]')].filter(x => x.offsetParent && x.getBoundingClientRect().top < innerHeight).length, sw: document.documentElement.scrollWidth, lede: !!document.querySelector('.lede').offsetHeight, steps: document.querySelectorAll('.steps li').length, over: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.drawer')).length }; });
  if (w === 1440) { ok(m.top < 900, `first screen: first queue row top at ${Math.round(m.top)}px < 900 at 1440x900`); ok(m.bottom <= 900, `first screen: first queue row fully visible (bottom ${Math.round(m.bottom)}px)`); ok(m.rowsTop >= 3, `first screen: ${m.rowsTop} queue rows start within 1440x900`); }
  else { ok(m.bottom < 812, `phone: whole first queue row (name + date) fits above 812px (top ${Math.round(m.top)}, bottom ${Math.round(m.bottom)})`); ok(await pf.$eval('#how', e => !e.open), 'phone: How it works is collapsed'); ok(await pf.$eval('#how > summary .lab', e => getComputedStyle(e, '::after').content.includes('▸')), 'phone: How it works shows an arrow'); }
  if (w === 375) ok(m.sw <= 375 && m.over === 0 && m.lede && m.steps === 3 && true, `375: nothing breaks (scrollWidth ${m.sw}, ${m.over} overflowing elements, hero + 3 steps shown)`);
  await pf.close(); }
{ const lede = await page.$eval('.lede', e => e.textContent.replace(/\s+/g, ' ').trim());
  ok(lede === 'Many contracts renew automatically unless you send notice by a deadline. Contract Cliffs reads your contracts and tells you the date you must act by, most urgent first, quoting the exact sentence each date comes from.', 'clarity: plain-words hero');
  const steps = await page.$$eval('.steps li .lab', l => l.map(x => x.textContent));
  ok(steps.join('|') === '1 · Load contracts|2 · Read the list|3 · Check and export', 'clarity: 3-step how to use');
  const ex = await page.$eval('#example', e => e.textContent.replace(/\s+/g, ' '));
  ok(/Star Brands \/ Schwazze: send notice by 16 Dec 2026, or the licence renews automatically for another 24 months/.test(ex), 'N6: worked example uses Star Brands / Schwazze: ' + ex.slice(0, 90));
  ok(/For ops and legal teams tracking vendor and customer contracts\./.test(await page.$eval('.who', e => e.textContent)), 'N7: audience line');
  const card3 = await page.$eval('#cards .card[data-id="c3"]', e => e.textContent.replace(/\s+/g, ' ')); ok(/Renews 19 Nov 2026 · send-notice deadline missed/.test(card3) && !/Renews 19 Sep 2027/.test(card3), 'N1: Dragonfly card says Renews 19 Nov 2026');
  ok(!/EX-10/.test(await page.$eval('#cards', e => e.textContent)) && !/(high|medium|low|none) confidence/.test(await page.$eval('#queue', e => e.textContent)) && /Sure/.test(await page.$eval('#queue', e => e.textContent)) && /Check this/.test(await page.$eval('#queue', e => e.textContent)), 'N5: plain confidence words, no exhibit codes on cards');
  ok(await page.$eval('#qh abbr', e => /last day to send notice/.test(e.title)), 'clarity: "Send-notice deadlines" has a plain tooltip');
  ok(await page.$eval('details.method', e => !e.open) && await page.$eval('details.rule', e => !e.open), 'clarity: method and priority rule collapsed');
  ok(/Test set \(10 contracts; first blind pass 3 right, 1 missed, 0 wrong; rules adjusted after\)/.test(await page.$eval('#setHoldout', e => e.textContent)) && !/holdout|Lapsed/i.test(await page.$eval('body', e => e.innerText.replace(/Method and accuracy[\s\S]*/, ''))), 'clarity: no "holdout" or "Lapsed" jargon in visible labels');
  const vis = await page.evaluate(() => { const q = document.querySelector('#queue').getBoundingClientRect().top, a = document.querySelector('#add').getBoundingClientRect().top; return q < a; });
  ok(vis, 'clarity: the list comes before the add/export controls');
  const d3 = await page.$eval('#queue li[data-id="c3"] .d', e => e.textContent.replace(/\s+/g, ' ').trim()), n3 = await page.$eval('#queue li[data-id="c3"] .n', e => e.textContent.trim());
  ok(d3 === 'Renews 19 Nov 2026' && n3 === 'in 31 days', `missed row headline is the renewal date (${d3} · ${n3})`);
  ok(/Need review/.test(await page.$eval('.revlist', e => e.textContent)) && (await page.$$('.revlist .lnk')).length === 4, 'Need review stat names its 4 contracts');
  await page.$eval('.revlist .lnk', b => b.click()); await new Promise(r => setTimeout(r, 400)); ok(await page.$eval('#drawer', e => e.classList.contains('on')), 'need-review name opens its drawer'); await page.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 300));
  const tops = await page.$$eval('#stats > div', ds => ds.map(d => Math.round(d.getBoundingClientRect().top))); ok(tops.length === 6 && new Set(tops).size === 1, `stats strip: all 6 figures on one line at desktop (${tops.length})`);
}
{ const p2 = await browser.newPage(); await p2.setViewport({ width: 1440, height: 900 }); await p2.goto(BASE + '/?asof=2026-12-16', { waitUntil: 'networkidle0' }); await p2.waitForSelector('#queue li[data-id]');
  const o = await p2.$$eval('#queue > li', ls => ls.map(l => l.dataset.id || (l.classList.contains('sh') ? 'H:' + l.textContent.trim() : '')).filter(Boolean));
  const iDue = o.indexOf('H:Due within 30 days'), iRes = o.indexOf('H:Resolve first · needs review, no date');
  ok(iDue >= 0 && o[iDue + 1] === 'c5' && iDue < iRes, 'R1: on the deadline day (as-of 2026-12-16) Star Brands sits in "Due within 30 days" above "Resolve first"');
  ok(/^Why it’s here Due today · send notice now/.test(await p2.$eval('#queue li[data-id="c5"] .why-here', e => e.textContent.replace(/\s+/g, ' ').trim())), 'R1: due-now reason says "Due today"'); await p2.close(); }
{ const p3 = await browser.newPage(); await p3.setViewport({ width: 1440, height: 900 }); await p3.goto(BASE + '/?asof=2026-11-25', { waitUntil: 'networkidle0' }); await p3.waitForSelector('#queue li[data-id]');
  const o = await p3.$$eval('#queue > li', ls => ls.map(l => l.dataset.id || (l.classList.contains('sh') ? 'H:' + l.textContent.trim() : '')).filter(Boolean));
  ok(o[0] === 'H:Due within 30 days' && o[1] === 'c5' && o.indexOf('H:Due within 30 days') < o.indexOf('H:Resolve first · needs review, no date'), 'N3: as-of 25 Nov 2026, Star Brands (21 days) ranks above "No date found": ' + o.slice(0, 4).join(','));
  await p3.close(); }
ok(/two cycles out/.test(await page.$eval('#queue li[data-id="c1"]', e => e.textContent)), 'Cerus reason calls out notice longer than renewal');
const fonts = await page.evaluate(async () => { await document.fonts.ready; return [document.fonts.check('16px "Geist Mono"'), document.fonts.check('16px Geist'), [...document.fonts].map(f => f.family).join(',')]; });
ok(fonts[0] && fonts[1] && !/Bodoni|Serif/i.test(fonts[2]), 'self-hosted Geist and Geist Mono loaded; no Bodoni or serif faces');
const brand = await page.evaluate(() => { const cs = e => getComputedStyle(document.querySelector(e)); return { bg: cs('body').backgroundColor, h1: document.querySelector('h1').textContent, h1w: cs('h1').fontWeight, h1f: cs('h1').fontFamily, lab: cs('.lab').fontFamily, labT: cs('.lab').textTransform, labLs: cs('.lab').letterSpacing, labC: cs('.lab').color, card: cs('.card').backgroundColor, cardB: cs('.card').borderTopWidth, cardR: cs('.card').borderTopLeftRadius, btn: cs('#exCsv').backgroundColor, btnR: cs('#exCsv').borderTopLeftRadius, drawerBg: cs('#drawer').backgroundColor, blur: cs('#drawer').backdropFilter, lede: cs('.lede').backgroundColor }; });
ok(brand.bg === 'rgb(0, 0, 0)' && brand.h1 === 'contract cliffs' && brand.h1w === '500' && /^"?Geist"?,/.test(brand.h1f), `GI skin: black page, lowercase Geist 500 wordmark (${brand.h1})`);
ok(/Geist Mono/.test(brand.lab) && brand.labT === 'uppercase' && brand.labLs === 'normal' && brand.labC === 'rgb(136, 136, 136)', 'labels: Geist Mono, uppercase, #888, no tracking');
ok(brand.card === 'rgba(255, 255, 255, 0.1)' && parseFloat(brand.cardB) <= 1 && parseFloat(brand.cardR) <= 2 && brand.btn === 'rgb(255, 255, 255)' && brand.btnR === '0px', `cards rgba(255,255,255,.1) with hairline border, radius ${brand.cardR}; square white primary buttons`);
ok(brand.drawerBg === 'rgba(12, 14, 22, 0.95)' && /blur\(20px\)/.test(brand.blur) && brand.lede === 'rgb(255, 255, 255)', 'drawer #0C0E16 with 20px blur; white hero copy box');
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
ok(ics && ics.startsWith('BEGIN:VCALENDAR') && (ics.match(/BEGIN:VEVENT/g) || []).length === 8 && ics.includes('DTSTART;VALUE=DATE:20261216') && !ics.includes('20240302'), 'ICS export: 7 upcoming send-notice deadlines + 1 MISSED renewal event (no expired Synacor event)');
await page.click('#exPack'); const pk = await waitFile(/\.html$/); ok(pk && pk.includes('Audit pack') && (pk.match(/<section>/g) || []).length === 10, 'audit pack export');
{ const BANNED_CS = /\bAct by\b/; const BANNED = /ambiguous|= end of term|redacted in the public filing|act-by|ambiguous drafting|computable expiry|Notice window missed|negotiated exit|Exhibit 10|Party \(filer\)|Contract lifecycle|diligence|\b(?:high|medium|low|none) confidence|Confidence: (?:high|medium|low|none)/i;
  const texts = { csv, ics, pack: pk };
  texts.page = await page.evaluate(() => { document.querySelectorAll('details').forEach(d => d.open = true); return document.body.innerText; });
  for (const id of ['c3', 'c13', 'c4']) { await page.$eval(`#cards .card[data-id="${id}"]`, b => b.click()); await new Promise(r => setTimeout(r, 300)); texts['drawer-' + id] = await page.$eval('#drawer', e => e.innerText); await page.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 250)); }
  const hits = Object.entries(texts).map(([k, v]) => [k, ((v || '').match(BANNED) || (v || '').match(BANNED_CS))?.[0]]).filter(([, m]) => m);
  ok(hits.length === 0, 'jargon sweep: no banned terms in the page, drawers, CSV, .ics or audit pack' + (hits.length ? ' ' + JSON.stringify(hits) : ''));
  ok(fs.readdirSync(dl).some(n => /^audit-pack-.*\.html$/.test(n)) && !fs.readdirSync(dl).some(n => /diligence/.test(n)), 'audit pack downloads as audit-pack-*.html');
  ok(/MISSED: Dragonfly/.test(ics) && /DTSTART;VALUE=DATE:20261119/.test(ics) && /<b>MISSED<\/b>[^<]*<\/td><td>Renews 2026-11-19/.test(pk) && /MISSED send-notice deadline/.test(csv), 'exports mark Dragonfly MISSED with the 19 Nov 2026 renewal');
  await page.evaluate(() => { document.querySelectorAll('details').forEach(d => d.open = false); if (matchMedia('(min-width: 821px)').matches) document.getElementById('how').open = true; }); }
// as-of control
await page.$eval('#asof', e => { e.value = '2027-01-01'; e.dispatchEvent(new Event('change')); });
ok(/Cerus/.test(await page.$eval('#queue li[data-id]:not(.missed):not([data-id="c7"]):not([data-id="c13"]):not([data-id="c8"])', e => e.textContent)), 'as-of 2027-01-01 moves Cerus / Purolite to the top of the upcoming rows');
await page.$eval('#asof', e => { e.value = '2026-10-19'; e.dispatchEvent(new Event('change')); });
// paste path
await page.type('#paste', 'This Agreement is entered into as of January 5, 2026 (the "Effective Date"). The Initial Term shall commence on the Effective Date and continue for one (1) year. This Agreement shall automatically renew for successive one (1) year terms unless either party provides written notice of non-renewal at least thirty (30) days prior to the end of the then-current term.');
await page.click('#addPaste'); await page.waitForSelector('#drawer.on'); await new Promise(r => setTimeout(r, 450));
ok((await page.$eval('#drawer', e => e.textContent)).includes('5 Dec 2026'), 'pasted contract: act-by 5 Dec 2026 (term ends 4 Jan 2027 minus 30 days)');
await page.click('#close'); await new Promise(r => setTimeout(r, 350)); await page.click('#setEdgar');
const TOK = await page.evaluate(() => { const p = document.createElement('div'); document.body.append(p); const g = v => { p.style.color = `var(${v})`; return getComputedStyle(p).color; }; const o = { ink: g('--ink'), mute: g('--mute') }; p.remove(); return o; }); // brand tokens, so a palette swap doesn't break the checks
// Taste+Design checks: quotes normalised, review labels, lapsed rows, clause serif
await page.click('#setEdgar'); await page.waitForSelector('#queue li');
const quotes = [];
for (const c of edgar) { await page.click(`#cards .card[data-id="${c.id}"]`); await page.waitForSelector('#drawer.on'); await new Promise(r => setTimeout(r, 350)); quotes.push(...await page.$$eval('#drawer blockquote.clause', qs => qs.map(q => q.textContent))); await page.click('#close'); await new Promise(r => setTimeout(r, 350)); }
ok(quotes.length > 30 && !quotes.some(q => /“\s|\s”/.test(q)), `no whitespace inside curly quotes across ${quotes.length} quoted clauses`);
const rvs = await page.$$eval('#queue .rv', els => els.map(e => { const cs = getComputedStyle(e); const nx = e.nextElementSibling; return { t: e.textContent, fs: cs.fontSize, ls: cs.letterSpacing, tt: cs.textTransform, col: cs.color, bg: cs.backgroundColor, bw: cs.borderTopWidth, pad: cs.paddingLeft, rs: nx && nx.classList.contains('rvw') ? nx.textContent : '', rcol: nx ? getComputedStyle(nx).color : '' }; }));
ok(rvs.length >= 2 && rvs.every(r => r.t === 'Needs review' && r.fs === '12px' && r.ls === 'normal' && r.tt === 'uppercase' && r.col === TOK.ink && r.bg === 'rgba(0, 0, 0, 0)' && r.bw === '0px' && r.pad === '0px'), `needs-review labels: ink, 11px caps, 0.14em, no fill/border/pill (${rvs.length})`);
ok(rvs.every(r => /^ · \S/.test(r.rs) && r.rcol === TOK.mute), 'each label is followed by a grey reason: ' + rvs.map(r => r.rs.trim()).join(' | '));
const nd = await page.$$eval('#queue li .d', ds => ds.filter(d => !/\d{4}/.test(d.textContent)).map(d => ({ t: d.textContent.trim(), c: getComputedStyle(d.querySelector('.nd') || d).color })));
ok(nd.length === 2 && nd.every(x => x.t === 'No date found' && x.c === TOK.mute), 'undated rows read "No date found" in grey, no dash');
await page.$eval('#queue li.lgrp details', e => { e.open = true; });
const c7 = await page.$eval('#queue li[data-id="c7"]', e => e.textContent.replace(/\s+/g, ' ')); ok(/Expired/.test(c7) && !/Lapsed/.test(c7) && /31 May 2024/.test(c7) && /Expired \d+ days ago · all renewals used/.test(c7) && !/send non-renewal/i.test(c7), 'Synacor / Qwest row: Expired chip, Expired 31 May 2024 (all renewals used), no send-notice line');
await page.click('#cards .card[data-id="c7"]'); await page.waitForSelector('#drawer.on'); await new Promise(r => setTimeout(r, 350));
const c7d = await page.$eval('#drawer', e => e.textContent); ok(/Expired \(all renewals used\)/i.test(c7d) && !/Auto-renewal/i.test(c7d) && !/Non-renewal notice/i.test(c7d), 'Synacor drawer: expired, no auto-renewal or notice rows');
ok(await page.evaluate(() => document.activeElement?.id === 'close'), 'drawer moves focus to Close');
for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
ok(await page.evaluate(() => document.querySelector('#drawer').contains(document.activeElement)), 'Tab stays trapped inside the drawer');
await page.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 350));
ok(await page.evaluate(() => document.activeElement?.closest('[data-id="c7"]') != null), 'focus returns to the card on close');
ok((await page.$eval('#cards .card[data-id="c1"] .tile', e => e.textContent)) === 'CP', 'Cerus / Purolite tile reads CP');
ok(await page.$eval('#queue li .d', e => { const cs = getComputedStyle(e); return cs.fontSize === '22px' && /Geist/.test(cs.fontFamily) && cs.fontWeight === '500' && /tabular-nums/.test(cs.fontVariantNumeric); }), 'queue dates: Geist 500 22px, tabular figures');
await page.click('#cards .card[data-id="c2"]'); await page.waitForSelector('#drawer.on'); await new Promise(r => setTimeout(r, 350));
ok(await page.$eval('#drawer blockquote.clause', e => { const cs = getComputedStyle(e); return /Geist/.test(cs.fontFamily) && cs.fontSize === '15px' && cs.lineHeight === '24px'; }), 'clause quotes readable in Geist 15/24');
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
const n0 = (await page.$$('#cards .card')).length; await page.$eval('[data-sample$=".pdf"]', b => b.click()); await page.waitForFunction(n => document.querySelectorAll('#cards .card').length === n + 1 && document.querySelector('#drawer.on h3')?.textContent.includes('c6-vivos'), { timeout: 20000 }, n0); await new Promise(r => setTimeout(r, 400));
{ const sd = await page.$eval('#drawer', e => [e.className, e.querySelector('h3')?.textContent, [...e.querySelectorAll('.loc span')].map(x => x.textContent).slice(0, 4).join('|')].join(' / ')); ok(sd.includes('p. 2, lines 25–26'), 'sample PDF link runs the same upload path from the live site' + (sd.includes('p. 2, lines 25–26') ? '' : ': ' + sd)); }
await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#drawer.on')); await new Promise(r => setTimeout(r, 400)); await page.$eval('#setEdgar', b => b.click()); await page.waitForSelector('#queue li[data-id="c2"]');
// live NDA paste (typical SaaS/NDA wording)
await page.$eval('#paste', (e, v) => { e.value = v; }, 'MUTUAL NONDISCLOSURE AGREEMENT\nThis Mutual Nondisclosure Agreement is entered into as of November 2, 2026 (the "Effective Date") by and between Acme Corp. and Beta LLC.\nThe term of this Agreement is one (1) year from the Effective Date. This Agreement shall automatically renew for successive one (1) year periods unless either party gives written notice of non-renewal at least thirty (30) days prior to the end of the then-current term.');
await page.click('#addPaste'); await page.waitForSelector('#drawer.on'); await new Promise(r => setTimeout(r, 450));
dt = await page.$eval('#drawer', e => e.textContent);
ok(dt.includes('1 Nov 2027') && dt.includes('2 Oct 2027') && dt.includes('Who acts: Either party'), 'NDA paste ("term ... is one (1) year from"): term ends 1 Nov 2027, act by 2 Oct 2027, either party acts');
await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#drawer.on')); await new Promise(r => setTimeout(r, 350));
await page.$eval('#setEdgar', b => b.click()); await page.waitForSelector('#queue li[data-id="c2"]');
// group by party
await page.$eval('#g-counterparty', b => b.click()); await new Promise(r => setTimeout(r, 200));
let g = await page.evaluate(() => ({ heads: [...document.querySelectorAll('#queue li.grp')].map(l => l.textContent.replace(/\s+/g, ' ').trim()), rows: document.querySelectorAll('#queue li[data-id]').length, pressed: document.querySelector('#g-counterparty').getAttribute('aria-pressed') }));
ok(g.heads.length >= 2 && g.rows === 10 && g.pressed === 'true' && g.heads.some(h => /Other company Purolite Corporation 1 agreement · next deadline 20 Apr 2027/.test(h)), `group by counterparty: ${g.heads.length} groups, 10 rows`);
await page.$eval('#g-filer', b => b.click()); await new Promise(r => setTimeout(r, 200));
g = await page.evaluate(() => [...document.querySelectorAll('#queue li.grp')].map(l => l.textContent.replace(/\s+/g, ' ').trim()));
ok(g.some(h => /Company that filed it Kopin Corporation/.test(h)), 'group by company that filed it works');
await page.$eval('#g-none', b => b.click()); await new Promise(r => setTimeout(r, 200));
ok((await page.$$('#queue li.grp')).length === 0, 'grouping off restores the flat queue');
await page.$eval('#g-counterparty', b => b.click()); await new Promise(r => setTimeout(r, 200));
{ const h0 = await page.$eval('#queue li.grp', l => l.textContent); ok(/Keystone RV/.test(h0), 'F10: groups sorted by priority (first group holds the top row, Keystone RV)'); }
await page.$eval('#g-none', b => b.click());
await page.$eval('#setHoldout', b => b.click()); await page.waitForFunction(() => document.querySelectorAll('#cards .card').length === 10 && /Test set/.test(document.querySelector('#setnote').textContent), { timeout: 15000 });
{ const t = await page.$eval('#queue', e => e.textContent); ok(/Blockfusion \/ Thunderra/.test(t) && (await page.$$('#queue li[data-id]')).length === 10, 'holdout set is live: 10 blind EDGAR contracts in the queue'); }
await page.$eval('#setEdgar', b => b.click()); await new Promise(r => setTimeout(r, 200));
// cross-referenced notice period (paste)
await page.$eval('#paste', (e, v) => { e.value = v; }, 'This Services Agreement is entered into as of January 1, 2026 (the "Effective Date").\n7.1 Term. The term of this Agreement shall begin on January 1, 2026 and shall end January 1, 2029. Upon expiration of the Initial Term, this Agreement will automatically renew for successive one (1) year terms, unless either party provides the other with notice of its intent to terminate pursuant to Section 7.4.\n7.4 Termination for Convenience. Customer may terminate this Agreement for any or no reason upon three hundred sixty-five (365) days’ advance written notice.');
await page.click('#addPaste'); await page.waitForSelector('#drawer.on'); await new Promise(r => setTimeout(r, 450));
dt = await page.$eval('#drawer', e => e.textContent);
ok(dt.includes('2 Jan 2028') && /Section 7\.4/.test(dt) && /Referenced from the renewal clause/.test(dt) && /NEEDS REVIEW|Needs review/i.test(dt), 'cross-referenced notice: reads Section 7.4 (365 days) -> act by 2 Jan 2028, flagged, both clauses quoted');
await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#drawer.on')); await new Promise(r => setTimeout(r, 350));
await page.$eval('#setEdgar', b => b.click()); await page.waitForSelector('#queue li[data-id="c2"]');
// links
const links = await page.$$eval('a[href]', as => as.map(a => a.href));
await page.click('#cards .card'); await new Promise(r => setTimeout(r, 450)); const dl2 = await page.$$eval('#drawer a[href]', as => as.map(a => a.href)); await page.click('#close'); await new Promise(r => setTimeout(r, 350));
const all = [...new Set([...links, ...dl2, ...edgar.map(c => c.url)])];
ok(!all.filter(h => !h.startsWith(BASE + '/')).some(h => /example\.(com|org)|placeholder|lorem|javascript:|localhost|127\.0\.0\.1/i.test(h)) && !all.some(h => /#$/.test(h)), `no placeholder links among ${all.length} (own-origin links allowed for any BASE_URL port)`);
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
