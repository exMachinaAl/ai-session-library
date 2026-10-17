'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
async function port() { const srv = net.createServer(); await new Promise(r => srv.listen(0, '127.0.0.1', r)); const n = srv.address().port; await new Promise(r => srv.close(r)); return n; }
test('dashboard dan API: token, registrasi, prompt, link, cari, export', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-server-'));
  const p = await port();
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(p), HOST: '127.0.0.1', DATA_DIR: dir, API_TOKEN: 'unit-test', OPENAI_API_KEY: '' }, stdio: 'pipe' });
  t.after(() => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${p}`;
  let ready = false;
  for (let i = 0; i < 90; i++) { try { const r = await fetch(`${base}/api/health`); if (r.ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 30)); }
  assert.ok(ready);
  assert.match(await (await fetch(base)).text(), /AI Session Registry/);
  assert.equal((await fetch(`${base}/api/stats`)).status, 401);
  const headers = { Authorization: 'Bearer unit-test', 'Content-Type': 'application/json' };
  const post = (path, body, method = 'POST') => fetch(`${base}/api${path}`, { method, headers, body: JSON.stringify(body) });
  let r = await post('/sessions', { title: 'Riset 2026', context: 'Audit AI', platform: 'chatgpt', account: 'utama' });
  assert.equal(r.status, 201); const { code } = await r.json();
  assert.match(code, /^GPT-/);
  r = await fetch(`${base}/api/sessions/${code}/prompt?mode=start`, { headers });
  assert.match((await r.json()).prompt, new RegExp(code));
  r = await post(`/sessions/${code}/link`, { link: 'https://chatgpt.com/c/abcd' }, 'PATCH');
  assert.equal((await r.json()).link, 'https://chatgpt.com/c/abcd');
  r = await post(`/sessions/${code}/messages`, { role: 'note', content: 'hasil rapat' });
  assert.equal(r.status, 201);
  r = await fetch(`${base}/api/sessions?q=${code}`, { headers }); assert.equal((await r.json()).total, 1);
  r = await fetch(`${base}/api/sessions/${code}/prompt?mode=resume`, { headers }); assert.match((await r.json()).prompt, /hasil rapat/);
  r = await fetch(`${base}/api/sessions/${code}/export`, { headers }); assert.equal((await r.json()).integrity.valid, true);
  r = await post(`/sessions/${code}/ask`, { content: 'Tes' }); assert.equal(r.status, 503);
  r = await fetch(`${base}/api/audit/verify`, { headers }); assert.equal((await r.json()).valid, true);
});
