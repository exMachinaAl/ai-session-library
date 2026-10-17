'use strict';
const path = require('node:path');
const { ChatAudit } = require('../src/chat-audit');
const count = Math.max(1, Math.min(5000, Number.parseInt(process.argv[2], 10) || 150));
const store = new ChatAudit({ dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data') });
const ai = ['chatgpt', 'gemini', 'claude'];
for (let i = 0; i < count; i++) {
  const s = store.createSession({
    title: `Riset topik ${i + 1} - ${['Kurikulum', 'Inventaris', 'Persuratan', 'Magang'][i % 4]}`,
    context: `Ini adalah data dummy sesi ke-${i + 1}; untuk pengujian pencarian berdasarkan kode unik.`,
    platform: ai[i % ai.length], account: ['akun-pribadi', 'akun-sekolah'][i % 2],
    actor: 'seed-script',
  });
  if (i === 0 || i === count - 1) console.log(s.code, s.title);
}
console.log(`${count} sesi demo dibuat. npm start untuk membuka dashboard.`);
