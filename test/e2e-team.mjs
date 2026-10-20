// e2e for team setup, per-contract context, plugging in (folder, Drive, exports) and progress. Both widths.
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
const shot = async (p, name, w) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `team-${name}-${w}.png`), fullPage: false }); };
const auto = p => p.waitForFunction(() => !document.querySelector('#answer').hidden && document.querySelector('#answer .iname'), { timeout: 5000 });
const demo3 = async p => { await auto(p); await p.click('#trySecond'); await waitStatus(p, /2 contracts/); await p.click('#trySecond'); await waitStatus(p, /3 contracts/); await sleep(700); };
const drop = (p, files) => p.evaluate(files => { const dt = new DataTransfer(); for (const [name, b64, type] of files) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); dt.items.add(new File([u], name, { type })); } window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, files);
const dl = async p => (await lastDl(p)).buf.toString();
const add3 = async p => { await p.click('#tryOne'); await auto(p); await p.click('#trySecond'); await waitStatus(p, /2 contracts/); await p.click('#trySecond'); await waitStatus(p, /3 contracts/); await sleep(300); };
const openTeam = p => p.evaluate(() => { const d = document.querySelector('#teamBox'); d.open = true; d.scrollIntoView(); });
const type = async (p, sel, v) => { await p.evaluate((s, v) => { const i = document.querySelector(s); i.value = v; i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, sel, v); };
const setup = async p => { await openTeam(p); await type(p, '#tCompany', 'General Intuition'); await type(p, '#tName', 'Stan Yushenko'); await type(p, '#tTitle', 'VP Ops'); await type(p, '#tEmail', 'stan@example.com'); await type(p, '#tWarn', '45'); await type(p, '#tCal', 'GI renewals'); await type(p, '#tTz', 'America/Chicago'); };

for (const w of [1440, 375]) {
  // 1. setup panel: applied at once to the letter and the .ics; nothing stored without consent
  { const p = await fresh('/?asof=2026-10-19', w);
    ok(await p.evaluate(() => !!document.querySelector('#teamBox summary') && /Set up for your team/.test(document.querySelector('#teamBox summary').textContent) && document.querySelector('#tWarn').value === '30'), `${w}: setup panel is there, warning days default to 30`);
    await add3(p); await setup(p);
    ok(await p.evaluate(() => localStorage.getItem('cc-team') === null && localStorage.getItem('cc-team-ok') === null), `${w}: setup is not stored without consent`);
    ok(/Stan Yushenko, VP Ops, General Intuition/.test(await p.$eval('#tStatus', e => e.textContent)) && /45, 14 and 7 days/.test(await p.$eval('#tStatus', e => e.textContent)), `${w}: status says what was applied`);
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
    // opt-in storage
    await p.evaluate(() => document.querySelector('#tSave').click());
    ok(await p.evaluate(() => localStorage.getItem('cc-team-ok') === '1' && JSON.parse(localStorage.getItem('cc-team')).company === 'General Intuition' && JSON.parse(localStorage.getItem('cc-team')).pins.length === 1), `${w}: ticking Save stores the setup and pins`);
    await p.reload({ waitUntil: 'networkidle0' });
    ok(await p.evaluate(() => document.querySelector('#tCompany').value === 'General Intuition' && document.querySelector('#tWarn').value === '45' && document.querySelector('#tTz').value === 'America/Chicago'), `${w}: saved setup comes back after a reload`);
    await p.evaluate(() => { document.querySelector('#teamBox').open = true; document.querySelector('#tSave').click(); });
    ok(await p.evaluate(() => localStorage.getItem('cc-team') === null && localStorage.getItem('cc-team-ok') === null), `${w}: unticking Save deletes the setup`);
    await p.ctx.close(); }
}
ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
console.log(`\n${pass} passed, ${fail} failed`); await browser.close(); process.exit(fail ? 1 : 0);
