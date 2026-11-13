/* In-memory stand-in for the few Supabase endpoints api/age-verify.js uses (auth user + PostgREST). */
const http = require('http');
function match(row, q) { for (const [k, v] of q) { if (['select', 'order', 'limit'].includes(k)) continue; const [op, ...r] = v.split('.'), val = r.join('.'), cur = row[k];
  if (op === 'eq' && String(cur) !== val) return false; if (op === 'gte' && !(Date.parse(cur) >= Date.parse(val))) return false; if (op === 'lt' && !(Date.parse(cur) < Date.parse(val))) return false; } return true; }
module.exports = function start(db) {
  const srv = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const json = (st, o) => { res.statusCode = st; res.setHeader('content-type', 'application/json'); res.end(o == null ? '' : JSON.stringify(o)); };
    if (u.pathname === '/auth/v1/user') return (req.headers.authorization || '') === 'Bearer tok1' ? json(200, { id: 'u1' }) : json(401, {});
    const tbl = u.pathname.replace('/rest/v1/', ''), rows = db[tbl]; if (!rows) return json(404, {}); const hit = rows.filter(r => match(r, u.searchParams));
    if (req.method === 'GET') return json(200, JSON.parse(JSON.stringify(hit)));
    if (req.method === 'POST') { rows.push(Object.assign({ step: 0, status: 'open', evidence: [], created_at: new Date().toISOString() }, JSON.parse(body))); return json(201); }
    if (req.method === 'PATCH') { hit.forEach(r => Object.assign(r, JSON.parse(body))); return json(200, req.headers.prefer === 'return=representation' ? hit : null); }
    if (req.method === 'DELETE') { db[tbl] = rows.filter(r => !hit.includes(r)); return json(204); } }); });
  return new Promise(r => srv.listen(0, () => r(srv)));
};
