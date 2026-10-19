import { extract, schedule, buildQueue, toCSV, toICS, toPacket, daysBetween } from '/extract.js';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = new Date(); const pad = n => String(n).padStart(2, '0');
const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
const params = new URLSearchParams(location.search);
let asOf = /^\d{4}-\d{2}-\d{2}$/.test(params.get('asof') || '') ? params.get('asof') : todayStr;
$('#asof').value = asOf;
let edgar = [], mine = [], set = 'edgar';
const current = () => set === 'edgar' ? edgar : mine;
const fmt = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${+dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y}`; };
const STOP = /^(the|inc\.?|llc|corp\.?|corporation|company|co\.?|ltd\.?|limited|holdings|of|and|\(.*)$/i;
const initials = name => (name || '?').replace(/[(),.]/g, ' ').split(/\s+/).filter(w => w && !STOP.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

async function loadEdgar() {
  $('#status').textContent = 'Loading SEC filings…';
  const r = await fetch('/data/edgar.json'); const data = await r.json();
  edgar = data.map(c => ({ ...c, source: 'edgar', x: extract(c.lines) }));
  render();
}
function render() {
  const cs = current();
  $('#setEdgar').setAttribute('aria-pressed', set === 'edgar'); $('#setMine').setAttribute('aria-pressed', set === 'mine');
  const rows = buildQueue(cs, asOf);
  const dated = rows.filter(r => r.actBy).length;
  $('#status').textContent = cs.length ? `${cs.length} contracts · ${dated} with a computed date · ${rows.length - dated} need review` : 'No documents yet. Upload or paste a contract.';
  $('#setnote').innerHTML = set === 'edgar' ? 'Real public contracts (SEC EDGAR). Ten Exhibit 10 agreements: supply, licence, data licence, cloud and managed services. Each card links to the filing it came from.' : 'Your documents. Processed only in this browser tab; nothing is uploaded.';
  $('#queue').innerHTML = rows.map(r => `<li data-id="${esc(r.id)}" class="${r.days != null && r.days < 0 ? 'past' : ''}" tabindex="0">
    <span class="d">${r.actBy ? esc(fmt(r.actBy)) : '—'}</span>
    <span class="n">${r.days == null ? '' : r.days < 0 ? `${-r.days} days ago` : r.days === 0 ? 'today' : `in ${r.days} days`}</span>
    <span class="c"><b>${esc(r.name)}</b><div>${r.actBy ? esc(r.label) : 'Needs review: ' + esc((r.item?.why || '').split('.')[0])}</div></span>
    <span class="s">${r.needsReview ? '<em class="rv">Needs review</em> · ' : ''}${esc(r.confidence)} confidence</span></li>`).join('');
  $('#cards').innerHTML = cs.map(c => { const r = rows.find(x => x.id === c.id);
    return `<button class="card" data-id="${esc(c.id)}"><div class="tile" aria-hidden="true">${esc(initials(c.counterparty || c.name))}</div>
    <div class="t">${esc(c.name)}</div><div class="m">${esc(c.kind || 'Uploaded')}${c.exhibit ? ' · ' + esc(c.exhibit) : ''}${c.filed ? ' · filed ' + esc(fmt(c.filed)) : ''}</div>
    <div class="a">${r?.actBy ? `${esc(r.label)} ${esc(fmt(r.actBy))}` : '<span class="rv">Needs review</span>'}</div></button>`; }).join('');
  document.querySelectorAll('[data-id]').forEach(el => { el.onclick = () => openDrawer(el.dataset.id); el.onkeydown = e => { if (e.key === 'Enter') openDrawer(el.dataset.id); }; });
}
function openDrawer(id) {
  const c = current().find(x => x.id === id); if (!c) return;
  const items = schedule(c.x, asOf);
  const extra = [...c.x.payments.map(p => ({ type: 'Payment · ' + p.rule, date: '', event: true, confidence: p.confidence, needsReview: p.needsReview, why: 'Recurring or triggered by an event (invoice, delivery). No single calendar date is stated, so none is invented.', source: p.source })),
    ...c.x.other.map(p => ({ type: 'Termination for convenience · ' + p.rule, date: '', event: true, confidence: p.confidence, needsReview: p.needsReview, why: 'A right, not a deadline.', source: p.source }))];
  const srcLinks = s => !s ? '' : `<div class="loc"><span>${esc(s.location)}</span>${c.url ? `<a class="edgar" href="${esc(c.url)}" target="_blank" rel="noopener">EDGAR filing</a><a href="/source/?id=${esc(c.id)}&from=${s.lineStart}&to=${s.lineEnd}#L${s.lineStart}" target="_blank" rel="noopener">Saved text, ${esc(s.location)}</a>` : ''}</div>`;
  $('#dbody').innerHTML = `<div class="lab">${esc(c.kind || 'Uploaded document')}${c.exhibit ? ' · ' + esc(c.exhibit) : ''}</div><h3>${esc(c.name)}</h3>
   <p class="why" style="color:#6B6B6B;font-size:13px">${esc(c.title || c.fileName || '')}${c.filer ? ` · filed by ${esc(c.filer)}` : ''}${c.filed ? ` on ${esc(fmt(c.filed))}` : ''}${c.counterparty ? ` · counterparty ${esc(c.counterparty)}` : ''}</p>
   ${c.url ? `<p style="font-size:13px"><a class="edgar" href="${esc(c.url)}" target="_blank" rel="noopener">Open the filing on SEC EDGAR</a></p>` : ''}
   ${c.x.reviewNotes.map(n => `<p class="rv" style="font-size:11px">${esc(n)}</p>`).join('')}
   ${[...items, ...extra].map(i => `<div class="it"><div class="top"><span class="lab">${esc(i.type)}</span>${i.needsReview ? '<span class="rv">Needs review</span>' : ''}</div>
     <div class="v">${i.date ? esc(fmt(i.date)) + (i.date ? ` <span style="font-size:13px;color:#6B6B6B;font-family:var(--sans)">${(d => d < 0 ? -d + ' days ago' : 'in ' + d + ' days')(daysBetween(asOf, i.date))}</span>` : '') : (i.event ? '<span style="font-size:14px;font-family:var(--sans)">Event-driven</span>' : '<span style="font-size:14px;font-family:var(--sans)">Blank: needs review</span>')}</div>
     <p class="why">${esc(i.why)} Confidence: ${esc(i.confidence)}.</p>
     ${i.source ? `<blockquote class="clause">${esc(i.source.quote)}</blockquote>${srcLinks(i.source)}` : '<p class="why">No source clause found.</p>'}</div>`).join('')}`;
  $('#drawer').classList.add('on'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('on'); $('#drawer').scrollTop = 0;
}
const closeDrawer = () => { $('#drawer').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').classList.remove('on'); };
$('#close').onclick = closeDrawer; $('#scrim').onclick = closeDrawer; document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
$('#asof').onchange = e => { if (e.target.value) { asOf = e.target.value; render(); } };
$('#setEdgar').onclick = () => { set = 'edgar'; render(); };
$('#setMine').onclick = () => { set = 'mine'; render(); };
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
const tag = () => (set === 'edgar' ? 'sec-edgar' : 'my-docs') + '-asof-' + asOf;
$('#exCsv').onclick = () => download(`contract-cliffs-${tag()}.csv`, toCSV(current(), asOf), 'text/csv');
$('#exIcs').onclick = () => download(`contract-cliffs-${tag()}.ics`, toICS(current(), asOf, new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'), 'text/calendar');
$('#exPack').onclick = () => download(`diligence-packet-${tag()}.html`, toPacket(current(), asOf), 'text/html');

let n = 0;
function addDoc(name, lines) {
  const id = 'u' + (++n); const base = name.replace(/\.[a-z0-9]+$/i, '');
  mine.push({ id, name: base.slice(0, 60), fileName: name, counterparty: base, kind: 'Uploaded', lines, x: extract(lines) });
  set = 'mine'; render(); openDrawer(id);
}
async function readFile(f) {
  const ext = f.name.toLowerCase().split('.').pop();
  if (ext === 'txt') return (await f.text()).split(/\r?\n/);
  if (ext === 'docx') {
    const zip = await window.JSZip.loadAsync(await f.arrayBuffer());
    const xml = await zip.file('word/document.xml').async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return [...doc.getElementsByTagName('w:p')].map(p => [...p.getElementsByTagName('w:t')].map(t => t.textContent).join(''));
  }
  if (ext === 'pdf') {
    const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
    const pdf = await lib.getDocument({ data: await f.arrayBuffer() }).promise; const out = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent(); const rows = new Map();
      for (const it of tc.items) { const y = Math.round(it.transform[5]); const k = [...rows.keys()].find(k => Math.abs(k - y) <= 2) ?? y; rows.set(k, (rows.get(k) || []).concat([[it.transform[4], it.str]])); }
      [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, its]) => out.push({ text: its.sort((a, b) => a[0] - b[0]).map(x => x[1]).join(' ').replace(/\s+/g, ' ').trim(), page: p }));
    }
    return out;
  }
  throw new Error('Unsupported file type: ' + f.name);
}
$('#file').onchange = async e => { for (const f of e.target.files) { try { $('#status').textContent = 'Reading ' + f.name + '…'; addDoc(f.name, await readFile(f)); } catch (err) { $('#status').textContent = 'Could not read ' + f.name + ': ' + err.message; } } e.target.value = ''; };
$('#addPaste').onclick = () => { const t = $('#paste').value.trim(); if (!t) { $('#status').textContent = 'Paste some contract text first.'; return; } addDoc('Pasted text ' + (n + 1), t.split(/\r?\n/)); $('#paste').value = ''; };
loadEdgar().catch(err => { $('#status').textContent = 'Could not load the SEC set: ' + err.message; });
