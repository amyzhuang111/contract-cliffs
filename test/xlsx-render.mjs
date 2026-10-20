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
await p.screenshot({ path: path.join(out, 'xlsx-first-view-1440.png') });
await b.close(); console.log(tables.length + ' sheets rendered');
