// Runs the extractor on held-out EDGAR exhibits (never used for tuning). Usage: node edgar/holdout/run.mjs
import fs from 'node:fs'; import { extract, schedule } from '../../public/extract.js';
const dir = new URL(process.argv[2] ? '../' + process.argv[2] + '/raw/' : './raw/', import.meta.url);
for (const l of fs.readFileSync(new URL('urls.txt', dir), 'utf8').trim().split('\n')) {
  const [id] = l.split(' '); const lines = fs.readFileSync(new URL(id + '.txt', dir), 'utf8').split('\n');
  const x = extract(lines);
  console.log('##', id);
  for (const i of schedule(x, '2026-10-19')) console.log(' ', i.type, '|', i.date || '-', '|', i.confidence, i.needsReview ? 'REVIEW' : '', '|', i.source?.location || '', '|', (i.source?.quote || '').slice(0, 140));
  for (const p of x.payments) console.log('  pay', p.rule, '|', p.source.location);
  for (const p of x.other) console.log('  tfc', p.rule, '|', p.source.location, (p.source.quote||'').slice(0,120));
}
