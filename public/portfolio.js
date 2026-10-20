// Portfolio view (button on every URL): 25 real public contracts from test/fixtures, bundled in /data/portfolio.json.
// Every row's date is the tool's own output; the bundle only holds fixtures whose hand-checked answer matches it.
import { extract, buildQueue, daysBetween, dayWord, ymd, addDays } from './extract.js';
import { bucket, flagsOf, rowLabel, BUCKETS, FLAGS, sendByNote, windowNote, windowOf } from './features.js';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${+dd} ${MON[+m - 1]} ${y}`; };
export const END = '2030-12-31';
// status used for colour and sorting; needs review wins (it is the only state drawn in #EBFF0A)
// Plain status words. A missed row reads as one phrase, with years: "Missed 18 Oct 2026, next deadline 17 Nov 2026".
export function pfStatus(r, asOf = r.asOf) { const b = bucket(r), f = flagsOf(r);
  const label = r.missed && r.actBy ? `Missed ${fmt(r.missed.actBy)}, next deadline ${fmt(r.actBy)}${f.includes('review') ? ' · needs review' : ''}` : b === 'cant' ? 'No date found' : rowLabel(r); // Can't tell is shown once, in the Confidence column
  return { key: b, bucket: b, flags: f, label }; }
const mkClass = r => ['mk', r.st.bucket, ...r.st.flags].join(' ');
export const confWord = r => r.needsReview && !r.actBy ? 'Can’t tell' : r.needsReview || r.confidence !== 'high' ? 'Check' : 'Clear';
export const pos = (d, asOf, end = END) => Math.max(0, Math.min(1, daysBetween(asOf, d) / daysBetween(asOf, end)));
export function rowsFor(cs, asOf) { const byId = new Map(cs.map(c => [c.id, c])); return buildQueue(cs, asOf).map(r => ({ ...r, c: byId.get(r.id), asOf, st: pfStatus(r, asOf), conf: confWord(r) })); }
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
  const labels = on.slice(0, nLabels).map((r, k) => { const x = +P(r.actBy); return `<span class="tlab${now(r) ? ' now' : ''}" style="left:${x}%;top:${k * 24}px;--t:${k * 24}px;--x:${x}"><span class="tlt"${x > 55 ? ' data-right=""' : ''}>${esc(fmt(r.actBy))} · ${esc(r.c.name)}</span></span>`; }).join('');
  return `<div class="tl-track" role="group" aria-label="Send-notice dates in the next 12 months">${labels}<span class="tk today" style="left:0"><span class="lab">Today</span></span>${ticks.join('')}${marks}</div>
  <p class="tl-foot"><span><i class="dot now"></i>Act this month</span><span><i class="dot grey"></i>Later</span><span><i class="dot ring"></i>Needs review</span>${after ? `<span>${after} more after ${esc(fmt(end))}</span>` : ''}${none ? `<span class="cantnote">${none} with no date found</span>` : ''}</p>`;
}
export function listHtml(rows, asOf) {
  return rows.map((r, k) => `<li id="pf-${esc(r.id)}" class="pr ${r.st.bucket} ${r.st.flags.join(' ')}" style="--i:${k}">
    <span class="pn">${esc(r.c.name)}</span>
    <span class="pd">${r.actBy ? esc(fmt(r.actBy)) : '<span class="nd">No date found</span>'}${r.actBy && (r.item?.within ? '' : sendByNote(r.actBy, r.asOf)) ? `<span class="psafe">${esc((r.item?.within ? '' : sendByNote(r.actBy, r.asOf)))}</span>` : ''}${windowNote(r) ? `<span class="psafe">${esc(windowNote(r))}</span>` : ''}</span>
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
  const a = rows.filter(r => ['passed', 'd30'].includes(r.st.bucket)).length, shown = Math.min(3, byUrgency(rows).filter(r => r.actBy).length), rest = shown - Math.min(a, shown);
  if (!shown) return 'No send-notice dates found.';
  if (!a) return `Nothing is due this month. ${shown === 1 ? 'This one is' : `These ${shown} are`} next.`;
  if (a >= shown) return a === shown ? `Act on ${a === 1 ? 'this one' : `these ${a}`} this month.` : `Act on these ${shown} first. ${a} are due this month.`;
  return `Act on ${a === 1 ? 'this one' : `these ${a}`} this month. ${rest} more ${rest === 1 ? 'is' : 'are'} next.`;
}

// Opening view: the 3 contracts to act on first, each with company, action and days left.
export function top3Html(rows) {
  return byUrgency(rows).slice(0, 3).map(r => { const now = ['passed', 'd30'].includes(r.st.bucket);
    const note = [r.actBy && (r.item?.within ? '' : sendByNote(r.actBy, r.asOf)) && esc((r.item?.within ? '' : sendByNote(r.actBy, r.asOf))), windowNote(r) && esc(windowNote(r)), r.missed && `Missed ${esc(fmt(r.missed.actBy))}`, r.st.flags.includes('review') && '<span class="rvnote">Needs review</span>'].filter(Boolean).join(' · ');
    return `<li class="t3${now ? ' now' : ''}"><a href="#pf-${esc(r.id)}"><span class="t3n">${esc(r.c.name)}</span><span class="t3a">${r.item?.within ? 'Send notice on or after' : 'Send notice by'} ${esc(fmt(r.actBy))}</span><span class="t3d">${r.days === 0 ? 'Today' : `${dayWord(r.days)} left`}</span>${note ? `<span class="t3x">${note}</span>` : ''}</a></li>`; }).join('');
}

// "This week": every contract whose send-notice date falls in the 7 days from the as-of date, soonest first.
// If none, the next one. Everything comes from the rows; nothing is added.
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtW = d => `${WD[new Date(d + 'T00:00:00Z').getUTCDay()]} ${fmt(d)}`;
export function thisWeek(rows, asOf) {
  const end = ymd(addDays(new Date(asOf + 'T00:00:00Z'), 6));
  const dated = rows.filter(r => r.actBy && r.days != null && r.days >= 0 && r.section !== 'lapsed').sort((a, b) => a.days - b.days || a.c.name.localeCompare(b.c.name));
  const due = dated.filter(r => r.actBy <= end);
  return { from: asOf, end, due, next: due.length ? null : dated[0] || null };
}
export function actionOf(r) {
  const w = windowOf(r); const day = w ? w.day : (r.safe && !r.safe.passed ? r.safe.date : r.actBy);
  const verb = w ? `${w.label} ${fmtW(w.day)}` : `Send non-renewal notice by ${fmtW(day)}`;
  return { day, text: (r.missed ? `Missed ${fmt(r.missed.actBy)}. ` : '') + verb, left: r.days === 0 ? 'today' : `${dayWord(daysBetween(r.asOf, day))} left`, review: !!r.needsReview };
}
export function weekHtml(rows, asOf, linkFor = () => '') {
  const t = thisWeek(rows, asOf); const span = `${+asOf.slice(8)} ${MON[+asOf.slice(5, 7) - 1]} to ${fmt(t.end)}`;
  const item = r => { const a = actionOf(r); const g = linkFor(r);
    return `<li class="wk-i" data-id="${esc(r.id)}"><span class="wk-n">${esc(r.c.name)}</span><span class="wk-a">${esc(a.text)} · ${esc(a.left)}${a.review ? ' · <span class="rvnote">Needs review</span>' : ''}</span><span class="wk-b">${g ? `<a class="btn-secondary sm" href="${esc(g)}" target="_blank" rel="noopener">Add to calendar</a>` : ''}<button class="btn-secondary sm" type="button" data-letter="${esc(r.id)}">Draft notice</button></span></li>`; };
  if (t.due.length) return `<p class="wk-h">This week (${esc(span)}): ${t.due.length === 1 ? '1 contract needs' : `${t.due.length} contracts need`} notice sent</p><ul class="wk-l">${t.due.map(item).join('')}</ul>`;
  return `<p class="wk-h">Nothing is due this week (${esc(span)}).${t.next ? ' The next one:' : ''}</p>${t.next ? `<ul class="wk-l">${item(t.next)}</ul>` : ''}`;
}
