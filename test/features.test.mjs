// Feature tests. Expected values were read by hand from the clause text in the real EDGAR filings in public/data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { extract, toICS, toCSV, buildQueue } from '../public/extract.js';
import { withAlarms, gcalLink, sendDay, noticeClause, escalators, obligations, letter, docx, crc32, portfolio, BUCKETS, bucket, stripHtml, exitNote, cleanQuote, auditCSV, statusOf, parseSaved, FILL } from '../public/features.js';
const load = f => JSON.parse(fs.readFileSync(new URL('../public/data/' + f + '.json', import.meta.url))).map(c => ({ ...c, x: extract(c.lines) }));
const E = Object.fromEntries(load('edgar').map(c => [c.id, c])), H = Object.fromEntries(load('holdout').map(c => [c.id, c]));
const AS = '2026-10-19';
const lineText = (c, n) => { const l = c.lines[n - 1]; return typeof l === 'string' ? l : l.text; };

// F1
test('F1: every send-notice event in the .ics has alarms at 30, 14 and 7 days, and nothing else changes', () => {
  const cs = [E.c5, E.c2, E.c3, E.c1];
  const raw = toICS(cs, AS, '20261019T000000Z'), ics = withAlarms(raw);
  const evs = ics.split('BEGIN:VEVENT').slice(1);
  const send = evs.filter(e => /SUMMARY:Send-notice deadline/.test(e));
  assert.ok(send.length >= 2);
  for (const e of send) assert.deepEqual([...e.matchAll(/TRIGGER:(-P\d+D)/g)].map(m => m[1]), ['-P30D', '-P14D', '-P7D']);
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, (ics.match(/END:VALARM/g) || []).length);
  assert.equal(ics.replace(/BEGIN:VALARM[\s\S]*?END:VALARM\r\n/g, ''), raw.replace(/BEGIN:VALARM[\s\S]*?END:VALARM\r\n/g, ''));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'));
  assert.ok(ics.split('\r\n').every(l => l.length <= 75), 'lines stay folded');
});
test('F1: Google Calendar link is a correctly encoded all-day event on the safe send-by day', () => {
  const r = buildQueue([E.c5], AS)[0];
  assert.equal(r.actBy, '2026-12-16');
  const u = new URL(gcalLink({ name: E.c5.name, actBy: r.actBy, asOf: AS, quote: r.item.source.quote, location: r.item.source.location, url: E.c5.url }));
  assert.equal(u.origin + u.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(u.searchParams.get('action'), 'TEMPLATE');
  assert.equal(u.searchParams.get('text'), 'Send non-renewal notice: Star Brands / Schwazze');
  assert.equal(u.searchParams.get('dates'), '20261216/20261217');
  assert.match(u.searchParams.get('details'), /one hundred eighty \(180\) days prior/);
  assert.match(u.searchParams.get('details'), /lines 24–29/);
  const s = gcalLink({ name: 'A & B, "x" #1 / 100%', actBy: '2026-12-16', asOf: AS });
  assert.ok(!/[ "#&]/.test(s.split('?')[1].replace(/&(text|dates|details)=/g, '')), 'no raw spaces, quotes, # or & inside values');
  assert.equal(new URL(s).searchParams.get('text'), 'Send non-renewal notice: A & B, "x" #1 / 100%');
  // Dragonfly's 19 Sep 2027 is a Sunday: the event moves to Fri 17 Sep 2027
  assert.equal(sendDay('2027-09-19', AS), '2027-09-17');
  assert.equal(new URL(gcalLink({ name: 'x', actBy: '2027-09-19', asOf: AS })).searchParams.get('dates'), '20270917/20270918');
  // safe day already passed: today
  assert.equal(sendDay('2027-09-19', '2027-09-18'), '2027-09-18');
  assert.equal(gcalLink({ name: 'x', actBy: 'bad', asOf: AS }), '');
});

// F3
test('F3: notices clause, method and addresses from Cerus / Purolite (EDGAR c1)', () => {
  const n = noticeClause(E.c1.lines);
  assert.equal(n.location, 'line 66'); assert.match(n.quote, /^9\.2 Notices\. All notices and demands/);
  assert.deepEqual(n.methods, ['personal delivery', 'mail (certified, registered or first class)', 'courier or overnight delivery']);
  assert.deepEqual(n.addresses.map(a => [a.to, a.location]), [['Cerus', 'lines 67–72'], ['Purolite', 'lines 73–78']]);
  assert.match(n.addresses[0].text, /2550 Stanwell Drive · Concord, CA 94520/);
  for (const a of n.addresses) for (const part of a.lines) assert.ok(E.c1.lines.slice(66, 78).some(l => (l.text || l).includes(part)), 'address text is verbatim');
});
test('F3: a blank notice address in the filing stays blank (Dragonfly buyer); an address by reference is not invented (StableX)', () => {
  const d = noticeClause(E.c3.lines); assert.deepEqual(d.addresses.map(a => a.to), ['Seller']); assert.equal(lineText(E.c3, 610).trim(), 'Attention:');
  const s = noticeClause(E.c2.lines); assert.equal(s.addresses.length, 0); assert.match(s.ref, /^addresses first set forth above/);
  assert.equal(noticeClause(E.c5.lines), null);
  const ob = obligations(E.c5); assert.equal(ob.find(o => o.key === 'notice').found, false); assert.equal(ob.find(o => o.key === 'esc').found, false);
});
test('F3: price escalators quoted with lines (Vivos 8% cap, Power Upp CPI, Tradeweb CPI)', () => {
  const v = escalators(E.c6.lines); assert.equal(v.length, 1); assert.equal(v[0].location, 'lines 193–194'); assert.match(v[0].quote, /adjust the Retainer once per calendar year.*shall not exceed 8%/);
  const p = escalators(H.b1.lines); assert.equal(p[0].location, 'lines 137–141'); assert.match(p[0].quote, /Consumer Price Index/);
  assert.match(escalators(E.c4.lines)[0].quote, /cumulative percentage increase in US CPI/);
  for (const id of ['c1', 'c2', 'c3', 'c5', 'c12']) assert.equal(escalators(E[id].lines).length, 0, id + ' has no escalator');
});
test('F3: four obligations, each with a quote and line or left blank', () => {
  const ob = obligations(E.c6);
  assert.deepEqual(ob.map(o => o.key), ['notice', 'tfc', 'esc', 'pay']);
  assert.equal(ob[0].found, true); assert.match(ob[0].summary, /courier or overnight delivery, email/); assert.equal(ob[0].extra.length, 2);
  assert.equal(ob[1].found, false);
  const pay = ob[3]; assert.ok(pay.found && pay.items.every(i => i.quote && /^lines? \d/.test(i.location)));
  const tf = obligations(E.c5)[1]; assert.equal(tf.items[0].location, 'lines 100–101'); assert.match(tf.items[0].quote, /thirty \(30\) days advance written notice/);
});

// F2
test('F2: draft letter quotes the clause and date, marks DRAFT, and leaves missing facts as fill-in markers', () => {
  const r = buildQueue([E.c5], AS)[0]; const t = letter(E.c5, r, AS);
  assert.match(t, /^DRAFT\. NOT SENT\./);
  assert.match(t, /Parties to the agreement: Star Brands and Schwazze/);
  assert.match(t, /Renewal clause \(lines 24–29\): "If not otherwise terminated/);
  assert.match(t, /on or before 16 December 2026/);
  assert.match(t, /\[NOTICE ADDRESS, FILL IN\] \(no notice address found in the notices clause\)/);
  assert.ok(!/[\u200b\u2014]/.test(t), 'no zero-width characters or em dashes');
  const c1 = letter(E.c1, buildQueue([E.c1], AS)[0], AS);
  assert.match(c1, /Cerus: Chief Executive Officer · Cerus Corporation · 2550 Stanwell Drive/); assert.match(c1, /Purolite: Ted Begg/);
  const blank = letter({ name: 'Unnamed contract (x.txt)', lines: ['nothing here'], x: extract(['nothing here']) }, undefined, AS);
  assert.ok(blank.split(', FILL IN]').length > 5);
});
test('F2: .docx is a valid zip that Word can open (unzip and XML check)', () => {
  const t = letter(E.c5, buildQueue([E.c5], AS)[0], AS); const b = docx(t);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccdocx-')), 'l.docx'); fs.writeFileSync(f, b);
  assert.match(execFileSync('unzip', ['-t', f]).toString(), /No errors detected/);
  const xml = execFileSync('unzip', ['-p', f, 'word/document.xml']).toString();
  assert.match(xml, /DRAFT\. NOT SENT/); assert.match(xml, /16 December 2026/); assert.match(xml, /&quot;If not otherwise terminated/);
  assert.match(execFileSync('unzip', ['-p', f, '\\[Content_Types].xml']).toString(), /wordprocessingml\.document\.main\+xml/);
});

// F4
test('F4: portfolio counts are exclusive and add up to the total', () => {
  const rows = buildQueue(Object.values(E), AS); const p = portfolio(rows);
  assert.deepEqual(p, { passed: 0, d30: 0, d90: 1, d365: 3, later: 3, cant: 2, expired: 1, review: 2, missed: 1, total: 10 });
  assert.equal(BUCKETS.reduce((a, [k]) => a + p[k], 0), 10);
  for (const r of rows) assert.ok(BUCKETS.some(([k]) => k === bucket(r)));
  const demo = portfolio(buildQueue([E.c5, E.c2, E.c3], AS));
  assert.deepEqual([demo.d30, demo.d90, demo.d365, demo.later, demo.missed], [0, 1, 1, 1, 1]); // Star Brands in 58 days; Dragonfly missed, next Sep 2027; StableX 2030
  assert.equal(portfolio([]).total, 0);
  const h = stripHtml(portfolio([])); assert.equal((h.match(/ zero"/g) || []).length, 3); assert.ok(!/expired|past due/.test(h));
});

// F5
test('F5: audit CSV has one row per contract with deadline, quote, confidence and status', () => {
  const csv = auditCSV([E.c5, E.c3, E.c2], AS).trim().split('\r\n');
  assert.equal(csv[0], 'contract,counterparty,deadline,send_by_business_day,days_from_as_of,as_of,status,needs_review,review_reason,confidence,evidence_location,evidence_quote,source');
  assert.equal(csv.length, 4);
  const star = csv.find(l => l.startsWith('Star Brands')); assert.match(star, /,2026-12-16,2026-12-16,58,2026-10-19,Due within 90 days,no,,/); assert.match(star, /lines 24–29,"If not otherwise terminated/); assert.match(star, /sec\.gov/);
  assert.match(csv.find(l => l.startsWith('Dragonfly')), /,2026-09-19,.*Missed: send-notice deadline passed/);
  const evil = auditCSV([{ ...E.c5, id: 'z', name: '=HYPERLINK("x")' }], AS); assert.match(evil, /^contract[^\n]*\r\n"'=HYPERLINK\(""x""\)"/);
  assert.equal(statusOf({ actBy: '', days: null }), 'Needs review: no date found');
});

// F6
test('F6: saved data is parsed safely', () => {
  assert.deepEqual(parseSaved(null), { docs: [], error: '' });
  assert.deepEqual(parseSaved('{not json'), { docs: [], error: 'corrupt' });
  assert.deepEqual(parseSaved('{"a":1}'), { docs: [], error: 'corrupt' });
  const ok = { name: 'A', lines: ['x', { text: 'y' }] };
  assert.deepEqual(parseSaved(JSON.stringify([ok, null, { name: 2 }, { name: 'B', lines: [5] }])), { docs: [ok], error: 'partial', bad: 3 });
  assert.deepEqual(parseSaved(JSON.stringify([ok])), { docs: [ok], error: '', bad: 0 });
});

// Review fixes
test('early exit (TfC) after the initial term: Star Brands, in headline text, letter, calendar link and .ics', () => {
  const ex = exitNote(E.c5);
  assert.equal(ex.text, "After the first twenty four (24) consecutive months, either party can also end it on 30 days' notice for any reason (lines 100–101).");
  assert.ok(!/\sb\.$/.test(ex.quote)); assert.equal(cleanQuote('notice to the other party. b.'), 'notice to the other party.');
  assert.equal(exitNote(E.c2), null);
  const r = buildQueue([E.c5], AS)[0];
  assert.ok(letter(E.c5, r, AS).includes(ex.text));
  assert.ok(decodeURIComponent(gcalLink({ name: 'x', actBy: r.actBy, asOf: AS, note: ex.text })).includes('either party can also end it'));
  const ics = withAlarms(toICS([E.c5], AS, '20261019T000000Z'), { [E.c5.id]: ex.text });
  const un = ics.replace(/\r\n[ \t]/g, ''); assert.match(un, /either party can also end it on 30 days' notice/);
});
test('.ics from withAlarms: every line at most 75 octets, alarms included, no zero-width characters', () => {
  const c = { ...E.c5, name: 'Star\u200b Brands ' + 'é'.repeat(80) };
  const ics = withAlarms(toICS([c], AS, '20261019T000000Z'));
  for (const l of ics.split('\r\n')) assert.ok(new TextEncoder().encode(l).length <= 75, l);
  assert.ok(!/[\u200b\u2060\ufeff]/.test(ics)); assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 3);
  const un = ics.replace(/\r\n[ \t]/g, ''); assert.match(un, /DESCRIPTION:30 days to the send-notice deadline: Star Brands é+/);
});
test('letter: date line says it is the send date and gives today; docx timestamps are valid', () => {
  const r = buildQueue([E.c5], AS)[0]; assert.match(letter(E.c5, r, AS), /^Date: \[YOUR SEND DATE, FILL IN\] \(the day you send it; today is 19 October 2026\)$/m);
  const z = docx('a\nb'); const v = new DataView(z.buffer); assert.equal(v.getUint16(12, true), 0x21);
});
test('shipped files carry no "demo" wording (only the ?demo=1 URL parameter); footer says independent, not a General Intuition product', () => {
  for (const f of ['index.html', 'app.js', 'features.js', 'portfolio.js', 'extract.js', 'styles.css', 'sw.js']) {
    const t = fs.readFileSync(new URL('../public/' + f, import.meta.url), 'utf8').replace(/params\.get\('demo'\)/g, '');
    assert.ok(!/demo/i.test(t), f);
  }
  assert.match(fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), /independent project by Amy Zhuang, not a General Intuition product/);
});
test('CSV guard: numbers stay numbers in both exports; formulas and dash-text are guarded', async () => {
  const { csvCell } = await import('../public/extract.js');
  for (const n of ['-2', '-108', '-12', '0', '42', '-3.5']) assert.equal(csvCell(n), n);
  assert.equal(csvCell(-108), '-108');
  for (const [i, o] of [['=cmd|calc!A1', `"'=cmd|calc!A1"`], ['+1+1', `"'+1+1"`], ['@SUM(A1)', `"'@SUM(A1)"`], ['-x', `"'-x"`], ['-2+3', `"'-2+3"`], ['\tx', `"'\tx"`]]) assert.equal(csvCell(i), o, i);
  // audit export: a missed row's negative days_from_as_of is a plain number
  const missed = { ...E.c3 }; const csv = auditCSV([missed], '2027-10-01');
  const neg = csv.split('\r\n')[1]?.split(',').find(v => /^"?'?-\d+"?$/.test(v)); assert.ok(neg && /^-\d+$/.test(neg), String(neg));
  assert.ok(!/"'-\d+"/.test(csv));
  const main = toCSV([missed], '2027-10-01'); assert.ok(!/"'-\d+"/.test(main));
});
test('letter placeholders all name what to fill in; no NOT FOUND in the letter or .docx', () => {
  for (const c of Object.values(E)) { const r = buildQueue([c], AS)[0]; const t = letter(c, r, AS);
    assert.ok(!/NOT FOUND/.test(t), c.id); assert.match(t, /^From: \[YOUR COMPANY, NAME, TITLE AND ADDRESS, FILL IN\]$/m); assert.match(t, /^To: \[OTHER PARTY, FILL IN\]/m); assert.match(t, /^\[YOUR NAME, TITLE AND COMPANY, FILL IN\]$/m);
    for (const m of t.match(/\[[^\]]*FILL IN\]/g)) assert.match(m, /^\[[A-Z][A-Z ,]+, FILL IN\]$/, m);
    assert.ok(!/NOT FOUND/.test(new TextDecoder().decode(docx(t))), c.id); }
});
