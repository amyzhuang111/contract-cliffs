// Checks every portfolio EDGAR link resolves (HTTP 200) with a declared User-Agent, per SEC fair-access rules.
import fs from 'node:fs';
import { UA } from '../api/edgar.js';
const d = JSON.parse(fs.readFileSync(new URL('../public/data/portfolio.json', import.meta.url)));
let bad = 0;
for (const c of d) { const r = await fetch(c.url, { method: 'GET', headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow' }); console.log(r.status, c.url); if (r.status !== 200) bad++; await new Promise(z => setTimeout(z, 150)); }
console.log(`${d.length - bad}/${d.length} links return 200`); process.exit(bad ? 1 : 0);
