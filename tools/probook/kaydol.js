'use strict';
/**
 * ProBook ajanını book-update'e KENDİ JETONUYLA kaydeder (plan karar 1).
 * Kayıt sırrı (AGENT_ENROLL_SECRET) STDIN'den okunur — argv/ortam/diske YAZILMAZ;
 * yalnız sunucunun döndürdüğü ajan jetonu `~/.empp-agent/token.json`'a 0600 yazılır
 * (runner.js'in `enroll()`'uyla aynı uç ve alanlar: POST {API}/agents/enroll).
 * Kullanım (ProBook'ta, Nadir):  read -rs S && printf %s "$S" | node kaydol.js; unset S
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

async function kaydol({ sir, api, ad, yetenekler, tokenDosyasi, fetchImpl = fetch }) {
  if (!sir || !sir.trim()) throw new Error('kayıt sırrı boş (stdin)');
  if (fs.existsSync(tokenDosyasi)) throw new Error(`zaten kayıtlı: ${tokenDosyasi} (yeniden kayıt için önce .kaldirildi-* yap)`);
  const res = await fetchImpl(`${api.replace(/\/+$/, '')}/agents/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: sir.trim(), name: ad, hostname: os.hostname(), capabilities: yetenekler }),
  });
  let veri = null;
  try { veri = await res.json(); } catch (_) { veri = null; }
  if (res.status !== 201 || !veri || !veri.agentId || !veri.token) {
    // Sunucu cevabı sır içermez; yine de sırrı hata metnine KOYMA.
    throw new Error(`kayıt reddedildi: HTTP ${res.status}`);
  }
  fs.mkdirSync(path.dirname(tokenDosyasi), { recursive: true });
  fs.writeFileSync(tokenDosyasi, JSON.stringify({ agentId: veri.agentId, token: veri.token }, null, 2), { mode: 0o600 });
  return { agentId: veri.agentId };
}

function stdinOku() {
  return new Promise((resolve) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { s += d; });
    process.stdin.on('end', () => resolve(s));
  });
}

if (require.main === module) {
  (async () => {
    const r = await kaydol({
      sir: await stdinOku(),
      api: process.env.BOOKUPDATE_API || 'https://akillitahta.ndr.ist/api/v1',
      ad: process.env.AGENT_NAME || 'probook-serit',
      yetenekler: (process.env.AGENT_CAPS || 'pardus').split(',').map((c) => c.trim()).filter(Boolean),
      tokenDosyasi: process.env.AGENT_TOKEN_FILE || path.join(os.homedir(), '.empp-agent', 'token.json'),
    });
    console.log(`kaydoldu: agentId=${r.agentId} — şimdi: systemctl --user start empp-serit-agent`);
  })().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
}

module.exports = { kaydol };
