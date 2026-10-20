// e2e for F1-F6 and the ?demo=1 regression. Run against `node test/serve.mjs` (BASE_URL to override).
import puppeteer from 'puppeteer-core'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const BASE = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '');
const SHOTS = process.env.SHOTS || '';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fx = n => new URL('./fixtures/' + n, import.meta.url).pathname;
const errors = [];
async function fresh(q, w = 1440) {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); p.ctx = ctx;
  await p.setViewport(w === 375 ? { width: 375, height: 812, isMobile: true, hasTouch: true } : { width: 1440, height: 900 });
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // capture downloads: every blob handed to an <a download> is stored as base64
  await p.evaluateOnNewDocument(() => { window.__dl = []; const o = URL.createObjectURL; URL.createObjectURL = b => { const id = window.__dl.length; window.__dl.push(null); b.arrayBuffer().then(a => { let s = ''; new Uint8Array(a).forEach(x => s += String.fromCharCode(x)); window.__dl[id] = { type: b.type, b64: btoa(s) }; }); return o(b); }; });
  await p.goto(BASE + q, { waitUntil: 'networkidle0' }); return p;
}
const lastDl = async p => { await p.waitForFunction(() => window.__dl.length && window.__dl[window.__dl.length - 1], { timeout: 5000 }); const d = await p.evaluate(() => window.__dl[window.__dl.length - 1]); return { type: d.type, buf: Buffer.from(d.b64, 'base64') }; };
const status = p => p.$eval('#status', e => e.textContent);
const waitStatus = (p, re, t = 20000) => p.waitForFunction(r => new RegExp(r).test(document.querySelector('#status').textContent), { timeout: t }, re.source);
const shot = async (p, name, w) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `features-${name}-${w}.png`), fullPage: false }); };
const auto = p => p.waitForFunction(() => !document.querySelector('#answer').hidden && document.querySelector('#answer .iname'), { timeout: 5000 });
const demo3 = async p => { await auto(p); await p.click('#trySecond'); await waitStatus(p, /2 contracts/); await p.click('#trySecond'); await waitStatus(p, /3 contracts/); await sleep(700); };
const drop = (p, files) => p.evaluate(files => { const dt = new DataTransfer(); for (const [name, b64, type] of files) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); dt.items.add(new File([u], name, { type })); } window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, files);
const f64 = n => fs.readFileSync(fx(n)).toString('base64');

// 0. plain URL: nothing preloaded, no portfolio
{ const p = await fresh('/?asof=2026-10-19');
  ok(await p.evaluate(() => !document.querySelector('#portfolio').textContent && document.querySelector('#answer').hidden && !document.querySelector('a.gcal')), 'plain URL: no sample data, no portfolio, no calendar links');
  await p.ctx.close(); }

// R. ?demo=1 regression: exact order Star Brands, then StableX, then Dragonfly
{ const p = await fresh('/?demo=1&asof=2026-10-19');
  ok(await p.evaluate(() => document.body.classList.contains('guided')), '?demo=1: guided mode on');
  await auto(p); await sleep(300);
  const s1 = await p.evaluate(() => ({ n: document.querySelector('#answer .iname').textContent, d: document.querySelector('#answerBig').textContent, next: document.querySelector('#trySecond').textContent }));
  ok(s1.n === 'Star Brands / Schwazze' && s1.d === '16 Dec 2026' && s1.next === 'Add StableX / Kopin', `demo step 1 (auto-run): Star Brands, 16 Dec 2026, next button "${s1.next}"`);
  await p.click('#trySecond'); await waitStatus(p, /2 contracts/);
  const s2 = await p.evaluate(() => ({ rows: [...document.querySelectorAll('#lq .rname')].map(e => e.textContent), next: document.querySelector('#trySecond').textContent }));
  ok(s2.rows.length === 1 && /^StableX \/ Kopin/.test(s2.rows[0]) && s2.next === 'Add Dragonfly / Keystone RV', `demo step 2: StableX added, next "${s2.next}"`);
  await p.click('#trySecond'); await waitStatus(p, /3 contracts/); await sleep(700);
  const s3 = await p.evaluate(() => ({ open: document.querySelector('#answer .iname').textContent, rows: [...document.querySelectorAll('#lq .rname')].map(e => e.textContent.replace(/\s*New$/, '')), st: document.querySelector('#status').textContent }));
  ok(s3.open === 'Star Brands / Schwazze' && s3.rows.join('|') === 'Dragonfly / Keystone RV|StableX / Kopin' && /^Added Dragonfly \/ Keystone RV: 3 contracts/.test(s3.st), `demo step 3: Dragonfly added; open card Star Brands, rows ${s3.rows.join(', ')}`);
  await p.ctx.close(); }

for (const w of [1440, 375]) {
  // F1 calendar
  { const p = await fresh('/?demo=1&asof=2026-10-19', w); await demo3(p);
    const links = await p.$$eval('a.gcal', as => as.map(a => ({ href: a.href, target: a.target, row: a.closest('.lrow')?.querySelector('.rname')?.textContent || 'card' })));
    const star = links.find(l => l.row === 'card'), stab = links.find(l => /StableX/.test(l.row)), drag = links.find(l => /Dragonfly/.test(l.row));
    ok(links.length === 3 && star && stab && drag, `${w}: Google Calendar link on the card and on every row (${links.length})`);
    ok(new URL(drag.href).searchParams.get('dates') === '20270917/20270918', `${w}: passed Dragonfly row links its next deadline, Fri 17 Sep 2027 (19 Sep is a Sunday)`);
    const u = new URL(star.href); ok(u.hostname === 'calendar.google.com' && u.searchParams.get('action') === 'TEMPLATE' && u.searchParams.get('dates') === '20261216/20261217' && u.searchParams.get('text') === 'Send non-renewal notice: Star Brands / Schwazze' && star.target === '_blank' && !/ /.test(star.href), `${w}: card link encodes Star Brands on 16 Dec 2026`);
    ok(new URL(stab.href).searchParams.get('dates') === '20300125/20300126', `${w}: StableX link is on Fri 25 Jan 2030 (26 Jan is a Saturday)`);
    await p.click('#lqIcs'); const ics = (await lastDl(p)).buf.toString();
    const ev = ics.split('BEGIN:VEVENT').slice(1).filter(e => /SUMMARY:Send-notice/.test(e));
    ok(ev.length === 3 && ev.every(e => /TRIGGER:-P30D[\s\S]*TRIGGER:-P14D[\s\S]*TRIGGER:-P7D/.test(e) && (e.match(/BEGIN:VALARM/g) || []).length === 3), `${w}: queue "Export .ics" downloads 3 send-notice events (Star Brands, StableX, Dragonfly next), each with 30/14/7-day alarms`);
    await p.evaluate(() => document.querySelector('a.gcal').scrollIntoView({ block: 'center' })); await shot(p, 'f1-calendar', w);
    await p.ctx.close(); }
  // F2 letter
  { const p = await fresh('/?demo=1&asof=2026-10-19', w); await p.ctx.overridePermissions(BASE, ['clipboard-read', 'clipboard-write']);
    await auto(p); await p.click('#answerLetter'); await sleep(300);
    const t = await p.$eval('#letterText', e => e.textContent);
    ok(/^DRAFT\. NOT SENT\./.test(t) && /Star Brands and Schwazze/.test(t) && /Renewal clause \(lines 24–29\): "If not otherwise terminated/.test(t) && /16 December 2026/.test(t) && /\[NOTICE ADDRESS, FILL IN\] \(no notice address/.test(t), `${w}: letter has DRAFT, parties, quoted clause, send-by date, missing address marker`);
    await p.click('#letterCopy'); await sleep(300); const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    ok(clip === t && await p.$eval('#letterCopy', e => e.textContent) === 'Copied', `${w}: Copy puts the exact letter on the clipboard`);
    await p.click('#letterDocx'); const d = await lastDl(p); const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccl-')), 'l.docx'); fs.writeFileSync(f, d.buf);
    const xml = execFileSync('unzip', ['-p', f, 'word/document.xml']).toString();
    ok(/wordprocessingml/.test(d.type) && /No errors/.test(execFileSync('unzip', ['-t', f]).toString()) && /DRAFT\. NOT SENT/.test(xml) && /16 December 2026/.test(xml), `${w}: .docx downloads and unzips with the letter text`);
    // round trip: the app's own DOCX reader (mammoth) reads the generated file
    const back = await p.evaluate(async b64 => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return (await window.mammoth.extractRawText({ arrayBuffer: u.buffer })).value; }, d.buf.toString('base64'));
    ok(/This notice is given on or before 16 December 2026/.test(back), `${w}: mammoth opens the generated .docx`);
    await shot(p, 'f2-letter', w); await p.ctx.close(); }
  // F3 obligations (Cerus / Purolite in the SEC set)
  { const p = await fresh('/?set=sec&asof=2026-10-19', w); await p.waitForSelector('#queue li[data-id="c1"]'); await p.click('#queue li[data-id="c1"]'); await sleep(400);
    const o = await p.$eval('.obl', e => [...e.querySelectorAll('.it')].map(i => i.innerText.replace(/\s+/g, ' ')));
    ok(o.length === 4 && /NOTICE METHOD AND ADDRESS/i.test(o[0]) && /2550 Stanwell Drive/.test(o[0]) && /lines 67–72/.test(o[0]) && /line 66/.test(o[0]), `${w}: Cerus notice method and both addresses quoted with lines`);
    ok(/Not found in this document/.test(o[1]) && /Not found in this document/.test(o[2]) && /Not found in this document/.test(o[3]), `${w}: Cerus has no TfC, escalator or payment clause: left blank`);
    await p.evaluate(() => document.querySelector('.obl').scrollIntoView()); await shot(p, 'f3-obligations', w);
    await p.click('#close'); await p.click('#queue li[data-id="c6"]'); await sleep(400);
    const v = await p.$eval('.obl .ob-esc', e => e.innerText.replace(/\s+/g, ' '));
    ok(/shall not exceed 8%/.test(v) && /lines 193–194/.test(v), `${w}: Vivos price escalator quoted (lines 193–194)`);
    await p.ctx.close(); }
  // F4 bulk + portfolio
  { const p = await fresh('/?asof=2026-10-19', w);
    await p.evaluate(() => { window.__steps = []; new MutationObserver(() => window.__steps.push(document.querySelector('#busyName').textContent)).observe(document.querySelector('#busyName'), { childList: true, characterData: true, subtree: true }); });
    await drop(p, [['dragonfly.txt', f64('c3-dragonfly.edgar.txt'), 'text/plain'], ['vivos.pdf', f64('c6-vivos-msa.generated.pdf'), 'application/pdf'], ['reborn.docx', f64('c12-reborn-supply.generated.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ['notes.txt', Buffer.from('shopping list: eggs, milk').toString('base64'), 'text/plain']]);
    await waitStatus(p, /^Read 4 files/, 40000);
    const st = await status(p), steps = await p.evaluate(() => [...new Set(window.__steps)]);
    ok(/^Read 4 files: 3 added, 1 not added \(notes\.txt\)\. 3 contracts in the queue\.$/.test(st), `${w}: bulk drop reports the result: ${st}`);
    ok(['File 1 of 4', 'File 2 of 4', 'File 3 of 4', 'File 4 of 4'].every(k => steps.some(s => s.startsWith(k))), `${w}: progress shows File n of 4 for each file`);
    const pf = await p.$$eval('#portfolio .big', ds => ds.map(d => d.querySelector('.bl').textContent + ' ' + d.querySelector('.sv').textContent));
    ok(pf.join('|') === 'Act this month 0|Next 12 months 2|Needs a human look 1', `${w}: portfolio summary ${pf.join(', ')}`);
    await p.evaluate(() => document.querySelector('#portfolio').scrollIntoView({ block: 'start' })); await sleep(300); await shot(p, 'f4-portfolio', w);
    // F5 audit CSV from the same queue
    await p.click('#lqAudit'); const csv = (await lastDl(p)).buf.toString().trim().split('\r\n');
    ok(csv.length === 4 && /^contract,counterparty,deadline,send_by_business_day,days_from_as_of,as_of,status,needs_review,review_reason,confidence,evidence_location,evidence_quote,source$/.test(csv[0]) && csv.some(l => /Missed: send-notice deadline passed/.test(l)) && csv.slice(1).every(l => /,2026-10-19,/.test(l)), `${w}: audit CSV: header + one row per contract with status and evidence`);
    await p.evaluate(() => document.querySelector('#lqAudit').scrollIntoView({ block: 'center' })); await shot(p, 'f5-audit', w);
    await p.ctx.close(); }
  // F6 storage
  { const p = await fresh('/?asof=2026-10-19', w); await p.evaluate(() => localStorage.setItem('cc-docs', '{broken')); await p.reload({ waitUntil: 'networkidle0' }); await sleep(300);
    ok(/could not be read and were cleared/.test(await status(p)) && await p.evaluate(() => localStorage.getItem('cc-docs') === null && !document.querySelector('#remember').checked), `${w}: corrupt saved data with Remember off: plain message, cleared`);
    await p.ctx.close(); }
  { const p = await fresh('/?asof=2026-10-19', w); await p.click('#tryOne'); await p.waitForFunction(() => !document.querySelector('#answer').hidden);
    await p.evaluate(() => { document.querySelector('#about').open = true; document.querySelector('#remember').click(); });
    await p.click('#trySecond'); await waitStatus(p, /2 contracts/);
    await p.reload({ waitUntil: 'networkidle0' }); await sleep(300);
    ok(await p.evaluate(() => document.querySelector('#answer .iname')?.textContent === 'Star Brands / Schwazze' && document.querySelectorAll('#lq li[data-id]').length === 1), `${w}: with Remember ticked, the queue comes back after reload`);
    await p.evaluate(() => localStorage.setItem('cc-docs', '{broken')); await p.reload({ waitUntil: 'networkidle0' }); await sleep(300);
    ok(/could not be read and were cleared/.test(await status(p)) && await p.evaluate(() => document.querySelector('#answer').hidden && !/broken/.test(localStorage.getItem('cc-docs') || '')), `${w}: corrupt storage is cleared with a plain message, no crash`);
    await p.evaluate(() => localStorage.setItem('cc-remember', '1') || localStorage.setItem('cc-docs', JSON.stringify([{ name: 'ok', fileName: 'a.txt', lines: ['MASTER AGREEMENT', 'The initial term is one (1) year from January 1, 2026 and renews automatically for successive one (1) year terms unless either party gives sixty (60) days notice of non-renewal.'] }, 42]))); await p.reload({ waitUntil: 'networkidle0' }); await sleep(300);
    ok(/^1 saved entry could not be read and was removed\. 1 saved contract kept\.$/.test(await status(p)) && await p.evaluate(() => !document.querySelector('#answer').hidden && JSON.parse(localStorage.getItem('cc-docs')).length === 1), `${w}: partly bad storage: plain message, good entry kept, bad one dropped from storage`);
    await p.evaluate(() => { localStorage.removeItem('cc-remember'); localStorage.setItem('cc-docs', JSON.stringify([{ name: 'ok', fileName: 'a.txt', lines: ['MASTER AGREEMENT', 'The initial term is one (1) year from January 1, 2026 and renews automatically for successive one (1) year terms unless either party gives sixty (60) days notice of non-renewal.'] }, 5])); }); await p.reload({ waitUntil: 'networkidle0' }); await sleep(300);
    const ask = await p.evaluate(() => ({ above: document.querySelector('#loadSaved').getBoundingClientRect().bottom <= innerHeight && document.querySelector('#delSaved').getBoundingClientRect().bottom <= innerHeight && document.querySelector('#savedAsk').getBoundingClientRect().top < document.querySelector('#drop').getBoundingClientRect().top && document.querySelector('#savedAskText').getAttribute('role') === 'status', vis: !document.querySelector('#savedAsk').hidden && !!document.querySelector('#loadSaved').offsetParent && !!document.querySelector('#delSaved').offsetParent, t: document.querySelector('#savedAskText').textContent }));
    ok(ask.above && ask.vis && ask.t === '1 saved contract is on this device from an earlier visit, not loaded. Keep saving?' && await p.evaluate(() => document.querySelector('#answer').hidden && !document.querySelector('#remember').checked && localStorage.getItem('cc-remember') === null && JSON.parse(localStorage.getItem('cc-docs')).length === 2), `${w}: saved data with Remember off: nothing loaded, Remember unticked, the ask shows Load saved and Delete saved data`);
    await p.click('#loadSaved'); await sleep(300);
    ok(await p.evaluate(() => !document.querySelector('#answer').hidden && document.querySelector('#savedAsk').hidden && localStorage.getItem('cc-remember') === '1' && JSON.parse(localStorage.getItem('cc-docs')).length === 1 && ['lqh', 'answer'].includes(document.activeElement.id)), `${w}: Load saved loads it, turns Remember on and focuses the queue (the answer card when there is one contract)`);
    await p.evaluate(() => { localStorage.removeItem('cc-remember'); }); await p.reload({ waitUntil: 'networkidle0' }); await sleep(300); await p.click('#delSaved'); await sleep(200);
    ok(await p.evaluate(() => localStorage.getItem('cc-docs') === null && document.querySelector('#savedAsk').hidden && document.querySelector('#answer').hidden && document.activeElement.id === 'drop'), `${w}: Delete saved data removes it and focuses the drop zone`);
    await p.evaluate(() => { document.querySelector('#about').open = true; document.querySelector('#resetStore').scrollIntoView({ block: 'center' }); }); await shot(p, 'f6-storage', w);
    await p.click('#resetStore'); await sleep(200);
    ok(await p.evaluate(() => document.querySelector('#answer').hidden && localStorage.getItem('cc-docs') === null && localStorage.getItem('cc-remember') === null && !document.querySelector('#remember').checked) && /Saved data deleted/.test(await status(p)), `${w}: reset deletes saved data and empties the queue`);
    await p.reload({ waitUntil: 'networkidle0' }); ok(await p.evaluate(() => document.querySelector('#answer').hidden), `${w}: nothing comes back after reset`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}: no sideways scroll`);
    await p.ctx.close(); }
  // "within N days prior": earliest safe date shown with the on-or-after label on every surface
  { const p = await fresh('/?asof=2026-10-20', w); const W = 'Needs review: two readings. The clause says "within sixty (60) days prior". If that opens a window, send between Mon 2 Nov 2026 and 31 Dec 2026. If it means at least 60 days before, the cutoff is Sun 1 Nov 2026. Notice delivered on Sun 1 Nov 2026 satisfies both, if the notices clause allows a delivery method that works that day';
    const T = 'MASTER SUPPLY AGREEMENT\nThis Agreement is effective as of January 1, 2026 (the "Effective Date").\n2. Term. The initial term of this Agreement shall commence on the Effective Date and end on December 31, 2026. Thereafter this Agreement shall automatically renew for successive one (1) year terms unless either party gives written notice of non-renewal within sixty (60) days prior to the end of the then-current term.';
    await p.click('#pasteBtn'); await p.$eval('#paste', (e, v) => { e.value = v; }, T); await p.click('#addPaste'); await waitStatus(p, /^Read/);
    const a = await p.evaluate(() => ({ chip: document.querySelector('#answer .chips').textContent, cl: document.querySelector('#answer .cl-d')?.textContent, k: document.querySelector('#answer .aleft > .lab').textContent, h: document.querySelector('#answerBig').textContent, t: document.querySelector('#answer').innerText, g: decodeURIComponent(document.querySelector('#answer a.gcal')?.href || '') }));
    ok(a.chip === 'Window opens in 12 days' && a.cl === 'Window opens 1 Nov 2026', `${w}: card counts down to and plots the window-open date (${a.chip}, ${a.cl})`);
    ok(a.k === 'Send notice on' && a.h === '1 Nov 2026' && a.t.includes(W) && !/Send by Fri 30 Oct|earliest safe/.test(a.t) && /Needs review · two readings/.test(a.t), `${w}: answer card gives both readings and the day that satisfies both (${a.k} ${a.h})`);
    ok(/text=Window opens: send notice from 1 Nov 2026 \(two readings\): /.test(a.g) && /dates=20261101\/20261102/.test(a.g) && a.g.includes('Send notice on Sun 1 Nov 2026. ' + W), `${w}: Google Calendar link is on 1 Nov with both readings`);
    await p.click('#answerMore'); await sleep(300); const dr = await p.$eval('#dbody', e => e.innerText);
    ok(dr.includes('Send notice on Sun 1 Nov 2026. ' + W) && dr.includes('Notice window opens') && dr.includes('Needs review: two readings') && !/Send-notice deadline/.test(dr), `${w}: drawer item is Notice window opens, sentence case, with the window note`); await p.evaluate(() => document.querySelector('#close').click()); await sleep(200);
    await p.evaluate(() => document.querySelector('#answerLetter').click()); await sleep(300); const lt = await p.$eval('#letterText', e => e.textContent);
    ok(lt.includes('before the end of the current term, on 1 November 2026, as the clause above requires.') && !lt.includes(W) && (lt.match(/within sixty/g) || []).length === 1 && !/on or before 1 November/.test(lt), `${w}: letter gives notice on or after the window opens`); await p.evaluate(() => document.querySelector('#close').click()); await sleep(200);
    await p.evaluate(() => document.querySelector('#pasteBtn').click()); await p.$eval('#paste', (e, v) => { e.value = v; }, fs.readFileSync(fx('c3-dragonfly.edgar.txt'), 'utf8')); await p.click('#addPaste'); await waitStatus(p, /2 contracts/);
    const q = await p.evaluate(() => [...document.querySelectorAll('#lq .lrow, #queue li[data-id]')].map(l => l.textContent).find(t => /within sixty \(60\) days prior/.test(t)) || '');
    ok(q.includes('Send notice on') && q.includes(W), `${w}: queue card shows the on-or-after label and window note`);
    await p.ctx.close(); }
}
ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
console.log(`\n${pass} passed, ${fail} failed`); await browser.close(); process.exit(fail ? 1 : 0);
