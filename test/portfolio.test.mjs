// Portfolio bundle: every included fixture's output must equal its hand-checked expected answer (EXPECT tables in unit.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { htmlToLines, extract, buildQueue } from '../public/extract.js';
import { rowsFor, pfStatus, sortRows, timelineHtml, listHtml, pos, confWord, END } from '../public/portfolio.js';
import { portfolio, BUCKETS, FLAGS, stripHtml, summaryOf } from '../public/features.js';
const AS = '2026-10-19';
const P = JSON.parse(fs.readFileSync(new URL('../public/data/portfolio.json', import.meta.url)));
const ut = fs.readFileSync(new URL('./unit.test.mjs', import.meta.url), 'utf8');
const EXP = {}; for (const n of ['EXPECT', 'EXPECT2', 'EXPECT3', 'EXPECT_SWEEP_AB9']) { const m = ut.match(new RegExp(`const ${n} = (\\{[\\s\\S]*?\\n\\});`)); Object.assign(EXP, Function('return ' + m[1].replace(/\/\/[^\n]*/g, ''))()); }
const SRC = Object.fromEntries(fs.readFileSync(new URL('./fixtures/SOURCES.txt', import.meta.url), 'utf8').split('\n').map(l => l.trim().split(/\s+/)).filter(p => p.length >= 2).map(p => [p[0], p[1]]));
const cs = P.map(c => ({ ...c, x: extract(c.lines) }));

test('portfolio: 25 contracts, each a test fixture with a hand-checked answer and a SOURCES.txt sec.gov link', () => {
  assert.equal(P.length, 25);
  for (const c of P) { const k = c.file.replace(/\.edgar\.htm$/, ''); assert.ok(k in EXP, k); const e = Array.isArray(EXP[k]) ? EXP[k] : [EXP[k]]; assert.equal(c.expected, e[0], k); assert.equal(c.url, SRC[c.file], k); assert.match(c.url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//); }
});
test('portfolio: bundled text is the fixture text exactly', () => {
  for (const c of P) assert.deepEqual(c.lines, htmlToLines(fs.readFileSync(new URL('./fixtures/' + c.file, import.meta.url), 'utf8')), c.file);
});
for (const c of cs) test(`portfolio ${c.file}: output equals expected ${c.expected || 'flagged, no date'}`, () => {
  const k = c.file.replace(/\.edgar\.htm$/, ''); const [act, safe] = Array.isArray(EXP[k]) ? EXP[k] : [EXP[k]];
  const r = buildQueue([c], AS)[0]; assert.equal(r.actBy || '', act); if (safe) assert.equal(r.safe?.date, safe); if (!act) assert.equal(r.needsReview, true);
});
test('portfolio: the mix, one bucket per contract, buckets add up to 25', () => {
  const rows = rowsFor(cs, AS); const n = k => rows.filter(r => r.st.bucket === k).length;
  const pf = portfolio(buildQueue(cs, AS));
  assert.deepEqual(pf, { passed: 0, d30: 2, d90: 1, d365: 8, later: 10, cant: 4, expired: 0, review: 3, missed: 4, total: 25 });
  assert.equal(BUCKETS.reduce((a, [k]) => a + pf[k], 0), pf.total);
  for (const [k] of BUCKETS) assert.equal(n(k), pf[k], k); // row labels match the strip
  assert.equal(rows.filter(r => r.needsReview).length, 7); // 7 of 25 need review
  assert.equal(rows.filter(r => r.conf === 'Can’t tell').length, 4); assert.ok(rows.filter(r => r.conf === 'Check').length >= 5); assert.ok(rows.filter(r => r.conf === 'Clear').length >= 5);
  assert.equal(rows.find(r => /urban-gro/.test(r.c.name)).st.label, 'Missed 18 Oct, next deadline 17 Nov'); // next date in 29 days
  assert.equal(rows.find(r => /Glacier/.test(r.c.name)).st.label, 'Due in 30 days · needs review'); // 3 days left, still counted as urgent
  for (const [f] of FLAGS) assert.equal(rows.filter(r => r.st.flags.includes(f)).length, pf[f], f);
});
test('portfolio: status, sorting and timeline', () => {
  assert.equal(pfStatus({ needsReview: true, actBy: '' }).label, 'Can’t tell');
  assert.equal(pfStatus({ actBy: '2026-10-21', days: 2, needsReview: true }).bucket, 'd30');
  assert.equal(pfStatus({ missed: { actBy: '2026-10-01' }, actBy: '2027-01-15', days: 88, needsReview: true }, AS).label, 'Missed 1 Oct, next deadline 15 Jan 2027 · needs review');
  assert.equal(pfStatus({ actBy: '2026-11-01', days: 13, needsReview: true }).label, 'Due in 30 days · needs review');
  assert.equal(pfStatus({ actBy: '2026-11-01', days: 13 }).label, 'Due in 30 days');
  const rows = rowsFor(cs, AS);
  const byDate = sortRows(rows, 'date').map(r => r.actBy).filter(Boolean); assert.deepEqual(byDate, byDate.slice().sort());
  assert.equal(sortRows(rows, 'date')[0].c.name, 'Glacier Bancorp / Glacier Bank');
  for (const by of ['date', 'days']) for (const d of [1, -1]) { const o = sortRows(rows, by, d); const i = o.findIndex(r => !r.actBy); assert.ok(i > 0 && o.slice(i).every(r => !r.actBy), by + d); }
  const names = sortRows(rows, 'name', -1).map(r => r.c.name.toLowerCase()); assert.deepEqual(names, names.slice().sort().reverse());
  assert.equal(pos(AS, AS), 0); assert.equal(pos(END, AS), 1); assert.equal(pos('2044-07-26', AS), 1);
  const t = timelineHtml(rows, AS); const marks = [...t.matchAll(/class="mk ([\w ]+)"/g)].map(m => m[1]);
  assert.equal(marks.length, 11); assert.equal(marks.filter(m => /\bnow\b/.test(m)).length, 2); assert.equal(marks.filter(m => /\bgrey\b/.test(m)).length, 9); assert.equal(marks.filter(m => /\breview\b/.test(m)).length, 2); // Glacier and Purple; 12 months: act-now red, the rest grey
  assert.deepEqual([...t.matchAll(/<span class="lab">([A-Z][a-z]{2} \d{4})<\/span>/g)].map(m => m[1]), ['Jan 2027', 'Apr 2027', 'Jul 2027', 'Oct 2027']); assert.match(t, /class="tk today"[^>]*><span class="lab">Today/);
  assert.deepEqual([...t.matchAll(/<span class="tlt"[^>]*>([^<]+)/g)].map(m => m[1]), ['22 Oct 2026 · Glacier Bancorp / Glacier Bank', '17 Nov 2026 · urban-gro / Richard Akright', '1 Dec 2026 · F. Scott Anthony / Coca-Cola Consolidated', '6 Feb 2027 · Z Squared / Mzhci']);
  assert.match(t, /10 more after 19 Oct 2027/); assert.match(t, /4 with no date found/);
  const leg = [...t.matchAll(/<i class="dot (\w+)"><\/i>([^<]+)/g)].map(m => m[2]); assert.deepEqual(leg, ['Act this month', 'Later', 'Needs review']); // matches the summary's words
  const pf = portfolio(buildQueue(cs, AS)); assert.deepEqual(summaryOf(pf), { act: 2, year: 9, human: 7 }); // Glacier and urban-gro count as act-now despite review / missed
  const sh = stripHtml(pf); assert.deepEqual([...sh.matchAll(/<span class="sv">(\d+)<\/span><span class="bl">([^<]+)/g)].map(m => m[2] + ' ' + m[1]), ['Act this month 2', 'Coming up this year 9', 'Needs a human look 7']);
  assert.match(sh, /All 25 by next deadline: 2 within 30 days, 1 in 31 to 90 days, 8 in 91 to 365 days, 10 later, 4 with no date found\. 4 contracts had an earlier send-notice date missed\./);
  const l = listHtml(rows, AS); assert.equal((l.match(/<li /g) || []).length, 25); assert.equal((l.match(/href="https:\/\/www\.sec\.gov\//g) || []).length, 25);
  assert.ok(!/—/.test(t + l));
  assert.equal(confWord({ needsReview: false, confidence: 'high' }), 'Clear');
});
