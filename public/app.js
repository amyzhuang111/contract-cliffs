import { extract, schedule, buildQueue, toCSV, toICS, toPacket, daysBetween, mkDate, nextFixed } from '/extract.js';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = new Date(); const pad = n => String(n).padStart(2, '0');
const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
const params = new URLSearchParams(location.search);
const validDay = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return !!(m && +m[1] >= 1900 && +m[1] <= 2200 && mkDate(+m[1], +m[2], +m[3])); };
let asOf = todayStr, asOfNote = '';
if (params.has('asof')) { if (validDay(params.get('asof'))) asOf = params.get('asof'); else asOfNote = `Invalid as-of date "${params.get('asof').slice(0, 20)}", using today (${todayStr}).`; }
$('#asof').value = asOf;
let edgar = [], mine = [], set = 'edgar';
const current = () => set === 'edgar' ? edgar : mine;
const fmt = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${+dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y}`; };
const STOP = /^(the|inc\.?|llc|corp\.?|corporation|company|co\.?|ltd\.?|limited|holdings|of|and|\(.*)$/i;
const initials0 = name => (name || '?').replace(/\(.*?\)/g, ' ').replace(/[(),.]/g, ' ').split(/\s+/).filter(w => w && !STOP.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

// Short grey reason shown after a NEEDS REVIEW label.
const reason = (why = '') => /redact/i.test(why) ? 'redacted in the public filing' : /No term clause/i.test(why) ? 'no term found' : /event \(e\.g/i.test(why) ? 'term runs from an event' : /first Renewal Term/i.test(why) ? 'ambiguous drafting' : /inclusive of the final day/i.test(why) ? 'could land one day later' : /without saying before what/i.test(why) ? 'notice reference point not stated' : /Effective Date that needs review|no Effective Date/i.test(why) ? 'effective date not defined' : /disagree/i.test(why) ? 'words and numerals disagree' : /no non-renewal notice|No notice period/i.test(why) ? 'no notice period found' : /not cross-checked/i.test(why) ? 'stated date, term not found' : /not tied/i.test(why) ? 'term start unclear' : (why.split('.')[0] || 'confirm against the clause').slice(0, 60).toLowerCase();
const rv = why => `<span class="rv">Needs review</span><span class="rvw"> · ${esc(reason(why))}</span>`;
// "Cerus / Purolite" -> "CP"; otherwise first letters of the counterparty name
const initials = (name, fallback) => /\s\/\s/.test(name || '') ? name.split(/\s\/\s/).slice(0, 2).map(p => initials0(p)[0] || '').join('') : initials0(fallback || name);
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
  $('#status').textContent = (asOfNote ? asOfNote + ' ' : '') + (cs.length ? `${cs.length} contracts · ${dated} with a computed date · ${rows.length - dated} need review` : 'No documents yet. Upload or paste a contract.');
  const next = rows.find(r => r.actBy && r.days >= 0);
  $('#stats').innerHTML = [['Contracts', cs.length], ['With an act-by date', dated], ['Need review', rows.filter(r => r.needsReview).length], ['Lapsed', rows.filter(r => r.days != null && r.days < 0).length], ['Next act-by', next ? fmt(next.actBy) : 'None']].map(([k, v]) => `<div><span class="lab">${k}</span><span class="sv">${esc(v)}</span></div>`).join('');
  $('#setnote').innerHTML = set === 'edgar' ? 'Real public contracts (SEC EDGAR). Ten Exhibit 10 agreements: supply, licence, data licence, cloud and managed services. Each card links to the filing it came from.' : 'Your documents. Processed only in this browser tab; nothing is uploaded.';
  $('#queue').innerHTML = rows.map(r => { const past = r.days != null && r.days < 0;
    return `<li data-id="${esc(r.id)}" role="button" class="${past ? 'past' : ''}${r.days != null && r.days >= 0 && r.days <= 90 ? ' soon' : ''}" tabindex="0">
    <span class="d">${r.actBy ? esc(fmt(r.actBy)) : '<span class="nd">No date found</span>'}</span>
    <span class="n">${r.days == null ? '' : past ? `<span class="lapsed">Lapsed</span> · ${-r.days} days ago` : r.days === 0 ? 'today' : `in ${r.days} days`}</span>
    <span class="c"><b>${esc(r.name)}</b><div>${r.actBy ? esc(past ? r.label.replace(' by', ' was due') : r.label) : 'No act-by date computed'}</div></span>
    <span class="s">${r.needsReview ? rv(r.item?.why) + '<br>' : ''}${esc(r.confidence)} confidence</span></li>`; }).join('');
  $('#cards').innerHTML = cs.map(c => { const r = rows.find(x => x.id === c.id);
    return `<button class="card" data-id="${esc(c.id)}"><div class="tile" aria-hidden="true">${esc(initials(c.name, c.counterparty))}</div>
    <div class="t">${esc(c.name)}</div><div class="m">${esc(c.kind || 'Uploaded')}${c.exhibit ? ' · ' + esc(c.exhibit) : ''}${c.filed ? ' · filed ' + esc(fmt(c.filed)) : ''}</div>
    <div class="a">${r?.actBy ? `${r.days < 0 ? '<span class="lapsed">Lapsed</span> · ' : ''}${esc(r.label)} ${esc(fmt(r.actBy))}` : `<span class="nd">No date found</span>`}</div>${r?.needsReview ? `<div class="a">${rv(r.item?.why)}</div>` : ''}</button>`; }).join('');
  document.querySelectorAll('[data-id]').forEach(el => { el.onclick = () => openDrawer(el.dataset.id); el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(el.dataset.id); } }; });
}
let lastFocus = null;
function openDrawer(id) {
  const c = current().find(x => x.id === id); if (!c) return;
  if (!$('#drawer').classList.contains('on')) lastFocus = document.activeElement;
  const items = schedule(c.x, asOf);
  const extra = [...c.x.payments.map(p => ({ type: 'Payment · ' + p.rule, date: nextFixed(p.rule, asOf), event: true, confidence: p.confidence, needsReview: p.needsReview, why: (p.trigger && p.trigger !== 'event' && p.trigger !== 'recurring' ? `Clock starts at: ${p.trigger}. ` : '') + 'Recurring or triggered by an event (invoice, delivery). No single calendar date is stated, so none is invented.', source: p.source })),
    ...c.x.other.map(p => ({ type: 'Termination for convenience · ' + p.rule + (p.who ? ' · ' + p.who : ''), date: '', event: true, confidence: p.confidence, needsReview: p.needsReview, why: p.why || 'A right, not a deadline.', source: p.source }))];
  const srcLinks = s => !s ? '' : `<div class="loc"><span>${esc(s.location)}</span>${c.url ? `<a class="edgar" href="${esc(c.url)}" target="_blank" rel="noopener">EDGAR filing ↗</a><a href="/source/?id=${esc(c.id)}&from=${s.lineStart}&to=${s.lineEnd}#L${s.lineStart}" target="_blank" rel="noopener">Saved text, ${esc(s.location)}</a>` : ''}</div>`;
  $('#dbody').innerHTML = `<div class="lab">${esc(c.kind || 'Uploaded document')}${c.exhibit ? ' · ' + esc(c.exhibit) : ''}</div><h3>${esc(c.name)}</h3>
   <p class="why" style="color:#6B6B6B;font-size:13px">${esc(c.title || c.fileName || '')}${c.filer ? ` · filed by ${esc(c.filer)}` : ''}${c.filed ? ` on ${esc(fmt(c.filed))}` : ''}${c.counterparty ? ` · counterparty ${esc(c.counterparty)}` : ''}</p>
   ${c.url ? `<p style="font-size:13px"><a class="edgar" href="${esc(c.url)}" target="_blank" rel="noopener">Open the filing on SEC EDGAR ↗</a></p>` : ''}
   ${c.x.reviewNotes.map(n => `<p class="note">${esc(n)}</p>`).join('')}
   ${[...items, ...extra].map(i => `<div class="it"><div class="top"><span class="lab">${esc(i.type)}</span>${i.status === 'past' ? '<span class="lapsed">Lapsed</span>' : ''}</div>${i.needsReview ? `<div class="rvline">${rv(i.why)}</div>` : ''}
     <div class="v">${i.date ? esc(fmt(i.date)) + (i.date ? ` <span style="font-size:13px;color:#6B6B6B;font-family:var(--sans)">${(d => d < 0 ? -d + ' days ago' : 'in ' + d + ' days')(daysBetween(asOf, i.date))}</span>` : '') : (i.event ? '<span style="font-size:14px;font-family:var(--sans)">Event-driven</span>' : '<span class="nd" style="font-size:14px;font-family:var(--sans)">No date found</span>')}</div>
     <p class="why">${esc(i.why)}${i.who ? ` Who acts: ${esc(i.who)}.` : ''} Confidence: ${esc(i.confidence)}.</p>
     ${i.source ? `<blockquote class="clause">${esc(i.source.quote)}</blockquote>${srcLinks(i.source)}` : '<p class="why">No source clause found.</p>'}</div>`).join('')}`;
  $('#drawer').classList.add('on'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('on'); $('#drawer').scrollTop = 0; $('#close').focus({ preventScroll: true });
}
const closeDrawer = () => { if (!$('#drawer').classList.contains('on')) return; $('#drawer').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').classList.remove('on'); if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true }); };
// focus trap inside the open drawer
$('#drawer').addEventListener('keydown', e => { if (e.key !== 'Tab') return; const f = [...$('#drawer').querySelectorAll('a[href],button')]; if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } });
$('#close').onclick = closeDrawer; $('#scrim').onclick = closeDrawer; document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
$('#asof').onchange = e => { if (validDay(e.target.value)) { asOf = e.target.value; asOfNote = ''; render(); } else { asOfNote = `As-of cleared or invalid; still using ${asOf}.`; e.target.value = asOf; render(); } };
$('#setEdgar').onclick = () => { set = 'edgar'; render(); };
$('#setMine').onclick = () => { set = 'mine'; render(); };
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
const tag = () => (set === 'edgar' ? 'sec-edgar' : 'my-docs') + '-asof-' + asOf;
const guard = f => () => { if (!current().length) { $('#status').textContent = 'Nothing to export yet: add a document or switch to the SEC set.'; return; } f(); };
$('#exCsv').onclick = guard(() => download(`contract-cliffs-${tag()}.csv`, toCSV(current(), asOf), 'text/csv'));
$('#exIcs').onclick = guard(() => download(`contract-cliffs-${tag()}.ics`, toICS(current(), asOf, new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'), 'text/calendar'));
$('#exPack').onclick = guard(() => download(`diligence-packet-${tag()}.html`, toPacket(current(), asOf), 'text/html'));

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
    return [...doc.getElementsByTagName('w:p')].map(p => ({ para: true, text: [...p.getElementsByTagName('w:t')].map(t => t.textContent).join('') }));
  }
  if (ext === 'pdf') {
    const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
    const pdf = await lib.getDocument({ data: await f.arrayBuffer() }).promise; const out = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent(); const rows = new Map();
      for (const it of tc.items) { const y = Math.round(it.transform[5]); const k = [...rows.keys()].find(k => Math.abs(k - y) <= 2) ?? y; rows.set(k, (rows.get(k) || []).concat([[it.transform[4], it.str]])); }
      let k = 0; [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, its]) => { const text = its.sort((a, b) => a[0] - b[0]).map(x => x[1]).join(' ').replace(/\s+/g, ' ').trim(); if (text) out.push({ text, page: p, pline: ++k }); });
    }
    return out;
  }
  throw new Error('Unsupported file type: ' + f.name);
}
$('#file').onchange = async e => { for (const f of e.target.files) { try { $('#status').textContent = 'Reading ' + f.name + '…'; addDoc(f.name, await readFile(f)); } catch (err) { $('#status').textContent = 'Could not read ' + f.name + ': ' + err.message; } } e.target.value = ''; };
document.querySelectorAll('[data-sample]').forEach(b => b.onclick = async () => { const name = b.dataset.sample.split('/').pop(); try { $('#status').textContent = 'Reading ' + name + '…'; const blob = await (await fetch(b.dataset.sample)).blob(); addDoc(name, await readFile(new File([blob], name))); } catch (err) { $('#status').textContent = 'Could not read ' + name + ': ' + err.message; } });
$('#addPaste').onclick = () => { const t = $('#paste').value.trim(); if (!t) { $('#status').textContent = 'Paste some contract text first.'; return; } addDoc('Pasted text ' + (n + 1), t.split(/\r?\n/)); $('#paste').value = ''; };
loadEdgar().catch(err => { $('#status').textContent = 'Could not load the SEC set: ' + err.message; });
