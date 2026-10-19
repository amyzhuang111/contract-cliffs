import { extract, schedule, buildQueue, toCSV, toICS, toPacket, daysBetween, mkDate, nextFixed, shortReason, WINDOWS, PRIORITY_RULE } from '/extract.js';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = new Date(); const pad = n => String(n).padStart(2, '0');
const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
const params = new URLSearchParams(location.search);
const validDay = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return !!(m && +m[1] >= 1900 && +m[1] <= 2200 && mkDate(+m[1], +m[2], +m[3])); };
let asOf = todayStr, asOfNote = '';
if (params.has('asof')) { if (validDay(params.get('asof'))) asOf = params.get('asof'); else asOfNote = `Invalid as-of date "${params.get('asof').slice(0, 20)}", using today (${todayStr}).`; }
$('#asof').value = asOf;
let edgar = [], mine = [], set = 'edgar', groupBy = ['counterparty', 'filer'].includes(params.get('group')) ? params.get('group') : 'none';
let holdout = [];
const current = () => set === 'edgar' ? edgar : set === 'holdout' ? holdout : mine;
document.getElementById('rule').textContent = PRIORITY_RULE;
const fmt = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${+dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y}`; };
const STOP = /^(the|inc\.?|llc|corp\.?|corporation|company|co\.?|ltd\.?|limited|holdings|of|and|\(.*)$/i;
const initials0 = name => (name || '?').replace(/\(.*?\)/g, ' ').replace(/[(),.]/g, ' ').split(/\s+/).filter(w => w && !STOP.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

// Short grey reason shown after a NEEDS REVIEW label.
const reason = shortReason;
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
  $('#setEdgar').setAttribute('aria-pressed', set === 'edgar'); $('#setMine').setAttribute('aria-pressed', set === 'mine'); $('#setHoldout').setAttribute('aria-pressed', set === 'holdout');
  const rows = buildQueue(cs, asOf);
  // one source of truth for the counts shown in the status line and the stats strip
  const dated = rows.filter(r => r.actBy).length, review = rows.filter(r => r.needsReview).length, lapsedN = rows.filter(r => r.section === 'lapsed').length, missedN = rows.filter(r => r.section === 'missed').length;
  $('#status').textContent = (asOfNote ? asOfNote + ' ' : '') + (cs.length ? `${cs.length} contracts · ${dated} with a computed date · ${review} need review${missedN ? ` · ${missedN} missed deadline${missedN > 1 ? 's' : ''}` : ''}` : 'No documents yet. Upload or paste a contract.');
  const next = rows.filter(r => r.actBy && r.days >= 0).sort((a, b) => a.days - b.days)[0];
  const revNames = rows.filter(r => r.needsReview).map(r => `<button class="lnk" data-open="${esc(r.id)}">${esc(r.name)}</button>`).join(', ');
  $('#stats').innerHTML = [['Contracts', cs.length], ['With an Act by date', dated], ['Need review', review], ['Missed deadline', missedN], ['Expired', lapsedN], ['Next Act by', next ? fmt(next.actBy) : 'None']].map(([k, v]) => `<div><span class="lab">${k}</span><span class="sv${k === 'Next Act by' ? ' nx' : ''}">${esc(v)}</span></div>`).join('') + (review ? `<p class="revlist"><span class="lab">Need review</span> ${revNames}</p>` : '');
  document.querySelectorAll('#stats [data-open]').forEach(a => a.onclick = () => openDrawer(a.dataset.open));
  const top = rows[0];
  $('#example').innerHTML = !top ? '' : top.missed ? `<span class="lab">Example from the list</span> <b>${esc(top.name)}</b>: the deadline to send notice passed on ${esc(fmt(top.missed.actBy))}, so it renews automatically on <b>${esc(fmt(top.missed.renews))}</b>. Next chance to cancel: send notice by ${esc(fmt(top.actBy))}.` : top.actBy && top.section === 'upcoming' ? `<span class="lab">Example from the list</span> <b>${esc(top.name)}</b>: send notice by <b>${esc(fmt(top.actBy))}</b>, or it renews on its own.` : '';
  $('#setnote').innerHTML = set === 'edgar' ? '10 real public contracts filed with the SEC (EDGAR). Exhibit 10 agreements: supply, licence, data licence, cloud and managed services. Each card links to the filing it came from.' : set === 'holdout' ? 'Test set: 10 more SEC contracts the rules had never seen when they were scored. Scored first pass: 3 right, 6 correctly left blank for review, 1 missed, 0 wrong act-by dates (see HOLDOUT.md). Shown here with the current rules.' : 'Your documents. Processed only in this browser tab; nothing is uploaded.';
  const li = r => { const past = r.section === 'lapsed';
    return `<li data-id="${esc(r.id)}" role="button" class="${past ? 'past' : ''}${r.section === 'missed' ? ' missed' : ''}${r.days != null && r.days >= 0 && r.days <= 90 ? ' soon' : ''}" tabindex="0">
    <span class="d">${r.missed ? `<span class="rn">Renews</span> ${esc(fmt(r.missed.renews))}` : r.actBy ? esc(fmt(r.actBy)) : '<span class="nd">No date found</span>'}</span>
    <span class="n">${r.days == null ? '' : r.missed ? `in ${daysBetween(asOf, r.missed.renews)} days` : past ? `<span class="lapsed">Expired</span> · ${-r.days} days ago` : r.days === 0 ? 'today' : `in ${r.days} days`}</span>
    <span class="c"><b>${esc(r.name)}</b><div class="why-here"><span class="wl">Why it’s here</span> ${esc(r.why)}</div></span>
    <span class="s">${r.needsReview ? rv(r.item?.why) + '<br>' : ''}${esc(r.confidence)} confidence</span></li>`; };
  // optional grouping by party: counterparty or filer (the public company)
  ['none', 'counterparty', 'filer'].forEach(g => $('#g-' + g).setAttribute('aria-pressed', groupBy === g));
  const head = r => r.section === 'missed' ? 'Missed · deadline passed, not yet renewed' : r.section === 'due' ? 'Due now · today or within 7 days' : r.section === 'resolve' ? 'Resolve first · needs review, no date' : 'Upcoming · ' + WINDOWS[r.window][2];
  const lapsedRows = rows.filter(r => r.section === 'lapsed');
  const lapsedBlock = rs => rs.length ? `<li class="lgrp" role="presentation"><details><summary><span class="lab">Expired (${rs.length})</span> <span class="gn">expired, nothing left to decide</span></summary><ul class="q">${rs.map(li).join('')}</ul></details></li>` : '';
  if (groupBy === 'none') { let last = ''; $('#queue').innerHTML = rows.filter(r => r.section !== 'lapsed').map(r => { const h = head(r); const out = (h !== last ? `<li class="sh" role="presentation"><span class="lab">${esc(h)}</span></li>` : '') + li(r); last = h; return out; }).join('') + lapsedBlock(lapsedRows); }
  else { const key = r => (cs.find(c => c.id === r.id)?.[groupBy] || 'Not stated'); const groups = new Map(); rows.forEach(r => groups.set(key(r), [...(groups.get(key(r)) || []), r]));
    $('#queue').innerHTML = [...groups.entries()].map(([k, rs]) => [k, rs, rows.indexOf(rs[0])]).sort((a, b) => a[2] - b[2]).map(([k, rs]) => [k, rs]).map(([k, rs]) => `<li class="grp" role="presentation"><span class="lab">${groupBy === 'filer' ? 'Party (filer)' : 'Counterparty'}</span> <b>${esc(k)}</b> <span class="gn">${rs.length} ${rs.length === 1 ? 'agreement' : 'agreements'}${rs.some(r => r.actBy && r.days >= 0) ? ' · next act-by ' + esc(fmt(rs.filter(r => r.actBy && r.days >= 0).sort((a, b) => a.days - b.days)[0].actBy)) : ''}</span></li>` + rs.map(li).join('')).join(''); }
  $('#cards').innerHTML = cs.map(c => { const r = rows.find(x => x.id === c.id);
    return `<button class="card" data-id="${esc(c.id)}"><div class="tile" aria-hidden="true">${esc(initials(c.name, c.counterparty))}</div>
    <div class="t">${esc(c.name)}</div><div class="m">${esc(c.kind || 'Uploaded')}${c.exhibit ? ' · ' + esc(c.exhibit) : ''}${c.filed ? ' · filed ' + esc(fmt(c.filed)) : ''}</div>
    <div class="a">${r?.actBy ? `${r.days < 0 ? '<span class="lapsed">Expired</span> · ' : ''}${esc(r.label)} ${esc(fmt(r.actBy))}` : `<span class="nd">No date found</span>`}</div>${r?.needsReview ? `<div class="a">${rv(r.item?.why)}</div>` : ''}</button>`; }).join('');
  document.querySelectorAll('[data-id]:not(.grp)').forEach(el => { el.onclick = () => openDrawer(el.dataset.id); el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(el.dataset.id); } }; });
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
   <p class="why" style="color:var(--mute);font-size:13px">${esc(c.title || c.fileName || '')}${c.filer ? ` · filed by ${esc(c.filer)}` : ''}${c.filed ? ` on ${esc(fmt(c.filed))}` : ''}${c.counterparty ? ` · counterparty ${esc(c.counterparty)}` : ''}</p>
   ${c.url ? `<p style="font-size:13px"><a class="edgar" href="${esc(c.url)}" target="_blank" rel="noopener">Open the filing on SEC EDGAR ↗</a></p>` : ''}
   ${c.x.reviewNotes.map(n => `<p class="note">${esc(n)}</p>`).join('')}
   ${[...items, ...extra].map(i => `<div class="it"><div class="top"><span class="lab">${esc(i.type)}</span>${i.status === 'past' ? '<span class="lapsed">Passed</span>' : ''}</div>${i.needsReview ? `<div class="rvline">${rv(i.why)}</div>` : ''}
     <div class="v">${i.date ? esc(fmt(i.date)) + (i.date ? ` <span style="font-size:13px;color:var(--mute);font-family:var(--sans)">${(d => d < 0 ? -d + ' days ago' : 'in ' + d + ' days')(daysBetween(asOf, i.date))}</span>` : '') : (i.event ? '<span style="font-size:14px;font-family:var(--sans)">Event-driven</span>' : '<span class="nd" style="font-size:14px;font-family:var(--sans)">No date found</span>')}</div>
     <p class="why">${esc(i.why)}${i.who ? ` Who acts: ${esc(i.who)}.` : ''} Confidence: ${esc(i.confidence)}.</p>
     ${i.via ? `<p class="why">Referenced from the renewal clause (${esc(i.via.location)}): “${esc(i.via.quote.slice(0, 220))}${i.via.quote.length > 220 ? '…' : ''}”</p>` : ''}${i.source ? `<blockquote class="clause">${esc(i.source.quote)}</blockquote>${srcLinks(i.source)}` : '<p class="why">No source clause found.</p>'}</div>`).join('')}`;
  $('#drawer').classList.add('on'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('on'); $('#drawer').scrollTop = 0; $('#close').focus({ preventScroll: true });
}
const closeDrawer = () => { if (!$('#drawer').classList.contains('on')) return; $('#drawer').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').classList.remove('on'); if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true }); };
// focus trap inside the open drawer
$('#drawer').addEventListener('keydown', e => { if (e.key !== 'Tab') return; const f = [...$('#drawer').querySelectorAll('a[href],button')]; if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } });
$('#close').onclick = closeDrawer; $('#scrim').onclick = closeDrawer; document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
$('#asof').onchange = e => { if (validDay(e.target.value)) { asOf = e.target.value; asOfNote = ''; render(); } else { asOfNote = `As-of cleared or invalid; still using ${asOf}.`; e.target.value = asOf; render(); } };
['none', 'counterparty', 'filer'].forEach(g => { $('#g-' + g).onclick = () => { groupBy = g; render(); }; });
$('#setEdgar').onclick = () => { set = 'edgar'; render(); };
$('#setMine').onclick = () => { set = 'mine'; render(); };
$('#setHoldout').onclick = async () => { if (!holdout.length) { $('#status').textContent = 'Loading the test set…'; const d = await (await fetch('/data/holdout.json')).json(); holdout = d.map(c => ({ ...c, source: 'edgar', x: extract(c.lines) })); } set = 'holdout'; render(); };
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
new MutationObserver(() => $('#status').classList.toggle('err', /^(Invalid|Could not|Nothing to export|As-of cleared)/.test($('#status').textContent))).observe($('#status'), { childList: true, characterData: true, subtree: true });
loadEdgar().catch(err => { $('#status').textContent = 'Could not load the SEC set: ' + err.message; });
