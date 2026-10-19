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
  return { n: pn ?? wn, unit, text: m[0].trim(), redacted: false, conflict, index: m.index };
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
export function toSentences(lines) {
  let buf = '', map = []; const breaks = new Set();
  lines.forEach((ln, i) => {
    const t = (typeof ln === 'string' ? ln : ln.text).replace(/\s+/g, ' ').trim();
    if (!t || /^[-–—\s]*\d{1,3}[-–—\s]*$|^page\s+\d+(\s+of\s+\d+)?$/i.test(t)) return;
    const start = buf.length; buf += (buf ? ' ' : '') + t;
    map.push({ start: start + (start ? 1 : 0), end: buf.length, line: i + 1, page: ln.page });
    const nx = lines[i + 1]; const nt = nx == null ? '' : (typeof nx === 'string' ? nx : nx.text).trim();
    if (t.length < 45 && !/[,;(“"]$|\b(?:of|the|and|or|to|for|a|an|in|by)$/i.test(t) && /^[A-Z0-9“"(]/.test(nt) && !/[.:;]$/.test(t)) breaks.add(buf.length);
  });
  const sents = []; let s = 0;
  const re = /[.;:](?=\s+(?:[A-Z(“"\[]|\d+\.))/g; let m;
  const push = (a, b) => {
    const text = buf.slice(a, b).trim(); if (text.length < 3) return;
    const ls = map.filter(x => x.end > a && x.start < b);
    sents.push({ text, lineStart: ls[0]?.line, lineEnd: ls[ls.length - 1]?.line, page: ls[0]?.page ?? null, pageEnd: ls[ls.length - 1]?.page ?? null });
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
  const L = s.lineStart === s.lineEnd ? `line ${s.lineStart}` : `lines ${s.lineStart}–${s.lineEnd}`;
  return s.page ? `p. ${s.page}${s.pageEnd && s.pageEnd !== s.page ? '–' + s.pageEnd : ''}, ${L}` : L;
}
const src = (s) => s ? { quote: s.text, lineStart: s.lineStart, lineEnd: s.lineEnd, page: s.page, location: locLabel(s) } : null;

// ---------- extraction ----------
export function extract(lines) {
  const S = toSentences(lines);
  const res = { effective: null, term: null, renewal: null, notice: null, payments: [], other: [], reviewNotes: [] };

  // 1. Effective date
  const effRe = /(?:made\s+(?:and\s+is\s+)?effective\s+as\s+of|entered\s+into\s+(?:effective\s+)?as\s+of|is\s+effective\s+as\s+of|dated\s+as\s+of|effective\s+as\s+of|dated|made\s+and\s+entered\s+into\s+as\s+of)\s+(?:the\s+)?/i;
  for (const pass of [true, false]) { if (res.effective) break;
  for (const s of S.slice(0, 80)) {
    const m = s.text.match(effRe); if (!m) continue;
    const after = s.text.slice(m.index + m[0].length, m.index + m[0].length + 60);
    const d = parseDate(after); if (!d || d.index > 4) continue;
    const tail = s.text.slice(m.index + m[0].length + d.index + d.text.length, m.index + m[0].length + d.index + d.text.length + 40);
    const defined = /^\W{0,6}(?:the\s+)?[“"]?\s*Effective\s+Date/i.test(tail);
    if (/amend and restate|superseded/i.test(s.text) && !defined) continue;
    if (pass && !defined) continue;
    res.effective = { date: ymd(d.date), confidence: defined ? 'high' : 'medium', needsReview: !defined,
      why: defined ? 'Date is expressly defined as the "Effective Date".' : 'Only a "dated / as of" date was found; no Effective Date is expressly defined here, and the date may belong to a related agreement. Confirm commencement.',
      source: src(s) };
    break;
  } }

  // 2. Term / expiry
  const termCands = S.filter(s => /\b(initial\s+(term|license\s+period|period)|the\s+term\s+of\s+this|remain\s+in\s+effect|have\s+a\s+term|shall\s+commence)/i.test(s.text) && !/automatically\s+(renew|extend)/i.test(s.text.slice(0, 40)));
  for (const s of termCands) {
    const t = s.text;
    let range = t.match(new RegExp(`(${MONTH_RE}\\s+\\d{1,2},?\\s*\\d{4})\\s*[–—-]+\\s*(${MONTH_RE}\\s+\\d{1,2},?\\s*\\d{4})`, 'i'));
    if (range && /period|term/i.test(t)) {
      const a = parseDate(range[1]), b = parseDate(range[3]);
      res.term = { start: ymd(a.date), end: ymd(b.date), confidence: 'high', needsReview: false, why: 'Explicit start and end dates.', source: src(s), rule: 'explicit' };
      break;
    }
    const thr = t.match(/\b(?:through|until)\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4})/i);
    if (thr) {
      const b = parseDate(thr[1]);
      res.term = { start: res.effective?.date || '', end: ymd(b.date), confidence: 'high', needsReview: false, why: 'Explicit end date.', source: src(s), rule: 'explicit' };
      break;
    }
    const m = t.match(/\b(?:for|run\s+for|continues?\s+for|period\s+of|remain\s+in\s+effect\s+(?:for|until))\s+(?:a\s+period\s+of\s+|an?\s+initial\s+(?:term|period)\s+of\s+|an?\s+)?(.{0,60})/i);
    if (!m) continue;
    const dur = parseDuration(m[1]);
    if (!dur || dur.index > 3) {
      if (new RegExp(REDACT_RE).test(m[1].slice(0, 12))) {
        res.term = { start: res.effective?.date || '', end: '', confidence: 'none', needsReview: true, why: 'Term length is redacted in the public filing ([***]). Expiry cannot be computed.', source: src(s) };
        break;
      }
      continue;
    }
    if (dur.redacted) { res.term = { start: res.effective?.date || '', end: '', confidence: 'none', needsReview: true, why: 'Term length is redacted in the public filing.', source: src(s) }; break; }
    const fromEff = /effective\s+date/i.test(t);
    const until = /\buntil\b[^.]{0,40}following/i.test(t);
    const start = res.effective ? new Date(res.effective.date + 'T00:00:00Z') : null;
    let end = '', why, conf = 'high', review = false;
    if (!fromEff) { if (!res._fallback) res._fallback = { start: res.effective?.date || '', end: '', duration: { n: dur.n, unit: dur.unit, text: dur.text }, confidence: 'low', needsReview: true, why: `Term length "${dur.text}" found, but its start point is not tied to the Effective Date. Expiry not computed.`, source: src(s) }; continue; }
    else if (!start) { conf = 'low'; review = true; why = 'Term runs from the Effective Date, which was not found.'; }
    else if (until) { end = ymd(addDuration(start, dur)); why = `"Until ${dur.text} following the Effective Date": expiry = the anniversary date.`; }
    else { end = ymd(addDays(addDuration(start, dur), -1)); why = `${dur.n} ${dur.unit}(s) commencing on the Effective Date: last day of term = anniversary minus one day.`; }
    if (dur.conflict) { conf = 'low'; review = true; why = `Words and numerals disagree in "${dur.text}".`; }
    if (res.effective?.needsReview && conf === 'high') { conf = 'medium'; review = true; why += ' Depends on an Effective Date that needs review.'; }
    res.term = { start: res.effective?.date || '', end, duration: { n: dur.n, unit: dur.unit, text: dur.text }, confidence: conf, needsReview: review, why, source: src(s), rule: until ? 'until' : 'for' };
    break;
  }

  if (!res.term && res._fallback) res.term = res._fallback; delete res._fallback;
  // 3. Renewal + 4. notice
  const ri = S.findIndex(s => /automatically\s+(renew|extend)|renew\s+automatically|automatic(ally)?\s+renewal/i.test(s.text) && !/prevent\s+such/i.test(s.text.slice(0, 20)));
  if (ri >= 0) {
    const s = S[ri], t = s.text;
    const upTo = t.match(/up\s+to\s+(\w+)\s+(?:\(\d+\)\s+)?(?:additional\s+)?(?:successive\s+)?(?:periods?|terms?|renewal)?/i);
    let max = null;
    if (upTo) { const n = /^\d+$/.test(upTo[1]) ? +upTo[1] : wordsToNumber(upTo[1]); if (n != null) max = n; }
    const rm = t.match(/(?:successive|additional|renewal)\s+(?:successive\s+)?(?:terms?\s+of\s+|periods?\s+of\s+)?(.{0,70})/i) || t.match(/periods?\s+of\s+(.{0,60})/i);
    let dur = null;
    const tries = [];
    const rt = t.slice(t.search(/automatically|renew/i));
    for (const re of [/successive\s+(?:periods?|terms?)\s+of\s+(.{0,50})/i, /successive\s+(.{0,50})/i, /additional\s+(?:successive\s+)?(?:term\s*\(.*?\)\s*of\s+)?(.{0,60})/i, /periods?\s+of\s+(.{0,50})/i, /\bterm\s*\([^)]*\)\s*of\s+(.{0,60})/i]) {
      const mm = rt.match(re); if (mm) { const d = parseDuration(mm[1]); if (d && d.index <= 2) { dur = d; break; } tries.push(mm[1]); }
    }
    if ((!dur || dur.index > 2) && /year\s+to\s+year/i.test(t) && !/successive\s+one\s*\(1\)\s*year/i.test(t)) dur = { n: 1, unit: 'year', text: 'year to year' };
    let review = false, why = '', conf = 'high';
    if (!dur) { review = true; conf = 'none'; why = 'Auto-renewal found, but renewal length could not be read.'; }
    else if (dur.redacted) { review = true; conf = 'none'; why = 'Renewal length is redacted in the public filing.'; }
    else why = `Renews for successive ${dur.n} ${dur.unit}(s)${max != null ? `, at most ${max} time(s)` : ''}.`;
    res.renewal = { auto: true, period: dur && !dur.redacted ? { n: dur.n, unit: dur.unit, text: dur.text } : null, max, confidence: conf, needsReview: review, why, source: src(s) };

    // notice: same sentence, else the next two sentences
    for (const cand of [S[ri], S[ri + 1], S[ri + 2], S[ri - 1]].filter(Boolean)) {
      const ct = cand.text;
      if (!/notice|notify/i.test(ct)) continue;
      const nm = ct.match(new RegExp(`(?:at\\s+least|not\\s+less\\s+than|no\\s+less\\s+than|no\\s+later\\s+than|on\\s+or\\s+before\\s+the\\s+day\\s+that\\s+is|within)?\\s*((?:${NUMWORD_RE})?\\s*(?:\\(\\s*\\d+\\s*\\))?|\\d+|${REDACT_RE})\\s*(?:calendar\\s+)?(days?|months?|years?)['’]?s?\\s+(?:prior|before|in\\s+advance)`, 'i'));
      const redactedBefore = ct.match(new RegExp(`${REDACT_RE}\\s+(?:prior|before)`, 'i'));
      if (!nm && !redactedBefore) continue;
      const d = nm ? parseDuration(nm[1].trim() + ' ' + nm[2]) : { redacted: true, text: redactedBefore[0] };
      let nconf = 'high', nreview = false, nwhy;
      if (!d || d.redacted || d.n == null) { nconf = 'none'; nreview = true; nwhy = 'Notice period is redacted in the public filing. Act-by date cannot be computed.'; }
      else {
        nwhy = `Act-by = end of term minus ${d.n} ${d.unit}(s).`;
        if (d.conflict) { nconf = 'low'; nreview = true; nwhy = `Words and numerals disagree in "${d.text}".`; }
        if (/first\s+renewal\s+term/i.test(ct) && !/initial\s+term/i.test(ct.split(/notice/i)[1] || '')) { nconf = 'low'; nreview = true; nwhy += ' Clause measures notice from "the end of the first Renewal Term", not the Initial Term. Drafting is ambiguous.'; }
        if (/at\s+least|not\s+less|no\s+less/i.test(nm?.[0] || '')) nwhy += ' "At least / not less than": send on or before this date.';
        if (/inclusive\s+of\s+the\s+final\s+day/i.test(ct)) { nconf = 'medium'; nreview = true; nwhy += ' Clause adds "inclusive of the final day", so the count could land one day later; the earlier (safer) date is shown. Confirm with counsel.'; }
      }
      res.notice = { period: d && !d.redacted && d.n != null ? { n: d.n, unit: d.unit, text: d.text } : null, confidence: nconf, needsReview: nreview, why: nwhy, source: src(cand) };
      break;
    }
    if (!res.notice) res.notice = { period: null, confidence: 'none', needsReview: true, why: 'Auto-renews, but no non-renewal notice period was found near the renewal clause.', source: src(s) };
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
      res.payments.push({ kind: 'payment', rule: fixed ? `1st of ${fixed[1]}` : (sched ? sched[1].toLowerCase() : `within ${d ? d.n + ' ' + d.unit + 's' : win[1]}`),
        trigger: fixed ? 'fixed calendar dates' : (win ? (t.match(/(?:after|of|following)\s+(?:the\s+)?(?:date\s+of\s+)?(?:receipt\s+of\s+)?(\w+(?:\s\w+)?)/i)?.[1] || 'event') : 'recurring'),
        confidence: d?.conflict ? 'low' : 'high', needsReview: !!d?.conflict, source: src(s) });
      if (res.payments.length >= 6) break;
    }
  }
  const tfc = S.find(s => /terminat\w+[^.]{0,80}(?:for\s+(?:any\s+reason|convenience)|without\s+cause)/i.test(s.text) && DURATION_RE.test(s.text) && /notice/i.test(s.text));
  if (tfc) { const d = parseDuration(tfc.text.match(/\(?\w*[\s-]*\w*\s*\(?\d*\)?\s*days?['’]?s?\s+(?:prior\s+)?(?:written\s+)?notice/i)?.[0] || ''); res.other.push({ kind: 'termination for convenience', rule: d && d.n ? `${d.n} ${d.unit}s' notice` : 'see clause', confidence: d && d.n ? 'medium' : 'low', needsReview: !(d && d.n), source: src(tfc) }); }

  if (/\[\s*\*+\s*\]/.test(S.map(s => s.text).join(' '))) res.reviewNotes.push('Public filing contains redactions ([***]). Some terms may be hidden.');
  return res;
}

// ---------- schedule: act-by queue ----------
// Returns the dated items for one contract given an as-of date (YYYY-MM-DD).
export function schedule(x, asOf) {
  const items = [];
  const as = new Date(asOf + 'T00:00:00Z');
  const base = { confidence: 'none', needsReview: true };
  if (x.effective) items.push({ type: 'Effective date', date: x.effective.date, confidence: x.effective.confidence, needsReview: x.effective.needsReview, why: x.effective.why, source: x.effective.source });
  if (!x.term) { items.push({ ...base, type: 'Term / expiry', date: '', why: 'No term clause found. Needs review.', source: null }); return items; }
  if (!x.term.end) { items.push({ type: 'Term / expiry', date: '', confidence: x.term.confidence, needsReview: true, why: x.term.why, source: x.term.source }); if (x.notice) items.push({ type: 'Non-renewal notice: act by', date: '', confidence: 'none', needsReview: true, why: 'No computable expiry, so no act-by date. ' + (x.notice.why || ''), source: x.notice.source, noticeText: x.notice.period?.text || '' }); return items; }
  const end0 = new Date(x.term.end + 'T00:00:00Z');
  const termConf = x.term.confidence, termRev = x.term.needsReview;
  const rp = x.renewal?.period, maxR = x.renewal ? (x.renewal.max ?? Infinity) : 0;
  // walk renewal cycles: cycle k ends at endK
  const endOf = (k) => k === 0 ? end0 : addDays(addDuration(addDays(end0, 1), { n: rp.n * k, unit: rp.unit }), -1);
  const np = x.notice?.period;
  const actByOf = (e) => np ? addDuration(e, np, -1) : null;
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
  items.push({ type: projected ? 'Current term ends (projected)' : 'Initial term ends', date: ymd(end), confidence: projected && termConf === 'high' ? 'medium' : termConf, needsReview: termRev || (x.renewal ? x.renewal.needsReview : false), why: x.term.why + projNote + (last ? ` Final possible expiry if all renewals run: ${ymd(last)}.` : ''), source: x.term.source, status: expired ? 'past' : '' });
  if (x.renewal) {
    if (!rp) items.push({ type: 'Auto-renewal', date: '', confidence: 'none', needsReview: true, why: x.renewal.why, source: x.renewal.source });
    else items.push({ type: 'Auto-renewal', date: ymd(addDays(end, 1)), confidence: x.renewal.confidence, needsReview: x.renewal.needsReview, why: x.renewal.why, source: x.renewal.source, status: k >= maxR ? 'no further renewals' : '' });
    const nRev = x.notice?.needsReview || termRev || x.renewal.needsReview;
    if (actBy) {
      const c = [x.notice.confidence, termConf, x.renewal.confidence, projected ? 'medium' : 'high'];
      const conf = c.includes('none') ? 'none' : c.includes('low') ? 'low' : c.includes('medium') ? 'medium' : 'high';
      items.push({ type: 'Non-renewal notice: act by', date: ymd(actBy), actBy: true, confidence: conf, needsReview: nRev, why: `${x.notice.why} (${ymd(end)} − ${np.n} ${np.unit}(s)).${projNote}`, source: x.notice.source, status: actBy < as ? 'past' : '' });
    } else items.push({ type: 'Non-renewal notice: act by', date: '', confidence: 'none', needsReview: true, why: x.notice?.why || 'No notice period found.', source: x.notice?.source || null });
  }
  return items;
}

export function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }

// Ranked act-by queue across contracts: upcoming act-by dates first (soonest), then needs-review, then past.
export function buildQueue(contracts, asOf) {
  const rows = [];
  for (const c of contracts) {
    const items = schedule(c.x, asOf);
    const act = items.find(i => i.type.startsWith('Non-renewal notice'));
    const exp = items.find(i => /term/i.test(i.type));
    const key = act?.date || (!c.x.renewal ? exp?.date : '') || '';
    const d = key ? daysBetween(asOf, key) : null;
    rows.push({ id: c.id, name: c.name, actBy: key, days: d, item: act || exp, label: act ? 'Send non-renewal notice by' : 'Expires', needsReview: !key || (act || exp)?.needsReview, confidence: (act || exp)?.confidence || 'none' });
  }
  const bucket = r => !r.actBy ? 2 : r.days < 0 ? 3 : 0;
  rows.sort((a, b) => bucket(a) - bucket(b) || (bucket(a) === 3 ? b.days - a.days : (a.days ?? 0) - (b.days ?? 0)) || a.name.localeCompare(b.name));
  return rows;
}

// ---------- exports ----------
const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function toCSV(contracts, asOf) {
  const head = ['contract', 'filer', 'counterparty', 'item', 'date', 'days_from_as_of', 'as_of', 'confidence', 'needs_review', 'reasoning', 'source_location', 'source_clause', 'source_url'];
  const out = [head.join(',')];
  for (const c of contracts) {
    for (const i of [...schedule(c.x, asOf), ...c.x.payments.map(p => ({ type: 'Payment: ' + p.rule, date: '', confidence: p.confidence, needsReview: p.needsReview, why: 'Event-driven or recurring; no single calendar date is stated.', source: p.source })), ...c.x.other.map(p => ({ type: 'Termination for convenience: ' + p.rule, date: '', confidence: p.confidence, needsReview: p.needsReview, why: 'Right, not a deadline.', source: p.source }))]) {
      out.push([c.name, c.filer || '', c.counterparty || '', i.type, i.date, i.date ? daysBetween(asOf, i.date) : '', asOf, i.confidence, i.needsReview ? 'yes' : 'no', i.why, i.source?.location || '', i.source?.quote || '', c.url || ''].map(csvCell).join(','));
    }
  }
  return out.join('\r\n') + '\r\n';
}
const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = l => { const o = []; while (l.length > 74) { o.push(l.slice(0, 74)); l = ' ' + l.slice(74); } o.push(l); return o.join('\r\n'); };
export function toICS(contracts, asOf, stamp = '20261019T000000Z') {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Contract Cliffs//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Contract Cliffs act-by'];
  for (const c of contracts) for (const i of schedule(c.x, asOf)) {
    if (!i.actBy || !i.date) continue;
    const d = i.date.replace(/-/g, ''); const n = ymd(addDays(new Date(i.date + 'T00:00:00Z'), 1)).replace(/-/g, '');
    L.push('BEGIN:VEVENT', `UID:${c.id}-${d}@contract-cliffs`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${n}`,
      fold(`SUMMARY:${icsEsc('Act by: non-renewal notice, ' + c.name)}`),
      fold(`DESCRIPTION:${icsEsc(`${i.why}${i.needsReview ? ' NEEDS REVIEW.' : ''} Confidence: ${i.confidence}. Source ${i.source?.location}: "${i.source?.quote}"`)}`),
      ...(c.url ? [fold(`URL:${c.url}`)] : []),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P30D', fold(`DESCRIPTION:${icsEsc('30 days to act-by: ' + c.name)}`), 'END:VALARM', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}
const h = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
export function toPacket(contracts, asOf) {
  const rows = buildQueue(contracts, asOf);
  const body = contracts.map(c => {
    const its = schedule(c.x, asOf);
    return `<section><h2>${h(c.name)}</h2><p class="m">${h(c.title || '')}${c.filer ? ' · filed by ' + h(c.filer) : ''}${c.exhibit ? ' · ' + h(c.exhibit) : ''}${c.filed ? ' · ' + h(c.filed) : ''}</p>${c.url ? `<p><a href="${h(c.url)}">${h(c.url)}</a></p>` : '<p class="m">Uploaded document (no public source).</p>'}<table>${its.map(i => `<tr><td>${h(i.type)}</td><td>${h(i.date || 'needs review')}</td><td>${h(i.confidence)}${i.needsReview ? ' · needs review' : ''}</td><td><q>${h(i.source?.quote || '')}</q><br><small>${h(i.source?.location || '')}</small></td></tr>`).join('')}</table></section>`;
  }).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Diligence packet · Contract Cliffs · as of ${h(asOf)}</title><style>body{font:14px/1.5 system-ui,sans-serif;color:#0A0A0A;max-width:960px;margin:48px auto;padding:0 20px}h1{font-family:Georgia,serif;letter-spacing:.2em;font-weight:400}h2{font-weight:500;margin-top:48px}.m,small{color:#6B6B6B}table{border-collapse:collapse;width:100%}td{border-top:1px solid #E8E8E8;padding:8px 6px;vertical-align:top}q{font-family:Georgia,serif}</style><h1>CONTRACT CLIFFS</h1><p class="m">Diligence packet · ${contracts.length} contracts · as of ${h(asOf)} · generated by deterministic extraction; every date shows its source clause. Blank dates need human review.</p><h2>Act-by queue</h2><table>${rows.map(r => `<tr><td>${h(r.name)}</td><td>${h(r.label)}</td><td>${h(r.actBy || 'needs review')}</td><td>${r.days == null ? '' : r.days + ' days'}</td></tr>`).join('')}</table>${body}</html>`;
}
