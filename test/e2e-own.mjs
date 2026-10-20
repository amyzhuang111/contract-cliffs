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
const DF = /^Send-notice date passed \| Passed19 Sep 2026 \| It renews on 19 Nov 2026 for 12 more months\. \| Next: send notice by 19 Sep 2027 · Sunday · in 335 days \| Passed 30 days ago$/;

// 1. empty first screen: three things, nothing preloaded
for (const w of [1440, 375]) {
  const p = await fresh('/?asof=2026-10-19', w);
  const s = await p.evaluate(() => ({ lede: document.querySelector('#lede').textContent.trim(), dz: [...document.querySelectorAll('#dzTitle span')].find(x => x.offsetParent)?.textContent.trim(), sub: document.querySelector('.subline').textContent.trim(), eb: document.querySelector('.eyebrow').innerText.trim(), cap: document.querySelector('.caption').innerText.trim(), hint: document.querySelector('#dzHint').textContent.trim(), cta: document.querySelector('#tryOne').textContent.trim(), ans: document.querySelector('#answer').hidden, q: document.querySelector('#queueSec').hidden, cards: document.querySelector('#ch').closest('section').hidden, addTop: document.querySelector('#add').getBoundingClientRect().top, ctaBottom: document.querySelector('#tryOne').getBoundingClientRect().bottom, sw: document.documentElement.scrollWidth }));
  ok(s.eb === 'CONTRACT RENEWAL DEADLINES' && s.lede === 'Find the date you must send notice, before it renews.' && s.sub === 'Drop in a contract. Get the deadline, the exact clause it comes from, and a link to the source.' && s.dz === (w === 375 ? 'Choose a contract or paste text' : 'Drop a contract or paste text') && s.hint === 'PDF, Word or plain text · stays in your browser' && s.cta === 'Try a real SEC contract →' && s.cap === 'STAR BRANDS / SCHWAZZE LICENSE · EX-10.21 · SEC EDGAR', `${w}: first screen copy exactly as specced: ` + JSON.stringify([s.eb, s.lede, s.dz, s.cta, s.cap]));
  ok(s.ans && s.q && s.cards, `${w}: no answer, list or cards before input`);
  ok(s.addTop >= (w === 1440 ? 900 : 812) && s.ctaBottom <= (w === 1440 ? 900 : 812), `${w}: one-click button above the fold, examples/exports/method below it (more at ${Math.round(s.addTop)}px)`);
  ok(s.sw <= w, `${w}: no sideways scroll`);
  ok(!p.reqs.some(u => /\/data\/edgar\.json|\/samples\//.test(u)), `${w}: nothing preloaded (no SEC data or samples fetched on open)`);
  ok(/No contracts yet/.test(await status(p)), `${w}: empty status explains what to do`);
  await p.close();
}
// 2. demo: ?demo=1 -> one-click state -> deadline in < 2 s
{ const p = await fresh('/?demo=1&asof=2026-10-19');
  ok(await p.evaluate(() => document.activeElement?.id === 'tryOne' && getComputedStyle(document.querySelector('#add')).display === 'none' && getComputedStyle(document.querySelector('#how').closest('section')).display !== 'none'), '?demo=1 focuses the one-click button and hides the extras');
  const t0 = Date.now(); await p.keyboard.press('Enter'); await p.waitForFunction(() => !document.querySelector('#answer').hidden, { timeout: 2000 }).catch(() => {}); const dt = Date.now() - t0;
  const b = await big(p); ok(/^Send notice by \| 16 Dec 2026 \| Wednesday \| or it renews for 24 more months\. \| 58 days left$/.test(b) && dt < 2000, `one click shows Star Brands/Schwazze's deadline in ${dt} ms: ${b}`);
  ok(await p.$eval('#answer', e => /“.{40,}/.test(e.querySelector('blockquote.aq')?.textContent || '') && !!e.querySelector('a[href*="sec.gov"]') && /lines 24–29/.test(e.textContent) && !!e.querySelector('.aq mark')), 'answer card: clause quoted beside the date with operative words marked, line ref and EDGAR link');
  ok(await p.$eval('#liveQ', e => e.hidden) && await p.$eval('#prompt', e => !e.hidden && e.getBoundingClientRect().height >= 88), 'no queue with one contract, just the add-another prompt');
  ok(p.reqs.filter(u => /edgar\.json/.test(u)).length === 1, 'SEC data fetched only after the click');
  // the demo moment: drag a 2nd and 3rd file in
  const drop = (name, text) => p.evaluate((name, text) => { const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'text/plain' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, name, text);
  await drop('dragonfly.txt', fs.readFileSync(fx('c3-dragonfly.edgar.txt'), 'utf8')); await waitStatus(p, /Added dragonfly\.txt: 2 contracts/);
  let top = await big(p); let rows = await p.$$eval('#lq li[data-id]', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ')));
  ok(/^Send-notice date passed/.test(top) && rows.length === 1 && /Star Brands/.test(rows[0]) && /58 days left/i.test(rows[0]) && /New/.test(await p.$eval('#liveQ', e => e.textContent)) && /3 contracts|2 contracts/i.test(await p.$eval('#lqh', e => e.textContent)), 'dropping a 2nd file builds the queue: the passed one takes the answer card, Star Brands drops to a row');
  await drop('nda.txt', 'MUTUAL NONDISCLOSURE AGREEMENT\nThis Agreement is entered into as of November 2, 2026 (the "Effective Date").\nThe term of this Agreement is one (1) year from the Effective Date. This Agreement shall automatically renew for successive one (1) year periods unless either party gives written notice of non-renewal at least thirty (30) days prior to the end of the then-current term.');
  await waitStatus(p, /Added nda\.txt: 3 contracts/);
  rows = await p.$$eval('#lq li[data-id]', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ')));
  ok(rows.length === 2 && /Star Brands|Schwazze/i.test(rows[0]) && /nda/i.test(rows[1]) && /Queue · 3 contracts · sorted by send-notice date/i.test(await p.$eval('#lqh', e => e.textContent)), 'a 3rd file slots into sorted order live: ' + rows.map(r => r.slice(0, 40)).join(' / '));
  await p.click('#lq li[data-id]'); ok(/16 Dec 2026/.test(await big(p)), 'clicking a row expands it into the answer card');
  await p.click('#clearAll'); ok(await p.$eval('#answer', e => e.hidden) && await p.$eval('#liveQ', e => e.hidden), 'Clear all resets for the next demo run');
  await p.click('#tryOne'); await p.waitForFunction(() => !document.querySelector('#answer').hidden); await p.click('#trySecond'); await waitStatus(p, /2 contracts/); await p.click('#trySecond'); await waitStatus(p, /3 contracts/);
  ok((await p.$$('#lq li[data-id]')).length === 2 && /Dragonfly|StableX/.test(await p.$eval('#liveQ', e => e.textContent)), '"Try a second SEC contract" twice adds two more real filings (StableX / Kopin, Dragonfly)');
  await p.close(); }
// 3. upload a real EDGAR exhibit as .txt and as .pdf, alone, each matching the known Dragonfly dates
for (const f of ['c3-dragonfly.edgar.txt', 'c3-dragonfly.generated.pdf']) {
  const p = await fresh('/?asof=2026-10-19'); await (await p.$('#file')).uploadFile(fx(f)); await waitStatus(p, /^Read c3-dragonfly/);
  ok(DF.test(await big(p)), `${f}: ${await big(p)}`);
  ok(/Falls on a Sunday\. Send by Fri 17 Sep 2027 to be safe\./.test(await p.$eval('#answer', e => e.textContent)) && /Needs review · unclear which term the notice counts from/i.test(await p.$eval('#answer .rvbar', e => e.textContent)), `${f}: weekend flag and the yellow needs-review bar`);
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
  await p.$eval('#url', e => { e.value = 'https://evil.example/x'; }); await p.click('#fetchUrl'); ok(/only https:\/\/www\.sec\.gov/.test(await status(p)), 'non-SEC URL refused in the page');
  const r = await fetch(BASE + '/api/edgar?url=' + encodeURIComponent('https://evil.example/x')); ok(r.status === 400, 'non-SEC URL refused by the function (400)');
  await p.close(); }
// 7. junk, empty paste, unsupported file
{ const p = await fresh('/?asof=2026-10-19'); await p.click('#pasteBtn');
  await p.$eval('#paste', e => { e.value = 'Shopping list: eggs, milk, bread. Call mum on Sunday.'; }); await p.click('#addPaste'); await waitStatus(p, /^Could not find/);
  ok(/^Could not find a contract in Pasted text 1: no term, renewal, notice or effective-date language\. Nothing was added\./.test(await status(p)) && await p.$eval('#answer', e => e.hidden), 'junk text: clear message, nothing added');
  ok(await p.$eval('#status', e => e.classList.contains('err')) && await p.$eval('#dzErr', e => !e.hidden && /Couldn’t read this file/.test(e.textContent)), 'junk message styled as an error, drop zone shows the plain error state');
  await p.click('#pasteBtn'); await p.$eval('#paste', e => { e.value = ''; }); await p.click('#addPaste'); ok(/Paste some contract text first/.test(await status(p)), 'empty paste says so');
  const tmp = path.join(os.tmpdir(), 'notes.rtf'); fs.writeFileSync(tmp, '{\\rtf1 hi}'); await (await p.$('#file')).uploadFile(tmp); await waitStatus(p, /^Could not read notes\.rtf: unsupported file type/); ok(true, 'unsupported file type: clear message');
  const bad = path.join(os.tmpdir(), 'broken.pdf'); fs.writeFileSync(bad, 'not a pdf'); await (await p.$('#file')).uploadFile(bad); await waitStatus(p, /^Could not read broken\.pdf/); ok(true, 'corrupt PDF: clear message, no crash');
  await p.close(); }
// 8. a large file doesn't hang
{ const p = await fresh('/?asof=2026-10-19'); const tmp = path.join(os.tmpdir(), 'big-contract.txt'); const t = fs.readFileSync(fx('c3-dragonfly.edgar.txt'), 'utf8'); fs.writeFileSync(tmp, t + ('\nRecital filler line of the schedule of parts. '.repeat(1)).repeat(80000));
  const sz = fs.statSync(tmp).size; const t0 = Date.now(); await (await p.$('#file')).uploadFile(tmp); await waitStatus(p, /^Read big-contract/, 15000); const dt = Date.now() - t0;
  ok(dt < 5000 && /Large file: only the first 1,500,000 characters were read\./.test(await status(p)) && DF.test(await big(p)), `${(sz / 1e6).toFixed(1)} MB file read in ${dt} ms, capped with a note, same answer`);
  ok(await p.evaluate(() => { const t0 = performance.now(); return new Promise(r => requestAnimationFrame(() => r(performance.now() - t0 < 500))); }), 'page still responsive after the large file'); await p.close(); }
// 9. privacy + opt-in memory
{ const p = await fresh('/?asof=2026-10-19');
  ok(/read in this browser tab\. They are not uploaded and not stored/.test(await p.$eval('#privacy', e => e.textContent)), 'privacy stated plainly');
  await p.click('#tryOne'); await p.waitForFunction(() => !document.querySelector('#answer').hidden);
  ok(await p.evaluate(() => localStorage.length === 0), 'nothing written to localStorage without opt-in');
  await p.$eval('#remember', e => e.click()); ok(await p.evaluate(() => JSON.parse(localStorage.getItem('cc-docs') || '[]').length === 1), 'opt-in saves to this device');
  await p.reload({ waitUntil: 'networkidle0' }); ok(/16 Dec 2026/.test(await big(p)), 'remembered contract comes back after reload');
  await p.$eval('#remember', e => e.click()); ok(await p.evaluate(() => localStorage.length === 0), 'untick deletes it');
  await p.close(); }
// 10. offline once loaded (service worker)
{ const p = await fresh('/?demo=1&asof=2026-10-19'); await p.evaluate(() => navigator.serviceWorker.ready); await sleep(800); await p.reload({ waitUntil: 'networkidle0' });
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
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
