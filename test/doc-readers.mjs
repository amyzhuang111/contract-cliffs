// Node-side readers for the PDF/DOCX fixtures (unit tests). The browser uses pdf.js and JSZip
// (public/app.js); these use poppler's pdftotext and unzip so unit tests stay dependency-free.
import { execFileSync } from 'node:child_process';
export function pdfLines(file) {
  const pages = +execFileSync('pdfinfo', [file], { encoding: 'utf8' }).match(/Pages:\s+(\d+)/)[1];
  const out = [];
  for (let p = 1; p <= pages; p++) { let k = 0; execFileSync('pdftotext', ['-layout', '-f', String(p), '-l', String(p), file, '-'], { encoding: 'utf8' }).split('\n').forEach(t => { if (t.trim()) out.push({ text: t, page: p, pline: ++k }); }); }
  return out;
}
export function docxLines(file) {
  const xml = execFileSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const dec = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(m => ({ para: true, text: dec([...m[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(x => x[1]).join('')) }));
}
