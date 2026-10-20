// Calibration sweep: every fixture plus the held-out folders. Lists each Sure card and checks it against hand answers.
// Usage: node test/calibration/run.mjs [truth.json] [extra dirs...]
import fs from 'node:fs'; import crypto from 'node:crypto'; import path from 'node:path';
import { extract, buildQueue, htmlToLines } from '../../public/extract.js';
const AS = '2026-10-19';
const truth = JSON.parse(fs.readFileSync(process.argv[2] || new URL('./truth.json', import.meta.url), 'utf8'));
const dirs = [new URL('../fixtures/', import.meta.url).pathname, ...process.argv.slice(3)];
const seen = new Map(); let sure = 0, sureRight = 0, sureWrong = [], sureUnverified = [], total = 0;
for (const d of dirs) for (const f of fs.readdirSync(d).sort()) {
  if (!/\.(htm|html|txt)$/.test(f) || /\.clean\.html$|^g\dc\.html$|^(?:ctx|cands|fresh|used|usedcik|seen|todo|HAND)\./.test(f)) continue;
  const raw = fs.readFileSync(path.join(d, f), 'utf8'); const h = crypto.createHash('md5').update(raw).digest('hex');
  const key = f.replace(/\.(edgar\.htm|pdftotext\.txt|generated\.txt|htm|html|txt)$/, ''); const id = d.includes('/fixtures') ? key : path.basename(d) + '/' + key;
  if (seen.has(h)) continue; seen.set(h, id);
  if (/\.txt$/.test(f) && fs.existsSync(path.join(d, key + (d.includes('/fixtures') ? '.edgar.htm' : '.htm')))) continue;
  const L = /\.txt$/.test(f) ? raw.split(/\r?\n/) : htmlToLines(raw); let r;
  try { const x = extract(L); r = buildQueue([{ id: 'c', name: 'c', lines: L, x }], AS)[0]; } catch (e) { continue; }
  total++; if (!r || r.confidence !== 'high') continue; sure++;
  const t = truth[id]; const got = r.actBy || '';
  if (t === undefined) sureUnverified.push(`${id} ${got} ${r.label}`);
  else if ([].concat(t).includes(got)) sureRight++; else sureWrong.push(`${id} card ${got} hand ${[].concat(t).join('|') || 'no date'}`);
}
console.log(JSON.stringify({ contracts: total, sure, sureRight, sureWrong: sureWrong.length, sureUnverified: sureUnverified.length }));
for (const w of sureWrong) console.log('WRONG ', w); for (const u of sureUnverified) console.log('UNVERIFIED ', u);
