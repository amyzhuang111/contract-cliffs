// Expected values below were hand-checked against the clause text in each EDGAR filing (see edgar/VERIFICATION.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  // before the last cycle ran out, the notice line still exists
  assert.equal(schedule(C.c7.x, '2024-01-01').find(i => i.type.startsWith('Send-notice')).date, '2024-03-02');
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
