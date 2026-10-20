// Product features layered on the extractor: calendar links and alarms, notice letter (.docx), more obligations,
// portfolio summary, per-contract audit CSV and safe local storage. Pure functions; no network, no invented data.
import { toSentences, locLabel, trimQuote, safeSendBy, buildQueue, daysBetween, ymd, addDays, sure } from './extract.js';

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
export const FILL = '[NOT FOUND, FILL IN]';
const fmtLong = d => { if (!d) return FILL; const [y, m, dd] = d.split('-'); return `${+dd} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+m - 1]} ${y}`; };
export function letter(c, r, asOf) {
  const parties = String(c.name || '').includes(' / ') ? c.name.split(' / ').map(s => s.trim()) : [];
  const nc = noticeClause(c.lines); const q = r?.item?.source;
  const addr = nc?.addresses?.length ? nc.addresses.map(a => `${a.to}: ${a.text} (notices clause, ${a.location})`) : [`${FILL} (no notice address found in the notices clause${nc?.ref ? `; it points to the "${nc.ref}"` : ''})`];
  const sendBy = r?.actBy ? fmtLong(r.actBy) : FILL;
  const L = [
    'DRAFT. NOT SENT. CHECK EVERY LINE AGAINST THE CONTRACT BEFORE USE. NOT LEGAL ADVICE.',
    '',
    `Date: ${FILL}`,
    `Parties to the agreement: ${parties.length ? parties.join(' and ') : FILL}`,
    `From: ${FILL} (your company, name, title and address)`,
    `To: ${FILL} (the other party${parties.length ? ': ' + parties.join(' or ') : ''})`,
    'Notice address from the contract (pick the other party\'s):',
    ...addr.map(a => '  ' + a),
    nc?.methods?.length ? `Send by: ${nc.methods.join(', ')} (as allowed by the notices clause, ${nc.location}).` : `Send by: ${FILL} (no delivery method found in a notices clause).`,
    '',
    `Re: Notice of non-renewal of the ${c.title || 'agreement'} between ${parties.length ? parties.join(' and ') : FILL}`,
    '',
    'To whom it may concern,',
    '',
    `Under the renewal clause of the agreement, quoted below, we give notice that we do not wish to renew the agreement and that it will end at the close of its current term${r?.item?.termEnd ? `, ${fmtLong(r.item.termEnd)}` : ''}.`,
    '',
    q?.quote ? `Renewal clause (${q.location}): "${norm(q.quote)}"` : `Renewal clause: ${FILL} (no renewal clause found)`,
    '',
    r?.actBy ? `This notice is given on or before ${sendBy}, the last day to give notice under the clause above.` : `Last day to give notice: ${FILL} (no date could be worked out from the contract).`,
    '',
    'Please confirm receipt of this notice in writing.',
    '',
    'Sincerely,',
    '',
    `${FILL}: name, title, company`,
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
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, n.length, true);
    parts.push(new Uint8Array(h.buffer), n, d);
    const cd = new DataView(new ArrayBuffer(46)); cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint32(16, crc, true); cd.setUint32(20, d.length, true); cd.setUint32(24, d.length, true); cd.setUint16(28, n.length, true); cd.setUint32(42, off, true);
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
export function portfolio(rows) {
  const live = rows.filter(r => !r.missed && r.section !== 'lapsed' && r.days != null && r.days >= 0);
  return { total: rows.length, d30: live.filter(r => r.days <= 30).length, d90: live.filter(r => r.days <= 90).length, d365: live.filter(r => r.days <= 365).length, passed: rows.filter(r => r.missed || (r.days != null && r.days < 0 && r.section !== 'lapsed')).length, review: rows.filter(r => r.needsReview).length, expired: rows.filter(r => r.section === 'lapsed').length };
}

// ---------- F5: audit CSV, one row per contract ----------
const cell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) || /^[=+\-@\t\r]/.test(s) ? '"' + (/^[=+\-@\t\r]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
export function statusOf(r) { return r.missed ? 'Missed: send-notice deadline passed, not yet renewed' : r.section === 'lapsed' ? 'Expired' : r.days != null && r.days < 0 ? 'Passed' : !r.actBy ? 'Needs review: no date found' : r.days <= 30 ? 'Due within 30 days' : r.days <= 90 ? 'Due within 90 days' : r.days <= 365 ? 'Due within 365 days' : 'Later than 365 days'; }
export function auditCSV(contracts, asOf) {
  const rows = buildQueue(contracts, asOf); const byId = new Map(contracts.map(c => [c.id, c]));
  const head = ['contract', 'counterparty', 'deadline', 'send_by_business_day', 'days_from_as_of', 'as_of', 'status', 'needs_review', 'review_reason', 'confidence', 'evidence_location', 'evidence_quote', 'source'];
  const out = [head.join(',')];
  for (const r of rows) { const c = byId.get(r.id); const d = r.missed ? r.missed.actBy : r.actBy;
    out.push([c.name, c.counterparty || '', d || '', d ? sendDay(d, asOf) : '', d ? daysBetween(asOf, d) : '', asOf, statusOf(r), r.needsReview ? 'yes' : 'no', r.needsReview ? r.tag || '' : '', sure(r.confidence), r.item?.source?.location || '', norm(r.item?.source?.quote || ''), c.url || c.fileName || ''].map(cell).join(',')); }
  return out.join('\r\n') + '\r\n';
}

