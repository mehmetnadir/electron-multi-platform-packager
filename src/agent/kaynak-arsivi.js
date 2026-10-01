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
 * İMPARK EXE ADI YALNIZ BİLGİDİR — "ad kapısı" KALDIRILDI (Nadir 27.09: "v47 → v51 gibi isim
 * güncellemesi metodu çok kırılgan (insanlar unutabiliyor), kullanmak istemiyorum").
 * 26.09'daki "bayat arşiv kapısı" kayıttaki `impark_kaynagi`yı (arşivlendiği andaki köprü exe adı,
 * ör. "ShallWe8-v47.exe", ya da kapsanan adlar listesi) işin güncel exe adıyla
 * (`srcVersionTuret(job.downloadUrl)`) kıyaslıyor, farkta işi "build zip yeniden üretilmeli" diye
 * düşürüyordu. Ad içerik sürümü DEĞİLDİR (ölçüm 27.09):
 *   - ad, İmpark set kaydının `S_TestKitaplar.Adi` alanından gelir ("ShallWe8-v51") — insanın elle
 *     yazdığı AD; unutulabilir, içerik değişmeden de artar (aktivasyon/lisans değişikliği);
 *   - 45482 android bu kapıda düştü, oysa içerik merdiveni aynı işte alt kitapları İmpark'ın
 *     ZipVersiyon'una göre zaten güncelliyordu.
 * Güncellik YALNIZ İÇERİK sürümüyle ölçülür:
 *   kaynak           alt kitap başına ZipVersiyon (+ZKitapFileSize), `GetKitapGuncellemeBilgi`;
 *   üretimde         içerik merdiveni S0/S1 (icerik-merdiven.js, `EMPP_ARSIV_MERDIVEN=1`);
 *   yüklemeden önce  kabul E7/K4/SET_TUM (`KABUL_K4`, `KABUL_SET_TUM`; Pardus K18 rc 3).
 * `impark_kaynagi` kayıtta BİLGİ olarak kalır: ad farklıysa iş başına tek log satırı
 * ("İmpark exe adı değişti (bilgi) — güncellik içerik merdiveninden ölçülür"), iş SÜRER. Alan
 * yok ya da bozuk da yalnız bilgidir (karar yok → hata yok). Zip/boyut/md5 denetimleri AYNEN.
 * MERDİVEN KAPALIYKEN (EMPP_ARSIV_MERDIVEN≠1) de ad kıyası YOK: ad içerik hakkında hiçbir şey
 * ölçmediği için kapalı merdivenin yerini tutamaz (içerik aynıyken yanlış alarm verir, ad
 * değişmeden gelen ZipVersiyon güncellemesini kaçırır). Arşiv zip'i olduğu gibi paketlenir; geride
 * içerik yüklemeden önce kabul K4/SET_TUM'da (GÜNCEL-DEĞİL rc 3 → yükleme yok, `failed`) ya da
 * Pardus K18'de yakalanır. Nöbetçi: kaynak-arsivi.test.js "AD SÜRÜMÜ KARAR DEĞİL".
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
 * `impark_kaynagi` BİLGİ alanını kimlik listesine çevirir. Karar VERMEZ, hata FIRLATMAZ: alan yok
 * ya da biçimi bozuksa null (27.09'dan beri yalnız bilgidir, başlık yorumu).
 * @param {unknown} alan dize ya da dize listesi
 * @returns {string[]|null}
 */
function imparkKaynagiBilgisi(alan) {
  if (alan === undefined || alan === null) return null;
  const liste = Array.isArray(alan) ? alan : [alan];
  if (liste.length === 0 || liste.some((d) => typeof d !== 'string' || !d.trim())) return null;
  return liste.map((d) => imparkKimligi(d.trim()));
}

/**
 * Bilgi notu: kayıttaki İmpark exe adı işin exe adından farklıysa tek satır, değilse null.
 * SAF — I/O yok, KARAR YOK: dönüş yalnız loglanır, iş her durumda sürer.
 * @param {unknown} kayitli  kaynak.json `impark_kaynagi` (dize, liste ya da yok)
 * @param {unknown} guncel   işin exe kimliği — `srcVersionTuret(job.downloadUrl)`
 * @returns {string|null}
 */
function imparkAdiNotu(kayitli, guncel) {
  const g = String(guncel == null ? '' : guncel).trim();
  const kk = imparkKaynagiBilgisi(kayitli);
  if (!g || !kk) return null;
  const gk = imparkKimligi(g);
  if (kk.includes(gk)) return null;
  return `İmpark exe adı değişti (bilgi) — ${kk.join(' | ')} → ${gk}; `
    + 'güncellik içerik merdiveninden ölçülür';
}

/**
 * @param {number|string} bookId
 * @param {{ kok?: string, imparkKaynagi?: string, bilgi?: (m: string) => void }} [secenekler]
 *   imparkKaynagi: işin İmpark exe kimliği (runner: `srcVersionTuret(job.downloadUrl)`) —
 *   YALNIZ bilgi notu için; güncellik kararı vermez.
 * @returns {Promise<null | { zip: string, md5: string, boyut: number, etiket: string,
 *   srcVersion: string, imparkKaynagi: string[]|null }>}
 *   Kayıt yoksa null; kayıt bozuksa (JSON/md5/dosya/boyut) hata.
 */
async function arsivKaynagi(bookId, {
  kok = arsivKoku(),
  imparkKaynagi,
  bilgi = (m) => console.log(m),
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
  const adNotu = imparkAdiNotu(kayit.impark_kaynagi, imparkKaynagi);
  if (adNotu) bilgi(`kaynak arşivi ${bookId}: ${adNotu}`);
  return {
    zip,
    md5,
    boyut: st.size,
    etiket: String(kayit.etiket || ''),
    srcVersion: `arsiv-${md5.slice(0, 12)}`,
    imparkKaynagi: imparkKaynagiBilgisi(kayit.impark_kaynagi),
    // Dalga B: R2 build'inin önbelleğiyse sürümü (yoksa null = Üretim Masası'nın elle yazdığı kayıt).
    r2Surum: typeof kayit.r2Surum === 'string' && kayit.r2Surum ? kayit.r2Surum : null,
  };
}

// ---------------------------------------------------------------------------
// DALGA B (B4, exe'siz sözleşme §5 "Mac arşivi R2'nin yerel önbelleği; R2'deki geçerli sürümden
// tazelenir"). `r2-al` ile inen (ve `r2-kur`'da R2'ye yazılan) build arşive `kaynak.json` +
// `r2Surum` + `sha256` alanlarıyla yazılır. Kural:
//   - `r2Onbellek`: kayıt `r2Surum` = istenen sürüm VE sha256/boyut claim'le aynıysa zip yerelden
//     kullanılır (1–3 GB indirme yok). Farklı sürüm / `r2Surum`'suz kayıt → ıska → indirilir ve
//     `r2ArsiveYaz` kaydı TAZELER.
//   - `r2Surum`'suz kayıt (Üretim Masası'nın elle yazdığı) YALNIZ taban olur (`r2-kur`), hiçbir
//     zaman `r2-al` önbelleği sayılmaz.
// Arşiv önbellektir: okuma/yazma hatası işi DÜŞÜRMEZ (ıska / uyarı). Hiçbir dosya silinmez — zip
// aynı adla (`build.zip`) rename ile değişir, eski farklı adlı zip yerinde kalır.
// ---------------------------------------------------------------------------

/** md5 + sha256 + boyut TEK geçişte (1–3 GB zip iki kez okunmasın). */
function ikiOzet(dosya) {
  return new Promise((resolve, reject) => {
    const m = crypto.createHash('md5');
    const s = crypto.createHash('sha256');
    let boyut = 0;
    fs.createReadStream(dosya)
      .on('error', reject)
      .on('data', (p) => { m.update(p); s.update(p); boyut += p.length; })
      .on('end', () => resolve({ md5: m.digest('hex'), sha256: s.digest('hex'), boyut }));
  });
}

const SHA_DAMGA = '.sha256-dogrulandi';
const damgaDegeri = (st, ozet) => `${st.size}:${Math.floor(st.mtimeMs)}:${ozet}`;

/**
 * `r2-al` önbellek okuması. FIRLATMAZ — ıska/hata null.
 * @param {number|string} bookId
 * @param {{ surum: string, sha256: string, boyut?: number|null, kok?: string, bilgi?: Function }} o
 * @returns {Promise<null | { zip: string, sha256: string, boyut: number, r2Surum: string }>}
 */
async function r2Onbellek(bookId, { surum, sha256, boyut = null, kok = arsivKoku(), bilgi = () => {} } = {}) {
  const dizin = path.join(kok, String(bookId));
  try {
    const kayit = JSON.parse(await fsp.readFile(path.join(dizin, 'kaynak.json'), 'utf8'));
    if (!kayit.r2Surum) {
      bilgi(`kaynak arşivi ${bookId}: kayıt r2Surum'suz (elle yazılmış) — r2-al önbelleği sayılmaz, indirilecek`);
      return null;
    }
    if (kayit.r2Surum !== surum || String(kayit.sha256 || '') !== sha256) {
      bilgi(`kaynak arşivi ${bookId}: önbellek ${kayit.r2Surum} ≠ geçerli ${surum} — tazelenecek`);
      return null;
    }
    if (!kayit.dosya || path.basename(kayit.dosya) !== kayit.dosya) return null;
    const zip = path.join(dizin, kayit.dosya);
    const st = await fsp.stat(zip);
    if (Number(kayit.boyut) !== st.size || (boyut != null && st.size !== boyut)) {
      bilgi(`kaynak arşivi ${bookId}: önbellek boyutu tutmuyor (${st.size}) — tazelenecek`);
      return null;
    }
    let damga = '';
    try { damga = (await fsp.readFile(path.join(dizin, SHA_DAMGA), 'utf8')).trim(); } catch (_) { /* yok */ }
    if (damga !== damgaDegeri(st, sha256)) {
      const oz = await ikiOzet(zip);
      if (oz.sha256 !== sha256) {
        bilgi(`kaynak arşivi ${bookId}: önbellek sha256 tutmuyor — tazelenecek`);
        return null;
      }
      try { await fsp.writeFile(path.join(dizin, SHA_DAMGA), `${damgaDegeri(st, sha256)}\n`); } catch (_) { /* her seferinde hesaplanır */ }
    }
    return { zip, sha256, boyut: st.size, r2Surum: kayit.r2Surum };
  } catch (e) {
    if (e && e.code !== 'ENOENT') bilgi(`kaynak arşivi ${bookId}: önbellek okunamadı (${e.message}) — indirilecek`);
    return null;
  }
}

/**
 * Doğrulanmış R2 build'ini arşive yazar (klon kopya → rename; sonra damgalar; EN SON kaynak.json
 * rename — kayıt yeni zip'i ancak zip yerindeyken gösterir). FIRLATMAZ.
 * @param {number|string} bookId
 * @param {string} kaynakZip doğrulanmış zip (kopyalanır, taşınmaz)
 * @param {{ surum: string, md5: string, sha256: string, boyut: number, kok?: string, uyari?: Function }} o
 * @returns {Promise<boolean>}
 */
async function r2ArsiveYaz(bookId, kaynakZip, {
  surum, md5, sha256, boyut, kok = arsivKoku(), uyari = (m) => console.warn(m),
} = {}) {
  const dizin = path.join(kok, String(bookId));
  const ek = `.tmp-${process.pid}-${Date.now()}`;
  try {
    await fsp.mkdir(dizin, { recursive: true });
    const geciciZip = path.join(dizin, `build.zip${ek}`);
    await fsp.copyFile(kaynakZip, geciciZip, fs.constants.COPYFILE_FICLONE);
    const zip = path.join(dizin, 'build.zip');
    await fsp.rename(geciciZip, zip);
    const st = await fsp.stat(zip);
    if (st.size !== boyut) throw new Error(`kopya boyutu ${st.size} ≠ ${boyut}`);
    await fsp.writeFile(path.join(dizin, '.md5-dogrulandi'), `${damgaDegeri(st, md5)}\n`);
    await fsp.writeFile(path.join(dizin, SHA_DAMGA), `${damgaDegeri(st, sha256)}\n`);
    const kayit = {
      dosya: 'build.zip', md5, boyut, etiket: `r2-${surum}`, r2Surum: surum, sha256,
      yazilma: new Date().toISOString(),
    };
    const geciciJson = path.join(dizin, `kaynak.json${ek}`);
    await fsp.writeFile(geciciJson, `${JSON.stringify(kayit, null, 2)}\n`);
    await fsp.rename(geciciJson, path.join(dizin, 'kaynak.json'));
    return true;
  } catch (e) {
    uyari(`kaynak arşivi ${bookId}: R2 build ${surum} arşive yazılamadı (önbellek, iş sürer): ${e.message}`);
    return false;
  }
}

/**
 * Arşivin KİMLİK özeti (2026-09-26, ProBook şeridi): `<id> <md5> <boyut>` satırları sıralı,
 * sha256'nın ilk 16 hanesi. Zip OKUNMAZ — yalnız kaynak.json kayıtları (ucuz, her nabızda). İki
 * makinenin özeti eşitse aynı kitaplar aynı zip'ten üretilir. `impark_kaynagi` 27.09'dan beri
 * özete GİRMEZ: yalnız bilgidir, üretimi değiştirmez; ad farkı şerit kararına (ProBook'u
 * duraklatmaya) taşınmaz. Kayıt bozuksa (JSON) satır `<id> BOZUK` olur (fark görünür kalsın,
 * sessizce düşmesin). Kök yoksa/boşsa: 'bos'.
 * @param {string} [kok]
 * @returns {{ ozet: string, adet: number, kitaplar: string[] }}
 */
function arsivOzeti(kok = arsivKoku()) {
  let adlar = [];
  try { adlar = fs.readdirSync(kok, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (_) { adlar = []; }
  const satirlar = [];
  for (const ad of adlar.sort()) {
    let ham;
    try { ham = fs.readFileSync(path.join(kok, ad, 'kaynak.json'), 'utf8'); } catch (_) { continue; } // kayıt yok = arşivde değil
    try {
      const k = JSON.parse(ham);
      satirlar.push(`${ad} ${String(k.md5 || '').toLowerCase()} ${Number(k.boyut) || 0}`);
    } catch (_) {
      satirlar.push(`${ad} BOZUK`);
    }
  }
  if (!satirlar.length) return { ozet: 'bos', adet: 0, kitaplar: [] };
  const ozet = crypto.createHash('sha256').update(satirlar.join('\n')).digest('hex').slice(0, 16);
  return { ozet, adet: satirlar.length, kitaplar: satirlar.map((l) => l.split(' ')[0]) };
}

module.exports = {
  arsivKaynagi, arsivKoku, md5Hesapla, imparkAdiNotu, imparkKaynagiBilgisi, arsivOzeti,
  ikiOzet, r2Onbellek, r2ArsiveYaz,
};
