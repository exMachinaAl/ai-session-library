'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChatAudit } = require('../src/chat-audit');
const { askOpenAI, outputText } = require('../src/openai-client');
function tmp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-registry-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return { dir, store: new ChatAudit({ dataDir: dir }) }; }
test('kode unik berdasarkan AI dan penanda akun, pencarian, integritas setelah restart', t => {
  const { dir, store } = tmp(t);
  const a = store.createSession({ title: 'PRD Persuratan', context: 'Laravel role-based', platform: 'chatgpt', account: 'Akun Sekolah' });
  const b = store.createSession({ title: 'PRD Persuratan', platform: 'gemini', account: 'Akun Sekolah' });
  const c = store.createSession({ title: 'Riset lain', platform: 'chatgpt', account: 'Akun Sekolah' });
  assert.match(a.code, /^GPT-[A-F0-9]{6}-\d{8}-[A-F0-9]{10}$/);
  assert.match(b.code, /^GEM-[A-F0-9]{6}-\d{8}-[A-F0-9]{10}$/);
  assert.equal(a.accountTag, c.accountTag);
  assert.notEqual(a.accountTag, b.accountTag);
  assert.notEqual(a.code, c.code);
  assert.equal(store.getSession(a.code.toLowerCase()).context, 'Laravel role-based');
  assert.equal(store.listSessions({ q: 'Laravel' }).total, 1);
  assert.equal(store.listSessions({ platform: 'gemini' }).total, 1);
  assert.equal(store.listSessions({ account: 'akun sekolah' }).total, 3);
  assert.equal(store.verifyIntegrity().valid, true);
  assert.equal(new ChatAudit({ dataDir: dir }).getSession(a.code).title, 'PRD Persuratan');
});
test('prompt pembuka dan lanjutkan termasuk kode; tautan privat dan catatan tersimpan', t => {
  const { store } = tmp(t);
  const s = store.createSession({ title: 'Proyek sekolah', context: 'Bangun Laravel', platform: 'chatgpt' });
  assert.match(store.prompt(s.code, 'start'), new RegExp(`KODE SESI: ${s.code}`));
  assert.match(store.prompt(s.code, 'start'), /Bangun Laravel/);
  store.addMessage(s.code, { role: 'user', content: 'Mulai merancang.' });
  store.addMessage(s.code, { role: 'assistant', content: 'Baik, modul pertama TU.' });
  store.addMessage(s.code, { role: 'note', content: 'Simpan keputusan role.' });
  assert.match(store.prompt(s.code, 'resume'), /modul pertama TU/);
  store.setLink(s.code, { link: 'https://chatgpt.com/c/123abc' });
  assert.equal(store.getSession(s.code).link, 'https://chatgpt.com/c/123abc');
  assert.throws(() => store.setLink(s.code, { link: 'https://example.com/steal' }), /tidak sesuai/);
  assert.throws(() => store.setLink(s.code, { link: 'javascript:alert(1)' }), /HTTPS/);
  store.setContext(s.code, { context: 'Perbarui fokus riset' });
  assert.match(store.prompt(s.code, 'start'), /Perbarui fokus riset/);
  assert.equal(store.listAudit(s.code).length, 6);
  assert.equal(store.exportSession(s.code).integrity.valid, true);
});
test('250 sesi tetap dapat dicari, arsip mengunci pesan', t => {
  const { store } = tmp(t);
  let code;
  for (let i = 0; i < 250; i++) { const s = store.createSession({ title: `Topik ${i}`, platform: i % 2 ? 'claude' : 'chatgpt', account: 'uji' }); if (i === 177) code = s.code; }
  assert.equal(store.getSession(code).title, 'Topik 177');
  assert.equal(store.listSessions({ q: code }).total, 1);
  assert.equal(store.listSessions({ limit: 25, page: 2 }).items.length, 25);
  store.setStatus(code, { status: 'archived' });
  assert.throws(() => store.addMessage(code, { role: 'user', content: 'Tanya' }), /diarsipkan/);
  store.setStatus(code, { status: 'active' });
  store.addMessage(code, { role: 'user', content: 'Tanya' });
  assert.equal(store.verifyIntegrity().valid, true);
});
test('modifikasi log disk terdeteksi', t => {
  const { dir, store } = tmp(t);
  store.createSession({ title: 'Asli' });
  const p = path.join(dir, 'events.jsonl');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('Asli', 'Palsu'));
  assert.equal(store.verifyIntegrity().valid, false);
  assert.throws(() => new ChatAudit({ dataDir: dir }), /integritas/i);
});
test('OpenAI Responses parser dan mock request non-network', async t => {
  const { store } = tmp(t);
  const s = store.createSession({ title: 'Mock AI', platform: 'chatgpt', context: 'Diskusi singkat' });
  assert.equal(outputText({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }] }), 'ok');
  let sent;
  const mockFetch = async (url, options) => { sent = { url, ...options }; return { ok: true, json: async () => ({ id: 'resp_test', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `KODE SESI: ${s.code}\nHai` }] }] }) }; };
  const result = await askOpenAI(s, 'Halo', { apiKey: 'test-key', fetchImpl: mockFetch });
  assert.equal(result.responseId, 'resp_test');
  assert.equal(sent.url, 'https://api.openai.com/v1/responses');
  assert.equal(JSON.parse(sent.body).store, false);
  assert.equal(JSON.parse(sent.body).input[0].content, 'Halo');
  assert.match(result.answer, new RegExp(s.code));
});
