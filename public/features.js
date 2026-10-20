// Product features layered on the extractor: calendar links and alarms, notice letter (.docx), more obligations,
// portfolio summary, per-contract audit CSV and safe local storage. Pure functions; no network, no invented data.
import { fold, csvCell, usHoliday, usHolidays, toSentences, locLabel, trimQuote, safeSendBy, buildQueue, daysBetween, ymd, addDays, sure } from './extract.js';

const txt = l => typeof l === 'string' ? l : (l?.text ?? '');
const norm = s => String(s ?? '').replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim();
// Location label for lines a..b (0-based, inclusive), same format as the extractor (page/line, ¶ for DOCX).
export function locOf(lines, a, b = a) {
  const A = lines[a] || {}, B = lines[b] || {};
  return locLabel({ lineStart: a + 1, lineEnd: b + 1, page: A.page ?? null, pageEnd: B.page ?? null, pl: A.pline, plEnd: B.pline, para: !!A.para });
}
const DAY = d => d.replace(/-/g, '');

// ---------- F1: calendar ----------
// The day the reminder goes on: the last business day on or before the send-by date; today if that day has passed.
export function sendDay(actBy, asOf, forward = false) {
  const sb = safeSendBy(actBy, forward); if (!sb.date) return '';
  if (forward) return sb.date;
  return sb.changed && sb.date < asOf && actBy >= asOf ? asOf : sb.date;
}
// Plain note when a send-notice date is not a business day, e.g. "Falls on Thanksgiving. Send by Wed 25 Nov".
// Weekends and US federal holidays (computed by rule for any year, observed dates included).
const SHORTH = { 'Thanksgiving Day': 'Thanksgiving', 'Christmas Day': 'Christmas Day' };
const WD3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function sendByNote(actBy, asOf, forward = false) {
  const sb = safeSendBy(actBy, forward); if (!sb.changed) return '';
  const wd = new Date(actBy + 'T00:00:00Z').getUTCDay(), h = usHoliday(actBy);
  const why = wd === 0 || wd === 6 ? `Falls on a ${['Sunday', '', '', '', '', '', 'Saturday'][wd]}` : `Falls on ${SHORTH[h] || h}`;
  const d = sendDay(actBy, asOf || sb.date, forward), dt = new Date(d + 'T00:00:00Z');
  return `${why}. ${forward ? 'Send notice on or after' : 'Send by'} ${WD3[dt.getUTCDay()]} ${dt.getUTCDate()} ${MON3[dt.getUTCMonth()]}${d.slice(0, 4) !== (asOf || d).slice(0, 4) ? ' ' + d.slice(0, 4) : ''}`;
}
export const ALARM_DAYS = [30, 14, 7];
const icsText = t => String(t).replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const ALARM = (n, name) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:-P${n}D`, `DESCRIPTION:${n} days to the send-notice deadline: ${name}`, 'END:VALARM'];
// Unfold, give every send-notice event alarms at 30, 14 and 7 days (replacing any others), add the early-exit note
// to its description (notes: contract id -> text), then fold again by octets.
export function withAlarms(ics, notes = {}) {
  const L = ics.replace(/\r\n[ \t]/g, '').split('\r\n'); const out = []; let inEv = false, inAl = false, name = '', id = '';
  for (let l of L) {
    if (l === 'BEGIN:VEVENT') { inEv = true; name = ''; id = ''; }
    if (inEv && l.startsWith('SUMMARY:')) name = l.slice(8);
    if (inEv && l.startsWith('UID:')) id = (l.match(/^UID:(.+?)-(?:renews-)?\d{8}@contract-cliffs$/) || [])[1] || '';
    if (inEv && l.startsWith('DESCRIPTION:') && !inAl && notes[id]) l += icsText(' ' + notes[id]);
    if (l === 'BEGIN:VALARM') { inAl = true; continue; }
    if (inAl) { if (l === 'END:VALARM') inAl = false; continue; }
    if (l === 'END:VEVENT' && inEv) { inEv = false; if (/^Send-notice deadline/.test(name)) for (const n of ALARM_DAYS) out.push(...ALARM(n, name.replace(/^Send-notice deadline: /, ''))); }
    out.push(l);
  }
  return out.map(l => fold(l.replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, ''))).join('\r\n');
}
// Early exit: a termination-for-convenience right with a notice length, e.g. "after the first 24 months either party
// may terminate on 30 days' notice". Returns { text, quote, location } or null. Never invents a period.
export const cleanQuote = q => norm(q).replace(/\s+(?:[a-z]|[ivx]{1,4}|\d{1,2})[.)]$/, '');
export function exitNote(c) {
  const t = (c.x?.other || []).find(p => p.notice && p.notice.n && p.source?.quote); if (!t) return null;
  const q = cleanQuote(t.source.quote);
  const who = /\beither\s+party\b|\beach\s+party\b/i.test(q) ? 'either party' : t.who && !/^party$/i.test(t.who) ? t.who : 'one party';
  const after = q.match(/\bfirst\s+((?:[a-z-]+\s+){0,3}\(\d+\)\s*(?:consecutive\s+)?(?:calendar\s+)?(?:months?|years?))[^.;]{0,40}?,?\s*after\s+which/i)?.[1] || q.match(/\bafter\s+the\s+(?:first|initial)\s+((?:[a-z-]+\s+){0,3}\(\d+\)\s*(?:consecutive\s+)?(?:calendar\s+)?(?:months?|years?))/i)?.[1] || (/\bafter\s+the\s+Initial\s+Term\b/i.test(q) ? 'Initial Term' : '');
  const dur = `${t.notice.n} ${t.notice.unit}${t.notice.n === 1 ? '' : 's'}`;
  const text = `${after ? `After the first ${after.replace(/^Initial Term$/, 'term')}, ` : ''}${who} can also end it on ${dur}' notice for any reason (${t.source.location}).`.replace(/^./, m => m.toUpperCase()).replace(/days' /, "days' ").replace(/(\d) day' /, "$1 day's ");
  return { text, quote: q, location: t.source.location, who, after, notice: dur };
}
export function gcalLink({ name, actBy, asOf, quote = '', location = '', url = '', note = '' }) {
  const d = sendDay(actBy, asOf); if (!d) return '';
  const end = ymd(addDays(new Date(d + 'T00:00:00Z'), 1));
  const q = norm(quote); const details = [`Last day to send non-renewal notice: ${actBy}.`, d !== actBy ? `Event is on ${d}, the last business day you can safely send it.` : '', location ? `Clause (${location}): "${q.length > 600 ? q.slice(0, 600) + '...' : q}"` : '', note || '', url ? `Source: ${url}` : '', 'Made with Contract Cliffs. Check the clause before relying on this date.'].filter(Boolean).join('\n');
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent('Send non-renewal notice: ' + name) + '&dates=' + DAY(d) + '/' + DAY(end) + '&details=' + encodeURIComponent(details);
}

// ---------- F3: more obligations ----------
const HEAD = /^(?:(?:Section|Article)?\s*\d+(?:\.\d+)*\.?\s*[-–]?\s*)?(?:Notices?|NOTICES?)(?:\s+Addresses)?\s*[.:]?\s*/;
const METHODS = [[/personal(?:ly)?\s+deliver|deliver\w*\s+(?:either\s+)?in\s+person|personally\s+given|\bin\s+person\b|by\s+hand/i, 'personal delivery'], [/certified|registered\s+mail|return\s+receipt|first\s+class\s+mail|United\s+States\s+mail|U\.S\.\s+mail|prepaid\s+(?:certified\s+)?mail/i, 'mail (certified, registered or first class)'], [/courier|overnight/i, 'courier or overnight delivery'], [/e-?mail/i, 'email'], [/facsimile|telecopy|\bfax\b/i, 'fax']];
export function noticeClause(lines) {
  const T = lines.map(txt);
  for (let i = 0; i < T.length; i++) {
    const t = T[i].trim(); if (!HEAD.test(t)) continue;
    if (/^Notice\s+of\b/i.test(t) || /^Notices?\s+to\s+/i.test(t)) continue;
    // body: the heading line plus following lines until ~900 chars
    let j = i, body = '';
    while (j < T.length && body.length < 900) { body += ' ' + T[j].trim(); j++; if (j > i && /^\s*(?:\d+(?:\.\d+)+\.?|Section\s+\d)/.test(T[j] || '') && body.length > 200) break; }
    if (!/\b(writing|deliver|given|addressed|sent)\b/i.test(body.slice(0, 500))) continue; // table of contents, etc.
    const addresses = noticeAddresses(T, i, Math.min(T.length, i + 60)).map(({ a, b, ...x }) => ({ ...x, start: a, lineStart: a + 1, lineEnd: b + 1, location: locOf(lines, a, b) }));
    const firstA = addresses.length ? addresses[0].start : j;
    const end = Math.max(i, Math.min(j - 1, i + 8, firstA - 1));
    const methods = METHODS.filter(([re]) => re.test(T.slice(i, Math.max(end + 1, Math.min(j, firstA))).join(' '))).map(m => m[1]); let quote = trimQuote(norm(T.slice(i, end + 1).join(' '))); if (quote.length > 700) quote = quote.slice(0, 700).replace(/\s\S*$/, '') + '...';
    const ref = body.match(/(?:address(?:es)?\s+(?:first\s+)?(?:set\s+forth|specified|listed|indicated|stated)\s+(?:in|on|below|above)\s*[^.;]{0,60}|address\s+listed\s+in\s+the\s+Account)/i)?.[0] || '';
    return { methods, quote, location: locOf(lines, i, end), lineStart: i + 1, lineEnd: end + 1, addresses, ref: norm(ref) };
  }
  return null;
}
// "If to Cerus:" / "Notice to Seller:" / "If to PWRU:" blocks with a street address or Attention line.
function noticeAddresses(T, from, to) {
  const out = [];
  for (let i = from; i < to; i++) {
    const t = T[i].trim(); const nx = (T[i + 1] || '').trim();
    let m = t.match(/^(?:if\s+to|notices?\s+to)\s*(?:the\s+)?([A-Z][\w .,&'’-]{0,60}?)\s*:\s*(.*)$/i), two = false;
    if (!m && /^(?:Notice|If|To)$/i.test(t)) { m = nx.match(/^(?:to\s+)?(?:the\s+)?([A-Z][\w .,&'’-]{0,60}?)\s*:\s*(.*)$/); two = !!m; }
    if (!m) continue;
    const start = i; if (two) i++;
    const block = m[2] ? [m[2]] : []; let k = i + 1;
    for (; k < to && block.length < 8; k++) { const u = T[k].trim(); if (!u || /^(?:if\s+to|notices?\s+to|or\s+to\s+such|any\s+party|either\s+party|\d+(?:\.\d+)+)/i.test(u) || /^(?:Notice|If|To)$/i.test(u) || u.length > 240) break; block.push(u); }
    const text = block.join(' · ');
    if (/\d{3,}|P\.?O\.?\s+Box|@/i.test(text) || block.length >= 3) out.push({ to: m[1].trim(), text, lines: block, a: start, b: k - 1 });
    i = k - 1;
  }
  return out;
}
const ESC = /\b(?:increase|escalat\w*|adjust\w*)\b[^.]{0,160}?(?:\d+(?:\.\d+)?\s*%|\bpercent\b|Consumer\s+Price\s+Index|\bCPI\b)|(?:\d+(?:\.\d+)?\s*%|Consumer\s+Price\s+Index|\bCPI\b)[^.]{0,120}?\b(?:increase|escalat\w*|adjust\w*)\b/i;
const PRICEWORD = /\b(?:price|prices|pricing|fees?|rates?|rent|retainer|charges?|compensation)\b/i;
const LATE = /\binterest\b|late\s+(?:fee|charge|payment)|past\s+due|overdue/i;
export function escalators(lines) {
  const S = toSentences(lines); const out = [];
  for (let k = 0; k < S.length && out.length < 3; k++) {
    const s = S[k]; if (s.text.length > 1200 || !ESC.test(s.text) || LATE.test(s.text)) continue;
    // a short follow-on sentence ("Adjustments shall not exceed 8%") takes its price word from the sentence before
    const p = S[k - 1]; const joint = !PRICEWORD.test(s.text) && p && s.text.length < 200 && PRICEWORD.test(p.text) && /\b(?:increase|adjust\w*|escalat\w*)\b/i.test(p.text);
    if (!PRICEWORD.test(s.text) && !joint) continue;
    const a = joint ? p : s; if (out.some(o => o.lineStart === a.lineStart)) continue;
    out.push({ quote: trimQuote(joint ? p.text + ' ' + s.text : s.text), location: locLabel({ ...a, lineEnd: s.lineEnd, pageEnd: s.pageEnd, plEnd: s.plEnd }), lineStart: a.lineStart, lineEnd: s.lineEnd });
  }
  return out;
}
// Four obligations for the detail panel. Each is { found, summary, quote, location } or found:false (left blank).
export function obligations(c) {
  const nc = noticeClause(c.lines);
  const tfc = c.x.other || [], pay = c.x.payments || [], esc = escalators(c.lines);
  const uniq = arr => arr.filter((p, k) => arr.findIndex(q => q.source?.location === p.source?.location) === k);
  return [
    { key: 'notice', label: 'Notice method and address', found: !!nc, summary: nc ? `${nc.methods.length ? 'How: ' + nc.methods.join(', ') + '.' : 'How: not stated in the clause.'} ${nc.addresses.length ? 'Addresses found: ' + nc.addresses.length + '.' : 'Address: not found in the notices clause' + (nc.ref ? ` (it points to the "${nc.ref}")` : '') + '.'}` : '', quote: nc?.quote || '', location: nc?.location || '', lineStart: nc?.lineStart, lineEnd: nc?.lineEnd, extra: (nc?.addresses || []).map(a => ({ label: 'To ' + a.to, quote: a.text, location: a.location, lineStart: a.lineStart, lineEnd: a.lineEnd })) },
    { key: 'tfc', label: 'Termination for convenience', found: tfc.length > 0, items: tfc.map(p => ({ summary: `${p.rule}${p.who && !/^party$/i.test(p.who) ? ' · held by ' + p.who : ''}`, quote: p.source?.quote || '', location: p.source?.location || '', lineStart: p.source?.lineStart, lineEnd: p.source?.lineEnd })) },
    { key: 'esc', label: 'Price escalator', found: esc.length > 0, items: esc.map(e => ({ summary: '', quote: e.quote, location: e.location, lineStart: e.lineStart, lineEnd: e.lineEnd })) },
    { key: 'pay', label: 'Payment terms', found: pay.length > 0, items: uniq(pay).slice(0, 3).map(p => ({ summary: p.rule, quote: p.source?.quote || '', location: p.source?.location || '', lineStart: p.source?.lineStart, lineEnd: p.source?.lineEnd })) },
  ];
}

// ---------- F2: draft non-renewal letter ----------
export const FILL = '[FILL IN]';
// Every placeholder names what to fill in, the same way as the date line.
export const fill = what => `[${what.toUpperCase()}, FILL IN]`;
const fmtLong = d => { if (!d) return fill('date'); const [y, m, dd] = d.split('-'); return `${+dd} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+m - 1]} ${y}`; };
export function letter(c, r, asOf) {
  const parties = String(c.name || '').includes(' / ') ? c.name.split(' / ').map(s => s.trim()) : [];
  const nc = noticeClause(c.lines); const q = r?.item?.source;
  const addr = nc?.addresses?.length ? nc.addresses.map(a => `${a.to}: ${a.text} (notices clause, ${a.location})`) : [`${fill('notice address')} (no notice address found in the notices clause${nc?.ref ? `; it points to the "${nc.ref}"` : ''})`];
  const sendBy = r?.actBy ? fmtLong(r.actBy) : fill('last day to give notice'); const ex = exitNote(c);
  const L = [
    'DRAFT. NOT SENT. CHECK EVERY LINE AGAINST THE CONTRACT BEFORE USE. NOT LEGAL ADVICE.',
    '',
    `Date: [YOUR SEND DATE, FILL IN] (the day you send it; today is ${fmtLong(asOf)})`,
    `Parties to the agreement: ${parties.length ? parties.join(' and ') : fill('parties')}`,
    `From: ${fill('your company, name, title and address')}`,
    `To: ${fill('other party')}${parties.length ? ` (${parties.join(' or ')})` : ''}`,
    'Notice address from the contract (pick the other party\'s):',
    ...addr.map(a => '  ' + a),
    nc?.methods?.length ? `Send by: ${nc.methods.join(', ')} (as allowed by the notices clause, ${nc.location}).` : `Send by: ${fill('delivery method')} (no delivery method found in a notices clause).`,
    '',
    `Re: Notice of non-renewal of the ${c.title || 'agreement'} between ${parties.length ? parties.join(' and ') : fill('parties')}`,
    '',
    `Dear ${fill('other party')},`,
    '',
    `Under the renewal clause of the agreement, quoted below, we give notice that we do not wish to renew the agreement and that it will end at the close of its current term${r?.item?.termEnd ? `, ${fmtLong(r.item.termEnd)}` : ''}.`,
    '',
    q?.quote ? `Renewal clause (${q.location}): "${norm(q.quote)}"` : `Renewal clause: ${fill('renewal clause')} (no renewal clause found)`,
    '',
    ...(ex ? [`Note: ${ex.text} If that option fits better, it may be quicker than waiting for the term to end. Termination clause (${ex.location}): "${ex.quote}"`, ''] : []),
    r?.actBy ? `This notice is given on or before ${sendBy}, the last day to give notice under the clause above.` : `Last day to give notice: ${fill('last day to give notice')} (no date could be worked out from the contract).`,
    '',
    'Please confirm receipt of this notice in writing.',
    '',
    'Sincerely,',
    '',
    fill('your name, title and company'),
  ];
  return L.join('\n');
}
// Minimal .docx (stored ZIP, no compression) holding one paragraph per line.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export const crc32 = b => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zip(files) {
  const enc = new TextEncoder(); const parts = [], cen = []; let off = 0;
  for (const [name, data] of files) {
    const n = enc.encode(name), d = typeof data === 'string' ? enc.encode(data) : data, crc = crc32(d);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, n.length, true);
    parts.push(new Uint8Array(h.buffer), n, d);
    const cd = new DataView(new ArrayBuffer(46)); cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(14, 0x21, true); cd.setUint32(16, crc, true); cd.setUint32(20, d.length, true); cd.setUint32(24, d.length, true); cd.setUint16(28, n.length, true); cd.setUint32(42, off, true);
    cen.push(new Uint8Array(cd.buffer), n); off += 30 + n.length + d.length;
  }
  const size = cen.reduce((a, b) => a + b.length, 0); const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  const all = [...parts, ...cen, new Uint8Array(e.buffer)]; const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0; for (const a of all) { out.set(a, p); p += a.length; } return out;
}
const xesc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
export function docx(text) {
  const paras = text.split('\n').map((l, k) => `<w:p>${k === 0 ? '<w:pPr><w:jc w:val="center"/></w:pPr>' : ''}<w:r>${k === 0 ? '<w:rPr><w:b/><w:color w:val="C00000"/></w:rPr>' : ''}<w:t xml:space="preserve">${xesc(l)}</w:t></w:r></w:p>`).join('');
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}<w:sectPr/></w:body></w:document>`],
  ]);
}

// ---------- F4: portfolio summary ----------
// One deadline group per contract, by its next send-by date, so the groups add up to the total. Review status and an
// earlier missed date are flags on top of the group: they never hide how soon the next deadline is.
export const BUCKETS = [['passed', 'Past due'], ['d30', 'Due in 30 days'], ['d90', 'Due in 31 to 90 days'], ['d365', 'Due in 91 to 365 days'], ['later', 'Later'], ['cant', 'Can’t tell'], ['expired', 'Expired']];
export const FLAGS = [['review', 'Needs review'], ['missed', 'Earlier date missed']];
export function bucket(r) {
  if (r.section === 'lapsed') return 'expired';
  if (!r.actBy) return 'cant';
  if (r.days != null && r.days < 0) return 'passed';
  return r.days <= 30 ? 'd30' : r.days <= 90 ? 'd90' : r.days <= 365 ? 'd365' : 'later';
}
// Flags apply to dated rows only; a row with no date is already counted under Can't tell.
export const flagsOf = r => r.section === 'lapsed' || !r.actBy ? [] : [r.needsReview && 'review', r.missed && 'missed'].filter(Boolean);
export const bucketLabel = k => BUCKETS.find(b => b[0] === k)[1];
export const rowLabel = r => [bucketLabel(bucket(r)), ...flagsOf(r).map(f => FLAGS.find(x => x[0] === f)[1].toLowerCase())].join(' · ');
export function portfolio(rows) {
  const o = Object.fromEntries([...BUCKETS, ...FLAGS].map(([k]) => [k, 0])); for (const r of rows) { o[bucket(r)]++; for (const f of flagsOf(r)) o[f]++; } o.total = rows.length; return o;
}
// Summary: three big numbers, then the full breakdown in one small line. The breakdown adds up to the total.
// Act this month = past due or due within 30 days, whatever the review status. Needs a human look = needs review or no date.
export const summaryOf = pf => ({ act: pf.passed + pf.d30, year: pf.d90 + pf.d365, human: pf.review + pf.cant });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export function stripHtml(pf) {
  const s = summaryOf(pf);
  const tile = (k, n, l, c) => `<div class="big ${k}${n ? '' : ' zero'}"><span class="sv">${n}</span><span class="bl">${l}</span><span class="bc">${c}</span></div>`;
  const parts = [pf.passed && `${pf.passed} past due`, `${pf.d30} within 30 days`, `${pf.d90} in 31 to 90 days`, `${pf.d365} in 91 to 365 days`, `${pf.later} later`, `${pf.cant} with no date found`, pf.expired && `${pf.expired} expired`].filter(Boolean);
  return tile('act', s.act, 'Act this month', 'Send-notice date in 30 days or less, or past')
    + tile('year', s.year, 'Next 12 months', 'Send-notice date in 31 to 365 days')
    + tile('human', s.human, 'Needs a human look', `${pf.review} to review, ${pf.cant} with no date found`)
    + `<p class="pfflags">All ${pf.total} by next deadline: ${parts.join(', ')}.${pf.missed ? ` ${plural(pf.missed, 'contract', 'contracts')} had an earlier send-notice date missed.` : ''}</p>`;
}

// ---------- F5: audit CSV, one row per contract ----------
// Same guard as the main export: formulas (=, +, -, @, tab, CR) get a leading ' ; plain numbers such as -2 stay numbers.
const cell = csvCell;
export function statusOf(r) { return r.missed ? 'Missed: send-notice deadline passed, not yet renewed' : r.section === 'lapsed' ? 'Expired' : r.days != null && r.days < 0 ? 'Passed' : !r.actBy ? 'Needs review: no date found' : r.days <= 30 ? 'Due within 30 days' : r.days <= 90 ? 'Due within 90 days' : r.days <= 365 ? 'Due within 365 days' : 'Later than 365 days'; }
export function auditCSV(contracts, asOf) {
  const rows = buildQueue(contracts, asOf); const byId = new Map(contracts.map(c => [c.id, c]));
  const head = ['contract', 'counterparty', 'deadline', 'send_by_business_day', 'days_from_as_of', 'as_of', 'status', 'needs_review', 'review_reason', 'confidence', 'evidence_location', 'evidence_quote', 'source'];
  const out = [head.join(',')];
  for (const r of rows) { const c = byId.get(r.id); const d = r.missed ? r.missed.actBy : r.actBy;
    out.push([c.name, c.counterparty || '', d || '', d ? sendDay(d, asOf) : '', d ? daysBetween(asOf, d) : '', asOf, statusOf(r), r.needsReview ? 'yes' : 'no', r.needsReview ? r.tag || '' : '', sure(r.confidence), r.item?.source?.location || '', norm(r.item?.source?.quote || ''), c.url || c.fileName || ''].map(cell).join(',')); }
  return out.join('\r\n') + '\r\n';
}

// ---------- F6: safe local storage ----------
export const STORE_KEY = 'cc-docs';
// Returns { docs, error }. Never throws; drops entries that are not well-formed.
export function parseSaved(raw) {
  if (raw == null || raw === '') return { docs: [], error: '' };
  let v; try { v = JSON.parse(raw); } catch { return { docs: [], error: 'corrupt' }; }
  if (!Array.isArray(v)) return { docs: [], error: 'corrupt' };
  const docs = v.filter(m => m && typeof m === 'object' && typeof m.name === 'string' && Array.isArray(m.lines) && m.lines.length && m.lines.every(l => typeof l === 'string' || (l && typeof l.text === 'string')));
  return { docs, error: docs.length < v.length ? 'partial' : '', bad: v.length - docs.length };
}

// "Within N days prior" clauses: the window opens on the send-notice date (moved forward to a business day) and closes when the term ends.
const dShort = (d, y) => { const [yy, m, dd] = d.split('-'); return `${+dd} ${MON3[+m - 1]}${y ? ' ' + yy : ''}`; };
export function windowOf(r) {
  const i = r?.item || r; const at = r?.actBy || i?.date; if (!i?.within || !at || !i.termEnd) return null;
  const from = safeSendBy(at, true).date || at, to = i.termEnd, dt = new Date(from + 'T00:00:00Z');
  return { from, to, label: 'Send notice on or after', fromW: `${WD3[dt.getUTCDay()]} ${dShort(from, true)}`, range: `send between ${dShort(from, from.slice(0, 4) !== to.slice(0, 4))} and ${dShort(to, true)}`, n: i.notice?.n, unit: i.notice?.unit };
}
export const windowNote = r => { const w = windowOf(r); return w ? `"Within ${w.n} ${w.unit}${w.n === 1 ? '' : 's'} prior": ${w.range}. ${dShort(w.from, true)} is the earliest safe date` : ''; };
