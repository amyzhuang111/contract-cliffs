// Product features layered on the extractor: calendar links and alarms, notice letter (.docx), more obligations,
// portfolio summary, per-contract audit CSV and safe local storage. Pure functions; no network, no invented data.
import { locLabel, safeSendBy, ymd, addDays } from './extract.js';

const txt = l => typeof l === 'string' ? l : (l?.text ?? '');
const norm = s => String(s ?? '').replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
// Location label for lines a..b (0-based, inclusive), same format as the extractor (page/line, ¶ for DOCX).
export function locOf(lines, a, b = a) {
  const A = lines[a] || {}, B = lines[b] || {};
  return locLabel({ lineStart: a + 1, lineEnd: b + 1, page: A.page ?? null, pageEnd: B.page ?? null, pl: A.pline, plEnd: B.pline, para: !!A.para });
}
const DAY = d => d.replace(/-/g, '');

// ---------- F1: calendar ----------
// The day the reminder goes on: the last business day on or before the send-by date; today if that day has passed.
export function sendDay(actBy, asOf) {
  const sb = safeSendBy(actBy); if (!sb.date) return '';
  return sb.changed && sb.date < asOf && actBy >= asOf ? asOf : sb.date;
}
export const ALARM_DAYS = [30, 14, 7];
const ALARM = (n, name) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:-P${n}D`, `DESCRIPTION:${n} days to the send-notice deadline: ${name}`, 'END:VALARM'];
// Give every send-notice event alarms at 30, 14 and 7 days before it (replaces any existing alarms on that event).
export function withAlarms(ics) {
  const L = ics.split('\r\n'); const out = []; let inEv = false, inAl = false, name = '', summary = false;
  for (const l of L) {
    if (l === 'BEGIN:VEVENT') { inEv = true; name = ''; summary = false; }
    if (inEv && l.startsWith('SUMMARY:')) { summary = true; name = l.slice(8); }
    else if (inEv && summary && l.startsWith(' ')) { name += l.slice(1); }
    else if (inEv) summary = false;
    if (l === 'BEGIN:VALARM') { inAl = true; continue; }
    if (inAl) { if (l === 'END:VALARM') inAl = false; continue; }
    if (l === 'END:VEVENT' && inEv) { inEv = false; if (/^Send-notice deadline/.test(name)) for (const n of ALARM_DAYS) out.push(...ALARM(n, name.replace(/^Send-notice deadline: /, ''))); }
    out.push(l);
  }
  return out.join('\r\n');
}
export function gcalLink({ name, actBy, asOf, quote = '', location = '', url = '' }) {
  const d = sendDay(actBy, asOf); if (!d) return '';
  const end = ymd(addDays(new Date(d + 'T00:00:00Z'), 1));
  const q = norm(quote); const details = [`Last day to send non-renewal notice: ${actBy}.`, d !== actBy ? `Event is on ${d}, the last business day you can safely send it.` : '', location ? `Clause (${location}): "${q.length > 600 ? q.slice(0, 600) + '...' : q}"` : '', url ? `Source: ${url}` : '', 'Made with Contract Cliffs. Check the clause before relying on this date.'].filter(Boolean).join('\n');
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent('Send non-renewal notice: ' + name) + '&dates=' + DAY(d) + '/' + DAY(end) + '&details=' + encodeURIComponent(details);
}

