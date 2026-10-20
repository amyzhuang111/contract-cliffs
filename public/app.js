import { checkLine, htmlToLines, partiesFromPreamble, definedRoles, ymd, addDays, dayWord, extract, schedule, buildQueue, toCSV, toICS, toPacket, daysBetween, mkDate, nextFixed, shortReason, WINDOWS, PRIORITY_RULE } from '/extract.js';
import { withAlarms, gcalLink, letter, docx, obligations, portfolio, auditCSV, parseSaved, STORE_KEY } from '/features.js';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = new Date(); const pad = n => String(n).padStart(2, '0');
const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
const params = new URLSearchParams(location.search);
const validDay = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return !!(m && +m[1] >= 1900 && +m[1] <= 2200 && mkDate(+m[1], +m[2], +m[3])); };
let asOf = todayStr, asOfNote = '';
if (params.has('asof')) { if (validDay(params.get('asof'))) asOf = params.get('asof'); else asOfNote = `Invalid as-of date "${params.get('asof').slice(0, 20)}", using today (${todayStr}).`; }
$('#asof').value = asOf;
let edgar = [], mine = [], set = params.get('set') === 'sec' ? 'edgar' : params.get('set') === 'test' ? 'holdout' : 'mine', groupBy = ['counterparty', 'filer'].includes(params.get('group')) ? params.get('group') : 'none';
let holdout = [];
const current = () => set === 'edgar' ? edgar : set === 'holdout' ? holdout : mine;
document.getElementById('rule').textContent = PRIORITY_RULE;
// How it works: open on desktop, collapsed on phones so the list comes first
const fmt = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${+dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y}`; };
const STOP = /^(the|inc\.?|llc|corp\.?|corporation|company|co\.?|ltd\.?|limited|holdings|of|and|\(.*)$/i;
const initials0 = name => (name || '?').replace(/\(.*?\)/g, ' ').replace(/[(),.]/g, ' ').split(/\s+/).filter(w => w && !STOP.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

// Short grey reason shown after a NEEDS REVIEW label.
const reason = shortReason;
// Plain confidence words instead of high/medium/low/none
const sure = c => c === 'high' ? 'Sure' : c === 'none' ? 'Can’t tell' : 'Check this';
const TYPE = t => t;
const rv = tag => `<span class="rv">Needs review</span><span class="rvw"> · ${esc(tag)}</span>`;
// "Cerus / Purolite" -> "CP"; otherwise first letters of the counterparty name
const initials = (name, fallback) => /\s\/\s/.test(name || '') ? name.split(/\s\/\s/).slice(0, 2).map(p => initials0(p)[0] || '').join('') : initials0(fallback || name);
let edgarRaw = null;
const edgarData = async () => edgarRaw || (edgarRaw = await (await fetch('/data/edgar.json')).json());
async function loadEdgar() {
  if (!edgar.length) { $('#status').textContent = 'Loading the 10 SEC contracts…'; edgar = (await edgarData()).map(c => ({ ...c, source: 'edgar', x: extract(c.lines) })); }
  render();
}
function render() {
  const cs = current();
  const own = set === 'mine';
  document.body.classList.toggle('legacy', !own); document.body.classList.toggle('has-many', cs.length >= 2); document.body.classList.toggle('has-one', cs.length === 1); document.body.classList.toggle('has-any', cs.length > 0);
  $('#queueSec').hidden = own || cs.length < 2; $('#ch').closest('section').hidden = own || cs.length < 2;
  $('#answer').hidden = !own || !cs.length; $('#prompt').hidden = !own || !cs.length || cs.length > 2; if (own) promptLabel(cs.length); if (!own) $('#about').open = true; $('#liveQ').hidden = !own || cs.length < 2;
  if (own) live(cs); else $('#answer').innerHTML = '';
  if (remember()) save();
  $('#setEdgar').setAttribute('aria-pressed', set === 'edgar'); $('#setMine').setAttribute('aria-pressed', set === 'mine'); $('#setHoldout').setAttribute('aria-pressed', set === 'holdout');
  const rows = buildQueue(cs, asOf);
  // one source of truth for the counts shown in the status line and the stats strip
  const dated = rows.filter(r => r.actBy).length, review = rows.filter(r => r.needsReview).length, lapsedN = rows.filter(r => r.section === 'lapsed').length, missedN = rows.filter(r => r.section === 'missed').length;
  $('#status').textContent = (asOfNote ? asOfNote + ' ' : '') + (cs.length ? `${cs.length} contracts · ${dated} with a computed date · ${review} need review${missedN ? ` · ${missedN} missed deadline${missedN > 1 ? 's' : ''}` : ''}` : 'No contracts yet. Drop a file, paste text, or try a real SEC contract.');
  const next = rows.filter(r => r.actBy && r.days >= 0).sort((a, b) => a.days - b.days)[0];
  const revNames = rows.filter(r => r.needsReview).map(r => `<button class="lnk" data-open="${esc(r.id)}">${esc(r.name)}</button>`).join(', ');
  $('#stats').innerHTML = [['Contracts', cs.length], ['With a deadline', dated], ['Need review', review], ['Missed deadline', missedN], ['Expired', lapsedN], ['Next deadline', next ? fmt(next.actBy) : 'None']].map(([k, v]) => `<div><span class="lab">${k}</span><span class="sv${k === 'Next deadline' ? ' nx' : ''}">${esc(v)}</span></div>`).join('') + (review ? `<p class="revlist"><span class="lab">Need review</span> ${revNames}</p>` : '');
  document.querySelectorAll('#stats [data-open]').forEach(a => a.onclick = () => openDrawer(a.dataset.open));
  const top = rows[0];
  const ex = rows.find(r => r.id === 'c5' && r.actBy && r.days >= 0) || rows.find(r => r.section === 'due' || r.section === 'upcoming');
  const exRp = ex && cs.find(c => c.id === ex.id)?.x.renewal?.period;
  $('#example').innerHTML = !ex ? '' : `<span class="lab">Example from the list</span> <b>${esc(ex.name)}</b>: send notice by <b>${esc(fmt(ex.actBy))}</b>, or the licence renews automatically${exRp ? ` for another ${exRp.n} ${exRp.unit}${exRp.n > 1 ? 's' : ''}` : ''}.`;
  $('#setnote').innerHTML = set === 'edgar' ? '10 real public contracts filed with the SEC: supply, licence, data licence, cloud and managed services. Each card links to the filing it came from.' : set === 'holdout' ? 'Test set: 10 SEC contracts kept out of tuning. It can still get a date wrong. When it can’t tell, it says so and flags the row for a person to check.' : 'Your documents. Processed only in this browser tab; nothing is uploaded.';
  const li = r => { const past = r.section === 'lapsed';
    return `<li data-id="${esc(r.id)}" role="button" class="${past ? 'past' : ''}${r.section === 'missed' ? ' missed' : ''}${r.days != null && r.days >= 0 && r.days <= 90 ? ' soon' : ''}" tabindex="0">
    <span class="d">${r.missed ? `<span class="rn">Renews</span> ${esc(fmt(r.missed.renews))}` : r.actBy ? esc(fmt(r.actBy)) : '<span class="nd">No date found</span>'}</span>
    <span class="n">${r.days == null ? '' : r.missed ? `in ${dayWord(daysBetween(asOf, r.missed.renews))}` : past ? `<span class="lapsed">Expired</span> · ${dayWord(-r.days)} ago` : r.days === 0 ? 'today' : `in ${dayWord(r.days)}`}</span>
    <span class="c"><b>${esc(r.name)}</b><div class="why-here"><span class="wl">Why it’s here</span> ${esc(r.why)}</div>${r.safe ? `<div class="safe">${esc(r.safe.note)}</div>` : ''}</span>
    <span class="s">${r.needsReview ? rv(r.tag) + '<br>' : ''}${esc(sure(r.confidence))}</span></li>`; };
  // optional grouping by party: counterparty or filer (the public company)
  ['none', 'counterparty', 'filer'].forEach(g => $('#g-' + g).setAttribute('aria-pressed', groupBy === g));
  const head = r => r.section === 'missed' ? 'Missed · deadline passed, not yet renewed' : r.section === 'due' ? 'Due within 30 days' : r.section === 'resolve' ? 'Resolve first · needs review, no date' : 'Later · ' + WINDOWS[r.window][2];
  const lapsedRows = rows.filter(r => r.section === 'lapsed');
  const lapsedBlock = rs => rs.length ? `<li class="lgrp" role="presentation"><details><summary><span class="lab">Expired (${rs.length})</span> <span class="gn">expired, nothing left to decide</span></summary><ul class="q">${rs.map(li).join('')}</ul></details></li>` : '';
  if (groupBy === 'none') { let last = ''; $('#queue').innerHTML = rows.filter(r => r.section !== 'lapsed').map(r => { const h = head(r); const out = (h !== last ? `<li class="sh" role="presentation"><span class="lab">${esc(h)}</span></li>` : '') + li(r); last = h; return out; }).join('') + lapsedBlock(lapsedRows); }
  else { const key = r => (cs.find(c => c.id === r.id)?.[groupBy] || 'Not stated'); const groups = new Map(); rows.forEach(r => groups.set(key(r), [...(groups.get(key(r)) || []), r]));
    $('#queue').innerHTML = [...groups.entries()].map(([k, rs]) => [k, rs, rows.indexOf(rs[0])]).sort((a, b) => a[2] - b[2]).map(([k, rs]) => [k, rs]).map(([k, rs]) => `<li class="grp" role="presentation"><span class="lab">${groupBy === 'filer' ? 'Company that filed it' : 'Other company'}</span> <b>${esc(k)}</b> <span class="gn">${rs.length} ${rs.length === 1 ? 'agreement' : 'agreements'}${rs.some(r => r.actBy && r.days >= 0) ? ' · next deadline ' + esc(fmt(rs.filter(r => r.actBy && r.days >= 0).sort((a, b) => a.days - b.days)[0].actBy)) : ''}</span></li>` + rs.map(li).join('')).join(''); }
  $('#cards').innerHTML = cs.map(c => { const r = rows.find(x => x.id === c.id);
    return `<button class="card" data-id="${esc(c.id)}"><div class="tile" aria-hidden="true">${esc(initials(c.name, c.counterparty))}</div>
    <div class="t">${esc(c.name)}</div><div class="m">${esc(c.kind || 'Uploaded')}${c.filed ? ' · filed ' + esc(fmt(c.filed)) : ''}</div>
    <div class="a">${r?.actBy ? (r.missed ? `Renews ${esc(fmt(r.missed.renews))} · send-notice deadline missed${r.safe ? `</div><div class="a safe">Next deadline: ${esc(r.safe.note)}` : ''}` : `${r.days < 0 ? '<span class="lapsed">Expired</span> · ' : ''}${esc(r.label)} ${esc(fmt(r.actBy))}${r.safe ? `</div><div class="a safe">${esc(r.safe.note)}` : ''}`) : `<span class="nd">No date found</span>`}</div>${r?.needsReview ? `<div class="a">${rv(r.tag)}</div>` : ''}</button>`; }).join('');
  document.querySelectorAll('[data-id]:not(.grp):not(.lrow):not(.acard)').forEach(el => { el.onclick = () => openDrawer(el.dataset.id); el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(el.dataset.id); } }; });
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
   <p class="why" style="color:var(--mute);font-size:13px">${esc(c.title || c.fileName || '')}${c.filer ? ` · filed by ${esc(c.filer)}` : ''}${c.filed ? ` on ${esc(fmt(c.filed))}` : ''}${c.counterparty && c.counterparty !== c.fileName?.replace(/\.[a-z0-9]+$/i, '') ? ` · other company ${esc(c.counterparty)}` : ''}</p>
   ${c.url ? `<p style="font-size:13px"><a class="edgar" href="${esc(c.url)}" target="_blank" rel="noopener">Open the filing on SEC EDGAR ↗</a></p>` : ''}
   ${c.x.reviewNotes.map(n => `<p class="note">${esc(n)}</p>`).join('')}
   ${[...items, ...extra].map(i => `<div class="it"><div class="top"><span class="lab">${esc(TYPE(i.type))}</span>${i.status === 'past' ? '<span class="lapsed">Passed</span>' : ''}</div>${i.needsReview ? `<div class="rvline">${rv(reason(i.why))}</div>` : ''}
     <div class="v">${i.date ? esc(fmt(i.date)) + (i.date ? ` <span style="font-size:13px;color:var(--mute);font-family:var(--sans)">${(d => d < 0 ? dayWord(-d) + ' ago' : 'in ' + dayWord(d))(daysBetween(asOf, i.date))}</span>` : '') : (i.event ? '<span style="font-size:14px;font-family:var(--sans)">Event-driven</span>' : '<span class="nd" style="font-size:14px;font-family:var(--sans)">No date found</span>')}</div>
     <p class="why">${esc(i.why)}${i.who ? ` Who acts: ${esc(i.who)}.` : ''} ${esc(sure(i.confidence))}.</p>
     ${i.via ? `<p class="why">Referenced from the renewal clause (${esc(i.via.location)}): “${esc(i.via.quote.slice(0, 220))}${i.via.quote.length > 220 ? '…' : ''}”</p>` : ''}${i.source ? `<blockquote class="clause">${esc(i.source.quote)}</blockquote>${srcLinks(i.source)}` : '<p class="why">No source clause found.</p>'}</div>`).join('')}<div class="lettr"><button class="btn-secondary sm" id="drawerLetter">Draft notice letter</button></div>${obligationsHtml(c)}`;
  $('#drawerLetter').onclick = () => openLetter(id);
  $('#drawer').classList.add('on'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('on'); $('#drawer').scrollTop = 0; $('#close').focus({ preventScroll: true });
}
function obligationsHtml(c) {
  const ob = obligations(c);
  const q = i => i.quote ? `<blockquote class="clause">${esc(showQuote(i.quote))}</blockquote><div class="loc"><span>${esc(i.location)}</span>${c.url ? `<a class="edgar" href="${esc(c.url)}" target="_blank" rel="noopener">EDGAR filing ↗</a>${i.lineStart ? `<a href="/source/?id=${esc(c.id)}&from=${i.lineStart}&to=${i.lineEnd || i.lineStart}#L${i.lineStart}" target="_blank" rel="noopener">Saved text, ${esc(i.location)}</a>` : ''}` : ''}</div>` : '';
  return `<section class="obl" aria-label="More obligations"><h4 class="lab">More obligations</h4>${ob.map(o => `<div class="it ob-${o.key}"><div class="top"><span class="lab">${esc(o.label)}</span></div>${!o.found ? '<p class="why nd">Not found in this document.</p>' : o.items ? o.items.map(i => `${i.summary ? `<p class="why">${esc(i.summary)}</p>` : ''}${q(i)}`).join('') : `<p class="why">${esc(o.summary)}</p>${q(o)}${o.extra.map(a => `<p class="why">${esc(a.label)}:</p>${q(a)}`).join('')}`}</div>`).join('')}</section>`;
}
// F2: draft non-renewal letter, shown in the drawer with .docx download and Copy
function openLetter(id) {
  const c = current().find(x => x.id === id); if (!c) return;
  const r = buildQueue([c], asOf)[0]; const t = letter(c, r, asOf);
  if (!$('#drawer').classList.contains('on')) lastFocus = document.activeElement;
  $('#dbody').innerHTML = `<div class="lab">Draft letter · ${esc(c.name)}</div><h3>Non-renewal notice (draft)</h3><p class="note">DRAFT. Check every line against the contract before sending. Anything marked [NOT FOUND, FILL IN] was not in the document.</p><div class="row lbtns"><button class="btn-primary sm" id="letterDocx">Download .docx</button><button class="btn-secondary sm" id="letterCopy">Copy</button></div><pre class="letter" id="letterText">${esc(t)}</pre>`;
  $('#letterDocx').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([docx(t)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })); a.download = `DRAFT-non-renewal-${c.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}.docx`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };
  $('#letterCopy').onclick = e => { (navigator.clipboard?.writeText(t) || Promise.reject()).then(() => { e.target.textContent = 'Copied'; }, () => { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed: select the text'; } ta.remove(); }); };
  $('#drawer').classList.add('on'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('on'); $('#drawer').scrollTop = 0; $('#close').focus({ preventScroll: true });
}
const closeDrawer = () => { if (!$('#drawer').classList.contains('on')) return; $('#drawer').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').classList.remove('on'); if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true }); };
// focus trap inside the open drawer
$('#drawer').addEventListener('keydown', e => { if (e.key !== 'Tab') return; const f = [...$('#drawer').querySelectorAll('a[href],button')]; if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } });
$('#close').onclick = closeDrawer; $('#scrim').onclick = closeDrawer; document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
$('#asof').onchange = e => { if (validDay(e.target.value)) { asOf = e.target.value; asOfNote = ''; render(); } else { asOfNote = `As-of cleared or invalid; still using ${asOf}.`; e.target.value = asOf; render(); } };
['none', 'counterparty', 'filer'].forEach(g => { $('#g-' + g).onclick = () => { groupBy = g; render(); }; });
$('#setEdgar').onclick = () => { set = 'edgar'; loadEdgar().catch(err => { $('#status').textContent = 'Could not load the SEC set: ' + err.message; }); };
$('#setMine').onclick = () => { set = 'mine'; render(); };
$('#setHoldout').onclick = async () => { if (!holdout.length) { $('#status').textContent = 'Loading the test set…'; const d = await (await fetch('/data/holdout.json')).json(); holdout = d.map(c => ({ ...c, source: 'edgar', x: extract(c.lines) })); } set = 'holdout'; render(); };
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
const tag = () => (set === 'edgar' ? 'sec-edgar' : 'my-docs') + '-asof-' + asOf;
const guard = f => () => { if (!current().length) { $('#status').textContent = 'Nothing to export yet: add a contract first.'; return; } f(); };
$('#exCsv').onclick = guard(() => download(`contract-cliffs-${tag()}.csv`, toCSV(current(), asOf), 'text/csv'));
$('#exIcs').onclick = guard(() => download(`contract-cliffs-${tag()}.ics`, withAlarms(toICS(current(), asOf, new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z')), 'text/calendar'));
$('#lqIcs').onclick = () => $('#exIcs').onclick(); $('#lqCsv').onclick = () => $('#exCsv').onclick();
$('#exAudit').onclick = guard(() => download(`audit-pack-${tag()}.csv`, auditCSV(current(), asOf), 'text/csv')); $('#lqAudit').onclick = () => $('#exAudit').onclick();
$('#exPack').onclick = guard(() => download(`audit-pack-${tag()}.html`, toPacket(current(), asOf), 'text/html'));

let n = 0;
const MAX_CHARS = 1500000;
// A document with no dates and no contract language is not added: say so plainly.
const looksLikeContract = (x, text) => !!(x.effective || x.term || x.renewal || x.notice) || /\b(agreement|contract)\b[\s\S]{0,4000}\b(term|terminat|renew|notice|effective)/i.test(text);
async function addDoc(name, lines, meta = {}) {
  await stage(2, name);
  let text = lines.map(l => typeof l === 'string' ? l : l.text).join('\n'); let note = '';
  if (text.length > MAX_CHARS) { let c = 0, k = 0; while (k < lines.length && c < MAX_CHARS) c += (typeof lines[k] === 'string' ? lines[k] : lines[k].text).length + 1, k++; lines = lines.slice(0, k); note = ` Large file: only the first ${MAX_CHARS.toLocaleString('en-US')} characters were read.`; text = text.slice(0, MAX_CHARS); }
  const x = extract(lines);
  if (!looksLikeContract(x, text)) { const m = `Could not find a contract in ${name}: no term, renewal, notice or effective-date language. Nothing was added.`; dzError('This doesn’t look like a contract: no term, renewal or notice language found.'); $('#status').textContent = m; return null; }
  await stage(3, name);
  const id = 'u' + (++n); const base = name.replace(/\.[a-z0-9]+$/i, '');
  const parties = meta.name ? '' : partiesFromPreamble(lines);
  mine.push({ id, name: (meta.name || parties || (definedRoles(lines) ? `${definedRoles(lines)} (${name})` : `Unnamed contract (${name})`)).slice(0, 60), fileName: name, counterparty: meta.counterparty || (parties ? parties.split(' / ')[1] || '' : ''), filer: meta.filer || '', kind: meta.kind || 'Your contract', url: meta.url || '', title: meta.title || '', exhibit: meta.exhibit || '', filed: meta.filed || '', secId: meta.secId || '', lines, x });
  newIds.add(id); setTimeout(() => { newIds.delete(id); document.querySelector(`#lq li[data-id="${id}"]`)?.classList.remove('new'); }, 4000);
  set = 'mine'; busyDone(); render();
  if (mine.length === 1) requestAnimationFrame(() => { const h = document.querySelector('#answer .hero-date'); if (h && h.getBoundingClientRect().bottom > innerHeight - 8) $('#answer').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); });
  const c = mine.length; $('#status').textContent = (c === 1 ? `Read ${name}.` : `Added ${name}: ${c} contracts, most urgent first.`) + note;
  return id;
}
// ---------- own contracts: answer card + live queue (design pass) ----------
const newIds = new Set(); let expanded = null; let shownExpired = false;
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WDAY = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const weekday = d => WDAY[new Date(d + 'T00:00:00Z').getUTCDay()];
// Display-only clean-up of a quoted clause. The stored quote (used for copy and the audit pack) is untouched.
export const showQuote = q => String(q || '').replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').replace(/“\s+/g, '“').replace(/\s+”/g, '”').replace(/\b([A-Z]) (?=[A-Z]{2,}\b)/g, '$1').trim();
const mark = (html, phrases) => phrases.filter(Boolean).reduce((h, p) => { const e = esc(showQuote(p)); return e && h.includes(e) ? h.replace(e, `<mark>${e}</mark>`) : h; }, html);
const order = rows => { // 1 passed but renewing, 2 dated soonest first, 3 no date, 4 expired; ties by name
  const rank = r => r.missed ? 0 : r.section === 'lapsed' ? 3 : r.actBy ? 1 : 2;
  return rows.slice().sort((a, b) => rank(a) - rank(b) || (a.actBy && b.actBy && rank(a) === 1 ? a.actBy.localeCompare(b.actBy) : 0) || a.name.localeCompare(b.name));
};
function chip(r) {
  if (r.missed) { const ago = daysBetween(r.missed.actBy, asOf); return `<span class="chip passed">Passed ${dayWord(ago)} ago</span>`; }
  if (r.section === 'lapsed' || r.days == null) return '';
  if (r.days < 0) return `<span class="chip passed">Passed ${dayWord(-r.days)} ago</span>`;
  const cls = r.days <= 30 ? 'u30' : r.days <= 90 ? 'u90' : 'u365';
  return `<span class="chip ${cls}">${r.days === 0 ? 'Due today' : dayWord(r.days) + ' left'}</span>`;
}
const confWord = c => c === 'high' ? ['Clear', 3] : c === 'medium' ? ['Check one thing', 2] : c === 'low' ? ['Can’t tell', 1] : ['Can’t tell', 0];
// One tag, used on both the card and the row: never Clear for medium.
const confTag = r => r.needsReview || !['high', 'medium'].includes(r.confidence) ? ['Needs review', 'rvtag'] : r.confidence === 'medium' ? ['Check one thing', 'check'] : ['Clear', 'clear'];
// The one thing to check, in one line, from the parser's own reason.
function oneThing(r) {
  const it = r.item || {};
  if (it.renewed > 0 && it.prevActBy && !r.needsReview) return checkLine(it);
  return r.tag ? `Check: ${r.tag}.` : 'Check the quoted clause before relying on this date.';
}
const sendBy = r => { const d = r.safe?.date || r.actBy; return `${weekday(d).slice(0, 3)} ${fmt(d)}`; };
const days = (n, u) => `${n} ${u}${+n === 1 ? '' : 's'}`;
const renewsFor = c => { const p = c.x.renewal?.period; return p ? `${p.n} more ${p.unit}${p.n > 1 ? 's' : ''}` : ''; };
const gcal = (c, r) => { if (!r.actBy || r.section === 'lapsed' || (r.days != null && r.days < 0) || !/send-notice/i.test(r.label || '')) return ''; const u = gcalLink({ name: c.name, actBy: r.actBy, asOf, quote: r.item?.source?.quote, location: r.item?.source?.location, url: c.url }); return u ? `<a class="gcal" href="${esc(u)}" target="_blank" rel="noopener">Add to Google Calendar</a>` : ''; };
function card(c, r) {
  const more = renewsFor(c); const cons = more ? `or it renews for ${more}.` : 'or it renews automatically.';
  const src = r.item?.source; const [cw, seg] = confWord(r.confidence);
  let kicker, hero, sub = '', cls = '';
  if (r.missed) {
    kicker = 'Send-notice date passed'; cls = 'passed';
    hero = `<span class="pchip">Passed</span><span class="strike">${esc(fmt(r.missed.actBy))}</span>`;
    sub = `It renews on ${fmt(r.missed.renews)}${more ? ` for ${more}` : ''}.`;
  } else if (r.section === 'lapsed') { kicker = 'No action needed'; cls = 'expired'; hero = `Expired ${esc(fmt(r.actBy))}`; sub = r.label === 'Send-notice deadline' ? 'The send-notice date has passed; check whether it renewed.' : 'No automatic renewal left.'; }
  else if (r.actBy && /Send-notice/.test(r.label)) { kicker = r.needsReview ? 'Send notice by (best reading)' : 'Send notice by'; hero = esc(fmt(r.actBy)); sub = esc(cons); }
  else if (r.actBy) { kicker = 'Ends on'; hero = esc(fmt(r.actBy)); sub = r.renewHint ? 'No automatic renewal was read, but the document mentions renewal or extension. Check the clause before relying on this date.' : 'No automatic renewal. Plan the replacement before then.'; }
  else if (r.item?.initialOnlyPassed) { const it0 = r.item; kicker = 'Send-notice date passed'; cls = 'passed'; hero = `<span class="pchip">Passed</span><span class="strike">${esc(fmt(it0.prevActBy))}</span>`; sub = esc(`Now renews every ${days(it0.renewEvery.n, it0.renewEvery.unit)}; the contract gives no non-renewal notice for later periods. Check the termination section.`); }
  else { kicker = 'Send notice by'; cls = 'nodate'; hero = 'No date found'; sub = esc(r.tag ? r.tag[0].toUpperCase() + r.tag.slice(1) + '.' : c.x.renewal ? 'An automatic renewal clause was found, but no date could be worked out. Check the clause.' : 'No renewal or term clause found. It may not auto-renew.'); }
  const it = r.item || {};
  const math = it.termEnd && it.notice && r.actBy ? `Term ends ${fmt(it.termEnd)}${it.renewed ? ` (assumes it renewed ${it.renewed === 1 ? 'once' : it.renewed + ' times'} and was never amended)` : ''}. Minus ${days(it.notice.n, it.notice.unit)} = ${fmt(r.actBy)}.` : '';
  const quoteHtml = src?.quote ? mark(esc(showQuote(src.quote)), [c.x.notice?.period?.text, c.x.renewal?.period?.text, (showQuote(src.quote).match(/automatically renew\w*/i) || [])[0]]) : '';
  const meta = [c.kind && c.kind !== 'Your contract' ? esc(c.title || c.kind) : c.fileName ? 'Uploaded · ' + esc(c.fileName) : 'Your contract', esc(c.exhibit || ''), c.filed ? `<span class="d">Filed ${esc(fmt(c.filed))}</span>` : ''].filter(Boolean).join(' · ');
  return `<article class="acard ${cls}" data-id="${esc(c.id)}">
    ${r.needsReview ? `<div class="rvbar">Needs review · ${esc(r.tag || 'check the clause')}</div>` : ''}
    <div class="agrid"><div class="aleft">
      <p class="lab">${esc(kicker)}</p>
      <p class="hero-date${r.needsReview && r.actBy ? ' best' : ''}" id="answerBig">${hero}</p>
      ${r.actBy && !r.missed && cls !== 'expired' ? `<p class="lab wd">${weekday(r.actBy)}</p>` : ''}
      <p class="cons">${sub}</p>
      ${r.missed ? `<p class="next">Next: send notice by ${esc(sendBy(r))} · in ${dayWord(daysBetween(asOf, r.safe?.date || r.actBy))}</p>` : ''}
      <div class="chips">${chip(r)}</div>${r.actBy && !r.missed && r.days >= 0 && cls !== 'expired' ? `<div class="cliff${r.days < 150 ? ' near' : ''}" style="--p:${Math.min(r.days, 365) / 365 * 100}%" aria-hidden="true"><span class="cl-t">Today</span><i></i><span class="cl-d">${esc(fmt(r.actBy))}</span></div>` : ''}
      ${r.safe && !r.missed ? `<p class="safe">${esc(r.safe.note.replace(/ · (\w)/, (m, c) => '. ' + c.toUpperCase()).replace(/ to be safe$/, ' to be safe.'))}</p>` : ''}
      <div class="ident"><p class="iname">${esc(c.name)}</p><p class="lab meta">${meta}</p></div>
    </div><div class="aright">
      <p class="lab">From the contract</p>
      ${c.x.renewalNote ? `<p class="cons rnote">${esc(c.x.renewalNote)}</p>` : ''}${r.item?.initialOnlyPassed ? `<p class="cons rnote">${esc('Renews (no later notice window): ' + r.item.why)}</p>` : ''}${c.x.extension ? `<p class="cons rnote">${esc(c.x.extension.note)}</p>` : ''}
      ${quoteHtml ? `<blockquote class="aq">“${quoteHtml}”</blockquote>` : '<p class="cons">No clause with a date was found.</p>'}
      <p class="prov lab">${src?.location ? `<span>${esc(src.location)}</span><span class="dot">·</span>` : ''}${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">Open on SEC EDGAR ↗</a><span class="dot">·</span>` : ''}${src?.quote ? `<button class="tl copyq" type="button">Copy clause</button>` : ''}</p>
      <p class="conf"><span class="lab">Confidence:</span> ${confTag(r)[1] === 'rvtag' ? `<span class="cw">${esc(cw)}</span>` : `<span class="tag ${confTag(r)[1]}">${esc(confTag(r)[0])}</span>`} <span class="seg" aria-hidden="true">${[1, 2, 3].map(k => `<i class="${k <= seg ? 'on' : ''}"></i>`).join('')}</span></p>
      ${confTag(r)[1] !== 'clear' && r.actBy ? `<p class="one">${esc(oneThing(r))}</p>` : ''}
      ${math ? `<p class="math">${esc(math)}</p>` : ''}
      <div class="acts"><button id="answerMore" class="btn-secondary sm">See every date and clause</button><button id="answerLetter" class="btn-secondary sm">Draft notice letter</button>${gcal(c, r)}</div>
    </div></div></article>`;
}
function row(c, r) {
  const passed = !!r.missed || r.section === 'lapsed';
  const d = r.missed ? r.missed.actBy : r.actBy;
  const cons = r.missed ? `Renews ${fmt(r.missed.renews)}. Next: send notice by ${sendBy(r)}.` : r.section === 'lapsed' ? 'Expired. No action needed.' : r.item?.initialOnlyPassed ? `Send-notice date passed ${fmt(r.item.prevActBy)}. Now renews every ${days(r.item.renewEvery.n, r.item.renewEvery.unit)}; no later non-renewal notice.` : !r.actBy ? (r.tag ? r.tag[0].toUpperCase() + r.tag.slice(1) + '.' : 'No date found.') : /Send-notice/.test(r.label) ? (renewsFor(c) ? `or it renews for ${renewsFor(c)}.` : 'or it renews automatically.') : r.renewHint ? 'Renewal wording found but not read; check it.' : 'No automatic renewal.';
  return `<li class="lrow${newIds.has(c.id) ? ' new' : ''}" data-id="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(c.name)}: show the answer">
    <div class="ld"><span class="rdate${passed ? ' strike' : ''}">${d ? esc(fmt(d)) : 'No date found'}</span><span class="lab">${r.missed || (r.days != null && r.days < 0) ? 'Passed' : r.section === 'lapsed' ? 'Expired' : r.actBy ? 'Send notice by' : 'Needs a person'}${d && !passed ? ' · ' + weekday(d) : ''}</span>${r.safe && !passed ? `<span class="rsafe">Send by ${esc(r.safe.note.replace(/^.*send by /, '').replace(/ to be safe$/, ''))} to be safe</span>` : ''}</div>
    <div class="lc">${chip(r)}</div>
    <div class="ln"><span class="rname">${esc(c.name)}${newIds.has(c.id) ? ' <span class="newtag">New</span>' : ''}</span><span class="rcons">${esc(cons)}</span></div>
    <div class="lt"><span class="tag ${confTag(r)[1]}">${esc(confTag(r)[0])}</span><span class="lab">${esc(r.item?.source?.location || '')}${c.url ? ` · <a href="${esc(c.url)}" target="_blank" rel="noopener">EDGAR ↗</a>` : ''}</span>${gcal(c, r)}</div>
  </li>`;
}
function live(cs) {
  const before = new Map([...document.querySelectorAll('#lq li[data-id]')].map(li => [li.dataset.id, li.getBoundingClientRect().top]));
  const rows = order(buildQueue(cs, asOf)); const byId = new Map(cs.map(c => [c.id, c]));
  if (!rows.length) { $('#answer').innerHTML = ''; $('#lq').innerHTML = ''; return; }
  const top = rows.find(r => r.id === expanded) || rows.find(r => r.id === cs[0].id) || rows[0];
  $('#answer').innerHTML = card(byId.get(top.id), top);
  $('#answerMore').onclick = () => openDrawer(top.id); $('#answerLetter').onclick = () => openLetter(top.id);
  $('#answer .copyq')?.addEventListener('click', e => { navigator.clipboard?.writeText(top.item.source.quote).then(() => { e.target.textContent = 'Copied'; }, () => {}); });
  const rest = rows.filter(r => r !== top); const exp = rest.filter(r => r.section === 'lapsed'), act = rest.filter(r => r.section !== 'lapsed');
  $('#lqh').textContent = (matchMedia('(max-width:480px)').matches ? `Queue · ${cs.length} contracts · 1 open above` : `Queue · ${cs.length} contracts · by send-notice date · 1 open above`);
  const sum = []; const pas = rows.filter(r => r.missed || (r.days != null && r.days < 0 && r.section !== 'lapsed')).length; if (pas) sum.push(`<span class="p">${pas} passed</span>`);
  rows.filter(r => !r.missed && r.section !== 'lapsed' && r.days != null && r.days >= 0 && r.days <= 90).sort((a, b) => a.days - b.days).forEach(r => sum.push(`1 due ${r.days === 0 ? 'today' : 'in ' + dayWord(r.days)}`));
  const later = rows.filter(r => !r.missed && r.section !== 'lapsed' && r.days > 90).length; if (later) sum.push(`${later} later`);
  const nod = rows.filter(r => !r.actBy).length; if (nod) sum.push(`${nod} no date`); const ex = rows.filter(r => r.section === 'lapsed').length; if (ex) sum.push(`${ex} expired`);
  $('#lqSum').innerHTML = sum.join(' · ');
  const pf = portfolio(rows); $('#portfolio').innerHTML = [['Due in 30 days', pf.d30, 'u30'], ['Due in 90 days', pf.d90, 'u90'], ['Due in 365 days', pf.d365, 'u365'], ['Passed', pf.passed, 'p'], ['Needs review', pf.review, 'r']].map(([k, v, c]) => `<div class="pf ${c}"><span class="lab">${k}</span><span class="sv">${v}</span></div>`).join('');
  $('#lq').innerHTML = act.map(r => row(byId.get(r.id), r)).join('');
  $('#lqExpired').innerHTML = exp.length ? `<button class="tl" id="showExp">${exp.length} expired · ${shownExpired ? 'Hide' : 'Show'}</button>${shownExpired ? `<ol class="lq">${exp.map(r => row(byId.get(r.id), r)).join('')}</ol>` : ''}` : '';
  $('#showExp')?.addEventListener('click', () => { shownExpired = !shownExpired; render(); });
  document.querySelectorAll('#liveQ li[data-id]').forEach(li => { const go = e => { if (e.target.closest('a')) return; expanded = li.dataset.id; render(); $('#answer').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }; li.onclick = go; li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } }; });
  // FLIP: rows already on screen slide to their new place; new rows fade up
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('#lq li[data-id]').forEach(li => { const was = before.get(li.dataset.id); const now = li.getBoundingClientRect().top;
    if (was != null && was !== now && !reduce) li.animate([{ transform: `translateY(${was - now}px)` }, { transform: 'none' }], { duration: 600, easing: 'cubic-bezier(.16,1,.3,1)' });
    else if (was == null && newIds.has(li.dataset.id)) li.animate(reduce ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: reduce ? 150 : 600, delay: reduce ? 0 : 80, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }); });
}
// ---------- drop zone states: parsing steps tied to the real stages, errors in plain words ----------
const STEPS = ['Reading 1 of 3: extracting text', '2 of 3: finding term and renewal clauses', '3 of 3: computing the send-notice date'];
const show = id => ['pasteBox', 'busy', 'dzErr'].forEach(k => { $('#' + k).hidden = k !== id; }) || ($('.dz-idle').hidden = !!id);
let bulk = null; // { i, n } while several files are read
async function stage(i, name) { show('busy'); $('#drop').classList.remove('err'); $('#busyName').textContent = (bulk ? `File ${bulk.i} of ${bulk.n} · ` : '') + 'Reading ' + name.replace(/\.[a-z0-9]+$/i, ''); $('#busyStep').textContent = STEPS[i - 1]; const f = bulk ? (bulk.i - 1 + i / 3) / bulk.n : i / 3; $('#busyBar').style.width = Math.round(f * 100) + '%'; $('#busy .bar').setAttribute('aria-valuenow', String(Math.round(f * 100))); await new Promise(r => setTimeout(r, 250)); }
const busyDone = () => { show(null); };
function dzError(msg) { show('dzErr'); $('#drop').classList.add('err'); $('#dzErrHint').textContent = msg; }
const plainErr = m => /no text layer/.test(m) ? 'This PDF is a scanned image. Paste the text instead.' : /unsupported/.test(m) ? 'File type not supported. Use PDF, Word or text.' : 'The file could not be opened. Try another copy, or paste the text instead.';
$('#tryAnother').onclick = e => { e.stopPropagation(); show(null); $('#drop').classList.remove('err'); $('#file').click(); };
const openPaste = () => { show('pasteBox'); $('#paste').focus(); };
$('#pasteLink').onclick = e => { e.stopPropagation(); openPaste(); };
$('#addBar').onclick = e => { e.stopPropagation(); $('#file').click(); };
$('#pasteBtn').onclick = openPaste;
$('#pasteCancel').onclick = e => { e.stopPropagation(); show(null); };
$('#drop').addEventListener('click', e => { if (e.target === $('#drop') || e.target.closest('.dz-idle') && !e.target.closest('button')) $('#file').click(); });
$('#drop').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === $('#drop')) { e.preventDefault(); $('#file').click(); } });
$('#howBtn').onclick = () => { const h = $('#howPop'); h.hidden = !h.hidden; $('#howBtn').setAttribute('aria-expanded', String(!h.hidden)); };
$('#clearAll').onclick = () => { mine = []; expanded = null; newIds.clear(); if (remember()) save(); render(); $('#status').textContent = 'Cleared.'; };
const DEMO = ['c2', 'c3', 'c1', 'c6', 'c12', 'c8', 'c13', 'c4', 'c7'];
const DEMO_NAMES = { c2: 'StableX / Kopin', c3: 'Dragonfly / Keystone RV', c1: 'Cerus / Purolite', c6: 'CFO Portal / Vivos', c12: 'Reborn / Mighty Oak', c8: 'Patheon / Vaxcyte', c13: 'ARK / Eightco', c4: 'Tradeweb Data Schedule', c7: 'Synacor / Qwest' };
function promptLabel(n) { const next = DEMO.find(id => !mine.some(m => m.secId === id)); $('#promptText').textContent = n >= 2 ? 'Add one more to see sorting' : 'Add another contract to build a priority queue'; $('#trySecond').textContent = next ? 'Add ' + DEMO_NAMES[next] : 'Add a real SEC contract'; $('#trySecond').hidden = !next; }
async function addSec(id) { const c = (await edgarData()).find(c => c.id === id); if (mine.some(m => m.secId === id)) return; await stage(1, c.name); await addDoc(c.name, c.lines, { name: c.name, counterparty: c.counterparty, filer: c.filer, kind: c.kind, url: c.url, title: c.title, exhibit: c.exhibit, filed: c.filed, secId: id }); }
$('#trySecond').onclick = async () => { const next = DEMO.find(id => !mine.some(m => m.secId === id)); if (next) await addSec(next); };
const htmLines = t => htmlToLines(t);
async function readFile(f) {
  const ext = f.name.toLowerCase().split('.').pop();
  if (ext === 'txt') return (await f.text()).split(/\r?\n/);
  if (ext === 'htm' || ext === 'html') return htmLines(await f.text());
  if (ext === 'docx') {
    const { value } = await window.mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() });
    return value.split(/\n+/).map(t => t.trim()).filter(Boolean).map(text => ({ para: true, text }));
  }
  if (ext === 'pdf') {
    const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
    const pdf = await lib.getDocument({ data: await f.arrayBuffer() }).promise; const out = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent(); const rows = new Map();
      for (const it of tc.items) { const y = Math.round(it.transform[5]); const k = [...rows.keys()].find(k => Math.abs(k - y) <= 2) ?? y; rows.set(k, (rows.get(k) || []).concat([[it.transform[4], it.str]])); }
      let k = 0; [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, its]) => { const text = its.sort((a, b) => a[0] - b[0]).map(x => x[1]).join(' ').replace(/\s+/g, ' ').trim(); if (text) out.push({ text, page: p, pline: ++k }); });
    }
    if (!out.length) throw new Error('no text layer (a scanned PDF needs OCR first)');
    return out;
  }
  throw new Error('unsupported file type (use PDF, .docx, .txt or .htm)');
}
async function addFiles(files) {
  const many = files.length > 1; let added = 0; const failed = [];
  for (let k = 0; k < files.length; k++) { const f = files[k]; if (many) bulk = { i: k + 1, n: files.length };
    try { $('#status').textContent = (many ? `File ${k + 1} of ${files.length}: ` : '') + 'Reading ' + f.name + '…'; await stage(1, f.name); if (await addDoc(f.name, await readFile(f))) added++; else failed.push(f.name); } catch (err) { failed.push(f.name); dzError(plainErr(err.message)); $('#status').textContent = 'Could not read ' + f.name + ': ' + plainErr(err.message || ''); } }
  bulk = null;
  if (many) { busyDone(); $('#drop').classList.remove('err'); $('#status').textContent = `Read ${files.length} files: ${added} added${failed.length ? `, ${failed.length} not added (${failed.join(', ').slice(0, 160)})` : ''}. ${mine.length} contracts in the queue.`; }
}
$('#file').onchange = async e => { await addFiles([...e.target.files]); e.target.value = ''; };
// The whole page is a drop target.
['dragenter', 'dragover'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); document.body.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || !e.relatedTarget) document.body.classList.remove('dragging'); }));
window.addEventListener('drop', e => { if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]); });
document.querySelectorAll('[data-sample]').forEach(b => b.onclick = async () => { const name = b.dataset.sample.split('/').pop(); try { $('#status').textContent = 'Reading ' + name + '…'; await stage(1, name); const blob = await (await fetch(b.dataset.sample)).blob(); await addDoc(name, await readFile(new File([blob], name))); } catch (err) { dzError(plainErr(err.message)); $('#status').textContent = 'Could not read ' + name + ': ' + plainErr(err.message || ''); } });
$('#addPaste').onclick = async e => { e?.stopPropagation?.(); const t = $('#paste').value.trim(); if (!t) { $('#status').textContent = 'Paste some contract text first.'; return; } const name = 'Pasted text ' + (n + 1); await stage(1, name); if (await addDoc(name, t.split(/\r?\n/))) $('#paste').value = ''; };
// One click: a single real SEC contract (Star Brands / Schwazze licence), read the same way as your files.
$('#tryOne').onclick = async () => {
  try { if (mine.some(m => m.secId === 'c5')) { set = 'mine'; render(); return; } await addSec('c5'); }
  catch (err) { busyDone(); $('#status').textContent = 'Could not load the example. Reload the page and try again.'; }
};
$('#fetchUrl').onclick = async () => {
  const u = $('#url').value.trim(); if (!/^https:\/\/(www\.)?sec\.gov\//i.test(u)) { $('#status').textContent = 'Could not fetch: only https://www.sec.gov links are accepted.'; return; }
  $('#status').textContent = 'Fetching from sec.gov…'; const name = decodeURIComponent(u.split('/').pop() || 'SEC document');
  try { await stage(1, name); const r = await fetch('/api/edgar?url=' + encodeURIComponent(u)); const t = await r.text(); if (!r.ok) throw Object.assign(new Error(String(t || 'sec.gov answered ' + r.status).replace(/<[^>]*>/g, '').slice(0, 160)), { fromServer: true });
    const lines = /<html|<body|<p[\s>]|<div[\s>]/i.test(t) ? htmLines(t) : t.split(/\r?\n/);
    await addDoc(name, lines, { url: u, kind: 'SEC filing' });
  } catch (err) { busyDone(); $('#status').textContent = 'Could not fetch that link: ' + (err.fromServer ? err.message : 'no connection to sec.gov right now. Try again, or download the file and drop it here.'); }
};
// Opt-in local memory (localStorage). Off by default; unticking deletes what was saved.
const remember = () => localStorage.getItem('cc-remember') === '1';
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(mine.map(({ x, ...m }) => m))); } catch { $('#status').textContent = 'Could not save on this device (storage full); your contracts are still on the page.'; } };
$('#remember').checked = remember();
$('#remember').onchange = e => { if (e.target.checked) { localStorage.setItem('cc-remember', '1'); save(); $('#status').textContent = 'Saved on this device. Untick to delete.'; } else { localStorage.removeItem('cc-remember'); localStorage.removeItem(STORE_KEY); $('#status').textContent = 'Deleted from this device.'; } };
let storeNote = '';
try { if (remember()) { const { docs, error } = parseSaved(localStorage.getItem(STORE_KEY)); for (const m of docs) { try { mine.push({ ...m, id: 'u' + (++n), x: extract(m.lines) }); } catch {} }
  if (error === 'corrupt') { localStorage.removeItem(STORE_KEY); storeNote = 'Saved contracts on this device could not be read and were cleared. Add them again.'; } else if (error === 'partial') storeNote = 'Some saved contracts could not be read and were skipped.'; } } catch { storeNote = 'This browser blocks local storage, so nothing is remembered.'; }
$('#resetStore').onclick = () => { try { localStorage.removeItem('cc-remember'); localStorage.removeItem(STORE_KEY); } catch {} $('#remember').checked = false; mine = []; expanded = null; newIds.clear(); set = 'mine'; render(); $('#status').textContent = 'Saved data deleted from this device and the queue was reset.'; };
// Demo mode: straight to the one-click state.
if (params.get('demo') === '1') { document.body.classList.add('demo'); setTimeout(() => $('#tryOne').focus(), 0); if (params.get('auto') !== '0') setTimeout(() => { if (!mine.length) $('#tryOne').click(); }, 350); }
new MutationObserver(() => $('#status').classList.toggle('err', /^(Invalid|Could not|Nothing to export|As-of cleared)/.test($('#status').textContent))).observe($('#status'), { childList: true, characterData: true, subtree: true });
if (set === 'edgar') loadEdgar().catch(err => { $('#status').textContent = 'Could not load the SEC set: ' + err.message; });
else if (set === 'holdout') $('#setHoldout').onclick();
else render();
if (storeNote) $('#status').textContent = storeNote;
if ('serviceWorker' in navigator && location.protocol === 'https:' || location.hostname === 'localhost') navigator.serviceWorker?.register('/sw.js').catch(() => {});
