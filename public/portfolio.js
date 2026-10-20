// Portfolio view (button on every URL): 25 real public contracts from test/fixtures, bundled in /data/portfolio.json.
// Every row's date is the tool's own output; the bundle only holds fixtures whose hand-checked answer matches it.
import { extract, buildQueue, daysBetween, dayWord, ymd, addDays } from './extract.js';
import { bucket, flagsOf, rowLabel, BUCKETS, FLAGS } from './features.js';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${+dd} ${MON[+m - 1]} ${y}`; };
export const END = '2030-12-31';
// status used for colour and sorting; needs review wins (it is the only state drawn in #EBFF0A)
// Plain status words. A missed row reads as one phrase: "Missed 18 Oct, next deadline 17 Nov".
const short = (d, asOf) => { const [y, m, dd] = d.split('-'); return `${+dd} ${MON[+m - 1]}${asOf && y !== asOf.slice(0, 4) ? ' ' + y : ''}`; };
export function pfStatus(r, asOf = r.asOf) { const b = bucket(r), f = flagsOf(r);
  const label = r.missed && r.actBy ? `Missed ${short(r.missed.actBy, asOf)}, next deadline ${short(r.actBy, asOf)}${f.includes('review') ? ' · needs review' : ''}` : rowLabel(r);
  return { key: b, bucket: b, flags: f, label }; }
const mkClass = r => ['mk', r.st.bucket, ...r.st.flags].join(' ');
export const confWord = r => r.needsReview && !r.actBy ? 'Can’t tell' : r.needsReview || r.confidence !== 'high' ? 'Check' : 'Clear';
export const pos = (d, asOf, end = END) => Math.max(0, Math.min(1, daysBetween(asOf, d) / daysBetween(asOf, end)));
export function rowsFor(cs, asOf) { const byId = new Map(cs.map(c => [c.id, c])); return buildQueue(cs, asOf).map(r => ({ ...r, c: byId.get(r.id), st: pfStatus(r, asOf), conf: confWord(r) })); }
const RANK = Object.fromEntries(BUCKETS.map(([k], i) => [k, i]));
export function sortRows(rows, by, dir = 1) {
  const k = { date: r => r.actBy || '9999', name: r => r.c.name.toLowerCase(), days: r => r.days ?? 1e9, conf: r => ['Clear', 'Check', 'Can’t tell'].indexOf(r.conf), status: r => String(RANK[r.st.bucket]).padStart(2, '0') + (r.actBy || '9999') }[by] || (r => r.actBy || '9999');
  // rows with no date stay last whichever way the date or days sort runs
  const und = r => (by === 'date' || by === 'days' || by === 'status') && !r.actBy ? 1 : 0;
  return rows.slice().sort((a, b) => { const x = k(a), y = k(b); return und(a) - und(b) || (x < y ? -1 : x > y ? 1 : 0) * dir || a.c.name.localeCompare(b.c.name); });
}
// Timeline of the next 12 months: a Today line, quarter ticks, act-now in one strong colour, everything else grey,
// and the soonest few labelled by company and date. Markers have a 24px hit area.
export const tlEnd = asOf => ymd(addDays(new Date(asOf + 'T00:00:00Z'), 365));
export function timelineHtml(rows, asOf, nLabels = 4) {
  const end = tlEnd(asOf), P = d => (pos(d, asOf, end) * 100).toFixed(2);
  const ticks = []; let [y, m] = asOf.split('-').map(Number); m = Math.floor((m - 1) / 3) * 3 + 3; // next quarter start (0-based month)
  for (;;) { if (m > 11) { m -= 12; y++; } const d = `${y}-${String(m + 1).padStart(2, '0')}-01`; if (d > end) break; ticks.push(`<span class="tk" style="left:${P(d)}%"><span class="lab">${MON[m]} ${y}</span></span>`); m += 3; }
  const dated = rows.filter(r => r.actBy && r.days != null && r.days >= 0).sort((a, b) => a.actBy < b.actBy ? -1 : a.actBy > b.actBy ? 1 : 0);
  const on = dated.filter(r => r.actBy <= end), after = dated.length - on.length, none = rows.filter(r => !r.actBy).length;
  const now = r => ['passed', 'd30'].includes(r.st.bucket);
  const marks = on.map((r, k) => `<a class="mk ${now(r) ? 'now' : 'grey'}${r.st.flags.includes('review') ? ' review' : ''}" href="#pf-${esc(r.id)}" style="left:${P(r.actBy)}%;--i:${k}" title="${esc(r.c.name)}: send notice by ${esc(fmt(r.actBy))}" aria-label="${esc(r.c.name)}: send notice by ${esc(fmt(r.actBy))}, ${esc(r.st.label)}"></a>`).join('');
  const labels = on.slice(0, nLabels).map((r, k) => { const x = +P(r.actBy); return `<span class="tlab${now(r) ? ' now' : ''}" style="left:${x}%;top:${k * 24}px;--t:${k * 24}px"><span class="tlt"${x > 55 ? ' data-right=""' : ''}>${esc(fmt(r.actBy))} · ${esc(r.c.name)}</span></span>`; }).join('');
  return `<div class="tl-track" role="group" aria-label="Send-notice dates in the next 12 months">${labels}<span class="tk today" style="left:0"><span class="lab">Today</span></span>${ticks.join('')}${marks}</div>
  <p class="tl-foot"><span><i class="dot now"></i>Act this month</span><span><i class="dot grey"></i>Later</span><span><i class="dot ring"></i>Needs review</span>${after ? `<span>${after} more after ${esc(fmt(end))}</span>` : ''}${none ? `<span class="cantnote">${none} with no date found</span>` : ''}</p>`;
}
export function listHtml(rows, asOf) {
  return rows.map((r, k) => `<li id="pf-${esc(r.id)}" class="pr ${r.st.bucket} ${r.st.flags.join(' ')}" style="--i:${k}">
    <span class="pn">${esc(r.c.name)}</span>
    <span class="pd">${r.actBy ? esc(fmt(r.actBy)) : '<span class="nd">No date found</span>'}</span>
    <span class="pl">${r.days == null ? '' : r.days < 0 ? `${dayWord(-r.days)} ago` : r.days === 0 ? 'today' : `${dayWord(r.days)} left`}</span>
    <span class="pc"><span class="tag ${r.conf === 'Clear' ? 'clear' : r.conf === 'Check' ? 'check' : 'cttag'}">${esc(r.conf)}</span></span>
    <span class="ps">${esc(r.st.label)}</span>
    <a class="pe lab" href="${esc(r.c.url)}" target="_blank" rel="noopener">Filing ↗</a></li>`).join('');
}
let cache = null;
export async function loadPortfolio() { if (!cache) { const d = await (await fetch('/data/portfolio.json')).json(); cache = d.map(c => ({ ...c, x: extract(c.lines) })); } return cache; }

// Urgency order (past due, then due within 30 days, then the rest by date; no date last) and the sentence that goes with it.
export const byUrgency = rows => sortRows(rows, 'status', 1);
export function firstSentence(rows) {
  const n = rows.filter(r => ['passed', 'd30'].includes(r.st.bucket)).length;
  return n ? `The ${n === 1 ? 'contract' : n + ' contracts'} you need to act on first ${n === 1 ? 'is' : 'are'} listed first.` : 'Nothing is due in the next 30 days. The next deadlines are listed first.';
}
