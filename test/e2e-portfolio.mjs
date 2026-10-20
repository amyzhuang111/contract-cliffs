// e2e for the ?demo=1 portfolio view. Run against `node test/serve.mjs` (BASE_URL to override; SHOTS=dir for screenshots).
import puppeteer from 'puppeteer-core'; import fs from 'node:fs'; import path from 'node:path';
const BASE = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, ''); const SHOTS = process.env.SHOTS || '';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms)); const errors = [];
const SRC = Object.fromEntries(fs.readFileSync(new URL('./fixtures/SOURCES.txt', import.meta.url), 'utf8').split('\n').map(l => l.trim().split(/\s+/)).filter(p => p.length >= 2).map(p => [p[0], p[1]]));
async function fresh(q, w = 1440, reduce = false) { const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); p.ctx = ctx;
  await p.setViewport(w === 375 ? { width: 375, height: 812, isMobile: true, hasTouch: true } : { width: 1440, height: 900 });
  if (reduce) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  p.reqs = []; p.on('request', r => p.reqs.push(r.url())); p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE + q, { waitUntil: 'networkidle0' }); return p; }
const load = async p => { await p.click('#loadPf'); await p.waitForSelector('#pfView:not([hidden]) #pfList li'); await sleep(1800); };

for (const w of [1440, 375]) {
  { const p = await fresh('/?asof=2026-10-19', w); await sleep(800);
    ok(await p.evaluate(() => document.querySelector('#pfView').hidden) && !p.reqs.some(u => /portfolio\.json/.test(u)), `${w}: plain URL: portfolio closed, no portfolio data fetched on load`);
    const b = await p.evaluate(() => ({ t: document.querySelector('#loadPf').textContent, note: document.querySelector('.pfnote').textContent, vis: !!document.querySelector('#loadPf').offsetParent, ans: document.querySelector('#answer').hidden, demo: /\bdemo\b/i.test(document.body.innerText) }));
    ok(b.vis && b.t === 'Load 25 real public contracts' && b.note === 'Public SEC filings, standing in for your own agreements.' && b.ans && !b.demo, `${w}: plain URL shows the button and note as a secondary option, nothing loaded, no "demo" wording`);
    await load(p); ok(p.reqs.some(u => /portfolio\.json/.test(u)) && await p.$$eval('#pfList li', l => l.length) === 25, `${w}: plain URL: clicking the button loads the 25 contracts`);
    await p.ctx.close(); }
  { const p = await fresh('/?demo=1&asof=2026-10-19', w); await p.waitForFunction(() => document.querySelector('#answer .iname'), { timeout: 5000 });
    const b = await p.evaluate(() => ({ t: document.querySelector('#loadPf').textContent, note: document.querySelector('.pfnote').textContent, vis: !document.querySelector('#pfLoad').hidden, card: document.querySelector('#answer .iname').textContent }));
    ok(b.vis && b.t === 'Load 25 real public contracts' && b.note === 'Public SEC filings, standing in for your own agreements.' && b.card === 'Star Brands / Schwazze', `${w}: ?demo=1 auto-runs Star Brands and shows "${b.t}" with the note`);
    ok(!p.reqs.some(u => /portfolio\.json/.test(u)), `${w}: portfolio data only loads on click`);
    await load(p);
    const d = await p.evaluate(() => ({ sub: document.querySelector('#pfSub').textContent, strip: [...document.querySelectorAll('#pfStrip .pf')].map(x => x.innerText.replace(/\s+/g, ' ')), flags: document.querySelector('#pfStrip .pfflags').innerText.replace(/\s+/g, ' ').trim(), legend: [...document.querySelectorAll('.tl-foot span')].map(x => x.textContent), rows: [...document.querySelectorAll('#pfList li')].map(li => ({ n: li.querySelector('.pn').textContent, d: li.querySelector('.pd').textContent, l: li.querySelector('.pl').textContent, s: li.querySelector('.ps').textContent, c: li.querySelector('.pc').textContent, a: li.querySelector('a.pe').href })), marks: [...document.querySelectorAll('.tl-track .mk')].map(m => [m.className, getComputedStyle(m).boxShadow + ' ' + getComputedStyle(m).backgroundColor]), secOnly: !document.querySelectorAll('#pfView a:not([href^="https://www.sec.gov/"]):not([href^="#pf-"])').length }));
    ok(/^Stand-ins for a company's own agreements: 25 public contracts filed with the SEC \(licence, supply, services and network deals, plus some executive and consulting agreements\), each linked to its filing as proof\./.test(d.sub), `${w}: header frames them as stand-ins`);
    ok(d.strip.join('|') === 'DUE IN 30 DAYS 2|DUE IN 31 TO 90 DAYS 1|DUE IN 91 TO 365 DAYS 8|LATER 10|CAN’T TELL 4' && /^OF THESE: NEEDS REVIEW 3 · EARLIER DATE MISSED 4$/.test(d.flags), `${w}: summary strip ${d.strip.join(', ')}`);
    ok(d.rows.length === 25 && d.rows[0].n === 'Glacier Bancorp / Glacier Bank' && d.rows[0].d === '22 Oct 2026' && d.rows[0].l === '3 days left' && d.rows[0].c === 'Check', `${w}: 25 rows, soonest first (${d.rows[0].n}, ${d.rows[0].d}, ${d.rows[0].l})`);
    const urls = new Set(Object.values(SRC)); ok(d.rows.every(r => urls.has(r.a)) && d.secOnly, `${w}: every row links its SOURCES.txt EDGAR filing`);
    ok(d.rows.filter(r => r.c === 'Can’t tell').length === 4 && d.rows.filter(r => r.c === 'Check').length >= 5 && d.rows.filter(r => /^Due in 30 days/.test(r.s)).length === 2 && d.rows.filter(r => / · needs review/.test(r.s)).length === 3 && d.rows.filter(r => /^Later/.test(r.s)).length === 10 && d.rows.some(r => r.n.startsWith('Glacier') && r.s === 'Due in 30 days · needs review') && d.rows.some(r => r.n.startsWith('urban-gro') && r.s === 'Due in 30 days · earlier date missed') && d.rows.some(r => /earlier date passed/.test(r.l)), `${w}: rows include Check, can't tell and passed; row labels match the strip`);
    const Y = 'rgb(235, 255, 10)'; ok(d.marks.length === 18 && d.marks.every(([c, bg]) => bg.includes(Y) === /\breview\b/.test(c)), `${w}: 18 timeline markers (${d.marks.length}); #EBFF0A only on needs-review markers`);
    const anim = await p.evaluate(() => document.getAnimations().filter(a => a.animationName === 'pf-in' || a.animationName === 'pf-pop').length);
    ok(anim >= 30, `${w}: staggered entrance animations run (${anim})`);
    await p.click('.pfsort [data-sort="name"]'); const n1 = await p.$$eval('#pfList .pn', e => e.map(x => x.textContent.toLowerCase()));
    ok(n1.join() === n1.slice().sort().join(), `${w}: sort by parties A to Z`);
    await p.click('.pfsort [data-sort="name"]'); const n2 = await p.$$eval('#pfList .pn', e => e.map(x => x.textContent.toLowerCase()));
    ok(n2.join() === n1.slice().reverse().join() && await p.$eval('.pfsort [data-sort="name"]', b => b.getAttribute('aria-pressed')) === 'true', `${w}: second click reverses`);
    await p.click('.pfsort [data-sort="date"]');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}: no sideways scroll`);
    ok(await p.evaluate(() => [...document.querySelectorAll('#pfView button, #pfView a.pe')].every(b => b.getBoundingClientRect().height >= 44)), `${w}: sort buttons and EDGAR links are at least 44px tall`);
    if (SHOTS) { await p.evaluate(() => document.querySelector('#pfView').scrollIntoView()); await sleep(1500); await p.screenshot({ path: path.join(SHOTS, `portfolio-${w}.png`) }); await p.screenshot({ path: path.join(SHOTS, `portfolio-${w}-full.png`), fullPage: true }); }
    // the 3-click demo still works after the portfolio is open
    await p.click('#trySecond'); await p.waitForFunction(() => /2 contracts/.test(document.querySelector('#status').textContent)); await p.click('#trySecond'); await p.waitForFunction(() => /3 contracts/.test(document.querySelector('#status').textContent)); await sleep(700);
    const q = await p.evaluate(() => [document.querySelector('#answer .iname').textContent, ...[...document.querySelectorAll('#lq .rname')].map(e => e.textContent.replace(/\s*New$/, ''))].join('|'));
    ok(q === 'Star Brands / Schwazze|Dragonfly / Keystone RV|StableX / Kopin', `${w}: demo flow unchanged with the portfolio open: ${q}`);
    await p.ctx.close(); }
  { const p = await fresh('/?demo=1&asof=2026-10-19', w, true); await p.waitForFunction(() => document.querySelector('#answer .iname'), { timeout: 5000 }); await load(p);
    ok(await p.evaluate(() => document.getAnimations().filter(a => /^pf-/.test(a.animationName || '')).length === 0), `${w}: prefers-reduced-motion: no entrance animation`);
    await p.ctx.close(); }
}
ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
console.log(`\n${pass} passed, ${fail} failed`); await browser.close(); process.exit(fail ? 1 : 0);
