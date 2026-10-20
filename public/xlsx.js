// Formatted .xlsx built in the browser with the vendored exceljs (MIT, /vendor/LICENSE-exceljs.txt). No network.
// buildXlsx(ExcelJS, items, { company, asOf }) -> ArrayBuffer. Items come from the same list as the CSV and Sheets copy.
import { SHEET_COLS, MAIN_COLS, dmy, tsvCell } from './team.js';
export const RED = 'FFF8D7D7', YELLOW = 'FFEBFF0A', INK = 'FF000000';
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const WIDTH = [34, 24, 16, 10, 18, 12, 14, 46, 40, 60, 44];
const day = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); };
// guard: a text cell never starts with = + - @ (it would run as a formula when someone edits it)
const g = v => typeof v === 'string' ? tsvCell(v) : v;
export const fillOf = i => i.urgent ? RED : i.review ? YELLOW : null; // both: red wins (urgency first); see About

function header(ws, cols) {
  const h = ws.getRow(2); cols.forEach((t, k) => { const c = h.getCell(k + 1); c.value = t; c.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } }; c.alignment = { vertical: 'middle' }; });
  h.height = 22;
}
function title(ws, text, span) { ws.mergeCells(1, 1, 1, span); const c = ws.getCell('A1'); c.value = text; c.font = { bold: true, size: 14, name: 'Arial' }; ws.getRow(1).height = 24; }
function rowOut(ws, n, i) {
  const r = ws.getRow(n); const v = [i.name, i.counterparty, i.sendBy ? day(i.sendBy) : null, i.days === '' ? null : i.days, i.status, i.plan, i.owner, i.todo, i.note, i.why, null];
  v.forEach((x, k) => { if (x !== null && x !== '') r.getCell(k + 1).value = g(x); });
  if (i.link) r.getCell(11).value = { text: g(i.link.replace(/^https?:\/\//, '').slice(0, 80)), hyperlink: i.link };
  r.getCell(3).numFmt = 'd mmm yyyy'; r.getCell(4).numFmt = '0';
  r.getCell(11).font = { color: { argb: 'FF1F4E99' }, underline: true };
  [8, 9, 10].forEach(k => { r.getCell(k).alignment = { wrapText: true, vertical: 'top' }; });
  for (let k = 1; k <= 7; k++) r.getCell(k).alignment = { vertical: 'top', ...(k === 4 ? { horizontal: 'right' } : {}) };
  const f = fillOf(i); if (f) for (let k = 1; k <= SHEET_COLS.length; k++) r.getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f } };
  // rows sized to the visible text (What to do), capped at 2 lines; Note and Why keep their full text in the cell
  const lines = Math.min(2, Math.max(1, Math.ceil(String(i.todo || '').length / (46 * 1.15))));
  r.height = 15 * lines + 3;
}
function frame(ws, last) {
  ws.columns.forEach((c, k) => { c.width = WIDTH[k] || 14; });
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 2, topLeftCell: 'A3', activeCell: 'A1', showGridLines: false }];
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: Math.max(2, last), column: SHEET_COLS.length } };
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '2:2' };
}
export const ABOUT = asOf => [
  ['How the dates were worked out'],
  [`Every date is read from the contract's own words, as of ${dmy(asOf)}.`],
  ['Send notice by is the last day to give notice. When it falls on a weekend or a US federal holiday (2026 to 2035), it moves back to the business day before. The exception is a \'within\' date: it stays where it is, even on a weekend, because that date satisfies both readings of the clause (see Why).'],
  ['Some clauses say notice must be given "within" a period before the term ends. That can mean a window that opens on the date, or a cutoff at least that long before. The sheet shows the one date that satisfies both readings and marks it Needs review: check with counsel which reading applies.'],
  ['A Renew plan means nothing is sent: What to do shows the renewal date, and Send notice by is the last day to change your mind.'],
  [''],
  ['Colours'],
  ['Soft red: due within 30 days, or the notice date was missed. Yellow: needs a person to check. A row that is both is red, because the deadline comes first; it is still listed on the Needs a human look sheet.'],
  [''],
  ['About the data'],
  ['Contracts are read in your browser and nothing is uploaded. If you used the sample contracts, they are public SEC filings standing in for your own.'],
  ['This is a reading of the contract, not legal advice. Check every date against the contract before you rely on it.'],
];
export async function buildXlsx(ExcelJS, items, { company = '', asOf }) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Contract Cliffs'; wb.created = new Date(Date.UTC(+asOf.slice(0, 4), +asOf.slice(5, 7) - 1, +asOf.slice(8, 10)));
  const ws = wb.addWorksheet('Deadlines', { properties: { defaultRowHeight: 18 } });
  ws.columns = SHEET_COLS.map(() => ({})); title(ws, `${company ? company + ' · ' : ''}Contract notice deadlines as of ${dmy(asOf)}`, MAIN_COLS); header(ws, SHEET_COLS);
  items.forEach((i, k) => rowOut(ws, k + 3, i)); frame(ws, items.length + 2);
  const rv = wb.addWorksheet('Needs a human look'); const rvi = items.filter(i => i.review);
  rv.columns = SHEET_COLS.map(() => ({})); title(rv, `Needs a human look · ${rvi.length} of ${items.length}`, MAIN_COLS); header(rv, SHEET_COLS);
  rvi.forEach((i, k) => rowOut(rv, k + 3, { ...i, why: !i.reason || (i.why || '').toLowerCase().includes(i.reason.toLowerCase()) ? i.why : `${i.reason[0].toUpperCase()}${i.reason.slice(1)}. ${i.why || ''}`.trim() })); frame(rv, rvi.length + 2);
  const ab = wb.addWorksheet('About'); ab.getColumn(1).width = 110;
  ABOUT(asOf).forEach((r, k) => { const c = ab.getCell(k + 1, 1); c.value = r[0]; c.alignment = { wrapText: true, vertical: 'top' }; if (/^(How the dates|Colours|About the data)/.test(r[0])) c.font = { bold: true, size: 12 }; ab.getRow(k + 1).height = 15 * Math.max(1, Math.ceil(r[0].length / 105)) + 4; });
  ab.views = [{ activeCell: 'A1', showGridLines: false }];
  wb.views = [{ activeTab: 0, firstSheet: 0 }];
  return wb.xlsx.writeBuffer();
}
