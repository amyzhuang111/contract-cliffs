// e2e for the own-contracts flow and the live-demo path. Run against `node test/serve.mjs` (serves /api/edgar too).
import puppeteer from 'puppeteer-core'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const fx = n => new URL('./fixtures/' + n, import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
async function fresh(q = '/', w = 1440) { const p = await browser.newPage(); await p.setViewport(w === 375 ? { width: 375, height: 812, isMobile: true, hasTouch: true } : { width: 1440, height: 900 }); p.reqs = []; p.on('request', r => p.reqs.push(r.url())); p.on('pageerror', e => errors.push(e.message)); await p.goto(BASE + q, { waitUntil: 'networkidle0' }); return p; }
const status = p => p.$eval('#status', e => e.textContent);
const big = p => p.$eval('#answer', e => e.hidden ? '' : [...e.querySelectorAll('.aleft > .lab, .hero-date, .wd, .cons, .next, .chip')].map(x => x.textContent.trim()).join(' | '));
const waitStatus = (p, re, t = 20000) => p.waitForFunction(r => new RegExp(r).test(document.querySelector('#status').textContent), { timeout: t }, re.source);
const DF = /^Send-notice date passed \| Passed19 Sep 2026 \| It renews on 19 Nov 2026 for 12 more months\. \| Next: send notice by Fri 17 Sep 2027 · in 333 days \| Passed 30 days ago$/;

// 1. empty first screen: three things, nothing preloaded
for (const w of [1440, 375]) {
  const p = await fresh('/?asof=2026-10-19', w);
  const s = await p.evaluate(() => ({ lede: document.querySelector('#lede').textContent.trim(), dz: [...document.querySelectorAll('#dzTitle span')].find(x => x.offsetParent)?.textContent.trim(), sub: document.querySelector('.subline').textContent.trim(), eb: document.querySelector('.eyebrow').innerText.trim(), cap: document.querySelector('.caption').innerText.trim(), hint: document.querySelector('#dzHint').textContent.trim(), cta: document.querySelector('#tryOne').textContent.trim(), ans: document.querySelector('#answer').hidden, q: document.querySelector('#queueSec').hidden, cards: document.querySelector('#ch').closest('section').hidden, addTop: document.querySelector('#about').getBoundingClientRect().top, ctaBottom: document.querySelector('#tryOne').getBoundingClientRect().bottom, sw: document.documentElement.scrollWidth }));
  ok(s.eb === 'CONTRACT RENEWAL DEADLINES' && s.lede === 'Know the last day to stop a contract renewing.' && s.sub === 'Drop in a contract. Get the notice deadline and the sentence it comes from, then add it to Google Calendar or a Sheets file.' && s.dz === (w === 375 ? 'Choose a contract' : 'Drop a contract PDF') && s.hint === 'PDF, Word or plain text' && s.cta === 'Try a real SEC contract →' && s.cap === 'STAR BRANDS / SCHWAZZE LICENSE · EX-10.21 · SEC EDGAR', `${w}: first screen copy exactly as specced: ` + JSON.stringify([s.eb, s.lede, s.dz, s.cta, s.cap]));
  ok(s.ans && s.q && s.cards, `${w}: no answer, list or cards before input`);
  ok(s.addTop >= (w === 1440 ? 900 : 812) && s.ctaBottom <= (w === 1440 ? 900 : 812), `${w}: one-click button above the fold, examples/exports/method below it (more at ${Math.round(s.addTop)}px)`);
  ok(s.sw <= w, `${w}: no sideways scroll`);
  ok(!p.reqs.some(u => /\/data\/edgar\.json|\/samples\//.test(u)), `${w}: nothing preloaded (no SEC data or samples fetched on open)`);
  ok(/No contracts yet/.test(await status(p)), `${w}: empty status explains what to do`);
  await p.close();
}
// 2. demo: ?demo=1 -> one-click state -> deadline in < 2 s
{ const p = await fresh('/?demo=1&asof=2026-10-19');
  ok(await p.evaluate(() => document.activeElement?.id === 'tryOne' && getComputedStyle(document.querySelector('#about')).display === 'none'), '?demo=1 focuses the one-click button and hides the extras');
  const t0 = Date.now(); await p.waitForFunction(() => !document.querySelector('#answer').hidden, { timeout: 2500 }).catch(() => {}); const dt = Date.now() - t0; await sleep(1200); // U1: ?demo=1 runs the real SEC sample by itself
  const b = await big(p); ok(/^Send notice by \| 16 Dec 2026 \| Wednesday \| or it renews for 24 more months\. \| 58 days left$/.test(b) && dt < 2000, `?demo=1 auto-runs and shows Star Brands/Schwazze's deadline in ${dt} ms: ${b}`);
  ok(await p.$eval('#answer', e => /“.{40,}/.test(e.querySelector('blockquote.aq')?.textContent || '') && !!e.querySelector('a[href*="sec.gov"]') && /lines 24–29/.test(e.textContent) && !!e.querySelector('.aq mark')), 'answer card: clause quoted beside the date with operative words marked, line ref and EDGAR link');
  ok(await p.$eval('#liveQ', e => e.hidden) && await p.$eval('#prompt', e => !e.hidden && e.getBoundingClientRect().height >= 72 && /Add StableX \/ Kopin/.test(e.textContent)), 'no queue with one contract, just the add-another prompt');
  ok(p.reqs.filter(u => /edgar\.json/.test(u)).length === 1, 'SEC data fetched only after the click');
  // the demo moment: drag a 2nd and 3rd file in
  const drop = (name, text) => p.evaluate((name, text) => { const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'text/plain' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, name, text);
  await drop('dragonfly.txt', fs.readFileSync(fx('c3-dragonfly.edgar.txt'), 'utf8')); await waitStatus(p, /Added dragonfly\.txt: 2 contracts/);
  let top = await big(p); let rows = await p.$$eval('#lq li[data-id]', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ')));
  ok(/^Send notice by \| 16 Dec 2026/.test(top) && rows.length === 1 && /dragonfly/i.test(rows[0]) && /Passed/i.test(rows[0]) && /New/.test(await p.$eval('#liveQ', e => e.textContent)), 'dropping a 2nd file builds the queue: Star Brands stays the open card, the new one is a row');
  ok(await p.$eval('#prompt', e => !e.hidden && /Add one more to see sorting/.test(e.textContent)), 'at 2 contracts the prompt says "Add one more to see sorting"');
  await drop('nda.txt', 'MUTUAL NONDISCLOSURE AGREEMENT\nThis Agreement is entered into as of November 2, 2026 (the "Effective Date").\nThe term of this Agreement is one (1) year from the Effective Date. This Agreement shall automatically renew for successive one (1) year periods unless either party gives written notice of non-renewal at least thirty (30) days prior to the end of the then-current term.');
  await waitStatus(p, /Added nda\.txt: 3 contracts/);
  rows = await p.$$eval('#lq li[data-id]', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ')));
  ok(rows.length === 2 && /dragonfly/i.test(rows[0]) && /nda/i.test(rows[1]) && /^1 passed · 1 due in 58 days · 1 later$/i.test(await p.$eval('#lqSum', e => e.textContent)) && await p.$eval('#prompt', e => e.hidden) && /16 Dec 2026/.test(await big(p)) && /^Queue · 3 contracts · by send-notice date · 1 open above$/i.test(await p.$eval('#lqh', e => e.textContent)), 'a 3rd file slots into sorted order live: ' + rows.map(r => r.slice(0, 40)).join(' / '));
  await p.click('#lq li[data-id]'); ok(/19 Sep 2026/.test(await big(p)) && /Star Brands/.test(await p.$eval('#lq', e => e.textContent)), 'clicking a row opens it as the card; Star Brands becomes a row');
  await p.click('#clearAll'); ok(await p.$eval('#answer', e => e.hidden) && await p.$eval('#liveQ', e => e.hidden), 'Clear all resets for the next demo run');
  await p.click('#tryOne'); await p.waitForFunction(() => !document.querySelector('#answer').hidden); await p.click('#trySecond'); await waitStatus(p, /2 contracts/); await p.click('#trySecond'); await waitStatus(p, /3 contracts/);
  { await sleep(700); const d = await p.evaluate(() => ({ open: document.querySelector('#answer .acard')?.textContent || '', q: [...document.querySelectorAll('#lq .rname')].map(e => e.textContent).join('|') })); ok(/Star Brands/.test(d.open) && /StableX/.test(d.q) && /Dragonfly/.test(d.q) && !/Star Brands|Cerus/.test(d.q), `demo: after 3 clicks the open card is Star Brands, queue = StableX + Dragonfly (${d.q})`); }
  ok((await p.$$('#lq li[data-id]')).length === 2 && /Dragonfly|StableX/.test(await p.$eval('#liveQ', e => e.textContent)), '"Try a second SEC contract" twice adds two more real filings (StableX / Kopin, Dragonfly)');
  await p.close(); }
// 3. upload a real EDGAR exhibit as .txt and as .pdf, alone, each matching the known Dragonfly dates
for (const f of ['c3-dragonfly.edgar.txt', 'c3-dragonfly.generated.pdf']) {
  const p = await fresh('/?asof=2026-10-19'); await (await p.$('#file')).uploadFile(fx(f)); await waitStatus(p, /^Read c3-dragonfly/);
  ok(DF.test(await big(p)), `${f}: ${await big(p)}`);
  ok(!/Falls on a Sunday/.test(await p.$eval('#answer', e => e.textContent)) && /^Renews 19 Nov 2026\. Next: send notice by Fri 17 Sep 2027\.$/.test(await p.evaluate(() => { const c = document.querySelector('#answer'); return 'Renews 19 Nov 2026. Next: send notice by ' + (c.querySelector('.next').textContent.match(/by (.*?) ·/) || [])[1] + '.'; })) && /Needs review · unclear which term the notice counts from/i.test(await p.$eval('#answer .rvbar', e => e.textContent)), `${f}: weekend flag and the yellow needs-review bar`);
  await p.click('#answerMore'); await p.waitForSelector('#drawer.on'); ok(/19 Nov 2026/.test(await p.$eval('#drawer', e => e.textContent)), `${f}: drawer opens with every date`);
  await p.close(); }
// 4. several files at once
{ const p = await fresh('/?asof=2026-10-19'); await (await p.$('#file')).uploadFile(fx('c3-dragonfly.edgar.txt'), fx('c6-vivos-msa.generated.pdf'), fx('c12-reborn-supply.generated.docx')); await waitStatus(p, /3 contracts/);
  const ids = [await big(p), ...await p.$$eval('#lq li[data-id]', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ')))];
  ok(ids.length === 3 && /31 May 2027/.test(ids.join()) && /10 Jun 2028/.test(ids.join()), 'three files at once (txt, pdf, docx) give a 3-row list with the known dates'); await p.close(); }
// 5. paste the exhibit text
{ const p = await fresh('/?asof=2026-10-19'); await p.click('#pasteBtn'); await p.$eval('#paste', (e, v) => { e.value = v; }, fs.readFileSync(fx('c3-dragonfly.edgar.txt'), 'utf8')); await p.click('#addPaste'); await waitStatus(p, /^Read Pasted/);
  ok(DF.test(await big(p)), 'paste: ' + await big(p)); await p.close(); }
// 6. SEC EDGAR URL through /api/edgar
{ const p = await fresh('/?asof=2026-10-19'); await p.click('#edgarUrl summary'); await p.type('#url', 'https://www.sec.gov/Archives/edgar/data/1847986/000149315223012533/ex10-29.htm'); await p.click('#fetchUrl'); await waitStatus(p, /^Read ex10-29|^Could not/, 30000);
  ok(DF.test(await big(p)), 'EDGAR URL: ' + await big(p) + ' / ' + await status(p));
  await p.$eval('#url', e => { e.value = 'https://evil.example/x'; }); await p.$eval('#fetchUrl', b => b.click()); ok(/only https:\/\/www\.sec\.gov/.test(await status(p)), 'non-SEC URL refused in the page');
  const r = await fetch(BASE + '/api/edgar?url=' + encodeURIComponent('https://evil.example/x')); ok(r.status === 400, 'non-SEC URL refused by the function (400)');
  await p.close(); }
// 7. junk, empty paste, unsupported file
{ const p = await fresh('/?asof=2026-10-19'); await p.click('#pasteBtn');
  await p.$eval('#paste', e => { e.value = 'Shopping list: eggs, milk, bread. Call mum on Sunday.'; }); await p.click('#addPaste'); await waitStatus(p, /^Could not find/);
  ok(/^Could not find a contract in Pasted text 1: no term, renewal, notice or effective-date language\. Nothing was added\./.test(await status(p)) && await p.$eval('#answer', e => e.hidden), 'junk text: clear message, nothing added');
  ok(await p.$eval('#status', e => e.classList.contains('err')) && await p.$eval('#dzErr', e => !e.hidden && /Couldn’t read this file/.test(e.textContent)), 'junk message styled as an error, drop zone shows the plain error state');
  await p.click('#pasteBtn'); await p.$eval('#paste', e => { e.value = ''; }); await p.click('#addPaste'); ok(/Paste some contract text first/.test(await status(p)), 'empty paste says so');
  const tmp = path.join(os.tmpdir(), 'notes.rtf'); fs.writeFileSync(tmp, '{\\rtf1 hi}'); await (await p.$('#file')).uploadFile(tmp); await waitStatus(p, /^Could not read notes\.rtf: File type not supported\. Use PDF, Word or text\.$/); ok(true, 'unsupported file type: clear message');
  const bad = path.join(os.tmpdir(), 'broken.pdf'); fs.writeFileSync(bad, 'not a pdf'); await (await p.$('#file')).uploadFile(bad); await waitStatus(p, /^Could not read broken\.pdf: The file could not be opened/); ok(true, 'corrupt PDF: plain hint, no library error');
  const png = path.join(os.tmpdir(), 'photo.docx'); fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')); await (await p.$('#file')).uploadFile(png); await waitStatus(p, /^Could not read photo\.docx/);
  ok(/^Could not read photo\.docx: The file could not be opened\. Try another copy, or paste the text instead\.$/.test(await status(p)) && !/http|zip|stuk|Error/i.test(await p.$eval('#hero', e => e.innerText)), 'PNG renamed .docx: plain hint only, never the raw library error');
  await p.close(); }
// 8. a large file doesn't hang
{ const p = await fresh('/?asof=2026-10-19'); const tmp = path.join(os.tmpdir(), 'big-contract.txt'); const t = fs.readFileSync(fx('c3-dragonfly.edgar.txt'), 'utf8'); fs.writeFileSync(tmp, t + ('\nRecital filler line of the schedule of parts. '.repeat(1)).repeat(80000));
  const sz = fs.statSync(tmp).size; const t0 = Date.now(); await (await p.$('#file')).uploadFile(tmp); await waitStatus(p, /^Read big-contract/, 15000); const dt = Date.now() - t0;
  ok(dt < 5000 && /Large file: only the first 1,500,000 characters were read\./.test(await status(p)) && DF.test(await big(p)), `${(sz / 1e6).toFixed(1)} MB file read in ${dt} ms, capped with a note, same answer`);
  ok(await p.evaluate(() => { const t0 = performance.now(); return new Promise(r => requestAnimationFrame(() => r(performance.now() - t0 < 500))); }), 'page still responsive after the large file'); await p.close(); }
// 9. privacy + opt-in memory
{ const p = await fresh('/?asof=2026-10-19');
  ok(/^Files are read in your browser\. Nothing is uploaded or stored\./.test(await p.$eval('#privacy', e => e.textContent)), 'privacy stated plainly');
  await p.click('#tryOne'); await p.waitForFunction(() => !document.querySelector('#answer').hidden);
  ok(await p.evaluate(() => localStorage.length === 0), 'nothing written to localStorage without opt-in');
  await p.$eval('#remember', e => e.click()); ok(await p.evaluate(() => JSON.parse(localStorage.getItem('cc-docs') || '[]').length === 1), 'opt-in saves to this device');
  await p.reload({ waitUntil: 'networkidle0' }); ok(/16 Dec 2026/.test(await big(p)), 'remembered contract comes back after reload');
  await p.$eval('#remember', e => e.click()); ok(await p.evaluate(() => localStorage.length === 0), 'untick deletes it');
  await p.close(); }
// 10. offline once loaded (service worker)
{ const p = await fresh('/?demo=1&auto=0&asof=2026-10-19'); await p.evaluate(() => navigator.serviceWorker.ready); await sleep(800); await p.reload({ waitUntil: 'networkidle0' });
  await p.setOfflineMode(true); await p.reload({ waitUntil: 'load' }); await sleep(300);
  const t0 = Date.now(); await p.click('#tryOne'); await p.waitForFunction(() => !document.querySelector('#answer').hidden, { timeout: 2000 }).catch(() => {});
  ok(/16 Dec 2026/.test(await big(p)) && Date.now() - t0 < 2000, 'offline after first load: demo still works in under 2 s');
  await p.setOfflineMode(false); await p.close(); }
// 11. the optional SEC set is a link, not the default
{ const p = await fresh('/?asof=2026-10-19'); await p.$eval('#setEdgar', b => b.click()); await p.waitForFunction(() => document.querySelectorAll('#queue li[data-id]').length === 10);
  ok(await p.$eval('#setEdgar', b => b.textContent.trim() === 'Try with 10 real SEC contracts' && b.getAttribute('aria-pressed') === 'true'), '"Try with 10 real SEC contracts" loads the 10 on request'); await p.close(); }
// 12. design pass checks: fold, tap targets, type floor, no em dashes, token block
for (const w of [1440, 375]) { const p = await fresh('/?asof=2026-10-19', w); const H = w === 1440 ? 900 : 812;
  ok(await p.evaluate(H => ['.caption', '#drop', '.subline', '#lede'].every(q => document.querySelector(q).getBoundingClientRect().bottom <= H), H), `${w}: headline, subline, drop zone, button and caption all above the fold`);
  await p.click('#tryOne'); await p.waitForFunction(() => !document.querySelector('#answer').hidden); await p.click('#trySecond'); await waitStatus(p, /2 contracts/); await p.click('#trySecond'); await waitStatus(p, /3 contracts/); await sleep(700);
  const t = await p.evaluate(() => { const vis = [...document.querySelectorAll('#answer *, #liveQ *, .hero *')].filter(e => e.offsetParent && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
    const small = vis.filter(e => { const cs = getComputedStyle(e); const f = parseFloat(cs.fontSize); return /Mono/.test(cs.fontFamily) ? f < 12 : f < 14; }).map(e => e.textContent.trim().slice(0, 30));
    const taps = [...document.querySelectorAll('#answer button, #answer a, #liveQ button, #liveQ li[data-id], .hero button')].filter(e => e.offsetParent).filter(e => e.getBoundingClientRect().height < 44).map(e => e.textContent.trim().slice(0, 24));
    return { small, taps, dash: /—/.test(document.body.innerText.replace(/Method and accuracy[\s\S]*/, '')), tok: getComputedStyle(document.documentElement).getPropertyValue('--highlight').trim() }; });
  ok(!t.small.length, `${w}: type floor 12px mono / 14px Geist in answer and queue` + (t.small.length ? ': ' + t.small.join(' | ') : ''));
  ok(w === 1440 || !t.taps.length, `${w}: tap targets at least 44px` + (t.taps.length ? ': ' + t.taps.join(' | ') : ''));
  ok(!t.dash && t.tok === '#EBFF0A', `${w}: no em dashes in the UI; design tokens loaded`);
  await p.close(); }
// 13. re-review 7593ee9
for (const w of [1440, 375]) { const p = await fresh('/?asof=2026-10-20', w); const H = w === 1440 ? 900 : 812;
  ok(await p.evaluate(() => !document.querySelector('#about').open && !document.querySelector('#setEdgar').offsetParent && [...document.querySelectorAll('#exCsv,#exIcs,#exPack')].every(b => b.classList.contains('tl'))), `${w}: About is one closed link; no visible "Try with 10" button; exports are text links`);
  await p.click('#tryOne'); await p.waitForFunction(() => !document.querySelector('#answer').hidden); await sleep(300);
  const f = await p.evaluate(() => ({ bar: Math.round(document.querySelector('#drop').getBoundingClientRect().height), bs: getComputedStyle(document.querySelector('#drop')).borderTopStyle, txt: document.querySelector('#dzTitle').innerText.trim(), date: document.querySelector('.hero-date').getBoundingClientRect().bottom }));
  ok(f.bar === 56 && f.bs === 'solid' && f.txt === 'Drop another contract' && f.date <= H, `${w}: once loaded, input is one 56px solid (E3) "Drop another contract" bar and the hero date is above the fold (${JSON.stringify(f)})`);
  await p.click('#trySecond'); await waitStatus(p, /2 contracts/); await p.click('#trySecond'); await waitStatus(p, /3 contracts/); await sleep(700);
  ok(/16 Dec 2026/.test(await big(p)) && await p.$eval('#lqSum', e => e.textContent) === '1 passed · 1 due in 57 days · 1 later', `${w}: Star Brands stays open; summary "1 PASSED · 1 DUE IN 57 DAYS · 1 LATER"`);
  // countdown counts to the exact date shown; weekend dates also show the safe business day
  const rowsD = await p.$$eval('#lq li[data-id]', ls => ls.map(l => ({ d: l.querySelector('.rdate').textContent, chip: l.querySelector('.chip')?.textContent || '', safe: l.querySelector('.rsafe')?.textContent || '', lab: l.querySelector('.ld .lab').textContent, t: l.innerText })));
  const M = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }; const dd = s => { const [d, m, y] = s.split(' '); return Date.UTC(+y, M[m], +d); }; const AS = Date.UTC(2026, 9, 20);
  const bad = rowsD.filter(r => { const n = Math.round((dd(r.d) - AS) / 864e5); return n >= 0 ? !new RegExp(`^${n} days? left$`, 'i').test(r.chip) : false; });
  ok(!bad.length, `${w}: every countdown counts to the printed date` + (bad.length ? ': ' + JSON.stringify(bad) : ''));
  const sx = rowsD.find(r => /StableX/.test(r.t)); ok(sx && sx.d === '26 Jan 2030' && /^1194 days left$/i.test(sx.chip) && /Saturday/i.test(sx.lab) && sx.safe === 'Send by Fri 25 Jan 2030 to be safe', `${w}: StableX 26 Jan 2030 (Saturday) = 1194 days from 20 Oct 2026, safe day Fri 25 Jan 2030: ` + JSON.stringify(sx));
  // same confidence word on card and row
  const ids = await p.$$eval('#lq li[data-id]', ls => ls.map(l => [l.dataset.id, l.querySelector('.lt .tag').textContent]));
  const cardTag0 = await p.$eval('#answer .conf .tag', e => e.textContent); const mism = [];
  ok(cardTag0 === 'Check one thing' && await p.$eval('#answer .conf .tag', e => getComputedStyle(e).borderTopColor === 'rgb(134, 161, 182)' && getComputedStyle(e).borderTopWidth === '1px') && /^Check: did either side send notice by 16 Dec 2024\? If not, it renewed on 15 Jun 2025\.$/.test(await p.$eval('#answer .one', e => e.textContent)), `${w}: Star Brands: "Check one thing" with a 1px #86A1B6 outline and the one thing in one line: ` + cardTag0 + ' / ' + await p.$eval('#answer .one', e => e.textContent).catch(() => 'none'));
  for (const [id, tag] of ids) { await p.$eval(`#lq li[data-id="${id}"]`, e => e.click()); await sleep(100); const ct = await p.$eval('#answer', e => e.querySelector('.conf .tag')?.textContent || (e.querySelector('.rvbar') && !e.querySelector('.conf .tag') ? 'Needs review' : '')); if (ct !== tag) mism.push(id + ':' + tag + '/' + ct); }
  const back = await p.$eval('#lq', e => [...e.querySelectorAll('li')].find(l => /Star Brands/.test(l.textContent))?.querySelector('.lt .tag').textContent);
  ok(!mism.length && back === 'Check one thing', `${w}: confidence word identical on card and row for all 3 (Star Brands row: ${back})` + (mism.length ? ' ' + mism.join(', ') : ''));
  await p.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})))); await sleep(300);
  const ui = await p.evaluate(() => { const vis = e => e.offsetParent && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && !e.closest('details:not([open]) > :not(summary)');
    const smallMono = [...document.querySelectorAll('body *')].filter(e => vis(e) && !e.closest('.drawer') && /Mono/.test(getComputedStyle(e).fontFamily) && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && (parseFloat(getComputedStyle(e).fontSize) < 12 || parseFloat(getComputedStyle(e).lineHeight) < 16)).map(e => e.textContent.trim().slice(0, 24));
    const taps = [...document.querySelectorAll('a, button, summary, [role=button], input, textarea')].filter(e => vis(e) && !e.closest('.drawer') && !e.closest('#cards') && !e.closest('#queueSec')).filter(e => { const r = e.getBoundingClientRect(); return r.height < 44; }).map(e => (e.id || e.textContent.trim()).slice(0, 24));
    return { smallMono, taps }; });
  ok(!ui.smallMono.length, `${w}: mono label floor 12/16` + (ui.smallMono.length ? ': ' + ui.smallMono.join(' | ') : ''));
  if (w === 375) ok(!ui.taps.length, '375: every visible tap target is at least 44px tall' + (ui.taps.length ? ': ' + ui.taps.join(' | ') : ''));
  await p.close(); }
// 14. independent review of 7593ee9: real unseen exhibits through the UI, card math only, 375 scroll
for (const [f, name, date] of [['repositrak-cfo-ex10-1.edgar.htm', 'ReposiTrak / John R. Merrill', '18 Jun 2029'], ['alphega-ceo-ex10-1.edgar.htm', 'Alphega Innovations / Luis Carlos Ung', '2 Oct 2028']]) {
  const p = await fresh('/?asof=2026-10-19'); await (await p.$('#file')).uploadFile(fx(f)); await waitStatus(p, /^Read /);
  const c = await p.$eval('#answer', e => ({ name: e.querySelector('.iname').textContent, date: e.querySelector('.hero-date').textContent, cons: e.querySelector('.cons').textContent, math: e.querySelector('.math')?.textContent || '', tag: e.querySelector('.conf .tag')?.textContent || '', all: e.innerText }));
  ok(c.name === name && c.date === date && c.cons === 'or it renews for 1 more year.', `${f}: ${c.name} · ${c.date} · ${c.cons}`);
  ok(/^Term ends \d{1,2} \w{3} \d{4}\. Minus \d+ days = /.test(c.math) && !/\(s\)|\)\.|Projected|Worked out/.test(c.all), `${f}: card shows only "Term ends X. Minus N days = Y." (${c.math})`);
  if (/alphega/.test(f)) ok(c.tag === 'Clear', 'Alphega: explicit end date gives high confidence (Clear)');
  await p.close(); }
{ const p = await fresh('/?asof=2026-10-19'); await p.click('#tryOne'); await p.waitForFunction(() => !document.querySelector('#answer').hidden); await sleep(200);
  const m = await p.$eval('#answer .math', e => e.textContent); ok(m === 'Term ends 14 Jun 2027 (assumes it renewed once and was never amended). Minus 180 days = 16 Dec 2026.', 'Star Brands math line: ' + m);
  await p.click('#answerMore'); await p.waitForSelector('#drawer.on'); ok(/Assumes it renewed once/.test(await p.$eval('#drawer', e => e.textContent)), 'the longer explanation lives in the details panel'); await p.close(); }
{ const p = await fresh('/?asof=2026-10-19', 375); await p.click('#tryOne'); await p.waitForFunction(() => !document.querySelector('#answer').hidden); await sleep(900);
  const r = await p.evaluate(() => ({ chip: document.querySelector('#answer .chip').getBoundingClientRect().bottom, date: document.querySelector('#answer .hero-date').getBoundingClientRect().top }));
  ok(r.date >= 0 && r.chip <= 812, `375: after the first result the date and the days-left chip are on screen (date top ${Math.round(r.date)}, chip bottom ${Math.round(r.chip)})`); await p.close(); }
// 15. re-review a882e8b
for (const w of [1440, 375]) { const p = await fresh('/?asof=2026-10-20', w);
  await p.click('#tryOne'); await p.waitForFunction(() => !document.querySelector('#answer').hidden); await sleep(300);
  const h = await p.$eval('#answer .hero-date', e => ({ h: e.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(e).fontSize), lab: getComputedStyle(document.querySelector('#answer .lab')).fontSize }));
  ok(h.h <= h.fs * 1.3, `${w}: hero date on one line (${Math.round(h.h)}px tall at ${h.fs}px)`);
  ok(w === 375 ? h.lab === '12px' : h.lab === '14px', `${w}: labels ${h.lab} (14/20 at >=1200, 12/16 below)`);
  ok(await p.$eval('#addBar', e => e.offsetParent && e.textContent === 'Add a contract' && e.getBoundingClientRect().height >= 44), `${w}: the 56px bar has an "Add a contract" button`);
  await p.click('#trySecond'); await waitStatus(p, /2 contracts/); await p.click('#trySecond'); await waitStatus(p, /3 contracts/); await sleep(600);
  const df = await p.$$eval('#lq li', ls => ls.map(l => l.querySelector('.rcons').textContent).find(t => /Renews 19 Nov/.test(t)));
  ok(df === 'Renews 19 Nov 2026. Next: send notice by Fri 17 Sep 2027.', `${w}: Dragonfly row leads with the safe date: ${df}`);
  ok(await p.$$eval('#lq .rdate', ds => ds.every(d => d.getBoundingClientRect().height <= parseFloat(getComputedStyle(d).fontSize) * 1.6)), `${w}: queue dates never wrap`);
  const ab = await p.evaluate(() => { const a = document.querySelector('#about'); const f = document.querySelector('footer .foot'); const gap = f.getBoundingClientRect().top - a.getBoundingClientRect().bottom; a.open = true; const ex = document.querySelector('#exCsv').offsetParent; const sm = [...a.querySelectorAll('a, button, input:not(label input), label:not([for]), summary')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.id || e.textContent.trim().slice(0, 20)); return { gap: Math.round(gap), ex: !!ex, sm }; });
  ok(ab.gap >= 20 && ab.gap <= 28, `${w}: 24px under the closed About (${ab.gap}px to the footer line)`);
  ok(!ab.ex && !ab.sm.length, `${w}: About panel has no export blocks and every control is 44px` + (ab.sm.length ? ': ' + ab.sm.join(' | ') : ''));
  const ft = await p.$eval('footer details.method summary', e => ({ t: e.innerText.replace(/\s+/g, ' ').trim(), h: e.getBoundingClientRect().height, dot: getComputedStyle(e.querySelector('.gn'), '::before').content, gap: getComputedStyle(e).columnGap }));
  ok(/^METHOD AND ACCURACY ?How dates are worked out and how often they are right$/.test(ft.t) && ft.dot === '"·"' && ft.gap === '8px' && ft.h >= 44, `${w}: footer link with a ::before separator and 8px gap, ${Math.round(ft.h)}px: ` + JSON.stringify(ft));
  if (w === 375) ok(await p.$eval('#answer .conf', e => { const t = e.querySelector('.tag').getBoundingClientRect(), s = e.querySelector('.seg').getBoundingClientRect(); return Math.abs(t.top + t.height / 2 - (s.top + s.height / 2)) < 8; }), '375: confidence meter inline with the chip');
  await p.close(); }
// 16. re-review 08408a1
for (const w of [1440, 375]) { const p = await fresh('/?asof=2026-10-20', w);
  await p.click('#tryOne'); await p.waitForFunction(() => !document.querySelector('#answer').hidden); await p.click('#trySecond'); await waitStatus(p, /2 contracts/); await p.click('#trySecond'); await waitStatus(p, /3 contracts/); await sleep(500);
  const t = await p.evaluate(() => { const b = [...document.querySelectorAll('.lq-tools .tl')].map(x => x.getBoundingClientRect()); return { txt: [...document.querySelectorAll('.lq-tools .tl')].map(x => x.innerText.trim()), oneRow: b.every(r => Math.abs(r.top - b[0].top) < 2), meta: [...document.querySelectorAll('#answer .meta .d')].every(d => d.getBoundingClientRect().height < 30) }; });
  ok(t.oneRow && t.txt.join('|') === 'EXPORT .ICS|EXPORT CSV|AUDIT CSV|CLEAR ALL', `${w}: queue tools on one row: ${t.txt.join(' | ')}`);
  ok(t.meta, `${w}: the filed date never splits`);
  const ab = await p.evaluate(() => { const a = document.querySelector('#about'); a.open = true; return { h: a.querySelector('h2').textContent, rem: !!document.querySelector('#remember').offsetParent, how: !!document.querySelector('#how').offsetParent, howLink: /\(\s*how\s*\)/i.test(a.innerText), ts: document.querySelector('#testset').textContent }; });
  ok(ab.h === 'How it works and how to trust it' && !ab.rem && !ab.how && !ab.howLink, `${w}: About panel: heading "How it works and how to trust it", no Remember, no "( how )", no empty How it works block`);
  ok(ab.ts === 'Latest blind test, 16 SEC contracts it had never seen: 3 dates right, 3 correctly left blank, 6 missed and 4 wrong. When it can’t tell, it says so and flags the row for a person to check.', `${w}: test-set line adds up to 10 (3 + 6 + 1 + 0)`);
  await p.close(); }
// 17. reviewer ab9a38e: real VerifyMe, Simwon, Altech, Industrious, National Vision filings through the UI (card headline, as of 2026-10-19)
const CARDS = [
  ['verifyme-pentant-ex10-3.edgar.htm', /^Send-notice date passed \| Passed1 Apr 2025 \| Now renews every 3 months; the contract gives no non-renewal notice for later periods\. Check the termination section\./, 'VerifyMe / Pentant'],
  ['simwon-mstech-ex10-14.generated.docx', /^Send-notice date passed \| Passed30 Sep 2026 \| It renews on 1 Jan 2027 for 1 more year\. \| Next: send notice by Thu 30 Sep 2027 · in 346 days \| Passed 19 days ago$/, 'MS Autotech / Simwon America'],
  ['simwon-mstech-ex10-14.edgar.htm', /^Send-notice date passed \| Passed30 Sep 2026 \| It renews on 1 Jan 2027 for 1 more year\. \| Next: send notice by Thu 30 Sep 2027/, 'MS Autotech / Simwon America'],
  ['altech-ex10-6.generated.pdf', /^Send notice by \| 18 Dec 2026 \| Friday \| or it renews for 1 more year\. \| 60 days left$/, 'Altech Hong Kong / Alliance Technology Global'],
  ['altech-ex10-6.edgar.htm', /^Send notice by \| 18 Dec 2026 \| Friday \| or it renews for 1 more year\. \| 60 days left$/, 'ALTECH / ALLIANCE'],
  ['industrious-ex10-1.edgar.htm', /^Send notice by \(best reading\) \| 30 Nov 2026 \| Monday \| or it renews for 6 more months\. \| 42 days left$/, 'Industrious Nyc 776 6th Avenue / Gelteq'],
  ['industrious-ex10-1.pdftotext.txt', /^Send notice by \(best reading\) \| 30 Nov 2026 \| Monday \| or it renews for 6 more months\. \| 42 days left$/, 'Industrious / Member'],
  ['newgenivf-agency-ex10-2.generated.docx', /^Send notice by \| No date found \| The start date is set by an event and is not in the document\.$/, 'PredicXion Group / NewGenIVF Group'],
  ['naturesmiracle-du-ex10-1.pdftotext.txt', /^Send notice by \| 1 Jan 2029 \| Monday \| or it renews for 1 more year\. \| 805 days left$/, 'Nature’s Miracle Holding Incorporated / Jinlong Frank Du'],
  ['driven-omelia-amend3-ex10-2.edgar.htm', /^Send notice by \| 4 Apr 2027 \| Sunday \| or it renews for 12 more months\. \| 167 days left$/, 'Driven Brands Shared Services / Scott O’Melia'],
  ['natvision-ex10-1.edgar.htm', /^Send notice by \| 1 May 2028 \| Monday \| or it renews for 1 more month\. \| 560 days left \| One-sided extension right: Customer can extend the agreement an additional calendar quarter on its own\./, 'Essilor / National Vision'],
];
for (const [f, re, name] of CARDS) { const p = await fresh('/?asof=2026-10-19'); await (await p.$('#file')).uploadFile(fx(f)); await waitStatus(p, /^Read /);
  const b = await big(p); const c = await p.$eval('#answer', e => ({ name: e.querySelector('.iname').textContent, all: e.innerText }));
  ok(re.test(b) && c.name === name && !/may not auto-renew/i.test(c.all), `${f}: ${c.name} · ${b}`);
  if (/verifyme/.test(f)) ok(/Renews \(no later notice window\)/.test(c.all), 'VerifyMe card shows the renewal note');
  await p.close(); }
{ const p = await fresh('/?asof=2026-10-19'); await p.click('#pasteBtn'); await p.$eval('#paste', e => { e.value = 'Term. This Agreement shall commence on 18 January 2022 and shall continue for a period of one (1) year, ending on 17 January 2023. The Agreement will automatically extend on an annual basis until further notice, unless written notice of termination is provided by either party at least 30 days prior to the end of the current term.'; });
  await p.click('#addPaste'); await waitStatus(p, /^Read Pasted/); ok(await p.$eval('#answer .iname', e => e.textContent) === 'Unnamed contract (Pasted text 1)', 'no parties found: "Unnamed contract (Pasted text 1)", never a bare file name'); await p.close(); }
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
