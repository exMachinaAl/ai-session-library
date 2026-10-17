'use strict';
const { ChatAuditError } = require('./chat-audit');

function outputText(body) {
  if (typeof body.output_text === 'string' && body.output_text.trim()) return body.output_text.trim();
  return (body.output || []).filter(x => x.type === 'message' && x.role === 'assistant')
    .flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text || '').join('\n').trim();
}
async function askOpenAI(session, userContent, { apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL || 'gpt-4.1-mini', fetchImpl = fetch } = {}) {
  if (!apiKey) throw new ChatAuditError('OPENAI_API_KEY belum disetel pada server.', 503);
  if (session.platform !== 'chatgpt') throw new ChatAuditError('Chat otomatis via API saat ini hanya untuk platform ChatGPT/OpenAI.', 400);
  // Ambil catatan user/assistant saja; semua pesan tetap dipertahankan di registry lokal.
  const history = session.messages.filter(m => ['user', 'assistant'].includes(m.role)).slice(-40)
    .map(m => ({ role: m.role, content: m.content }));
  history.push({ role: 'user', content: userContent });
  let response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, store: false, instructions: `Ini adalah sesi dengan KODE SESI: ${session.code}. Awali setiap jawaban dengan baris: KODE SESI: ${session.code}. Judul: ${session.title}. Konteks: ${session.context || 'tidak ada'}. Jangan mengklaim bisa mengambil sesi ChatGPT situs hanya dari kode.`, input: history }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) { throw new ChatAuditError(`Tidak bisa menghubungi OpenAI API: ${err.message}`, 502); }
  if (!response.ok) {
    // Do not echo API key or full provider payload; surface status and short provider message only.
    let note = '';
    try { const j = await response.json(); note = String(j.error?.message || '').slice(0, 240); } catch {}
    throw new ChatAuditError(`OpenAI API HTTP ${response.status}${note ? `: ${note}` : ''}`, 502);
  }
  let data;
  try { data = await response.json(); } catch { throw new ChatAuditError('Respons API bukan JSON.', 502); }
  const bodyText = outputText(data);
  if (!bodyText) throw new ChatAuditError('Respons API tidak berisi pesan teks.', 502);
  const codeHeader = `KODE SESI: ${session.code}`;
  const answer = bodyText.startsWith(codeHeader) ? bodyText : `${codeHeader}\n\n${bodyText}`;
  return { answer, model, responseId: data.id || null };
}
module.exports = { askOpenAI, outputText };
