// Fetches a public SEC EDGAR document for the browser (sec.gov blocks cross-origin reads and asks for a declared User-Agent).
// Only https://sec.gov / https://www.sec.gov URLs are allowed; nothing is stored or logged.
export const UA = 'Contract Cliffs (Amy Zhuang) amyzhuang111@gmail.com';
export const MAX = 15 * 1024 * 1024;
export function checkUrl(raw) {
  let u; try { u = new URL(String(raw || '')); } catch { return { error: 'Not a valid URL.' }; }
  if (u.protocol !== 'https:' || !/^(www\.)?sec\.gov$/i.test(u.hostname) || u.username || u.password || (u.port && u.port !== '443')) return { error: 'Only https://www.sec.gov links are allowed.' };
  return { url: u.toString() };
}
export default async function handler(req, res) {
  const q = new URL(req.url, 'http://x').searchParams.get('url');
  const c = checkUrl(q);
  if (c.error) { res.statusCode = 400; res.setHeader('content-type', 'text/plain; charset=utf-8'); return res.end(c.error); }
  try {
    const r = await fetch(c.url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,text/plain,*/*' }, redirect: 'follow' });
    if (!checkUrl(r.url).url) { res.statusCode = 400; return res.end('Redirected away from sec.gov.'); }
    if (!r.ok) { res.statusCode = 502; res.setHeader('content-type', 'text/plain; charset=utf-8'); return res.end(`sec.gov answered ${r.status}.`); }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX) { res.statusCode = 413; return res.end('Document is larger than 15 MB.'); }
    res.statusCode = 200;
    res.setHeader('content-type', r.headers.get('content-type') || 'text/html');
    res.setHeader('cache-control', 'public, max-age=86400');
    res.setHeader('x-source-url', c.url);
    res.end(buf);
  } catch (e) { res.statusCode = 502; res.setHeader('content-type', 'text/plain; charset=utf-8'); res.end('Could not reach sec.gov.'); }
}
