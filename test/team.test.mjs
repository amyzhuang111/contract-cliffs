import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import { normTeam, parseTeam, blankTeam, ckey, pinFirst, togglePin, alarmDays, signerLines, okEmail } from '../public/team.js';
import { letter, withAlarms } from '../public/features.js';
import { extract, toICS, buildQueue, htmlToLines } from '../public/extract.js';
const AS = '2026-10-19';
const E = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../public/data/edgar.json', import.meta.url))).map(c => [c.id, { ...c, x: extract(c.lines) }]));
const T = normTeam({ company: 'General Intuition', signer: { name: 'Stan Yushenko', title: 'VP Ops', email: 'stan@example.com' }, warnDays: 45, calName: 'GI renewals', tz: 'America/Chicago' });

test('team: defaults and cleaning', () => {
  assert.equal(blankTeam().warnDays, 30); assert.equal(normTeam(null).warnDays, 30);
  const t = normTeam({ warnDays: '0', tz: 'Mars/Base', signer: { email: 'not an email' }, pins: ['a', 'a', 3, ''], ctx: { k: { plan: 'sell', note: ' hi ', owner: 'Ana' }, e: {} } });
  assert.equal(t.warnDays, 30); assert.equal(t.tz, 'America/New_York'); assert.equal(t.signer.email, ''); assert.deepEqual(t.pins, ['a']);
  assert.deepEqual(t.ctx, { k: { note: 'hi', owner: 'Ana', plan: '' } });
  assert.equal(normTeam({ warnDays: 400 }).warnDays, 30); assert.equal(normTeam({ warnDays: '60' }).warnDays, 60);
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
