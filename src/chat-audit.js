'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, createHash } = require('node:crypto');

const PLATFORMS = Object.freeze({
  chatgpt: { prefix: 'GPT', url: 'https://chatgpt.com/', domains: ['chatgpt.com'] },
  gemini: { prefix: 'GEM', url: 'https://gemini.google.com/', domains: ['gemini.google.com'] },
  claude: { prefix: 'CLD', url: 'https://claude.ai/', domains: ['claude.ai'] },
  other: { prefix: 'OTH', url: '', domains: [] },
});
class ChatAuditError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'ChatAuditError'; this.status = status; }
}
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function cleanText(value, field, length, optional = false) {
  if (optional && (value == null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim()) throw new ChatAuditError(`${field} wajib diisi.`);
  const t = value.trim();
  if (t.length > length) throw new ChatAuditError(`${field} maksimal ${length} karakter.`);
  return t;
}
function accountFingerprint(platform, account) {
  // Penanda stabil untuk label akun, bukan verifikasi identitas, autentikasi, atau enkripsi.
  return createHash('sha256').update(`${platform}\0${account.trim().toLowerCase()}`).digest('hex').slice(0, 6).toUpperCase();
}
function linkFor(platform, value) {
  if (value === null || value === undefined || value === '') return '';
  const link = cleanText(value, 'Tautan chat', 1600);
  let u;
  try { u = new URL(link); } catch { throw new ChatAuditError('Tautan harus berupa URL HTTPS yang valid.'); }
  if (u.protocol !== 'https:' || u.username || u.password) throw new ChatAuditError('Tautan harus HTTPS tanpa kredensial.');
  if (PLATFORMS[platform].domains.length && !PLATFORMS[platform].domains.includes(u.hostname.toLowerCase())) {
    throw new ChatAuditError(`Tautan tidak sesuai dengan platform ${platform}.`);
  }
  return u.toString();
}
function promptStart(s) {
  return `[KODE_SESI: ${s.code}]\n[JUDUL: ${s.title}]\n[PLATFORM: ${s.platform.toUpperCase()}]\n[AKUN_REFERENSI: ${s.account}]\n\nSaya ingin memulai percakapan dengan identitas sesi di atas. Gunakan kode sesi ini sebagai penanda referensi dalam percakapan ini (bukan password atau akses database).\n\nATURAN PEMBUKA:\n1. Awali jawaban PERTAMA dengan baris tepat: KODE SESI: ${s.code}\n2. Setelah itu, tulis judul, ringkasan konteks, dan langkah awal yang relevan.\n3. Jika saya mencantumkan kode ini lagi di chat baru, jangan mengaku dapat mengambil riwayat hanya dari kode; minta konteks atau transkrip jika belum tersedia.\n\nKONTEKS AWAL:\n${s.context || '(Belum ditulis. Minta pengguna menjelaskan konteks.)'}\n\nSilakan buka sesi ini sekarang.`;
}
function promptResume(s) {
  const lines = s.messages.filter(m => ['user', 'assistant', 'note'].includes(m.role))
    .map(m => `${m.role.toUpperCase()} (${m.createdAt}): ${m.content}`);
  // Resume excerpt is intentionally bounded to avoid enormous prompts.
  const selected = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (size + lines[i].length > 20000) break;
    selected.unshift(lines[i]);
    size += lines[i].length;
  }
  const clipped = selected.length < lines.length;
  return `[KODE_SESI: ${s.code}]\n[JUDUL: ${s.title}]\n[PLATFORM: ${s.platform.toUpperCase()}]\n\nSaya ingin MELANJUTKAN riset dengan kode sesi ini. Awali jawaban dengan baris tepat: KODE SESI: ${s.code}\nGunakan konteks dan catatan berikut; jangan mengklaim memiliki akses otomatis ke chat terdahulu. Bila transkrip tidak lengkap, jelaskan batasannya.\n\nKONTEKS AWAL:\n${s.context || '(Tidak ada)'}\n\nRIWAYAT YANG DISIMPAN DI REGISTRY${clipped ? ' (SEBAGIAN, PESAN LAMA TERPOTONG)' : ''}:\n${selected.length ? selected.join('\n\n') : '(Belum ada transkrip yang dimasukkan ke registry. Mintalah rangkuman/isi chat sebelumnya dari pengguna.)'}\n\nRingkas posisi terakhir diskusi dan tanyakan fokus lanjutan atau lanjutkan dari instruksi saya berikutnya.`;
}

class ChatAudit {
  constructor({ dataDir = path.join(process.cwd(), 'data') } = {}) {
    this.dataDir = path.resolve(dataDir);
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.eventFile = path.join(this.dataDir, 'events.jsonl');
    if (!fs.existsSync(this.eventFile)) fs.writeFileSync(this.eventFile, '');
    this.sessions = new Map();
    this.events = [];
    this.headHash = 'GENESIS';
    this._load();
  }
  _requireSession(code) {
    const s = typeof code === 'string' ? this.sessions.get(code.trim().toUpperCase()) : null;
    if (!s) throw new ChatAuditError('Kode sesi tidak ditemukan.', 404);
    return s;
  }
  _load() {
    const body = fs.readFileSync(this.eventFile, 'utf8');
    if (body && !body.endsWith('\n')) throw new Error('Audit log tidak lengkap: baris terakhir terpotong. Pulihkan backup.');
    let prev = 'GENESIS';
    body.split('\n').filter(Boolean).forEach((line, i) => {
      let event;
      try { event = JSON.parse(line); } catch { throw new Error(`JSON audit rusak pada baris ${i + 1}`); }
      const { hash, ...unsigned } = event;
      if (unsigned.seq !== i + 1 || unsigned.prevHash !== prev || digest(unsigned) !== hash) {
        throw new Error(`Integritas audit gagal pada baris ${i + 1}`);
      }
      this._apply(event);
      this.events.push(event);
      prev = hash;
    });
    this.headHash = prev;
  }
  _apply(event) {
    const { action, code, actor, at, payload } = event;
    if (action === 'session.create') {
      if (this.sessions.has(code)) throw new Error(`Kode ganda ${code}`);
      this.sessions.set(code, {
        code, title: payload.title, context: payload.context || '', platform: payload.platform,
        account: payload.account, accountTag: payload.accountTag, link: payload.link || '',
        status: 'active', createdBy: actor, createdAt: at, updatedAt: at, messages: [],
      });
      return;
    }
    const s = this.sessions.get(code);
    if (!s) throw new Error(`Referensi sesi tidak ada: ${code}`);
    if (action === 'message.add') s.messages.push(payload.message);
    else if (action === 'session.rename') s.title = payload.title;
    else if (action === 'session.context') s.context = payload.context;
    else if (action === 'session.link') s.link = payload.link;
    else if (action === 'session.status') s.status = payload.status;
    else throw new Error(`Event tidak dikenal: ${action}`);
    s.updatedAt = at;
  }
  _append({ code, actor, action, payload }) {
    const unsigned = {
      seq: this.events.length + 1, eventId: randomUUID(), at: new Date().toISOString(),
      actor, action, code, payload, prevHash: this.headHash,
    };
    const event = { ...unsigned, hash: digest(unsigned) };
    const fd = fs.openSync(this.eventFile, 'a');
    try { fs.writeSync(fd, JSON.stringify(event) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    this._apply(event);
    this.events.push(event);
    this.headHash = event.hash;
    return event;
  }
  createSession({ title, context = '', platform = 'chatgpt', account = 'utama', link = '', actor = 'operator' }) {
    title = cleanText(title, 'Judul', 140);
    context = cleanText(context, 'Konteks', 10000, true);
    platform = cleanText(platform, 'Platform', 32).toLowerCase();
    if (!Object.hasOwn(PLATFORMS, platform)) throw new ChatAuditError('Platform: chatgpt, gemini, claude, other.');
    account = cleanText(account, 'Label akun', 100);
    actor = cleanText(actor, 'Aktor', 80);
    link = linkFor(platform, link);
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const accountTag = accountFingerprint(platform, account);
    let code;
    do { code = `${PLATFORMS[platform].prefix}-${accountTag}-${day}-${randomBytes(5).toString('hex').toUpperCase()}`; }
    while (this.sessions.has(code));
    this._append({ action: 'session.create', code, actor, payload: { title, context, platform, account, accountTag, link } });
    return this.getSession(code);
  }
  addMessage(code, { role, content, actor = 'operator' }) {
    const s = this._requireSession(code);
    if (s.status !== 'active') throw new ChatAuditError('Sesi diarsipkan; aktifkan dulu.', 409);
    if (!['user', 'assistant', 'note', 'system'].includes(role)) throw new ChatAuditError('Role pesan tidak valid.');
    content = cleanText(content, 'Pesan', 40000);
    actor = cleanText(actor, 'Aktor', 80);
    const message = { id: randomUUID(), role, content, createdAt: new Date().toISOString() };
    this._append({ action: 'message.add', code: s.code, actor, payload: { message } });
    return { ...message };
  }
  renameSession(code, { title, actor = 'operator' }) {
    const s = this._requireSession(code);
    title = cleanText(title, 'Judul', 140);
    actor = cleanText(actor, 'Aktor', 80);
    if (title !== s.title) this._append({ action: 'session.rename', code: s.code, actor, payload: { title } });
    return this.getSession(code);
  }
  setContext(code, { context = '', actor = 'operator' }) {
    const s = this._requireSession(code);
    context = cleanText(context, 'Konteks', 10000, true);
    actor = cleanText(actor, 'Aktor', 80);
    if (context !== s.context) this._append({ action: 'session.context', code: s.code, actor, payload: { context } });
    return this.getSession(code);
  }
  setLink(code, { link = '', actor = 'operator' }) {
    const s = this._requireSession(code);
    link = linkFor(s.platform, link);
    actor = cleanText(actor, 'Aktor', 80);
    if (link !== s.link) this._append({ action: 'session.link', code: s.code, actor, payload: { link } });
    return this.getSession(code);
  }
  setStatus(code, { status, actor = 'operator' }) {
    const s = this._requireSession(code);
    if (!['active', 'archived'].includes(status)) throw new ChatAuditError('Status harus active/archived.');
    actor = cleanText(actor, 'Aktor', 80);
    if (s.status !== status) this._append({ action: 'session.status', code: s.code, actor, payload: { status } });
    return this.getSession(code);
  }
  getSession(code) {
    const s = this._requireSession(code);
    return { ...s, messages: s.messages.map(m => ({ ...m })), messageCount: s.messages.length };
  }
  prompt(code, mode = 'start') {
    const s = this._requireSession(code);
    if (mode === 'start') return promptStart(s);
    if (mode === 'resume') return promptResume(s);
    throw new ChatAuditError('Mode prompt harus start atau resume.');
  }
  listSessions({ q = '', platform = 'all', account = 'all', status = 'all', page = 1, limit = 30 } = {}) {
    if (!['all', 'active', 'archived'].includes(status)) throw new ChatAuditError('Filter status tidak valid.');
    if (platform !== 'all' && !Object.hasOwn(PLATFORMS, platform)) throw new ChatAuditError('Filter platform tidak valid.');
    const term = String(q).trim().toLowerCase();
    page = Math.max(1, Number.parseInt(page, 10) || 1);
    limit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 30));
    const matches = [...this.sessions.values()].filter(s =>
      (status === 'all' || s.status === status) &&
      (platform === 'all' || s.platform === platform) &&
      (account === 'all' || s.account.toLowerCase() === String(account).toLowerCase()) &&
      (!term || [s.code, s.title, s.context, s.account, s.platform].some(x => x.toLowerCase().includes(term)))
    ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { total: matches.length, page, limit, totalPages: Math.max(1, Math.ceil(matches.length / limit)),
      items: matches.slice((page - 1) * limit, page * limit).map(s => ({
        code: s.code, title: s.title, platform: s.platform, account: s.account, accountTag: s.accountTag,
        status: s.status, createdAt: s.createdAt, updatedAt: s.updatedAt, messageCount: s.messages.length,
        link: s.link,
      })) };
  }
  listAudit(code) {
    const s = this._requireSession(code);
    return this.events.filter(e => e.code === s.code).map(e => structuredClone(e));
  }
  verifyIntegrity() {
    const body = fs.readFileSync(this.eventFile, 'utf8');
    if (body && !body.endsWith('\n')) return { valid: false, reason: 'Baris terakhir terpotong.' };
    const lines = body.split('\n').filter(Boolean);
    let prev = 'GENESIS';
    for (let i = 0; i < lines.length; i++) {
      let e;
      try { e = JSON.parse(lines[i]); } catch { return { valid: false, reason: `JSON rusak pada baris ${i + 1}` }; }
      const { hash, ...unsigned } = e;
      if (unsigned.seq !== i + 1 || unsigned.prevHash !== prev || digest(unsigned) !== hash) {
        return { valid: false, reason: `Hash tidak cocok pada baris ${i + 1}` };
      }
      prev = hash;
    }
    return { valid: true, totalEvents: lines.length, headHash: prev };
  }
  exportSession(code) { return { exportedAt: new Date().toISOString(), session: this.getSession(code), audit: this.listAudit(code), integrity: this.verifyIntegrity() }; }
  statistics() {
    const s = [...this.sessions.values()];
    return { sessions: s.length, active: s.filter(x => x.status === 'active').length,
      archived: s.filter(x => x.status === 'archived').length, messages: s.reduce((n, x) => n + x.messages.length, 0),
      accounts: new Set(s.map(x => `${x.platform}:${x.accountTag}`)).size, auditEvents: this.events.length };
  }
}
module.exports = { ChatAudit, ChatAuditError, PLATFORMS, accountFingerprint };
