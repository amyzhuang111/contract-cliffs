// Parse the generated .xlsx back and check it opens cleanly (exceljs, openpyxl, LibreOffice headless).
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { buildXlsx, linesFor, RV_COLS, RED, YELLOW, fillOf } from '../public/xlsx.js';
import { SHEET_COLS, MAIN_COLS, sheetCSV, sheetsTSV } from '../public/team.js';
export const ITEMS = [
  { name: 'Star Brands / Schwazze', counterparty: 'Schwazze', sendBy: '2026-11-10', days: 21, status: 'Due in 30 days', plan: 'cancel', owner: 'Ana Ruiz', todo: 'Send notice by 10 Nov 2026', note: '=HYPERLINK("http://x") switch vendor', why: '', link: 'https://www.sec.gov/Archives/edgar/data/1/x.htm', review: false, urgent: true },
  { name: 'Goldensee / Armstrong Logistic', counterparty: 'Armstrong', sendBy: '2027-06-20', days: 243, status: 'Renewing · review', plan: 'renew', owner: '', todo: 'Renews 21 Jul 2027 (in 274 days); nothing to send', note: '', why: 'Last day to change your mind: 20 Jun 2027, the date that satisfies both readings of "within one month before". Check with counsel which reading applies. It is a Sunday, so check the notices clause allows delivery that day.', link: '', review: true, reason: 'two readings', urgent: false },
  { name: 'Dragonfly Energy / Keystone RV', counterparty: '+Keystone', sendBy: '2027-09-17', days: 333, status: 'Missed · review', plan: '', owner: '', todo: 'Missed; next notice by 17 Sep 2027', note: '', why: '', link: '', review: true, reason: 'check the clause', urgent: false },
  { name: 'Quiet Co', counterparty: '', sendBy: '2027-12-01', days: 407, status: 'Later', plan: '', owner: '', todo: 'Send notice by 1 Dec 2027', note: '', why: '', link: '', review: false, urgent: false },
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-')); const FILE = path.join(tmp, 'deadlines.xlsx');
const buf = Buffer.from(await buildXlsx(ExcelJS, ITEMS, { company: 'General Intuition', asOf: '2026-10-20' })); fs.writeFileSync(FILE, buf);
const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); const ws = wb.getWorksheet('Deadlines');
const argb = c => c.fill?.fgColor?.argb;

test('xlsx: three sheets, title, frozen bold header in GI black, A1 selected', () => {
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Deadlines', 'Needs a human look', 'About']);
  assert.equal(ws.getCell('A1').value, 'General Intuition · Contract notice deadlines as of 20 Oct 2026');
  assert.deepEqual(ws.getRow(2).values.slice(1), SHEET_COLS); const h = ws.getCell('A2'); assert.equal(h.font.bold, true); assert.equal(argb(h), 'FF000000'); assert.equal(h.font.color.argb, 'FFFFFFFF');
  assert.equal(ws.views[0].state, 'frozen'); assert.equal(ws.views[0].ySplit, 2); assert.equal(ws.views[0].activeCell, 'A1');
});
test('xlsx: real date and number cells shown as D MMM YYYY; no ISO text anywhere visible', () => {
  const d = ws.getCell('C3'); assert.ok(d.value instanceof Date); assert.equal(d.value.toISOString().slice(0, 10), '2026-11-10'); assert.equal(d.numFmt, 'd mmm yyyy');
  assert.equal(typeof ws.getCell('D3').value, 'number'); assert.equal(ws.getCell('D3').value, 21);
  ws.eachRow(r => r.eachCell(c => { if (typeof c.value === 'string') assert.ok(!/\b\d{4}-\d{2}-\d{2}\b/.test(c.value), c.address); }));
});
test('xlsx: fills (red only for action due within 30 days, a missed row far off is not red; yellow for review, red wins), autofilter, print setup, widths', () => {
  assert.equal(argb(ws.getCell('A3')), RED); assert.equal(argb(ws.getCell('A4')), YELLOW); assert.equal(argb(ws.getCell('A5')), YELLOW, 'missed, next deadline in 333 days: not red'); assert.equal(argb(ws.getCell('A6')), undefined);
  assert.equal(fillOf({ urgent: true, review: true }), RED);
  assert.equal(ws.autoFilter, 'A2:K6');
  assert.equal(ws.pageSetup.orientation, 'landscape'); assert.equal(ws.pageSetup.fitToWidth, 1); assert.equal(ws.pageSetup.fitToHeight, 0); assert.equal(ws.pageSetup.fitToPage, true);
  // about 8 columns visible at 1440: Excel shows a width-1 column as about 7 px plus padding
  const px = k => ws.getColumn(k).width * 7 + 5; const main = [...Array(MAIN_COLS).keys()].reduce((a, k) => a + px(k + 1), 0);
  assert.ok(main + 60 <= 1440 && main + px(9) > 1440 - 200, `first 8 columns fit in 1440 (${main} px)`);
  assert.equal(ws.getCell('I3').alignment.wrapText, true); assert.equal(ws.getCell('H3').alignment.wrapText, true); assert.equal(ws.getColumn(8).width, 46);
  for (const k of [1, 2, 5, 8]) assert.equal(ws.getCell(3, k).alignment.wrapText, true, `column ${k} wraps`);
  // every row is at least lines x 15pt for its visible wrapped cells; clean rows 1 line, rows with a Note or Why 2
  const fits = (sh, cols, extra) => { for (let n = 3; n <= sh.rowCount; n++) { const row = sh.getRow(n); let need = extra && (row.getCell(9).text || row.getCell(10).text) ? Math.min(3, Math.max(2, linesFor(row.getCell(10).text, sh.getColumn(10).width))) : 1;
    for (const k of cols) { const c = row.getCell(k); if (c.alignment?.wrapText) need = Math.max(need, linesFor(c.text, sh.getColumn(k).width)); }
    assert.ok(row.height >= need * 15, `${sh.name} row ${n}: ${row.height}pt for ${need} lines`); if (extra) assert.ok(row.height <= need * 15 + 3, `${sh.name} row ${n} not taller than it needs`); } };
  fits(ws, [1, 2, 3, 4, 5, 6, 7, 8], true); assert.equal(ws.getRow(6).height, 18, 'clean row is 1 line'); assert.ok(ws.getRow(4).height >= 33, 'row with a Why is 2 lines');
  assert.ok(String(ws.getCell('J4').value).length > 200, 'full Why text kept in the cell');
  const rv0 = wb.getWorksheet('Needs a human look'); fits(rv0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], false);
  for (let n = 3; n <= rv0.rowCount; n++) { const row = rv0.getRow(n); assert.ok(row.height >= linesFor(row.getCell(9).text, 60) * 15, 'Why fits in full, no cap'); }
});
test('xlsx: hyperlink, formula guard, renew row agrees with the card, Needs a human look and About', async () => {
  const l = ws.getCell('K3').value; assert.equal(l.hyperlink, 'https://www.sec.gov/Archives/edgar/data/1/x.htm'); assert.equal(l.text, 'Filing ↗'); assert.equal(ws.getRow(4).height, 48, 'long Why gets 3 lines');
  assert.equal(ws.getCell('I3').value, "'=HYPERLINK(\"http://x\") switch vendor"); assert.equal(ws.getCell('B5').value, "'+Keystone");
  ws.eachRow(r => r.eachCell(c => assert.ok(!c.formula, 'no formula cells')));
  assert.equal(ws.getCell('H4').value, 'Renews 21 Jul 2027 (in 274 days); nothing to send'); assert.match(ws.getCell('J4').value, /satisfies both readings of "within one month before"/);
  const rv = wb.getWorksheet('Needs a human look'); assert.equal(rv.rowCount, 4); assert.deepEqual(rv.getRow(2).values.slice(1), RV_COLS); assert.equal(rv.getCell('F3').value, 'Two readings'); assert.equal(rv.getCell('F4').value, 'Check the clause'); assert.ok(!/Needs review/.test(rv.getCell('I4').text));
  const ab = wb.getWorksheet('About').getColumn(1).values.join('\n'); for (const re of [/business day/, /US federal holiday/, /satisfies both readings/, /standing in for your own/, /A row that is both is red/, /exception is a 'within' date: it stays where it is, even on a weekend, because that date satisfies both readings/]) assert.match(ab, re);
  { const one = { name: 'X', counterparty: '', sendBy: '2027-01-04', days: 76, status: 'Due this year · review', plan: '', owner: '', todo: 'Send notice by 4 Jan 2027', note: '', why: 'Needs review: renewal depends on a condition; confirm it holds.', link: '', review: true, reason: 'renewal depends on a condition; confirm it holds', urgent: false };
    const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(await buildXlsx(ExcelJS, [one], { company: 'GI', asOf: '2026-10-20' }));
    const j = String(wb2.getWorksheet('Needs a human look').getRow(3).values.slice(1).map(v => typeof v === 'object' && v ? '' : v).join(' ')); assert.equal(j.toLowerCase().split('renewal depends on a condition').length - 1, 1, 'reason said once: ' + j); }
});
test('xlsx: openpyxl loads it with the same types; LibreOffice converts it without errors', () => {
  const py = execFileSync('python3', ['-c', `import openpyxl,sys,datetime;wb=openpyxl.load_workbook(sys.argv[1]);ws=wb['Deadlines'];print(wb.sheetnames, type(ws['C3'].value).__name__, type(ws['D3'].value).__name__, ws.freeze_panes, ws.auto_filter.ref, ws['K3'].hyperlink.target, ws['A3'].fill.fgColor.rgb)`, FILE], { encoding: 'utf8' });
  assert.equal(py.trim(), "['Deadlines', 'Needs a human look', 'About'] datetime int A3 A2:K6 https://www.sec.gov/Archives/edgar/data/1/x.htm " + RED);
  const out = execFileSync('soffice', ['--headless', '--convert-to', 'csv', '--outdir', tmp, FILE], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(out, /convert .* -> .*deadlines\.csv/); assert.ok(!/error/i.test(out)); const lo = fs.readFileSync(path.join(tmp, 'deadlines.csv'), 'utf8'); assert.match(lo, /Star Brands \/ Schwazze,Schwazze,/);
});
test('csv and Sheets copy: same columns in the same order, short cells, BOM, guard', () => {
  const csv = sheetCSV(ITEMS); assert.ok(csv.startsWith('\ufeffContract,Counterparty,Send notice by,Days left,Status,Plan,Owner,What to do,Note,Why,Filing link\r\n'));
  const L = csv.slice(1).trim().split('\r\n'); assert.equal(L.length, 5); assert.match(L[1], /^Star Brands \/ Schwazze,Schwazze,10 Nov 2026,21,Due in 30 days,cancel,Ana Ruiz,Send notice by 10 Nov 2026,"'=HYPERLINK\(""http:\/\/x""\) switch vendor",,https:/);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(csv)); assert.equal(sheetsTSV(ITEMS).split('\n')[0], SHEET_COLS.join('\t'));
});
if (process.env.XLSX_SHOTS) test('xlsx: render to PNG with LibreOffice', () => { execFileSync('node', [new URL('./xlsx-render.mjs', import.meta.url).pathname, FILE, process.env.XLSX_SHOTS]); });
