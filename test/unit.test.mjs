// Expected values below were hand-checked against the clause text in each EDGAR filing (see edgar/VERIFICATION.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { partiesFromPreamble, shortReason } from '../public/extract.js';
import { safeSendBy, usHolidays, usHoliday, extract, schedule, buildQueue, parseDuration, parseDate, wordsToNumber, toCSV, toICS, toPacket, PRIORITY_RULE, toSentences, addMonths, ymd, norm, nextFixed } from '../public/extract.js';

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
  const a = schedule(x, '2026-01-02').find(i => i.type.startsWith('Send-notice'));
  assert.equal(a.needsReview, true); assert.equal(a.confidence, 'low');
});
test('thirty days prior to the end of the then-current term', () => {
  const x = extract(['This Agreement is made effective as of March 1, 2026 (the "Effective Date").', 'The term of this Agreement shall commence on the Effective Date and continue for one year.', 'It shall renew automatically for successive one year periods unless either party gives written notice thirty days prior to the end of the then-current term.']);
  const s = schedule(x, '2026-03-02');
  assert.equal(s.find(i => /term ends/.test(i.type)).date, '2027-02-28');
  assert.equal(s.find(i => i.type.startsWith('Send-notice')).date, '2027-01-29');
});
test('no renewal clause -> no act-by invented', () => { const x = extract(['This Agreement is dated as of May 1, 2026.']); const s = schedule(x, '2026-05-02'); assert.ok(!s.some(i => i.actBy)); assert.equal(s.find(i => i.type.startsWith('Term')).needsReview, true); });

// ---- real EDGAR contracts (hand-verified)
test('c1 Cerus/Purolite: 84 months from 21 Apr 2014, yearly renewal, notice at least two years', () => {
  assert.equal(C.c1.x.effective.date, '2014-04-21');
  assert.equal(C.c1.x.term.end, '2021-04-20');
  assert.deepEqual(C.c1.x.renewal.period, { n: 1, unit: 'year', text: C.c1.x.renewal.period.text });
  assert.equal(C.c1.x.notice.period.n, 2); assert.equal(C.c1.x.notice.period.unit, 'year');
  const a = get('c1', 'Send-notice'); assert.equal(a.date, '2027-04-20'); assert.equal(a.confidence, 'medium');
  assert.ok(lineHas('c1', a.source, 'at least two years prior to the last day of the Initial Term'));
  assert.equal(a.source.lineStart, 59);
});
test('c2 StableX/Kopin: 27 Apr 2026, four years, renew 1 yr, 90 days', () => {
  assert.equal(C.c2.x.effective.date, '2026-04-27'); assert.equal(C.c2.x.term.end, '2030-04-26');
  assert.equal(C.c2.x.renewal.period.n, 1); assert.equal(C.c2.x.renewal.period.unit, 'year');
  const a = get('c2', 'Send-notice'); assert.equal(a.date, '2030-01-26'); assert.equal(a.confidence, 'high'); assert.equal(a.needsReview, false);
  assert.ok(a.source.quote.includes('not less than ninety (90) days prior to the end of the then-current term'));
});
test('c3 Dragonfly/Keystone: undefined Effective Date + "first Renewal Term" drafting -> needs review', () => {
  assert.equal(C.c3.x.effective.needsReview, true);
  const a = get('c3', 'Send-notice'); assert.equal(a.needsReview, true); assert.equal(a.confidence, 'low');
  assert.ok(a.source.quote.includes('prior to the end of the first Renewal Term'));
});
test('c4 Tradeweb: explicit 1 Nov 2025 – 31 Oct 2028, 180 days, up to two 2-yr extensions', () => {
  assert.equal(C.c4.x.term.start, '2025-11-01'); assert.equal(C.c4.x.term.end, '2028-10-31');
  assert.equal(C.c4.x.renewal.max, 2); assert.equal(C.c4.x.renewal.period.n, 2);
  const a = get('c4', 'Send-notice'); assert.equal(a.date, '2028-05-04'); assert.equal(a.needsReview, true);
  assert.ok(a.source.quote.includes('one hundred and eighty (180) days prior to the expiration'));
  assert.ok(C.c4.x.payments.some(p => /November, February, May and August/.test(p.rule)));
});
test('c5 Schwazze licence: 24 months from 15 Jun 2023, 180 days, projected to next cycle', () => {
  assert.equal(C.c5.x.effective.date, '2023-06-15'); assert.equal(C.c5.x.term.end, '2025-06-14');
  assert.equal(C.c5.x.renewal.period.n, 24); assert.equal(C.c5.x.notice.period.n, 180);
  const a = get('c5', 'Send-notice'); assert.equal(a.date, '2026-12-16'); assert.match(a.why, /Assumes it renewed once/); assert.equal(a.renewed, 1); assert.equal(a.termEnd, '2027-06-14');
});
test('c6 Vivos MSA: 31 Jul 2026, 12 months, 60 days', () => {
  assert.equal(C.c6.x.term.end, '2027-07-30'); const a = get('c6', 'Send-notice'); assert.equal(a.date, '2027-05-31'); assert.equal(a.needsReview, false);
  assert.ok(a.source.quote.includes('at least sixty (60) days prior to the end of the then-current term'));
});
test('c7 Synacor/Qwest: through 31 May 2022, max two 1-yr renewals used -> Expired 31 May 2024, no notice line', () => {
  assert.equal(C.c7.x.term.end, '2022-05-31'); assert.equal(C.c7.x.renewal.max, 2);
  const s = schedule(C.c7.x, AS); const e = s.find(i => i.type.startsWith('Expired'));
  assert.equal(e.date, '2024-05-31'); assert.equal(e.status, 'past');
  assert.ok(!s.some(i => i.type.startsWith('Send-notice') || i.type.startsWith('Auto-renewal')));
  assert.equal(get('c7', 'Send-notice'), undefined);
  // during the last permitted renewal there is nothing left to stop: no live send-notice line, it just expires (reviewer 9eb15a9 B2)
  const s24 = schedule(C.c7.x, '2024-01-01');
  assert.equal(s24.find(i => i.finalTerm).date, '2024-05-31'); assert.equal(s24.find(i => i.type === 'Send-notice deadline (passed)').date, '2023-03-02');
  assert.ok(!s24.some(i => i.actBy));
});
test('c8 Patheon/Vaxcyte: fifteen years; notice redacted -> blank act-by', () => {
  assert.equal(C.c8.x.term.end, '2040-09-24'); assert.equal(C.c8.x.renewal.period.n, 3);
  const a = get('c8', 'Send-notice'); assert.equal(a.date, ''); assert.equal(a.needsReview, true); assert.ok(a.source.quote.includes('[***]'));
});
test('c12 Reborn/Mighty Oak: two years from 10 Aug 2026, 60 days prior to expiration', () => {
  assert.equal(C.c12.x.effective.date, '2026-08-10'); assert.equal(C.c12.x.term.end, '2028-08-09');
  assert.equal(get('c12', 'Send-notice').date, '2028-06-10');
});
test('c13 ARK/Eightco: redacted term -> no expiry, no act-by', () => {
  assert.equal(C.c13.x.term.end, ''); assert.equal(get('c13', 'Send-notice').date, ''); assert.equal(C.c13.x.notice.period.n, 90);
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
  assert.deepEqual(q.map(r => r.id), ['c3', 'c13', 'c8', 'c5', 'c1', 'c6', 'c4', 'c12', 'c2', 'c7']);
  assert.equal(q.filter(r => r.actBy).length, 8);
});
test('as-of control moves the queue', () => { const q = buildQueue(Object.values(C), '2027-01-01').filter(r => r.section === 'upcoming'); assert.equal(q[0].id, 'c1'); });
test('exports', () => {
  const cs = Object.values(C);
  const csv = toCSV(cs, AS); assert.match(csv.split('\r\n')[0], /^contract,filer,counterparty,item,who_acts,date/);
  assert.ok(csv.includes('2030-01-26')); assert.ok(csv.includes('https://www.sec.gov/Archives/edgar/data/771266/'));
  const ics = toICS(cs, AS); assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 8); assert.ok(!ics.includes('20240302')); assert.ok(ics.includes('DTSTART;VALUE=DATE:20261216'));
  assert.ok(ics.split('\r\n').every(l => l.length <= 75));
  const p = toPacket(cs, AS); assert.ok(p.includes('Audit pack')); assert.equal((p.match(/<section>/g) || []).length, 10);
  assert.ok(!/example\.com/.test(csv + ics + p));
});

// ---- upload paths: generated PDF/DOCX conversions of real EDGAR filings (test/fixtures/README.md)
import { pdfLines, docxLines } from './doc-readers.mjs';
test('PDF fixture (c6 Vivos, generated): act-by 2027-05-31 cited with page and in-page lines', () => {
  const x = extract(pdfLines(new URL('./fixtures/c6-vivos-msa.generated.pdf', import.meta.url).pathname));
  const a = schedule(x, AS).find(i => i.type.startsWith('Send-notice'));
  assert.equal(a.date, '2027-05-31'); assert.equal(a.source.page, 2); assert.equal(a.source.location, 'p. 2, lines 25–26');
  assert.ok(a.source.quote.includes('at least sixty (60) days prior to the end of the then-current term'));
  assert.equal(x.effective.source.location.startsWith('p. 1,'), true);
});
test('DOCX fixture (c12 Reborn, generated): act-by 2028-06-10 cited by paragraph', () => {
  const x = extract(docxLines(new URL('./fixtures/c12-reborn-supply.generated.docx', import.meta.url).pathname));
  const a = schedule(x, AS).find(i => i.type.startsWith('Send-notice'));
  assert.equal(x.effective.date, '2026-08-10'); assert.equal(a.date, '2028-06-10'); assert.match(a.source.location, /^¶ \d+/);
});
test('curly-quote whitespace is normalised in quotes', () => {
  assert.equal(norm('(“ Agreement ”)  is'), '(“Agreement”) is');
  for (const id in C) for (const i of schedule(C[id].x, AS)) if (i.source) assert.ok(!/“\s|\s”/.test(i.source.quote), id);
});

// ---- held-out EDGAR exhibits (edgar/holdout/HOLDOUT.md): spot checks of the post-fix behaviour
const H = id => extract(fs.readFileSync(new URL(`../edgar/holdout/raw/${id}.txt`, import.meta.url), 'utf8').split('\n'));
const act = id => schedule(H(id), AS).find(i => i.type.startsWith('Send-notice'));
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
  assert.equal(s.find(i => i.type.startsWith('Send-notice')).date, '2027-10-02');
  assert.equal(x.notice.who, 'Either party');
});
test('leap-year anchor: effective 29 Feb 2024, 1-yr term, yearly renewal -> 28 Feb 2027, flagged', () => {
  const x = extract(['This Agreement is made effective as of February 29, 2024 (the "Effective Date").', 'The term of this Agreement shall commence on the Effective Date and continue for one (1) year.', 'It shall automatically renew for successive one (1) year periods unless either party gives notice at least thirty (30) days prior to the end of the then-current term.']);
  assert.equal(x.term.end, '2025-02-28'); assert.equal(x.term.needsReview, true);
  const s = schedule(x, '2026-03-15');
  assert.equal(s.find(i => /term ends/.test(i.type)).date, '2027-02-28');
  assert.equal(s.find(i => i.type.startsWith('Send-notice')).date, '2027-01-29');
});
test('c4 Tradeweb effective date is the 1 Nov 2025 Amendment Date, not the 2023 Master Agreement date', () => {
  assert.equal(C.c4.x.effective.date, '2025-11-01'); assert.equal(C.c4.x.effective.needsReview, false);
  assert.ok(C.c4.x.effective.source.quote.includes('effective as of November 1, 2025'));
  assert.equal(C.c4.x.effective.source.lineStart, 12);
});
test('Cerus: notice longer than renewal period is called out', () => {
  assert.match(C.c1.x.warnings[0], /longer than each renewal/); assert.match(get('c1', 'Send-notice').why, /two cycles ahead/);
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
  assert.equal(s.find(i => i.type.startsWith('First term you can still stop')).date, '2029-04-20');
  assert.match(s.find(i => i.type.startsWith('First term you can still stop')).why, /term ending 2028-04-20 renews automatically/);
  assert.equal(s.find(i => i.type === 'Auto-renewal').date, '2027-04-21');
  assert.equal(get('c1', 'Send-notice').date, '2027-04-20');
});
test('holdout2 b8 (Acadia/Patheon): current term ends 2026-12-31, not 2028', () => {
  const x = extract(fs.readFileSync(new URL('../edgar/holdout2/raw/b8.txt', import.meta.url), 'utf8').split('\n'));
  const s = schedule(x, AS);
  assert.equal(s.find(i => i.type.startsWith('Current term')).date, '2026-12-31');
  assert.equal(s.find(i => i.type.startsWith('Send-notice')).date, '2026-12-31');
});
test('cross-referenced notice: Amwell (h3) reads Section 7.4 (365 days), flagged, quoting the referenced section', () => {
  const x = H('h3'); assert.equal(x.notice.period.n, 365); assert.equal(x.notice.needsReview, true);
  assert.match(x.notice.source.quote, /^7\.4|three hundred sixty-five/); assert.ok(x.notice.via.quote.includes('Section 7.4'));
  assert.equal(act('h3').date, '2028-01-02');
});
test('cross-reference to a missing section -> flagged, no date', () => {
  const x = extract(['This Agreement is entered into as of January 1, 2026 (the "Effective Date").', 'The term of this Agreement shall commence on the Effective Date and continue for one (1) year.', 'It shall automatically renew for successive one (1) year terms unless a party gives notice of non-renewal pursuant to Section 12.3.']);
  const a = schedule(x, '2026-02-01').find(i => i.type.startsWith('Send-notice'));
  assert.equal(a.date, ''); assert.equal(a.needsReview, true); assert.match(a.why, /Section 12\.3/);
});

// ---- explicit priority rule
test('priority: sections, windows, reasons', () => {
  const q = buildQueue(Object.values(C), AS);
  assert.deepEqual(q.map(r => r.section), ['missed', 'resolve', 'resolve', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'lapsed']);
  const by = Object.fromEntries(q.map(r => [r.id, r]));
  assert.equal(by.c5.why, 'Deadline in 58 days · miss it and it renews for 2 more years');
  assert.match(by.c1.why, /^Deadline in 183 days · miss it and it renews for 1 more year · notice is longer than the renewal/);
  assert.match(by.c7.why, /^Expired 871 days ago · all renewals used/);
  assert.equal(by.c8.why, 'No date found · resolve first: blacked out in the public copy');
  assert.equal(by.c13.why, 'No date found · resolve first: blacked out in the public copy');
  assert.match(PRIORITY_RULE, /1\) Missed/); assert.match(PRIORITY_RULE, /2\) Due within 30 days/);
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
  const e = mk('E-notice-gt-renewal', 'June 1, 2026', 'six (6) month', 'eight (8) months'); // 8 months' notice on 6-month renewals; next act-by 2027-03-30
  const q2 = buildQueue([b, e], '2026-10-19');
  assert.equal(q2[0].window, q2[1].window); assert.equal(q2[0].id, 'E-notice-gt-renewal'); assert.equal(q2[0].noticeLong, true);
});

// ---- test-lead re-run fixes (F1–F11)
const T = (...l) => extract(l);
const base3 = (notice, renew = 'successive one (1) year periods') => T('This Agreement is entered into as of November 20, 2025 (the "Effective Date").', 'The term of this Agreement shall commence on the Effective Date and continue for one (1) year.', `It shall automatically renew for ${renew} unless either party gives ${notice} prior written notice of non-renewal.`);
test('F1 missed notice window: shown at the top until the renewal date passes, then rolls forward', () => {
  const x = base3('at least sixty (60) days');
  const r = buildQueue([{ id: 'm', name: 'M', x }, { id: 'c5', name: C.c5.name, x: C.c5.x }], AS)[0];
  assert.equal(r.id, 'm'); assert.equal(r.section, 'missed');
  assert.deepEqual(r.missed, { actBy: '2026-09-20', renews: '2026-11-20' });
  assert.match(r.why, /^MISSED: send-notice deadline passed 29 days ago · renews 20 Nov 2026/);
  const after = buildQueue([{ id: 'm', name: 'M', x }], '2026-11-20')[0];
  assert.equal(after.section, 'upcoming'); assert.equal(after.actBy, '2027-09-20');
  const c3 = buildQueue([{ id: 'c3', name: 'D', x: C.c3.x }], AS)[0];
  assert.match(c3.why, /^MISSED: send-notice deadline passed 30 days ago · renews 19 Nov 2026/);
});
test('F2 business-day notice: computed skipping weekends, flagged, never called redacted', () => {
  const x = base3('at least ten (10) business days');
  assert.equal(x.notice.period.business, true); assert.doesNotMatch(x.notice.why, /redact/i); assert.match(x.notice.why, /holidays are not modelled/);
  const a = schedule(x, '2026-01-10').find(i => i.actBy);
  assert.equal(a.date, '2026-11-05'); // term ends Thu 19 Nov 2026; 10 weekdays back
  assert.equal(a.needsReview, true); assert.notEqual(a.confidence, 'high');
  const y = base3('at least [***] days'); assert.match(y.notice.why, /blacked out/);
});
test('F6 confidence: a dated act-by is never "none"; cross-referenced notice is medium + needs review', () => {
  for (const c of Object.values(C)) for (const r of buildQueue([c], AS)) if (r.actBy) assert.notEqual(r.confidence, 'none', c.id);
  const x = T('This Agreement is entered into as of January 15, 2026 (the "Effective Date").', 'The term of this Agreement shall commence on the Effective Date and continue for one (1) year.', 'It shall automatically renew for successive one (1) year periods unless a party gives notice of non-renewal pursuant to Section 9.2.', '9.2 Notices. Any notice of non-renewal requires forty-five (45) days prior written notice.');
  const a = schedule(x, AS).find(i => i.actBy);
  assert.equal(a.date, '2026-11-30'); assert.equal(a.confidence, 'medium'); assert.equal(a.needsReview, true);
});
test('F5 b5 "until third anniversary" (no "the")', () => {
  const x = T('This Agreement is entered into as of June 1, 2022 (the "Effective Date").', 'This Agreement shall commence as of the Effective Date and shall continue thereafter until third anniversary of the Effective Date (the "Initial Term").', 'It shall automatically renew for successive one (1) year periods unless either party gives at least thirty (30) days prior written notice of non-renewal.');
  assert.equal(x.term.end, '2025-06-01'); assert.equal(schedule(x, AS).find(i => i.actBy).date, '2027-05-02');
});
test('F8 conditional renewal is flagged; F11 "made as of" effective date', () => {
  const x = T('THIS AGREEMENT is made as of August 3, 2015 (the “Effective Date”).', 'This Agreement will continue until December 31, 2020 (the "Initial Term").', 'This Agreement will automatically renew after the Initial Term for successive terms of two Years each if there is a Product Agreement in effect, unless either Party gives written notice at least 24 months prior to the end of the then-current term.');
  assert.equal(x.effective.date, '2015-08-03'); assert.equal(x.renewal.needsReview, true); assert.match(x.renewal.why, /conditional \("if there is a Product Agreement in effect"\)/);
});
test('F9/F3 lapsed rows sort last; review count has one definition', () => {
  const q = buildQueue(Object.values(C), AS);
  assert.equal(q.at(-1).section, 'lapsed');
  assert.equal(q.filter(r => r.needsReview).length, q.filter(r => r.needsReview).length);
});
test('b9 consecutive renewal periods are read (no "none" confidence)', () => {
  const x = T('This Agreement is entered into as of July 17, 2024 (the "Effective Date").', 'The term of this Agreement shall commence on the Effective Date and continue for five (5) years.', 'This Agreement shall automatically renew for consecutive two (2) year periods each, unless one of the Parties notifies the other of its election not to renew this Agreement at least twenty-four (24) months prior to the end of the Initial Period.');
  assert.equal(x.renewal.period.n, 2); assert.equal(x.renewal.confidence, 'high');
});

// ---- ba7fadd review (R1–R6)
const TS = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../public/data/holdout.json', import.meta.url))).map(c => [c.id, { ...c, x: extract(c.lines) }]));
test('R1 due now: on the deadline day the row sits in "Due now", above resolve-first', () => {
  const q = buildQueue(Object.values(C), '2026-12-16');
  const i = q.findIndex(r => r.id === 'c5');
  assert.equal(q[i].section, 'due'); assert.match(q[i].why, /^Due today · send notice now or it renews for 2 more years/);
  assert.ok(i < q.findIndex(r => r.section === 'resolve'));
  assert.equal(buildQueue([C.c5], '2026-11-16')[0].section, 'due');
  assert.equal(buildQueue([C.c5], '2026-11-15')[0].section, 'upcoming');
});
test('R2 test-set parties: filer from EDGAR, counterparty from the preamble; Patheon groups b3/b8/b10', () => {
  assert.deepEqual(Object.values(TS).filter(c => c.counterparty === 'Patheon').map(c => c.id).sort(), ['b10', 'b3', 'b8']);
  assert.equal(TS.b5.counterparty, 'Thunderra LLC'); assert.equal(TS.b8.filer, 'ACADIA PHARMACEUTICALS INC');
  assert.ok(Object.values(TS).every(c => c.counterparty && c.counterparty !== 'See filing'));
});
test('R4 b9 ranks above b5 by lock-in (2 years vs 1), and 24 months notice is not "longer" than a 2-year renewal', () => {
  const q = buildQueue([TS.b5, TS.b9], AS).map(r => r.id); assert.deepEqual(q, ['b9', 'b5']);
  assert.ok(!TS.b9.x.warnings); assert.ok(!TS.b8.x.warnings);
});
test('R5/R6 honest reasons: b3/b10 undated start (not redaction), b7 monthly evergreen with no notice clause', () => {
  const q = Object.fromEntries(buildQueue(Object.values(TS), AS).map(r => [r.id, r]));
  assert.match(q.b10.why, /undated Commencement Date/); assert.match(q.b3.why, /term start not dated/);
  for (const id of ['b3', 'b10']) assert.doesNotMatch(q[id].why, /redact/i);
  assert.equal(q.b7.why, 'No send-notice deadline: renews every month until terminated, and the contract has no notice clause · current term ends 31 Oct 2026');
});

// ---- 625d6b4 review (N1, N3)
test('N1 missed row: card/packet never pair "Renews" with the next deadline', () => {
  const r = buildQueue([C.c3], AS)[0];
  assert.equal(r.missed.renews, '2026-11-19'); assert.equal(r.label, 'Next send-notice deadline'); assert.equal(r.actBy, '2027-09-19');
  const p = toPacket([C.c3], AS); assert.doesNotMatch(p, /Renews<\/td><td>2027-09-19/); assert.match(p, /<b>MISSED<\/b> · send-notice deadline was 2026-09-19<\/td><td>Renews 2026-11-19<\/td><td>in 31 days · next send-notice deadline 2027-09-19/);
  const ics = toICS([C.c3], AS); assert.match(ics, /SUMMARY:Send-notice deadline: /); assert.doesNotMatch(ics, /Renews/);
  const csv = toCSV([C.c3], AS); assert.match(csv, /Auto-renewal[^\n]*2026-11-19/);
});
test('N3 as-of 25 Nov 2026: dated items within 30 days beat "No date found"', () => {
  const q = buildQueue(Object.values(C), '2026-11-25');
  const i5 = q.findIndex(r => r.id === 'c5'), iRes = q.findIndex(r => r.section === 'resolve');
  assert.equal(q[i5].section, 'due'); assert.equal(q[i5].days, 21); assert.ok(i5 < iRes);
  assert.match(q[i5].why, /^Due in 21 days · send notice now or it renews for 2 more years/);
});

// ---- 2ce8949 review: missed rows in every export, banned jargon in exports
test('exports show Dragonfly as MISSED with the renewal date', () => {
  const ics = toICS([C.c3], AS); assert.match(ics, /DTSTART;VALUE=DATE:20261119/); assert.match(ics, /SUMMARY:MISSED: Dragonfly/);
  const csv = toCSV([C.c3], AS); assert.match(csv, /MISSED send-notice deadline,[^\n]*2026-09-19,-30,[^\n]*renews automatically on 2026-11-19/);
  const p = toPacket([C.c3], AS); assert.match(p, /MISSED/); assert.match(p, /Renews 2026-11-19/);
});
export const BANNED = /ambiguous|= end of term|act-by|ambiguous drafting|computable expiry|Notice window missed|negotiated exit|Exhibit 10|Party \(filer\)|Contract lifecycle|diligence|\b(?:high|medium|low|none) confidence|Confidence: (?:high|medium|low|none)/i;
test('no banned jargon in CSV, .ics or audit pack (SEC set and test set)', () => {
  for (const set of [Object.values(C), Object.values(TS)]) {
    const csv = toCSV(set, AS); const conf = csv.split('\r\n').slice(1).filter(Boolean).map(l => l.match(/,(Sure|Check this|Can’t tell|high|medium|low|none),(yes|no),/)?.[1]);
    assert.ok(conf.every(c => ['Sure', 'Check this', 'Can’t tell'].includes(c)), 'CSV confidence words: ' + [...new Set(conf)]);
    for (const [name, out] of [['csv', csv], ['ics', toICS(set, AS)], ['pack', toPacket(set, AS)]]) { const m = out.match(BANNED) || out.match(/\bAct by\b/); assert.equal(m, null, `${name}: "${m?.[0]}"`); }
  }
});

// ---- 5a223ac review: plain review tags
test('review tags: no formulas, no "ambiguous", plain redaction wording, Acadia condition', () => {
  const all = [...buildQueue(Object.values(C), AS), ...buildQueue(Object.values(TS), AS)];
  for (const r of all) if (r.needsReview) { assert.doesNotMatch(r.tag, /=|ambiguous|\d+ (?:day|month|year)\(s\)|redacted/i, r.id + ': ' + r.tag); }
  assert.equal(all.find(r => r.id === 'b8').tag, 'renewal depends on a condition; confirm it holds');
  assert.equal(all.find(r => r.id === 'c8').tag, 'blacked out in the public copy');
  assert.equal(all.find(r => r.id === 'c3').tag, 'unclear which term the notice counts from');
});

// ---- 41f4d03 review: weekend / US federal holiday deadlines
test('safeSendBy: weekend and federal-holiday deadlines step back to a business day', () => {
  const q = Object.fromEntries([...buildQueue(Object.values(C), AS), ...buildQueue(Object.values(TS), AS)].map(r => [r.id, r]));
  assert.equal(q.c12.safe.date, '2028-06-09'); assert.equal(q.c12.safe.note, 'Falls on a Saturday · send by Fri 9 Jun 2028 to be safe'); assert.equal(q.c12.actBy, '2028-06-10');
  assert.equal(q.c2.safe.date, '2030-01-25');
  assert.equal(q.c6.safe.date, '2027-05-28'); assert.match(q.c6.safe.reason, /Memorial Day/);
  assert.equal(q.c3.safe.date, '2027-09-17'); assert.equal(q.c3.actBy, '2027-09-19');
  assert.equal(q.b5.safe.date, '2027-04-30');
  assert.equal(q.c5.safe, null); assert.deepEqual(safeSendBy('2026-12-16'), { date: '2026-12-16', changed: false, reason: '' });
  assert.equal(safeSendBy('2027-12-25').date, '2027-12-23'); // Christmas on Saturday, observed Fri 24 Dec, so Thu 23
  for (let y = 2026; y <= 2035; y++) assert.equal(usHolidays(y).size, 11);
});
test('safe send-by in exports: CSV column, .ics on the safe day, audit-pack lines', () => {
  const csv = toCSV([C.c12], AS); assert.match(csv.split('\r\n')[0], /,send_by_business_day,/); assert.match(csv, /Send-notice deadline,[^\n]*,2028-06-10,\d+,2026-10-19,2028-06-09,/);
  const ics = toICS([C.c12], AS); assert.match(ics, /DTSTART;VALUE=DATE:20280609/); assert.doesNotMatch(ics, /DTSTART;VALUE=DATE:20280610/); assert.match(ics.replace(/\r\n /g, ''), /Contract date: 2028-06-10\\, which falls on a Saturday/);
  const p = toPacket(Object.values(C), AS); assert.match(p, /Reborn \/ Mighty Oak: contract date 2028-06-10 · Falls on a Saturday · send by 2028-06-09 to be safe/); assert.equal((p.match(/to be safe\./g) || []).length, 4);
});

test('holidays by rule for any year: Christmas 2036 (Thursday) and New Year 2039 observed on Fri 31 Dec 2038', () => {
  assert.equal(usHoliday('2036-12-25'), 'Christmas Day'); assert.equal(safeSendBy('2036-12-25').date, '2036-12-24');
  assert.equal(usHoliday('2038-12-31'), "New Year's Day"); assert.equal(usHoliday('2036-11-27'), 'Thanksgiving Day');
  assert.equal(safeSendBy('2041-07-04').date, '2041-07-03');
});
test('safe date already passed but contract date not: send today, never "to be safe"', () => {
  const r = buildQueue([C.c3], '2027-09-18')[0];
  assert.equal(r.actBy, '2027-09-19'); assert.equal(r.safe.passed, true);
  assert.equal(r.safe.note, 'Falls on a Sunday. The last business day before it (Fri 17 Sep 2027) has passed. Send today and confirm delivery.');
  assert.doesNotMatch(r.safe.note, /to be safe/);
  const csv = toCSV([C.c3], '2027-09-18'); assert.match(csv, /2027-09-17 \(passed; send today and confirm delivery\)/);
  const ics = toICS([C.c3], '2027-09-18').replace(/\r\n /g, ''); assert.match(ics, /DTSTART;VALUE=DATE:20270918/); assert.match(ics, /has passed. Send today and confirm delivery/); assert.doesNotMatch(ics, /to be safe/);
  const p = toPacket([C.c3], '2027-09-18'); assert.match(p, /has passed. Send today and confirm delivery/); assert.doesNotMatch(p, /to be safe/);
});

// ---- F&P nits + own-contracts helpers ----
import { dayWord, htmlToLines, usHolidays as _uh, safeSendBy as _ssb } from '../public/extract.js';
test('plural: 1 day, 2 days, 0 days', () => { assert.equal(dayWord(1), '1 day'); assert.equal(dayWord(-1), '-1 day'); assert.equal(dayWord(2), '2 days'); assert.equal(dayWord(0), '0 days'); });
test('app.js never builds "N days" without dayWord', async () => { const s = (await import('node:fs')).readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'); assert.doesNotMatch(s, /\+ ' days|\} days`|d \+ ' days'/); });
test('late .ics reminder lands on the as-of date, not the contract date', () => {
  const ics = toICS([C.c3], '2027-09-18').replace(/\r\n /g, ''); assert.match(ics, /DTSTART;VALUE=DATE:20270918/); assert.doesNotMatch(ics, /DTSTART;VALUE=DATE:20270919/);
  const ok = toICS([C.c3], '2027-09-01').replace(/\r\n /g, ''); assert.match(ok, /DTSTART;VALUE=DATE:20270917/);
});
test('README lists only the fonts actually used', async () => { const r = (await import('node:fs')).readFileSync(new URL('../README.md', import.meta.url), 'utf8'); assert.doesNotMatch(r, /Bodoni|Source Serif|JSZip/); assert.match(r, /Geist/); });
test('Juneteenth only from 2021', () => { assert.equal([..._uh(2020).values()].includes('Juneteenth'), false); assert.equal([..._uh(2021).values()].includes('Juneteenth'), true); assert.equal(_ssb('2020-06-19').changed, false); assert.equal(_ssb('2026-06-19').changed, true); });
test('malformed dates do not crash safeSendBy', () => { for (const d of ['2026-02-30', 'junk', '', null, undefined, 42, '2026-13-01', '26-1-1', {}]) assert.deepEqual(_ssb(d), { date: '', changed: false, reason: '' }); });
test('htmlToLines matches the totext.py method', () => {
  assert.deepEqual(htmlToLines('<html><style>p{}</style><script>x</script><p>A&nbsp; <b>b</b></p><div>C&amp;D</div><br><table><tr><td>e</td><td>f&#8217;s</td></tr></table>'), ['A b', 'C&D', 'e', 'f’s']);
});

test('day counts are exact calendar days to the printed date', async () => {
  const { daysBetween } = await import('../public/extract.js');
  for (const [a, b, n] of [['2026-10-20', '2030-01-26', 1194], ['2026-10-19', '2030-01-26', 1195], ['2026-10-20', '2030-01-25', 1193], ['2026-10-20', '2026-12-16', 57], ['2026-10-19', '2026-12-16', 58], ['2026-10-20', '2027-09-19', 334], ['2026-10-20', '2027-09-17', 332], ['2026-09-19', '2026-10-20', 31], ['2026-10-20', '2026-10-20', 0], ['2027-02-28', '2028-02-29', 366], ['2026-03-07', '2026-03-09', 2], ['2026-10-31', '2026-11-02', 2]]) assert.equal(daysBetween(a, b), n, `${a} -> ${b}`);
  const r = buildQueue([C.c2], '2026-10-20')[0]; assert.equal(r.actBy, '2030-01-26'); assert.equal(r.days, 1194); assert.equal(r.safe.date, '2030-01-25');
});

// ---- independent review of 7593ee9: real unseen EDGAR exhibits ----
test('ReposiTrak: "initial term of employment shall be three (3) years commencing on the Effective Date" -> 2029-08-17', async () => {
  const { htmlToLines, partiesFromPreamble } = await import('../public/extract.js');
  const L = htmlToLines(fs.readFileSync(new URL('./fixtures/repositrak-cfo-ex10-1.edgar.htm', import.meta.url), 'utf8')); const x = extract(L);
  assert.equal(x.effective.date, '2026-08-18'); assert.equal(x.term.end, '2029-08-17'); assert.equal(x.renewal.period.n, 1);
  assert.equal(buildQueue([{ id: 'r', name: 'r', lines: L, x }], '2026-10-19')[0].actBy, '2029-06-18');
  assert.equal(partiesFromPreamble(L), 'ReposiTrak / John R. Merrill');
});
test('Alphega: "one (1)-year" renewals parsed; explicit "through December 31, 2028" is high confidence', async () => {
  const { htmlToLines, partiesFromPreamble } = await import('../public/extract.js');
  const L = htmlToLines(fs.readFileSync(new URL('./fixtures/alphega-ceo-ex10-1.edgar.htm', import.meta.url), 'utf8')); const x = extract(L);
  assert.equal(x.term.end, '2028-12-31'); assert.equal(x.term.confidence, 'high'); assert.deepEqual([x.renewal.period.n, x.renewal.period.unit], [1, 'year']);
  const r = buildQueue([{ id: 'a', name: 'a', lines: L, x }], '2026-10-19')[0]; assert.equal(r.actBy, '2028-10-02'); assert.equal(r.confidence, 'high');
  assert.equal(partiesFromPreamble(L), 'Alphega Innovations / Luis Carlos Ung');
});
test('duration with a hyphen after the bracket: "one (1)-year", "twelve (12)-month"', () => {
  assert.deepEqual([parseDuration('one (1)-year').n, parseDuration('one (1)-year').unit], [1, 'year']);
  assert.deepEqual([parseDuration('twelve (12)-month periods').n, parseDuration('twelve (12)-month periods').unit], [12, 'month']);
});
test('no stray ")." and no "(s)" or "Projected forward" in send-notice explanations', () => {
  for (const c of Object.values(C)) for (const r of buildQueue([c], '2026-10-19')) { const w = r.item?.why || ''; assert.doesNotMatch(w, /\)\.\)|\.\)\.|day\(s\)|month\(s\)|Projected forward/, c.id + ': ' + w); }
});
test('party names from the preamble, falling back to nothing', async () => {
  const { partiesFromPreamble } = await import('../public/extract.js');
  assert.equal(partiesFromPreamble(['This Agreement is made by and between ACME CORP., a Delaware corporation ("Acme"), and Beta LLC ("Beta").']), 'Acme / Beta');
  assert.equal(partiesFromPreamble(['Shopping list: eggs and milk.']), '');
});

// ---- independent review of a882e8b ----
test('Star Brands check line is built from the previous cycle', async () => {
  const { checkLine } = await import('../public/extract.js');
  assert.equal(checkLine(buildQueue([C.c5], '2026-10-20')[0].item), 'Check: did either side send notice by 16 Dec 2024? If not, it renewed on 15 Jun 2025.');
});
test('party names: "between:" with a colon (Argent / Splash) and an omitted party (Nanochem)', async () => {
  const { htmlToLines, partiesFromPreamble } = await import('../public/extract.js');
  const rd = f => htmlToLines(fs.readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8'));
  const arg = rd('argent-splash-ex10-1.edgar.htm'), nan = rd('nanochem-supply-ex10-3.edgar.htm');
  assert.equal(partiesFromPreamble(arg), 'Argent Biopharma / Splash Beverage Group'); assert.equal(partiesFromPreamble(nan), 'Nanochem / party withheld in filing');
  assert.equal(buildQueue([{ id: 'a', name: 'a', lines: arg, x: extract(arg) }], '2026-10-19')[0].actBy, '2045-07-05');
  assert.equal(buildQueue([{ id: 'n', name: 'n', lines: nan, x: extract(nan) }], '2026-10-19')[0].actBy, '2029-07-10');
});
test('holidays by rule for any year (2045, 2099)', () => {
  const h45 = usHolidays(2045); assert.equal(h45.size, 11); assert.equal(h45.get('2045-07-04'), 'Independence Day'); assert.equal(h45.get('2045-11-23'), 'Thanksgiving Day');
  assert.equal(usHoliday('2099-01-19'), 'Martin Luther King Jr. Day'); assert.equal(safeSendBy('2045-12-25').changed, true);
});

// ---- independent review of 08408a1: B1–B4, fixtures fetched from sec.gov ----
const fx = f => { const L = htmlToLines(fs.readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8')); const x = extract(L); return { L, x, r: buildQueue([{ id: 'f', name: 'f', lines: L, x }], '2026-10-19')[0] }; };
test('B1 Par Health: "until the date that is five (5) years from the Effective Date"', () => {
  const { x, r } = fx('parhealth-endo-ex10-4.edgar.htm');
  assert.equal(x.effective.date, '2025-11-10'); assert.equal(x.term.end, '2030-11-10'); assert.equal(x.term.rule, 'until');
  assert.equal(r.actBy, '2029-11-10'); assert.equal(r.safe.date, '2029-11-09'); assert.equal(r.confidence, 'high');
});
test('B2 SunCoke: stated "no later than December 31, 2027" used, high; "December 31, 2 2028" tolerated', () => {
  const { x, r } = fx('suncoke-haverhill-ex10-1.edgar.htm');
  assert.equal(ymd(parseDate('December 31, 2 2028').date), '2028-12-31');
  assert.equal(x.term.end, '2028-12-31'); assert.equal(x.notice.date, '2027-12-31');
  assert.equal(r.actBy, '2027-12-31'); assert.equal(r.confidence, 'high'); assert.equal(r.needsReview, false);
  assert.equal(r.safe.date, '2027-12-30'); assert.match(r.safe.reason || JSON.stringify(r.safe), /New Year/);
});
test('DMY dates parse ("10 November 2025")', () => assert.equal(ymd(parseDate('effective as of 10 November 2025').date), '2025-11-10'));
test('B3 Ethena: date kept; Effective Date now found in the body, so no review needed', () => {
  const { r } = fx('ethena-stablecoinx-ex10-12.edgar.htm');
  assert.equal(r.actBy, '2027-02-12'); assert.equal(r.confidence, 'high');
  assert.doesNotMatch(shortReason('The send-notice deadline is the end of the term minus 60 days. x'), /end of the term minus/);
});
test('B3 early-exit tag when a reviewed date coexists with a convenience exit; date never dropped', () => {
  const t = ['This Services Agreement is dated April 14, 2026, by and between Alpha Corp and Beta LLC.', 'The initial term of this Agreement shall be one (1) year commencing on the Effective Date.', 'Upon expiration of the Initial Term, this Agreement shall automatically renew for successive one (1) year periods unless either Party provides written notice of non-renewal at least sixty (60) days prior to the expiration of the then-current Term.', 'Either Party may terminate this Agreement at any time, for any reason or no reason, by providing at least thirty (30) days\u2019 prior written notice to the other Party.'];
  const x = extract(t); const r = buildQueue([{ id: 's', name: 's', lines: t, x }], '2026-10-19')[0];
  assert.equal(r.actBy, '2027-02-12'); assert.equal(r.needsReview, true); assert.equal(r.tag, 'start date 14 Apr 2026 is taken from the "dated / as of" line, not a defined Effective Date; confirm it'); // 6ca64e8 #5: the check names the assumption the date rests on
});
test('B3 no fixture tag says "end of the term minus"', () => {
  for (const f of fs.readdirSync(new URL('./fixtures/', import.meta.url)).filter(f => f.endsWith('.edgar.htm'))) assert.doesNotMatch(fx(f).r.tag || '', /end of the term minus/i, f);
});
test('B4 party names cut and case-normalised', () => {
  assert.equal(partiesFromPreamble(fx('parhealth-endo-ex10-4.edgar.htm').L), 'Par Health USA / Endo Biologics');
  assert.equal(partiesFromPreamble(fx('suncoke-haverhill-ex10-1.edgar.htm').L), 'Haverhill Coke / Cleveland-Cliffs Steel');
  assert.equal(partiesFromPreamble(fx('ethena-stablecoinx-ex10-12.edgar.htm').L), 'Ethena OpCo / StablecoinX');
});

// ---- review of 5d1eaa4 (B1–B5) + 15-exhibit blind batch; sources in test/fixtures/SOURCES.txt; dates worked out by hand, as of 2026-10-19 ----
const EXPECT = {
  'waterbridge-dbr-ex10-8': ['2027-07-04', '2027-07-02'], 'reshape-stankovich-ex10-8': ['2027-07-30'], 'amtd-worldmedia-ex10-8': ['2044-07-26'], 'urbangro-akright-ex10-1': ['2026-11-17'],
  'cokeconsol-consulting-ex10-1': ['2026-12-01'], 'cyclerion-ex10-1': ['2027-07-04', '2027-07-02'], 'entravision-ex10-1': ['2027-03-01'], 'natvision-ex10-1': ['2028-05-01'],
  'nextplat-ex10-1': ['2028-10-02'], 'nuvera-ex10-1': ['2027-10-02', '2027-10-01'], 'orion-ex10-1': ['2026-11-01', '2026-10-30'], 'purple-ex10-8': ['2027-10-02', '2027-10-01'],
  'redviolet-ex10-1': ['2029-12-02', '2029-11-30'], 'streamline-ex10-2': ['2027-09-30'], 'trex-ex10-1': ['2028-08-01'],
  // flagged, no date: notice/term not in this document, redacted, or no notice period stated
  'nfg-ex10-1': [''], 'spar-ex10-6': [''], 'astrotech-ex10-9': [''], 'grainger-ex10-4': [''], 'marqeta-ex10-1': [''], 'csg-ex10-28j': [''], 'belfuse-ex10-3': [''], 'veeva-ex10-10': [''], 'tucows-ex10-1': [''],
};
for (const [f, [act, safe]] of Object.entries(EXPECT)) test(`fixture ${f} → ${act || 'flagged, no date'}`, () => {
  const { r } = fx(f + '.edgar.htm'); assert.equal(r.actBy || '', act); if (safe) assert.equal(r.safe?.date, safe); if (!act) assert.equal(r.needsReview, true);
});
test('B4 "This Agreement shall continue through and including <date>" → term end', () => {
  const t = ['This Supply Agreement is made effective as of November 1, 2025 (the “Effective Date”) by and between Acme Inc. and Beta LLC.', 'This Agreement shall continue in full force and effect through and including November 1, 2030, unless terminated earlier.'];
  assert.equal(extract(t).term.end, '2030-11-01');
});
test('B2 "Te1m" typo read as Term', () => { const t = ['This Agreement is effective as of March 1, 2025 (the “Effective Date”) between Acme Inc. and Beta LLC.', 'The initial te1m of this Agreement shall be two (2) years commencing on the Effective Date.']; assert.equal(extract(t).term.end, '2027-02-28'); });
test('B5 quotes stop at a numbered sub-clause; "by and among"', async () => {
  const { trimQuote } = await import('../public/extract.js');
  assert.equal(trimQuote('This Agreement shall commence on the Transition Date and last for three months (the Term). 2In the event of a termination, fees are due.'), 'This Agreement shall commence on the Transition Date and last for three months (the Term).');
  assert.equal(partiesFromPreamble(fx('urbangro-akright-ex10-1.edgar.htm').L), 'urban-gro / Richard Akright');
});
test('party names: amendment title skipped, letters, "(i) … ; (ii)" lists', () => {
  const N = { 'purple-ex10-8': 'Purple / Mattress Firm', 'entravision-ex10-1': 'Entravision / Univision Network', 'belfuse-ex10-3': 'Bel Fuse / Daniel Bernstein', 'grainger-ex10-4': 'W.W. Grainger / Susan Slavik Williams', 'spar-ex10-6': 'SPAR Group / Ron Lutz', 'natvision-ex10-1': 'Essilor / National Vision', 'nfg-ex10-1': 'National Fuel Gas / Donna L. DeCarolis' };
  for (const [f, n] of Object.entries(N)) assert.equal(partiesFromPreamble(fx(f + '.edgar.htm').L), n, f);
});

// ---- reviewer 9eb15a9 B1–B4 (sec.gov fixtures; hand-worked, as of 2026-10-19) ----
test('B1 FST: no fixed term, "deemed automatically extended" each anniversary; notice 30 days before the Renewal Date → 2027-03-30', () => { const { x, r } = fx('fst-huang-ex10-9.edgar.htm'); assert.equal(x.term.end, '2026-04-28'); assert.equal(x.notice.ref, 'start'); assert.equal(r.actBy, '2027-03-30'); });
test('B1 NANO: "until the third (3rd) anniversary thereof", Renewal Date − 90 days → 2027-12-07', () => { const { x, r } = fx('nano-heidet-ex10-1.edgar.htm'); assert.equal(x.term.end, '2028-03-05'); assert.equal(r.actBy, '2027-12-07'); });
test('B2 ONM: "for a period of five (5) years" + one additional two-year term → passed, extended to 8 Jul 2028, then expires', () => {
  const { x, r } = fx('onm-ikigai-ex10-19.edgar.htm'); assert.equal(x.term.end, '2026-07-08'); assert.equal(x.renewal.max, 1);
  assert.equal(r.label, 'Expires (no further renewal)'); assert.equal(r.actBy, '2028-07-08'); assert.equal(r.why, 'Send-notice date passed (9 Jan 2026) · extended to 8 Jul 2028, then it expires; no further renewal');
});
test('B3 names: word-boundary cut with ellipsis, acronyms kept', () => {
  assert.equal(partiesFromPreamble(fx('fst-huang-ex10-9.edgar.htm').L), 'Warren Cheng-Teng Huang / FST');
  const h = partiesFromPreamble(fx('hci-reins-ex10-13.edgar.htm').L); assert.ok(h.split(' / ').every(p => p.length <= 41), h);
  assert.match(h, /^Condo Owners Reciprocal Exchange and…/);
});
test('B4 letter-of-credit renewal is not the agreement\'s clause', () => {
  for (const f of ['douglas-lease-ex10-1', 'hci-reins-ex10-13']) { const { x, r } = fx(f + '.edgar.htm'); assert.equal(x.renewal, null, f); assert.ok(!r.label.startsWith('Send-notice'), f); }
  assert.equal(fx('douglas-lease-ex10-1.edgar.htm').x.renewalNote, 'No renewal clause for the agreement itself (the only automatic renewal found is for a letter of credit).');
});
// ---- 20-exhibit "deemed extended" / anniversary batch (EDGAR full-text search, 2025–2026); hand-worked as of 2026-10-19 ----
const EXPECT2 = {
  'angiodynamics-ex10-1': '2027-09-03', 'arrow-demarco-ex10-1': ['2027-01-02', '2026-12-31'], 'atlasclear-ex10-3': '2028-07-21', 'cffi-ex10-40': '2027-01-15',
  'dnow-ex10-2': '2027-09-07', 'fibk-lee-ex10-1': '2027-06-15', 'firstfoundation-ex10-1': '2027-09-17', 'glacier-ex10-l': '2026-10-22', 'gormanrupp-ex10-1': '2027-10-01',
  'hornbeck-ex10-1': '2031-10-02', 'photronics-ex10-1': ['2027-07-10', '2027-07-09'], 'rekor-ex10-1': ['2028-04-01', '2028-03-31'], 'renasant-ex10-1': ['2028-08-06', '2028-08-04'], // ab9a38e: term runs from the defined Start Date (5 Oct 2026; movable by agreement → Check), not the signing date
  'smenergy-ex10-1': ['2026-11-01', '2026-10-30'], 'xponential-ex10-1': ['2026-11-14', '2026-11-13'],
  // flagged, no date: letter of credit; "date hereof" undated; merger "Effective Time" not dated; Effective Date not dated in the filing
  'dirtt-ex10-1': '', 'idexx-ex10-56': '', 'psb-ex10-3': '', 'thirdcoast-ex10-1': '', 'westrock-ex10-15': '',
};
for (const [f, e] of Object.entries(EXPECT2)) test(`batch2 ${f} → ${(Array.isArray(e) ? e[0] : e) || 'flagged'}`, () => {
  const [act, safe] = Array.isArray(e) ? e : [e]; const { r } = fx(f + '.edgar.htm');
  assert.equal(r.actBy || '', act); if (safe) assert.equal(r.safe?.date, safe); if (!act) assert.equal(r.needsReview, true);
  assert.doesNotMatch(r.tag || '', /minus|end of the term/i);
});
// ---- reviewer 8200b4e blockers ----
test('B1 Green Plains: "commence on 00:00 a.m. (CST) on <date> and continue for five years" → 24 Oct 2029', () => {
  const { x, r } = fx('greenplains-eco-ex10-1.edgar.htm');
  assert.equal(x.term.start, '2025-04-23'); assert.equal(x.term.end, '2030-04-22'); assert.equal(r.actBy, '2029-10-24'); assert.equal(r.confidence, 'high');
});
test('B2 GEVI/Conboy: anchorless "period of 24 months" runs from the Effective Date at Check confidence → 29 Jan 2027', () => {
  const { x, r } = fx('gevi-conboy-ex10-3.edgar.htm');
  assert.equal(x.term.end, '2027-02-28'); assert.equal(r.actBy, '2027-01-29'); assert.equal(r.confidence, 'medium'); assert.equal(r.needsReview, true);
});
test('B3 VerifyMe/Pentant: first-term-only notice passed, then quarterly renewal', () => {
  const { r } = fx('verifyme-pentant-ex10-3.edgar.htm');
  assert.equal(r.why, 'Send-notice date passed (1 Apr 2025). Now renews every 3 months; the contract gives no non-renewal notice for later periods. Check the termination section.');
  assert.doesNotMatch(JSON.stringify(r), /No notice period found/i); assert.equal(r.tag, '');
});
test('B4 Spin AI: term length found, signing date not in document', () => {
  const { x, r } = fx('spinai-saas-ex10-8.edgar.htm');
  assert.equal(x.term.why, "Term is 36 months from signing; the signing date isn't in the document.");
  assert.doesNotMatch(r.why + r.tag, /no term found/i);
});
test('B4 drawer: no file name standing in for the other company', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /counterparty:\s*meta\.counterparty\s*\|\|\s*base/); assert.match(app, /other company/); assert.doesNotMatch(app, /· counterparty /);
});
test('party names: junk second parties dropped or repaired', () => {
  const P = f => partiesFromPreamble(fx(f + '.edgar.htm').L);
  assert.equal(P('smenergy-ex10-1'), 'SM Energy'); assert.equal(P('thirdcoast-ex10-1'), 'Jeff Wilkinson / Third Coast Bank');
  assert.equal(P('gormanrupp-ex10-1'), 'Gorman-Rupp'); assert.equal(P('idexx-ex10-56'), 'IDEXX Laboratories'); assert.equal(P('glacier-ex10-l'), 'Glacier Bancorp / Glacier Bank');
  assert.equal(P('sugar-hill-ex10-13'), 'Sugar Auto Parts / Michael Hill');
});
// ---- 21-exhibit sweep (stated starts, "period of N", first-term notice, services/supply/licence/employment); hand-worked as of 2026-10-19 ----
const EXPECT3 = {
  'stark-szot-ex10-1': ['2027-08-08', '2027-08-06'], 'insight-azagury-ex10-3': '2027-02-11', 'angi-hoarau-ex10-1': ['2026-12-27', '2026-12-24'],
  'stbancorp-mccomish-ex10-1': '2029-07-05', 'cipher-page-ex10-1': ['2029-05-06', '2029-05-04'], 'sugar-hill-ex10-13': ['2028-01-30', '2028-01-28'],
  'hffoods-mcgarry-ex10-2': '2027-06-29', 'shift4-cruz-ex10-1': ['2028-05-07', '2028-05-05'], 'nextboat-ex10-1': ['2030-06-29', '2030-06-28'],
  'redwire-edmunds-ex10-1': '2028-11-01', 'benchmark-moezidis-ex10-1': ['2028-01-01', '2027-12-30'], 'aspen-thoele-ex10-1': '2027-08-02',
  'argent-splash-license-ex10-1': '2045-07-05', 'splash-lupvindol-ex10-1': '2031-05-01', 'haverhill-coke-ex10-1': ['2027-12-31', '2027-12-30'],
  'fsi-nanochem-supply-ex10-4': '2030-05-08', 'realloys-consulting-ex10-2': ['2028-03-25', '2028-03-24'], 'greendot-separation-ex10-1': '2032-05-26',
  // flagged, no date: notice redacted (Curant, Vaxcyte); start "the date after both Parties sign" and no notice (WuXi)
  'corcept-curant-ex10-24': '', 'vaxcyte-manuf-ex10-1': '', 'wuxi-viridian-ex10-1': '',
};
for (const [f, e] of Object.entries(EXPECT3)) test(`batch3 ${f} → ${(Array.isArray(e) ? e[0] : e) || 'flagged'}`, () => {
  const [act, safe] = Array.isArray(e) ? e : [e]; const { r } = fx(f + '.edgar.htm');
  assert.equal(r.actBy || '', act); if (safe) assert.equal(r.safe?.date, safe); if (!act) assert.equal(r.needsReview, true);
  assert.doesNotMatch(r.tag || '', /minus|end of the term/i);
});
test('batch3 review flags: conditional extension, blank MSA date, Production Commencement Date', () => {
  for (const f of ['splash-lupvindol-ex10-1', 'greendot-separation-ex10-1', 'fsi-nanochem-supply-ex10-4']) assert.equal(fx(f + '.edgar.htm').r.needsReview, true, f);
});
// ---- reviewer ab9a38e: all 11 fixes (real sec.gov fixtures; hand-worked as of 2026-10-19; sources in test/fixtures/SOURCES.txt) ----
const fxt = f => { const L = fs.readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8').split(/\r?\n/); const x = extract(L); return { L, x, r: buildQueue([{ id: 'f', name: 'f', lines: L, x }], AS)[0] }; };
test('ab9a38e #1 Altech: "commence on 18 January 2022 ... ending on 17 January 2023" (DMY), annual, 30 days → Fri 18 Dec 2026', () => {
  for (const g of [fx('altech-ex10-6.edgar.htm'), fxt('altech-ex10-6.pdftotext.txt')]) {
    assert.equal(g.x.term.start, '2022-01-18'); assert.equal(g.x.term.end, '2023-01-17'); assert.equal(g.r.actBy, '2026-12-18'); assert.equal(g.r.needsReview, false);
  }
  assert.equal(ymd(parseDate('commence on 18 January 2022').date), '2022-01-18');
});
test('ab9a38e #2 VerifyMe: initial-only notice passed → item carries the passed date and renewal length, never "no renewal"', () => {
  const { x, r } = fx('verifyme-pentant-ex10-3.edgar.htm');
  assert.ok(x.renewal); assert.equal(r.item.initialOnlyPassed, true); assert.equal(r.item.prevActBy, '2025-04-01'); assert.deepEqual(r.item.renewEvery, { n: 3, unit: 'month' }); assert.ok(r.item.source?.quote);
});
test('ab9a38e #3 Simwon: "[2024.08.07] to [2024.12.31]" template dates, yearly, 3 months → missed 30 Sep 2026, next 30 Sep 2027 (Check)', () => {
  for (const g of [fx('simwon-mstech-ex10-14.edgar.htm'), fxt('simwon-mstech-ex10-14.pdftotext.txt')]) {
    assert.equal(g.x.term.start, '2024-08-07'); assert.equal(g.x.term.end, '2024-12-31'); assert.equal(g.x.term.confidence, 'medium'); assert.equal(g.x.renewal.period.n, 1);
    assert.equal(g.r.missed.actBy, '2026-09-30'); assert.equal(g.r.missed.renews, '2027-01-01'); assert.equal(g.r.actBy, '2027-09-30'); assert.equal(g.r.needsReview, true); assert.match(g.r.tag, /template/);
  }
  assert.equal(ymd(parseDate('[2024.08.07]').date), '2024-08-07');
});
test('ab9a38e #7 term length only from the term section: non-solicit / non-compete lengths are never quoted', () => {
  const g = fx('industrious-ex10-1.edgar.htm'); assert.doesNotMatch(g.x.term.source.quote, /solicit/i);
  const t = extract(['This Agreement is made effective as of March 1, 2026 (the "Effective Date").', 'Member will not, during the Term of this Agreement and for a period of one (1) year thereafter, solicit the employment of any employee of the Company.', 'The covenant not to compete will remain in effect for six (6) months following the date of the settlement agreement.']);
  assert.equal(t.term, null); assert.match(schedule(t, AS).find(i => i.type === 'Term / expiry').why, /No term length found/);
});
test('ab9a38e #9 Industrious: dates from the label/value table, renewals equal to the Initial Term, 2 full calendar months → 30 Nov 2026 (Check)', () => {
  for (const g of [fx('industrious-ex10-1.edgar.htm'), fxt('industrious-ex10-1.pdftotext.txt')]) {
    assert.equal(g.x.term.start, '2025-02-01'); assert.equal(g.x.term.end, '2025-07-31'); assert.equal(g.x.term.confidence, 'medium');
    assert.deepEqual([g.x.renewal.period.n, g.x.renewal.period.unit], [6, 'month']); assert.equal(g.x.notice.period.full, true);
    assert.equal(g.r.actBy, '2026-11-30'); assert.equal(g.r.needsReview, true);
  }
});
test('ab9a38e #10 National Vision: one-sided extension right noted, date unchanged (1 May 2028, Clear)', () => {
  const g = fx('natvision-ex10-1.edgar.htm'); assert.equal(g.r.actBy, '2028-05-01'); assert.equal(g.r.confidence, 'high'); assert.match(g.x.extension.note, /^One-sided extension right: Customer can extend the agreement an additional calendar quarter/);
  assert.equal(fx('douglas-lease-ex10-1.edgar.htm').x.extension, undefined);
});
test('ab9a38e #11 party names: no "following parties:", no list numbers, no generic roles', () => {
  assert.equal(partiesFromPreamble(fx('simwon-mstech-ex10-14.edgar.htm').L), 'MS Autotech / Simwon America');
  assert.equal(partiesFromPreamble(fxt('simwon-mstech-ex10-14.pdftotext.txt').L), 'MS Autotech / Simwon America');
  assert.equal(partiesFromPreamble(fxt('industrious-ex10-1.pdftotext.txt').L), 'Industrious / Member');
  assert.equal(partiesFromPreamble(fxt('altech-ex10-6.pdftotext.txt').L), 'Altech Hong Kong / Alliance Technology Global');
});
// #5 / #8: every fixture gives the same dates whatever the line split (block tags, re-wrapped at 72 and at 140 characters, one line per sentence-ish chunk)
const rewrap = (L, w) => L.flatMap(l => { const out = []; let cur = ''; for (const wd of String(typeof l === 'string' ? l : l.text).split(' ')) { if (cur && (cur + ' ' + wd).length > w) { out.push(cur); cur = wd; } else cur = cur ? cur + ' ' + wd : wd; } if (cur) out.push(cur); return out; });
const sigOf = L => schedule(extract(L), AS).map(i => i.type + ':' + (i.date || '-')).join(' | ');
test('ab9a38e #5/#8 line-break independence: every fixture, two different line splits, identical dates', () => {
  const sets = [];
  for (const f of fs.readdirSync(new URL('./fixtures/', import.meta.url))) {
    if (f.endsWith('.edgar.htm')) sets.push([f, htmlToLines(fs.readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8'))]);
    else if (f.endsWith('.txt') && f !== 'SOURCES.txt') sets.push([f, fs.readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8').split(/\r?\n/)]);
  }
  for (const c of [...D, ...JSON.parse(fs.readFileSync(new URL('../public/data/holdout.json', import.meta.url)))]) sets.push([c.id, c.lines]);
  assert.ok(sets.length >= 100, 'fixture count ' + sets.length);
  for (const [f, L] of sets) { const a = sigOf(L); assert.equal(sigOf(rewrap(L, 72)), a, f + ' (wrapped at 72)'); assert.equal(sigOf(rewrap(L, 140)), a, f + ' (wrapped at 140)'); }
});
test('ab9a38e #8 quotes map back to their line numbers after joining lines', () => {
  const L = rewrap(htmlToLines(fs.readFileSync(new URL('./fixtures/altech-ex10-6.edgar.htm', import.meta.url), 'utf8')), 60); const x = extract(L);
  const txt = norm(L.slice(x.term.source.lineStart - 1, x.term.source.lineEnd).join(' ')); assert.ok(txt.includes('ending on 17 January 2023'));
});
// ---- ab9a38e generic sweep: 14 new EDGAR auto-renewal exhibits (full-text search, filed Apr–Oct 2026; SOURCES.txt). Hand-worked as of 2026-10-19 from each clause. ----
const EXPECT_SWEEP_AB9 = {
  'amfusion-jrms-ex10-1': ['2027-07-10', '2027-07-09'],   // 12 months from "the date hereof" (10 Aug 2026) → 9 Aug 2027; −30 days. Check (date hereof).
  'bitdigital-galaxy-ex10-1': ['2027-03-12'],             // 1 year from the date hereof (27 Mar 2026) → 26 Mar 2027; −10 Business Days.
  'bluejay-lovell-ex10-1': ['2028-06-02'],                // 2 years from 1 Sep 2026 → 31 Aug 2028; −90 days.
  'cineverse-mccabe-ex10-1': ['2028-01-01', '2027-12-30'],// "from April 20th, 2026 (the Effective Date) to March 31st, 2028"; −90 days (Sat, New Year's Day).
  'heritage-ludwig-ex10-1': ['2027-07-01'],               // ends on July 31, 2027; notice of nonrenewal ≥30 days, in a separate clause → Check.
  'strattec-becker-ex10-7': ['2027-09-11', '2027-09-10'], // 11 Nov 2024 – 10 Nov 2025, yearly; ≥60 days: 11 Sep 2026 passed → renews 11 Nov 2026.
  'tenax-staab-ex10-1': ['2027-02-10'],                   // Start Date 11 May 2026, "until the one-year anniversary" → 11 May 2027; −90 days.
  'xti-schneiderman-ex10-2': ['2028-08-11'],              // "continue for the Initial Term" = table "Three (3) Years" from 10 Nov 2025; −90 days. Check.
  'zsquared-mzhci-ex10-4': ['2027-02-06', '2027-02-05'],  // 4 months from 8 Dec 2025, renews every 4 months; 60 days: 8 Oct 2026 passed → renews 8 Dec 2026.
  // no date, flagged: term starts at a merger closing; Commencement Date never dated; renewal subject to re-election; renewal belongs to another agreement
  'heartsciences-simpson-ex10-1': [''], 'niki-freeburg-ex10-1': [''], 'niki-mireskandari-ex10-2': [''], 'whitefiber-tabar-ex10-4': [''], 'xpel-psa-ex10-5': [''],
};
for (const [f, [act, safe]] of Object.entries(EXPECT_SWEEP_AB9)) test(`sweep ab9a38e ${f} → ${act || 'flagged, no date'}`, () => {
  const { r } = fx(f + '.edgar.htm'); assert.equal(r.actBy || '', act); if (safe) assert.equal(r.safe?.date, safe); if (!act) assert.equal(r.needsReview, true);
});
// Vendor, licence, supply, services and colocation contracts from EDGAR (hand-checked against each filing, as of 19 Oct 2026).
const EXPECT_VENDOR = {
  'taoweave-manako-license-ex10-1': ['2027-03-28', '2027-03-26'],   // licence/distribution, Effective Date 28 May 2026, one year → 27 May 2027; ≥60 days (Sun).
  'stoneridge-mexico-mfg-ex10-1': ['2028-01-29', '2028-01-28'],     // manufacturing, 30 Jan 2026, three years → 29 Jan 2029; ≥12 months (Sat).
  'fusemachines-qintess-mlsa-ex10-2': ['2029-05-11'],               // licence and services, 10 Aug 2026, three years → 9 Aug 2029; ≥90 days.
  'cuentas-powerupp-colo-ex10-1': ['2029-05-21'],                   // power and colocation, 20 Aug 2026, 36 months → 19 Aug 2029; ≥90 days.
  'mallinckrodt-par-supply-ex10-4': ['2029-11-10', '2029-11-09'],   // manufacturing and supply, 10 Nov 2025, "until the date that is five (5) years" → 10 Nov 2030; ≥12 months (Sat).
  'usantimony-supply-ex10-1': ['2030-10-01'],                       // purchasing and supply, 1 Nov 2025 "through November 30, 2030"; notice "within 60 days prior".
  'hallmark-msa-ex10-4': ['2030-12-10'],                            // master services, 9 Jun 2026, five years → 8 Jun 2031; ≥180 days.
  'arlp-saminco-supply-ex10-5': ['2031-05-31', '2031-05-30'],       // supply, distribution and services, 1 Jul 2026, five years → 30 Jun 2031; ≥30 days (Sat).
  'aspen-clearpoint-supply-ex10-42': ['2027-07-28'],                // master supply, 25 Jan 2022, five years → 24 Jan 2027; ≥180 days: 28 Jul 2026 passed → renews to 24 Jan 2028.
  'perceptive-neb-supply-ex10-25': ['2028-08-15'],                  // supply, 16 Feb 2022, five years → 15 Feb 2027; ≥6 months: 15 Aug 2026 passed → renews two years to 15 Feb 2029.
};
for (const [f, [act, safe]] of Object.entries(EXPECT_VENDOR)) test(`vendor ${f} → ${act}`, () => {
  const { r } = fx(f + '.edgar.htm'); assert.equal(r.actBy || '', act); if (safe) assert.equal(r.safe?.date, safe); assert.equal(r.needsReview, f === 'usantimony-supply-ex10-1');
});
test('within N days prior: weekend and holiday shift moves FORWARD and the window is stated', async () => {
  const { windowNote, windowOf, sendByNote } = await import('../public/features.js');
  assert.equal(safeSendBy('2026-11-01', true).date, '2026-11-02'); assert.equal(safeSendBy('2026-11-01').date, '2026-10-30');
  assert.equal(safeSendBy('2026-11-26', true).date, '2026-11-27'); assert.equal(safeSendBy('2026-12-25', true).date, '2026-12-28');
  const t = 'MASTER SUPPLY AGREEMENT\nThis Agreement is effective as of January 1, 2026 (the "Effective Date").\n2. Term. The initial term of this Agreement shall commence on the Effective Date and end on December 31, 2026. Thereafter this Agreement shall automatically renew for successive one (1) year terms unless either party gives written notice of non-renewal within sixty (60) days prior to the end of the then-current term.';
  const L = t.split('\n'); const x = extract(L); const r = buildQueue([{ id: 'p', name: 'p', lines: L, x }], '2026-10-20')[0];
  assert.equal(r.actBy, '2026-11-01'); assert.equal(r.safe.date, '2026-11-02'); assert.equal(r.safe.note, 'Falls on a Sunday · send notice on or after Mon 2 Nov 2026');
  assert.equal(windowOf(r).label, 'Send notice on or after'); assert.equal(windowOf(r).fromW, 'Mon 2 Nov 2026');
  assert.equal(windowNote(r), '"Within 60 days prior": send between 2 Nov and 31 Dec 2026. 2 Nov 2026 is the earliest safe date');
  assert.equal(sendByNote('2026-11-01', '2026-10-20', true), 'Falls on a Sunday. Send notice on or after Mon 2 Nov');
  const a = fx('armlogi-goldensee-ex10-11.edgar.htm').r; assert.equal(a.actBy, '2027-06-20'); assert.equal(a.safe.date, '2027-06-21');
  assert.equal(windowNote(a), '"Within 1 month prior": send between 21 Jun and 20 Jul 2027. 21 Jun 2027 is the earliest safe date');
  // other clause types still move back
  assert.equal(fx('taoweave-manako-license-ex10-1.edgar.htm').r.safe.date, '2027-03-26');
});
test('within N days prior is Check, not Clear, with the earliest safe date', async () => {
  const { windowNote } = await import('../public/features.js');
  const { r } = fx('usantimony-supply-ex10-1.edgar.htm');
  assert.equal(r.confidence, 'medium'); assert.equal(r.needsReview, true); assert.equal(r.item.within, true);
  assert.equal(windowNote(r), '"Within 60 days prior": send between 1 Oct and 30 Nov 2030. 1 Oct 2030 is the earliest safe date');
  assert.equal(fx('mallinckrodt-par-supply-ex10-4.edgar.htm').r.item.within, false);
});
test('sweep ab9a38e missed windows: Strattec and Z Squared', () => {
  assert.deepEqual(fx('strattec-becker-ex10-7.edgar.htm').r.missed, { actBy: '2026-09-11', renews: '2026-11-11' });
  assert.deepEqual(fx('zsquared-mzhci-ex10-4.edgar.htm').r.missed, { actBy: '2026-10-08', renews: '2026-12-08' });
});
test('sweep ab9a38e party names', () => {
  assert.equal(partiesFromPreamble(fx('xti-schneiderman-ex10-2.edgar.htm').L), 'Drone Nerds / Jeremy Schneiderman');
  assert.equal(partiesFromPreamble(fx('heartsciences-simpson-ex10-1.edgar.htm').L), 'Heartsciences / Andrew Simpson');
});
// ---- reviewer 6ca64e8 items 1–8 (real sec.gov fixtures; hand-worked as of 2026-10-19) ----
import { definedRoles } from '../public/extract.js';
test('6ca64e8 #1 NewGenIvf: Effective Date set by SPA closing → no date, never the 28 May 2026 header date', () => {
  for (const L of [fx('newgenivf-agency-ex10-2.edgar.htm').L, docxLines(new URL('./fixtures/newgenivf-agency-ex10-2.generated.docx', import.meta.url).pathname)]) {
    const x = extract(L); const r = buildQueue([{ id: 'f', name: 'f', lines: L, x }], AS)[0];
    assert.equal(x.effective, null); assert.match(x.effectiveEvent.event, /completion of Closing under the SPA/);
    assert.equal(r.actBy || '', ''); assert.equal(r.needsReview, true); assert.match(r.tag, /start date is set by an event and is not in the document/);
  }
  const t = ['This Supply Agreement is dated March 1, 2026.', 'This Agreement becomes effective upon the closing of the Merger (the “Effective Date”).', 'The initial term is two (2) years from the Effective Date and shall automatically renew for successive one (1) year terms unless either party gives notice at least 60 days prior to the end of the then-current term.'];
  const x = extract(t); assert.equal(buildQueue([{ id: 's', name: 's', lines: t, x }], AS)[0].actBy || '', '');
});
test('6ca64e8 #2 Driven/O\'Melia amendment: "is hereby extended until May 4, 2027" → Sun 4 Apr 2027, send by Fri 2 Apr, Clear', () => {
  for (const g of [fx('driven-omelia-amend3-ex10-2.edgar.htm'), fxt('driven-omelia-amend3-ex10-2.pdftotext.txt')]) { assert.equal(g.r.actBy, '2027-04-04'); assert.equal(g.r.safe.date, '2027-04-02'); assert.equal(g.r.confidence, 'high'); assert.equal(g.r.needsReview, false); }
});
test('6ca64e8 #3 FirstEnergy: "commence as of the date first indicated above" = 1 Jan 2024 → 1 Jan 2028, send by Thu 30 Dec 2027, Check naming the start', () => {
  const { r } = fx('firstenergy-service-ex10-6.edgar.htm'); assert.equal(r.actBy, '2028-01-01'); assert.equal(r.safe.date, '2027-12-30'); assert.equal(r.needsReview, true); assert.match(r.tag, /start date assumed to be the agreement date \(1 Jan 2024\)/);
});
test('6ca64e8 #4 Nature\'s Miracle: "the term of the Employment shall … end on January 31, 2029" → 1 Jan 2029, send by Fri 29 Dec 2028, Clear', () => {
  for (const g of [fx('naturesmiracle-du-ex10-1.edgar.htm'), fxt('naturesmiracle-du-ex10-1.pdftotext.txt')]) { assert.equal(g.r.actBy, '2029-01-01'); assert.equal(g.r.safe.date, '2028-12-29'); assert.equal(g.r.confidence, 'high'); }
});
test('6ca64e8 #5 the check names the start-date assumption', () => {
  assert.match(fx('gamg-taylor-ex10-2.edgar.htm').r.tag, /^start date 3 Mar 2026 is taken from the "dated \/ as of" line/);
});
test('6ca64e8 #6 party names', () => {
  assert.equal(partiesFromPreamble(fx('driven-omelia-amend3-ex10-2.edgar.htm').L), 'Driven Brands Shared Services / Scott O’Melia');
  assert.equal(partiesFromPreamble(fx('newgenivf-agency-ex10-2.edgar.htm').L), 'PredicXion Group / NewGenIVF Group');
  assert.doesNotMatch(partiesFromPreamble(fx('firstenergy-service-ex10-6.edgar.htm').L), /each of|listed/);
  assert.equal(definedRoles(['This Agreement is made by Foo (the “Company”) and Bar (the “Executive”).']), 'Company / Executive');
});
test('6ca64e8 #7 numeric dates only when unambiguous; "each December 31 thereafter" rolling renewals', () => {
  assert.equal(ymd(parseDate('as of 3-3-2026').date), '2026-03-03'); assert.equal(ymd(parseDate('03/15/2026').date), '2026-03-15'); assert.equal(parseDate('04/05/2026'), null);
  assert.equal(fx('gamg-taylor-ex10-2.edgar.htm').r.actBy, '2030-12-02');
  const f = fx('fmbank-campbell-ex10-3.edgar.htm'); assert.equal(f.r.actBy, '2027-10-02'); assert.equal(f.r.confidence, 'medium');
  assert.equal(fx('cineverse-mccabe-ex10-1.edgar.htm').x.effective.date, '2026-04-20');
});
test('6ca64e8 a renewal of another named agreement is not this document\'s (XPEL)', () => { assert.equal(fx('xpel-psa-ex10-5.edgar.htm').x.renewal, null); });
// ---- b1eb7bd follow-up: capped extensions, safety net, yearly roll-forward, amendments, evergreen wording, names (hand-worked as of 2026-10-19) ----
test('b1eb7bd #1 Aibotics "automatically be extended for up to five additional terms" is a capped auto-renewal (Oct 12 2026 + 3y, 30 days)', () => {
  const g = fx('aibotics-gmoore-ex10-2.edgar.htm'); assert.equal(g.x.renewal.auto, true); assert.equal(g.x.renewal.max, 5); assert.equal(g.r.actBy, '2029-09-11'); assert.equal(g.r.label, 'Send-notice deadline');
});
test('b1eb7bd #1 safety net: renewal or extension wording with no modelled renewal is never Clear', () => {
  const L = ['This Services Agreement is dated as of January 5, 2026 (the “Effective Date”) by and between Alpha Corp. and Beta LLC.', 'The term of this Agreement shall be two (2) years from the Effective Date.', 'The parties may discuss a renewal of this Agreement in good faith before the term ends.'];
  const x = extract(L), r = buildQueue([{ id: 'a', name: 'a', lines: L, x }], AS)[0];
  assert.equal(x.renewal, null); assert.notEqual(r.confidence, 'high'); assert.equal(r.needsReview, true); assert.match(r.tag, /mentions renewal or extension/);
  const lc = fx('douglas-lease-ex10-1.edgar.htm').r; assert.notEqual(lc.confidence, 'high'); assert.match(lc.tag, /letter of credit/);
});
test('b1eb7bd #2 yearly deadlines roll forward: BayFirst (renews each 1 Sep, 90 days) and Armlogi (ended 7/20/2024, renews yearly, one month)', () => {
  assert.equal(fx('bayfirst-oliver-ex10-1.edgar.htm').r.actBy, '2029-06-03');
  const a = fx('armlogi-goldensee-ex10-11.edgar.htm').r; assert.equal(a.actBy, '2027-06-20'); assert.equal(a.confidence, 'medium');
});
test('b1eb7bd #3 amendments at Check: term from the amendment date (Carvana) and a restated end date (Mercury)', () => {
  const c = fx('carvana-caret-amend2-ex10-2.edgar.htm'); assert.equal(c.x.term.start, '2026-08-31'); assert.equal(c.r.actBy, '2028-03-03'); assert.equal(c.r.confidence, 'medium'); assert.match(c.r.tag, /Second Amendment Effective Date \(2026-08-31\)/);
  const m = fx('mercury-ballhaus-amend2-ex10-1.edgar.htm'); assert.equal(m.r.actBy, '2030-07-16'); assert.equal(m.r.confidence, 'medium'); assert.match(m.r.tag, /amendment restates/);
});
test('b1eb7bd #4 evergreen wording names the real renewal period (Thor: yearly, not monthly)', () => {
  const r = fx('thor-biren-ex10-20.edgar.htm').r; assert.equal(r.actBy || '', ''); assert.equal(r.tag, 'renews every year, no notice clause');
  assert.equal(shortReason('Evergreen: renews every 3 month "unless and until terminated"'), 'renews every 3 months, no notice clause');
});
test('b1eb7bd #5 party names', () => {
  assert.equal(partiesFromPreamble(fx('aibotics-gmoore-ex10-2.edgar.htm').L), 'Aibotics / Gregory Moore');
  assert.equal(partiesFromPreamble(fx('armlogi-goldensee-ex10-11.edgar.htm').L), 'Goldensee / Armstrong Logistic');
  assert.equal(partiesFromPreamble(fx('duos-polimeni-ex10-2.edgar.htm').L), 'Duos Technologies Group / Matthew Polimeni');
});
// ---- 7e1cb4e follow-up (hand-worked as of 2026-10-19) ----
test('7e1cb4e #1 Birchtech: the prior agreement in the recitals is ignored → 31 May 2030 − 60 days = 1 Apr 2030', () => {
  const g = fx('birchtech-macpherson-ex10-1.edgar.htm'); assert.equal(g.x.term.end, '2030-05-31'); assert.equal(g.r.actBy, '2030-04-01');
});
test('7e1cb4e #1 guard: a term sentence that also describes a prior agreement is never Clear', () => {
  const L = ['This Agreement is dated as of May 1, 2026 (the “Effective Date”) between Alpha Corp. and Beta LLC.', 'The term of this Agreement shall continue until May 31, 2028, replacing that certain Prior Agreement which has an initial term through May 31, 2027.', 'This Agreement shall automatically renew for successive one-year periods unless either party gives notice at least 60 days prior to the end of the then-current term.'];
  const x = extract(L), r = buildQueue([{ id: 'a', name: 'a', lines: L, x }], AS)[0]; assert.equal(r.actBy, '2028-04-01'); assert.notEqual(r.confidence, 'high');
});
test('7e1cb4e #2 Union Bankshares: "“Effective Date” shall mean Monday, May 4, 2026" → 3 Feb 2029', () => {
  const g = fx('unionbank-weidley-ex10-6.edgar.htm'); assert.equal(g.x.effective.date, '2026-05-04'); assert.equal(g.r.actBy, '2029-02-03');
});
test('7e1cb4e #3 Immunic: "comence … end on the earlier of (a) December 31, 2024" + yearly renewals → missed 2 Oct 2026, next 2 Oct 2027', () => {
  const r = fx('immunic-tardio-ex10-1.edgar.htm').r; assert.equal(r.missed.actBy, '2026-10-02'); assert.equal(r.actBy, '2027-10-02');
});
test('7e1cb4e #4 NHP amendment: "at least 90 days’ prior to the applicable Term Date" → 29 Jun 2030 (HTML and PDF text)', () => {
  for (const g of [fx('nhp-anderson-amend-ex10-1.edgar.htm'), fxt('nhp-anderson-amend-ex10-1.pdftotext.txt')]) { assert.equal(g.x.notice.period.n, 90); assert.equal(g.r.actBy, '2030-06-29'); }
});
test('7e1cb4e #5 any-time exit on N days: Sera and Polar have no renewal deadline', () => {
  for (const f of ['sera-consulting-ex10-2', 'polarpower-lu2-ex10-7']) { const r = fx(f + '.edgar.htm').r; assert.equal(r.actBy, ''); assert.equal(r.tag, "can be ended any time on 30 days' notice, so no renewal deadline"); }
  assert.equal(fx('kingfish-matthews-ex10-1.edgar.htm').r.actBy, '2027-04-16'); assert.equal(fx('btcs-allen-ex10-1.edgar.htm').r.actBy, '2027-12-23');
});
// ---- 5a7dc15 follow-up (hand-worked as of 2026-10-19) ----
test('5a7dc15 #1 Pickett: "up to a maximum of ten (10) additional years" caps at 10 yearly renewals, never "expired" while renewing', () => {
  const g = fx('solarwind-pickett-ex10-1.edgar.htm'); assert.equal(g.x.renewal.max, 10); assert.equal(g.r.expired, false); assert.equal(g.r.missed.actBy, '2026-10-02'); assert.equal(g.r.actBy, '2027-10-02');
  const L = docxLines(new URL('./fixtures/solarwind-pickett-ex10-1.generated.docx', import.meta.url).pathname); const x = extract(L); assert.equal(buildQueue([{ id: 'd', name: 'd', lines: L, x }], AS)[0].actBy, '2027-10-02');
});
test('5a7dc15 guard: an expiry more than a year ago after renewals is never Clear', () => {
  const L = ['This Agreement is dated as of January 1, 2015 (the “Effective Date”) between Alpha Corp. and Beta LLC.', 'The term of this Agreement shall continue until December 31, 2016.', 'This Agreement shall automatically renew for up to two (2) successive one-year periods unless either party gives notice at least 60 days prior to the end of the then-current term.'];
  const x = extract(L), r = buildQueue([{ id: 'a', name: 'a', lines: L, x }], AS)[0]; assert.equal(r.expired, true); assert.notEqual(r.confidence, 'high'); assert.equal(r.needsReview, true);
});
test('5a7dc15 #2 passed deadline before a renewal date that has not come yet is shown as missed (Constellation, LSB, F&M)', () => {
  for (const [f, m, n] of [['constellation-fink-ex10-1', '2026-09-01', '2027-09-01'], ['lsb-bemis-cic-ex10-1', '2026-10-17', '2027-10-17'], ['fmbank-michael-ex10-1', '2026-10-02', '2027-10-02']]) { const r = fx(f + '.edgar.htm').r; assert.equal(r.missed?.actBy, m, f); assert.equal(r.actBy, n, f); }
});
test('5a7dc15 #3 DLH "commencing on the Effective Date … and terminating on September 30, 2028" → 2 Jul 2028', () => { assert.equal(fx('dlh-parker-ex10-1.edgar.htm').r.actBy, '2028-07-02'); });
test('5a7dc15 #4 Timken "not later than September 30 of the immediately preceding year" → missed 30 Sep 2026, next 30 Sep 2027, Check', () => {
  const r = fx('timken-boldea-ex10-1.edgar.htm').r; assert.equal(r.missed.actBy, '2026-09-30'); assert.equal(r.actBy, '2027-09-30'); assert.notEqual(r.confidence, 'high');
});
test('5a7dc15 #5 party names', () => {
  assert.equal(partiesFromPreamble(fx('constellation-fink-ex10-1.edgar.htm').L), 'Constellation / Nicholas I. Fink');
  assert.equal(partiesFromPreamble(fx('lsb-bemis-cic-ex10-1.edgar.htm').L), 'LSB Industries / Scott D. Bemis');
  assert.equal(partiesFromPreamble(fx('medallion-haley-ex10-2.edgar.htm').L), 'David Justin Haley / Medallion');
  assert.equal(fx('baxter-hider-ex10-1.edgar.htm').r.actBy, '2027-08-19');
});
// ---- 540ec12 follow-up (hand-worked as of 2026-10-19) ----
import { docxBrowserLines } from './doc-readers.mjs';
const q1 = L => { const x = extract(L); const r = buildQueue([{ id: 'q', name: 'q', lines: L, x }], AS)[0] || {}; return { end: x.term?.end || '', actBy: r.actBy || '', conf: r.confidence, missed: r.missed?.actBy || '', name: partiesFromPreamble(L) }; };
test('540ec12 #2 every DOCX fixture gives the same result through the browser Word path as its HTML (or the XML reader)', async () => {
  const dir = new URL('./fixtures/', import.meta.url).pathname; const files = fs.readdirSync(dir).filter(f => f.endsWith('.docx'));
  assert.ok(files.length >= 7);
  for (const f of files) {
    const base = f.replace(/(?:\.html-in-word)?\.generated\.docx$/, ''); const htm = dir + base + '.edgar.htm';
    const ref = fs.existsSync(htm) ? q1(htmlToLines(fs.readFileSync(htm, 'utf8'))) : q1(docxLines(dir + f));
    const got = q1(await docxBrowserLines(dir + f));
    assert.deepEqual({ end: got.end, actBy: got.actBy, missed: got.missed, name: got.name }, { end: ref.end, actBy: ref.actBy, missed: ref.missed, name: ref.name }, f);
  }
});
test('540ec12 #2 Dominari: Word file holding HTML source as text → 30 Jun 2027, real names', async () => {
  const g = q1(await docxBrowserLines(new URL('./fixtures/dominari-ledwick-ex10-1.html-in-word.generated.docx', import.meta.url).pathname));
  assert.equal(g.actBy, '2027-06-30'); assert.equal(g.name, 'Dominari Holdings / Tim S. Ledwick');
});
test('540ec12 #1 American Woodmark: "each January 1 … one additional calendar year" repeats → 1 Nov 2026, Check', () => {
  const g = fx('woodmark-mason-ex10-2.edgar.htm'); assert.notEqual(g.x.renewal.max, 1); assert.equal(g.r.actBy, '2026-11-01'); assert.notEqual(g.r.confidence, 'high');
  assert.equal(partiesFromPreamble(g.L), 'Jimmy Mason / American Woodmark');
});
test('540ec12 #1 guard: renewal wording plus a computed "no further renewal" is Check with a note', () => {
  const L = ['This Agreement is dated as of January 1, 2026 (the “Effective Date”) between Alpha Corp. and Beta LLC.', 'The term of this Agreement shall commence on the Effective Date and end on December 31, 2026; provided that the term shall automatically be extended for one additional year unless either party gives notice at least 30 days before the end of the term.', 'Any renewal of this Agreement after the extended term requires a written amendment.'];
  const x = extract(L), r = buildQueue([{ id: 'a', name: 'a', lines: L, x }], '2027-06-01')[0];
  assert.equal(r.label, 'Expires (no further renewal)'); assert.equal(r.needsReview, true); assert.notEqual(r.confidence, 'high'); assert.match(r.tag, /assumes no further automatic renewal/);
});
test('540ec12 #3 the five misses: 1st Source, Quaker, First Commonwealth, Vail, Perma-Pipe', async () => {
  let r = fx('firstsource-murphy-ex10-a1.edgar.htm').r; assert.equal(r.missed?.actBy, '2026-09-30'); assert.equal(r.actBy, '2027-09-30');
  r = fx('quaker-carvalho-cic-ex10-2.edgar.htm').r; assert.equal(r.actBy, '2027-07-01'); assert.notEqual(r.confidence, 'high');
  r = fx('firstcommonwealth-coc-ex10-3.edgar.htm').r; assert.equal(r.actBy, '2026-12-31');
  assert.equal(q1(pdfLines(new URL('./fixtures/firstcommonwealth-coc-ex10-3.generated.pdf', import.meta.url).pathname)).actBy, '2026-12-31');
  assert.equal(q1(await docxBrowserLines(new URL('./fixtures/vail-katz-ex10-1.generated.docx', import.meta.url).pathname)).actBy, '2028-07-27');
  assert.equal(fx('permapipe-sagr-ex.edgar.htm').r.actBy, '2026-12-30');
});
test('540ec12 #4 party names: blanks rejected, bare roles fall back', () => {
  assert.equal(partiesFromPreamble(fx('trex-severance-ex10-2.edgar.htm').L), 'Trex');
  assert.equal(partiesFromPreamble(['THIS AGREEMENT, between ______________ (the “Employee”) and ______________ (the “Company”), is effective as of July 7, 2025.']), '');
  assert.equal(partiesFromPreamble(['This Agreement is made by and between Mr. John Smith (the “Executive”) and Acme Widgets, Inc. (the “Company”).']), 'John Smith / Acme Widgets');
});
test('540ec12 batch: the rest of blind test 4 still reads as hand-worked', () => {
  assert.equal(fx('lazarus-revolver-ex.edgar.htm').r.actBy, '2027-03-01'); assert.equal(fx('photronics-rivera-ex10-1.edgar.htm').r.actBy, '2027-11-02');
  assert.equal(fx('carriage-franch-ex.edgar.htm').r.actBy, '2027-01-31'); assert.equal(fx('puget-severance-plan-ex10-1.edgar.htm').r.actBy, '2027-11-01');
  for (const f of ['dte-cic-template-ex10-2', 'trex-severance-ex10-2']) assert.equal(fx(f + '.edgar.htm').r.actBy, '', f);
});
// ---- round 8: calibration (Sure only when the date rests on explicit text and a second count agrees); hand-worked as of 2026-10-19 ----
import { execFileSync as _exf } from 'node:child_process';
test('calibration: no Sure card is wrong across every fixture with a hand answer', () => {
  const out = _exf('node', [new URL('./calibration/run.mjs', import.meta.url).pathname], { encoding: 'utf8' }); const s = JSON.parse(out.split('\n')[0]);
  assert.equal(s.sureWrong, 0, out); assert.equal(s.sureUnverified, 0, out); assert.ok(s.sure >= 30);
});
test('round 8 #2 Procore "upon such third anniversary" → 24 Jul 2028, Check', () => { const r = fx('procore-gopal-ex10-2.edgar.htm').r; assert.equal(r.actBy, '2028-07-24'); assert.notEqual(r.confidence, 'high'); });
test('round 8 #2 Zimmer "each subsequent January 1", 30 days before the extension → 2 Dec 2026', () => { const r = fx('zimmer-noor-cic-ex10-2.edgar.htm').r; assert.equal(r.actBy, '2026-12-02'); assert.notEqual(r.confidence, 'high'); });
test('round 8 #2 B. Riley: term from the Commencement Date (3 Jun 2025) → 4 Mar 2027, Check naming it', () => { const r = fx('briley-yessner-ex10-1.edgar.htm').r; assert.equal(r.actBy, '2027-03-04'); assert.notEqual(r.confidence, 'high'); assert.match(r.tag, /Commencement Date/); });
test('round 8 #2 Crown: 30 days before any anniversary → 1 Jun 2027', () => { assert.equal(fx('crown-rost-ex10-2.edgar.htm').r.actBy, '2027-06-01'); });
test('round 8 #2 West: "does not automatically extend or automatically renew" → expires 31 Dec 2027', () => { const r = fx('west-scpharma-amend-ex10-1.edgar.htm').r; assert.equal(r.actBy, '2027-12-31'); assert.match(r.label, /^Expires/); });
test('round 8 #2 Aebi: "no later than 90 days before the end of the then-current term" → missed 2 Oct 2026, next 2 Oct 2027', () => { const r = fx('aebi-loan-ex10-6.edgar.htm').r; assert.equal(r.missed?.actBy, '2026-10-02'); assert.equal(r.actBy, '2027-10-02'); });
test('round 8 #2 Enovis: an "anticipated" start date is Check', () => { const r = fx('enovis-mcdonald-offer-ex10-2.edgar.htm').r; assert.equal(r.actBy, '2028-03-13'); assert.notEqual(r.confidence, 'high'); assert.match(r.tag, /anticipated/); });
test('round 8 batch: the rest still reads as hand-worked', () => {
  assert.equal(fx('cineverse-opeka-ex10-2.edgar.htm').r.actBy, '2027-01-30'); assert.equal(fx('thejoint-bowman-ex10-1.edgar.htm').r.actBy, '2027-03-11');
  for (const f of ['stride-cic-template-ex10-2', 'civeo-gerry-ex10-2', 'shell-irrx-offtake-ex10-1']) assert.equal(fx(f + '.edgar.htm').r.actBy, '', f);
});
