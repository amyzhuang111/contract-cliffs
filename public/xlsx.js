// Formatted .xlsx built in the browser with the vendored exceljs (MIT, /vendor/LICENSE-exceljs.txt). No network.
// buildXlsx(ExcelJS, items, { company, asOf }) -> ArrayBuffer. Items come from the same list as the CSV and Sheets copy.
import { SHEET_COLS, MAIN_COLS, dmy, tsvCell } from './team.js';
export const RED = 'FFF8D7D7', YELLOW = 'FFEBFF0A', INK = 'FF000000';
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const WIDTH = [34, 24, 16, 10, 18, 12, 14, 46, 40, 60, 44];
const KEYS = ['contract', 'counterparty', 'sendBy', 'days', 'status', 'plan', 'owner', 'todo', 'note', 'why', 'link'];
// Needs a human look: the short reason gets its own column; rows fit their full text
export const RV_COLS = ['Contract', 'Counterparty', 'Send notice by', 'Days left', 'Status', 'Reason', 'What to do', 'Note', 'Why', 'Filing link'];
const RV_KEYS = ['contract', 'counterparty', 'sendBy', 'days', 'status', 'reason', 'todo', 'note', 'why', 'link'];
const RV_WIDTH = [30, 22, 14, 10, 18, 30, 40, 36, 60, 40];
const day = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); };
// guard: a text cell never starts with = + - @ (it would run as a formula when someone edits it)
const g = v => typeof v === 'string' ? tsvCell(v) : v;
export const fillOf = i => i.urgent ? RED : i.review ? YELLOW : null; // both: red wins (urgency first); see About

function header(ws, cols) {
  const h = ws.getRow(2); cols.forEach((t, k) => { const c = h.getCell(k + 1); c.value = t; c.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } }; c.alignment = { vertical: 'middle' }; });
  h.height = 22;
}
function title(ws, text, span) { ws.mergeCells(1, 1, 1, span); const c = ws.getCell('A1'); c.value = text; c.font = { bold: true, size: 14, name: 'Arial' }; ws.getRow(1).height = 24; }
// how many lines a wrapped cell needs at its column width (about 1 character per width unit in Arial 11)
export const linesFor = (t, w) => String(t ?? '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / w)), 0);
const LINE = 15;
function rowOut(ws, n, i, cols, widths, { fit = [], extra = false } = {}) {
  const r = ws.getRow(n); const val = { contract: i.name, counterparty: i.counterparty, sendBy: i.sendBy ? day(i.sendBy) : null, days: i.days === '' ? null : i.days, status: i.status, plan: i.plan, owner: i.owner, reason: i.reason ? i.reason[0].toUpperCase() + i.reason.slice(1) : '', todo: i.todo, note: i.note, why: i.why, link: null };
  cols.forEach((key, k) => { const c = r.getCell(k + 1), x = val[key]; if (x !== null && x !== '' && x !== undefined) c.value = g(x);
    c.alignment = { vertical: 'top', ...(key === 'days' ? { horizontal: 'right' } : { wrapText: !['sendBy', 'link'].includes(key) }) };
    if (key === 'sendBy') c.numFmt = 'd mmm yyyy'; if (key === 'days') c.numFmt = '0';
    if (key === 'link') { if (i.link) c.value = { text: g(i.link.replace(/^https?:\/\//, '').slice(0, 80)), hyperlink: i.link }; c.font = { color: { argb: 'FF1F4E99' }, underline: true }; } });
  const f = fillOf(i); if (f) cols.forEach((_, k) => { r.getCell(k + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f } }; });
  // height from the wrapped line count of the columns that should show in full; a row with a Note or Why gets at least 2 lines
  const lines = Math.max(extra && (i.note || i.why) ? 2 : 1, ...cols.map((key, k) => fit.includes(key) && r.getCell(k + 1).alignment.wrapText ? linesFor(r.getCell(k + 1).text, widths[k]) : 1));
  r.height = LINE * lines + 3;
}
function frame(ws, last, widths = WIDTH, ncol = SHEET_COLS.length) {
  ws.columns.forEach((c, k) => { c.width = widths[k] || 14; });
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 2, topLeftCell: 'A3', activeCell: 'A1', showGridLines: false }];
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: Math.max(2, last), column: ncol } };
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
  items.forEach((i, k) => rowOut(ws, k + 3, i, KEYS, WIDTH, { fit: KEYS.slice(0, MAIN_COLS), extra: true })); frame(ws, items.length + 2);
  const rv = wb.addWorksheet('Needs a human look'); const rvi = items.filter(i => i.review);
  rv.columns = RV_COLS.map(() => ({})); title(rv, `Needs a human look · ${rvi.length} of ${items.length}`, 7); header(rv, RV_COLS);
  rvi.forEach((i, k) => rowOut(rv, k + 3, { ...i, why: String(i.why || '').replace(/\s*Needs review: [^.]*\.?$/i, '').trim() }, RV_KEYS, RV_WIDTH, { fit: RV_KEYS })); frame(rv, rvi.length + 2, RV_WIDTH, RV_COLS.length);
  const ab = wb.addWorksheet('About'); ab.getColumn(1).width = 110;
  ABOUT(asOf).forEach((r, k) => { const c = ab.getCell(k + 1, 1); c.value = r[0]; c.alignment = { wrapText: true, vertical: 'top' }; if (/^(How the dates|Colours|About the data)/.test(r[0])) c.font = { bold: true, size: 12 }; ab.getRow(k + 1).height = 15 * Math.max(1, Math.ceil(r[0].length / 105)) + 4; });
  ab.views = [{ activeCell: 'A1', showGridLines: false }];
  wb.views = [{ activeTab: 0, firstSheet: 0 }];
  return wb.xlsx.writeBuffer();
}
