'use strict';
const $ = id => document.getElementById(id);
const state = { current: null, page: 1, totalPages: 1, mode: 'start', tab: 'prompt', token: sessionStorage.getItem('ai-registry-token') || '', searchTimer: null };
const PLATFORMS = { chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/' }, gemini: { name: 'Gemini', url: 'https://gemini.google.com/' }, claude: { name: 'Claude', url: 'https://claude.ai/' }, other: { name: 'AI lainnya', url: '' } };
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = at => new Date(at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
const headers = () => ({ 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) });
async function api(path, opts = {}) {
  let res;
  try { res = await fetch(`/api${path}`, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } }); }
  catch { throw new Error('Server tidak dapat dihubungi. Jalankan npm start.'); }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
let toastTimer;
function toast(message, error = false) {
  const e = $('toast'); e.textContent = message; e.className = 'toast visible' + (error ? ' error' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => e.className = 'toast', 4000);
}
async function wrap(fn) { try { await fn(); } catch(e) { toast(e.message, true); } }
async function stats() {
  const s = await api('/stats');
  $('statTotal').textContent = s.sessions.toLocaleString('id-ID');
  $('statActive').textContent = s.active.toLocaleString('id-ID');
  $('statAccounts').textContent = s.accounts.toLocaleString('id-ID');
  $('statEvents').textContent = s.auditEvents.toLocaleString('id-ID');
}
async function loadList() {
  const q = $('searchInput').value.trim();
  const qs = new URLSearchParams({ q, platform: $('platformFilter').value, status: $('statusFilter').value, page: state.page, limit: 25 });
  const data = await api(`/sessions?${qs}`);
  state.totalPages = data.totalPages;
  $('countLabel').textContent = `${data.total} sesi ditemukan`;
  $('pageNumber').textContent = `${data.page} / ${data.totalPages}`;
  $('prevPage').disabled = data.page <= 1;
  $('nextPage').disabled = data.page >= data.totalPages;
  const container = $('sessionList'); container.textContent = '';
  if (!data.items.length) { container.innerHTML = '<div class="empty-list">Belum ada sesi yang cocok. Coba kode atau kata kunci lain.</div>'; return; }
  for (const s of data.items) {
    const b = document.createElement('button'); b.className = `session-item ${state.current?.code === s.code ? 'selected' : ''}`;
    b.innerHTML = `<div class="session-item-top"><span class="platform-tag">${escapeHtml(PLATFORMS[s.platform]?.name || s.platform)}</span><span class="status-dot">${s.status === 'active' ? '● Aktif' : '◌ Arsip'}</span></div><b>${escapeHtml(s.title)}</b><code>${escapeHtml(s.code)}</code><small>${escapeHtml(s.account)} · ${fmt(s.updatedAt)} · ${s.messageCount} pesan</small>`;
    b.addEventListener('click', () => wrap(() => select(s.code)));
    container.append(b);
  }
}
async function select(code) {
  state.current = await api(`/sessions/by-code/${encodeURIComponent(code)}`);
  state.mode = 'start';
  state.tab = 'prompt';
  $('welcome').hidden = true; $('details').hidden = false;
  $('detailTitle').textContent = state.current.title;
  $('detailPlatform').textContent = PLATFORMS[state.current.platform]?.name || state.current.platform;
  $('detailAccount').textContent = `Akun: ${state.current.account}`;
  $('detailStatus').textContent = state.current.status === 'active' ? 'Aktif' : 'Diarsipkan';
  $('archiveBtn').textContent = state.current.status === 'active' ? 'Arsipkan' : 'Aktifkan';
  $('codeText').textContent = state.current.code;
  $('contextText').textContent = state.current.context || 'Belum ada konteks. Lengkapi sebelum menyalin prompt pembuka.';
  $('chatLink').value = state.current.link || '';
  $('linkStatus').textContent = state.current.link ? 'Tautan telah tersimpan, bisa dibuka kembali.' : 'Belum ada tautan. Salin URL dari alamat browser setelah membuat chat asli.';
  $('openSavedLink').hidden = !state.current.link;
  $('msgCount').textContent = `${state.current.messageCount} pesan tercatat`;
  $('messageContent').value = ''; $('askInput').value = '';
  document.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('active', x.dataset.mode === 'start'));
  openTab('prompt');
  await loadPrompt();
  await loadList();
}
async function loadPrompt() {
  if (!state.current) return;
  const data = await api(`/sessions/${encodeURIComponent(state.current.code)}/prompt?mode=${state.mode}`);
  $('promptText').value = data.prompt;
}
function openTab(tab) {
  state.tab = tab;
  document.querySelectorAll('[data-tab]').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  for (const id of ['prompt', 'messages', 'audit']) $(`tab-${id}`).hidden = id !== tab;
  if (tab === 'messages') renderMessages();
  if (tab === 'audit') wrap(renderAudit);
}
function renderMessages() {
  const box = $('messages'); box.textContent = '';
  if (!state.current.messages.length) { box.innerHTML = '<div class="empty-list">Transkrip belum disimpan. Jika menggunakan chat AI melalui website, salin pesan penting secara manual. Jika menggunakan OpenAI API di sini, pesan tersimpan otomatis.</div>'; return; }
  for (const m of state.current.messages) {
    const item = document.createElement('div'); item.className = `msg ${m.role}`;
    item.innerHTML = `<div class="msg-head"><b>${escapeHtml(m.role.toUpperCase())}</b><span>${fmt(m.createdAt)}</span></div><div class="msg-content">${escapeHtml(m.content)}</div>`;
    box.append(item);
  }
}
async function renderAudit() {
  const events = await api(`/sessions/${encodeURIComponent(state.current.code)}/audit`);
  const labels = { 'session.create': 'Sesi dibuat', 'session.rename': 'Judul diubah', 'session.context': 'Konteks diperbarui', 'session.link': 'Tautan diubah', 'session.status': 'Status diubah', 'message.add': 'Pesan disimpan' };
  const box = $('auditList'); box.textContent = '';
  for (const e of events.slice().reverse()) {
    const div = document.createElement('div'); div.className = 'audit-event';
    div.innerHTML = `<span class="dot"></span><div><strong>#${e.seq} · ${escapeHtml(labels[e.action] || e.action)}</strong><p>${fmt(e.at)} · ${escapeHtml(e.actor)}</p><code>sha256: ${escapeHtml(e.hash.slice(0, 28))}…</code></div>`;
    box.append(div);
  }
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const el = document.createElement('textarea'); el.value = text; el.style.position = 'fixed'; el.style.opacity = 0;
    document.body.append(el); el.select(); const ok = document.execCommand('copy'); el.remove(); if (!ok) throw new Error('Clipboard tidak tersedia; salin teks dari kotak secara manual.');
  }
}
function createOpen() { $('createDialog').showModal(); $('newTitle').focus(); }
$('createTop').addEventListener('click', createOpen);
$('createSide').addEventListener('click', createOpen);
$('cancelDialog').addEventListener('click', () => $('createDialog').close());
$('createForm').addEventListener('submit', e => { e.preventDefault(); wrap(async () => {
  const body = { title: $('newTitle').value, context: $('newContext').value, platform: $('newPlatform').value, account: $('newAccount').value };
  const s = await api('/sessions', { method: 'POST', body: JSON.stringify(body) });
  $('createDialog').close(); $('createForm').reset(); state.page = 1;
  await stats(); await select(s.code);
  toast('Sesi terdaftar. Salin prompt pembuka untuk chat baru.');
}); });
$('searchInput').addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => { state.page = 1; wrap(loadList); }, 180); });
for (const id of ['platformFilter', 'statusFilter']) $(id).addEventListener('change', () => { state.page = 1; wrap(loadList); });
$('prevPage').addEventListener('click', () => { if (state.page > 1) { state.page--; wrap(loadList); } });
$('nextPage').addEventListener('click', () => { if (state.page < state.totalPages) { state.page++; wrap(loadList); } });
$('copyCodeBtn').addEventListener('click', () => wrap(async () => { await copy(state.current.code); toast('Kode disalin.'); }));
$('copyPromptBtn').addEventListener('click', () => wrap(async () => { await copy($('promptText').value); toast('Prompt disalin. Tempel di chat AI.'); }));
$('openAI').addEventListener('click', () => {
  const p = PLATFORMS[state.current.platform];
  if (p?.url) window.open(p.url, '_blank', 'noopener,noreferrer');
  else toast('Untuk AI lainnya, buka alamat situs AI yang Anda gunakan.', true);
});
for (const el of document.querySelectorAll('[data-mode]')) el.addEventListener('click', () => wrap(async () => {
  state.mode = el.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('active', x === el));
  await loadPrompt();
}));
for (const el of document.querySelectorAll('[data-tab]')) el.addEventListener('click', () => openTab(el.dataset.tab));
$('saveLink').addEventListener('click', () => wrap(async () => {
  const s = await api(`/sessions/${encodeURIComponent(state.current.code)}/link`, { method: 'PATCH', body: JSON.stringify({ link: $('chatLink').value }) });
  await select(s.code); toast('Tautan sesi tersimpan.');
}));
$('openSavedLink').addEventListener('click', () => { if (state.current.link) window.open(state.current.link, '_blank', 'noopener,noreferrer'); });
$('editContextBtn').addEventListener('click', () => { $('contextEditor').value = state.current.context; $('contextDialog').showModal(); });
$('cancelContext').addEventListener('click', () => $('contextDialog').close());
$('contextForm').addEventListener('submit', e => { e.preventDefault(); wrap(async () => {
  const s = await api(`/sessions/${encodeURIComponent(state.current.code)}/context`, { method: 'PATCH', body: JSON.stringify({ context: $('contextEditor').value }) });
  $('contextDialog').close(); await select(s.code); toast('Konteks diperbarui.');
}); });
$('archiveBtn').addEventListener('click', () => wrap(async () => {
  const status = state.current.status === 'active' ? 'archived' : 'active';
  const s = await api(`/sessions/${encodeURIComponent(state.current.code)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  await stats(); await select(s.code); toast(status === 'archived' ? 'Sesi diarsipkan.' : 'Sesi diaktifkan kembali.');
}));
$('messageForm').addEventListener('submit', e => { e.preventDefault(); wrap(async () => {
  const code = state.current.code;
  await api(`/sessions/${encodeURIComponent(code)}/messages`, { method: 'POST', body: JSON.stringify({ role: $('messageRole').value, content: $('messageContent').value }) });
  await stats(); await select(code); openTab('messages'); toast('Pesan dicatat di audit.');
}); });
$('askBtn').addEventListener('click', () => wrap(async () => {
  const code = state.current.code; const content = $('askInput').value;
  if (!content.trim()) { toast('Isi pertanyaan terlebih dahulu.', true); return; }
  const btn = $('askBtn'); btn.disabled = true; btn.textContent = 'Mengirim…';
  try { await api(`/sessions/${encodeURIComponent(code)}/ask`, { method: 'POST', body: JSON.stringify({ content }) });
    await stats(); await select(code); openTab('messages'); toast('Balasan API berhasil disimpan.');
  } finally { btn.disabled = false; btn.textContent = 'Kirim'; }
}));
$('exportBtn').addEventListener('click', () => wrap(async () => {
  const d = await api(`/sessions/${encodeURIComponent(state.current.code)}/export`);
  const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `${state.current.code}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
}));
$('verifyBtn').addEventListener('click', () => wrap(async () => {
  const d = await api('/audit/verify'); toast(d.valid ? `Integritas valid (${d.totalEvents} event).` : `Integritas bermasalah: ${d.reason}`, !d.valid);
}));
$('tokenBtn').addEventListener('click', () => {
  const val = prompt('Masukkan API_TOKEN server (kosongkan bila tidak menggunakan token):', state.token);
  if (val !== null) { state.token = val.trim(); if (state.token) sessionStorage.setItem('ai-registry-token', state.token); else sessionStorage.removeItem('ai-registry-token'); wrap(async () => { await stats(); await loadList(); }); }
});
wrap(async () => { await stats(); await loadList(); });
