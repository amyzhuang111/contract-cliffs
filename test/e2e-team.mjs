// e2e for team setup, per-contract context, plugging in (folder, Drive, exports) and progress. Both widths.
import puppeteer from 'puppeteer-core'; import ExcelJS from 'exceljs'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
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
const shot = async (p, name, w) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `team-${name}-${w}.png`), fullPage: false }); };
const auto = p => p.waitForFunction(() => !document.querySelector('#answer').hidden && document.querySelector('#answer .iname'), { timeout: 5000 });
const demo3 = async p => { await auto(p); await p.click('#trySecond'); await waitStatus(p, /2 contracts/); await p.click('#trySecond'); await waitStatus(p, /3 contracts/); await sleep(700); };
const drop = (p, files) => p.evaluate(files => { const dt = new DataTransfer(); for (const [name, b64, type] of files) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); dt.items.add(new File([u], name, { type })); } window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, files);
const f64 = n => fs.readFileSync(fx(n)).toString('base64');
const dl = async p => (await lastDl(p)).buf.toString();
const add3 = async p => { await p.click('#tryOne'); await auto(p); await p.click('#trySecond'); await waitStatus(p, /2 contracts/); await p.click('#trySecond'); await waitStatus(p, /3 contracts/); await sleep(300); };
const openTeam = p => p.evaluate(() => { const d = document.querySelector('#teamBox'); d.open = true; d.scrollIntoView(); });
const type = async (p, sel, v) => { await p.evaluate((s, v) => { const i = document.querySelector(s); i.value = v; i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, sel, v); };
const setup = async p => { await openTeam(p); await type(p, '#tCompany', 'General Intuition'); await type(p, '#tName', 'Stan Yushenko'); await type(p, '#tTitle', 'VP Ops'); await type(p, '#tEmail', 'stan@example.com'); await type(p, '#tWarn', '45'); await type(p, '#tCal', 'GI renewals'); await type(p, '#tTz', 'America/Chicago'); };

for (const w of [1440, 375]) {
  // 1. setup panel: applied at once to the letter and the .ics; nothing stored without consent
  { const p = await fresh('/?asof=2026-10-19', w);
    ok(await p.evaluate(() => !document.querySelector('script[src="/vendor/exceljs.min.js"]')), `${w}: exceljs is not loaded until a spreadsheet is asked for`);
    ok(await p.evaluate(() => !!document.querySelector('#teamBox summary') && /Set up for your team/.test(document.querySelector('#teamBox summary').textContent) && document.querySelector('#tWarn').value === '30'), `${w}: setup panel is there, warning days default to 30`);
    await add3(p); await setup(p);
    ok(await p.evaluate(() => localStorage.getItem('cc-team') === null && localStorage.getItem('cc-team-ok') === null), `${w}: setup is not stored without consent`);
    await type(p, '#tCompany', 'General Intuition, Inc.'); ok(/General Intuition, Inc\. /.test(await p.$eval('#tStatus', e => e.textContent)) && !/Inc\.\./.test(await p.$eval('#tStatus', e => e.textContent)), `${w}: one full stop after Inc.`); await type(p, '#tCompany', 'General Intuition');
    ok(/Stan Yushenko, VP Ops, General Intuition/.test(await p.$eval('#tStatus', e => e.textContent)) && /45, 14 and 7 days/.test(await p.$eval('#tStatus', e => e.textContent)) && /The calendar timezone, America\/Chicago, is passed to your calendar app; the reminders are all-day, so they fire in your device's time\./.test(await p.$eval('#tStatus', e => e.textContent)) && !/Reminders go off[^.]* in America/.test(await p.$eval('#tStatus', e => e.textContent)), `${w}: status says what was applied`);
    await shot(p, 'setup', w);
    await p.evaluate(() => document.querySelector('#answerLetter').click()); await p.waitForSelector('#letterText');
    const t = await p.$eval('#letterText', e => e.textContent);
    ok(/^From: Stan Yushenko, VP Ops, General Intuition, \[YOUR ADDRESS, FILL IN\] \(stan@example\.com\)$/m.test(t) && /^Stan Yushenko, VP Ops, General Intuition$/m.test(t) && !/YOUR (COMPANY|NAME|TITLE)/.test(t), `${w}: letter fills From, signer and company; no FILL IN where setup gives the value`);
    await p.evaluate(() => document.querySelector('#close').click());
    await p.evaluate(() => document.querySelector('#exIcs').click()); const ics = (await dl(p)).replace(/\r\n /g, '');
    const trig = [...ics.matchAll(/TRIGGER:(-P\d+D)/g)].map(m => m[1]);
    ok(/X-WR-CALNAME:GI renewals/.test(ics) && /X-WR-TIMEZONE:America\/Chicago/.test(ics) && trig.includes('-P45D') && !trig.includes('-P30D'), `${w}: .ics uses the warning days, calendar name and timezone`);
    // pins: the pinned contract goes to the top of the queue
    const last = await p.evaluate(() => [...document.querySelectorAll('#lq .lrow')].pop()?.dataset.id);
    await p.evaluate(id => { const n = [...document.querySelectorAll('#lq .lrow')].find(l => l.dataset.id === id).querySelector('.rname').textContent; const b = [...document.querySelectorAll('#tPins label')].find(l => n.includes(l.textContent.trim())); b.querySelector('input').click(); }, last);
    ok(await p.evaluate(id => { const f = document.querySelector('#lq .lrow'); return f.dataset.id === id && /Pinned/.test(f.querySelector('.rname').textContent); }, last), `${w}: a pinned contract moves to the top of the queue`);
    await p.evaluate(() => { document.addEventListener('click', e => { if (e.target.closest('a[href^="mailto:"]')) e.preventDefault(); }); document.querySelector('#exMail').click(); });
    ok(/3 contracts, pinned first, then soonest:/.test(decodeURIComponent(await p.$eval('#exMail', a => a.href))), `${w}: email list says pinned first, then soonest`);
    // opt-in storage
    await p.evaluate(() => document.querySelector('#tSave').click());
    ok(await p.evaluate(() => localStorage.getItem('cc-team-ok') === '1' && JSON.parse(localStorage.getItem('cc-team')).company === 'General Intuition' && JSON.parse(localStorage.getItem('cc-team')).pins.length === 1), `${w}: ticking Save stores the setup and pins`);
    await p.reload({ waitUntil: 'networkidle0' });
    ok(await p.evaluate(() => document.querySelector('#tCompany').value === 'General Intuition' && document.querySelector('#tWarn').value === '45' && document.querySelector('#tTz').value === 'America/Chicago'), `${w}: saved setup comes back after a reload`);
    await p.evaluate(() => { document.querySelector('#teamBox').open = true; document.querySelector('#tSave').click(); });
    ok(await p.evaluate(() => localStorage.getItem('cc-team') === null && localStorage.getItem('cc-team-ok') === null), `${w}: unticking Save deletes the setup`);
    await p.ctx.close(); }
  // warning days out of range: clamped visibly; field, status and .ics agree
  { const p = await fresh('/?asof=2026-10-19', w); await p.click('#tryOne'); await auto(p); await openTeam(p);
    for (const [raw, v] of [['999', 365], ['0', 1]]) {
      await type(p, '#tWarn', raw); await p.evaluate(() => document.querySelector('#tWarn').dispatchEvent(new Event('change')));
      const st = await p.evaluate(() => ({ f: document.querySelector('#tWarn').value, m: document.querySelector('#tWarnMsg').hidden ? '' : document.querySelector('#tWarnMsg').textContent, s: document.querySelector('#tStatus').textContent }));
      await p.evaluate(() => document.querySelector('#exIcs').click()); const ics = await dl(p);
      ok(st.f === String(v) && st.m === `Days of warning must be 1 to 365, so it is set to ${v}.` && new RegExp(`go off ${v}[ ,]`).test(st.s) && ics.includes(`TRIGGER:-P${v}D`), `${w}: warning days ${raw} is clamped to ${v} in the field, the message, the status and the .ics`); }
    ok(/Reminders go off 1 day before each deadline\./.test(await p.$eval('#tStatus', e => e.textContent)), `${w}: 1 day is singular in the status`);
    await type(p, '#tWarn', '20'); ok(await p.evaluate(() => document.querySelector('#tWarnMsg').hidden), `${w}: the message goes away for a valid number`);
    await p.ctx.close(); }
  // corrupt saved setup: cleared with a plain message
  { const p = await fresh('/?asof=2026-10-19', w); await p.evaluate(() => { localStorage.setItem('cc-team', '{bad json'); localStorage.setItem('cc-team-ok', '1'); }); await p.reload({ waitUntil: 'networkidle0' });
    ok(await p.evaluate(() => document.querySelector('#teamBox').open && /^Your saved setup could not be read and was cleared\./.test(document.querySelector('#tStatus').textContent) && localStorage.getItem('cc-team') === null && localStorage.getItem('cc-team-ok') === null), `${w}: corrupt saved setup is cleared with a plain message`);
    await p.ctx.close(); }
  // 2. per-contract context: owner, plan and note; the plan changes the action; exports carry it
  { const p = await fresh('/?asof=2026-10-19', w); await add3(p);
    const acts = () => p.evaluate(() => [...document.querySelectorAll('#answer .acts > *')].map(e => e.id + ':' + e.className.split(' ')[0]));
    ok((await acts())[0] === 'answerMore:btn-secondary' && (await acts()).includes('answerLetter:btn-secondary'), `${w}: no plan: the usual actions`);
    await p.evaluate(() => { document.querySelector('#ctxBox').open = true; });
    await type(p, '#cOwner', 'Ana Ruiz'); await p.evaluate(() => document.querySelector('#cOwner').dispatchEvent(new Event('change')));
    await type(p, '#cNote', '=HYPERLINK("http://x")'); await p.evaluate(() => document.querySelector('#cNote').dispatchEvent(new Event('change')));
    await type(p, '#cPlan', 'cancel');
    ok((await acts())[0] === 'answerLetter:btn-primary', `${w}: plan cancel puts Draft notice first`);
    await type(p, '#cPlan', 'renegotiate'); ok((await acts())[0] === 'answerLetter:btn-primary', `${w}: plan renegotiate puts Draft notice first`);
    await shot(p, 'plan', w);
    await type(p, '#cPlan', 'renew');
    ok(!(await acts()).some(a => a.startsWith('answerLetter')) && /Plan: renew\. No notice to send/.test(await p.$eval('#planLine', e => e.textContent)), `${w}: plan renew shows a plain reminder and no letter button`);
    ok(await p.evaluate(() => document.querySelector('#cOwner').value === 'Ana Ruiz' && document.querySelector('#cPlan').value === 'renew'), `${w}: context stays on the card after the re-render`);
    await p.evaluate(() => document.querySelector('#exCsv').click()); const csv = (await dl(p)).split('\r\n');
    ok(/^\ufeffContract,Counterparty,Send notice by,Days left,Status,Plan,Owner,What to do,Note,Why,Filing link$/.test(csv[0]) && csv.some(l => /,renew,Ana Ruiz,[^,]*,"'=HYPERLINK\(""http:\/\/x""\)",/.test(l)) && !csv.join('\n').match(/\d{4}-\d{2}-\d{2}/), `${w}: CSV has the spreadsheet's columns, plan, owner and note, with the formula guard on the note and no ISO dates`);
    await p.evaluate(() => document.querySelector('#exAudit').click()); const au = await dl(p);
    ok(/Ana Ruiz,renew,"'=HYPERLINK/.test(au), `${w}: audit CSV carries the context`);
    await p.evaluate(() => document.querySelector('#exPack').click()); ok(/Owner: Ana Ruiz · Plan: renew · Note: =HYPERLINK/.test(await dl(p)), `${w}: audit pack carries the context`);
    await p.evaluate(() => document.querySelector('#exIcs').click()); ok(/Owner: Ana Ruiz\. Plan: renew\. Note: =HYPERLINK/.test((await dl(p)).replace(/\r\n /g, '')), `${w}: .ics description carries the context`);
    ok(await p.evaluate(() => localStorage.getItem('cc-team') === null), `${w}: context is not stored without consent`);
    await p.ctx.close(); }
  // 3. plugging in: folder, many files, Drive link, all-in-one calendar, Sheets, email, coming next
  { const p = await fresh('/?asof=2026-10-19', w);
    ok(await p.evaluate(() => { const i = document.querySelector('#folder'); return i.webkitdirectory && i.multiple && /Choose folder/.test(document.querySelector('#folderBtn').textContent); }), `${w}: Choose folder button with a webkitdirectory input`);
    await p.evaluate(() => { window.__seen = []; window.__t0 = performance.now(); new MutationObserver(() => { const t = document.querySelector('#busyName').textContent + ' | ' + document.querySelector('#status').textContent; if (window.__seen[window.__seen.length - 1] !== t) window.__seen.push(t); if (/^Read \d+ contracts/.test(document.querySelector('#status').textContent) && !window.__t1) window.__t1 = performance.now(); }).observe(document.body, { subtree: true, childList: true, characterData: true }); });
    await (await p.$('#folder')).uploadFile(fx('folder-drop')); // a real directory, with a subfolder, a .png and a .DS_Store
    await waitStatus(p, /^Read 3 contracts/, 30000); const st = await status(p);
    ok(/^Read 3 contracts\. 3 contracts in the queue\./.test(st) && /Skipped 2 files that are not PDF, Word, text or HTML\./.test(st), `${w}: a folder of files is read at once, other files skipped and counted (${st.slice(0, 90)})`);
    { const seen = await p.evaluate(() => window.__seen); const ms = await p.evaluate(() => window.__t1 - window.__t0);
      ok([1, 2, 3].every(n => seen.some(t => t.includes(`File ${n} of 3`))) && seen.findIndex(t => t.includes('File 3 of 3')) < seen.findIndex(t => / \| Read 3 contracts/.test(t)), `${w}: real progress, file 1, 2 and 3 of 3, then done`);
      ok(ms < 6000, `${w}: no added delay: 3 files read in ${Math.round(ms)} ms`);
      ok(await p.evaluate(() => !document.querySelector('#dzDone').hidden && document.querySelector('#dzDone').textContent === 'Done. Read 3 contracts of 3 files.'), `${w}: brief "Read 3 contracts" confirmation in the drop zone`); }
    { const g = await p.evaluate(() => { const d = document.querySelector('#dzDone').getBoundingClientRect(), z = document.querySelector('#drop').getBoundingClientRect(); return { w: d.width, top: d.top, zb: z.bottom, zw: z.width, h: d.height }; });
      ok(g.top >= g.zb - 1 && g.w >= g.zw - 1 && g.h <= 40, `${w}: Done message on its own full-width line under the drop zone (${Math.round(g.w)}px wide, ${Math.round(g.h)}px tall)`); }
    ok(await p.evaluate(() => document.querySelectorAll('#lq .lrow').length === 2 && !document.querySelector('#answer').hidden), `${w}: all 3 land in the answer and the queue`);
    await shot(p, 'folder', w);
    // the whole list in one .ics, with the import how-to
    await p.evaluate(() => document.querySelector('#lqGcal').click()); const ics = await dl(p);
    ok((ics.match(/BEGIN:VEVENT/g) || []).length >= 2 && await p.evaluate(() => { const h = document.querySelector('#gcalHow'); return !h.hidden && /Settings, then Import and export/.test(h.textContent) && h.querySelector('a[href="https://calendar.google.com/calendar/r/settings/export"]'); }), `${w}: Add all to Google Calendar saves one .ics with every deadline and says how to import it`);
    ok(await p.evaluate(() => !/Subscribe/i.test(document.body.innerText)), `${w}: no fake Subscribe button`);
    // Download as a spreadsheet: a real .xlsx, parsed back here
    await p.evaluate(() => document.querySelector('#lqXlsx').click()); await waitStatus(p, /^Saved a spreadsheet with 3 contracts/, 20000);
    { const d = await lastDl(p); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(d.buf); const ws = wb.getWorksheet('Deadlines');
      const dates = [3, 4, 5].map(n => ws.getCell(n, 3).value).filter(v => v instanceof Date).length;
      ok(d.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && wb.worksheets.map(x => x.name).join('|') === 'Deadlines|Needs a human look|About' && ws.rowCount === 5 && dates === 3 && typeof ws.getCell('D3').value === 'number' && ws.views[0].state === 'frozen' && ws.autoFilter === 'A2:K5', `${w}: Download as a spreadsheet gives a real .xlsx with 3 rows, real dates and numbers, frozen header and filter`);
      { const R = [3, 4, 5].map(n => ({ n: ws.getCell(n, 1).value, d: ws.getCell(n, 4).value, s: ws.getCell(n, 5).value, f: ws.getCell(n, 1).fill?.fgColor?.argb }));
        const q = await p.$$eval('#lq li[data-id] .rname', e => e.map(x => x.textContent.replace(/^Pinned /, '').replace(/ New$/, '')));
        ok(R.every((r, k) => !k || typeof r.d !== 'number' || r.d >= R[k - 1].d) && R.every(r => (r.f === 'FFF8D7D7') === (typeof r.d === 'number' && r.d <= 30)) && R.some(r => /^Missed/.test(r.s)) && q.length >= 2 && JSON.stringify(R.map(r => r.n).filter(n => q.includes(n))) === JSON.stringify(q), `${w}: main export sorted by days to the next deadline, same order as the app list, Missed kept in Status, red only within 30 days (${R.map(r => r.n + ' ' + r.d + ' ' + r.s).join(' | ')}; app ${q.join(' | ')})`); }
      const tsv0 = await p.evaluate(() => { document.querySelector('#lqSheets').click(); return new Promise(r => setTimeout(() => r(window.__lastTsv), 300)); });
      ok(tsv0.split('\n')[0] === ws.getRow(2).values.slice(1).join('\t'), `${w}: Copy for Google Sheets has the spreadsheet's columns in the same order`);
      if (SHOTS && w === 1440) { const f = path.join(SHOTS, 'xlsx-from-app.xlsx'); fs.writeFileSync(f, d.buf); execFileSync('node', [new URL('./xlsx-render.mjs', import.meta.url).pathname, f, SHOTS]); } }
    ok(await p.evaluate(() => !!document.querySelector('script[src="/vendor/exceljs.min.js"]')), `${w}: exceljs is loaded from this site, only on first use`);
    // Sheets
    await p.evaluate(() => document.querySelector('#lqSheets').click()); await waitStatus(p, /Copied 3 rows for Google Sheets/);
    const tsv = await p.evaluate(() => window.__lastTsv); const L = tsv.split('\n').filter(Boolean);
    ok(L.length === 4 && L.every(l => l.split('\t').length === 11) && L[0] === 'Contract\tCounterparty\tSend notice by\tDays left\tStatus\tPlan\tOwner\tWhat to do\tNote\tWhy\tFiling link', `${w}: Copy for Google Sheets puts 3 tab-separated rows on the clipboard`);
    // email
    await p.evaluate(() => { document.addEventListener('click', e => { if (e.target.closest('a[href^="mailto:"]')) e.preventDefault(); }); document.querySelector('#lqMail').click(); });
    const href = await p.$eval('#lqMail', a => a.href);
    ok(/^mailto:\?subject=Contract%20notice%20deadlines%20as%20of%202026-10-19&body=3%20contracts/.test(href) && href.length <= 1800 && /Email draft opened with 3 contracts/.test(await status(p)), `${w}: Email me this list opens a short mailto draft`);
    ok(await p.evaluate(() => /Coming next, not built yet: watching a Google Drive folder for new contracts, and Slack reminders\./.test(document.querySelector('#comingNext').textContent)), `${w}: Drive folder watch and Slack are labelled coming next`);
    await p.ctx.close(); }
  // many files dropped at once
  { const p = await fresh('/?asof=2026-10-19', w);
    await drop(p, [['c3-dragonfly.edgar.txt', f64('c3-dragonfly.edgar.txt'), 'text/plain'], ['armlogi.htm', f64('armlogi-goldensee-ex10-11.edgar.htm'), 'text/html']]);
    await waitStatus(p, /^Read 2 contracts/, 30000); ok(/^Read 2 contracts\./.test(await status(p)), `${w}: many files dropped at once are all read`);
    await p.ctx.close(); }
  // Drive link: spotted and refused at once, with no request to Google (so no console noise)
  for (const link of ['https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view?usp=sharing', 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit']) { const p = await fresh('/?asof=2026-10-19', w);
    const asked = []; p.on('request', r => { if (/google\.com/.test(r.url())) asked.push(r.url()); }); const before = errors.length;
    await p.evaluate(l => { document.querySelector('#edgarUrl').open = true; document.querySelector('#url').value = l; document.querySelector('#fetchUrl').click(); }, link);
    await waitStatus(p, /Drive blocks/); await sleep(300);
    ok(await status(p) === 'Drive blocks this from the browser; download the PDF and drop it here.' && await p.evaluate(() => document.querySelector('#answer').hidden && !document.querySelector('#lq .lrow')), `${w}: Drive link says plainly that Drive blocks it and adds nothing`);
    ok(!asked.length && errors.length === before, `${w}: no request to Google and nothing in the console`);
    await shot(p, 'drive', w);
    await p.ctx.close(); }
  // renew plan reaches the .ics, Sheets and email (Armlogi)
  { const p = await fresh('/?asof=2026-10-20', w);
    await drop(p, [['armlogi.htm', f64('armlogi-goldensee-ex10-11.edgar.htm'), 'text/html'], ['c3-dragonfly.edgar.txt', f64('c3-dragonfly.edgar.txt'), 'text/plain']]);
    await waitStatus(p, /^Read 2 contracts/, 30000);
    await p.evaluate(() => { const li = [...document.querySelectorAll('#lq .lrow')].find(l => /goldensee/i.test(l.textContent)); if (li) li.click(); });
    await p.waitForFunction(() => /goldensee/i.test(document.querySelector("#answer .iname")?.textContent || ""));
    await p.evaluate(() => document.querySelector('#exSheets').click()); await waitStatus(p, /Copied/);
    ok(/\t20 Jun 2027\t\d+\t[^\t]*\t\t\tSend notice on 20 Jun 2027 \(two readings\)\t/.test((await p.evaluate(() => window.__lastTsv)).split('\n').find(l => /Goldensee/.test(l)) || ''), `${w}: Sheets send date for a 'within' clause is the Send notice on date`);
    await p.evaluate(() => { document.addEventListener('click', e => { if (e.target.closest('a[href^="mailto:"]')) e.preventDefault(); }); document.querySelector('#exMail').click(); });
    ok(/2027-06-20: Goldensee/.test(decodeURIComponent(await p.$eval('#exMail', a => a.href))), `${w}: email list uses the same date`);
    await p.evaluate(() => document.querySelector('#exCsv').click()); { const csv = await dl(p); ok(/Goldensee[^\n]*,20 Jun 2027,\d+,/.test(csv) && !/17 Jun 2027/.test(csv), `${w}: CSV send-by for 'within' is 2027-06-20`); }
    await p.evaluate(() => document.querySelector('#exAudit').click()); ok(!/2027-06-17/.test(await dl(p)), `${w}: audit CSV has no 2027-06-17`);
    await p.evaluate(() => { document.querySelector('#ctxBox').open = true; }); await type(p, '#cPlan', 'renew');
    { const want = Math.round((Date.UTC(2027, 6, 21) - Date.UTC(2026, 9, 20)) / 864e5);
      const cd = await p.evaluate(() => ({ k: document.querySelector('#answer .aleft > .lab').textContent, h: document.querySelector('#answerBig').textContent, sub: document.querySelector('#answer .cons').textContent, chip: document.querySelector('#answer .chips').textContent, cl: document.querySelector('#answer .cl-d')?.textContent || '', win: !!document.querySelector('#answer .safe.win') }));
      ok(cd.k === 'Renews' && cd.h === '21 Jul 2027' && cd.sub === 'Last day to change your mind: 20 Jun 2027, the date that satisfies both readings of "within one month before". Check with counsel which reading applies. It is a Sunday, so check the notices clause allows delivery that day.' && !/the last day to send/.test(cd.sub) && cd.chip === `Renews in ${want} days` && cd.cl === 'Renews 21 Jul 2027' && !cd.win, `${w}: renew plan: card leads with Renews 21 Jul 2027, last day to change your mind 20 Jun 2027, ${want} days to go`);
      await shot(p, 'renew', w);
      await p.evaluate(() => document.querySelector('#answerMore').click()); await p.waitForSelector('#drawerRenew');
      ok(new RegExp(`^Plan: renew\\. Renews 21 Jul 2027, in ${want} days\\. Last day to change your mind: 20 Jun 2027, the date that satisfies both readings of "within one month before"\\. Check with counsel which reading applies\\. It is a Sunday, so check the notices clause allows delivery that day\\. Nothing to send\\.$`).test(await p.$eval('#drawerRenew', e => e.textContent)), `${w}: renew plan: drawer says the same`);
      await p.evaluate(() => document.querySelector('#close').click());
      await p.evaluate(() => [...document.querySelectorAll('#lq .lrow')].find(l => /Dragonfly/.test(l.textContent)).click());
      await p.waitForFunction(() => [...document.querySelectorAll('#lq .lrow')].some(l => /Goldensee/.test(l.textContent)));
      const q = await p.evaluate(() => [...document.querySelectorAll('#lq .lrow')].find(l => /Goldensee/.test(l.textContent)).innerText);
      ok(/21 Jul 2027/.test(q) && /RENEWS|Renews/.test(q) && /Last day to change your mind: 20 Jun 2027, the date that satisfies both readings of "within one month before"\. Check with counsel which reading applies\. It is a Sunday, so check the notices clause allows delivery that day/.test(q) && new RegExp(`Renews in ${want} days`).test(q) && !/Send notice|Window opens/i.test(q), `${w}: renew plan: queue card says the same`);
      await p.evaluate(() => [...document.querySelectorAll('#lq .lrow')].find(l => /Goldensee/.test(l.textContent)).click()); await p.waitForFunction(() => /Goldensee/.test(document.querySelector('#answer .iname')?.textContent || '')); }
    { await p.evaluate(() => document.querySelector('#tryOne').click()); await waitStatus(p, /3 contracts/); await p.evaluate(() => [...document.querySelectorAll('#lq .lrow')].find(l => /Star Brands/.test(l.textContent))?.click()); await p.waitForFunction(() => /Star Brands/.test(document.querySelector('#answer .iname')?.textContent || ''));
      await p.evaluate(() => { document.querySelector('#ctxBox').open = true; }); await type(p, '#cPlan', 'renew');
      const sub = await p.$eval('#answer .cons', e => e.textContent);
      ok(/^Last day to change your mind: \d+ \w+ \d{4}, the last day to send a non-renewal notice\.$/.test(sub) && !/both readings|counsel/.test(sub), `${w}: renew plan on an 'at least' clause keeps the plain last-day wording (${sub})`);
      await type(p, '#cPlan', '');
      await p.evaluate(() => [...document.querySelectorAll('#lq .lrow')].find(l => /Goldensee/.test(l.textContent)).click()); await p.waitForFunction(() => /Goldensee/.test(document.querySelector('#answer .iname')?.textContent || '')); }
    await p.evaluate(() => document.querySelector('#exIcs').click()); const ics = (await dl(p)).replace(/\r\n /g, '');
    const ev = ics.split("BEGIN:VEVENT").find(e => /goldensee/i.test(e)) || '';
    ok(/SUMMARY:Renews 21 July 2027 \(plan: renew\)/.test(ev) && /reminder of the renewal date/.test(ev) && /days to the renewal date/.test(ev) && !/send notice|send-notice|window opens/i.test(ev), `${w}: renew plan: Armlogi's .ics event is a renewal-date reminder with no send-notice wording`);
    await p.evaluate(() => document.querySelector('#exSheets').click()); await waitStatus(p, /Copied/);
    const row = (await p.evaluate(() => window.__lastTsv)).split('\n').find(l => /Goldensee/.test(l)) || '';
    ok(/\t20 Jun 2027\t243\tRenewing · review\trenew\t\tRenews 21 Jul 2027 \(in 274 days\); nothing to send\t/.test(row) && !/Send notice/.test(row), `${w}: renew plan: Sheets row says renewal reminder`);
    await p.ctx.close(); }
}
ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
console.log(`\n${pass} passed, ${fail} failed`); await browser.close(); process.exit(fail ? 1 : 0);
