// Render a generated .xlsx with LibreOffice headless (xlsx -> html, then a 1440-wide browser shot per sheet).
// Usage: node test/xlsx-render.mjs file.xlsx outdir   -> outdir/xlsx-<sheet>-1440.png
import puppeteer from 'puppeteer-core'; import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const [file, out] = process.argv.slice(2); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xlr-'));
const log = execFileSync('soffice', ['--headless', '--convert-to', 'html', '--outdir', tmp, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const html = path.join(tmp, path.basename(file).replace(/\.xlsx$/, '.html')); if (!fs.existsSync(html)) { console.error('convert failed', log); process.exit(1); }
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] }); const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 }); await p.goto('file://' + html);
const names = ['deadlines', 'needs-review', 'about']; const tables = await p.$$('table');
for (let k = 0; k < Math.min(tables.length, 3); k++) { await tables[k].scrollIntoView(); await tables[k].screenshot({ path: path.join(out, `xlsx-${names[k]}-1440.png`) }); }
// first view as a spreadsheet app opens it: top-left, A1 selected, title and frozen header pinned, widths and heights from the file
{ const { default: ExcelJS } = await import('exceljs'); const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file); for (const [sheet, png, span] of [['Deadlines', 'xlsx-first-view-1440.png', 8], ['Needs a human look', 'xlsx-needs-review-first-view-1440.png', 7]]) { const ws = wb.getWorksheet(sheet);
  const e = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const cols = ws.columns.map(c => Math.round(c.width * 7 + 5)); const frz = ws.views[0].ySplit; let h = `<style>body{margin:0;font:13px Arial}table{border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #d4d4d4;padding:1px 4px;overflow:hidden;vertical-align:top;white-space:nowrap}th{background:#f3f3f3;font-weight:normal;color:#555;text-align:center}.w{white-space:normal}.f td{position:sticky}tr.fz td{border-bottom:2px solid #888}td.sel{outline:2px solid #1a73e8;outline-offset:-2px}</style><table><tr><th style="width:40px"></th>${cols.map((w, k) => `<th style="width:${w}px">${String.fromCharCode(65 + k)}</th>`).join('')}</tr>`;
  for (let r = 1; r <= Math.min(ws.rowCount, 40); r++) { const row = ws.getRow(r); h += `<tr class="${r === frz ? 'fz' : ''}" style="height:${Math.round((row.height || 15) * 4 / 3)}px"><th>${r}</th>`;
    for (let k = 1; k <= cols.length; k++) { const c = row.getCell(k); if (r === 1 && k > 1 && k <= span) continue; let v = c.value; if (v instanceof Date) v = `${v.getUTCDate()} ${M[v.getUTCMonth()]} ${v.getUTCFullYear()}`; else if (v && typeof v === 'object') v = v.text; if (typeof v === 'string') v = v.replace(/^'/, '');
      const st = [c.fill?.fgColor?.argb ? `background:#${c.fill.fgColor.argb.slice(2)}` : '', c.font?.bold ? 'font-weight:bold' : '', c.font?.color?.argb ? `color:#${c.font.color.argb.slice(2)}` : '', c.font?.size ? `font-size:${c.font.size}px` : '', c.alignment?.horizontal === 'right' ? 'text-align:right' : ''].filter(Boolean).join(';');
      h += `<td${r === 1 && k === 1 ? ` colspan="${span}"` : ''} class="${c.alignment?.wrapText ? 'w' : ''}${r === 1 && k === 1 ? ' sel' : ''}" style="${st}"><div style="max-height:${Math.round((row.height || 15) * 4 / 3) - 2}px;overflow:hidden">${e(v)}</div></td>`; }
    h += '</tr>'; }
  const f = path.join(tmp, png + '.html'); fs.writeFileSync(f, h + '</table>'); await p.goto('file://' + f); await p.screenshot({ path: path.join(out, png), clip: { x: 0, y: 0, width: 1440, height: 900 } }); } }
await b.close(); console.log(tables.length + ' sheets rendered');
