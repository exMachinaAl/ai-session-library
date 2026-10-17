# AI Chat Session Registry v2.0

Library dan dashboard Node.js ringan yang memberi **kode unik per sesi berdasarkan label akun dan platform AI**, agar ratusan sesi dari ChatGPT, Gemini, Claude, maupun AI lain bisa didaftarkan, dicari, diaudit, dan dibuka kembali.

## Ringkasan alur (penting)

1. Buat sesi: pilih platform **ChatGPT / Gemini / Claude**, label akun (mis. `akun-pribadi`), judul, dan konteks.
2. Program membuat kode seperti **`GPT-8AF2D1-20261016-1B2C3D4E5F`**. `GPT` menandakan ChatGPT, 6 digit berikutnya adalah fingerprint SHA-256 pendek dari label akun + platform, diikuti tanggal UTC serta 10 digit heksadesimal acak. **Kode bukan identitas akun yang sudah diverifikasi; jangan digunakan untuk autentikasi.**
3. Klik **Salin prompt**, lalu klik **Buka AI**. Tempel teks sebagai pesan pertama dalam chat baru. Prompt menginstruksikan AI memulai jawaban dengan `KODE SESI: ...` dan memahami konteks awal (tidak bisa menjamin kepatuhan model jika ada instruksi yang lebih tinggi).
4. Setelah chat terbentuk, **salin URL dari bilah alamat browser**, masukkan ke **Tautan chat asli**, lalu Simpan. Gunakan tautan chat privat milik akun sendiri, bukan *shared link* yang mungkin hanya menyediakan tampilan baca.
5. Saat ingin kembali, cari kode atau judul di dashboard dan klik **Buka percakapan tersimpan**. Jika tautan belum ada, buka akun AI yang tepat dan cari kode di riwayat chat platformnya jika platform mendukung. Khusus ChatGPT, pencarian sidebar/Ctrl+K dapat mencocokkan isi pesan dan judul. Chat yang telah dihapus tidak dapat dipulihkan dengan kode.
6. Jika perlu pindah ke **chat baru**, salin **Prompt → Lanjutkan**. Agar konteks di dalamnya lengkap, masukkan catatan/transkrip ke tab **Transkrip & API** atau perbarui konteks secara manual. Tanpa transkrip, kode saja **tidak mampu** mengambil riwayat percakapan.

**Contoh prompt pembuka:**

```text
[KODE_SESI: GPT-8AF2D1-20261016-1B2C3D4E5F]
[JUDUL: Rancang Sistem Persuratan Sekolah]
[PLATFORM: CHATGPT]
[AKUN_REFERENSI: sekolah]

Saya ingin memulai percakapan dengan identitas sesi di atas.
ATURAN PEMBUKA:
1. Awali jawaban PERTAMA dengan baris tepat:
   KODE SESI: GPT-8AF2D1-20261016-1B2C3D4E5F
...
KONTEKS AWAL:
Buat CRUD arsip surat dengan Laravel dan hak akses sesuai role.
```

### Batas integrasi situs AI

- Program **tidak** membaca otomatis seluruh riwayat ChatGPT.com, Gemini, atau Claude, dan tidak dapat secara otomatis mengubah judul chat pada situs-situs tersebut.
- Menyalin prompt **tidak otomatis mengirimnya** ke situs AI. Pengguna perlu membuka situs, masuk ke akun yang tepat, kemudian menempel dan mengirimnya.
- Untuk melanjutkan chat lama dengan utuh, **simpan URL chat yang sama** di aplikasi. Kode di pesan memungkinkan pencarian teks dalam riwayat ChatGPT, tetapi bukan akses langsung atau pengenal resmi ChatGPT.
- Penamaan kode bersumber dari **label akun yang Anda isi**, bukan kredensial/email akun yang dibaca dari provider. Label akun identik menghasilkan fingerprint identik pada platform yang sama.
- Prompt pemulihan memuat konteks dan **maksimum 20.000 karakter transkrip terakhir**; ia tidak bisa memulihkan bagian yang tidak disimpan di registry.

## Menjalankan

Prasyarat: **Node.js 18+** (disarankan 20+). Tidak ada dependency paket eksternal, jadi tidak membutuhkan `npm install` atau basis data.

1. Ekstrak ZIP.
2. Buka folder `ai-chat-session-registry` di VS Code / Git Bash (folder yang berisi `server.js`).
3. Jalankan:

```bash
npm start
```

4. Buka **http://127.0.0.1:3000**.

**Untuk menguji 250 sesi:**

```bash
node scripts/seed.js 250
npm start
```

**Tes otomatis:**

```bash
npm test
```

Penyimpanan tersimpan ke `data/events.jsonl` di komputer lokal. Backup **folder `data/`** (sebaiknya ketika server berhenti). Jangan menjalankan beberapa proses Node dengan folder data yang sama. Jangan edit file audit secara manual. File log memakai rangkaian hash SHA-256 untuk deteksi modifikasi tidak konsisten, bukan perlindungan kuat terhadap pengedit yang dapat menghitung ulang semua hash.

## Mode B: Chat langsung dalam dashboard lewat OpenAI API (opsional)

Ini adalah alur **berbeda dari situs ChatGPT**. Dengan API key dari platform OpenAI, pertanyaan dikirim ke OpenAI Responses API lalu pertanyaan dan jawaban disimpan otomatis ke transkrip registry; Anda bisa melanjutkan dengan kode yang sama **dalam dashboard**, menggunakan sejarah pesan lokal. Biaya API berlaku dan berbeda dari langganan ChatGPT.

Di terminal **PowerShell**:

```powershell
$env:OPENAI_API_KEY="isi-key-anda"
$env:OPENAI_MODEL="gpt-4.1-mini"
node server.js
```

Atau **Git Bash**:

```bash
OPENAI_API_KEY='isi-key-anda' OPENAI_MODEL='gpt-4.1-mini' npm start
```

Buka sesi **ChatGPT**, tab **Transkrip & API**, masukkan pertanyaan di panel API, dan klik Kirim. Model dapat Anda ganti melalui `OPENAI_MODEL`. Mode ini mengirim sampai 40 pesan terakhir (user/assistant) per permintaan; data lengkap yang tercatat tetap di penyimpanan lokal. OpenAI API request menggunakan `store: false`; kebijakan pemrosesan/retensi penyedia API tetap berlaku. **OpenAI API key jangan pernah ditulis di dashboard/browser atau dibagikan kepada orang lain.**

Tanpa API key, dashboard tetap berfungsi untuk mode manual (registrasi, pencarian, prompt, tautan, transkrip manual, ekspor).

## Kode library Node.js

```js
const { ChatAudit } = require('./src/chat-audit');
const registry = new ChatAudit({ dataDir: './data' });
const s = registry.createSession({
  title: 'SIM Persuratan Sekolah',
  context: 'Proyek Laravel dan MySQL dengan role terpisah',
  platform: 'chatgpt',
  account: 'akun-sekolah',
});
console.log(s.code);
console.log(registry.prompt(s.code, 'start')); // prompt pembuka
registry.setLink(s.code, { link: 'https://chatgpt.com/c/CONTOH-ID' });
registry.addMessage(s.code, { role: 'note', content: 'Prioritaskan modul surat masuk.' });
console.log(registry.prompt(s.code, 'resume')); // prompt lanjut
console.log(registry.getSession(s.code));
console.log(registry.listSessions({ q: s.code }));
console.log(registry.listAudit(s.code));
```

## API REST

| Metode | Endpoint | Deskripsi |
| --- | --- | --- |
| `POST` | `/api/sessions` | `{title, context, platform, account, link?}` |
| `GET` | `/api/sessions?q=...&platform=chatgpt&status=all&page=1&limit=25` | Cari kode, judul, konteks, akun; filter platform/status |
| `GET` | `/api/sessions/by-code/:code` | Pencarian langsung dengan kode |
| `GET` | `/api/sessions/:code` | Detail + transkrip |
| `GET` | `/api/sessions/:code/prompt?mode=start` | Prompt pembuka |
| `GET` | `/api/sessions/:code/prompt?mode=resume` | Prompt lanjutan |
| `PATCH` | `/api/sessions/:code/link` | `{link}` simpan URL chat asli |
| `PATCH` | `/api/sessions/:code/context` | `{context}` perbarui konteks |
| `PATCH` | `/api/sessions/:code` | `{title}` ganti judul |
| `PATCH` | `/api/sessions/:code/status` | `{status:"archived"/"active"}` |
| `POST` | `/api/sessions/:code/messages` | `{role:"user"/"assistant"/"note",content}` |
| `POST` | `/api/sessions/:code/ask` | `{content}` kirim ke OpenAI API dan simpan (butuh API key) |
| `GET` | `/api/sessions/:code/audit` | Audit satu sesi |
| `GET` | `/api/sessions/:code/export` | Download JSON sesi + audit |
| `GET` | `/api/audit/verify` | Pemeriksaan hash-chain |
| `GET` | `/api/stats` | Statistik global |
| `GET` | `/api/health` | Health check |

Contoh registrasi lewat API:

```bash
curl -X POST http://127.0.0.1:3000/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"title":"Riset Laravel","platform":"chatgpt","account":"akun-utama","context":"Sistem inventaris sekolah"}'
```

## Pengamanan sebelum deployment

Default bind hanya `127.0.0.1` dan tidak memakai autentikasi. Untuk komputer bersama/network/internet, aplikasi ini **belum siap produksi**. Perlu login sungguhan, pemisahan data dan role, HTTPS, CSRF/access logging, pembatasan request, backup terenkripsi, dan migrasi database single-writer ke SQLite/PostgreSQL. `API_TOKEN` opsional melindungi endpoint lokal, tetapi itu bukan pengganti sistem multi-user.

Contoh penggunaan token saat development di Git Bash: `API_TOKEN='token-panjang-acak' npm start`, lalu isi lewat tombol **Token** di dashboard. Karena aktor audit hanya label dari klien, **actor bukan identitas terverifikasi**. Semua chat disimpan sebagai plaintext di disk; batasi akses folder data. Tidak ada endpoint delete permanen, gunakan Arsipkan untuk menjaga jejak.
# ai-session-library
