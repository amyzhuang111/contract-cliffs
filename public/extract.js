// Contract Cliffs: deterministic date-obligation extractor. No network, no LLM.
// Works in the browser (ES module) and in Node (tests).

const NUM_WORDS = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
  eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19,
  twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90 };
const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
const MONTH_RE = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sept?\\.?|Oct\\.?|Nov\\.?|Dec\\.?)';
const NUMWORD_RE = '(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|and|a)[\\s-]*)+';
const REDACT_RE = '\\[\\s*(?:\\*+|\\.{3}|redacted)\\s*\\]';
// "sixty (60) days", "Eighty-Four (84) months", "fifteen Years", "90 days", "one hundred and eighty (180) days", "[***] days"
// "by and between X ... and Y" in the preamble -> "X / Y" (short names), or '' if not found.
const SUFFIX = /,?\s+(?:Inc|Corp|Corporation|LLC|L\.L\.C|Ltd|Limited|Co|Company|plc|N\.A|L\.P|LP|S\.A|GmbH|B\.V)\.?$/i;
const shortParty = t => { let x = t.replace(/^\s*(?:the\s+)?/i, '').replace(/\s+/g, ' ').trim(); for (let i = 0; i < 2; i++) x = x.replace(SUFFIX, '').trim(); x = x.replace(/[,.;:]+$/, ''); return x.length <= 40 ? x : x.slice(0, 41).replace(/\s+\S*$/, '') + '…'; };
// Letter agreements have no "between": the addressee is named before the salutation, the company in the body.
function letterParties(text) {
  if (!/\bDear\s/.test(text)) return '';
  const to = text.match(/(?:Exhibit\s+[\d.]+|\b(?:19|20)\d\d)\s+((?:Mr\.|Ms\.|Mrs\.|Dr\.)\s+)?([A-Z][a-z]+(?:\s+[A-Z]\.)?(?:\s+(?!Chief|Executive|Senior)[A-Z][a-z]+){1,2})\s+(?=\d|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Officer|Director|President)|Chief)/);
  const co = text.match(/\b(?:On\s+behalf\s+of|of)\s+((?:[A-Z][\w.&-]*\s+){0,3}?[A-Z][\w.&-]*,?\s+(?:Inc|Corp|Corporation|LLC|Ltd|plc|Company)\.?)(?=[\s,(])/);
  if (!to || !co) return '';
  return `${co[1].replace(/,?\s+(?:Inc|Corp|Corporation|LLC|Ltd|plc|Company)\.?$/i, '').trim()} / ${to[2]}`;
}
// Defined party roles in the opening lines ((the “Company”) … (the “Executive”)), for a contract whose names could not be read.
export function definedRoles(lines) {
  const text = lines.slice(0, 30).map(l => typeof l === 'string' ? l : l.text).join(' ');
  const ROLE = /^(?:Company|Executive|Employee|Employer|Consultant|Contractor|Client|Customer|Supplier|Vendor|Seller|Buyer|Purchaser|Licensor|Licensee|Agent|Principal|Distributor|Manufacturer|Provider|Service\s+Provider|Landlord|Tenant|Lender|Borrower|Member)$/i;
  const out = []; for (const m of text.matchAll(/\(\s*(?:the\s+)?[“"]\s*([A-Z][A-Za-z ]{1,24}?)\s*[”"]/g)) if (ROLE.test(m[1]) && !out.includes(m[1])) out.push(m[1]);
  return out.length >= 2 ? out.slice(0, 2).join(' / ') : '';
}
export function partiesFromPreamble(lines) {
  const text = lines.slice(0, 80).map(l => typeof l === 'string' ? l : l.text).join(' ').replace(/\s+/g, ' ').slice(0, 6000);
  const m = [...text.matchAll(/\b(?:by\s+and\s+(?:between|among)|(?:made|entered\s+into|dated)[^.]{0,160}?\b(?:between|among)|\bis\s+between|Agreement[”"]\),?\s+between|\bAgreement,\s+between|\bgovern\w*\s+the\s+(?:contractual\s+)?(?:agreement|relationship)\s+between|\bentered\s+into\s+by|[”\"]\s*\),?\s+(?:by\s+and\s+)?between|[”\"]\s*\),?\s+by(?!\s+and\b)(?=\s+[A-Z])|\bParties:?(?=\s+(?:1\.|\(1\)|\(a\))\s)):?\s+(?=(.{4,700}))/gi)].find(x => !/^(?:the\s+)?(?:company|parties|undersigned)\b|^by\b|^(?:the\s+)?registrant\b/i.test(x[1]));
  // "Party A: GOLDENSEE LIMITED (…) Party B: ARMSTRONG LOGISTIC INC (…)" (translated contracts).
  const pab = text.match(/\bParty\s+A\s*[:：]\s*([^()“":：]{2,80}?)\s*(?:\(|Party\s+B)[^]{0,200}?\bParty\s+B\s*[:：]\s*([^()“":：]{2,80}?)\s*(?:\(|$|\s(?:On|This|Whereas|WHEREAS)\b)/);
  if (pab) { const T = x => { const y = x.trim().replace(/[,.;]+$/, ''); return /[a-z]/.test(y) ? shortParty(y) : shortParty(y.replace(/\b([A-Z])([A-Z]+)\b/g, (w, f, r) => w.length <= 3 ? w : f + r.toLowerCase())); }; return `${T(pab[1])} / ${T(pab[2])}`; }
  if (!m) return letterParties(text);
  const LEAD = /^\s*(?:the\s+following(?:\s+(?:parties|persons|entities))?\s*(?:\([^)]{0,80}\))?\s*:?\s*)?(?:\d{1,2}[.)]|\([a-z0-9]{1,3}\))?\s*/i;
  const seg = m[1].replace(LEAD, '').replace(/^\(i\)\s*/i, '').replace(/;\s*(?:and\s+)?\(ii\)\s*/i, '; and '); let a = '', b = '';
  { const ok = mm => { const k = mm.index; return k > 1 && k < 400 && !/^(?:together|each|any|its|whereas|collectively|individually|shall|will|is|are|that|such|effective|dated|made|entered|solely|below|the\s+below|the\s+undersigned|an?\s+(?:wholly|direct|indirect|subsidiary|affiliate)|its\s+(?:parent|affiliate|subsidiary))\b/i.test(seg.slice(k + mm[0].length)); };
    const best = [/[)”"]\s*[;,]?\s+and\s+/gi, /;\s*and\s+/gi, /,\s+and\s+/gi].map(re => [...seg.matchAll(re)].find(ok)).filter(Boolean).sort((x, y) => x.index - y.index)[0] || [...seg.matchAll(/\s+and\s+/gi)].find(ok) || [...seg.matchAll(/[)”"]\s*,\s+(?=[A-Z])/g)].find(ok);
    if (best) { a = seg.slice(0, best.index + 1); b = seg.slice(best.index + best[0].length).replace(LEAD, ''); } }
  const KEEP = /^(?:USA|US|UK|EU|NA|II|III|IV)$/;
  const tc = x => /[a-z]/.test(x) ? x : x.replace(/\b(\d+)(ST|ND|RD|TH)\b/g, (w, d, o) => d + o.toLowerCase()).replace(/\b([A-Z])([A-Z]+)\b/g, (w, f, r) => w.length <= 2 || KEEP.test(w) || (w.length <= 4 && (!/[AEIOUY]/.test(w) || /[^AEIOUY]{3}/.test(w))) || (w.length <= 4 && new RegExp(`\\b${w}\\s+[A-Z][a-z]`).test(text)) ? w : f + r.toLowerCase());
  // cut at the first comma, bracket, quote, semicolon, dba, "dated", "exhibit", "a <State> ...", or just after an entity suffix
  const cut = x => { let y = x.split(/\s+(?:(?:EMPLOYMENT|CONSULTING|SERVICES?|SUPPLY|LICENSE|MASTER|SEPARATION|SEVERANCE|PURCHASE|LEASE|DISTRIBUTION|AMENDED|RESTATED|AND|&)\s+){0,3}AGREEMENT\b/)[0].split(/\s+\.(?:\s|$)|\.\s+(?=WHEREAS|RECITALS|W\s?I\s?T|NOW|The\s|Capitalized|\d)|\s+(?:existing|organized|incorporated)\s+under\b|\s*[(“"\[]|,|;|\s+(?:dba|d\/b\/a)\s|\s+(?:dated|exhibit)\b|\s+an?\s+(?:individual|resident)\b|\s+an?\s+(?:[A-Z][a-z]+\s+){1,2}(?:corporation|company|limited|partnership)/i)[0]; const sfx = y.match(/^(.*?\b(?:L\.L\.C\.|LLC|Inc\.?|Ltd\.?|Limited|Corp\.?|Corporation|plc))(?=\s|$)/i); return sfx ? sfx[1] : y; };
  const withheld = x => /^\W*\(?\s*(?:omitted|redacted|\[\*+\]|\*{3})/i.test(x);
  const one = x => withheld(x) ? 'party withheld in filing' : tc(shortParty(cut(x)));
  // a defined short name that starts the full name ("Nanochem Solutions, Inc. ... (“Nanochem”)") is preferred
  const short = (x, full) => { const d = [...x.matchAll(/[“"]([^”"]{2,30})[”"]/g)].map(q => q[1]).find(q => full.toLowerCase().startsWith(q.toLowerCase() + ' ')); return d || full; };
  const recase = n => { if (!n || /[a-z][A-Z]/.test(n)) return n; const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const hit = (text.match(new RegExp('\\b' + esc + '\\b', 'gi')) || []).find(h => /[a-z]/.test(h) && /[a-z][A-Z]/.test(h)); return hit || n; };
  if (!a) { const A0 = recase(tc(shortParty(cut(seg)))); return A0.length > 1 && !withheld(seg) && !/^(?:the\s+)?(?:parties|company|undersigned|executive)\b/i.test(A0) ? A0 : ''; }
  let A = one(a), B = one(b); if (A !== 'party withheld in filing') A = short(a, A); if (B !== 'party withheld in filing') B = short(b, B);
  A = recase(A); B = recase(B);
  // Title-line split that kept both names in A ("Heartsciences And Andrew Simpson / Andrew Simpson").
  if (B.length > 1 && A.toLowerCase().endsWith(' and ' + B.toLowerCase())) A = A.slice(0, A.length - B.length - 5).trim();
  // "each of the associate companies listed on the signature page (each a “Client Company” and collectively the “Client Companies”)": use the defined collective name.
  const coll = x => x.match(/collectively[,]?\s+(?:the\s+)?[“"]\s*([^”"]{2,40}?)\s*[”"]/)?.[1] || x.match(/each\s+(?:a|an)\s+[“"]\s*([^”"]{2,40}?)\s*[”"]/)?.[1];
  if (/^each\s+of\b|\blisted\b/i.test(A) && coll(a)) A = coll(a);
  if (/^each\s+of\b|\blisted\b/i.test(B) && coll(b)) B = coll(b);
  // A generic role ("the Industrious entity or entities", "the member") is not a name: use the defined short name instead.
  const GENERIC = /\b(?:entity|entities|member|customer|client|company|party|parties|licensee|licensor|vendor|supplier)\b/i;
  const defd = x => x.match(/[“"]\s*([^”"]{2,30}?)\s*[”"]/)?.[1];
  if (A !== 'party withheld in filing' && GENERIC.test(A) && !/\b(?:Inc|LLC|Ltd|Limited|Corp|Corporation|plc)\b/.test(A) && defd(a)) A = defd(a);
  if (B !== 'party withheld in filing' && GENERIC.test(B) && !/\b(?:Inc|LLC|Ltd|Limited|Corp|Corporation|plc)\b/.test(B) && defd(b)) B = defd(b);
  // Blank signature lines ("_______________") and bare honorifics are not names.
  const blank = x => /_{3,}|^[\s_.\-–]*$/.test(x); if (blank(A)) A = ''; if (blank(B)) B = '';
  A = A.replace(/^(?:Mr|Mrs|Ms|Dr)\.?\s+(?=[A-Z])/, ''); B = B.replace(/^(?:Mr|Mrs|Ms|Dr)\.?\s+(?=[A-Z])/, '');
  if (!A && B.length > 1 && B !== 'party withheld in filing') return B;
  const ROLEW = /^(?:the\s+)?(?:Company|Executive|Employee|Employer|Consultant|Contractor|Client|Customer|Supplier|Vendor|Seller|Buyer|Purchaser|Licensor|Licensee|Agent|Principal|Distributor|Provider|Landlord|Tenant|Lender|Borrower|Member|Bank|Corporation)$/i;
  if (ROLEW.test(A) && (!B || ROLEW.test(B))) return ''; // roles, not names: the caller falls back to the defined roles plus the file name
  const okA = A.length > 1 && A !== 'party withheld in filing' && !/^(?:the\s+)?(?:parties|undersigned)/i.test(A);
  if (okA && (B.length <= 1 || /undersigned|^(?:the\s+)?below\b/i.test(B))) return A;
  return A.length > 1 && B.length > 1 && !/^(?:the\s+)?(?:parties|undersigned)/i.test(A + ' ' + B) && !/undersigned/i.test(B) && A !== 'party withheld in filing' ? `${A} / ${B}` : '';
}
// The one thing to check when a date is projected past a renewal: was notice sent in the previous cycle?
const fmtD2 = d => { const [y, m, dd] = d.split('-'); return `${+dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y}`; };
export const checkLine = it => `Check: did either side send notice by ${fmtD2(it.prevActBy)}? If not, it renewed on ${fmtD2(it.prevRenewedOn)}.`;
const redactedBeforeCheck = ct => new RegExp(`${REDACT_RE}\\s+(?:prior|before)`, 'i').test(ct);
export const plural = (n, u) => `${n} ${u}${+n === 1 ? '' : 's'}`;
export const DURATION_RE = new RegExp(`((?:${NUMWORD_RE})?\\s*(?:\\(\\s*\\d+\\s*\\))?|\\d+|${REDACT_RE})\\s*-?\\s*(?:consecutive\\s+)?(?:full\\s+)?(?:calendar\\s+|business\\s+)?(day|month|year|week)s?(?:['’]s?)?`, 'i');

export function wordsToNumber(s) {
  const toks = s.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(t => t && t !== 'and');
  if (!toks.length) return null;
  if (toks.length === 1 && toks[0] === 'a') return 1;
  let total = 0, cur = 0, seen = false;
  for (const t of toks) {
    if (t === 'hundred') { cur = (cur || 1) * 100; seen = true; continue; }
    if (!(t in NUM_WORDS)) return null;
    cur += NUM_WORDS[t]; seen = true;
  }
  return seen ? total + cur : null;
}

// Parse a duration phrase. Returns {n, unit, text, redacted, conflict} or null.
export function parseDuration(text) {
  const m = text.match(DURATION_RE);
  if (!m) return null;
  const raw = m[1].trim(); const unit = m[2].toLowerCase();
  if (new RegExp(REDACT_RE, 'i').test(raw)) return { n: null, unit, text: m[0].trim(), redacted: true, index: m.index };
  const paren = raw.match(/\((\s*\d+\s*)\)/);
  const words = raw.replace(/\(.*?\)/, '').trim();
  const pn = paren ? parseInt(paren[1], 10) : null;
  const wn = /^\d+$/.test(words) ? parseInt(words, 10) : (words ? wordsToNumber(words) : null);
  if (pn == null && wn == null) return null;
  const conflict = pn != null && wn != null && pn !== wn;
  return { n: pn ?? wn, unit, text: m[0].trim(), redacted: false, conflict, index: m.index, business: /business/i.test(m[0]) && unit === 'day' };
}

// ---------- dates (UTC, no time zones) ----------
export function ymd(d) { return d ? d.toISOString().slice(0, 10) : ''; }
export function mkDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) ? dt : null;
}
export function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
export function addMonths(d, n) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last)));
}
// Anniversary of d after dur. A 29 Feb anchor rolls to 1 Mar in non-leap years, so "day before the anniversary" is 28 Feb.
export function anniv(d, dur) {
  const r = addDuration(d, dur);
  return (dur.unit === 'month' || dur.unit === 'year') && d.getUTCMonth() === 1 && d.getUTCDate() === 29 && r.getUTCMonth() === 1 && r.getUTCDate() === 28 ? addDays(r, 1) : r;
}
export function addDuration(d, dur, sign = 1) {
  if (dur.unit === 'day') return addDays(d, sign * dur.n);
  if (dur.unit === 'week') return addDays(d, sign * 7 * dur.n);
  if (dur.unit === 'month') return addMonths(d, sign * dur.n);
  return addMonths(d, sign * 12 * dur.n);
}
const DATE_RES = [
  // April 27, 2026 / Aug. 10, 2026 / November 19 th , 2021
  new RegExp(`${MONTH_RE}\\s+(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4})`, 'i'),
  // 21 st day of April, 2014
  new RegExp(`(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s+day\\s+of\\s+${MONTH_RE},?\\s*(\\d{4})`, 'i'),
  // 2026-04-27 / 2024.08.07 / 2024/08/07
  /\b(\d{4})([-./])(\d{1,2})\2(\d{1,2})\b/,
  // 10 November 2025
  new RegExp(`\\b(\\d{1,2})\\s+${MONTH_RE},?\\s+(\\d{4})`, 'i'),
  // 3-3-2026, 03/15/2026, 15/03/2026: only when the day/month order is unambiguous
  /(?<![\d./-])(\d{1,2})([-/])(\d{1,2})\2(\d{4})\b/,
];
// Any one written date: 'January 18, 2022', '18 January 2022', '18th day of January, 2022', '2022-01-18', '2022.01.18'.
const DATE_ANY = `(?:${MONTH_RE}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s*(?:\\d\\s+)?\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:day\\s+of\\s+)?${MONTH_RE},?\\s+\\d{4}|\\d{4}[-./]\\d{1,2}[-./]\\d{1,2}|\\d{1,2}[-/]\\d{1,2}[-/]\\d{4})`.replace(/\((January)/g, '(?:$1');
export function parseDate(text) {
  let best = null;
  // tolerate a stray digit before the year ("December 31, 2 2028" in a SunCoke filing)
  text = String(text).replace(/(\b\d{1,2}\s*,\s*)\d\s+(\d{4}\b)/, (m, a, y) => a + y + ' '.repeat(m.length - a.length - y.length));
  DATE_RES.forEach((re, k) => {
    const m = text.match(re); if (!m) return;
    let y, mo, d;
    if (k === 0) { mo = MONTHS[m[1].toLowerCase().replace('.', '').slice(0, m[1].toLowerCase().startsWith('sept') ? 4 : 3)]; d = +m[2]; y = +m[3]; }
    else if (k === 1 || k === 3) { d = +m[1]; mo = MONTHS[m[2].toLowerCase().replace('.', '').slice(0, m[2].toLowerCase().startsWith('sept') ? 4 : 3)]; y = +m[3]; }
    else if (k === 4) { const a = +m[1], b = +m[3]; y = +m[4]; if (a === b) { mo = a; d = b; } else if (a > 12 && b <= 12) { d = a; mo = b; } else if (b > 12 && a <= 12) { mo = a; d = b; } else return; }
    else { y = +m[1]; mo = +m[3]; d = +m[4]; }
    const dt = mo ? mkDate(y, mo, d) : null;
    if (dt && (!best || m.index < best.index)) best = { date: dt, index: m.index, text: m[0] };
  });
  return best;
}

// ---------- document model ----------
// doc = { lines: [{text, page?}] } -> sentences with source locations
const ABBR = /\b(?:[ap]\.m|Inc|Corp|Co|Ltd|LLC|No|Nos|Sec|St|Mr|Ms|Dr|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec|U\.S|e\.g|i\.e|etc|vs)\.$/i;
// EDGAR HTML often leaves spaces inside curly quotes: (“ Agreement ”) -> (“Agreement”).
export const norm = t => String(t ?? '').replace(/\s+/g, ' ').replace(/“\s+/g, '“').replace(/\s+”/g, '”').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s+([,;])(?=\s|$)/g, '$1').trim();
export function toSentences(lines) {
  let buf = '', map = []; const breaks = new Set();
  lines.forEach((ln, i) => {
    const t = norm(typeof ln === 'string' ? ln : ln.text);
    if (!t || /^[-–—\s]*\d{1,3}[-–—\s]*$|^page\s+\d+(\s+of\s+\d+)?$/i.test(t)) return;
    const start = buf.length; buf += (buf ? ' ' : '') + t;
    map.push({ start: start + (start ? 1 : 0), end: buf.length, line: i + 1, page: ln.page, pl: ln.pline, para: !!ln.para });
    const nx = lines[i + 1]; const nt = nx == null ? '' : (typeof nx === 'string' ? nx : nx.text).trim();
    const pv = i > 0 ? norm(typeof lines[i - 1] === 'string' ? lines[i - 1] : lines[i - 1]?.text) : ''; const standalone = !pv || /[.;:!?][”"’')\]]*$/.test(pv) || /^[^a-z]+$/.test(pv) || pv.length < 45;
    if (standalone && t.length < 45 && !/[,;(“"]$|\b(?:of|the|and|or|to|for|a|an|in|by|shall|will|may|must|is|are|be|has|have|with|from|that|this)$/i.test(t) && /^[A-Z0-9“"(]/.test(nt) && !/[.:;]$/.test(t)) breaks.add(buf.length);
  });
  const sents = []; let s = 0;
  const re = /[.;:](?=\s+(?:[A-Z(“"\[]|\d+\.))/g; let m;
  const push = (a, b) => {
    const text = buf.slice(a, b).trim(); if (text.length < 3) return;
    const ls = map.filter(x => x.end > a && x.start < b);
    sents.push({ text, lineStart: ls[0]?.line, lineEnd: ls[ls.length - 1]?.line, page: ls[0]?.page ?? null, pageEnd: ls[ls.length - 1]?.page ?? null, pl: ls[0]?.pl, plEnd: ls[ls.length - 1]?.pl, para: !!ls[0]?.para });
  };
  const cuts = [];
  while ((m = re.exec(buf))) {
    if (m[0] !== '.' ) { if (m[0] === ';' || m[0] === ':') continue; }
    const before = buf.slice(Math.max(0, m.index - 12), m.index + 1);
    if (ABBR.test(before) || /\b[A-Z]\.$/.test(before)) continue;
    cuts.push(m.index + 1);
  }
  for (const b of breaks) cuts.push(b);
  [...new Set(cuts)].sort((a, b) => a - b).forEach(c => { push(s, c); s = c; });
  push(s, buf.length);
  return sents;
}
export function locLabel(s) {
  if (s.para) return s.lineStart === s.lineEnd ? `¶ ${s.lineStart}` : `¶ ${s.lineStart}–${s.lineEnd}`;
  const a = s.page && s.pl ? s.pl : s.lineStart, b = s.page && s.plEnd ? s.plEnd : s.lineEnd;
  const L = a === b ? `line ${a}` : `lines ${a}–${b}`;
  return s.page ? `p. ${s.page}${s.pageEnd && s.pageEnd !== s.page ? '–' + s.pageEnd : ''}, ${L}` : L;
}
// Stop a quote at a numbered sub-clause boundary ("... Term). 2In the event ...", "... 2 In the event ...").
export const trimQuote = t => { const re = /\s\d{1,2}\s*(?=In\s+the\s+event\b)|\s\d{1,2}(?=[A-Z][a-z]{2,}\s)/g; let m; while ((m = re.exec(t))) if (m.index > 40) return t.slice(0, m.index).trim(); return t; };
const src = (s) => s ? { quote: trimQuote(s.text), lineStart: s.lineStart, lineEnd: s.lineEnd, page: s.page, location: locLabel(s) } : null;

// ---------- extraction ----------
// Lengths in these clauses are not the agreement's term (non-solicit, non-compete, confidentiality, survival, "N years thereafter").
const NOT_TERM = /\bnon-?\s?solicit|\bsolicit(?:ation)?\s+(?:the\s+)?(?:employ|any)|non-?\s?compet|covenant\s+not\s+to\s+compete|confidential(?:ity)?\s+(?:obligations|information)|\band\s+for\s+(?:a\s+period\s+of\s+)?[^.]{0,30}?(?:year|month|day)s?\)?\s+(?:thereafter|after(?:wards)?|following)\b|during\s+the\s+Term[^.]{0,60}\band\s+for\s+(?:a\s+period\s+of\s+)?\S/i;
// Label/value tables (cover pages): "License Start Date  Earliest Expiration Date ... February 01, 2025  July 31, 2025".
// Values are read in the same order as the labels; only dates count as values.
function tableDates(lines, A, B) {
  const all = lines.map(l => norm(typeof l === 'string' ? l : l.text)).join(' ');
  const low = all.toLowerCase(), a = A.toLowerCase(), b = B.toLowerCase();
  for (let i = low.indexOf(a); i >= 0; i = low.indexOf(a, i + 1)) {
    const j = low.indexOf(b, i + a.length); if (j < 0 || j - i > 300) continue;
    const win = all.slice(j + b.length, j + b.length + 400); if (/\b(?:commence|begin|end|expire)s?\s+on\s+the\b/i.test(all.slice(i, j + b.length + 40))) continue;
    const ds = [...win.matchAll(new RegExp(DATE_ANY, 'gi'))].map(m => parseDate(m[0])).filter(Boolean);
    if (ds.length >= 2 && ds[1].date > ds[0].date) return { start: ymd(ds[0].date), end: ymd(ds[1].date) };
  }
  return null;
}
const TEMPLATE_NOTE = ' The dates are in square brackets, which marks a template: confirm they are the agreed dates.';
export function extract(lines) {
  const S = toSentences(lines);
  const res = { effective: null, term: null, renewal: null, notice: null, payments: [], other: [], reviewNotes: [] };

  for (const s of S) s.text = s.text.replace(/\b([Tt])e1m/g, '$1erm');
  // Common typos in filed text ("comence", "commencment", "recieve").
  for (const s of S) s.text = s.text.replace(/\b([Cc])om+enc(e|es|ed|ing)\b/g, '$1ommenc$2').replace(/\b([Cc])ommencment\b/g, '$1ommencement').replace(/\b([Rr])eciev(e|ed|es)\b/g, '$1eceiv$2');
  // Recitals / background: from a RECITALS, BACKGROUND or WHEREAS opening to "NOW, THEREFORE" / "agree as follows". They describe other or prior agreements, not this one's term.
  { const r0 = S.slice(0, 80).findIndex(x => /^\W*(?:RECITALS?|BACKGROUND|PRELIMINARY\s+STATEMENTS?|WHEREAS)\b/.test(x.text));
    if (r0 >= 0) { let r1 = S.findIndex((x, i) => i > r0 && /\bNOW,?\s+THEREFORE\b|\bagree[sd]?\s+as\s+follows\b|^\W*(?:AGREEMENT|TERMS)\W*$/i.test(x.text)); if (r1 < 0 || r1 - r0 > 40) r1 = -1; if (r1 > 0) for (let i = r0; i < r1; i++) S[i].recital = true; }
    for (const x of S) if (/^\W*WHEREAS\b/.test(x.text)) x.recital = true; }
  // Template brackets around a date or number ("[2024.08.07]", "[one (1)] year", "[3]"): read the value, remember it was bracketed.
  for (const s of S) { const t0 = s.text; s.text = s.text.replace(new RegExp(`\\[\\s*(${DATE_ANY}|(?:${NUMWORD_RE})?\\s*(?:\\(\\s*\\d+\\s*\\))?|\\d+)\\s*\\]`, 'gi'), (m, v) => v.trim() ? v.trim() : m); if (s.text !== t0) s.template = true; }
  // 1. Effective date
  // A date immediately followed by its definition, anywhere in the first ~2,000 characters: "as of 27 January 2025 (the “Effective Date”)".
  { let seen = 0;
    for (const s of S) { if (seen > 6000 || res.effective) break; seen += s.text.length;
      const dm = s.text.match(/\(\s*(?:the\s+|this\s+)?[“"]\s*(Effective|Agreement|Commencement|Transition|Start)\s+Date\s*[”"]\s*\)/i); if (!dm) continue;
      const before = s.text.slice(Math.max(0, dm.index - 60), dm.index);
      let last = null; for (let i = 0; i < before.length; i++) { const d = parseDate(before.slice(i)); if (d && /^\W{0,6}$/.test(before.slice(i + d.index + d.text.length))) { last = d; break; } }
      if (!last) continue;
      const label = dm[1][0].toUpperCase() + dm[1].slice(1).toLowerCase() + ' Date';
      const adj = /may\s+be\s+(?:adjusted|changed|modified)|or\s+such\s+(?:other|later|earlier)\s+date/i.test(s.text.slice(dm.index, dm.index + 160));
      res.effective = { date: ymd(last.date), confidence: adj ? 'medium' : 'high', needsReview: adj, label, why: `Date is expressly defined as the "${label}".` + (adj ? ' The clause lets this date be moved by agreement; confirm the actual start.' : ''), source: src(s) };
    } }
  // A definitions-list entry: "“Effective Date” shall mean Monday, May 4, 2026." (anywhere, e.g. an Exhibit A of definitions).
  if (!res.effective) for (const s of S) { const dm = s.text.match(/[“"]\s*(Effective|Commencement|Start)\s+Date\s*[”"]\s+(?:shall\s+mean|means|is|shall\s+be)\s+(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?/i); if (!dm) continue;
    const d = parseDate(s.text.slice(dm.index + dm[0].length, dm.index + dm[0].length + 40)); if (!d || d.index > 0) continue;
    const label = dm[1][0].toUpperCase() + dm[1].slice(1).toLowerCase() + ' Date';
    res.effective = { date: ymd(d.date), confidence: 'high', needsReview: false, label, why: `Date is expressly defined in a definitions list: "${label}" means ${d.text}.`, source: src(s) }; break; }
  const effRe = /(?:made\s+(?:and\s+is\s+)?effective\s+as\s+of|entered\s+into\s+(?:effective\s+)?as\s+of|is\s+effective\s+as\s+of|is\s+made\s+on|dated\s+as\s+of|dated\s+and\s+effective\s+as\s+of|effective\s+as\s+of|dated|made\s+and\s+entered\s+into\s+as\s+of|made\s+as\s+of)\s+(?:this\s+|the\s+)?/i;
  // An Effective / Commencement / Start Date set by an event ("upon completion of Closing under the SPA (the “Effective Date”)") has no date in the document:
  // record it and never fall back to some other "dated" date for it.
  if (!res.effective) for (const s of S) {
    const dm = s.text.match(/\(\s*(?:the\s+|this\s+)?[“"]\s*(Effective|Commencement|Start)\s+Date\s*[”"]\s*\)/i); if (!dm) continue;
    const before = s.text.slice(Math.max(0, dm.index - 300), dm.index);
    if (parseDate(before.slice(-80))) continue;
    const ev = before.match(/\b(?:upon|on|following|after|as\s+of)\s+(?:the\s+)?(?:(?:date\s+of\s+|date\s+on\s+which\s+|time\s+of\s+)?(?:the\s+)?(?:completion|closing|consummation|signing|execution|listing|occurrence|satisfaction|effectiveness|approval|receipt|funding|commencement\s+of\s+trading|initial\s+public\s+offering)|date\s+(?:on\s+which|that|when)|later\s+of|earlier\s+of)[^.;]{0,280}$/i);
    if (ev) { res.effectiveEvent = { label: dm[1][0].toUpperCase() + dm[1].slice(1).toLowerCase() + ' Date', event: ev[0].replace(/\s+/g, ' ').trim().slice(0, 140), source: src(s) }; break; }
  }
  for (const pass of (res.effective || res.effectiveEvent ? [] : [true, false])) { if (res.effective) break;
  outer: for (const s of S.slice(0, pass ? 250 : 80)) {
    if (/^\W{0,3}Master\s+Agreement\s*:/i.test(s.text)) continue; // the parent agreement's date, not this document's
    for (const m of s.text.matchAll(new RegExp(effRe.source, 'gi'))) {
    const after = s.text.slice(m.index + m[0].length, m.index + m[0].length + 60);
    const d = parseDate(after); if (!d || d.index > 4) continue;
    const tail = s.text.slice(m.index + m[0].length + d.index + d.text.length, m.index + m[0].length + d.index + d.text.length + 40);
    const dm = tail.match(/^\W{0,6}(?:the\s+)?[“"]?\s*(Effective|Amendment|Restatement|Commencement)\s+Date/i);
    const defined = !!dm;
    if (/amend and restate|superseded/i.test(s.text) && !defined) continue;
    if (pass && !defined) continue;
    const label = dm ? dm[1][0].toUpperCase() + dm[1].slice(1).toLowerCase() + ' Date' : '';
    res.effective = { date: ymd(d.date), confidence: defined ? 'high' : 'medium', needsReview: !defined,
      why: defined ? `Date is expressly defined as the "${label}"${label !== 'Effective Date' ? ', from which this document takes effect' : ''}.` : 'Only a "dated / as of" date was found; no Effective Date is expressly defined here, and the date may belong to a related agreement. Confirm commencement.',
      source: src(s) };
    break outer;
  } } }

  // 2. Term / expiry
  // A term or renewal clause about another named agreement ("the initial term of the Property Management Agreement") is not this document's,
  // unless this document is an amendment of that agreement.
  const isAmendment = /\bamendment\b/i.test(S.slice(0, 8).map(s => s.text).join(' ').slice(0, 1500));
  const OTHER_AGR = /\b(?:initial\s+)?term\s+of\s+(?:the|that|such|each)\s+(?:[A-Z][\w&’'-]*\s+){1,5}(?:Agreement|Lease|Contract|License)\b/;
  const otherAgr = t => !isAmendment && OTHER_AGR.test(t) && !/\bthis\s+(?:Agreement|Amendment)\b/i.test(t.match(OTHER_AGR)[0]);
  const termCands = S.filter(s => !s.recital && /\b(initial\s+(term|license\s+period|period)|the\s+term\s+of\s+this|remain\s+in\s+effect|agreement\s+shall\s+have\s+an?\s+[\w()-]+\s+term|have\s+a\s+term|shall\s+commence|will\s+commence|shall\s+begin\s+on|(?:this\s+agreement|the\s+term(?:\s+of\s+this\s+agreement)?)\s+(?:shall|will)\s+(?:continue|extend|remain)|is\s+(?:hereby\s+)?extended\s+(?:through|until|to)|subscription\s+term\s+shall\s+be\s+(?=[^.\[]{0,20}\d)|(?:commence|begin)s?\s+on\s+\d{1,2}:\d{2}|ending\s+on\s+the\s+\w+\s+(?:\(\d+\w*\)\s+)?anniversary\s+of\s+the\s+Effective\s+Date|shall\s+continue\s+until\s+the\s+\w+\s+(?:\(\d+\w*\)\s+)?anniversary|remains?\s+in\s+full\s+force\s+and\s+effect[^.]{0,60}for\s+a\s+period\s+of|^\W{0,6}term\s*:|\bterm\s+of\s+(?:this\s+)?(?:license|agreement)\s*:|\bfor\s+a\s+period\s+beginning\s+on\b|\bterm\s+of\s+(?:the\s+)?(?:Employment|Engagement|Services|Consulting|Executive[’']s\s+employment)\s+(?:shall|will|is)\b|\b(?:commenc(?:es?|ing)|begin(?:s|ning)?)\s+on\s+the\s+[A-Z][\w ]{2,40}?Date\s+and\s+end|(?:this\s+agreement|the\s+term)\s+(?:shall|will)\s+(?:terminate|expire)\s+on\s+(?=[A-Z][a-z]+\s+\d|\d)|\bterm\s+of\s+the\s+Agreement\s+shall\s+be\s+(?=[^.]{0,20}\d)|\bfor\s+a\s+term\b[^.]{0,160}\bterminating\s+on\s+(?=[A-Z][a-z]+\s+\d))/i.test(s.text) && !/automatically\s+(renew|extend)/i.test(s.text.slice(0, 40)) && !/^\W{0,3}[“"][^”"]{1,60}[”"]\s+(?:means|has\s+the\s+meaning|shall\s+mean)/i.test(s.text) && !/following\s+(?:the\s+)?(?:termination|expiration)|surviv/i.test(s.text) && !NOT_TERM.test(s.text) && !otherAgr(s.text) && !/^\W*WHEREAS\b/.test(s.text) && (s.text.match(/[a-z]/g) || []).length > (s.text.match(/[A-Z]/g) || []).length);
  // A clearly-worded initial-term sentence beats an earlier passing mention of "the term" (e.g. a redacted forecast clause).
  const decFirst = termCands.find(s => /\buntil\s+December\s+31(?:st)?\s+of\s+the\s+(?!\d)/i.test(s.text) && /Initial\s+Term/.test(s.text));
  for (const s of decFirst ? [decFirst, ...termCands.filter(x => x !== decFirst)] : termCands) {
    const t = s.text;
    const range = t.match(new RegExp(`(?:(\\bfrom\\s+)|^|[^\\w])(${DATE_ANY})(?:\\s*\\([^()]{0,40}\\))?\\s*(?:[–—-]+|\\b(to|through)\\b)\\s*(${DATE_ANY})`, 'i'));
    if (range && (range[1] || !range[3]) && /period|term/i.test(t) && parseDate(range[2]) && parseDate(range[4]) && parseDate(range[4]).date > parseDate(range[2]).date) {
      const a = parseDate(range[2]), b = parseDate(range[4]);
      res.term = { start: ymd(a.date), end: ymd(b.date), confidence: s.template ? 'medium' : 'high', needsReview: !!s.template, why: 'Explicit start and end dates.' + (s.template ? TEMPLATE_NOTE : ''), source: src(s), rule: 'explicit' };
      break;
    }
    const dec = t.match(/\buntil\s+December\s+31(?:st)?\s+of\s+the\s+(?!\d)[^.]{0,80}?(Commencement\s+Date|Year\s+of\s+the\s+Agreement|Effective\s+Date)/i);
    if (dec && !/December\s+31,?\s*\d{4}/i.test(t)) {
      const anchor = /Commencement/i.test(dec[1]) ? 'the "Commencement Date", which this document leaves to a later event and never dates' : res.effective ? `the Agreement's years, counted from ${res.effective.date}; confirm how "Year" is defined` : 'the Agreement\'s start, which this document does not date (it takes effect on the last signature)';
      res.term = { start: res.effective?.date || '', end: '', confidence: 'low', needsReview: true, why: `Term runs "${dec[0].trim()}": 31 December of a year counted from ${anchor}. Expiry not computed. Not a redaction.`, source: src(s), rule: 'event' };
      break;
    }
    const nextMo = t.match(/\bthrough\s+the\s+last\s+day\s+of\s+the\s+next\s+month\s+following\s+the\s+Effective\s+Date/i);
    if (nextMo && res.effective) {
      const e = new Date(res.effective.date + 'T00:00:00Z'); const end = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 2, 0));
      res.term = { start: res.effective.date, end: ymd(end), confidence: 'high', needsReview: false, why: `"${nextMo[0]}": the last day of the month after the Effective Date.`, source: src(s), rule: 'explicit' };
      break;
    }
    const ann0 = t.match(/\b(through|until|end(?:ing)?\s+on|terminate\s+on|expire\s+on)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|one-year|two-year|three-year|four-year|five-year)\s+(?:\(\d+(?:st|nd|rd|th)?\)\s+)?anniversary\s+(?:of\s+the\s+(?:Effective|Agreement|Commencement|Start)\s+Date|thereof)/i);
    const ann = ann0 && [ann0[0], ann0[1], ann0[2].replace(/^one-year$/i, 'first').replace(/^two-year$/i, 'second').replace(/^three-year$/i, 'third').replace(/^four-year$/i, 'fourth').replace(/^five-year$/i, 'fifth')];
    if (ann && res.effective) {
      const n = ['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth'].indexOf(ann[2].toLowerCase()) + 1;
      const untilAnn = /^until$/i.test(ann[1]) && /Renewal\s+Date/.test(t);
      res.term = { start: res.effective.date, end: ymd(addDays(addMonths(new Date(res.effective.date + 'T00:00:00Z'), 12 * n), untilAnn ? -1 : 0)), duration: { n, unit: 'year', text: ann[0] }, confidence: res.effective.needsReview ? 'medium' : 'high', needsReview: !!res.effective.needsReview, why: untilAnn ? `"${ann[0]}": the term runs until the anniversary, so its last day is the day before.` : `"${ann[0]}": the term runs through the anniversary date itself.`, source: src(s), rule: 'anniversary' };
      break;
    }
    const thr = t.match(new RegExp(`\\b(?:through(?:\\s+and\\s+including)?|until|extend\\s+to|ending(?:\\s+on)?|expires?\\s+on|ends?\\s+on|(?:shall|will)\\s+(?:terminate|expire)\\s+on|end(?:s|ing)?\\s+on\\s+the\\s+earlier\\s+of:?\\s*\\(?(?:a|i|1)\\)|terminating\\s+on|(?:shall|will)\\s+expire\\s+(?:on\\s+)?(?:at\\s+)?the\\s+close\\s+of\\s+business\\s+on|shall\\s+end(?:\\s+on)?)\\s+(?:\\d{1,2}:\\d{2}\\s*[ap]\\.?m\\.?,?\\s+(?:[A-Z][a-z]+\\s+)?Time,?\\s+on\\s+)?(${DATE_ANY})`, 'i'));
    if (thr && parseDate(thr[1])) {
      const b = parseDate(thr[1]); const st = t.match(new RegExp(`\\b(?:begin|commence)s?\\s+on\\s+(${DATE_ANY})`, 'i'));
      res.term = { start: st && parseDate(st[1]) ? ymd(parseDate(st[1]).date) : (res.effective?.date || ''), end: ymd(b.date), confidence: s.template ? 'medium' : 'high', needsReview: !!s.template, why: (st ? 'Explicit start and end dates' : 'Explicit end date') + (st && /\bfor\s+(?:a\s+period\s+of\s+)?\S/i.test(t) ? '; the stated end date is used over the length' : '') + '.' + (s.template ? TEMPLATE_NOTE : ''), source: src(s), rule: 'explicit' };
      if (isAmendment && !s.template && res.effective?.needsReview && !/\bis\s+(?:hereby\s+)?extended\b/i.test(t)) { res.term.confidence = 'medium'; res.term.needsReview = true; res.term.why += ' Read from the term clause this amendment restates, and this document does not define the Effective Date it runs from; confirm it is the current end date.'; }
      break;
    }
    const ss = t.match(new RegExp(`\\b(?:commence|begin)s?\\s+(?:on\\s+)?(?:\\d{1,2}:\\d{2}\\s*[ap]\\.?m\\.?\\s*(?:\\(\\w+\\)\\s*)?on\\s+)?(${DATE_ANY})[^.]{0,160}?(?:continue|remain)[^.]{0,30}?for\\s+(.{0,40})`, 'i'));
    if (ss) { const sd = parseDate(ss[1]), du = parseDuration(ss[2].replace(/^(?:a|the)\s+period\s+of\s+/i, '')); if (sd && du && du.n && du.index <= 3 && !du.redacted) { const st = sd.date; res.term = { start: ymd(st), end: ymd(addDays(anniv(st, du), -1)), duration: { n: du.n, unit: du.unit, text: du.text }, confidence: 'high', needsReview: false, why: `Starts on the stated date (${ymd(st)}) and runs ${plural(du.n, du.unit)}: last day = anniversary minus one day.`, source: src(s), rule: 'for' }; break; } }
    if (/\bcontinue\s+for\s+the\s+Initial\s+Term\b/.test(t) && res.effective && /(?:effective|commencement|start)\s+date/i.test(t)) {
      const all = lines.map(l => norm(typeof l === 'string' ? l : l.text)).join(' '); const dm2 = all.match(new RegExp(`[“"]\\s*Initial\\s+Term\\s*[”"]\\s+(${DURATION_RE.source})(?=\\s+[“"])`, 'i'));
      const du = dm2 && parseDuration(dm2[1]);
      if (du && du.n && !du.redacted) { const st = new Date(res.effective.date + 'T00:00:00Z'); res.term = { start: res.effective.date, end: ymd(addDays(anniv(st, du), -1)), duration: { n: du.n, unit: du.unit, text: du.text }, confidence: 'medium', needsReview: true, why: `Runs for "the Initial Term", which the terms table defines as "${dm2[1]}", from the Effective Date (${res.effective.date}): last day = anniversary minus one day. Check the table.`, source: src(s), rule: 'for' }; break; }
    }
    const lab = t.match(/\b(?:commence|begin)s?\s+on\s+the\s+([A-Z][\w ]{2,40}?Date)\s+and\s+(?:end|expire|terminate)s?\s+on\s+the\s+([A-Z][\w ]{2,40}?Date)/);
    if (lab && !/^(?:Effective|Agreement)\s+Date$/i.test(lab[1])) { const tv = tableDates(lines, lab[1], lab[2]); if (tv) { res.term = { start: tv.start, end: tv.end, confidence: 'medium', needsReview: true, why: `The term runs from the "${lab[1]}" to the "${lab[2]}". Both dates come from the table at the top of the agreement (labels and values in the same order): ${tv.start} to ${tv.end}. Check them against the table.`, source: src(s), rule: 'explicit', table: true }; break; } }
    const m = t.match(/\buntil\s+the\s+date\s+that\s+is\s+(.{0,60})/i) || t.match(/\bsubscription\s+term\s+shall\s+be\s+(?=[^.\[]{0,20}\d)(.{0,60})/i) || (/remains?\s+in\s+full\s+force/i.test(t) && t.match(/\bfor\s+a\s+period\s+of\s+(.{0,60})/i)) || t.match(/\bterm\s+of\s+this\s+(?:agreement|contract)\s+(?:shall\s+be|is)\s+(.{0,60})/i) || (isAmendment && t.match(/\bterm\s+of\s+the\s+Agreement\s+(?:shall\s+be|is)\s+(.{0,60})/i)) || t.match(/\binitial\s+term(?:\s+of\s+[\w’']+){0,2}\s+(?:shall\s+be|is)\s+(.{0,60})/i) || t.match(/\bcontinue\s+for\s+(?:a|the)\s+period\s+of\s+(.{0,60})/i) || t.match(/\bagreement\s+shall\s+have\s+an?\s+((?:[\w]+[\s-])?(?:\(\d+\)[\s-])?(?:year|month)s?[\s-]term.{0,40})/i) || t.match(/\b(?:for|run\s+for|continues?\s+for|period\s+of|shall\s+expire|shall\s+terminate|remain\s+in\s+effect\s+(?:for|until))\s+(?:(?:a|the)\s+period\s+of\s+|an?\s+initial\s+(?:term|period)\s+of\s+|an?\s+initial\s+|an?\s+)?(.{0,60})/i);
    if (!m) continue;
    const dur = parseDuration(m[1].replace(/^(?:for\s+)?(?:a\s+period\s+of\s+)?/i, ''));
    if (!dur || dur.index > 3) {
      if (new RegExp(REDACT_RE).test(m[1].slice(0, 12))) {
        res.term = { start: res.effective?.date || '', end: '', confidence: 'none', needsReview: true, why: 'Term length is blacked out in the public copy ([***]). Expiry cannot be computed.', source: src(s) };
        break;
      }
      continue;
    }
    if (dur.redacted) { res.term = { start: res.effective?.date || '', end: '', confidence: 'none', needsReview: true, why: 'Term length is blacked out in the public copy.', source: src(s) }; break; }
    // A term that runs from a separately labelled date ("the Second Amendment Effective Date") uses the date given where that label is defined.
    const labM = t.match(/\b(?:from|after|following|commencing\s+on|beginning\s+on)\s+the\s+((?:[A-Z][\w-]*\s+){0,4}(?:Effective|Commencement|Start)\s+Date)\b/);
    let labD = null;
    if (labM && !/^Effective\s+Date$/.test(labM[1])) { const q = labM[1].trim().replace(/\s+/g, '\\s+'); const dS = S.find(x => new RegExp(`[“"]\\s*${q}\\s*[”"]`).test(x.text)); if (dS) { const pre = dS.text.slice(0, dS.text.search(new RegExp(`[“"]\\s*${q}`))).slice(-160); const pd = parseDate(pre); if (pd) labD = { date: pd.date, label: labM[1].trim() }; } }
    let evt = /(?:years?|months?)\)?\s+(?:from|after|following)\s+(?!(?:the\s+)?(?:Effective|Agreement|Commencement|Transition|Start)\s+Date|date\s+hereof|date\s+first)(?:the\s+)?(?:date\s+(?:of\s+|on\s+which\s+|that\s+)?)?(?:the\s+)?[A-Z“"]/.test(t);
    const hereof = /\b(?:commenc\w*|begin\w*|from|effective)\s+(?:on\s+|as\s+of\s+)?the\s+date\s+(?:hereof|first\s+(?:indicated|written|set\s+forth|stated)(?:\s+above)?|above\s+written)/i.test(t) && !/(?:effective|agreement|commencement|transition|start)\s+date/i.test(t);
    if (labD) evt = false;
    const fromEff = (/(?:effective|agreement|commencement|transition|start)\s+date/i.test(t) || hereof) && !evt;
    const until = /\buntil\b[^.]{0,40}following|\buntil\s+the\s+date\s+that\s+is\s+[^.]{0,40}\b(?:from|after)\s+the\s+effective\s+date/i.test(t);
    const start = labD ? labD.date : res.effective ? new Date(res.effective.date + 'T00:00:00Z') : null;
    let end = '', why, conf = 'high', review = false;
    const anchorless = !fromEff && !evt && start && /[“"]Initial\s+Term[”"]/.test(t) && !/\b(?:from|after|following|upon|commenc|begin)/i.test(t.split(/[“"]Initial\s+Term/i)[0]);
    if (anchorless) { conf = 'medium'; review = true; end = ymd(addDays(anniv(start, dur), -1)); why = `"${dur.text}" with no start stated; read as running from the Effective Date (${res.effective.date}). Check.`; }
    else if (!fromEff) { if (!res._fallback) res._fallback = { start: res.effective?.date || '', end: '', duration: { n: dur.n, unit: dur.unit, text: dur.text }, confidence: 'low', needsReview: true, why: `Term length "${dur.text}" found, but ${evt ? 'it runs from an event (e.g. launch or regulatory approval) rather than' : 'its start point is not tied to'} the Effective Date. Expiry not computed.`, source: src(s) }; continue; }
    else if (!start && res.effectiveEvent) { conf = 'low'; review = true; why = `Term runs from the ${res.effectiveEvent.label}, which starts on an event ("${res.effectiveEvent.event}"); that date isn't in the document. Start date not in the document, so no date is computed.`; }
    else if (!start) { conf = 'low'; review = true; why = /signed\s+by\s+the\s+last|last\s+(?:party\s+)?to\s+sign|date\s+of\s+(?:the\s+)?(?:last\s+)?signature/i.test(t) ? `Term is ${plural(dur.n, dur.unit)} from signing; the signing date isn't in the document.` : 'Term runs from the Effective Date, which was not found.'; }
    else if (until) { end = ymd(anniv(start, dur)); why = `"Until ${dur.text} ${/following/i.test(t) ? 'following' : 'from'} the Effective Date": expiry = the anniversary date.`; }
    else { end = ymd(addDays(anniv(start, dur), -1)); why = `${dur.n} ${dur.unit}(s) commencing on the Effective Date: last day of term = anniversary minus one day.`; }
    if (start && start.getUTCMonth() === 1 && start.getUTCDate() === 29 && end) { review = true; if (conf === 'high') conf = 'medium'; why += ' The term starts on 29 February; anniversaries in non-leap years are read as 1 March (so the term ends 28 February). Confirm.'; }
    if (dur.conflict) { conf = 'low'; review = true; why = `Words and numerals disagree in "${dur.text}".`; }
    if (hereof && end && conf === 'high') { conf = 'medium'; review = true; why += ` Runs from "${(t.match(/the\s+date\s+(?:hereof|first\s+\w+(?:\s+\w+)?\s+above|above\s+written)/i) || ['the date hereof'])[0]}", read as the date of the agreement (${res.effective.date}). Check.`; }
    const cdl = end && t.match(/\(\s*[“"]([^”"]{0,40}Commencement\s+Date)[”"]\s*\)/);
    if (cdl && conf === 'high') { conf = 'medium'; review = true; why += ` The same sentence also names the start the "${cdl[1]}"; confirm it is the Effective Date.`; }
    if (labD && end) { if (conf === 'high') conf = 'medium'; review = true; why = why.replace(/the Effective Date/g, `the ${labD.label}`) + ` Runs from the ${labD.label} (${ymd(labD.date)}), the date given where that term is defined${isAmendment ? ', i.e. the amendment\'s own date' : ''}. Check.`; }
    else if (res.effective?.needsReview && conf === 'high') { conf = 'medium'; review = true; why += ' Depends on an Effective Date that needs review.'; }

    const nxt = S[S.indexOf(s) + 1]?.text || '';
    if (/notwithstanding[^.]{0,500}automatically\s+extend/i.test(nxt) && end) { review = true; if (conf === 'high') conf = 'medium'; why += ' The next sentence can extend the term automatically on a condition; confirm whether it applies.'; }
    res.term = { start: labD ? ymd(labD.date) : res.effective?.date || '', end, duration: { n: dur.n, unit: dur.unit, text: dur.text }, confidence: conf, needsReview: review, why, source: src(s), rule: labD ? 'labelled' : until ? 'until' : 'for' };
    break;
  }

  if (!res.term && res._fallback) res.term = res._fallback; delete res._fallback;
  // No fixed initial term, but renewal on "the first anniversary of the Effective Date and each annual anniversary thereafter" (a Renewal Date):
  // the first term ends the day before that anniversary.
  if ((!res.term || !res.term.end) && res.effective) for (const s of S) {
    const fa = s.text.match(/\bon\s+(?:such\s+|the\s+)?(first|second|third|fourth|fifth)\s+(?:\(\d+\w*\)\s+)?anniversary\s+of\s+the\s+Effective\s+Date\s+and\s+each\s+(?:annual\s+|subsequent\s+)?anniversary/i);
    if (!fa || !/continue\s+until\s+terminated|until\s+terminated/i.test(s.text)) continue;
    const n = ['first','second','third','fourth','fifth'].indexOf(fa[1].toLowerCase()) + 1;
    res.term = { start: res.effective.date, end: ymd(addDays(addMonths(new Date(res.effective.date + 'T00:00:00Z'), 12 * n), -1)), duration: { n, unit: 'year', text: fa[0] }, confidence: res.effective.needsReview ? 'medium' : 'high', needsReview: !!res.effective.needsReview, why: `No fixed term; it extends "${fa[0].replace(/^on\s+/i, '')}", so the first term ends the day before that anniversary.`, source: src(s), rule: 'anniversary' };
    break;
  }
  // Guard: a term read from a sentence that talks about another or prior agreement is outside the operative term clause, so never Clear.
  // "N full calendar months" from a mid-month start: could end on the anniversary or at the end of the last whole month.
  if (res.term?.end && res.term.start && !res.term.start.endsWith('-01') && /\bfull\s+calendar\s+months?\b/i.test(res.term.source?.quote || '')) { res.term.confidence = 'medium'; res.term.needsReview = true; res.term.why += ' "Full calendar months" from a mid-month start may run to the end of the last whole month instead; confirm.'; }
  if (res.term?.end && res.term.confidence === 'high') {
    const tt = res.term.source?.quote || '';
    if (/\b(?:Prior|Original|Existing|Previous|Predecessor)\s+(?:[A-Z][a-z]+\s+)?Agreement\b|\bthat\s+certain\b|\bwhich\s+has\s+an?\s+(?:initial\s+)?term\b/.test(tt)) { res.term.confidence = 'medium'; res.term.needsReview = true; res.term.why += ' The sentence also describes another or prior agreement; confirm this is this agreement\'s own term.'; } }
  // 3. Renewal + 4. notice
  const NOT_AGREEMENT = /letter\s+of\s+credit|insurance\s+polic|security\s+deposit|surety\s+bond|[“"](?:Letter\s+of\s+Credit|Security|L\/C)[^”"]{0,30}[”"]\s+(?:means|shall\s+mean)/i;
  const isRen = s => !s.recital && !/\b(?:does|do|shall|will)\s+not\s+(?:automatically\s+)?(?:extend|renew)|\bnot\s+(?:be\s+)?automatically\s+(?:renew|extend)/i.test(s.text) && !NOT_AGREEMENT.test(s.text) && !otherAgr(s.text) && !/Termination\s+Date\s+shall\s+automatically\s+be\s+extended/i.test(s.text) && !/in\s+the\s+event\s+of\s+a\s+Change\s+(?:in|of)\s+Control[^.]{0,80}automatically\s+renew/i.test(s.text) && !/at\s+the\s+option\s+of\s+\w+[^.]{0,40}automatically\s+extended|\bif\s+an?\s+[^.]{0,80}\boccurs\b[^.]{0,200}automatically\s+extended/i.test(s.text) && /automatically\s+(?:be\s+)?(renew|extend)|renew\s+automatically|automatic(ally)?\s+renewal/i.test(s.text) && /renew|(?:term|agreement|period|employment|termination\s+date)[^.]{0,40}automatically\s+(?:be\s+)?extend/i.test(s.text) && !/^\W*If\s+this\s+Agreement\s+has\s+been\s+automatically\s+extended/i.test(s.text) && !/prevent\s+such/i.test(s.text.slice(0, 20));
  let ri = S.findIndex(s => isRen(s) && /automatically\s+renew|renew\w*\s+automatically/i.test(s.text)); if (ri < 0) ri = S.findIndex(isRen);
  if (ri >= 0) {
    const s = S[ri], t = s.text;
    const upTo = t.match(/up\s+to\s+(?:a\s+(?:maximum|total)\s+of\s+)?(?!a\b|an\b)(\w+)\s+(?:\(\d+\)\s+)?(?:additional\s+)?(?:successive\s+)?(?:consecutive\s+)?(years?|months?|periods?|terms?|renewals?)?/i);
    let max = null;
    if (upTo) { const n = /^\d+$/.test(upTo[1]) ? +upTo[1] : wordsToNumber(upTo[1]); if (n != null) max = n; }
    res._capUnit = upTo && /^(year|month)/i.test(upTo[2] || '') ? upTo[2].toLowerCase().replace(/s$/, '') : null;
    if (max == null && /\b(?:one|a\s+single)\s+additional\b/i.test(t) && !/successive/i.test(t) && !new RegExp(`\\beach\\s+(?:subsequent\\s+)?(?:${MONTH_RE}\\s+\\d{1,2}|calendar\\s+year|year|anniversary)|\\bof\\s+each\\s+(?:calendar\\s+)?year|\\bannually\\b|\\bevery\\s+year`, 'i').test(t)) max = 1;
    const kT = max == null && t.match(/successive\s+(two|three|four|five|\d)\s+terms\s+of/i); if (kT) max = /^\d$/.test(kT[1]) ? +kT[1] : wordsToNumber(kT[1]);
    const rm = t.match(/(?:successive|additional|renewal)\s+(?:successive\s+)?(?:terms?\s+of\s+|periods?\s+of\s+)?(.{0,70})/i) || t.match(/periods?\s+of\s+(.{0,60})/i);
    let dur = null;
    const tries = [];
    const rt = t.slice(t.search(/automatically|renew/i));
    for (const re of [/successive\s+(?:periods?|terms?)\s+of\s+(.{0,50})/i, /(?:successive|consecutive)\s+(.{0,50})/i, /additional\s+(?:successive\s+)?(?:term\s*\(.*?\)\s*of\s+)?(.{0,60})/i, /periods?\s+of\s+(.{0,50})/i, /renew\s+for\s+(.{0,30}?)\s+intervals/i, /extend(?:ed)?\s+(?:for|by)\s+(?:an?\s+additional\s+)?(.{0,40})/i, /extended\s+so\s+as\s+to\s+terminate\s+(.{0,30})/i, /\banother\s+(.{0,40})/i, /\brenew\w*\s+every\s+(.{0,40})/i, /\brenew\w*\s+for\s+(?:an?\s+(?:additional|further)\s+)?(.{0,30})/i, /\bterm\s*\([^)]*\)\s*of\s+(.{0,60})/i, /\bterms?\s+of\s+(.{0,50})/i]) {
      const mm = rt.match(re); if (mm) { const d = parseDuration(mm[1]); if (d && d.index <= 2) { dur = d; break; } tries.push(mm[1]); }
    }
    if (!dur) { const one = rt.match(/\b(?:extended|renew(?:ed)?)\s+(?:for|by)\s+(?:an?\s+additional|another|a\s+further|one\s+additional)\s+(year|month)\b/i); if (one) dur = { n: 1, unit: one[1].toLowerCase(), text: one[0].replace(/^\S+\s+\S+\s+/, '') }; }
    if ((!dur || dur.index > 2) && /year\s+to\s+year/i.test(t) && !/successive\s+one\s*\(1\)\s*year/i.test(t)) dur = { n: 1, unit: 'year', text: 'year to year' };
    const basis = !dur && t.match(/\bon\s+an?\s+(quarterly|monthly|annual|yearly|month-to-month)\b[^.]{0,30}?basis/i);
    if (basis) dur = { quarterly: { n: 3, unit: 'month' }, monthly: { n: 1, unit: 'month' }, 'month-to-month': { n: 1, unit: 'month' }, annual: { n: 1, unit: 'year' }, yearly: { n: 1, unit: 'year' } }[basis[1].toLowerCase()] && { ...{ quarterly: { n: 3, unit: 'month' }, monthly: { n: 1, unit: 'month' }, 'month-to-month': { n: 1, unit: 'month' }, annual: { n: 1, unit: 'year' }, yearly: { n: 1, unit: 'year' } }[basis[1].toLowerCase()], text: basis[0] };
    if (!dur && /equal\s+in\s+length\s+to\s+the\s+(?:Initial\s+Term|initial\s+term|then[- ]current\s+term)/i.test(t) && res.term?.start && res.term?.end) {
      const st0 = new Date(res.term.start + 'T00:00:00Z'); for (let k = 1; k <= 120; k++) if (ymd(addDays(anniv(st0, { n: k, unit: 'month' }), -1)) === res.term.end) { dur = k % 12 === 0 ? { n: k / 12, unit: 'year', text: 'equal in length to the Initial Term' } : { n: k, unit: 'month', text: 'equal in length to the Initial Term' }; dur.equal = true; break; }
    }
    if (max != null && res._capUnit && dur && !dur.redacted) { const cm = res._capUnit === 'year' ? 12 * max : max, pm = dur.unit === 'year' ? 12 * dur.n : dur.unit === 'month' ? dur.n : 0; if (pm) max = Math.max(1, Math.round(cm / pm)); }
    delete res._capUnit;
    let review = false, why = '', conf = 'high';
    if (!dur) { review = true; conf = 'none'; why = 'Auto-renewal found, but renewal length could not be read.'; }
    else if (dur.redacted) { review = true; conf = 'none'; why = 'Renewal length is blacked out in the public copy.'; }
    else why = `Renews for successive ${dur.n} ${dur.unit}(s)${dur.equal ? ' (each renewal is as long as the Initial Term)' : ''}${max != null ? `, at most ${max} time(s)` : ''}.`;
    const cond = rt.split(/\bunless\b/i)[0].match(/\b(?:if|provided\s+that|so\s+long\s+as|as\s+long\s+as)\s+[^,.;]{3,90}/i);
    if (cond && dur && !dur.redacted) { review = true; conf = 'medium'; why += ` Renewal is conditional ("${cond[0].trim()}"); confirm the condition holds before relying on these dates.`; }
    res.renewal = { auto: true, period: dur && !dur.redacted ? { n: dur.n, unit: dur.unit, text: dur.text } : null, max, confidence: conf, needsReview: review, why, source: src(s) };

    // notice: same sentence, else the next two sentences
    const xrefFirst = /(?:notice|notif)[^.]{0,160}?(?:pursuant\s+to|in\s+accordance\s+with|as\s+(?:set\s+forth|provided|described)\s+in|under)\s+(?:Section|§)\s*\d/i.test(t) && !/\d+\s*\)?\s*(?:calendar\s+|business\s+)?(?:days?|months?)|\b(?:one|two|three|four|five|six|nine|twelve|thirty|sixty|ninety)\s+(?:calendar\s+|business\s+)?(?:days?|months?)\s+(?:prior|before)/i.test(t);
    for (const cand of (xrefFirst ? [] : [S[ri], S[ri + 1], S[ri + 2], S[ri - 1]]).filter(Boolean)) {
      const ct = cand.text;
      if (!/notice|notif|\bnote\s+of\s+non-?renewal/i.test(ct)) continue;
      const stated = !redactedBeforeCheck(ct) && ct.match(/\b(?:no\s+later\s+than|by|on\s+or\s+before)\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*(?:\d\s+)?\d{4})/i);
      if (stated && parseDate(stated[1])) { res.notice = { period: null, date: ymd(parseDate(stated[1]).date), confidence: 'high', needsReview: false, why: `The clause states the send-notice date outright ("${stated[0]}").`, source: src(cand) }; break; }
      const alt = ct.match(new RegExp(`((?:${NUMWORD_RE})?\\s*(?:\\(\\s*\\d+\\s*\\))?)\\s*(full\\s+)?(?:calendar\\s+)?(months?|days?)\\s+when\\s+on\\s+an?\\s+month[\\s-]to[\\s-]month\\s+agreement,?\\s+or\\s+((?:${NUMWORD_RE})?\\s*(?:\\(\\s*\\d+\\s*\\))?)\\s*(full\\s+)?(?:calendar\\s+)?(months?|days?)\\s+when\\s+on\\s+all\\s+other\\s+agreements\\s+prior\\s+to`, 'i'));
      if (alt && res.renewal.period) { const m2m = res.renewal.period.n === 1 && res.renewal.period.unit === 'month'; const d = parseDuration((m2m ? alt[1] + ' ' + alt[3] : alt[4] + ' ' + alt[6]).trim()); const full = !!(m2m ? alt[2] : alt[5]); if (d && d.n) { res.notice = { period: { n: d.n, unit: d.unit, text: d.text + (full ? ' (full calendar)' : ''), full }, confidence: 'medium', needsReview: true, why: `The clause gives one notice length for month-to-month agreements and another for all others; this one renews every ${plural(res.renewal.period.n, res.renewal.period.unit)}, so ${d.text}${full ? ' full calendar' : ''} applies. The send-notice deadline is the end of the term minus ${plural(d.n, d.unit)}${full ? ' (whole calendar months, so the last day of the month before them)' : ''}. Confirm which applies.`, source: src(cand) }; break; } }
      const nm = ct.match(new RegExp(`(?:at\\s+least|not\\s+less\\s+than|no\\s+less\\s+than|no\\s+later\\s+than|on\\s+or\\s+before\\s+the\\s+day\\s+that\\s+is|within)?\\s*((?:${NUMWORD_RE})?\\s*(?:\\(\\s*\\d+\\s*\\))?|\\d+|${REDACT_RE})\\s*-?\\s*(?:calendar\\s+|business\\s+)?(days?|months?|years?)['’]?s?\\s+(?:(?:advance\\s+|prior\\s+)?written\\s+notice\\s+(?:of\\s+(?:non-?\\s?renewal|termination)\\s+)?)?(?:prior|before|in\\s+advance)`, 'i'));
      const bare = !nm && ct.match(new RegExp(`((?:${NUMWORD_RE})?\\s*(?:\\(\\s*\\d+\\s*\\)|\\d+)?)\\s*(days?|months?)['’]?s?\\s+(?:prior\\s+)?(?:written\\s+)?notice\\s*(?:\\([^)]{0,40}\\)\\s*)?of\\s+(?:non-?renewal|its\\s+intent)`, 'i'));
      const redactedBefore = ct.match(new RegExp(`${REDACT_RE}\\s+(?:prior|before)`, 'i'));
      const byDate = !nm && !redactedBefore && ct.match(/\b(?:by|on\s+or\s+before)\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4})/i);
      if (byDate) { res.notice = { period: null, date: ymd(parseDate(byDate[1]).date), confidence: 'high', needsReview: false, why: `The clause states the notice deadline as a calendar date ("${byDate[0]}"); shown as written, not computed.`, source: src(cand) }; break; }
      if (!nm && !redactedBefore && bare && /notice\s+of\s+non-?\s?renewal\s+prior\s+to\s+the\s+(?:expiration|end)/i.test(ct)) { const d = parseDuration(bare[0]); if (d && d.n) { res.notice = { period: { n: d.n, unit: d.unit, text: d.text }, confidence: 'high', needsReview: false, why: `"${d.text} notice of non-renewal prior to the expiration": send on or before the end of the term minus ${plural(d.n, d.unit)}.`, source: src(cand) }; break; } }
      if (!nm && !redactedBefore && bare) { const d = parseDuration(bare[0]); if (d && d.n) { res.notice = { period: { n: d.n, unit: d.unit, text: d.text }, confidence: 'medium', needsReview: true, why: `The send-notice deadline is the end of the term minus ${plural(d.n, d.unit)}. The clause gives "${d.text} notice" without saying before what; measured back from the end of the term (the usual reading). Confirm.`, source: src(cand) }; break; } }
      if (!nm && !redactedBefore) continue;
      const d = nm ? parseDuration(nm[1].trim() + ' ' + (/business\s+(?:days?)\b/i.test(nm[0]) ? 'business ' : '') + nm[2]) : { redacted: true, text: redactedBefore[0] };
      let nconf = 'high', nreview = false, nwhy;
      if (!d || d.redacted || d.n == null) { nconf = 'none'; nreview = true; nwhy = d?.redacted ? 'Notice period is blacked out in the public copy. Send-notice deadline date cannot be computed.' : `Notice length in "${(nm?.[0] || '').trim().slice(0, 60)}" could not be read. Send-notice deadline date cannot be computed.`; }
      else {
        nwhy = `The send-notice deadline is the end of the term minus ${plural(d.n, d.unit)}.`;
        if (d.business) { nconf = 'medium'; nreview = true; nwhy = `The send-notice deadline is the end of the term minus ${d.n} business days (Saturdays and Sundays skipped; public holidays are not modelled, so check the calendar).`; }
        if (d.conflict) { nconf = 'low'; nreview = true; nwhy = `Words and numerals disagree in "${d.text}".`; }
        if (/first\s+renewal\s+term/i.test(ct) && !/initial\s+term/i.test(ct.split(/notice/i)[1] || '')) { nconf = 'low'; nreview = true; nwhy += ' Clause measures notice from "the end of the first Renewal Term", not the Initial Term. It is unclear which term the notice counts from.'; }
        if (/at\s+least|not\s+less|no\s+less/i.test(nm?.[0] || '')) nwhy += ' "At least / not less than": send on or before this date.';
        if (/inclusive\s+of\s+the\s+final\s+day/i.test(ct)) { nconf = 'medium'; nreview = true; nwhy += ' Clause adds "inclusive of the final day", so the count could land one day later; the earlier (safer) date is shown. Confirm with counsel.'; }
      }
      res.notice = { period: d && !d.redacted && d.n != null ? { n: d.n, unit: d.unit, text: d.text, business: !!d.business } : null, confidence: nconf, needsReview: nreview, why: nwhy, source: src(cand) };
      break;
    }
    // The renewal clause names no notice, but a separate non-renewal clause does ("written notice of nonrenewal not less than 30 days prior to the end of the Initial Term or any Renewal Term").
    if (!res.notice && !xrefFirst) for (const cand of S) {
      if (cand === S[ri] || cand.text.length > 700 || !/notice\s+of\s+non-?\s?renewal|elect\s+(?:to\s+not|not\s+to)\s+renew/i.test(cand.text)) continue;
      const m2 = cand.text.match(new RegExp(`(?:at\\s+least|not\\s+less\\s+than|no\\s+less\\s+than|no\\s+later\\s+than)\\s*((?:${NUMWORD_RE})?\\s*(?:\\(\\s*\\d+\\s*\\))?|\\d+)\\s*(?:calendar\\s+)?(days?|months?)['’]?s?\\s+(?:prior\\s+to|before)\\s+the\\s+(?:end|expiration)\\s+of\\s+the\\s+(?:Initial\\s+Term|then[- ]current\\s+(?:term|Term)|(?:applicable\\s+)?(?:Renewal\\s+)?Term)`, 'i'));
      const d = m2 && parseDuration(m2[1].trim() + ' ' + m2[2]);
      if (d && d.n && !d.conflict) { res.notice = { period: { n: d.n, unit: d.unit, text: d.text }, confidence: 'medium', needsReview: true, why: `The send-notice deadline is the end of the term minus ${plural(d.n, d.unit)}. The renewal clause itself gives no notice length; a separate non-renewal clause (quoted) does. Confirm it governs renewal.`, source: src(cand) }; break; }
    }
    // Cross-reference: "notice ... pursuant to / as set forth in Section 7.4" -> read the referenced section, flag for review.
    if (!res.notice) for (const cand of [S[ri], S[ri + 1]].filter(Boolean)) {
      const xr = cand.text.match(/(?:notice|notif)[^.]{0,160}?(?:pursuant\s+to|in\s+accordance\s+with|as\s+(?:set\s+forth|provided|described)\s+in|under)\s+(?:Section|§)\s*(\d+(?:\.\d+)*)/i);
      if (!xr) continue;
      const num = xr[1].replace(/\./g, '\\.');
      const hi = S.findIndex(x => new RegExp(`^(?:Section\\s+)?${num}\\.?\\s`, 'i').test(x.text));
      const sec = hi >= 0 ? [S[hi], S[hi + 1]].filter(Boolean) : [];
      let found = null;
      for (const x of sec) { const m = x.text.match(new RegExp(`((?:${NUMWORD_RE})?\\s*(?:\\(\\s*\\d+\\s*\\)|\\d+)?)\\s*(days?|months?)['’]?s?\\s+(?:prior\\s+|advance\\s+)?(?:written\\s+)?notice`, 'i')); const d = m && parseDuration(m[0]); if (d && d.n) { found = { d, x }; break; } }
      if (found) res.notice = { period: { n: found.d.n, unit: found.d.unit, text: found.d.text }, confidence: 'medium', needsReview: true, why: `The send-notice deadline is the end of the term minus ${plural(found.d.n, found.d.unit)}. The renewal clause sends notice to Section ${xr[1]} by cross-reference; that section (quoted) gives ${found.d.text}. Confirm it governs non-renewal.`, source: src(found.x), via: src(cand) };
      else res.notice = { period: null, confidence: 'none', needsReview: true, why: `The renewal clause defers the notice to Section ${xr[1]}${sec.length ? ', quoted here, which states no notice length' : ', which is not in this document'}. No send-notice deadline computed.`, source: sec.length ? src(sec[0]) : src(cand), via: src(cand) };
      break;
    }
    // "so long as neither party elects to terminate ... no later than 90 days before the end of the then-current term"
    if (!res.notice?.period) { const m = t.match(new RegExp(`(?:no\\s+later\\s+than|not\\s+later\\s+than|at\\s+least|not\\s+less\\s+than|no\\s+less\\s+than)\\s*((?:${NUMWORD_RE})?\\s*(?:\\(\\s*\\d+\\s*\\))?|\\d+)\\s*(?:calendar\\s+)?(days?|months?)['’]?\\s+(?:before|prior\\s+to)\\s+the\\s+(?:end|expiration|expiry)\\s+of\\s+the\\s+(?:then[- ]current|initial|applicable|current)?\\s*(?:term|Term|period)`, 'i')); const d = m && parseDuration(m[1].trim() + ' ' + m[2]);
      if (d && d.n && !d.conflict) res.notice = { period: { n: d.n, unit: d.unit, text: d.text, business: false }, confidence: 'high', needsReview: false, why: `The send-notice deadline is the end of the term minus ${plural(d.n, d.unit)} ("${m[0]}").`, source: src(s) }; }
    // "not later than September 30 of the immediately preceding year": a calendar deadline before each yearly renewal date.
    if (!res.notice?.period) { const cy = t.match(/\b(?:not\s+later\s+than|no\s+later\s+than|on\s+or\s+before|by)\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})(?:st|nd|rd|th)?\s+of\s+(?:the\s+(?:immediately\s+)?preceding\s+(?:calendar\s+)?year|the\s+then[- ]current\s+(?:term|year|calendar\s+year)|each\s+(?:calendar\s+)?year)/i);
      if (cy && res.term?.end) { const R = addDays(new Date(res.term.end + 'T00:00:00Z'), 1); const d0 = parseDate(`${cy[1]}, ${R.getUTCFullYear() - 1}`);
        if (d0) { const n = Math.round((new Date(res.term.end + "T00:00:00Z") - d0.date) / 864e5); res.notice = { period: { n, unit: 'day', text: cy[0], business: false }, confidence: 'medium', needsReview: true, why: `Notice "${cy[0]}": read as ${n} days before each term end (${cy[1]} of the year before). Check.`, source: src(s), cal: cy[1] }; } } }
    // "not later than eighteen (18) months preceding the calendar year for which the term would otherwise extend": N before the renewal date.
    if (!res.notice?.period) { const pm = t.match(new RegExp(`((?:${NUMWORD_RE})?\\s*(?:\\(\\s*\\d+\\s*\\))?|\\d+)\\s*(months?|days?)\\s+(?:preceding|prior\\s+to|before)\\s+(?:the\\s+(?:start|beginning|first\\s+day)\\s+of\\s+)?the\\s+(?:calendar\\s+)?year\\s+(?:for\\s+which|in\\s+which)`, 'i')); const d = pm && parseDuration(pm[1].trim() + ' ' + pm[2]);
      if (d && d.n && !d.conflict) res.notice = { period: { n: d.n, unit: d.unit, text: d.text }, ref: 'start', confidence: 'medium', needsReview: true, why: `The send-notice deadline is the Renewal Date (the first day of the year the term would extend into) minus ${plural(d.n, d.unit)}. Check.`, source: src(s) }; }
    if (!res.notice) res.notice = /unless\s+and\s+until\s+terminated/i.test(t) && res.renewal.period ? { period: null, confidence: 'none', needsReview: true, evergreen: true, why: `Evergreen: renews every ${res.renewal.period.n} ${res.renewal.period.unit} "unless and until terminated", and the contract states no non-renewal notice period, so there is no send-notice deadline date. To exit, use its termination clause.`, source: src(s) } : { period: null, confidence: 'none', needsReview: true, why: 'Auto-renews, but no non-renewal notice period was found near the renewal clause.', source: src(s) };
    const nq = res.notice.source?.quote || '';
    if (res.notice.period && /prior\s+to\s+the\s+(?:end|expiration)\s+of\s+the\s+Initial\s+Term(?![^.]{0,40}(?:Renewal|then[- ]current|any\s+(?:extension|subsequent)))/i.test(nq)) res.notice.initialOnly = true;
    // "within 60 days prior to the end": can be read as a window that opens 60 days before the end, so sending earlier may not count. Never Clear.
    const wm = res.notice.period && nq.match(new RegExp(`\\bwithin\\s+(?:(?:${NUMWORD_RE})\\s*)?(?:\\(\\s*\\d+\\s*\\)|\\d+)?\\s*(?:calendar\\s+|business\\s+)?(?:days?|months?)\\s+(?:prior|before)`, 'i'));
    if (wm) { res.notice.withinPrior = true; res.notice.withinText = norm(wm[0]); res.notice.confidence = 'medium'; res.notice.needsReview = true; res.notice.why += ` "${res.notice.withinText}" can mean notice only counts inside a window that opens on the send-notice date.`; }
    res.notice.who = /either\s+party|each\s+party|either\s+of\s+the\s+parties/i.test(nq) ? 'Either party' : (nq.match(/\b([A-Z][A-Za-z&.]+(?:\s+[A-Z][A-Za-z&.]+)?)\s+(?:may|shall|must)\s+(?:give|provide|deliver|notify)/)?.[1] || 'Not stated');
    const days = p => !p ? 0 : p.unit === 'year' ? p.n * 12 * 30.44 : p.unit === 'month' ? p.n * 30.44 : p.n * ({ day: 1, week: 7 })[p.unit]; // months and years compared in months, so 24 months == 2 years
    if (res.notice.period && res.renewal.period && days(res.notice.period) > days(res.renewal.period)) {
      res.warnings = [`Notice period (${res.notice.period.text}) is longer than each renewal (${res.renewal.period.text}): the decision for a cycle falls before the previous cycle has even started. Calendar it at least two cycles ahead.`];
      res.reviewNotes.push(res.warnings[0]);
    }
  }

  // Rolling ("evergreen") term: on a first Renewal Date and every anniversary after it, the term extends unless notice is given N before that date.
  if (res.renewal && ri >= 0) {
    const t = S[ri].text; const eff = res.effective ? new Date(res.effective.date + 'T00:00:00Z') : null; const ORD = ['first','second','third','fourth','fifth'];
    const calEach = new RegExp(`\\beach\\s+(?:subsequent\\s+)?${MONTH_RE}\\s+\\d{1,2}(?:st|nd|rd|th)?\\s+thereafter|\\bon\\s+${MONTH_RE}\\s+\\d{1,2}(?:st|nd|rd|th)?\\s+of\\s+each\\s+(?:calendar\\s+)?year\\s+thereafter`, 'i').test(t);
    if ((/each\s+(?:annual\s+|subsequent\s+)?anniversary|each\s+anniversary/i.test(t) && /Renewal\s+Date|Rollover\s+Date|anniversary/i.test(t)) || calEach) {
      let first = null, how = '';
      const ord = t.match(/\b(?:on|commencing\s+on|beginning\s+on)\s+(?:such\s+|the\s+)?(first|second|third|fourth|fifth)\s+(?:\(\d+\w*\)\s+)?(?:annual\s+)?anniversary\s+of\s+(?:the\s+)?(?:Agreement\s+)?(?:Effective\s+Date|Start\s+Date|date\s+hereof|such\s+date)/i);
      const yr = t.match(/\b(?:commencing\s+)?on\s+(?:a|the)\s+date\s+one\s+(?:\(1\)\s+)?year\s+after\s+the\s+date\s+hereof/i);
      const each = t.match(/\bon\s+each\s+(?:annual\s+)?anniversary\s+of\s+(?:the\s+)?(?:Effective\s+Date|date\s+hereof)/i);
      const dt = t.match(/\b(?:commencing\s+on|on)\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4})(?:\s*\([^)]*\))?,?\s+and\s+(?:then\s+)?(?:on\s+)?(?:each\s+subsequent\s+(?=[A-Z]))?(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s+of\s+)?each/i);
      if (ord && eff) { first = addMonths(eff, 12 * (ORD.indexOf(ord[1].toLowerCase()) + 1)); how = ord[0].replace(/^(?:on|commencing\s+on|beginning\s+on)\s+/i, ''); }
      else if (yr && eff) { first = addMonths(eff, 12); how = 'one year after the date of the agreement'; }
      else if (dt) { first = parseDate(dt[1]).date; how = dt[1]; }
      else if (each && eff) { first = addMonths(eff, 12); how = each[0].replace(/^on\s+/i, ''); }
      if (first && res.term?.end && new RegExp(`\\b(?:upon|on|at)\\s+such\\s+(?:${'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth'}|\\d+(?:st|nd|rd|th))\\s+anniversary|commencing\\s+with\\s+the\\s+(?:date\\s+of\\s+the\\s+)?(?:scheduled\\s+)?expiration\\s+of\\s+the\\s+Initial\\s+Term`, 'i').test(t)) first = null;
      if (first) res.rolling = { first: ymd(first), how, source: src(S[ri]), calendar: calEach };
      // A calendar notice date ("on or before September 30") counts back from each Renewal Date, not the term end.
      if (first && res.notice?.cal && !(res.term?.end && ymd(addDays(new Date(res.term.end + 'T00:00:00Z'), 1)) === ymd(first))) { const d0 = parseDate(`${res.notice.cal}, ${first.getUTCFullYear()}`); let dd = d0?.date; if (dd && dd >= first) dd = parseDate(`${res.notice.cal}, ${first.getUTCFullYear() - 1}`).date; if (dd) { const n = Math.round((first - dd) / 864e5); res.notice.period = { ...res.notice.period, n }; res.notice.why = `Notice "${res.notice.period.text}": read as ${n} days before each Renewal Date (${res.notice.cal}). Check.`; } }
    }
  }
  // Notice measured from the Renewal Date (the day the next term starts), not from the last day of the term.
  if (res.notice?.period && !/\bon\s+(?:such\s+end\s+date|the\s+last\s+day\s+of\s+the\s+(?:Initial\s+)?Term|the\s+end\s+of\s+the\s+Initial\s+Term)|At\s+the\s+end\s+of\s+the\s+Initial\s+Term/i.test(res.renewal?.source?.quote || '') && /prior\s+to\s+(?:the\s+)?(?:applicable\s+|next\s+)?Renewal\s+Date|prior\s+to\s+the\s+commencement\s+of\s+(?:each|the|any)\s+(?:such\s+)?renewal|(?:before|prior\s+to)\s+(?:any|each|such|the\s+(?:next|applicable|then-applicable))\s+anniversary|before\s+the\s+extension\s+would\s+(?:otherwise\s+)?(?:become\s+effective|take\s+effect)/i.test(res.notice.source?.quote || '')) { if (!(/anniversary/i.test((res.notice.source?.quote || '').match(/(?:before|prior\s+to)\s+(?:any|each|such|the\s+(?:next|applicable|then-applicable))\s+anniversary/i)?.[0] || '') && !/anniversary minus one day|the day before/.test(res.term?.why || ''))) { res.notice.ref = 'start'; res.notice.why = res.notice.why.replace(/^The send-notice deadline is the end of the term minus/, 'The send-notice deadline is the Renewal Date (the day after the term ends) minus'); } }
  // An automatic renewal that belongs to a letter of credit, insurance or security deposit is not the agreement's own clause.
  if (!res.renewal && S.some(s => NOT_AGREEMENT.test(s.text) && /automatic\w*\s+(?:renew|extend)|evergreen/i.test(s.text))) res.renewalNote = `No renewal clause for the agreement itself (the only automatic renewal found is for ${S.find(s => NOT_AGREEMENT.test(s.text) && /automatic\w*\s+(?:renew|extend)|evergreen/i.test(s.text)).text.match(/letter\s+of\s+credit|insurance\s+polic\w+|security\s+deposit|surety\s+bond/i)?.[0].toLowerCase().replace(/^insurance polic\w+$/, 'an insurance policy').replace(/^(letter|security|surety)/, 'a $1') || 'a defined term'}).`;
  // One-sided extension right (e.g. "Customer shall have the ability to unilaterally extend this Agreement an additional calendar quarter"): noted, dates unchanged.
  if (res.term || res.renewal) { const es = S.find(s => s.text.length < 700 && /\bunilaterally\s+extend\b|\bat\s+(?:its|their)\s+(?:sole\s+)?(?:option|election|discretion),?\s+(?:to\s+)?extend\s+(?:this\s+Agreement|the\s+(?:Initial\s+)?Term)\b|\b(?:option|right|ability)\s+to\s+(?:unilaterally\s+)?extend\s+(?:this\s+Agreement|the\s+(?:Initial\s+)?Term)\b/i.test(s.text) && !/mutual(?:ly)?\s+(?:agree|consent|written)|both\s+parties|either\s+party/i.test(s.text));
    if (es) { const who = es.text.match(/\b([A-Z][A-Za-z&.]+(?:\s+[A-Z][A-Za-z&.]+)?)\s+(?:shall\s+have|has|may|will\s+have)\b/)?.[1]?.replace(/^(?:The|Notwithstanding)\s+/, '') || 'One party'; const how = es.text.match(/extend\s+(?:this\s+Agreement|the\s+(?:Initial\s+)?Term)\s+(?:for\s+)?(an?\s+additional\s+[^.,;]{2,40}?|by\s+[^.,;]{2,40}?|up\s+to\s+[^.,;]{2,40}?)(?=\s+(?:after|beyond|following|from|past)|[.,;]|$)/i)?.[1] || '';
      res.extension = { who, how, source: src(es), note: `One-sided extension right: ${who} can extend the agreement${how ? ' ' + how : ''} on its own. That can only move the end later; the send-notice date shown is unchanged.` }; res.reviewNotes.push(res.extension.note); } }
  // 5. Payment and other deadlines (event-driven: quoted, never given a guessed calendar date)
  const seen = new Set();
  for (const s of S) {
    const t = s.text; if (t.length > 900) continue;
    const pay = /\b(payable|shall\s+pay|will\s+pay|invoice|payment)/i.test(t);
    const win = t.match(new RegExp(`within\\s+((?:${NUMWORD_RE})?\\s*(?:\\(\\s*\\d+\\s*\\))?|\\d+)\\s*(?:calendar\\s+|business\\s+)?days?`, 'i'));
    const sched = t.match(/\b(quarterly|monthly|annual(?:ly)?)\s+(?:installments?|in\s+arrears|in\s+advance|fee)/i) || t.match(/payable\s+(?:in\s+)?(quarterly|monthly|annual)/i);
    const fixed = t.match(/\bon\s+the\s+1st\s+of\s+([A-Z][a-z]+(?:,\s*[A-Z][a-z]+)*(?:,?\s+and\s+[A-Z][a-z]+)?)/);
    if (pay && (win || sched || fixed)) {
      const key = t.slice(0, 80); if (seen.has(key)) continue; seen.add(key);
      const d = win ? parseDuration(win[0].replace(/^within\s+/i, '')) : null;
      const trig = win && (t.slice(win.index + win[0].length, win.index + win[0].length + 80).match(/^\s*(?:after|of|from|following)\s+(?:the\s+)?(?:date\s+of\s+|end\s+of\s+(?:each\s+|the\s+)?)?(?:the\s+|its\s+|such\s+|an?\s+|each\s+)?(receipt\s+of\s+(?:an?\s+|the\s+|such\s+)?(?:invoice|payment)|invoice\s+date|invoice|delivery|shipment|acceptance|calendar\s+quarter|quarter|month|Effective\s+Date|execution|approval)/i)?.[1]);
      const late = t.match(/(?:interest|late\s+(?:fee|charge))[^.]{0,60}?(\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s+percent)(?:\s+per\s+(month|annum|year))?/i);
      res.payments.push({ kind: 'payment', late: late ? `${late[1]}${late[2] ? ' per ' + late[2] : ''}` : '', rule: (fixed ? `1st of ${fixed[1]}` : (sched ? sched[1].toLowerCase() : `within ${d ? d.n + ' ' + d.unit + 's' : win[1]}${trig ? ' of ' + trig.toLowerCase().replace(/^receipt of (an? |the |such )?/, 'receipt of ') : ''}`)) + (late ? `; late interest ${late[1]}${late[2] ? ' per ' + late[2] : ''}` : ''),
        trigger: fixed ? 'fixed calendar dates' : (win ? (trig ? trig.toLowerCase() : 'event') : 'recurring'),
        confidence: d?.conflict ? 'low' : 'high', needsReview: !!d?.conflict, source: src(s) });
      if (res.payments.length >= 6) break;
    }
  }
  // Termination for convenience: every clause (up to 3), with who holds the right and the notice length.
  const TFC = /terminat\w+[^.]{0,120}(?:for\s+(?:any\s+reason|convenience|any\s+or\s+no\s+reason|no\s+reason)|without\s+cause)|(?:for\s+convenience|without\s+cause)[^.]{0,60}terminat/i;
  for (const s of S) {
    if (res.other.length >= 3) break;
    const t = s.text; if (t.length > 900 || !TFC.test(t) || !/notice/i.test(t)) continue;
    const nm = t.match(new RegExp(`((?:${NUMWORD_RE})?\\s*(?:\\(\\s*\\d+\\s*\\)|\\d+)?|${REDACT_RE})\\s*(?:calendar\\s+|business\\s+)?(days?|months?)['’]?s?\\s+(?:prior\\s+|advance\\s+)?(?:written\\s+)?notice`, 'i'));
    const d = nm ? parseDuration(nm[0]) : null;
    const who = (t.match(/\b(either\s+party|each\s+party|[A-Z][A-Za-z&.]+(?:\s+[A-Z][A-Za-z&.]+)?)\s+(?:may|shall\s+have\s+the\s+right\s+to)\s+(?:at\s+any\s+time\s+)?(?:\w+\s+)?terminat/) || t.match(/terminated\s+by\s+(either\s+party|[A-Z][A-Za-z&.]+)/))?.[1] || '';
    const rule = d && d.n ? `${d.n} ${d.unit}s' notice` : d?.redacted ? 'notice period redacted' : 'notice length not stated';
    const why = (who ? `Held by ${/either|each/i.test(who) ? 'either party' : who}. ` : 'Holder not identified; read the clause. ') + 'A right, not a deadline.' + (d && d.n ? ` Earliest exit = notice date + ${plural(d.n, d.unit)}.` : ' No computable notice length, so needs review.');
    res.other.push({ kind: 'termination for convenience', rule, who: who.replace(/^(either|each)\s+party$/i, 'either party'), notice: d && d.n ? { n: d.n, unit: d.unit } : null, why, confidence: d && d.n ? (who ? 'high' : 'medium') : 'low', needsReview: !(d && d.n), source: src(s) });
  }

  const bad = new Set();
  for (const s of S) for (const m of s.text.matchAll(new RegExp(`${MONTH_RE}\\s+(\\d{1,2}),?\\s*(\\d{4})`, 'gi'))) { const mo = MONTHS[m[1].toLowerCase().replace('.', '').slice(0, 3)]; if (mo && !mkDate(+m[3], mo, +m[2])) bad.add(m[0]); }
  if (bad.size) res.reviewNotes.push(`Invalid calendar date in the text (${[...bad].slice(0, 3).map(b => '"' + b + '"').join(', ')}); ignored, not rolled over.`);
  if (/\[\s*\*+\s*\]/.test(S.map(s => s.text).join(' '))) res.reviewNotes.push('Public filing contains redactions ([***]). Some terms may be hidden.');
  // Either side can end it at any time on N days' notice: a renewal then has no deadline that matters.
  if (res.renewal) { const NDAYS = /(?:at\s+least\s+)?((?:[a-z]+\s+)?\(?\d+\)?|[a-z]+)\s*(?:calendar\s+)?(day|month)s?['’]?\s+(?:prior\s+)?(?:written\s+)?notice/i;
    const rs = res.renewal.source && S.find(x => src(x).line === res.renewal.source.line && /renew|extend/i.test(x.text));
    const either = S.find(x => /\b(?:either|each|any)\s+[Pp]arty\b[^.]{0,40}\bmay\s+terminate\s+(?:this\s+Agreement\s+)?(?:\([^)]*\)\s*)?at\s+any\s+time\b/i.test(x.text) && NDAYS.test(x.text.slice(x.text.search(/at\s+any\s+time/i))));
    const until = S.find(x => /renew\w*[^.]{0,80}\buntil\s+terminated\s+by\s+\w+\s+(?:upon|on|with)\b/i.test(x.text) && NDAYS.test(x.text)) ;
    const hit = (either && !res.notice?.period ? either : null) || (until && S.some(x => /\b(?:Company|Client|Customer)\s+may\s+terminate\s+(?:this\s+Agreement\s+)?(?:\([^)]*\)\s*)?at\s+any\s+time\b/i.test(x.text)) ? until : null);
    if (hit) { const m = hit.text.slice(hit === either ? hit.text.search(/at\s+any\s+time/i) : 0).match(NDAYS); const d = parseDuration(m[0]); if (d && d.n) res.anyTimeExit = { n: d.n, unit: d.unit, source: src(hit), why: `Can be ended any time on ${plural(d.n, d.unit)}' notice, so no renewal deadline: "${hit.text.slice(0, 180)}"` }; } }
  // Safety net: renewal or extension wording that was not modelled must never read as Clear.
  { const ant = S.find(s => /\b(?:anticipat\w*|expect\w*|estimated|on\s+or\s+about|tentative\w*)\b[^.]{0,120}[“"]\s*(?:Employment\s+)?(?:Start|Commencement)\s+Date\s*[”"]/i.test(s.text));
    if (ant) res.startConflict = 'the start date is only anticipated or approximate; confirm the actual start';
    else if (res.term && res.effective && /\b(?:Commencement|Start)\s+Date\b/.test(res.term.source?.quote || '') && res.term.start && res.term.start !== res.effective.date) res.startConflict = `the term runs from the ${(res.term.source.quote.match(/\b(?:Employment\s+)?(?:Commencement|Start)\s+Date\b/) || ['Commencement Date'])[0]} (${res.term.start}), not the Effective Date (${res.effective.date}); confirm it`; }
  res.renewWords = S.some(s => !s.recital && /\b(?:automatic\w*\s+(?:be\s+)?(?:renew|extend)\w*|renew(?:s|ed|al)?\b|(?:term|agreement|employment)[^.]{0,40}\b(?:be|is|shall\s+be)\s+extended)/i.test(s.text) && /\b(?:term|agreement|employment|period)\b/i.test(s.text));
  if (!res.renewal) { const h = S.find(s => /\b(?:automatic\w*\s+(?:be\s+)?(?:renew|extend)\w*|renew(?:s|ed|al)?\b|(?:term|agreement|employment)[^.]{0,40}\b(?:be|is|shall\s+be)\s+extended)/i.test(s.text) && /\b(?:term|agreement|employment|period)\b/i.test(s.text)); if (h) res.renewHint = { text: h.text.slice(0, 200), other: NOT_AGREEMENT.test(h.text), source: src(h) }; }
  return res;
}

// US federal holidays for any year, computed by rule (5 U.S.C. 6103), with observed dates
// (OPM: a Saturday holiday is observed on Friday, a Sunday holiday on Monday).
const nthWd = (y, m, wd, n) => { const d = new Date(Date.UTC(y, m - 1, 1)); return 1 + ((wd - d.getUTCDay() + 7) % 7) + 7 * (n - 1); };
const lastWd = (y, m, wd) => { const d = new Date(Date.UTC(y, m, 0)); return d.getUTCDate() - ((d.getUTCDay() - wd + 7) % 7); };
const _hol = new Map();
export function usHolidays(y) {
  if (_hol.has(y)) return _hol.get(y);
  const D = (m, d) => new Date(Date.UTC(y, m - 1, d));
  const obs = d => d.getUTCDay() === 6 ? addDays(d, -1) : d.getUTCDay() === 0 ? addDays(d, 1) : d;
  const list = [[obs(D(1, 1)), "New Year's Day"], [D(1, nthWd(y, 1, 1, 3)), 'Martin Luther King Jr. Day'], [D(2, nthWd(y, 2, 1, 3)), "Washington's Birthday"], [D(5, lastWd(y, 5, 1)), 'Memorial Day'], ...(y >= 2021 ? [[obs(D(6, 19)), 'Juneteenth']] : []), [obs(D(7, 4)), 'Independence Day'], [D(9, nthWd(y, 9, 1, 1)), 'Labor Day'], [D(10, nthWd(y, 10, 1, 2)), 'Columbus Day'], [obs(D(11, 11)), 'Veterans Day'], [D(11, nthWd(y, 11, 4, 4)), 'Thanksgiving Day'], [obs(D(12, 25)), 'Christmas Day']];
  const m = new Map(list.map(([d, n]) => [ymd(d), n])); _hol.set(y, m); return m;
}
// Name of the US federal holiday observed on this day, or ''. Checks the next year too (New Year's Day on a Saturday is observed on 31 Dec).
export const usHoliday = day => { const y = +day.slice(0, 4); return usHolidays(y).get(day) || usHolidays(y + 1).get(day) || ''; };
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// A fixed-date holiday observed on another day (1 Jan 2028 is a Saturday, so New Year's Day is observed on Fri 31 Dec 2027)
const FIXED = { "New Year's Day": '01-01', Juneteenth: '06-19', 'Independence Day': '07-04', 'Veterans Day': '11-11', 'Christmas Day': '12-25' };
export const holidayPhrase = day => { const h = usHoliday(day); if (!h) return ''; return FIXED[h] && day.slice(5) !== FIXED[h] ? `the observed ${h} holiday` : h; };
// A missed date, said as the send day it really was; a moved one names the contract date too: "Missed Fri 16 Oct 2026 (contract date Sun 18 Oct)"
export const missedText = d => { const s = safeSendBy(d); if (!s.changed) return `Missed ${fmtD(d)}`; const W = x => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(x + 'T00:00:00Z').getUTCDay()]; return `Missed ${W(s.date)} ${fmtD(s.date)} (contract date ${W(d)} ${fmtD(d).replace(/ \d{4}$/, d.slice(0, 4) === s.date.slice(0, 4) ? '' : ' ' + d.slice(0, 4))})`; };
// Last safe business day on or before a contract deadline: steps back over Saturdays, Sundays and US federal holidays.
// Returns { date, changed, reason } where reason names why the contract date is not a business day.
// forward: for "within N days prior" windows the day opens the window, so a weekend or holiday moves to the NEXT business day.
export function safeSendBy(day, forward = false) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || isNaN(new Date(day + 'T00:00:00Z')) || ymd(new Date(day + 'T00:00:00Z')) !== day) return { date: '', changed: false, reason: '' };
  const wd = new Date(day + 'T00:00:00Z').getUTCDay();
  const reason = wd === 0 || wd === 6 ? `Falls on a ${WD[wd]}` : usHoliday(day) ? `Falls on ${holidayPhrase(day)} (US federal holiday)` : '';
  let d = new Date(day + 'T00:00:00Z');
  while ([0, 6].includes(d.getUTCDay()) || usHoliday(ymd(d))) d = addDays(d, forward ? 1 : -1);
  return { date: ymd(d), changed: ymd(d) !== day, reason };
}
// Two readings of "within N days prior" when the window start (term end minus N, unshifted) is not a business day.
const WDN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dw = (d, y) => { const t = new Date(d + 'T00:00:00Z'); return `${WDN[t.getUTCDay()]} ${t.getUTCDate()} ${MN[t.getUTCMonth()]}${y ? ' ' + d.slice(0, 4) : ''}`; };
export function twoReadings({ start, end, n, unit, quote }) {
  const first = safeSendBy(start, true).date; const per = `${n} ${unit}${n === 1 ? '' : 's'}`; const sameY = start.slice(0, 4) === end.slice(0, 4); const shifted = first !== start;
  const [ey, em, ed] = end.split('-');
  return `Needs review: two readings. ${quote ? `The clause says "${quote}"` : `Notice must fall within ${per} of the term end`}. If that opens a window, it runs from ${dw(start, !sameY)} to ${+ed} ${MN[+em - 1]} ${ey}${shifted ? `, and the first business day is ${dw(first, first.slice(0, 4) !== end.slice(0, 4))}` : ''}. If it means at least ${per} before, the cutoff is ${dw(start, true)}. Notice delivered on ${dw(start, true)} satisfies both${shifted ? ', if the notices clause allows a delivery method that works that day; otherwise ask counsel which reading applies' : ' readings, so that is the day to send it'}`;
}
export const dayWord = n => `${n} day${Math.abs(n) === 1 ? '' : 's'}`;
// HTML to lines, same method as edgar/holdout/totext.py: block tags become line breaks, script/style dropped, whitespace collapsed, empty lines removed.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '—', ndash: '–', sect: '§', hellip: '…' };
export function htmlToLines(html) {
  const t = String(html).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(p|div|br|tr|li|h[1-6]|table|td)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m);
  return t.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
// Word files go through the same line splitter as HTML (paragraphs and table cells alike). A .docx that
// holds HTML source as text (a web page pasted or saved into Word) is unwrapped a second time.
export function docxLines(html) {
  const L = htmlToLines(html);
  const tags = L.join('\n').match(/<\/?(?:p|div|font|span|td|tr|table|html|body|b|u|i|br)\b[^>]*>/gi) || [];
  return (tags.length >= 3 ? htmlToLines(L.join('\n')) : L).map(text => ({ para: true, text }));
}
// ---------- schedule: send-notice deadline queue ----------
// Returns the dated items for one contract given an as-of date (YYYY-MM-DD).
export const sure = c => c === 'high' ? 'Sure' : c === 'none' ? 'Can’t tell' : 'Check this';
export function schedule(x, asOf) {
  const items = [];
  const as = new Date(asOf + 'T00:00:00Z');
  const base = { confidence: 'none', needsReview: true };
  if (x.effective) items.push({ type: 'Effective date', date: x.effective.date, confidence: x.effective.confidence, needsReview: x.effective.needsReview, why: x.effective.why, source: x.effective.source });
  if (x.rolling && x.notice?.period && !x.notice.period.redacted && !(x.term?.end && ymd(addDays(new Date(x.term.end + 'T00:00:00Z'), 1)) === x.rolling.first)) {
    const np = x.notice.period; let R = new Date(x.rolling.first + 'T00:00:00Z'), k = 0;
    while (addDuration(R, np, -1) < as && k < 200) { R = addMonths(new Date(x.rolling.first + 'T00:00:00Z'), 12 * ++k); }
    const act = addDuration(R, np, -1); const conf = (x.effective?.needsReview || x.rolling.calendar) && x.notice.confidence === 'high' ? 'medium' : x.notice.confidence;
    // The previous Renewal Date has not arrived yet but its send-notice date has passed: warn (missed, not yet renewed).
    if (k > 0) { const Rp = addMonths(new Date(x.rolling.first + 'T00:00:00Z'), 12 * (k - 1)); if (Rp >= as) { const mw = { actBy: ymd(addDuration(Rp, np, -1)), renews: ymd(Rp) };
      items.push({ type: 'MISSED send-notice deadline', date: mw.actBy, missed: true, status: 'missed', confidence: conf === 'high' ? 'medium' : conf, needsReview: true, why: `MISSED: the send-notice deadline before the Renewal Date ${mw.renews} passed on ${mw.actBy}, so it renews on ${mw.renews} unless the other side agrees to end it. The next send-notice deadline is ${ymd(act)}.`, source: x.notice.source });
      items.push({ missedWindow: mw, type: 'Current term ends', date: ymd(addDays(Rp, -1)), confidence: conf, needsReview: true, why: `The term running on the as-of date ends the day before the Renewal Date ${mw.renews}.`, source: x.rolling.source }); } }
    items.push({ type: 'Renewal Date', date: ymd(R), confidence: conf, needsReview: !!x.effective?.needsReview, why: `Rolling term: it extends on each Renewal Date (first ${x.rolling.how}, then every anniversary) unless notice is given first.`, source: x.rolling.source });
    items.push({ type: 'Send-notice deadline', date: ymd(act), actBy: true, confidence: conf, needsReview: !!(x.notice.needsReview || x.effective?.needsReview), why: `Renewal Date ${ymd(R)} minus ${plural(np.n, np.unit)}.${k > 0 ? ` Earlier Renewal Dates have passed, so it has extended ${k === 1 ? 'once' : k + ' times'}.` : ''}`, source: x.notice.source, rolling: true });
    return items;
  }
  if (!x.term) { items.push({ ...base, type: 'Term / expiry', date: '', why: 'No term length found in the term or renewal section. Needs review.', source: null }); if (x.notice?.date) items.push({ type: 'Send-notice deadline', date: x.notice.date, actBy: true, confidence: 'medium', needsReview: true, why: x.notice.why + ' Term end not found, so the date is not cross-checked against the term.', source: x.notice.source, status: x.notice.date < asOf ? 'past' : '' }); return items; }
  if (!x.term.end) { items.push({ type: 'Term / expiry', date: '', confidence: x.term.confidence, needsReview: true, why: x.term.why, source: x.term.source }); if (x.notice?.date) items.push({ type: 'Send-notice deadline', date: x.notice.date, actBy: true, confidence: 'medium', needsReview: true, why: x.notice.why + ' Term end not computable here, so the date is not cross-checked against the term.', source: x.notice.source, status: x.notice.date < asOf ? 'past' : '' }); else if (x.notice) items.push({ type: 'Send-notice deadline', date: '', confidence: 'none', needsReview: true, why: 'No end date could be worked out, so no send-notice deadline date. ' + (x.notice.why || ''), source: x.notice.source, noticeText: x.notice.period?.text || '' }); return items; }
  const end0 = new Date(x.term.end + 'T00:00:00Z');
  const termConf = x.term.confidence, termRev = x.term.needsReview;
  const rp = x.renewal?.period, maxR = x.renewal ? (x.renewal.max ?? Infinity) : 0;
  // walk renewal cycles: cycle k ends at endK
  const mo = u => u.unit === 'year' ? 12 * u.n : u.unit === 'month' ? u.n : null;
  const st = x.term.start ? new Date(x.term.start + 'T00:00:00Z') : null;
  const anchored = st && x.term.duration && mo(x.term.duration) != null && rp && mo(rp) != null && (x.term.rule === 'for' || x.term.rule === 'until');
  // cycle k end: computed from the start date (not re-added from a clamped end) so 29 Feb / month-end anchors don't drift
  const endOf = (k) => k === 0 ? end0 : anchored ? addDays(anniv(st, { n: mo(x.term.duration) + k * mo(rp), unit: 'month' }), x.term.rule === 'until' ? 0 : -1) : addDays(addDuration(addDays(end0, 1), { n: rp.n * k, unit: rp.unit }), -1);
  const np = x.notice?.period;
  const actByOf = (e0) => { if (!np) return null; const e = x.notice?.ref === 'start' ? addDays(e0, 1) : e0; if (np.full && np.unit === 'month') { const last = addDays(e, 1).getUTCDate() === 1 ? e : new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), 0)); return new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - np.n + 1, 0)); }
    if (!np.business) return addDuration(e, np, -1); let d = e, n = np.n; while (n > 0) { d = addDays(d, -1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n--; } return d; };
  if (x.notice?.initialOnly && x.renewal && rp && actByOf(end0) < as) {
    items.push({ type: 'Renews (no later notice window)', initialOnlyPassed: true, prevActBy: ymd(actByOf(end0)), renewEvery: { n: rp.n, unit: rp.unit }, date: '', confidence: 'medium', needsReview: true, why: `Send-notice date passed (${fmtD2(ymd(actByOf(end0)))}). Now renews every ${plural(rp.n, rp.unit)}; the contract gives no non-renewal notice for later periods. Check the termination section.`, source: x.notice.source });
    return items;
  }
  let k = 0, status = '';
  if (x.renewal && rp) {
    while (k < Math.min(maxR, 500)) { const a = actByOf(endOf(k)); if ((a || endOf(k)) >= as) break; k++; }
    if (k >= maxR && (k > 0 || (actByOf(endOf(k)) || endOf(k)) < as)) status = 'final';
  }
  const end = endOf(k), actBy = actByOf(end);
  const projected = k > 0;
  const last = x.renewal && rp && Number.isFinite(maxR) ? endOf(maxR) : null;
  const projNote = projected ? ` Assumes it renewed ${k === 1 ? 'once' : k + ' times'} (first term ended ${x.term.end}) and was never terminated or amended.` : '';
  const expired = !x.renewal ? end < as : (status === 'final' && end < as);
  if (x.renewal && status === 'final' && end < as) {
    items.push({ type: 'Expired (all renewals used)', date: ymd(end), confidence: termConf === 'high' ? 'medium' : termConf, needsReview: termRev || (as - end > 365 * 864e5), why: `All ${maxR} permitted renewal(s) have run; the agreement expired on ${ymd(end)} unless it was amended or extended. No notice is due.${as - end > 365 * 864e5 ? ' It expired over a year ago after renewing; check the renewal cap and any extension before relying on this.' : ''}`, source: x.renewal.source || x.term.source, status: 'past' });
    return items;
  }
  // Last permitted renewal already locked in: nothing left to send, the agreement simply expires.
  if (x.renewal && rp && status === 'final' && k > 0 && end >= as) {
    const prev = actByOf(endOf(k - 1));
    if (prev) items.push({ type: 'Send-notice deadline (passed)', date: ymd(prev), confidence: termConf === 'high' ? 'medium' : termConf, needsReview: false, why: `The send-notice date for the term ending ${ymd(endOf(k - 1))} passed on ${ymd(prev)}, so it took its last permitted renewal.`, source: x.notice?.source || x.renewal.source, status: 'past' });
    items.push({ type: 'Final term ends (no further renewal)', date: ymd(end), finalTerm: true, prevActBy: prev ? ymd(prev) : '', confidence: termConf === 'high' ? 'medium' : termConf, needsReview: termRev, why: `Send-notice date passed (${fmtD2(ymd(prev || end))}). Extended to ${fmtD2(ymd(end))}, then it expires; no further renewal.`, source: x.renewal.source });
    return items;
  }
  // The term running on the as-of date can be earlier than the cycle the next decision applies to (notice already missed for it).
  let kc = 0; if (x.renewal && rp) while (kc < k && endOf(kc) < as) kc++;
  // Missed window: the running term's notice date passed, it has not renewed yet, and no later send-notice deadline falls before that renewal.
  const renewOn = x.renewal && rp ? addDays(endOf(kc), 1) : null;
  // Also when the running term's deadline passed in the last 90 days, even if the next send-notice date comes before that renewal (short renewal periods, e.g. monthly).
  const recentMiss = kc < k && renewOn && (as - actByOf(endOf(kc))) <= 90 * 864e5 && actByOf(endOf(kc)) >= addDuration(endOf(kc), rp, -1);
  const missedWindow = kc < k && renewOn && actBy && (actBy >= renewOn || recentMiss) ? { actBy: ymd(actByOf(endOf(kc))), renews: ymd(renewOn) } : null;
  const skipped = []; for (let j = kc + 1; j < k; j++) skipped.push(ymd(endOf(j)));
  if (missedWindow) items.push({ type: 'MISSED send-notice deadline', date: missedWindow.actBy, missed: true, status: 'missed', confidence: termConf === 'high' ? 'medium' : termConf, needsReview: true, why: `MISSED: the send-notice deadline for the term ending ${ymd(endOf(kc))} passed on ${missedWindow.actBy}, so the contract renews automatically on ${missedWindow.renews} unless the other side agrees to end it. The next send-notice deadline is ${ymd(actBy)}.`, source: x.notice?.source || x.term.source });
  if (kc < k) items.push({ missedWindow, type: kc > 0 ? 'Current term ends (projected)' : 'Initial term ends', date: ymd(endOf(kc)), confidence: kc > 0 && termConf === 'high' ? 'medium' : termConf, needsReview: termRev || x.renewal.needsReview, why: `The term running on the as-of date. Its non-renewal deadline (${ymd(actByOf(endOf(kc)))}) has already passed, so it renews; the next decision below applies to the following term.`, source: x.term.source });
  items.push({ type: kc < k ? 'First term you can still stop (projected)' : projected ? 'Current term ends (projected)' : 'Initial term ends', date: ymd(end), confidence: projected && termConf === 'high' ? 'medium' : termConf, needsReview: termRev || (x.renewal ? x.renewal.needsReview : false), why: x.term.why + projNote + (skipped.length ? ` The term${skipped.length > 1 ? 's' : ''} ending ${skipped.join(', ')} renew${skipped.length > 1 ? '' : 's'} automatically: the notice window has already passed.` : '') + (last ? ` Final possible expiry if all renewals run: ${ymd(last)}.` : ''), source: x.term.source, status: expired ? 'past' : '' });
  if (x.renewal) {
    if (!rp) items.push({ type: 'Auto-renewal', date: '', confidence: 'none', needsReview: true, why: x.renewal.why, source: x.renewal.source });
    else items.push({ type: 'Auto-renewal', date: ymd(addDays(endOf(kc), 1)), confidence: x.renewal.confidence, needsReview: x.renewal.needsReview, why: x.renewal.why, source: x.renewal.source, status: k >= maxR ? 'no further renewals' : '' });
    const nRev = x.notice?.needsReview || termRev || x.renewal.needsReview;
    if (x.notice?.date) items.push({ type: 'Send-notice deadline', date: x.notice.date, actBy: true, confidence: x.notice.confidence, needsReview: x.notice.needsReview, why: x.notice.why, source: x.notice.source, status: x.notice.date < asOf ? 'past' : '' });
    else if (actBy) {
      const c = [x.notice.confidence, termConf, x.renewal.confidence, projected ? 'medium' : 'high'];
      if (x.notice.via) c.push('medium');
      // A dated send-notice deadline is never 'none': at worst 'low' (the date is computed, the inputs need review).
      const conf = c.includes('none') || c.includes('low') ? 'low' : c.includes('medium') ? 'medium' : 'high';
      items.push({ type: 'Send-notice deadline', date: ymd(actBy), actBy: true, who: x.notice.who, within: !!x.notice.withinPrior, withinText: x.notice.withinText || '', via: x.notice.via, confidence: conf, needsReview: nRev || !!x.notice.via || conf === 'low', termEnd: ymd(end), notice: { n: np.n, unit: np.unit }, renewed: k, prevActBy: k > 0 ? ymd(actByOf(endOf(k - 1))) : '', prevRenewedOn: k > 0 ? ymd(addDays(endOf(k - 1), 1)) : '', initialEnd: x.term.end, why: `${x.notice.why} Worked out as ${ymd(end)} minus ${plural(np.n, np.unit)}.${projNote}${x.warnings ? ' ' + x.warnings[0] : ''}${x.renewal.needsReview && /conditional/.test(x.renewal.why) ? ' ' + x.renewal.why.replace(/^.*?(Renewal is conditional)/, '$1') : ''}${x.term.why.includes(TEMPLATE_NOTE) ? TEMPLATE_NOTE : ''}`, source: x.notice.source, status: actBy < as ? 'past' : '' });
    } else items.push({ type: 'Send-notice deadline', date: '', confidence: 'none', needsReview: true, why: x.notice?.why || 'No notice period found.', source: x.notice?.source || null });
  }
  return items;
}

// Next calendar date for a fixed payment rule such as "1st of November, February, May and August" (on or after asOf).
export function nextFixed(rule, asOf) {
  const m = String(rule).match(/^1st of (.+)$/); if (!m) return '';
  const months = m[1].split(/,\s*|\s+and\s+/).map(w => MONTHS[w.trim().toLowerCase().slice(0, 3)]).filter(Boolean); if (!months.length) return '';
  const [y] = asOf.split('-').map(Number); const c = [];
  for (const yy of [y, y + 1]) for (const mo of months) { const d = ymd(mkDate(yy, mo, 1)); if (d >= asOf) c.push(d); }
  return c.sort()[0] || '';
}
export function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }

// Ranked send-notice deadline queue across contracts: upcoming send-notice deadline dates first (soonest), then needs-review, then past.
// Short plain reason for a needs-review item.
export const shortReason = (why = '') => /from signing; the signing date isn't/.test(why) ? 'term start (signing date) not in document' : /Renewal is conditional/.test(why) ? 'renewal depends on a condition; confirm it holds' : /^Evergreen/.test(why) ? (m => m ? `renews every ${+m[1] === 1 ? '' : m[1] + ' '}${m[2]}${+m[1] === 1 ? '' : 's'}, no notice clause` : 'renews until terminated, no notice clause')(why.match(/renews every (\d+) (\w+?)s?\b/)) : /Not a redaction/.test(why) ? (/Commencement/.test(why) ? 'term runs from an undated Commencement Date' : 'term start not dated in the document') : /redact|blacked out/i.test(why) ? 'blacked out in the public copy' : /No term (?:clause|length) found/i.test(why) ? 'no term found' : /event \(e\.g/i.test(why) ? 'term runs from an event' : /cross-reference|defers the notice/i.test(why) ? 'notice set by another section' : /first Renewal Term/i.test(why) ? 'unclear which term the notice counts from' : /inclusive of the final day/i.test(why) ? 'could land one day later' : /without saying before what/i.test(why) ? 'notice reference point not stated' : /Effective Date that needs review|no Effective Date/i.test(why) ? 'effective date not defined' : /disagree/i.test(why) ? 'words and numerals disagree' : /marks a template/.test(why) ? 'dates are in template brackets; confirm them' : /from the table at the top/.test(why) ? 'dates read from the table; confirm them' : /no non-renewal notice|No notice period/i.test(why) ? 'no notice period found' : /not cross-checked/i.test(why) ? 'stated date, term not found' : /amendment restates/.test(why) ? 'end date read from the clause this amendment restates; confirm it is current' : /the date given where that term is defined/.test(why) ? `term runs from ${(why.match(/Runs from the ([^(]+?) \((\d{4}-\d\d-\d\d)\)/) || [, 'a labelled date'])[1]} (${(why.match(/Runs from the [^(]+? \((\d{4}-\d\d-\d\d)\)/) || [, '?'])[1]}); confirm it` : /^Notice "not later than/.test(why) ? 'the notice date is a calendar day in the year before; confirm it' : /starts on an event/.test(why) ? 'the start date is set by an event and is not in the document' : /not tied/i.test(why) ? 'term start unclear' : (/[=−]|\d+\s*(?:day|month|year)\(s\)|end of the term minus|\bminus\b/i.test(why.split('.')[0]) ? 'confirm against the clause' : (why.split('.')[0] || 'confirm against the clause').slice(0, 60).toLowerCase());

const durMonths = p => !p ? 0 : p.unit === 'year' ? 12 * p.n : p.unit === 'month' ? p.n : p.unit === 'week' ? p.n / 4.35 : p.n / 30.44;
const lockText = p => { if (!p) return ''; const m = durMonths(p); return m >= 12 && m % 12 === 0 ? `${m / 12} more year${m / 12 > 1 ? 's' : ''}` : m >= 1 && Number.isInteger(m) ? `${m} more month${m > 1 ? 's' : ''}` : `another ${p.n} ${p.unit}${p.n > 1 ? 's' : ''}`; };
export const WINDOWS = [[0, 30, 'within 30 days'], [31, 90, '31–90 days'], [91, 365, '91–365 days'], [366, Infinity, 'over a year']];
export const PRIORITY_RULE = 'Order, top to bottom: 1) Missed: the send-notice deadline has passed but the contract has not renewed yet (soonest renewal first). 2) Due within 30 days: send-notice deadline today or in the next 30 days (soonest first). 3) Resolve first: needs review, no date could be found. 4) Later, in time bands: 31–90 days, 91–365, over a year. Inside a band, the bigger risk goes first even if its date is later: first a notice period longer than the renewal, then the longer renewal (2 years before 1 year), then the earlier date. Ties: name A–Z. 5) Expired contracts (nothing left to decide), collapsed at the bottom.';
const fmtW = d => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d + 'T00:00:00Z').getUTCDay()]} ${fmtD(d)}`;
const fmtD = d => { const [y, m, dd] = d.split('-'); return `${+dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y}`; };

// Ranked send-notice deadline queue with an explicit, deterministic priority rule (PRIORITY_RULE) and a one-line reason per row.

// ---------- calibration: "Sure" only when the date rests on explicit text and a second count agrees ----------
const ORDN = 'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\\d+(?:st|nd|rd|th)';
export function sureGate(x, row, asOf) {
  const t = x.term, ren = x.renewal, no = x.notice, rq = (ren?.source?.quote || '') + ' ' + (no?.source?.quote || '');
  if (!row.actBy) return '';
  // The deadline itself is written in the notice clause ("no later than December 31, 2027"): nothing to compute.
  { const [y, m, d] = row.actBy.split('-').map(Number); const MN = ['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1];
    if (no?.confidence === 'high' && new RegExp(`\\b${MN}\\s+${d}(?:st|nd|rd|th)?,?\\s+${y}\\b`).test(no?.source?.quote || '')) return ''; }
  // 1. start: an explicit date, not an event, an "anticipated" date or a separate Commencement / Start Date
  if (!t?.end) return 'no term end was read; the date comes from the renewal clause alone';
  const tq = t.source?.quote || '';
  const explicitEnd = /^Explicit end date/.test(t.why || '') && DATE_RES.some(re => re.test(tq));
  const statedStart = t.start && (t.rule === 'for' || (() => { const [y, m, d] = t.start.split('-').map(Number); const MN = ['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1]; return new RegExp(`\\b${MN}\\s+${d}(?:st|nd|rd|th)?,?\\s+${y}\\b`).test(tq); })());
  if (!explicitEnd && !statedStart) {
    if (!x.effective || x.effective.confidence !== 'high' || x.effective.needsReview) return 'the start date is not an expressly defined date';
    if (t.start && t.start !== x.effective.date && !DATE_RES.some(re => re.test(tq))) return 'the term starts on a different date from the Effective Date';
  }
  if (x.startConflict) return x.startConflict;
  // 2. one renewal rule, nothing left unparsed
  if (x.rolling && ymd(addDays(new Date(t.end + 'T00:00:00Z'), 1)) !== x.rolling.first) return 'the term end and the anniversary renewal rule give different first renewal dates';
  if (new RegExp(`\\bsuch\\s+(?:${ORDN})\\s+anniversary|\\b(?:each|every)\\s+subsequent\\b|\\bsubsequent\\s+${MONTH_RE}\\s+\\d|\\bfirst\\s+Renewal\\s+Term\\b|\\bafter\\s+the\\s+(?:${ORDN})\\s+(?:Renewal|anniversary)`, 'i').test(rq)) return 'the renewal wording has a qualifier (such as "such third anniversary" or "each subsequent") that was not fully read';
  if (ren?.max != null && Number.isFinite(ren.max)) return 'the number of renewals is capped; confirm how many have run';
  // 3. notice explicitly parsed
  if (!no?.period || no.confidence !== 'high' || no.cal) return 'the notice period was not read directly from the clause';
  // 4. a second, independent count: term end rolled forward by the renewal period, minus the notice
  const rp = ren?.period; if (!rp) return '';
  let end = new Date(t.end + 'T00:00:00Z'); const as = new Date(asOf + 'T00:00:00Z'); let k = 0;
  const dl = e => addDuration(no.ref === 'start' ? addDays(e, 1) : e, no.period, -1);
  while (dl(end) < as && k < 300) { end = addDays(addDuration(addDays(end, 1), rp), -1); k++; }
  const alt = ymd(dl(end));
  if (alt !== row.actBy) return `two ways of counting disagree (${row.actBy} and ${alt})`;
  return '';
}
export function buildQueue(contracts, asOf) {
  const rows = [];
  for (const c of contracts) {
    if (c.x.anyTimeExit && c.x.renewal) { const e = c.x.anyTimeExit, txt = `can be ended any time on ${plural(e.n, e.unit)}' notice, so no renewal deadline`; rows.push({ safe: null, tag: txt, id: c.id, name: c.name, actBy: '', days: null, missed: null, item: { type: 'Send-notice deadline', why: e.why, source: e.source, confidence: 'medium', needsReview: false }, section: 'resolve', window: -1, lockMonths: durMonths(c.x.renewal.period), noticeLong: false, why: `No renewal deadline · ${txt}`, label: 'Send-notice deadline', expired: false, needsReview: false, anyTimeExit: e, confidence: 'none' }); continue; }
    const items = schedule(c.x, asOf);
    const act = items.find(i => i.type === 'Send-notice deadline');
    const exp = items.find(i => i.finalTerm) || items.find(i => /term|Expired/i.test(i.type));
    const isExp = exp?.type.startsWith('Expired') || !!exp?.finalTerm;
    const mw = items.find(i => i.missedWindow)?.missedWindow;
    const key = act?.date || (!c.x.renewal || isExp ? exp?.date : '') || '';
    const d = key ? daysBetween(asOf, key) : null;
    const item = act || items.find(i => i.initialOnlyPassed) || exp;
    const rp = c.x.renewal?.period || null;
    const lockM = durMonths(rp), noticeLong = !!c.x.warnings?.length;
    const lapsed = d != null && d < 0;
    const section = mw ? 'missed' : lapsed ? 'lapsed' : !key ? 'resolve' : d <= 30 && act ? 'due' : 'upcoming';
    const win = section === 'upcoming' || section === 'due' ? WINDOWS.findIndex(([a, b]) => d >= a && d <= b) : -1;
    let why; const ion = items.find(i => i.initialOnlyPassed);
    if (ion) why = ion.why;
    else if (mw) { const ago = daysBetween(mw.actBy, asOf), inn = daysBetween(asOf, mw.renews); why = `MISSED: send-notice deadline passed ${ago} day${ago === 1 ? '' : 's'} ago · renews ${fmtD(mw.renews)} (in ${inn} day${inn === 1 ? '' : 's'}) for ${lockText(rp)} unless the other side agrees to end it · next send-notice deadline ${fmtD(key)}`; }
    else if (section === 'lapsed') why = isExp ? `Expired ${-d} day${d === -1 ? '' : 's'} ago · all renewals used; confirm a replacement is in place` : act ? `Notice date passed ${-d} day${d === -1 ? '' : 's'} ago · it has renewed or lapsed; check which` : `Expired ${-d} day${d === -1 ? '' : 's'} ago · no auto-renewal`;
    else if (section === 'resolve' && c.x.notice?.evergreen) { const cur = items.find(i => /term ends/i.test(i.type) && i.date); why = `No send-notice deadline: renews every ${c.x.renewal.period.unit} until terminated, and the contract has no notice clause${cur ? ` · current term ends ${fmtD(cur.date)}` : ''}`; }
    else if (section === 'resolve') why = `No date found · resolve first: ${shortReason(/No end date could be worked out/.test(item?.why || '') && exp ? exp.why : item?.why)}`;
    else if (section === 'due' && item?.within) { const o = safeSendBy(key, true).date; const od = daysBetween(asOf, o); why = `Send notice on ${fmtW(key)}, ${d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`}; the clause can be read two ways (see the note), and if nothing is sent it renews for ${lockText(rp) || 'another term'}`; void o; void od; }
    else if (section === 'due') why = `Due ${d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`} · send notice now or it renews for ${lockText(rp) || 'another term'}`;
    else if (act) why = `Deadline in ${d} day${d === 1 ? '' : 's'} · miss it and it renews for ${lockText(rp) || 'another term'}${noticeLong ? ' · notice is longer than the renewal, so this decides two cycles out' : ''}`;
    else if (exp?.finalTerm) why = `Send-notice date passed (${fmtD2(exp.prevActBy || key)}) · extended to ${fmtD2(key)}, then it expires; no further renewal`;
    else why = `Expires in ${d} day${d === 1 ? '' : 's'} · no auto-renewal, so plan the replacement`;
    const tfc = (c.x.other || []).find(o => /convenience/.test(o.kind) && o.notice?.n);
    // The check line names the assumption the date rests on (the start date) before anything else.
    const st0 = c.x.term?.start; const assume = !act || !key || !st0 || c.x.term.rule === 'explicit' ? '' : /read as the date of the agreement/.test(c.x.term.why || '') ? `start date assumed to be the agreement date (${fmtD(st0)}); confirm the term runs from it` : c.x.effective?.needsReview && st0 === c.x.effective.date && !c.x.term.table ? `start date ${fmtD(st0)} is taken from the "dated / as of" line, not a defined Effective Date; confirm it` : '';
    const generic = /^(?:confirm against the clause|effective date not defined)$/.test(shortReason(item?.why));
    const termNote = act && key && generic && /amendment restates|the date given where that term is defined/.test(c.x.term?.why || '') ? shortReason(c.x.term.why) : '';
    const tag = termNote || (assume && (generic || tfc) ? assume : item?.needsReview && act && key && tfc ? `a separate ${tfc.notice.n}-${tfc.notice.unit} early-exit clause exists; confirm which applies` : shortReason(!key && /No end date could be worked out/.test(item?.why || '') && exp ? exp.why : item?.why));
    const sb = act && key && d != null && d >= 0 ? safeSendBy(key, !!item?.within) : null;
    const safe = sb?.changed && item?.within ? { date: key, reason: sb.reason, within: true, twoReadings: true, note: `${sb.reason} · needs review: two readings` } : sb?.changed ? (sb.date < asOf ? { date: sb.date, reason: sb.reason, passed: true, note: `${sb.reason}. The last business day before it (${fmtW(sb.date)}) has passed. Send today and confirm delivery.` } : { date: sb.date, reason: sb.reason, note: `${sb.reason} · send by ${fmtW(sb.date)} to be safe` }) : null;
    const hint = !c.x.renewal && c.x.renewHint && !act;
    const noRenGuard = !hint && !act && (!isExp || !!exp?.finalTerm) && c.x.renewWords && !!key; // renewal wording present, yet the card says it just ends
    rows.push({ renewHint: hint ? c.x.renewHint.text : '', safe, tag: noRenGuard ? 'the document has renewal or extension wording, but this date assumes no further automatic renewal; check it' : hint ? (c.x.renewHint.other ? 'the only renewal wording found is for a letter of credit, deposit or policy; confirm the agreement itself does not renew' : 'the document mentions renewal or extension, but no automatic renewal was read; check it') : (exp?.finalTerm && !act) || ion ? '' : tag, id: c.id, name: c.name, actBy: key, days: d, missed: mw || null, item, section, window: win, lockMonths: lockM, noticeLong, why, label: ion ? 'Send-notice date passed' : mw ? 'Next send-notice deadline' : act ? 'Send-notice deadline' : exp?.finalTerm ? 'Expires (no further renewal)' : isExp ? 'Expired (all renewals used)' : 'Expires', expired: !!isExp, needsReview: !key || !!item?.needsReview || hint || noRenGuard, confidence: key ? (item?.confidence === 'none' ? 'low' : (hint || noRenGuard) && item?.confidence === 'high' ? 'medium' : item?.confidence || 'low') : 'none' });
  }
  for (const row of rows) if (row.safe?.twoReadings || (row.item?.within && row.actBy && !row.missed)) { row.tag = 'two readings'; row.needsReview = true; }
  for (const row of rows) { if (row.confidence !== 'high') continue; const c = contracts.find(c => c.id === row.id); const why = c && sureGate(c.x, row, asOf);
    if (why) { row.confidence = 'medium'; row.needsReview = true; row.calibration = why; row.tag = row.tag && !/^confirm against the clause$/.test(row.tag) ? row.tag + '; also ' + why : why; } }
  // Days left count to the day notice actually goes out: a weekend or holiday deadline moves back to the business day before
  for (const row of rows) if (row.safe && !row.safe.passed && !row.safe.within && row.days != null && row.days >= 0) row.days = daysBetween(asOf, row.safe.date);
  const sec = { missed: 0, due: 1, resolve: 2, upcoming: 3, lapsed: 4 };
  rows.sort((a, b) => sec[a.section] - sec[b.section]
    || (a.section === 'missed' ? a.missed.renews.localeCompare(b.missed.renews) : 0)
    || (a.section === 'lapsed' ? b.days - a.days : 0)
    || (a.section === 'due' ? a.days - b.days : 0)
    || (a.section === 'upcoming' ? (a.window - b.window) || (b.noticeLong - a.noticeLong) || (b.lockMonths - a.lockMonths) || (a.days - b.days) : 0)
    || a.name.localeCompare(b.name));
  return rows;
}

// ---------- exports ----------
export const ZW = /[\u200b\u200c\u200d\u2060\ufeff]/g;
// Quote when needed; a cell starting with = + - @ tab or CR gets a ' prefix so spreadsheets never run it as a formula.
export const csvCell = v => { const s = String(v ?? '').replace(ZW, ''); const f = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s); return f || /[",\r\n]/.test(s) ? '"' + (f ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
export function toCSV(contracts, asOf, ctxOf = () => null) {
  const head = ['contract', 'filer', 'counterparty', 'item', 'who_acts', 'date', 'days_from_as_of', 'as_of', 'send_by_business_day', 'confidence', 'needs_review', 'reasoning', 'source_location', 'source_clause', 'source_url', 'owner', 'plan', 'note'];
  const out = [head.join(',')];
  for (const c of contracts) {
    for (const i of [...schedule(c.x, asOf), ...c.x.payments.map(p => ({ type: 'Payment: ' + p.rule, date: nextFixed(p.rule, asOf), who: '', confidence: p.confidence, needsReview: p.needsReview, why: nextFixed(p.rule, asOf) ? 'Next date on or after the as-of date from the fixed schedule in the clause.' : 'Event-driven or recurring; no single calendar date is stated.', source: p.source })), ...c.x.other.map(p => ({ type: 'Termination for convenience: ' + p.rule, date: '', who: p.who || 'Not stated', confidence: p.confidence, needsReview: p.needsReview, why: 'Right, not a deadline.', source: p.source }))]) {
      out.push([c.name, c.filer || '', c.counterparty || '', i.type, i.who || '', i.date, i.date ? daysBetween(asOf, i.date) : '', asOf, i.actBy && i.date && i.within ? i.date : i.actBy && i.date ? (sb => sb.changed && sb.date < asOf && i.date >= asOf ? `${sb.date} (passed; send today and confirm delivery)` : sb.date)(safeSendBy(i.date)) : '', sure(i.confidence), i.needsReview ? 'yes' : 'no', i.why, i.source?.location || '', i.source?.quote || '', c.url || '', ...(x => [x?.owner || '', x?.plan || '', x?.note || ''])(ctxOf(c))].map(csvCell).join(','));
    }
  }
  return out.join('\r\n') + '\r\n';
}
const icsEsc = s => String(s).replace(ZW, '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// RFC 5545 3.1: lines of at most 75 octets, folded with CRLF + space, never splitting a UTF-8 character.
export const fold = l => { const enc = new TextEncoder(); const o = []; let cur = '', n = 0, lim = 75;
  for (const ch of l) { const b = enc.encode(ch).length; if (n + b > lim) { o.push(cur); cur = ' '; n = 1; } cur += ch; n += b; }
  o.push(cur); return o.join('\r\n'); };
export function toICS(contracts, asOf, stamp = '20261019T000000Z') {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Contract Cliffs//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Contract Cliffs send-notice deadlines'];
  for (const c of contracts) for (const i of schedule(c.x, asOf)) {
    if (i.missed) { const r = schedule(c.x, asOf).find(t => t.missedWindow)?.missedWindow; if (r) { const d = r.renews.replace(/-/g, ''); const n = ymd(addDays(new Date(r.renews + 'T00:00:00Z'), 1)).replace(/-/g, ''); L.push('BEGIN:VEVENT', `UID:${c.id}-renews-${d}@contract-cliffs`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${n}`, fold(`SUMMARY:${icsEsc('MISSED: ' + c.name + ' renews today (send-notice deadline missed)')}`), fold(`DESCRIPTION:${icsEsc(missedText(i.date) + '. ' + i.why)}`), ...(c.url ? [fold(`URL:${c.url}`)] : []), 'END:VEVENT'); } continue; }
    if (!i.actBy || !i.date || i.status === 'past') continue;
    if (i.within && i.termEnd) { // "within N days prior": the event is the day the window opens; reminders only on or after it
      const sw = safeSendBy(i.date, true); const day = i.date; const d = day.replace(/-/g, ''); const n = ymd(addDays(new Date(day + 'T00:00:00Z'), 1)).replace(/-/g, ''); const left = daysBetween(day, i.termEnd); const per = `${i.notice?.n} ${i.notice?.unit}${i.notice?.n === 1 ? '' : 's'}`;
      L.push('BEGIN:VEVENT', `UID:${c.id}-${d}@contract-cliffs`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${n}`,
        fold(`SUMMARY:${icsEsc(`Window opens: send notice on ${fmtD(i.date)} (two readings): ${c.name}`)}`),
        fold(`DESCRIPTION:${icsEsc(`The clause says notice is given within ${i.notice?.n} ${i.notice?.unit}${i.notice?.n === 1 ? '' : 's'} before the term ends, so sending earlier may not count${i.withinText ? ` ("${i.withinText}")` : ''}. ${twoReadings({ start: i.date, end: i.termEnd, n: i.notice?.n, unit: i.notice?.unit, quote: i.withinText })}. ${i.why}${i.needsReview ? ' NEEDS REVIEW.' : ''} Confidence: ${sure(i.confidence)}. Source ${i.source?.location}: "${i.source?.quote}"`)}`),
        ...(c.url ? [fold(`URL:${c.url}`)] : []),
        // reminders 7 days before and on the one day that satisfies both readings; none after it
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P7D', fold(`DESCRIPTION:${icsEsc('7 days to the day that satisfies both readings: ' + c.name)}`), 'END:VALARM',
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT9H', fold(`DESCRIPTION:${icsEsc('Send notice today, the day that satisfies both readings: ' + c.name)}`), 'END:VALARM', 'END:VEVENT'); void left;
      continue;
    }
    const sb0 = safeSendBy(i.date); const late = sb0.changed && sb0.date < asOf; const sb = late ? { ...sb0, date: asOf } : sb0; const d = sb.date.replace(/-/g, ''); const n = ymd(addDays(new Date(sb.date + 'T00:00:00Z'), 1)).replace(/-/g, '');
    const sbNote = late ? `Contract date: ${i.date}, which ${sb0.reason.replace(/^Falls/, 'falls')}. The last business day before it (${sb0.date}) has passed. Send today and confirm delivery. ` : sb.changed ? `Contract date: ${i.date}, which ${sb.reason.replace(/^Falls/, 'falls')}; this event is on the last business day before it (${sb.date}). ` : `Contract date: ${i.date}. `;
    L.push('BEGIN:VEVENT', `UID:${c.id}-${d}@contract-cliffs`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${n}`,
      fold(`SUMMARY:${icsEsc('Send-notice deadline: ' + c.name)}`),
      fold(`DESCRIPTION:${icsEsc(`${sbNote}${i.why}${i.needsReview ? ' NEEDS REVIEW.' : ''} Confidence: ${sure(i.confidence)}. Source ${i.source?.location}: "${i.source?.quote}"`)}`),
      ...(c.url ? [fold(`URL:${c.url}`)] : []),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P30D', fold(`DESCRIPTION:${icsEsc('30 days to the send-notice deadline: ' + c.name)}`), 'END:VALARM', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}
const h = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
export function toPacket(contracts, asOf, ctxOf = () => null) {
  const rows = buildQueue(contracts, asOf);
  const body = contracts.map(c => {
    const its = schedule(c.x, asOf);
    const cx = ctxOf(c); const cxl = cx ? [cx.owner && 'Owner: ' + cx.owner, cx.plan && 'Plan: ' + cx.plan, cx.note && 'Note: ' + cx.note].filter(Boolean).join(' · ') : '';
    return `<section><h2>${h(c.name)}</h2>${cxl ? `<p class="ctx">${h(cxl)}</p>` : ''}<p class="m">${h(c.title || '')}${c.filer ? ' · filed by ' + h(c.filer) : ''}${c.filed ? ' · filed ' + h(c.filed) : ''}</p>${c.url ? `<p><a href="${h(c.url)}">${h(c.url)}</a></p>` : '<p class="m">Uploaded document (no public source).</p>'}<table>${its.map(i => `<tr><td>${h(i.type)}</td><td>${h(i.date || 'needs review')}</td><td>${h(sure(i.confidence))}${i.needsReview ? ' · needs review' : ''}</td><td><q>${h(i.source?.quote || '')}</q><br><small>${h(i.source?.location || '')}</small></td></tr>`).join('')}</table></section>`;
  }).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Audit pack · Contract Cliffs · as of ${h(asOf)}</title><style>body{font:14px/1.7 Geist,Arial,sans-serif;color:#000;max-width:960px;margin:48px auto;padding:0 20px}h1{font-weight:500;text-transform:lowercase}h2{font-weight:500;margin-top:48px}.m,small{color:#666}table{border-collapse:collapse;width:100%}td{border-top:.5px solid #4d4d4d;padding:8px 6px;vertical-align:top}</style><h1>contract cliffs</h1><p class="m">Audit pack · ${contracts.length} contracts · as of ${h(asOf)} · generated by deterministic extraction; every date shows its source clause. Blank dates need human review.</p><h2>Send-notice deadlines, most urgent first</h2><table>${rows.map(r => r.missed ? `<tr class="missed"><td>${h(r.name)}</td><td><b>MISSED</b> · send-notice deadline was ${h(r.missed.actBy)}</td><td>Renews ${h(r.missed.renews)}</td><td>in ${daysBetween(asOf, r.missed.renews)} days · next send-notice deadline ${h(r.actBy)}</td></tr>` : `<tr><td>${h(r.name)}</td><td>${h(r.label)}</td><td>${h(r.actBy || 'needs review')}</td><td>${r.days == null ? '' : r.days + ' days'}</td></tr>`).join('')}</table>${(() => { const aff = rows.filter(r => r.safe); return aff.length ? `<h2>Deadlines that fall on a weekend or US federal holiday</h2><ul>${aff.map(r => `<li>${h(r.name)}: contract date ${h(r.actBy)} · ${r.safe.passed ? h(r.safe.note) : `${h(r.safe.reason)} · send by ${h(r.safe.date)} to be safe.`}</li>`).join('')}</ul><p class="m">Weekends and US federal holidays flagged; local holidays not modelled.</p>` : ''; })()}${body}</html>`;
}
