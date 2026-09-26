'use strict';

/**
 * Kaynak arşivi — kuyruğun İmpark exe'si yerine kullandığı onaylı build zip (2026-09-26).
 *
 * Nadir 26.09: "yds'nin yeni arayüzü ile üretilmesini bekliyorum. Neden eski build
 * kullanılıyor?" → Üretim Masası'nın 25.09 yeni arayüzlü build zip'leri dört platformun
 * kaynağıdır (kitap-kaynak-sozlesmesi.md); pipeline'ın İmpark exe'si yalnız geri dönüş.
 * Runner bu arşivde kitabın kaydı varsa exe indirmez, yayıncı güncellemesi uygulamaz
 * (arşiv zip'i son hâldir), srv21 şeridinin hazır pardus paketini devralmaz (o paket
 * İmpark kaynağından üretildi).
 *
 * Düzen: `<kok>/<bookId>/kaynak.json` + zip dosyası.
 *   { "dosya": "build.zip", "md5": "<32 hex>", "boyut": <bayt>, "etiket": "<kısa ad>" }
 * Kök: `EMPP_KAYNAK_ARSIVI` ya da `~/.empp-agent/kaynak-arsivi`.
 *
 * Kayıt var ama zip eksik/boyut ya da md5 tutmuyorsa HATA fırlatılır — sessizce İmpark
 * exe'sine düşmek eski arayüzü yayınlamak demektir (bugünkü arızanın kendisi). md5 her
 * (boyut, mtime) için bir kez hesaplanır, sonucu `.md5-dogrulandi` damgasında durur.
 *
 * BAYAT ARŞİV KAPISI (2026-09-26, Nadir: "İmpark'ta güncelleme atınca paketler otomatik
 * güncellenmeli"). srv21 `publisher-version-refresh.ts` İmpark sürümü artınca (v64→v65)
 * kitabı yeniden kuyruğa alır; arşivli sette runner bu işi ESKİ zip'ten üretirse
 * güncelleme sessizce kaybolur. Bu yüzden kayıt, arşivlendiği andaki İmpark kaynak
 * kimliğini taşır:
 *   "impark_kaynagi": "<exe adı>"   ör. "ShallWe8-v47.exe"
 *   "impark_kaynagi": ["MP11-v48.exe", "MP11-v47.exe"]   (liste: arşivin KAPSADIĞI kaynaklar)
 * Liste, köprünün İmpark'ın gerisinde kaldığı durum içindir (ölçüm 26.09, 45792: zip İmpark
 * v48'den üretildi, köprü hâlâ v47 veriyor). İlk öğe zip'in üretildiği kaynaktır.
 * Kimlik = runner'ın kaynak önbelleğinde ve hazır pardus paketinde kullandığı
 * `srcVersionTuret(job.downloadUrl)` — köprü (R2 akillitahtalar/<id>/) anahtarının adı.
 * Presigned imza/sorgu atılır; aynı dosya yeniden imzalansa da kimlik değişmez.
 * Kıyas EŞİTLİKtir, sıralama değil ("farklıysa bayat"): ad değiştiyse — yükselme, geri
 * dönüş ya da el ile atanmış /sources/ kaynağı — arşiv o kaynağı temsil etmez.
 *   - farklı  → HATA `kaynak arşivi BAYAT: İmpark kaynağı X → Y; build zip yeniden
 *               üretilmeli`. Eski zip'ten üretilmez, İmpark exe'sine de düşülmez.
 *               (Hata runner'ın genel başarısızlık yolundan `bildir paket … -p yuksek
 *               -e warning` ile telefona gider ve satıra last_error olarak yazılır.)
 *   - alan yok → bugünkü davranış sürer; kitap başına süreçte BİR KEZ uyarı loglanır.
 * Kıyas zip/md5 denetiminden ÖNCE yapılır: bayat arşivin 1,5 GB'ı boşuna okunmaz.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { srcVersionTuret } = require('./runner-helpers');

function arsivKoku(env = process.env) {
  return env.EMPP_KAYNAK_ARSIVI || path.join(os.homedir(), '.empp-agent', 'kaynak-arsivi');
}

function md5Hesapla(dosya) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    fs.createReadStream(dosya)
      .on('error', reject)
      .on('data', (p) => h.update(p))
      .on('end', () => resolve(h.digest('hex')));
  });
}

/** Kayıttaki / işteki değeri runner'ın kaynak kimliğine çevirir (ad ya da URL kabul eder). */
function imparkKimligi(deger) {
  return srcVersionTuret(deger);
}

/**
 * `impark_kaynagi` alanını kimlik listesine çevirir. Alan yoksa null; bozuksa HATA.
 * @param {unknown} alan dize ya da boş olmayan dize listesi
 * @returns {string[]|null}
 */
function kayitliKimlikler(alan) {
  if (alan === undefined || alan === null) return null;
  const liste = Array.isArray(alan) ? alan : [alan];
  if (liste.length === 0 || liste.some((d) => typeof d !== 'string' || !d.trim())) {
    throw new Error('kaynak arşivi: impark_kaynagi alanı geçersiz '
      + '(boş olmayan dize ya da dize listesi olmalı)');
  }
  return liste.map((d) => imparkKimligi(d.trim()));
}

/**
 * Arşivin İmpark kimliği ile işin güncel İmpark kimliğini kıyaslar. SAF — I/O yok.
 *
 * @param {unknown} kayitli  kaynak.json `impark_kaynagi` alanı: dize ya da dize listesi
 *                           (yoksa undefined)
 * @param {string} guncel    işin kaynak kimliği — `srcVersionTuret(job.downloadUrl)`
 * @returns {{ durum: 'ayni'|'bayat'|'alan-yok', kayitli: string[]|null, guncel: string }}
 */
function imparkKaynagiKiyasla(kayitli, guncel) {
  const g = String(guncel == null ? '' : guncel).trim();
  if (!g) {
    throw new Error('kaynak arşivi: güncel İmpark kaynağı bilinmiyor — arşiv tazeliği ölçülemedi');
  }
  const gk = imparkKimligi(g);
  const kk = kayitliKimlikler(kayitli);
  if (kk === null) return { durum: 'alan-yok', kayitli: null, guncel: gk };
  return { durum: kk.includes(gk) ? 'ayni' : 'bayat', kayitli: kk, guncel: gk };
}

/** Alanı olmayan kayıt için süreç başına tek uyarı (kök + kitap). */
const alanYokUyarilanlar = new Set();

/**
 * @param {number|string} bookId
 * @param {{ kok?: string, imparkKaynagi?: string, uyar?: (m: string) => void }} [secenekler]
 *   imparkKaynagi: işin güncel İmpark kaynak kimliği
 *   (runner: `srcVersionTuret(job.downloadUrl)`).
 *   Verilmezse tazelik kıyası yapılmaz (yalnız eski çağıranlar/testler için).
 * @returns {Promise<null | { zip: string, md5: string, boyut: number, etiket: string,
 *   srcVersion: string, imparkKaynagi: string[]|null }>}
 *   Kayıt yoksa null; kayıt bozuk ya da BAYAT ise hata.
 */
async function arsivKaynagi(bookId, {
  kok = arsivKoku(),
  imparkKaynagi,
  uyar = (m) => console.warn(m),
} = {}) {
  const dizin = path.join(kok, String(bookId));
  const kayitYolu = path.join(dizin, 'kaynak.json');
  let ham;
  try { ham = await fsp.readFile(kayitYolu, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  let kayit;
  try { kayit = JSON.parse(ham); } catch (e) {
    throw new Error(`kaynak arşivi: ${kayitYolu} okunamadı (JSON): ${e.message}`);
  }
  if (imparkKaynagi !== undefined) {
    const k = imparkKaynagiKiyasla(kayit.impark_kaynagi, imparkKaynagi);
    if (k.durum === 'bayat') {
      throw new Error(
        `kaynak arşivi BAYAT: İmpark kaynağı ${k.kayitli.join(' | ')} → ${k.guncel}; `
        + `build zip yeniden üretilmeli (kitap ${bookId}, ${kayitYolu})`,
      );
    }
    if (k.durum === 'alan-yok') {
      const anahtar = `${kok}::${bookId}`;
      if (!alanYokUyarilanlar.has(anahtar)) {
        alanYokUyarilanlar.add(anahtar);
        uyar(`kaynak arşivi: ${bookId} kaydında impark_kaynagi yok — İmpark `
          + `güncellemesi bu kitapta ALGILANAMAZ (güncel kaynak ${k.guncel}); `
          + `${kayitYolu} dosyasına eklenmeli`);
      }
    }
  }
  const md5 = String(kayit.md5 || '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(md5)) throw new Error(`kaynak arşivi: ${kayitYolu} md5 alanı geçersiz`);
  if (!kayit.dosya || path.basename(kayit.dosya) !== kayit.dosya) {
    throw new Error(`kaynak arşivi: ${kayitYolu} dosya alanı geçersiz (yalnız dosya adı)`);
  }
  const zip = path.join(dizin, kayit.dosya);
  let st;
  try { st = await fsp.stat(zip); } catch (e) {
    throw new Error(`kaynak arşivi: ${bookId} kaydı var ama zip yok (${zip}) — İmpark exe'sine düşülmedi`);
  }
  if (Number(kayit.boyut) !== st.size) {
    throw new Error(`kaynak arşivi: ${bookId} boyut tutmuyor (${st.size} != ${kayit.boyut})`);
  }
  const damga = path.join(dizin, '.md5-dogrulandi');
  const damgaDegeri = `${st.size}:${Math.floor(st.mtimeMs)}:${md5}`;
  let dogrulandi = false;
  try { dogrulandi = (await fsp.readFile(damga, 'utf8')).trim() === damgaDegeri; } catch (_) { /* damga yok */ }
  if (!dogrulandi) {
    const gercek = await md5Hesapla(zip);
    if (gercek !== md5) throw new Error(`kaynak arşivi: ${bookId} md5 tutmuyor (${gercek} != ${md5})`);
    try { await fsp.writeFile(damga, damgaDegeri + '\n'); } catch (_) { /* damga yazılamazsa her iş yeniden hesaplar */ }
  }
  return {
    zip,
    md5,
    boyut: st.size,
    etiket: String(kayit.etiket || ''),
    srcVersion: `arsiv-${md5.slice(0, 12)}`,
    imparkKaynagi: kayitliKimlikler(kayit.impark_kaynagi),
  };
}

module.exports = { arsivKaynagi, arsivKoku, md5Hesapla, imparkKaynagiKiyasla };
