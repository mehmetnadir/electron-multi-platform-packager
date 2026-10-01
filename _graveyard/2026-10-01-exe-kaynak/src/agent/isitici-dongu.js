'use strict';
/**
 * Kaynak ön-ısıtma döngüsü — KAPALI (exe'siz sözleşme, Nadir 01.10: İmpark exe'si HİÇBİR koşulda
 * indirilmez). `birTur` peek bile yapmadan `{durum:'kapali'}` döner; CLI uyarıp çıkar. Modül
 * silinmedi (`siradakileriSor`/`kimlikOku` salt okur). Aşağıdaki tarihçe bilgi içindir.
 *
 * (Tarihçe) Kaynak ön-ısıtma döngüsü — ajanın DIŞINDA, ayrı süreç.
 *
 * Boru hattı fikri (ölçüm 2026-09-15, 16 pardus işi / 170 dk, ajan günlüğünden
 * faz ayrıştırması): indirme+exe açma **%29**, Docker derleme **%47**, R2
 * yükleme **%16**. Derleme anında konteyner CPU'su %814,97 — Docker'a verilen 8
 * çekirdeğin 8'i dolu, yani İKİNCİ bir eşzamanlı derleme kazanç getirmez.
 * Boşta kalan güç zamanın ~%45'inde (indirme + yükleme fazları) duruyor.
 *
 * Bu döngü o boşluğu kullanır: iş N derlenirken iş N+1'in kaynağını indirip
 * ajanın okuduğu önbellek yoluna koyar. Ajan o işe geldiğinde indirme fazı
 * (kritik yolun ~%29'u) HIT'e düşer.
 *
 * KRİTİK: ısıtılan adres, ajanın göreceği adresle AYNI olmalı; yoksa
 * `srcVersionTuret` farklı bir anahtar üretir ve HIT hiç gerçekleşmez
 * (2026-09-15 ölçümü: 73436'nın ajan anahtarı `Own_It_1_Workbook…exe`,
 * DB'den elle türetilen anahtar `73429` — ısıtma tamamen boşa gitti).
 * Bu yüzden adresler API'nin `agents/:id/peek` ucundan alınır: o uç `next-job`
 * ile aynı uygunluk/sıra/kaynak-URL kurallarını ve aynı köprü çözümünü
 * kullanır (book-update `services/api/src/lib/ajan-claim-sql.ts`).
 *
 * Güvenlik payları:
 *  - Kiralama YAPMAZ (peek salt okur) → ajanın işini çalmaz.
 *  - Sırayla ısıtır, asla paralel değil → yayıncı origin'i/köprü yorulmaz.
 *  - Her ısıtmadan önce disk kapısı → pardus derlemesinin 20 GB kapısıyla
 *    yarışmaz (15 Eyl: disk 19 GB'a inince iki iş kapıda düştü).
 *  - Ajanın o an derlediği iş peek listesinde ÇIKMAZ (satır 'running' + kira
 *    geçerli), dolayısıyla aynı dosya iki kez indirilmez.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const { EXE_KAYNAGI_KAPALI } = require('./kaynak-karari');

/** Ajanın kayıt dosyasından kimlik okur (runner ile AYNI dosya). */
function kimlikOku(tokenDosyasi) {
  const yol = tokenDosyasi
    || process.env.AGENT_TOKEN_FILE
    || path.join(os.homedir(), '.empp-agent', 'token.json');
  try {
    const p = JSON.parse(fs.readFileSync(yol, 'utf8'));
    if (p && p.agentId && p.token) return { agentId: p.agentId, token: p.token };
  } catch (_) { /* kayıt yok */ }
  return null;
}

function apiTabani() {
  return (process.env.BOOKUPDATE_API || 'https://akillitahta.ndr.ist/api/v1').replace(/\/+$/, '');
}

/**
 * Sıradaki işleri (kiralamadan) sorar.
 * @returns {Promise<Array<{bookId:string, platform:string, downloadUrl:string}>>}
 */
async function siradakileriSor(kimlik, adet, istemci = axios) {
  const url = `${apiTabani()}/agents/${kimlik.agentId}/peek?n=${adet}`;
  const res = await istemci.get(url, {
    headers: { 'x-agent-token': kimlik.token },
    timeout: 30_000,
    validateStatus: () => true,
  });
  if (res.status !== 200 || !res.data || !Array.isArray(res.data.jobs)) return [];
  return res.data.jobs.filter((j) => j && j.bookId && j.downloadUrl);
}

/**
 * Tek tur — KAPALI (exe'siz sözleşme, 01.10): peek YAPILMAZ, hiçbir şey ısıtılmaz.
 * @returns {Promise<{durum:'kapali', sonuc: []}>}
 */
async function birTur({ kayit = () => {} } = {}) {
  kayit(`ısıtıcı turu atlandı: ${EXE_KAYNAGI_KAPALI}`);
  return { durum: 'kapali', sonuc: [] };
}

module.exports = { kimlikOku, siradakileriSor, birTur, apiTabani };

// CLI: node src/agent/isitici-dongu.js — KAPALI (exe'siz sözleşme)
if (require.main === module) {
  console.error(`isitici-dongu: ${EXE_KAYNAGI_KAPALI}`);
  process.exit(0);
}
