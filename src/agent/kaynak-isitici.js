'use strict';
/**
 * Kaynak ön-ısıtıcısı — ajanın BEKLEMEDEN derlemeye başlamasını sağlar.
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
const { applyPublisherUpdate } = require('./publisher-update');

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
 * Tek bir kitabın kaynağını önbelleğe hazırlar.
 * @returns {Promise<{durum:'zaten'|'isitildi'|'disk'|'hata', yol?:string, hata?:string}>}
 */
async function kaynakIsit({ bookId, downloadUrl, cacheRoot, diskTabaniGb = VARSAYILAN_DISK_TABANI_GB, arac, kayit = () => {} }) {
  const { downloadFile, extractSfx, findBuildDir, zipDir } = arac;

  const varOlan = await onbellekteVarMi(cacheRoot, bookId, downloadUrl);
  if (varOlan) {
    kayit(`ısıtma atlandı (zaten önbellekte): ${bookId}`);
    return { durum: 'zaten', yol: varOlan };
  }

  const bos = bosDiskGb(cacheRoot);
  if (bos < diskTabaniGb) {
    kayit(`ısıtma atlandı (disk ${bos} GB < ${diskTabaniGb} GB): ${bookId}`);
    return { durum: 'disk' };
  }

  const gecici = await fsp.mkdtemp(path.join(os.tmpdir(), 'empp-isit-'));
  try {
    const exePath = path.join(gecici, 'source.exe');
    kayit(`ısıtma başladı: ${bookId}`);
    await downloadFile(downloadUrl, exePath);

    const extractDir = path.join(gecici, 'extracted');
    await extractSfx(exePath, extractDir);
    const buildDir = await findBuildDir(extractDir);

    try {
      applyPublisherUpdate(buildDir);
    } catch (e) {
      kayit(`yayıncı güncellemesi uygulanamadı (${bookId}): ${e.message}`);
    }

    const zipPath = path.join(gecici, 'build.zip');
    await zipDir(buildDir, zipPath);

    const hedefDizin = path.join(cacheRoot, String(bookId), srcVersionTuret(downloadUrl));
    await fsp.mkdir(hedefDizin, { recursive: true });
    const hedef = path.join(hedefDizin, 'build.zip');
    // Atomik yerleştirme: ajan yarım dosyayı HIT sanmasın.
    const tmp = `${hedef}.tmp-${process.pid}`;
    await fsp.copyFile(zipPath, tmp);
    await fsp.rename(tmp, hedef);
    const mb = Math.round((await fsp.stat(hedef)).size / 1e6);
    kayit(`ısıtıldı: ${bookId} (${mb} MB) → ${hedef}`);
    return { durum: 'isitildi', yol: hedef };
  } catch (e) {
    kayit(`ısıtma HATA (${bookId}): ${e.message}`);
    return { durum: 'hata', hata: e.message };
  } finally {
    await fsp.rm(gecici, { recursive: true, force: true }).catch(() => {});
  }
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

// CLI: node src/agent/kaynak-isitici.js <bookId>=<url> [<bookId>=<url> ...]
if (require.main === module) {
  const girdiler = process.argv.slice(2).map((p) => {
    const i = p.indexOf('=');
    return { bookId: p.slice(0, i), downloadUrl: p.slice(i + 1) };
  });
  const cacheRoot = process.env.EMPP_SOURCE_CACHE || path.join(os.homedir(), '.empp-agent', 'cache');
  if (!fs.existsSync(cacheRoot)) fs.mkdirSync(cacheRoot, { recursive: true });
  const arac = require('./runner');
  sirayiIsit(girdiler, {
    cacheRoot,
    arac,
    diskTabaniGb: Number(process.env.ISITICI_DISK_TABANI_GB || VARSAYILAN_DISK_TABANI_GB),
    kayit: (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`),
  }).then((s) => {
    const say = s.reduce((a, r) => ({ ...a, [r.durum]: (a[r.durum] || 0) + 1 }), {});
    console.log('ÖZET', JSON.stringify(say));
  });
}
