// Builds public/data/portfolio.json from test/fixtures: only fixtures whose hand-checked expected answer
// (EXPECT tables in test/unit.test.mjs) equals the tool's output exactly. Links come from test/fixtures/SOURCES.txt.
import fs from 'node:fs';
import { htmlToLines, extract, buildQueue, partiesFromPreamble } from '../public/extract.js';
const AS = '2026-10-19';
const src = Object.fromEntries(fs.readFileSync(new URL('../test/fixtures/SOURCES.txt', import.meta.url), 'utf8').split('\n').map(l => l.trim().split(/\s+/)).filter(p => p.length >= 2 && /^https:\/\/www\.sec\.gov\//.test(p[1])).map(p => [p[0], p[1]]));
const ut = fs.readFileSync(new URL('../test/unit.test.mjs', import.meta.url), 'utf8');
const expect = {};
for (const name of ['EXPECT', 'EXPECT2', 'EXPECT3', 'EXPECT_SWEEP_AB9']) { const m = ut.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n\\});`)); const obj = Function('return ' + m[1].replace(/\/\/[^\n]*/g, ''))(); for (const [k, v] of Object.entries(obj)) expect[k] = Array.isArray(v) ? v : [v]; }
// Chosen for the demo mix: commercial agreements first (supply, licence, services, network, consulting), a few employment terms for the 'Check' and passed cases.
export const PICK = (process.argv[2] || '').split(',').filter(Boolean);
const out = [], report = [];
for (const [f, [act, safe]] of Object.entries(expect)) {
  const file = f + '.edgar.htm'; const url = src[file];
  const L = htmlToLines(fs.readFileSync(new URL('../test/fixtures/' + file, import.meta.url), 'utf8')); const x = extract(L);
  const r = buildQueue([{ id: 'f', name: 'f', lines: L, x }], AS)[0];
  const match = (r.actBy || '') === act && (!safe || r.safe?.date === safe) && (act || r.needsReview);
  report.push([f, act || 'flagged', r.actBy || '-', r.section, r.confidence, r.needsReview, match ? 'MATCH' : 'MISMATCH', url ? 'url' : 'NO URL', partiesFromPreamble(L)]);
  if (match && url && (!PICK.length || PICK.includes(f))) out.push({ id: 'p-' + f, file, name: partiesFromPreamble(L) || f, url, expected: act, lines: L });
}
if (process.argv[3] === 'write') fs.writeFileSync(new URL('../public/data/portfolio.json', import.meta.url), JSON.stringify(out));
for (const r of report) console.log(r.join(' | '));
console.log(out.length, 'included', (JSON.stringify(out).length / 1e6).toFixed(2) + ' MB');
