// Portfolio view (button on every URL): 25 real public contracts from test/fixtures, bundled in /data/portfolio.json.
// Every row's date is the tool's own output; the bundle only holds fixtures whose hand-checked answer matches it.
import { extract, buildQueue, daysBetween, dayWord } from './extract.js';
import { bucket, flagsOf, rowLabel, BUCKETS, FLAGS } from './features.js';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${+dd} ${MON[+m - 1]} ${y}`; };
export const END = '2030-12-31';
// status used for colour and sorting; needs review wins (it is the only state drawn in #EBFF0A)
export function pfStatus(r) { const b = bucket(r), f = flagsOf(r); return { key: b, bucket: b, flags: f, label: rowLabel(r) }; }
const mkClass = r => ['mk', r.st.bucket, ...r.st.flags].join(' ');
export const confWord = r => r.needsReview && !r.actBy ? 'Can’t tell' : r.needsReview || r.confidence !== 'high' ? 'Check' : 'Clear';
export const pos = (d, asOf, end = END) => Math.max(0, Math.min(1, daysBetween(asOf, d) / daysBetween(asOf, end)));
export function rowsFor(cs, asOf) { const byId = new Map(cs.map(c => [c.id, c])); return buildQueue(cs, asOf).map(r => ({ ...r, c: byId.get(r.id), st: pfStatus(r), conf: confWord(r) })); }
const RANK = Object.fromEntries(BUCKETS.map(([k], i) => [k, i]));
export function sortRows(rows, by, dir = 1) {
  const k = { date: r => r.actBy || '9999', name: r => r.c.name.toLowerCase(), days: r => r.days ?? 1e9, conf: r => ['Clear', 'Check', 'Can’t tell'].indexOf(r.conf), status: r => RANK[r.st.bucket] }[by] || (r => r.actBy || '9999');
  // rows with no date stay last whichever way the date or days sort runs
  const und = r => (by === 'date' || by === 'days') && !r.actBy ? 1 : 0;
  return rows.slice().sort((a, b) => { const x = k(a), y = k(b); return und(a) - und(b) || (x < y ? -1 : x > y ? 1 : 0) * dir || a.c.name.localeCompare(b.c.name); });
}
export function timelineHtml(rows, asOf) {
  const y0 = +asOf.slice(0, 4); const ticks = []; for (let y = y0 + 1; y <= 2030; y++) { const x = pos(y + '-01-01', asOf); ticks.push(`<span class="tk" style="left:${(x * 100).toFixed(2)}%"><span class="lab">${y}</span></span>`); }
  const dated = rows.filter(r => r.actBy && r.days != null && r.days >= 0);
  const later = dated.filter(r => r.actBy > END).length, none = rows.filter(r => !r.actBy).length;
  const marks = dated.filter(r => r.actBy <= END).map((r, k) => `<a class="${mkClass(r)}" href="#pf-${esc(r.id)}" style="left:${(pos(r.actBy, asOf) * 100).toFixed(2)}%;--i:${k}" title="${esc(r.c.name)}: send by ${esc(fmt(r.actBy))} (${esc(r.st.label)})" aria-label="${esc(r.c.name)}: send by ${esc(fmt(r.actBy))}, ${esc(r.st.label)}"></a>`).join('');
  return `<div class="tl-track" role="group" aria-label="Send-by dates from today to the end of 2030"><span class="tk today" style="left:0"><span class="lab">Today</span></span>${ticks.join('')}${marks}</div>
  <p class="lab tl-foot">${BUCKETS.filter(([k]) => !['cant', 'expired'].includes(k) && (k !== 'passed' || dated.some(r => r.st.bucket === 'passed'))).map(([k, l]) => `<span><i class="dot ${k}"></i>${l}</span>`).join('')}<span><i class="dot ring"></i>Needs review</span>${later ? `<span>${later} after 2030, not on the line</span>` : ''}${none ? `<span>Can’t tell: ${none}, no date, not on the line</span>` : ''}</p>`;
}
export function listHtml(rows, asOf) {
  return rows.map((r, k) => `<li id="pf-${esc(r.id)}" class="pr ${r.st.bucket} ${r.st.flags.join(' ')}" style="--i:${k}">
    <span class="pn">${esc(r.c.name)}</span>
    <span class="pd">${r.actBy ? esc(fmt(r.actBy)) : '<span class="nd">No date found</span>'}</span>
    <span class="pl">${r.days == null ? '' : r.days < 0 ? `${dayWord(-r.days)} ago` : r.days === 0 ? 'today' : `${dayWord(r.days)} left`}${r.missed ? ` <span class="pm">earlier date passed ${esc(fmt(r.missed.actBy))}</span>` : ''}</span>
    <span class="pc"><span class="tag ${r.conf === 'Clear' ? 'clear' : r.conf === 'Check' ? 'check' : 'rvtag'}">${esc(r.conf)}</span></span>
    <span class="ps lab">${esc(r.st.label)}</span>
    <a class="pe lab" href="${esc(r.c.url)}" target="_blank" rel="noopener">EDGAR ↗</a></li>`).join('');
}
let cache = null;
export async function loadPortfolio() { if (!cache) { const d = await (await fetch('/data/portfolio.json')).json(); cache = d.map(c => ({ ...c, x: extract(c.lines) })); } return cache; }
