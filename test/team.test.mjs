import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import { normTeam, parseTeam, blankTeam, ckey, pinFirst, togglePin, alarmDays, signerLines, okEmail } from '../public/team.js';
import { letter, withAlarms } from '../public/features.js';
import { extract, toICS, buildQueue, htmlToLines } from '../public/extract.js';
const AS = '2026-10-19';
const E = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../public/data/edgar.json', import.meta.url))).map(c => [c.id, { ...c, x: extract(c.lines) }]));
const T = normTeam({ company: 'General Intuition', signer: { name: 'Stan Yushenko', title: 'VP Ops', email: 'stan@example.com' }, warnDays: 45, calName: 'GI renewals', tz: 'America/Chicago' });

test('team: defaults and cleaning', () => {
  assert.equal(blankTeam().warnDays, 30); assert.equal(normTeam(null).warnDays, 30);
  const t = normTeam({ warnDays: 'abc', tz: 'Mars/Base', signer: { email: 'not an email' }, pins: ['a', 'a', 3, ''], ctx: { k: { plan: 'sell', note: ' hi ', owner: 'Ana' }, e: {} } });
  assert.equal(t.warnDays, 30); assert.equal(t.tz, 'America/New_York'); assert.equal(t.signer.email, ''); assert.deepEqual(t.pins, ['a']);
  assert.deepEqual(t.ctx, { k: { note: 'hi', owner: 'Ana', plan: '' } });
  assert.equal(normTeam({ warnDays: 400 }).warnDays, 365); assert.equal(normTeam({ warnDays: 0 }).warnDays, 1); assert.equal(normTeam({ warnDays: 'x' }).warnDays, 30); assert.equal(normTeam({ warnDays: '' }).warnDays, 30); assert.equal(normTeam({ warnDays: '60' }).warnDays, 60);
  assert.ok(okEmail('a@b.co') && !okEmail('a@b') && !okEmail('a b@c.com'));
});
test('team: parse never throws', () => { assert.equal(parseTeam('{bad').error, 'corrupt'); assert.equal(parseTeam(null).team, null); assert.equal(parseTeam(JSON.stringify(T)).team.company, 'General Intuition'); });
test('team: keys and pins', () => {
  assert.equal(ckey({ secId: 'c5', id: 'm1' }), 'sec:c5'); assert.equal(ckey({ fileName: 'a.pdf', id: 'm2' }), 'file:a.pdf'); assert.equal(ckey({ id: 'p-x' }), 'p-x');
  const t = normTeam({}); assert.equal(togglePin(t, { id: 'b' }), true); assert.deepEqual(pinFirst([{ id: 'a' }, { id: 'b' }, { id: 'c' }], t, r => r.id).map(r => r.id), ['b', 'a', 'c']);
  assert.equal(togglePin(t, { id: 'b' }), false); assert.deepEqual(pinFirst([{ id: 'a' }, { id: 'b' }], t, r => r.id).map(r => r.id), ['a', 'b']);
});
test('team: reminder days come from the warning setting', () => { assert.deepEqual(alarmDays(30), [30, 14, 7]); assert.deepEqual(alarmDays(45), [45, 14, 7]); assert.deepEqual(alarmDays(10), [10, 7]); assert.deepEqual(alarmDays(5), [5]); });
test('team: letter fills From, signer and company', () => {
  const r = buildQueue([E.c5], AS)[0]; const t = letter(E.c5, r, AS, T);
  assert.match(t, /^From: Stan Yushenko, VP Ops, General Intuition, \[YOUR ADDRESS, FILL IN\] \(stan@example\.com\)$/m);
  assert.match(t, /^Stan Yushenko, VP Ops, General Intuition\nstan@example\.com$/m); assert.ok(!/YOUR (COMPANY|NAME|TITLE)/.test(t));
  assert.match(letter(E.c5, r, AS, normTeam({})), /^From: \[YOUR COMPANY, NAME, TITLE AND ADDRESS, FILL IN\]$/m);
  assert.match(signerLines(normTeam({ company: 'GI' })).from, /^\[YOUR NAME, FILL IN\], \[YOUR TITLE, FILL IN\], GI,/);
});
test('team: .ics uses warning days, calendar name and timezone', () => {
  const ics = withAlarms(toICS([E.c5, E.c3], AS), {}, { days: alarmDays(T.warnDays), calName: T.calName, tz: T.tz }).replace(/\r\n /g, '');
  const trig = [...ics.matchAll(/TRIGGER:(\S+)/g)].map(m => m[1]);
  assert.ok(trig.includes('-P45D') && trig.includes('-P14D') && trig.includes('-P7D') && !trig.includes('-P30D'));
  const t10 = withAlarms(toICS([E.c5], AS), {}, { days: alarmDays(10) }); assert.ok(/TRIGGER:-P10D/.test(t10) && !/TRIGGER:-P(14|30)D/.test(t10));
  assert.match(ics, /X-WR-CALNAME:GI renewals\r\nX-WR-TIMEZONE:America\/Chicago\r\n/);
  assert.deepEqual([...withAlarms(toICS([E.c5], AS), {}, { days: alarmDays(30) }).matchAll(/TRIGGER:(\S+)/g)].map(m => m[1]), [...withAlarms(toICS([E.c5], AS)).matchAll(/TRIGGER:(\S+)/g)].map(m => m[1])); // default setup = old reminders
});
import { ctxOf, setCtx, ctxLine, planAction } from '../public/team.js';
import { toCSV, toPacket } from '../public/extract.js';
import { auditCSV } from '../public/features.js';
import { weekHtml, rowsFor } from '../public/portfolio.js';
test('context: owner, plan and note are kept per contract and cleaned', () => {
  const t = normTeam({}); setCtx(t, E.c5, { owner: 'Ana', plan: 'cancel', note: 'Switching vendor' });
  assert.deepEqual(ctxOf(t, E.c5), { note: 'Switching vendor', owner: 'Ana', plan: 'cancel' }); assert.equal(ctxLine(ctxOf(t, E.c5)), 'Owner: Ana. Plan: cancel. Note: Switching vendor');
  setCtx(t, E.c5, { owner: '', plan: '', note: '' }); assert.deepEqual(t.ctx, {});
  assert.equal(setCtx(t, E.c5, { plan: 'sell' }), null);
});
test('context: the plan changes the action', () => {
  assert.deepEqual([planAction('cancel').letterFirst, planAction('renegotiate').letterFirst, planAction('renew').letter, planAction('').letter, planAction('').letterFirst], [true, true, false, true, false]);
  assert.match(planAction('renew').text, /No notice to send/);
  const t = normTeam({}); const A2 = '2026-12-12'; const rows = rowsFor([E.c5], A2);
  const plan = p => r => (setCtx(t, r.c, { plan: p }), ctxOf(t, r.c).plan);
  const first = h => (h.match(/<span class="wk-b">(<[ab][^>]*>[^<]*)/) || [])[1] || '';
  assert.match(first(weekHtml(rows, A2, () => 'https://calendar.google.com/x', plan('cancel'))), /btn-primary[^>]*data-letter[^>]*>Draft notice/);
  const rn = weekHtml(rows, A2, () => 'https://calendar.google.com/x', plan('renew')); assert.ok(!/data-letter/.test(rn) && /Add reminder/.test(rn) && /Plan: renew/.test(rn));
  assert.match(first(weekHtml(rows, A2, () => 'https://calendar.google.com/x', () => '')), /Add to calendar/);
});
test('context: CSV, audit pack and .ics carry owner, plan and note; notes keep the formula guard', () => {
  const cx = () => ({ owner: 'Ana', plan: 'renegotiate', note: '=HYPERLINK("http://x")' });
  const a = toCSV([E.c5], AS, cx).split('\r\n'); assert.match(a[0], /,owner,plan,note$/); assert.match(a[1], /,Ana,renegotiate,"'=HYPERLINK\(""http:\/\/x""\)"$/);
  const b = auditCSV([E.c5], AS, cx).split('\r\n'); assert.match(b[0], /,owner,plan,note$/); assert.match(b[1], /,Ana,renegotiate,"'=HYPERLINK/);
  assert.match(toPacket([E.c5], AS, cx), /<p class="ctx">Owner: Ana · Plan: renegotiate · Note: =HYPERLINK\(&quot;http:\/\/x&quot;\)<\/p>/);
  assert.match(toCSV([E.c5], AS).split('\r\n')[1], /,,,$/);
  const ics = withAlarms(toICS([E.c5], AS), { [E.c5.id]: ctxLine({ owner: 'Ana', plan: 'cancel', note: 'Switch' }) }).replace(/\r\n /g, '');
  assert.match(ics, /DESCRIPTION:[^\r\n]*Owner: Ana\. Plan: cancel\. Note: Switch/);
});
import { splitFiles, isDrive, driveId, DRIVE_BLOCKED, sheetsTSV, tsvCell, mailtoList, MAILTO_MAX } from '../public/team.js';
test('plug in: folder files are filtered to what we can read', () => {
  const { ok, skipped } = splitFiles(['a.pdf', 'b.DOCX', 'c.txt', 'd.htm', 'e.html', 'logo.png', '.DS_Store', 'x.xlsx'].map(name => ({ name })));
  assert.deepEqual(ok.map(f => f.name), ['a.pdf', 'b.DOCX', 'c.txt', 'd.htm', 'e.html']); assert.equal(skipped.length, 3);
});
test('plug in: Drive links are spotted and the blocked message is plain', () => {
  assert.ok(isDrive('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view?usp=sharing') && isDrive('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit') && !isDrive('https://www.sec.gov/x'));
  assert.equal(driveId('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view?usp=sharing'), '1AbCdEfGhIjKlMnOpQrStUv'); assert.equal(driveId('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp'), '1AbCdEfGhIjKlMnOp'); assert.equal(driveId('https://drive.google.com/drive/my-drive'), '');

  assert.equal(DRIVE_BLOCKED, 'Drive blocks this from the browser; download the PDF and drop it here.');
});
const IT = n => Array.from({ length: n }, (_, i) => ({ name: `Vendor ${i + 1} / Acme Supply Company`, action: `Send notice by ${i + 1} Dec 2026`, date: '2026-12-01', days: 43, review: i % 2 === 0, owner: 'Ana', plan: 'cancel', note: 'line one\nline\ttwo', source: 'https://www.sec.gov/x' }));
test('plug in: Sheets text is tab separated, one line per row, formulas made plain', () => {
  const t = sheetsTSV(IT(2)); const L = t.trim().split('\n');
  assert.equal(L.length, 3); assert.ok(L.every(l => l.split('\t').length === 9)); assert.match(L[1], /\tline one line two\t/);
  assert.equal(tsvCell('=SUM(A1)'), "'=SUM(A1)"); assert.equal(tsvCell('+1 555'), "'+1 555"); assert.equal(tsvCell('-30'), '-30'); assert.equal(tsvCell('@x'), "'@x");
});
test('plug in: email draft is short and says when it was cut', () => {
  const s = mailtoList(IT(3), { to: 'stan@example.com', asOf: AS }); assert.equal(s.shown, 3); assert.match(s.url, /^mailto:stan%40example\.com\?subject=Contract%20notice%20deadlines%20as%20of%202026-10-19&body=3%20contracts/);
  assert.ok(!/more%20not%20shown/.test(s.url));
  const l = mailtoList(IT(60), { asOf: AS }); assert.ok(l.url.length <= MAILTO_MAX && l.shown < 60 && l.shown > 3);
  assert.match(decodeURIComponent(l.url), new RegExp(`${60 - l.shown} more not shown: the list is too long for an email link\\. Use Export CSV for all of them\\.$`));
});
test('progress: reading files adds no fixed delay', () => {
  const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'); const st = src.slice(src.indexOf('async function stage('), src.indexOf('const busyDone'));
  assert.ok(st.length > 50 && !/setTimeout\(r, [1-9]/.test(st), 'stage() must not wait a fixed time'); assert.match(src, /const GUIDED_PACE = params\.get\('demo'\) === '1' \? 250 : 0;/);
  assert.match(src, /Done\. Read \$\{word\(added\)\}/);
});
import { htmlToLines as h2l } from '../public/extract.js';
const ARM = (() => { const c = { id: 'arm', name: 'Armlogi / Goldensee', lines: h2l(fs.readFileSync(new URL('./fixtures/armlogi-goldensee-ex10-11.edgar.htm', import.meta.url), 'utf8')) }; c.x = extract(c.lines); return c; })();
test('renew plan: the .ics event is a renewal-date reminder with no send-notice wording (Armlogi)', () => {
  const ics = withAlarms(toICS([ARM], AS), { arm: 'Plan: renew.' }, { days: alarmDays(30), renew: { arm: { name: ARM.name, termEnd: '2027-07-20' } } }).replace(/\r\n /g, '');
  const ev = ics.slice(ics.indexOf('BEGIN:VEVENT'), ics.indexOf('END:VEVENT'));
  assert.match(ev, /SUMMARY:Renews 21 July 2027 \(plan: renew\): Armlogi \/ Goldensee/); assert.match(ev, /DTSTART;VALUE=DATE:20270721\r\nDTEND;VALUE=DATE:20270722/);
  assert.match(ev, /DESCRIPTION:Plan: renew\. Nothing to send\\; this is a reminder of the renewal date\. The current term ends 20 July 2027 and the contract renews on 21 July 2027\./);
  assert.deepEqual([...ev.matchAll(/TRIGGER:(\S+)/g)].map(m => m[1]), ['-P30D', '-P14D', '-P7D']); assert.match(ev, /30 days to the renewal date \(plan: renew\)/);
  assert.ok(!/send notice|send-notice|window opens/i.test(ev), 'no send-notice wording');
  const plain = withAlarms(toICS([ARM], AS)); assert.match(plain, /Window opens: send notice on/); // no plan: unchanged
});
test("'within' send-by date in every export equals the Send notice on date (Armlogi 2027-06-20, not 06-17)", () => {
  const a = toCSV([ARM], AS).split('\r\n').find(l => /Send-notice deadline/.test(l)); assert.match(a, /,2027-06-20,\d+,2026-10-19,2027-06-20,/); assert.ok(!/2027-06-17/.test(toCSV([ARM], AS)));
  const b = auditCSV([ARM], AS).split('\r\n')[1]; assert.match(b, /^Armlogi \/ Goldensee,,2027-06-20,2027-06-20,/);
  assert.ok(!/2027-06-17/.test(toPacket([ARM], AS)) && /2027-06-20/.test(toPacket([ARM], AS)));
  const csv3 = toCSV([E.c5], AS); assert.match(csv3, /2026-12-16/); // other clause types unchanged
});
test('copy: no doubled full stop after Inc.; email says pinned first when pins lead', () => {
  assert.match(decodeURIComponent(mailtoList([{ ...IT(1)[0], pinned: true }, IT(2)[1]], { asOf: AS }).url), /2 contracts, pinned first, then soonest:/);
  assert.match(decodeURIComponent(mailtoList(IT(2), { asOf: AS }).url), /2 contracts, soonest first:/);
  const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'); assert.match(src, /const stop = t => \/\[\.!\?\]\$\/\.test\(t\)/);
});
test('email: the plan is named once', () => {
  const u = decodeURIComponent(mailtoList([{ ...IT(1)[0], plan: 'renew', action: 'Renews 21 Jul 2027; reminder only, nothing to send (plan: renew)' }, { ...IT(1)[0], plan: 'cancel' }], { asOf: AS }).url);
  assert.equal((u.match(/\(plan: renew\)/g) || []).length, 1); assert.equal((u.match(/\(plan: cancel\)/g) || []).length, 1);
});
