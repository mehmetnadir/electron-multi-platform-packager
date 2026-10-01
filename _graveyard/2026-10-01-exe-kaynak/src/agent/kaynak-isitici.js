'use strict';
/**
 * Kaynak ön-ısıtıcısı — KAPALI (exe'siz sözleşme, Nadir 01.10: İmpark exe'si HİÇBİR koşulda
 * indirilmez). Isıttığı şey İmpark exe'sinden açılan build.zip'ti; runner artık bu önbelleği
 * okumuyor (kaynak = arşiv ya da manuel build.zip, kaynak-karari.js). Modül silinmedi: `kaynakIsit`
 * kapıyla HİÇBİR aracı çağırmadan `{durum:'kapali'}` döner, CLI uyarıp çıkar. Aşağıdaki tarihçe
 * bilgi içindir.
 *
 * (Tarihçe) Kaynak ön-ısıtıcısı — ajanın BEKLEMEDEN derlemeye başlamasını sağlıyordu.
 *
 * Ölçüm (2026-09-15, 16 pardus işi / 170 dk, ajan günlüğünden faz ayrıştırması):
 *   indirme+exe açma **%29** · Docker derleme **%47** · R2 yükleme **%16** · diğer %7
 * Derleme anında konteyner CPU'su **%814,97** (Docker'a verilen 8 çekirdeğin 8'i dolu)
 * — yani İKİNCİ bir eşzamanlı derleme aynı çekirdekleri böler, kazanç ~0 olur.
 * Boşta kalan güç, zamanın %45'inde (indirme + yükleme fazları) duruyor.
 *
 * Bu yüzden çözüm "daha çok Docker" değil, BORU HATTI: iş N derlenirken iş N+1'in
 * kaynağı hazırlanır. Isıtıcı bunu AJANIN DIŞINDA yapar (koşan partiyi hiç
 * etkilemez): aynı `downloadFile → extractSfx → findBuildDir → applyPublisherUpdate
 * → zipDir` zincirini çağırıp sonucu ajanın okuduğu önbellek yoluna koyar:
 *
 *     <EMPP_SOURCE_CACHE>/<bookId>/<srcVersionTuret(url)>/build.zip
 *
 * Adımlar ajandan İTHAL edilir (kendi kopyasını yazmak, ajanınkinden farklı bir
 * build.zip üretip paketi sessizce bozardı — bkz. `pakete-giren-motor-kaynagi`).
 *
 * Disk güvenliği: her ısıtma öncesi boş alan ölçülür; eşiğin altındaysa ısıtma
 * ATLANIR (pardus derlemesinin kendi 20 GB kapısına asla rakip olmaz).
 */
const fsp = require('fs/promises');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const { srcVersionTuret } = require('./runner-helpers');
const { EXE_KAYNAGI_KAPALI } = require('./kaynak-karari');

/** Varsayılan disk tabanı (GB): pardus kapısı 20 GB + bir işin geçici alanı. */
const VARSAYILAN_DISK_TABANI_GB = 26;

/** Boş disk (GB) — ölçüm; okunamazsa 0 döner (ısıtma yapılmaz, güvenli taraf). */
function bosDiskGb(yol = os.homedir()) {
  try {
    const cikti = execSync(`df -g ${JSON.stringify(yol)}`, { encoding: 'utf8' });
    const satir = cikti.trim().split('\n').pop().split(/\s+/);
    const deger = Number(satir[3]);
    return Number.isFinite(deger) ? deger : 0;
  } catch {
    return 0;
  }
}

/** Bu kaynak zaten önbellekte mi? */
async function onbellekteVarMi(cacheRoot, bookId, url) {
  const hedef = path.join(cacheRoot, String(bookId), srcVersionTuret(url), 'build.zip');
  try {
    const st = await fsp.stat(hedef);
    return st.size > 0 ? hedef : null;
  } catch {
    return null;
  }
}

/**
 * Tek bir kitabın kaynağını önbelleğe hazırlıyordu — KAPALI (exe'siz sözleşme, 01.10).
 * Hiçbir araç (`arac.downloadFile`/`extractSfx`/`zipDir`) çağrılmaz, önbelleğe yazılmaz.
 * @returns {Promise<{durum:'kapali', sebep:string}>}
 */
async function kaynakIsit({ bookId, kayit = () => {} } = {}) {
  kayit(`ısıtma atlandı (${bookId || '-'}): ${EXE_KAYNAGI_KAPALI}`);
  return { durum: 'kapali', sebep: EXE_KAYNAGI_KAPALI };
}

/**
 * Sırayla (asla paralel DEĞİL — yayıncı origin'i paralel istekte çöküyor,
 * 14 Eyl dersi) verilen işleri ısıtır. Ajan hangi işi alırsa alsın, listedeki
 * kitaplar önbellekte hazır olur.
 */
async function sirayiIsit(isler, secenekler) {
  const sonuc = [];
  for (const is of isler) {
    // eslint-disable-next-line no-await-in-loop
    sonuc.push({ bookId: is.bookId, ...(await kaynakIsit({ ...secenekler, ...is })) });
  }
  return sonuc;
}

module.exports = {
  VARSAYILAN_DISK_TABANI_GB,
  bosDiskGb,
  onbellekteVarMi,
  kaynakIsit,
  sirayiIsit,
};

// CLI: node src/agent/kaynak-isitici.js <bookId>=<url> [<bookId>=<url> ...] — KAPALI (exe'siz sözleşme)
if (require.main === module) {
  console.error(`kaynak-isitici: ${EXE_KAYNAGI_KAPALI}`);
  process.exit(0);
}
