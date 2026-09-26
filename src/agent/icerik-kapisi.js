'use strict';

/**
 * İÇERİKSİZ KAYNAK KAPISI (2026-09-26) — bkz. `~/.empp-agent/arastirma/set-koku-ezilmis-kok-neden-20260926.md`.
 *
 * NEDEN: 11845 (Super Monsters 3 Set) İmpark canlısındaki `SM3-v49.exe` yalnız MOTORU
 * taşıyordu — kökte `assets/` yoktu, hiç `bookN/` dizini yoktu. Bizim işleme adımlarımızdan
 * (`publisher-update.js`, `set-menu.js`, `kok-index-denetimi.js`) HİÇBİRİ kitap içeriğini
 * ezmedi; kaynağın kendisinde içerik hiç yoktu. Yine de paket üretilip ProBook'a kadar
 * gitti (91 sn kabul + notarize boşa harcandı) ve RED sonucu geç, pahalı geldi; canlıda da
 * içeriksiz mac/apk yayınlandı (11845, 45551-v50).
 *
 * BU MODÜLÜN İŞİ: kaynak açıldıktan (extractSfx/findBuildDir) hemen SONRA, paketlemeye
 * (zipDir/upload) GİRMEDEN önce kökte gerçek kitap içeriği olup olmadığını ölçmek.
 *   - Tek kitap kaynağı kökte `assets/<id>/...` taşır.
 *   - SET kaynağı kökte `book1/`, `book2/`, … (`book\d+`) dizinleri taşır.
 *   - İkisi de yoksa kaynak yalnız motor/okuyucu kabuğudur — iş GÖRÜNÜR hata ile düşer,
 *     paketlemeye hiç girilmez, R2'ye hiçbir şey yüklenmez.
 *
 * `degerlendir` SAF fonksiyondur (dosya sistemine dokunmaz) — testte sentetik bayraklarla
 * çağrılır. `dizinTara`/`icerikKapisiDenetle` gerçek dizini okuyan ince sarmalayıcıdır.
 *
 * ZIP YOLU (2026-09-26, entegrasyon bulgusu): yukarıdaki dizin denetimi yalnız TAZE İNDİRME
 * yolunda (extractSfx/findBuildDir) çalışır. Kaynak arşivi (`arsivKaynagi`) ve kaynak önbelleği
 * HIT'i (`cachedZip`) zip'i HİÇ AÇMADAN doğrudan paketleyiciye taşır — bu iki yolda kapı hiç
 * devreye girmiyordu. 45550/45551/11845'in içeriksiz `build.zip`'leri tam bu iki yoldan (arşiv
 * ya da önbellek) HIT olsaydı kapı atlanır, içeriksiz paket yine üretilirdi. `girisListesindenDegerlendir`/
 * `icerikKapisiDenetleZip` aynı [kaynak-iceriksiz] kuralını zip'in MERKEZ DİZİNİNDEN (adm-zip,
 * sıkıştırılmış içeriği açmadan) uygular — `extractSfx`'in "çıkarma bir sarmalayıcı dizin
 * ekleyebilir" toleransını (`findBuildDir`) taklit eder: kökte assets/bookN yoksa VE tüm
 * girdiler TEK bir üst klasör altındaysa bir seviye iner.
 *
 * BAĞIMLILIK KURALI: dizin yolu yalnız Node stdlib; zip yolu `adm-zip` (depoda zaten
 * bağımlılık — `src/services/uploadService.js` aynı `getEntries()`/`entryName` desenini
 * kullanır, kopya tanım değil aynı kütüphane).
 */

const fsp = require('fs/promises');
const AdmZip = require('adm-zip');

const KAPI_ISARETI = '[kaynak-iceriksiz]';

/**
 * KAPATMA ANAHTARI (2026-09-26, koordinatör ek isi): kapı canlıda yanlış-RED üretirse
 * (ölçülmemiş bir tek-kitap/SET konvansiyonu — ne `assets/` ne `bookN/` kullanan meşru
 * bir kaynak) TÜM üretim durur. `EMPP_ICERIK_KAPISI`: tanımsız ya da `1` (ya da başka
 * herhangi bir "açık" değer) = AÇIK (bugünkü davranış); `0`/`false`/`kapali`/`kapalı` =
 * KAPALI — kapı hiç çalışmaz, iş her zaman geçer, tek satır log düşer.
 */
function acikMi(env = process.env) {
  const ham = env.EMPP_ICERIK_KAPISI;
  if (ham === undefined || ham === null || ham === '') return true;
  const s = String(ham).trim().toLowerCase();
  return !(s === '0' || s === 'false' || s === 'kapali' || s === 'kapalı');
}

/** Kök dizin girdisi bir SET kitap dizini mi? (`book1`, `book12`, büyük/küçük harf duyarsız). */
function bookNMi(adi) {
  return /^book\d+$/i.test(String(adi || ''));
}

/**
 * Saf değerlendirme: kökte `assets/` ya da en az bir `bookN/` dizini varsa geçer.
 *
 * @param {{ hasAssets?: boolean, hasBookN?: boolean, kaynakAdi?: string }} [girdi]
 * @returns {{ gecti: boolean, sebep: string|null }}
 */
function degerlendir({ hasAssets = false, hasBookN = false, kaynakAdi = '' } = {}) {
  if (hasAssets || hasBookN) return { gecti: true, sebep: null };
  const etiket = kaynakAdi ? ` <${kaynakAdi}>` : '';
  return {
    gecti: false,
    sebep: `${KAPI_ISARETI} bookN 0, assets/ yok — İmpark exe'si ince${etiket} `
      + '(motor var, kitap içeriği yok; İmpark SET exe yeniden oluşturulmalı)',
  };
}

/**
 * `kok` dizininin KÖK seviyesini tarar (recursive değil — kural kökte aranır, rapor da
 * kök seviyesini ölçüyor). Dizin okunamazsa (yok/erişilemez) ikisi de `false` döner —
 * `degerlendir` bunu da içeriksiz sayar (paketlenecek hiçbir şey yoksa geçmemeli).
 *
 * @param {string} kok
 * @returns {Promise<{ hasAssets: boolean, hasBookN: boolean }>}
 */
async function dizinTara(kok) {
  let girdiler = [];
  try {
    girdiler = await fsp.readdir(kok, { withFileTypes: true });
  } catch (_) {
    girdiler = [];
  }
  const hasAssets = girdiler.some((g) => g.isDirectory() && g.name === 'assets');
  const hasBookN = girdiler.some((g) => g.isDirectory() && bookNMi(g.name));
  return { hasAssets, hasBookN };
}

/**
 * Çağrı noktası: `dizinTara` + `degerlendir`i sarar. Kapatma anahtarı KAPALI ise
 * (bkz. `acikMi`) tarama hiç yapılmaz, iş her zaman GEÇER — `log` ile tek satır düşülür.
 *
 * @param {string} kok build dizini (extractSfx/findBuildDir çıktısı)
 * @param {{ kaynakAdi?: string, env?: object, log?: (s: string) => void }} [secenekler]
 * @returns {Promise<{ gecti: boolean, sebep: string|null }>}
 */
async function icerikKapisiDenetle(kok, { kaynakAdi = '', env = process.env, log = () => {} } = {}) {
  if (!acikMi(env)) {
    log('icerik-kapisi KAPALI (env) — kaynak denetlenmedi, geçti sayıldı');
    return { gecti: true, sebep: null };
  }
  const tarama = await dizinTara(kok);
  return degerlendir({ ...tarama, kaynakAdi });
}

/** Bir yol listesindeki kök seviyeyi (ilk `/` öncesi segment) tarar. Saf. */
function yolListesiTara(yollar) {
  let hasAssets = false;
  let hasBookN = false;
  for (const y of yollar) {
    const ilkSegment = String(y || '').split('/')[0];
    if (!ilkSegment) continue;
    if (ilkSegment === 'assets') hasAssets = true;
    if (bookNMi(ilkSegment)) hasBookN = true;
  }
  return { hasAssets, hasBookN };
}

/**
 * Zip GİRİŞ ADLARI listesinden (dizin/dosya farksız — `entryName` düz yol dizisi) içerik
 * kapısını SAF olarak değerlendirir. Kökte assets/bookN yoksa VE bütün girdiler TEK bir üst
 * klasör altındaysa (extractSfx'in ekleyebileceği sarmalayıcı — `findBuildDir`'in tolere
 * ettiği aynı durum) bir seviye inip yeniden dener. I/O yok — testte sentetik dizilerle çağrılır.
 *
 * @param {string[]} girisler zip'teki TÜM giriş adları (`entryName`, `\` de kabul edilir)
 * @param {{ kaynakAdi?: string }} [secenekler]
 * @returns {{ gecti: boolean, sebep: string|null }}
 */
function girisListesindenDegerlendir(girisler, { kaynakAdi = '' } = {}) {
  const yollar = (girisler || [])
    .map((g) => String(g || '').replace(/\\/g, '/').replace(/^\/+/, ''))
    .filter(Boolean);

  let sonuc = yolListesiTara(yollar);
  if (!sonuc.hasAssets && !sonuc.hasBookN) {
    // Sarmalayıcı ihtimali: TEK bir kök segment altında mı hepsi?
    const kokSegmentler = new Set(yollar.map((y) => y.split('/')[0]).filter(Boolean));
    if (kokSegmentler.size === 1) {
      const [tekKok] = kokSegmentler;
      const onEk = `${tekKok}/`;
      const icYollar = yollar
        .filter((y) => y.startsWith(onEk))
        .map((y) => y.slice(onEk.length))
        .filter(Boolean);
      if (icYollar.length) sonuc = yolListesiTara(icYollar);
    }
  }
  return degerlendir({ ...sonuc, kaynakAdi });
}

/**
 * Zip dosyasının giriş adlarını (`entryName`) okur — `adm-zip` yalnız MERKEZ DİZİNİ okur,
 * hiçbir girişi açmaz/çıkarmaz (büyük zip'te de hızlı). Saf değil (I/O) ama senkron ve yerel —
 * dış süreç/zaman aşımı gerekmez.
 *
 * @param {string} zipYolu
 * @returns {string[]}
 */
function zipGirisAdlariniOku(zipYolu) {
  const zip = new AdmZip(zipYolu);
  return zip.getEntries().map((e) => e.entryName);
}

/**
 * Çağrı noktası (arşiv/önbellek HIT yolu): zip'i AÇMADAN `girisListesindenDegerlendir`i
 * uygular. Zip okunamazsa (bozuk/yok/erişilemez) içeriksiz SAYILIR — paketlenecek
 * doğrulanabilir bir şey yoksa sessizce geçmek `dizinTara`'nın aynı ilkesini ihlal eder.
 * Kapatma anahtarı KAPALI ise (bkz. `acikMi`) zip hiç açılmaz, iş her zaman GEÇER.
 *
 * @param {string} zipYolu
 * @param {{ kaynakAdi?: string, env?: object, log?: (s: string) => void }} [secenekler]
 * @returns {Promise<{ gecti: boolean, sebep: string|null }>}
 */
async function icerikKapisiDenetleZip(zipYolu, { kaynakAdi = '', env = process.env, log = () => {} } = {}) {
  if (!acikMi(env)) {
    log('icerik-kapisi KAPALI (env) — zip denetlenmedi, geçti sayıldı');
    return { gecti: true, sebep: null };
  }
  let girisler;
  try {
    girisler = zipGirisAdlariniOku(zipYolu);
  } catch (e) {
    return degerlendir({ hasAssets: false, hasBookN: false, kaynakAdi });
  }
  return girisListesindenDegerlendir(girisler, { kaynakAdi });
}

module.exports = {
  KAPI_ISARETI,
  acikMi,
  bookNMi,
  degerlendir,
  dizinTara,
  icerikKapisiDenetle,
  yolListesiTara,
  girisListesindenDegerlendir,
  zipGirisAdlariniOku,
  icerikKapisiDenetleZip,
};
