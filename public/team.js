// Team setup and per-contract context. Pure helpers; app.js wires them to the page.
// Stored only with opt-in consent, the same strict rule as "Remember my contracts".
export const TEAM_KEY = 'cc-team', TEAM_OK = 'cc-team-ok';
export const TZS = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'Europe/London', 'UTC'];
export const PLANS = ['renew', 'cancel', 'renegotiate'];
export const blankTeam = () => ({ company: '', signer: { name: '', title: '', email: '' }, warnDays: 30, calName: 'Contract notice deadlines', tz: 'America/New_York', pins: [], ctx: {} });
const str = (v, n = 200) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '';
const okTz = tz => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
export const okEmail = e => /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[A-Za-z]{2,}$/.test(e);
// Clean anything (form values or a stored blob) into a valid setup. Never throws.
export function normTeam(o) {
  const t = blankTeam(); if (!o || typeof o !== 'object') return t;
  t.company = str(o.company);
  const s = o.signer && typeof o.signer === 'object' ? o.signer : {};
  t.signer = { name: str(s.name), title: str(s.title), email: okEmail(str(s.email)) ? str(s.email) : '' };
  const w = Math.round(Number(o.warnDays)); t.warnDays = Number.isFinite(w) && w >= 1 && w <= 365 ? w : 30;
  t.calName = str(o.calName, 80) || t.calName;
  t.tz = typeof o.tz === 'string' && okTz(o.tz) ? o.tz : t.tz;
  t.pins = Array.isArray(o.pins) ? [...new Set(o.pins.filter(p => typeof p === 'string' && p).map(p => p.slice(0, 300)))].slice(0, 500) : [];
  if (o.ctx && typeof o.ctx === 'object') for (const [k, v] of Object.entries(o.ctx).slice(0, 1000)) {
    if (!v || typeof v !== 'object') continue; const c = { note: str(v.note, 2000), owner: str(v.owner, 120), plan: PLANS.includes(v.plan) ? v.plan : '' };
    if (c.note || c.owner || c.plan) t.ctx[k.slice(0, 300)] = c;
  }
  return t;
}
export function parseTeam(raw) { if (raw == null || raw === '') return { team: null, error: '' }; try { return { team: normTeam(JSON.parse(raw)), error: '' }; } catch { return { team: null, error: 'corrupt' }; } }
// A contract's key stays the same across visits: SEC id, then file name, then its id.
export const ckey = c => c?.secId ? 'sec:' + c.secId : c?.fileName ? 'file:' + c.fileName : String(c?.id || c?.name || '');
export const isPinned = (team, c) => !!team?.pins?.includes(ckey(c));
export const togglePin = (team, c) => { const k = ckey(c); team.pins = team.pins.includes(k) ? team.pins.filter(p => p !== k) : [...team.pins, k]; return team.pins.includes(k); };
// Pinned contracts move to the top; everything else keeps its order.
export function pinFirst(rows, team, keyOf) { if (!team?.pins?.length) return rows; const p = r => team.pins.includes(keyOf(r)) ? 0 : 1; return rows.map((r, i) => [r, i]).sort((a, b) => p(a[0]) - p(b[0]) || a[1] - b[1]).map(x => x[0]); }
// Reminder days before a deadline: the team's warning, then two weeks and one week (the default 30 gives 30, 14 and 7).
export const alarmDays = w => [...new Set([w, 14, 7].filter(n => n <= w))].sort((a, b) => b - a);
// "From" and signature lines for the letter. Missing pieces stay as named placeholders.
export function signerLines(team) {
  const s = team?.signer || {}; const co = team?.company || '';
  const who = [s.name || '[YOUR NAME, FILL IN]', s.title || '[YOUR TITLE, FILL IN]', co || '[YOUR COMPANY, FILL IN]'].join(', ');
  return { from: `${who}, [YOUR ADDRESS, FILL IN]${s.email ? ` (${s.email})` : ''}`, sign: who + (s.email ? `\n${s.email}` : ''), any: !!(s.name || s.title || co) };
}
// Per-contract context: owner, plan and a note.
export const ctxOf = (team, c) => team?.ctx?.[ckey(c)] || { note: '', owner: '', plan: '' };
export function setCtx(team, c, patch) { const k = ckey(c); const v = normTeam({ ctx: { [k]: { ...ctxOf(team, c), ...patch } } }).ctx[k]; if (v) team.ctx[k] = v; else delete team.ctx[k]; return v || null; }
export const ctxLine = x => [x?.owner && `Owner: ${x.owner}.`, x?.plan && `Plan: ${x.plan}.`, x?.note && `Note: ${x.note}`].filter(Boolean).join(' ');
// The plan changes the action: cancel or renegotiate puts the notice letter first; renew is a plain reminder.
export const planAction = plan => plan === 'renew' ? { letter: false, letterFirst: false, text: 'Plan: renew. No notice to send; this is a reminder of the date.' } : plan === 'cancel' || plan === 'renegotiate' ? { letter: true, letterFirst: true, text: `Plan: ${plan}. Draft the notice first.` } : { letter: true, letterFirst: false, text: '' };

// ---------- Plugging in: folders, Drive links, Sheets, email ----------
export const OK_EXT = ['pdf', 'docx', 'txt', 'htm', 'html'];
// Keep the files we can read; skip hidden files and other types, and say how many were skipped.
export function splitFiles(files) { const ok = [], skipped = []; for (const f of files) { const n = String(f.name || ''); (n.startsWith('.') || !OK_EXT.includes(n.toLowerCase().split('.').pop()) ? skipped : ok).push(f); } return { ok, skipped }; }
export const DRIVE_BLOCKED = 'Drive blocks this from the browser; download the PDF and drop it here.';
export const isDrive = u => /^https:\/\/(drive|docs)\.google\.com\//i.test(String(u || '').trim());
export function driveId(u) { const s = String(u || ''); const m = s.match(/\/(?:file|document)\/d\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/); return m ? m[1] : ''; }
export const driveDownload = id => `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
// Tab-separated text for Google Sheets: one row per contract, no tabs or line breaks inside a cell,
// and a leading = + - @ is made plain text so Sheets never runs it as a formula.
export const tsvCell = v => { const s = String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim(); return /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? "'" + s : s; };
export const SHEET_HEAD = ['Contract', 'Action', 'Date', 'Days left', 'Needs review', 'Owner', 'Plan', 'Note', 'Source'];
export const sheetsTSV = items => [SHEET_HEAD, ...items.map(i => [i.name, i.action, i.date, i.days, i.review ? 'yes' : 'no', i.owner, i.plan, i.note, i.source])].map(r => r.map(tsvCell).join('\t')).join('\n') + '\n';
// mailto drafts break past about 2,000 characters in some mail apps, so the body is cut with a note.
export const MAILTO_MAX = 1800;
export function mailtoList(items, { to = '', asOf = '' } = {}) {
  const subject = `Contract notice deadlines as of ${asOf}`;
  const lines = items.map(i => `${i.date || 'No date'}: ${i.name}. ${i.action}${i.plan ? ` (plan: ${i.plan})` : ''}${i.owner ? `, owner ${i.owner}` : ''}`);
  const url = body => `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const head = `${items.length} contract${items.length === 1 ? '' : 's'}, soonest first:\n\n`;
  let k = lines.length; const tail = n => n < lines.length ? `\n\n${lines.length - n} more not shown: the list is too long for an email link. Use Export CSV for all of them.` : '';
  while (k > 0 && url(head + lines.slice(0, k).join('\n') + tail(k)).length > MAILTO_MAX) k--;
  return { url: url(head + lines.slice(0, k).join('\n') + tail(k)), shown: k, total: lines.length };
}
