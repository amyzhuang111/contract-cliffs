// Expected values below were hand-checked against the clause text in each EDGAR filing (see edgar/VERIFICATION.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extract, schedule, buildQueue, parseDuration, parseDate, wordsToNumber, toCSV, toICS, toPacket, PRIORITY_RULE, toSentences, addMonths, ymd, norm, nextFixed } from '../public/extract.js';

const D = JSON.parse(fs.readFileSync(new URL('../public/data/edgar.json', import.meta.url)));
const C = Object.fromEntries(D.map(c => [c.id, { ...c, x: extract(c.lines) }]));
const AS = '2026-10-19';
const get = (id, type) => schedule(C[id].x, AS).find(i => i.type.startsWith(type));
const lineHas = (id, s, needle) => { const txt = norm(C[id].lines.slice(s.lineStart - 1, s.lineEnd).join(' ')); return txt.includes(needle); };

// ---- parsers
test('words to numbers', () => { assert.equal(wordsToNumber('one hundred and eighty'), 180); assert.equal(wordsToNumber('Eighty-Four'), 84); assert.equal(wordsToNumber('sixty'), 60); assert.equal(wordsToNumber('fifteen'), 15); assert.equal(wordsToNumber('banana'), null); });
test('durations', () => {
  assert.deepEqual([parseDuration('sixty (60) days').n, parseDuration('sixty (60) days').unit], [60, 'day']);
  assert.equal(parseDuration('one year').n, 1);
  assert.equal(parseDuration('one hundred and eighty (180) days').n, 180);
  assert.equal(parseDuration('Eighty-Four (84) months').n, 84);
  assert.equal(parseDuration('thirty days prior to the end of the then-current term').n, 30);
  assert.equal(parseDuration('[***] days').redacted, true);
  assert.equal(parseDuration('sixty (90) days').conflict, true);
});
test('dates', () => {
  assert.equal(ymd(parseDate('dated as of November 19 th , 2021').date), '2021-11-19');
  assert.equal(ymd(parseDate('the 21 st day of April, 2014').date), '2014-04-21');
  assert.equal(ymd(parseDate('as of Aug. 10, 2026').date), '2026-08-10');
  assert.equal(parseDate('February 30, 2026'), null);
  assert.equal(ymd(addMonths(new Date(Date.UTC(2024, 0, 31)), 1)), '2024-02-29');
});
test('sentences keep line numbers', () => { const s = toSentences(['Term. This runs', 'for one year. Next', 'sentence.']); assert.equal(s[1].lineStart, 1); assert.equal(s[1].lineEnd, 2); });

// ---- synthetic edge cases: never guess
test('words/numerals conflict -> needs review, no date', () => {
  const x = extract(['This Agreement is entered into as of January 1, 2026 (the "Effective Date").', 'The Initial Term begins on the Effective Date and shall continue for twelve (12) months.', 'This Agreement shall automatically renew for successive one (1) year terms unless either party gives notice of non-renewal at least sixty (90) days prior to the end of the then-current term.']);
  const a = schedule(x, '2026-01-02').find(i => i.type.startsWith('Non-renewal'));
  assert.equal(a.needsReview, true); assert.equal(a.confidence, 'low');
});
test('thirty days prior to the end of the then-current term', () => {
  const x = extract(['This Agreement is made effective as of March 1, 2026 (the "Effective Date").', 'The term of this Agreement shall commence on the Effective Date and continue for one year.', 'It shall renew automatically for successive one year periods unless either party gives written notice thirty days prior to the end of the then-current term.']);
  const s = schedule(x, '2026-03-02');
  assert.equal(s.find(i => /term ends/.test(i.type)).date, '2027-02-28');
  assert.equal(s.find(i => i.type.startsWith('Non-renewal')).date, '2027-01-29');
});
test('no renewal clause -> no act-by invented', () => { const x = extract(['This Agreement is dated as of May 1, 2026.']); const s = schedule(x, '2026-05-02'); assert.ok(!s.some(i => i.actBy)); assert.equal(s.find(i => i.type.startsWith('Term')).needsReview, true); });

// ---- real EDGAR contracts (hand-verified)
test('c1 Cerus/Purolite: 84 months from 21 Apr 2014, yearly renewal, notice at least two years', () => {
  assert.equal(C.c1.x.effective.date, '2014-04-21');
  assert.equal(C.c1.x.term.end, '2021-04-20');
  assert.deepEqual(C.c1.x.renewal.period, { n: 1, unit: 'year', text: C.c1.x.renewal.period.text });
  assert.equal(C.c1.x.notice.period.n, 2); assert.equal(C.c1.x.notice.period.unit, 'year');
  const a = get('c1', 'Non-renewal'); assert.equal(a.date, '2027-04-20'); assert.equal(a.confidence, 'medium');
  assert.ok(lineHas('c1', a.source, 'at least two years prior to the last day of the Initial Term'));
  assert.equal(a.source.lineStart, 59);
});
test('c2 StableX/Kopin: 27 Apr 2026, four years, renew 1 yr, 90 days', () => {
  assert.equal(C.c2.x.effective.date, '2026-04-27'); assert.equal(C.c2.x.term.end, '2030-04-26');
  assert.equal(C.c2.x.renewal.period.n, 1); assert.equal(C.c2.x.renewal.period.unit, 'year');
  const a = get('c2', 'Non-renewal'); assert.equal(a.date, '2030-01-26'); assert.equal(a.confidence, 'high'); assert.equal(a.needsReview, false);
  assert.ok(a.source.quote.includes('not less than ninety (90) days prior to the end of the then-current term'));
});
test('c3 Dragonfly/Keystone: undefined Effective Date + "first Renewal Term" drafting -> needs review', () => {
  assert.equal(C.c3.x.effective.needsReview, true);
  const a = get('c3', 'Non-renewal'); assert.equal(a.needsReview, true); assert.equal(a.confidence, 'low');
  assert.ok(a.source.quote.includes('prior to the end of the first Renewal Term'));
});
test('c4 Tradeweb: explicit 1 Nov 2025 – 31 Oct 2028, 180 days, up to two 2-yr extensions', () => {
  assert.equal(C.c4.x.term.start, '2025-11-01'); assert.equal(C.c4.x.term.end, '2028-10-31');
  assert.equal(C.c4.x.renewal.max, 2); assert.equal(C.c4.x.renewal.period.n, 2);
  const a = get('c4', 'Non-renewal'); assert.equal(a.date, '2028-05-04'); assert.equal(a.needsReview, true);
  assert.ok(a.source.quote.includes('one hundred and eighty (180) days prior to the expiration'));
  assert.ok(C.c4.x.payments.some(p => /November, February, May and August/.test(p.rule)));
});
test('c5 Schwazze licence: 24 months from 15 Jun 2023, 180 days, projected to next cycle', () => {
  assert.equal(C.c5.x.effective.date, '2023-06-15'); assert.equal(C.c5.x.term.end, '2025-06-14');
  assert.equal(C.c5.x.renewal.period.n, 24); assert.equal(C.c5.x.notice.period.n, 180);
  const a = get('c5', 'Non-renewal'); assert.equal(a.date, '2026-12-16'); assert.match(a.why, /Projected forward 1 renewal/);
});
test('c6 Vivos MSA: 31 Jul 2026, 12 months, 60 days', () => {
  assert.equal(C.c6.x.term.end, '2027-07-30'); const a = get('c6', 'Non-renewal'); assert.equal(a.date, '2027-05-31'); assert.equal(a.needsReview, false);
  assert.ok(a.source.quote.includes('at least sixty (60) days prior to the end of the then-current term'));
});
test('c7 Synacor/Qwest: through 31 May 2022, max two 1-yr renewals used -> Expired 31 May 2024, no notice line', () => {
  assert.equal(C.c7.x.term.end, '2022-05-31'); assert.equal(C.c7.x.renewal.max, 2);
  const s = schedule(C.c7.x, AS); const e = s.find(i => i.type.startsWith('Expired'));
  assert.equal(e.date, '2024-05-31'); assert.equal(e.status, 'past');
  assert.ok(!s.some(i => i.type.startsWith('Non-renewal') || i.type.startsWith('Auto-renewal')));
  assert.equal(get('c7', 'Non-renewal'), undefined);
  // before the last cycle ran out, the notice line still exists
  assert.equal(schedule(C.c7.x, '2024-01-01').find(i => i.type.startsWith('Non-renewal')).date, '2024-03-02');
});
test('c8 Patheon/Vaxcyte: fifteen years; notice redacted -> blank act-by', () => {
  assert.equal(C.c8.x.term.end, '2040-09-24'); assert.equal(C.c8.x.renewal.period.n, 3);
  const a = get('c8', 'Non-renewal'); assert.equal(a.date, ''); assert.equal(a.needsReview, true); assert.ok(a.source.quote.includes('[***]'));
});
test('c12 Reborn/Mighty Oak: two years from 10 Aug 2026, 60 days prior to expiration', () => {
  assert.equal(C.c12.x.effective.date, '2026-08-10'); assert.equal(C.c12.x.term.end, '2028-08-09');
  assert.equal(get('c12', 'Non-renewal').date, '2028-06-10');
});
test('c13 ARK/Eightco: redacted term -> no expiry, no act-by', () => {
  assert.equal(C.c13.x.term.end, ''); assert.equal(get('c13', 'Non-renewal').date, ''); assert.equal(C.c13.x.notice.period.n, 90);
});
test('every dated item quotes a clause that exists verbatim at its line range', () => {
  let n = 0;
  for (const id in C) for (const i of schedule(C[id].x, AS)) if (i.source) {
    const txt = norm(C[id].lines.slice(i.source.lineStart - 1, i.source.lineEnd).join(' '));
    assert.ok(txt.includes(i.source.quote.slice(0, 40)), `${id} ${i.type}`); n++;
  }
  assert.ok(n >= 35);
});
test('queue order as of 2026-10-19', () => {
  const q = buildQueue(Object.values(C), AS);
  assert.deepEqual(q.map(r => r.id), ['c7', 'c13', 'c8', 'c5', 'c1', 'c6', 'c3', 'c4', 'c12', 'c2']);
  assert.equal(q.filter(r => r.actBy).length, 8);
});
test('as-of control moves the queue', () => { const q = buildQueue(Object.values(C), '2027-01-01').filter(r => r.section === 'upcoming'); assert.equal(q[0].id, 'c1'); });
test('exports', () => {
  const cs = Object.values(C);
  const csv = toCSV(cs, AS); assert.match(csv.split('\r\n')[0], /^contract,filer,counterparty,item,who_acts,date/);
  assert.ok(csv.includes('2030-01-26')); assert.ok(csv.includes('https://www.sec.gov/Archives/edgar/data/771266/'));
  const ics = toICS(cs, AS); assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 7); assert.ok(!ics.includes('20240302')); assert.ok(ics.includes('DTSTART;VALUE=DATE:20261216'));
  assert.ok(ics.split('\r\n').every(l => l.length <= 75));
  const p = toPacket(cs, AS); assert.ok(p.includes('Diligence packet')); assert.equal((p.match(/<section>/g) || []).length, 10);
  assert.ok(!/example\.com/.test(csv + ics + p));
});

// ---- upload paths: generated PDF/DOCX conversions of real EDGAR filings (test/fixtures/README.md)
import { pdfLines, docxLines } from './doc-readers.mjs';
test('PDF fixture (c6 Vivos, generated): act-by 2027-05-31 cited with page and in-page lines', () => {
  const x = extract(pdfLines(new URL('./fixtures/c6-vivos-msa.generated.pdf', import.meta.url).pathname));
  const a = schedule(x, AS).find(i => i.type.startsWith('Non-renewal'));
  assert.equal(a.date, '2027-05-31'); assert.equal(a.source.page, 2); assert.equal(a.source.location, 'p. 2, lines 25–26');
  assert.ok(a.source.quote.includes('at least sixty (60) days prior to the end of the then-current term'));
  assert.equal(x.effective.source.location.startsWith('p. 1,'), true);
});
test('DOCX fixture (c12 Reborn, generated): act-by 2028-06-10 cited by paragraph', () => {
  const x = extract(docxLines(new URL('./fixtures/c12-reborn-supply.generated.docx', import.meta.url).pathname));
  const a = schedule(x, AS).find(i => i.type.startsWith('Non-renewal'));
  assert.equal(x.effective.date, '2026-08-10'); assert.equal(a.date, '2028-06-10'); assert.match(a.source.location, /^¶ \d+/);
});
test('curly-quote whitespace is normalised in quotes', () => {
  assert.equal(norm('(“ Agreement ”)  is'), '(“Agreement”) is');
  for (const id in C) for (const i of schedule(C[id].x, AS)) if (i.source) assert.ok(!/“\s|\s”/.test(i.source.quote), id);
});

// ---- held-out EDGAR exhibits (edgar/holdout/HOLDOUT.md): spot checks of the post-fix behaviour
const H = id => extract(fs.readFileSync(new URL(`../edgar/holdout/raw/${id}.txt`, import.meta.url), 'utf8').split('\n'));
const act = id => schedule(H(id), AS).find(i => i.type.startsWith('Non-renewal'));
test('holdout: clean dates', () => {
  assert.equal(act('h2').date, '2029-07-10'); assert.equal(act('h8').date, '2029-08-23'); assert.equal(act('h14').date, '2028-10-03');
  assert.equal(H('h8').renewal.max, 3); assert.equal(H('h8').effective.date, '2025-02-20');
});
test('holdout: stated deadline shown as written, flagged', () => { const a = act('h7'); assert.equal(a.date, '2027-04-06'); assert.equal(a.needsReview, true); });
test('holdout: event-anchored term (regulatory approval) -> no date, no definition-clause guess', () => {
  const x = H('h12'); assert.equal(x.term.end, ''); assert.equal(x.term.needsReview, true); assert.match(x.term.why, /event/);
  assert.equal(act('h12').date, '');
});
test('holdout: "notice" with no reference point -> date but needs review', () => { const a = act('h9'); assert.equal(a.date, '2027-09-21'); assert.equal(a.needsReview, true); });

// ---- termination for convenience and payment detail
test('termination for convenience: holder and notice', () => {
  const t = H('h1').other[0]; assert.equal(t.who, 'SBEV'); assert.deepEqual(t.notice, { n: 180, unit: 'day' });
  const e = H('h3').other[0]; assert.equal(e.who, 'Elevance Health'); assert.equal(e.notice.n, 365);
  const b = H('h8').other[0]; assert.equal(b.who, 'Blink'); assert.equal(b.notice.n, 60);
});
test('payments name the trigger', () => {
  assert.ok(H('h8').payments.some(p => p.rule === 'within 21 days of receipt of invoice'));
  assert.ok(H('h2').payments.some(p => p.rule === 'within 30 days of invoice'));
  const late = extract(['Customer shall pay each invoice within thirty (30) days after receipt of invoice. Late payments bear interest at 1.5% per month.']);
  assert.equal(late.payments[0].rule, 'within 30 days of receipt of invoice');
});

// ---- product review fixes (Oct 19)
test('term phrasings: "shall be N months" and "is N from"', () => {
  const a = extract(['This Agreement is entered into as of January 15, 2026 (the "Effective Date").', 'The initial term of this Agreement shall be twelve (12) months commencing on the Effective Date.']);
  assert.equal(a.term.end, '2027-01-14');
  const b = extract(['This Agreement is entered into as of March 1, 2026 (the "Effective Date").', 'The term of this Agreement is one (1) year from the Effective Date.']);
  assert.equal(b.term.end, '2027-02-28');
});
test('NDA paste: term, auto-renewal and notice', () => {
  const x = extract(['MUTUAL NONDISCLOSURE AGREEMENT', 'This Mutual Nondisclosure Agreement is entered into as of November 2, 2026 (the "Effective Date") by and between Acme Corp. and Beta LLC.', 'The term of this Agreement is one (1) year from the Effective Date. This Agreement shall automatically renew for successive one (1) year periods unless either party gives written notice of non-renewal at least thirty (30) days prior to the end of the then-current term.']);
  const s = schedule(x, '2026-11-03');
  assert.equal(s.find(i => /term ends/.test(i.type)).date, '2027-11-01');
  assert.equal(s.find(i => i.type.startsWith('Non-renewal')).date, '2027-10-02');
  assert.equal(x.notice.who, 'Either party');
});
test('leap-year anchor: effective 29 Feb 2024, 1-yr term, yearly renewal -> 28 Feb 2027, flagged', () => {
  const x = extract(['This Agreement is made effective as of February 29, 2024 (the "Effective Date").', 'The term of this Agreement shall commence on the Effective Date and continue for one (1) year.', 'It shall automatically renew for successive one (1) year periods unless either party gives notice at least thirty (30) days prior to the end of the then-current term.']);
  assert.equal(x.term.end, '2025-02-28'); assert.equal(x.term.needsReview, true);
  const s = schedule(x, '2026-03-15');
  assert.equal(s.find(i => /term ends/.test(i.type)).date, '2027-02-28');
  assert.equal(s.find(i => i.type.startsWith('Non-renewal')).date, '2027-01-29');
});
test('c4 Tradeweb effective date is the 1 Nov 2025 Amendment Date, not the 2023 Master Agreement date', () => {
  assert.equal(C.c4.x.effective.date, '2025-11-01'); assert.equal(C.c4.x.effective.needsReview, false);
  assert.ok(C.c4.x.effective.source.quote.includes('effective as of November 1, 2025'));
  assert.equal(C.c4.x.effective.source.lineStart, 12);
});
test('Cerus: notice longer than renewal period is called out', () => {
  assert.match(C.c1.x.warnings[0], /longer than each renewal/); assert.match(get('c1', 'Non-renewal').why, /two cycles ahead/);
  assert.equal(C.c6.x.warnings, undefined);
});
test('fixed payment schedule gives the next calendar date', () => {
  assert.equal(nextFixed('1st of November, February, May and August', '2026-10-19'), '2026-11-01');
  assert.equal(nextFixed('1st of November, February, May and August', '2026-11-02'), '2027-02-01');
  assert.equal(nextFixed('within 30 days', '2026-10-19'), '');
});
test('invalid calendar dates in text are noted, not rolled over', () => {
  const x = extract(['This Agreement is entered into as of February 30, 2026 (the "Effective Date").']);
  assert.equal(x.effective, null); assert.ok(x.reviewNotes.some(n => n.includes('February 30, 2026')));
});

// ---- blind holdout 2 fixes + cross-references (Oct 19 evening)
test('current term vs following term: Cerus shows the running term (2027-04-20) separately from the term the decision governs', () => {
  const s = schedule(C.c1.x, AS);
  assert.equal(s.find(i => i.type.startsWith('Current term')).date, '2027-04-20');
  assert.equal(s.find(i => i.type.startsWith('Following term')).date, '2029-04-20');
  assert.equal(s.find(i => i.type === 'Auto-renewal').date, '2027-04-21');
  assert.equal(get('c1', 'Non-renewal').date, '2027-04-20');
});
test('holdout2 b8 (Acadia/Patheon): current term ends 2026-12-31, not 2028', () => {
  const x = extract(fs.readFileSync(new URL('../edgar/holdout2/raw/b8.txt', import.meta.url), 'utf8').split('\n'));
  const s = schedule(x, AS);
  assert.equal(s.find(i => i.type.startsWith('Current term')).date, '2026-12-31');
  assert.equal(s.find(i => i.type.startsWith('Non-renewal')).date, '2026-12-31');
});
test('cross-referenced notice: Amwell (h3) reads Section 7.4 (365 days), flagged, quoting the referenced section', () => {
  const x = H('h3'); assert.equal(x.notice.period.n, 365); assert.equal(x.notice.needsReview, true);
  assert.match(x.notice.source.quote, /^7\.4|three hundred sixty-five/); assert.ok(x.notice.via.quote.includes('Section 7.4'));
  assert.equal(act('h3').date, '2028-01-02');
});
test('cross-reference to a missing section -> flagged, no date', () => {
  const x = extract(['This Agreement is entered into as of January 1, 2026 (the "Effective Date").', 'The term of this Agreement shall commence on the Effective Date and continue for one (1) year.', 'It shall automatically renew for successive one (1) year terms unless a party gives notice of non-renewal pursuant to Section 12.3.']);
  const a = schedule(x, '2026-02-01').find(i => i.type.startsWith('Non-renewal'));
  assert.equal(a.date, ''); assert.equal(a.needsReview, true); assert.match(a.why, /Section 12\.3/);
});

// ---- explicit priority rule
test('priority: sections, windows, reasons', () => {
  const q = buildQueue(Object.values(C), AS);
  assert.deepEqual(q.map(r => r.section), ['missed', 'resolve', 'resolve', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  const by = Object.fromEntries(q.map(r => [r.id, r]));
  assert.equal(by.c5.why, 'Act in 58 days · missing it locks in 2 more years');
  assert.match(by.c1.why, /^Act in 183 days · missing it locks in 1 more year · notice is longer than the renewal/);
  assert.match(by.c7.why, /^Expired 871 days ago · all renewals used/);
  assert.equal(by.c8.why, 'No date found · resolve first: redacted in the public filing');
  assert.equal(by.c13.why, 'No date found · resolve first: redacted in the public filing');
  assert.match(PRIORITY_RULE, /Missed first/);
});
test('priority: inside a window, worse-to-miss beats sooner', () => {
  const mk = (id, eff, renew, notice) => ({ id, name: id, x: extract([`This Agreement is entered into as of ${eff} (the "Effective Date").`, 'The term of this Agreement shall commence on the Effective Date and continue for one (1) year.', `It shall automatically renew for successive ${renew} periods unless either party gives notice at least ${notice} prior to the end of the then-current term.`]) });
  // all three act-by dates fall in the 91–365 window as of 2026-10-19
  const a = mk('A-soon-1yr', 'June 1, 2026', 'one (1) year', 'thirty (30) days');          // act-by 2027-05-01, 1-yr lock
  const b = mk('B-later-3yr', 'August 1, 2026', 'three (3) year', 'thirty (30) days');      // act-by 2027-07-01, 3-yr lock
  const q = buildQueue([a, b], '2026-10-19');
  assert.deepEqual(q.map(r => r.id), ['B-later-3yr', 'A-soon-1yr']);
  assert.equal(q[0].window, q[1].window);
  // different windows: the sooner window always wins, whatever the lock-in
  const d = mk('D-30day-1yr', 'November 20, 2025', 'one (1) year', 'thirty (30) days'); // act-by 2026-10-20 (next 30 days)
  assert.equal(buildQueue([b, d], '2026-10-19')[0].id, 'D-30day-1yr');
  // notice longer than renewal outranks a longer lock-in in the same window
  const e = mk('E-notice-gt-renewal', 'December 1, 2025', 'six (6) month', 'eight (8) months'); // 8 months' notice on 6-month renewals; next act-by 2027-03-30
  const q2 = buildQueue([b, e], '2026-10-19');
  assert.equal(q2[0].window, q2[1].window); assert.equal(q2[0].id, 'E-notice-gt-renewal'); assert.equal(q2[0].noticeLong, true);
});
