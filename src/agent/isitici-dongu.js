'use strict';
/**
 * Kaynak ön-ısıtma döngüsü — ajanın DIŞINDA, ayrı süreç.
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

const { sirayiIsit, VARSAYILAN_DISK_TABANI_GB } = require('./kaynak-isitici');

const VARSAYILAN_ARALIK_MS = 60_000;
const VARSAYILAN_ADET = 2;

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
 * Tek tur: sıradakileri sor, sırayla ısıt, özet döndür.
 * Ağ/API hatası turu düşürür ama süreci ÖLDÜRMEZ — parti etkilenmemeli.
 */
async function birTur({ kimlik, adet, cacheRoot, arac, kayit, istemci, diskTabaniGb }) {
  let isler = [];
  try {
    isler = await siradakileriSor(kimlik, adet, istemci);
  } catch (e) {
    kayit(`peek hatası (tur atlandı): ${e.message}`);
    return { durum: 'peek-hata', sonuc: [] };
  }
  if (isler.length === 0) return { durum: 'bos', sonuc: [] };

  const sonuc = await sirayiIsit(
    isler.map((j) => ({ bookId: String(j.bookId), downloadUrl: j.downloadUrl })),
    { cacheRoot, arac, kayit, diskTabaniGb },
  );
  return { durum: 'tur', sonuc };
}

module.exports = { kimlikOku, siradakileriSor, birTur, apiTabani };

// CLI: node src/agent/isitici-dongu.js
if (require.main === module) {
  const kayit = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
  const kimlik = kimlikOku();
  if (!kimlik) {
    console.error('HATA: ajan kaydı yok (token.json okunamadı) — ısıtıcı başlatılmadı.');
    process.exit(1);
  }
  const cacheRoot = process.env.EMPP_SOURCE_CACHE
    || path.join(os.homedir(), '.empp-agent', 'cache');
  fs.mkdirSync(cacheRoot, { recursive: true });

  const adet = Number(process.env.ISITICI_ADET || VARSAYILAN_ADET);
  const aralik = Number(process.env.ISITICI_ARALIK_MS || VARSAYILAN_ARALIK_MS);
  const diskTabaniGb = Number(process.env.ISITICI_DISK_TABANI_GB || VARSAYILAN_DISK_TABANI_GB);
  const arac = require('./runner');

  kayit(`ısıtıcı başladı — api=${apiTabani()} adet=${adet} aralık=${aralik}ms önbellek=${cacheRoot}`);

  let duruyor = false;
  const dur = () => { duruyor = true; kayit('kapanış istendi, tur bitince çıkılacak.'); };
  process.on('SIGINT', dur);
  process.on('SIGTERM', dur);

  (async () => {
    while (!duruyor) {
      const { durum, sonuc } = await birTur({
        kimlik, adet, cacheRoot, arac, kayit, diskTabaniGb,
      });
      if (durum === 'tur' && sonuc.length) {
        const say = sonuc.reduce((a, r) => ({ ...a, [r.durum]: (a[r.durum] || 0) + 1 }), {});
        kayit(`tur özeti ${JSON.stringify(say)}`);
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, aralik));
    }
    kayit('ısıtıcı durdu.');
  })();
}
