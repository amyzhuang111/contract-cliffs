// Feature tests. Expected values were read by hand from the clause text in the real EDGAR filings in public/data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { extract, toICS, buildQueue } from '../public/extract.js';
import { withAlarms, gcalLink, sendDay } from '../public/features.js';
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
