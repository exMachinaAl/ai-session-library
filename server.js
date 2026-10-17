'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { timingSafeEqual } = require('node:crypto');
const { ChatAudit, ChatAuditError, PLATFORMS } = require('./src/chat-audit');
const { askOpenAI } = require('./src/openai-client');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = process.env.API_TOKEN || '';
const storage = new ChatAudit({ dataDir: process.env.DATA_DIR || path.join(__dirname, 'data') });
const ASSETS = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'application/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
const processing = new Set();

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(body));
}
function authorized(req) {
  if (!TOKEN) return true;
  const v = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(v);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function readJson(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new ChatAuditError('Gunakan Content-Type: application/json', 415);
  let size = 0;
  const buf = [];
  for await (const chunk of req) { size += chunk.length; if (size > 300000) throw new ChatAuditError('Request terlalu besar', 413); buf.push(chunk); }
  try { const v = JSON.parse(Buffer.concat(buf).toString('utf8')); if (!v || Array.isArray(v) || typeof v !== 'object') throw 0; return v; }
  catch { throw new ChatAuditError('Body JSON object tidak valid'); }
}
function serveFile(res, pathName) {
  const [name, type] = ASSETS[pathName];
  const data = fs.readFileSync(path.join(__dirname, 'public', name));
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
  res.end(data);
}
function sameOrigin(req) {
  // Browsers of other websites cannot mutate a local instance with crafted requests.
  const origin = req.headers.origin;
  if (!origin) return true; // CLI / backend callers
  try { return new URL(origin).host === req.headers.host && new URL(origin).protocol === 'http:'; }
  catch { return false; }
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    if (req.method === 'GET' && Object.hasOwn(ASSETS, pathname)) return serveFile(res, pathname);
    if (!pathname.startsWith('/api/')) return json(res, 404, { error: 'Halaman tidak ditemukan.' });
    if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true });
    if (!authorized(req)) return json(res, 401, { error: 'Token API salah / belum diisi.' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameOrigin(req)) return json(res, 403, { error: 'Origin tidak diizinkan.' });
    if (req.method === 'GET' && pathname === '/api/stats') return json(res, 200, storage.statistics());
    if (req.method === 'GET' && pathname === '/api/platforms') return json(res, 200, Object.fromEntries(Object.entries(PLATFORMS).map(([key, v]) => [key, { url: v.url, prefix: v.prefix }])));
    if (req.method === 'GET' && pathname === '/api/audit/verify') return json(res, 200, storage.verifyIntegrity());
    if (pathname === '/api/sessions') {
      if (req.method === 'GET') return json(res, 200, storage.listSessions(Object.fromEntries(url.searchParams)));
      if (req.method === 'POST') return json(res, 201, storage.createSession(await readJson(req)));
    }
    const byCode = pathname.match(/^\/api\/sessions\/by-code\/([^/]+)$/);
    if (byCode && req.method === 'GET') return json(res, 200, storage.getSession(decodeURIComponent(byCode[1])));
    const r = pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(messages|audit|status|export|link|context|prompt|ask))?$/);
    if (r) {
      const code = decodeURIComponent(r[1]);
      const suffix = r[2];
      if (!suffix && req.method === 'GET') return json(res, 200, storage.getSession(code));
      if (!suffix && req.method === 'PATCH') return json(res, 200, storage.renameSession(code, await readJson(req)));
      if (suffix === 'context' && req.method === 'PATCH') return json(res, 200, storage.setContext(code, await readJson(req)));
      if (suffix === 'link' && req.method === 'PATCH') return json(res, 200, storage.setLink(code, await readJson(req)));
      if (suffix === 'status' && req.method === 'PATCH') return json(res, 200, storage.setStatus(code, await readJson(req)));
      if (suffix === 'messages' && req.method === 'POST') return json(res, 201, storage.addMessage(code, await readJson(req)));
      if (suffix === 'audit' && req.method === 'GET') return json(res, 200, storage.listAudit(code));
      if (suffix === 'prompt' && req.method === 'GET') return json(res, 200, { code: storage.getSession(code).code, mode: url.searchParams.get('mode') || 'start', prompt: storage.prompt(code, url.searchParams.get('mode') || 'start') });
      if (suffix === 'export' && req.method === 'GET') return json(res, 200, storage.exportSession(code), { 'Content-Disposition': `attachment; filename="${storage.getSession(code).code}.json"` });
      if (suffix === 'ask' && req.method === 'POST') {
        const content = (await readJson(req)).content;
        if (typeof content !== 'string' || !content.trim() || content.length > 10000) throw new ChatAuditError('Pertanyaan harus berupa teks maksimal 10000 karakter.');
        const s = storage.getSession(code);
        if (s.status !== 'active') throw new ChatAuditError('Sesi diarsipkan.', 409);
        if (processing.has(s.code)) throw new ChatAuditError('Sesi sedang menunggu balasan API lain.', 409);
        if (!process.env.OPENAI_API_KEY) throw new ChatAuditError('OPENAI_API_KEY belum diatur.', 503);
        processing.add(s.code);
        try {
          const answer = await askOpenAI(s, content.trim());
          // Commit both messages only after receiving a valid provider reply.
          storage.addMessage(s.code, { role: 'user', content: content.trim(), actor: 'api-user' });
          storage.addMessage(s.code, { role: 'assistant', content: answer.answer, actor: `openai-api:${answer.model}` });
          return json(res, 200, { code: s.code, ...answer });
        } finally { processing.delete(s.code); }
      }
    }
    return json(res, 404, { error: 'Endpoint tidak ditemukan.' });
  } catch (e) {
    const status = e instanceof ChatAuditError ? e.status : 500;
    if (status >= 500) console.error(e);
    json(res, status, { error: status >= 500 && !(e instanceof ChatAuditError) ? 'Kesalahan internal server.' : e.message });
  }
});
if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`AI Chat Session Registry v2 → http://${HOST}:${PORT}`);
    console.log(`Penyimpanan: ${storage.eventFile}`);
    if (!TOKEN) console.log('PERINGATAN: API_TOKEN kosong. Hanya untuk penggunaan lokal.');
    if (process.env.OPENAI_API_KEY) console.log('OpenAI API mode: aktif (biaya API berlaku).');
  });
}
module.exports = { server, storage };
