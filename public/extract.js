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
export const DURATION_RE = new RegExp(`((?:${NUMWORD_RE})?\\s*(?:\\(\\s*\\d+\\s*\\))?|\\d+|${REDACT_RE})\\s*(?:consecutive\\s+)?(?:calendar\\s+|business\\s+)?(day|month|year|week)s?(?:['’]s?)?`, 'i');

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
  // 2026-04-27
  /(\d{4})-(\d{2})-(\d{2})/,
];
export function parseDate(text) {
  let best = null;
  DATE_RES.forEach((re, k) => {
    const m = text.match(re); if (!m) return;
    let y, mo, d;
    if (k === 0) { mo = MONTHS[m[1].toLowerCase().replace('.', '').slice(0, m[1].toLowerCase().startsWith('sept') ? 4 : 3)]; d = +m[2]; y = +m[3]; }
    else if (k === 1) { d = +m[1]; mo = MONTHS[m[2].toLowerCase().replace('.', '').slice(0, 3)]; y = +m[3]; }
    else { y = +m[1]; mo = +m[2]; d = +m[3]; }
    const dt = mo ? mkDate(y, mo, d) : null;
    if (dt && (!best || m.index < best.index)) best = { date: dt, index: m.index, text: m[0] };
  });
  return best;
}

// ---------- document model ----------
// doc = { lines: [{text, page?}] } -> sentences with source locations
const ABBR = /\b(?:Inc|Corp|Co|Ltd|LLC|No|Nos|Sec|St|Mr|Ms|Dr|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec|U\.S|e\.g|i\.e|etc|vs)\.$/i;
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
    if (t.length < 45 && !/[,;(“"]$|\b(?:of|the|and|or|to|for|a|an|in|by|shall|will|may|must|is|are|be|has|have|with|from|that|this)$/i.test(t) && /^[A-Z0-9“"(]/.test(nt) && !/[.:;]$/.test(t)) breaks.add(buf.length);
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
const src = (s) => s ? { quote: s.text, lineStart: s.lineStart, lineEnd: s.lineEnd, page: s.page, location: locLabel(s) } : null;

// ---------- extraction ----------
export function extract(lines) {
  const S = toSentences(lines);
  const res = { effective: null, term: null, renewal: null, notice: null, payments: [], other: [], reviewNotes: [] };

  // 1. Effective date
  const effRe = /(?:made\s+(?:and\s+is\s+)?effective\s+as\s+of|entered\s+into\s+(?:effective\s+)?as\s+of|is\s+effective\s+as\s+of|is\s+made\s+on|dated\s+as\s+of|dated\s+and\s+effective\s+as\s+of|effective\s+as\s+of|dated|made\s+and\s+entered\s+into\s+as\s+of|made\s+as\s+of)\s+(?:this\s+|the\s+)?/i;
  for (const pass of [true, false]) { if (res.effective) break;
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
  const termCands = S.filter(s => /\b(initial\s+(term|license\s+period|period)|the\s+term\s+of\s+this|remain\s+in\s+effect|agreement\s+shall\s+have\s+an?\s+[\w()-]+\s+term|have\s+a\s+term|shall\s+commence|shall\s+begin\s+on)/i.test(s.text) && !/automatically\s+(renew|extend)/i.test(s.text.slice(0, 40)) && !/^\W{0,3}[“"][^”"]{1,60}[”"]\s+(?:means|has\s+the\s+meaning|shall\s+mean)/i.test(s.text) && !/following\s+(?:the\s+)?(?:termination|expiration)|surviv/i.test(s.text));
  // A clearly-worded initial-term sentence beats an earlier passing mention of "the term" (e.g. a redacted forecast clause).
  const decFirst = termCands.find(s => /\buntil\s+December\s+31(?:st)?\s+of\s+the\s+(?!\d)/i.test(s.text) && /Initial\s+Term/.test(s.text));
  for (const s of decFirst ? [decFirst, ...termCands.filter(x => x !== decFirst)] : termCands) {
    const t = s.text;
    let range = t.match(new RegExp(`(${MONTH_RE}\\s+\\d{1,2},?\\s*\\d{4})\\s*[–—-]+\\s*(${MONTH_RE}\\s+\\d{1,2},?\\s*\\d{4})`, 'i'));
    if (range && /period|term/i.test(t)) {
      const a = parseDate(range[1]), b = parseDate(range[3]);
      res.term = { start: ymd(a.date), end: ymd(b.date), confidence: 'high', needsReview: false, why: 'Explicit start and end dates.', source: src(s), rule: 'explicit' };
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
    const ann = t.match(/\b(?:through|until)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+anniversary\s+of\s+the\s+Effective\s+Date/i);
    if (ann && res.effective) {
      const n = ['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth'].indexOf(ann[1].toLowerCase()) + 1;
      res.term = { start: res.effective.date, end: ymd(addMonths(new Date(res.effective.date + 'T00:00:00Z'), 12 * n)), duration: { n, unit: 'year', text: ann[0] }, confidence: res.effective.needsReview ? 'medium' : 'high', needsReview: !!res.effective.needsReview, why: `"${ann[0]}": the term runs through the anniversary date itself.`, source: src(s), rule: 'anniversary' };
      break;
    }
    const thr = t.match(/\b(?:through|until|shall\s+end(?:\s+on)?)\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4})/i);
    if (thr) {
      const b = parseDate(thr[1]); const st = t.match(/\b(?:begin|commence)s?\s+on\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4})/i);
      res.term = { start: st ? ymd(parseDate(st[1]).date) : (res.effective?.date || ''), end: ymd(b.date), confidence: 'high', needsReview: false, why: 'Explicit end date.', source: src(s), rule: 'explicit' };
      break;
    }
    const m = t.match(/\bterm\s+of\s+this\s+(?:agreement|contract)\s+(?:shall\s+be|is)\s+(.{0,60})/i) || t.match(/\bagreement\s+shall\s+have\s+an?\s+((?:[\w]+[\s-])?(?:\(\d+\)[\s-])?(?:year|month)s?[\s-]term.{0,40})/i) || t.match(/\b(?:for|run\s+for|continues?\s+for|period\s+of|shall\s+expire|remain\s+in\s+effect\s+(?:for|until))\s+(?:a\s+period\s+of\s+|an?\s+initial\s+(?:term|period)\s+of\s+|an?\s+initial\s+|an?\s+)?(.{0,60})/i);
    if (!m) continue;
    const dur = parseDuration(m[1]);
    if (!dur || dur.index > 3) {
      if (new RegExp(REDACT_RE).test(m[1].slice(0, 12))) {
        res.term = { start: res.effective?.date || '', end: '', confidence: 'none', needsReview: true, why: 'Term length is blacked out in the public copy ([***]). Expiry cannot be computed.', source: src(s) };
        break;
      }
      continue;
    }
    if (dur.redacted) { res.term = { start: res.effective?.date || '', end: '', confidence: 'none', needsReview: true, why: 'Term length is blacked out in the public copy.', source: src(s) }; break; }
    const evt = /(?:years?|months?)\)?\s+(?:from|after|following)\s+(?!the\s+Effective\s+Date|Effective\s+Date)(?:the\s+)?(?:date\s+(?:of\s+|on\s+which\s+|that\s+)?)?(?:the\s+)?[A-Z“"]/.test(t);
    const fromEff = /effective\s+date/i.test(t) && !evt;
    const until = /\buntil\b[^.]{0,40}following/i.test(t);
    const start = res.effective ? new Date(res.effective.date + 'T00:00:00Z') : null;
    let end = '', why, conf = 'high', review = false;
    if (!fromEff) { if (!res._fallback) res._fallback = { start: res.effective?.date || '', end: '', duration: { n: dur.n, unit: dur.unit, text: dur.text }, confidence: 'low', needsReview: true, why: `Term length "${dur.text}" found, but ${evt ? 'it runs from an event (e.g. launch or regulatory approval) rather than' : 'its start point is not tied to'} the Effective Date. Expiry not computed.`, source: src(s) }; continue; }
    else if (!start) { conf = 'low'; review = true; why = 'Term runs from the Effective Date, which was not found.'; }
    else if (until) { end = ymd(anniv(start, dur)); why = `"Until ${dur.text} following the Effective Date": expiry = the anniversary date.`; }
    else { end = ymd(addDays(anniv(start, dur), -1)); why = `${dur.n} ${dur.unit}(s) commencing on the Effective Date: last day of term = anniversary minus one day.`; }
    if (start && start.getUTCMonth() === 1 && start.getUTCDate() === 29 && end) { review = true; if (conf === 'high') conf = 'medium'; why += ' The term starts on 29 February; anniversaries in non-leap years are read as 1 March (so the term ends 28 February). Confirm.'; }
    if (dur.conflict) { conf = 'low'; review = true; why = `Words and numerals disagree in "${dur.text}".`; }
    if (res.effective?.needsReview && conf === 'high') { conf = 'medium'; review = true; why += ' Depends on an Effective Date that needs review.'; }
    const nxt = S[S.indexOf(s) + 1]?.text || '';
    if (/notwithstanding[^.]{0,500}automatically\s+extend/i.test(nxt) && end) { review = true; if (conf === 'high') conf = 'medium'; why += ' The next sentence can extend the term automatically on a condition; confirm whether it applies.'; }
    res.term = { start: res.effective?.date || '', end, duration: { n: dur.n, unit: dur.unit, text: dur.text }, confidence: conf, needsReview: review, why, source: src(s), rule: until ? 'until' : 'for' };
    break;
  }

  if (!res.term && res._fallback) res.term = res._fallback; delete res._fallback;
  // 3. Renewal + 4. notice
  const isRen = s => /automatically\s+(renew|extend)|renew\s+automatically|automatic(ally)?\s+renewal/i.test(s.text) && /renew|(?:term|agreement)[^.]{0,40}automatically\s+extend/i.test(s.text) && !/prevent\s+such/i.test(s.text.slice(0, 20));
  let ri = S.findIndex(s => isRen(s) && /automatically\s+renew|renew\w*\s+automatically/i.test(s.text)); if (ri < 0) ri = S.findIndex(isRen);
  if (ri >= 0) {
    const s = S[ri], t = s.text;
    const upTo = t.match(/up\s+to\s+(\w+)\s+(?:\(\d+\)\s+)?(?:additional\s+)?(?:successive\s+)?(?:periods?|terms?|renewal)?/i);
    let max = null;
    if (upTo) { const n = /^\d+$/.test(upTo[1]) ? +upTo[1] : wordsToNumber(upTo[1]); if (n != null) max = n; }
    const kT = max == null && t.match(/successive\s+(two|three|four|five|\d)\s+terms\s+of/i); if (kT) max = /^\d$/.test(kT[1]) ? +kT[1] : wordsToNumber(kT[1]);
    const rm = t.match(/(?:successive|additional|renewal)\s+(?:successive\s+)?(?:terms?\s+of\s+|periods?\s+of\s+)?(.{0,70})/i) || t.match(/periods?\s+of\s+(.{0,60})/i);
    let dur = null;
    const tries = [];
    const rt = t.slice(t.search(/automatically|renew/i));
    for (const re of [/successive\s+(?:periods?|terms?)\s+of\s+(.{0,50})/i, /(?:successive|consecutive)\s+(.{0,50})/i, /additional\s+(?:successive\s+)?(?:term\s*\(.*?\)\s*of\s+)?(.{0,60})/i, /periods?\s+of\s+(.{0,50})/i, /\bterm\s*\([^)]*\)\s*of\s+(.{0,60})/i, /\bterms?\s+of\s+(.{0,50})/i]) {
      const mm = rt.match(re); if (mm) { const d = parseDuration(mm[1]); if (d && d.index <= 2) { dur = d; break; } tries.push(mm[1]); }
    }
    if ((!dur || dur.index > 2) && /year\s+to\s+year/i.test(t) && !/successive\s+one\s*\(1\)\s*year/i.test(t)) dur = { n: 1, unit: 'year', text: 'year to year' };
    let review = false, why = '', conf = 'high';
    if (!dur) { review = true; conf = 'none'; why = 'Auto-renewal found, but renewal length could not be read.'; }
    else if (dur.redacted) { review = true; conf = 'none'; why = 'Renewal length is blacked out in the public copy.'; }
    else why = `Renews for successive ${dur.n} ${dur.unit}(s)${max != null ? `, at most ${max} time(s)` : ''}.`;
    const cond = rt.split(/\bunless\b/i)[0].match(/\b(?:if|provided\s+that|so\s+long\s+as|as\s+long\s+as)\s+[^,.;]{3,90}/i);
    if (cond && dur && !dur.redacted) { review = true; conf = 'medium'; why += ` Renewal is conditional ("${cond[0].trim()}"); confirm the condition holds before relying on these dates.`; }
    res.renewal = { auto: true, period: dur && !dur.redacted ? { n: dur.n, unit: dur.unit, text: dur.text } : null, max, confidence: conf, needsReview: review, why, source: src(s) };

    // notice: same sentence, else the next two sentences
    const xrefFirst = /(?:notice|notif)[^.]{0,160}?(?:pursuant\s+to|in\s+accordance\s+with|as\s+(?:set\s+forth|provided|described)\s+in|under)\s+(?:Section|§)\s*\d/i.test(t) && !/\d+\s*\)?\s*(?:calendar\s+|business\s+)?(?:days?|months?)/i.test(t);
    for (const cand of (xrefFirst ? [] : [S[ri], S[ri + 1], S[ri + 2], S[ri - 1]]).filter(Boolean)) {
      const ct = cand.text;
      if (!/notice|notif/i.test(ct)) continue;
      const nm = ct.match(new RegExp(`(?:at\\s+least|not\\s+less\\s+than|no\\s+less\\s+than|no\\s+later\\s+than|on\\s+or\\s+before\\s+the\\s+day\\s+that\\s+is|within)?\\s*((?:${NUMWORD_RE})?\\s*(?:\\(\\s*\\d+\\s*\\))?|\\d+|${REDACT_RE})\\s*(?:calendar\\s+|business\\s+)?(days?|months?|years?)['’]?s?\\s+(?:prior|before|in\\s+advance)`, 'i'));
      const bare = !nm && ct.match(new RegExp(`((?:${NUMWORD_RE})?\\s*(?:\\(\\s*\\d+\\s*\\)|\\d+)?)\\s*(days?|months?)['’]?s?\\s+(?:prior\\s+)?(?:written\\s+)?notice\\s+of\\s+(?:non-?renewal|its\\s+intent)`, 'i'));
      const redactedBefore = ct.match(new RegExp(`${REDACT_RE}\\s+(?:prior|before)`, 'i'));
      const byDate = !nm && !redactedBefore && ct.match(/\b(?:by|on\s+or\s+before)\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4})/i);
      if (byDate) { res.notice = { period: null, date: ymd(parseDate(byDate[1]).date), confidence: 'high', needsReview: false, why: `The clause states the notice deadline as a calendar date ("${byDate[0]}"); shown as written, not computed.`, source: src(cand) }; break; }
      if (!nm && !redactedBefore && bare) { const d = parseDuration(bare[0]); if (d && d.n) { res.notice = { period: { n: d.n, unit: d.unit, text: d.text }, confidence: 'medium', needsReview: true, why: `The send-notice deadline is the end of the term minus ${d.n} ${d.unit}(s). The clause gives "${d.text} notice" without saying before what; measured back from the end of the term (the usual reading). Confirm.`, source: src(cand) }; break; } }
      if (!nm && !redactedBefore) continue;
      const d = nm ? parseDuration(nm[1].trim() + ' ' + (/business\s+(?:days?)\b/i.test(nm[0]) ? 'business ' : '') + nm[2]) : { redacted: true, text: redactedBefore[0] };
      let nconf = 'high', nreview = false, nwhy;
      if (!d || d.redacted || d.n == null) { nconf = 'none'; nreview = true; nwhy = d?.redacted ? 'Notice period is blacked out in the public copy. Send-notice deadline date cannot be computed.' : `Notice length in "${(nm?.[0] || '').trim().slice(0, 60)}" could not be read. Send-notice deadline date cannot be computed.`; }
      else {
        nwhy = `The send-notice deadline is the end of the term minus ${d.n} ${d.unit}(s).`;
        if (d.business) { nconf = 'medium'; nreview = true; nwhy = `The send-notice deadline is the end of the term minus ${d.n} business days (Saturdays and Sundays skipped; public holidays are not modelled, so check the calendar).`; }
        if (d.conflict) { nconf = 'low'; nreview = true; nwhy = `Words and numerals disagree in "${d.text}".`; }
        if (/first\s+renewal\s+term/i.test(ct) && !/initial\s+term/i.test(ct.split(/notice/i)[1] || '')) { nconf = 'low'; nreview = true; nwhy += ' Clause measures notice from "the end of the first Renewal Term", not the Initial Term. It is unclear which term the notice counts from.'; }
        if (/at\s+least|not\s+less|no\s+less/i.test(nm?.[0] || '')) nwhy += ' "At least / not less than": send on or before this date.';
        if (/inclusive\s+of\s+the\s+final\s+day/i.test(ct)) { nconf = 'medium'; nreview = true; nwhy += ' Clause adds "inclusive of the final day", so the count could land one day later; the earlier (safer) date is shown. Confirm with counsel.'; }
      }
      res.notice = { period: d && !d.redacted && d.n != null ? { n: d.n, unit: d.unit, text: d.text, business: !!d.business } : null, confidence: nconf, needsReview: nreview, why: nwhy, source: src(cand) };
      break;
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
      if (found) res.notice = { period: { n: found.d.n, unit: found.d.unit, text: found.d.text }, confidence: 'medium', needsReview: true, why: `The send-notice deadline is the end of the term minus ${found.d.n} ${found.d.unit}(s). The renewal clause sends notice to Section ${xr[1]} by cross-reference; that section (quoted) gives ${found.d.text}. Confirm it governs non-renewal.`, source: src(found.x), via: src(cand) };
      else res.notice = { period: null, confidence: 'none', needsReview: true, why: `The renewal clause defers the notice to Section ${xr[1]}${sec.length ? ', quoted here, which states no notice length' : ', which is not in this document'}. No send-notice deadline computed.`, source: sec.length ? src(sec[0]) : src(cand), via: src(cand) };
      break;
    }
    if (!res.notice) res.notice = /unless\s+and\s+until\s+terminated/i.test(t) && res.renewal.period ? { period: null, confidence: 'none', needsReview: true, evergreen: true, why: `Evergreen: renews every ${res.renewal.period.n} ${res.renewal.period.unit} "unless and until terminated", and the contract states no non-renewal notice period, so there is no send-notice deadline date. To exit, use its termination clause.`, source: src(s) } : { period: null, confidence: 'none', needsReview: true, why: 'Auto-renews, but no non-renewal notice period was found near the renewal clause.', source: src(s) };
    const nq = res.notice.source?.quote || '';
    res.notice.who = /either\s+party|each\s+party|either\s+of\s+the\s+parties/i.test(nq) ? 'Either party' : (nq.match(/\b([A-Z][A-Za-z&.]+(?:\s+[A-Z][A-Za-z&.]+)?)\s+(?:may|shall|must)\s+(?:give|provide|deliver|notify)/)?.[1] || 'Not stated');
    const days = p => !p ? 0 : p.unit === 'year' ? p.n * 12 * 30.44 : p.unit === 'month' ? p.n * 30.44 : p.n * ({ day: 1, week: 7 })[p.unit]; // months and years compared in months, so 24 months == 2 years
    if (res.notice.period && res.renewal.period && days(res.notice.period) > days(res.renewal.period)) {
      res.warnings = [`Notice period (${res.notice.period.text}) is longer than each renewal (${res.renewal.period.text}): the decision for a cycle falls before the previous cycle has even started. Calendar it at least two cycles ahead.`];
      res.reviewNotes.push(res.warnings[0]);
    }
  }

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
    const why = (who ? `Held by ${/either|each/i.test(who) ? 'either party' : who}. ` : 'Holder not identified; read the clause. ') + 'A right, not a deadline.' + (d && d.n ? ` Earliest exit = notice date + ${d.n} ${d.unit}(s).` : ' No computable notice length, so needs review.');
    res.other.push({ kind: 'termination for convenience', rule, who: who.replace(/^(either|each)\s+party$/i, 'either party'), notice: d && d.n ? { n: d.n, unit: d.unit } : null, why, confidence: d && d.n ? (who ? 'high' : 'medium') : 'low', needsReview: !(d && d.n), source: src(s) });
  }

  const bad = new Set();
  for (const s of S) for (const m of s.text.matchAll(new RegExp(`${MONTH_RE}\\s+(\\d{1,2}),?\\s*(\\d{4})`, 'gi'))) { const mo = MONTHS[m[1].toLowerCase().replace('.', '').slice(0, 3)]; if (mo && !mkDate(+m[3], mo, +m[2])) bad.add(m[0]); }
  if (bad.size) res.reviewNotes.push(`Invalid calendar date in the text (${[...bad].slice(0, 3).map(b => '"' + b + '"').join(', ')}); ignored, not rolled over.`);
  if (/\[\s*\*+\s*\]/.test(S.map(s => s.text).join(' '))) res.reviewNotes.push('Public filing contains redactions ([***]). Some terms may be hidden.');
  return res;
}

// US federal holidays 2026–2035, observed dates (OPM rule: Saturday -> Friday, Sunday -> Monday). Fixed table.
export const US_HOLIDAYS = new Map([
  ['2026-01-01', "New Year's Day"],
  ['2026-01-19', "Martin Luther King Jr. Day"],
  ['2026-02-16', "Washington's Birthday"],
  ['2026-05-25', "Memorial Day"],
  ['2026-06-19', "Juneteenth"],
  ['2026-07-03', "Independence Day"],
  ['2026-09-07', "Labor Day"],
  ['2026-10-12', "Columbus Day"],
  ['2026-11-11', "Veterans Day"],
  ['2026-11-26', "Thanksgiving Day"],
  ['2026-12-25', "Christmas Day"],
  ['2027-01-01', "New Year's Day"],
  ['2027-01-18', "Martin Luther King Jr. Day"],
  ['2027-02-15', "Washington's Birthday"],
  ['2027-05-31', "Memorial Day"],
  ['2027-06-18', "Juneteenth"],
  ['2027-07-05', "Independence Day"],
  ['2027-09-06', "Labor Day"],
  ['2027-10-11', "Columbus Day"],
  ['2027-11-11', "Veterans Day"],
  ['2027-11-25', "Thanksgiving Day"],
  ['2027-12-24', "Christmas Day"],
  ['2027-12-31', "New Year's Day"],
  ['2028-01-17', "Martin Luther King Jr. Day"],
  ['2028-02-21', "Washington's Birthday"],
  ['2028-05-29', "Memorial Day"],
  ['2028-06-19', "Juneteenth"],
  ['2028-07-04', "Independence Day"],
  ['2028-09-04', "Labor Day"],
  ['2028-10-09', "Columbus Day"],
  ['2028-11-10', "Veterans Day"],
  ['2028-11-23', "Thanksgiving Day"],
  ['2028-12-25', "Christmas Day"],
  ['2029-01-01', "New Year's Day"],
  ['2029-01-15', "Martin Luther King Jr. Day"],
  ['2029-02-19', "Washington's Birthday"],
  ['2029-05-28', "Memorial Day"],
  ['2029-06-19', "Juneteenth"],
  ['2029-07-04', "Independence Day"],
  ['2029-09-03', "Labor Day"],
  ['2029-10-08', "Columbus Day"],
  ['2029-11-12', "Veterans Day"],
  ['2029-11-22', "Thanksgiving Day"],
  ['2029-12-25', "Christmas Day"],
  ['2030-01-01', "New Year's Day"],
  ['2030-01-21', "Martin Luther King Jr. Day"],
  ['2030-02-18', "Washington's Birthday"],
  ['2030-05-27', "Memorial Day"],
  ['2030-06-19', "Juneteenth"],
  ['2030-07-04', "Independence Day"],
  ['2030-09-02', "Labor Day"],
  ['2030-10-14', "Columbus Day"],
  ['2030-11-11', "Veterans Day"],
  ['2030-11-28', "Thanksgiving Day"],
  ['2030-12-25', "Christmas Day"],
  ['2031-01-01', "New Year's Day"],
  ['2031-01-20', "Martin Luther King Jr. Day"],
  ['2031-02-17', "Washington's Birthday"],
  ['2031-05-26', "Memorial Day"],
  ['2031-06-19', "Juneteenth"],
  ['2031-07-04', "Independence Day"],
  ['2031-09-01', "Labor Day"],
  ['2031-10-13', "Columbus Day"],
  ['2031-11-11', "Veterans Day"],
  ['2031-11-27', "Thanksgiving Day"],
  ['2031-12-25', "Christmas Day"],
  ['2032-01-01', "New Year's Day"],
  ['2032-01-19', "Martin Luther King Jr. Day"],
  ['2032-02-16', "Washington's Birthday"],
  ['2032-05-31', "Memorial Day"],
  ['2032-06-18', "Juneteenth"],
  ['2032-07-05', "Independence Day"],
  ['2032-09-06', "Labor Day"],
  ['2032-10-11', "Columbus Day"],
  ['2032-11-11', "Veterans Day"],
  ['2032-11-25', "Thanksgiving Day"],
  ['2032-12-24', "Christmas Day"],
  ['2032-12-31', "New Year's Day"],
  ['2033-01-17', "Martin Luther King Jr. Day"],
  ['2033-02-21', "Washington's Birthday"],
  ['2033-05-30', "Memorial Day"],
  ['2033-06-20', "Juneteenth"],
  ['2033-07-04', "Independence Day"],
  ['2033-09-05', "Labor Day"],
  ['2033-10-10', "Columbus Day"],
  ['2033-11-11', "Veterans Day"],
  ['2033-11-24', "Thanksgiving Day"],
  ['2033-12-26', "Christmas Day"],
  ['2034-01-02', "New Year's Day"],
  ['2034-01-16', "Martin Luther King Jr. Day"],
  ['2034-02-20', "Washington's Birthday"],
  ['2034-05-29', "Memorial Day"],
  ['2034-06-19', "Juneteenth"],
  ['2034-07-04', "Independence Day"],
  ['2034-09-04', "Labor Day"],
  ['2034-10-09', "Columbus Day"],
  ['2034-11-10', "Veterans Day"],
  ['2034-11-23', "Thanksgiving Day"],
  ['2034-12-25', "Christmas Day"],
  ['2035-01-01', "New Year's Day"],
  ['2035-01-15', "Martin Luther King Jr. Day"],
  ['2035-02-19', "Washington's Birthday"],
  ['2035-05-28', "Memorial Day"],
  ['2035-06-19', "Juneteenth"],
  ['2035-07-04', "Independence Day"],
  ['2035-09-03', "Labor Day"],
  ['2035-10-08', "Columbus Day"],
  ['2035-11-12', "Veterans Day"],
  ['2035-11-22', "Thanksgiving Day"],
  ['2035-12-25', "Christmas Day"]
]);
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Last safe business day on or before a contract deadline: steps back over Saturdays, Sundays and US federal holidays.
// Returns { date, changed, reason } where reason names why the contract date is not a business day.
export function safeSendBy(day) {
  if (!day) return { date: '', changed: false, reason: '' };
  const wd = new Date(day + 'T00:00:00Z').getUTCDay();
  const reason = wd === 0 || wd === 6 ? `Falls on a ${WD[wd]}` : US_HOLIDAYS.has(day) ? `Falls on ${US_HOLIDAYS.get(day)} (US federal holiday)` : '';
  let d = new Date(day + 'T00:00:00Z');
  while ([0, 6].includes(d.getUTCDay()) || US_HOLIDAYS.has(ymd(d))) d = addDays(d, -1);
  return { date: ymd(d), changed: ymd(d) !== day, reason };
}
// ---------- schedule: send-notice deadline queue ----------
// Returns the dated items for one contract given an as-of date (YYYY-MM-DD).
export const sure = c => c === 'high' ? 'Sure' : c === 'none' ? 'Can’t tell' : 'Check this';
export function schedule(x, asOf) {
  const items = [];
  const as = new Date(asOf + 'T00:00:00Z');
  const base = { confidence: 'none', needsReview: true };
  if (x.effective) items.push({ type: 'Effective date', date: x.effective.date, confidence: x.effective.confidence, needsReview: x.effective.needsReview, why: x.effective.why, source: x.effective.source });
  if (!x.term) { items.push({ ...base, type: 'Term / expiry', date: '', why: 'No term clause found. Needs review.', source: null }); if (x.notice?.date) items.push({ type: 'Send-notice deadline', date: x.notice.date, actBy: true, confidence: 'medium', needsReview: true, why: x.notice.why + ' Term end not found, so the date is not cross-checked against the term.', source: x.notice.source, status: x.notice.date < asOf ? 'past' : '' }); return items; }
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
  const actByOf = (e) => { if (!np) return null; if (!np.business) return addDuration(e, np, -1); let d = e, n = np.n; while (n > 0) { d = addDays(d, -1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n--; } return d; };
  let k = 0, status = '';
  if (x.renewal && rp) {
    while (k < Math.min(maxR, 500)) { const a = actByOf(endOf(k)); if ((a || endOf(k)) >= as) break; k++; }
    if (k >= maxR) { const a = actByOf(endOf(k)); if ((a || endOf(k)) < as) status = 'final'; }
  }
  const end = endOf(k), actBy = actByOf(end);
  const projected = k > 0;
  const last = x.renewal && rp && Number.isFinite(maxR) ? endOf(maxR) : null;
  const projNote = projected ? ` Projected forward ${k} renewal cycle(s) from the initial term (${x.term.end}); assumes the agreement was never terminated or amended.` : '';
  const expired = !x.renewal ? end < as : (status === 'final' && end < as);
  if (x.renewal && status === 'final' && end < as) {
    items.push({ type: 'Expired (all renewals used)', date: ymd(end), confidence: termConf === 'high' ? 'medium' : termConf, needsReview: termRev, why: `All ${maxR} permitted renewal(s) have run; the agreement expired on ${ymd(end)} unless it was amended or extended. No notice is due.`, source: x.renewal.source || x.term.source, status: 'past' });
    return items;
  }
  // The term running on the as-of date can be earlier than the cycle the next decision applies to (notice already missed for it).
  let kc = 0; if (x.renewal && rp) while (kc < k && endOf(kc) < as) kc++;
  // Missed window: the running term's notice date passed, it has not renewed yet, and no later send-notice deadline falls before that renewal.
  const renewOn = x.renewal && rp ? addDays(endOf(kc), 1) : null;
  const missedWindow = kc < k && renewOn && actBy && actBy >= renewOn ? { actBy: ymd(actByOf(endOf(kc))), renews: ymd(renewOn) } : null;
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
      items.push({ type: 'Send-notice deadline', date: ymd(actBy), actBy: true, who: x.notice.who, via: x.notice.via, confidence: conf, needsReview: nRev || !!x.notice.via || conf === 'low', why: `${x.notice.why} (${ymd(end)} − ${np.n} ${np.unit}(s)).${projNote}${x.warnings ? ' ' + x.warnings[0] : ''}${x.renewal.needsReview && /conditional/.test(x.renewal.why) ? ' ' + x.renewal.why.replace(/^.*?(Renewal is conditional)/, '$1') : ''}`, source: x.notice.source, status: actBy < as ? 'past' : '' });
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
export const shortReason = (why = '') => /Renewal is conditional/.test(why) ? 'renewal depends on a condition; confirm it holds' : /^Evergreen/.test(why) ? 'renews monthly, no notice clause' : /Not a redaction/.test(why) ? (/Commencement/.test(why) ? 'term runs from an undated Commencement Date' : 'term start not dated in the document') : /redact|blacked out/i.test(why) ? 'blacked out in the public copy' : /No term clause/i.test(why) ? 'no term found' : /event \(e\.g/i.test(why) ? 'term runs from an event' : /cross-reference|defers the notice/i.test(why) ? 'notice set by another section' : /first Renewal Term/i.test(why) ? 'unclear which term the notice counts from' : /inclusive of the final day/i.test(why) ? 'could land one day later' : /without saying before what/i.test(why) ? 'notice reference point not stated' : /Effective Date that needs review|no Effective Date/i.test(why) ? 'effective date not defined' : /disagree/i.test(why) ? 'words and numerals disagree' : /no non-renewal notice|No notice period/i.test(why) ? 'no notice period found' : /not cross-checked/i.test(why) ? 'stated date, term not found' : /not tied/i.test(why) ? 'term start unclear' : (/[=−]|\d+\s*(?:day|month|year)\(s\)/.test(why.split('.')[0]) ? 'confirm against the clause' : (why.split('.')[0] || 'confirm against the clause').slice(0, 60).toLowerCase());

const durMonths = p => !p ? 0 : p.unit === 'year' ? 12 * p.n : p.unit === 'month' ? p.n : p.unit === 'week' ? p.n / 4.35 : p.n / 30.44;
const lockText = p => { if (!p) return ''; const m = durMonths(p); return m >= 12 && m % 12 === 0 ? `${m / 12} more year${m / 12 > 1 ? 's' : ''}` : m >= 1 && Number.isInteger(m) ? `${m} more month${m > 1 ? 's' : ''}` : `another ${p.n} ${p.unit}${p.n > 1 ? 's' : ''}`; };
export const WINDOWS = [[0, 30, 'within 30 days'], [31, 90, '31–90 days'], [91, 365, '91–365 days'], [366, Infinity, 'over a year']];
export const PRIORITY_RULE = 'Order, top to bottom: 1) Missed: the send-notice deadline has passed but the contract has not renewed yet (soonest renewal first). 2) Due within 30 days: send-notice deadline today or in the next 30 days (soonest first). 3) Resolve first: needs review, no date could be found. 4) Later, in time bands: 31–90 days, 91–365, over a year. Inside a band, the bigger risk goes first even if its date is later: first a notice period longer than the renewal, then the longer renewal (2 years before 1 year), then the earlier date. Ties: name A–Z. 5) Expired contracts (nothing left to decide), collapsed at the bottom.';
const fmtW = d => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d + 'T00:00:00Z').getUTCDay()]} ${fmtD(d)}`;
const fmtD = d => { const [y, m, dd] = d.split('-'); return `${+dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y}`; };

// Ranked send-notice deadline queue with an explicit, deterministic priority rule (PRIORITY_RULE) and a one-line reason per row.
export function buildQueue(contracts, asOf) {
  const rows = [];
  for (const c of contracts) {
    const items = schedule(c.x, asOf);
    const act = items.find(i => i.type === 'Send-notice deadline');
    const exp = items.find(i => /term|Expired/i.test(i.type));
    const isExp = exp?.type.startsWith('Expired');
    const mw = items.find(i => i.missedWindow)?.missedWindow;
    const key = act?.date || (!c.x.renewal || isExp ? exp?.date : '') || '';
    const d = key ? daysBetween(asOf, key) : null;
    const item = act || exp;
    const rp = c.x.renewal?.period || null;
    const lockM = durMonths(rp), noticeLong = !!c.x.warnings?.length;
    const lapsed = d != null && d < 0;
    const section = mw ? 'missed' : lapsed ? 'lapsed' : !key ? 'resolve' : d <= 30 && act ? 'due' : 'upcoming';
    const win = section === 'upcoming' || section === 'due' ? WINDOWS.findIndex(([a, b]) => d >= a && d <= b) : -1;
    let why;
    if (mw) { const ago = daysBetween(mw.actBy, asOf), inn = daysBetween(asOf, mw.renews); why = `MISSED: send-notice deadline passed ${ago} day${ago === 1 ? '' : 's'} ago · renews ${fmtD(mw.renews)} (in ${inn} day${inn === 1 ? '' : 's'}) for ${lockText(rp)} unless the other side agrees to end it · next send-notice deadline ${fmtD(key)}`; }
    else if (section === 'lapsed') why = isExp ? `Expired ${-d} days ago · all renewals used; confirm a replacement is in place` : act ? `Notice date passed ${-d} days ago · it has renewed or lapsed; check which` : `Expired ${-d} days ago · no auto-renewal`;
    else if (section === 'resolve' && c.x.notice?.evergreen) { const cur = items.find(i => /term ends/i.test(i.type) && i.date); why = `No send-notice deadline: renews every ${c.x.renewal.period.unit} until terminated, and the contract has no notice clause${cur ? ` · current term ends ${fmtD(cur.date)}` : ''}`; }
    else if (section === 'resolve') why = `No date found · resolve first: ${shortReason(/No end date could be worked out/.test(item?.why || '') && exp ? exp.why : item?.why)}`;
    else if (section === 'due') why = `Due ${d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`} · send notice now or it renews for ${lockText(rp) || 'another term'}`;
    else if (act) why = `Deadline in ${d} day${d === 1 ? '' : 's'} · miss it and it renews for ${lockText(rp) || 'another term'}${noticeLong ? ' · notice is longer than the renewal, so this decides two cycles out' : ''}`;
    else why = `Expires in ${d} days · no auto-renewal, so plan the replacement`;
    const tag = shortReason(!key && /No end date could be worked out/.test(item?.why || '') && exp ? exp.why : item?.why);
    const sb = act && key && d != null && d >= 0 ? safeSendBy(key) : null;
    const safe = sb?.changed ? { date: sb.date, reason: sb.reason, note: `${sb.reason} · send by ${fmtW(sb.date)} to be safe` } : null;
    rows.push({ safe, tag, id: c.id, name: c.name, actBy: key, days: d, missed: mw || null, item, section, window: win, lockMonths: lockM, noticeLong, why, label: mw ? 'Next send-notice deadline' : act ? 'Send-notice deadline' : isExp ? 'Expired (all renewals used)' : 'Expires', expired: !!isExp, needsReview: !key || !!item?.needsReview, confidence: key ? (item?.confidence === 'none' ? 'low' : item?.confidence || 'low') : 'none' });
  }
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
const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function toCSV(contracts, asOf) {
  const head = ['contract', 'filer', 'counterparty', 'item', 'who_acts', 'date', 'days_from_as_of', 'as_of', 'send_by_business_day', 'confidence', 'needs_review', 'reasoning', 'source_location', 'source_clause', 'source_url'];
  const out = [head.join(',')];
  for (const c of contracts) {
    for (const i of [...schedule(c.x, asOf), ...c.x.payments.map(p => ({ type: 'Payment: ' + p.rule, date: nextFixed(p.rule, asOf), who: '', confidence: p.confidence, needsReview: p.needsReview, why: nextFixed(p.rule, asOf) ? 'Next date on or after the as-of date from the fixed schedule in the clause.' : 'Event-driven or recurring; no single calendar date is stated.', source: p.source })), ...c.x.other.map(p => ({ type: 'Termination for convenience: ' + p.rule, date: '', who: p.who || 'Not stated', confidence: p.confidence, needsReview: p.needsReview, why: 'Right, not a deadline.', source: p.source }))]) {
      out.push([c.name, c.filer || '', c.counterparty || '', i.type, i.who || '', i.date, i.date ? daysBetween(asOf, i.date) : '', asOf, i.actBy && i.date ? safeSendBy(i.date).date : '', sure(i.confidence), i.needsReview ? 'yes' : 'no', i.why, i.source?.location || '', i.source?.quote || '', c.url || ''].map(csvCell).join(','));
    }
  }
  return out.join('\r\n') + '\r\n';
}
const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = l => { const o = []; while (l.length > 74) { o.push(l.slice(0, 74)); l = ' ' + l.slice(74); } o.push(l); return o.join('\r\n'); };
export function toICS(contracts, asOf, stamp = '20261019T000000Z') {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Contract Cliffs//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Contract Cliffs send-notice deadlines'];
  for (const c of contracts) for (const i of schedule(c.x, asOf)) {
    if (i.missed) { const r = schedule(c.x, asOf).find(t => t.missedWindow)?.missedWindow; if (r) { const d = r.renews.replace(/-/g, ''); const n = ymd(addDays(new Date(r.renews + 'T00:00:00Z'), 1)).replace(/-/g, ''); L.push('BEGIN:VEVENT', `UID:${c.id}-renews-${d}@contract-cliffs`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${n}`, fold(`SUMMARY:${icsEsc('MISSED: ' + c.name + ' renews today (send-notice deadline missed)')}`), fold(`DESCRIPTION:${icsEsc(i.why)}`), ...(c.url ? [fold(`URL:${c.url}`)] : []), 'END:VEVENT'); } continue; }
    if (!i.actBy || !i.date || i.status === 'past') continue;
    const sb = safeSendBy(i.date); const d = sb.date.replace(/-/g, ''); const n = ymd(addDays(new Date(sb.date + 'T00:00:00Z'), 1)).replace(/-/g, '');
    const sbNote = sb.changed ? `Contract date: ${i.date}, which ${sb.reason.replace(/^Falls/, 'falls')}; this event is on the last business day before it (${sb.date}). ` : `Contract date: ${i.date}. `;
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
export function toPacket(contracts, asOf) {
  const rows = buildQueue(contracts, asOf);
  const body = contracts.map(c => {
    const its = schedule(c.x, asOf);
    return `<section><h2>${h(c.name)}</h2><p class="m">${h(c.title || '')}${c.filer ? ' · filed by ' + h(c.filer) : ''}${c.filed ? ' · filed ' + h(c.filed) : ''}</p>${c.url ? `<p><a href="${h(c.url)}">${h(c.url)}</a></p>` : '<p class="m">Uploaded document (no public source).</p>'}<table>${its.map(i => `<tr><td>${h(i.type)}</td><td>${h(i.date || 'needs review')}</td><td>${h(sure(i.confidence))}${i.needsReview ? ' · needs review' : ''}</td><td><q>${h(i.source?.quote || '')}</q><br><small>${h(i.source?.location || '')}</small></td></tr>`).join('')}</table></section>`;
  }).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Audit pack · Contract Cliffs · as of ${h(asOf)}</title><style>body{font:14px/1.7 Geist,Arial,sans-serif;color:#000;max-width:960px;margin:48px auto;padding:0 20px}h1{font-weight:500;text-transform:lowercase}h2{font-weight:500;margin-top:48px}.m,small{color:#666}table{border-collapse:collapse;width:100%}td{border-top:.5px solid #4d4d4d;padding:8px 6px;vertical-align:top}</style><h1>contract cliffs</h1><p class="m">Audit pack · ${contracts.length} contracts · as of ${h(asOf)} · generated by deterministic extraction; every date shows its source clause. Blank dates need human review.</p><h2>Send-notice deadlines, most urgent first</h2><table>${rows.map(r => r.missed ? `<tr class="missed"><td>${h(r.name)}</td><td><b>MISSED</b> · send-notice deadline was ${h(r.missed.actBy)}</td><td>Renews ${h(r.missed.renews)}</td><td>in ${daysBetween(asOf, r.missed.renews)} days · next send-notice deadline ${h(r.actBy)}</td></tr>` : `<tr><td>${h(r.name)}</td><td>${h(r.label)}</td><td>${h(r.actBy || 'needs review')}</td><td>${r.days == null ? '' : r.days + ' days'}</td></tr>`).join('')}</table>${(() => { const aff = rows.filter(r => r.safe); return aff.length ? `<h2>Deadlines that fall on a weekend or US federal holiday</h2><ul>${aff.map(r => `<li>${h(r.name)}: contract date ${h(r.actBy)} · ${h(r.safe.reason)} · send by ${h(r.safe.date)} to be safe.</li>`).join('')}</ul><p class="m">Weekends and US federal holidays flagged; local holidays not modelled.</p>` : ''; })()}${body}</html>`;
}
