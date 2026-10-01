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
 * `icerikKapisiDenetleZip` aynı [kaynak-iceriksiz] kuralını zip'in MERKEZ DİZİNİNDEN (`unzip -Z1`,
 * sıkıştırılmış içeriği açmadan) uygular — `extractSfx`'in "çıkarma bir sarmalayıcı dizin
 * ekleyebilir" toleransını (`findBuildDir`) taklit eder: kökte assets/bookN yoksa VE tüm
 * girdiler TEK bir üst klasör altındaysa bir seviye iner.
 *
 * ZIP OKUMA = `unzip -Z1` (exe'siz inceleme 01.10, KRİTİK): eskiden `new AdmZip(yol)` kullanılıyordu —
 * adm-zip dosyanın TAMAMINI belleğe okur; 2 GiB üstü zip'te `ERR_FS_FILE_TOO_LARGE` fırlatıyor, hata
 * yutulup kaynak "içeriksiz" sayılıyor ve iş `failed` oluyordu. `unzip -Z1` yalnız merkez dizini
 * okur (ZIP64 dahil), belleğe dosya almaz. Okunamayan zip artık AYRI sebeple ([kaynak-okunamadi])
 * düşer — "içeriksiz" (motor-only kaynak) teşhisiyle karışmaz.
 *
 * FINDER ZIP'İ (01.10): macOS "Sıkıştır" `__MACOSX/` (AppleDouble `._*`) girişleri ekler; bunlar
 * içerik değildir — kök/sarmalayıcı kararında YOK SAYILIR (`girisleriTemizle`).
 */

const fsp = require('fs/promises');
const { spawnSync } = require('child_process');

const KAPI_ISARETI = '[kaynak-iceriksiz]';
/** Zip'in giriş listesi OKUNAMADI (bozuk/kesik/yok) — içeriksizlikten ayrı teşhis. */
const OKUNAMADI_ISARETI = '[kaynak-okunamadi]';

/** Finder/AppleDouble artığı mı? (`__MACOSX/…` ya da herhangi bir seviyede `._ad`) */
function macosArtigiMi(yol) {
  const y = String(yol || '').replace(/\\/g, '/');
  return /^__MACOSX(\/|$)/.test(y) || /(^|\/)\._[^/]*$/.test(y) || /(^|\/)\.DS_Store$/.test(y);
}

/** Giriş adlarını normalleştirir (`\\` → `/`, baştaki `/` atılır) ve macOS artıklarını eler. Saf. */
function girisleriTemizle(girisler) {
  return (girisler || [])
    .map((g) => String(g || '').replace(/\\/g, '/').replace(/^\/+/, ''))
    .filter((g) => g && !macosArtigiMi(g));
}

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
  const yollar = girisleriTemizle(girisler);

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
 * Zip dosyasının giriş adlarını `unzip -Z1` ile okur — yalnız MERKEZ DİZİN (ZIP64 dahil), dosya
 * belleğe alınmaz, hiçbir giriş açılmaz (2 GiB+ zip'te de çalışır). Okunamazsa FIRLATIR.
 *
 * @param {string} zipYolu
 * @returns {string[]}
 */
function zipGirisAdlariniOku(zipYolu) {
  const r = spawnSync('unzip', ['-Z1', zipYolu], {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 120000,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`unzip -Z1 rc=${r.status}: ${String(r.stderr || r.stdout || '').trim().slice(-300)}`);
  }
  return String(r.stdout || '').split('\n').map((x) => x.replace(/\r$/, '')).filter(Boolean);
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
async function icerikKapisiDenetleZip(zipYolu, {
  kaynakAdi = '', env = process.env, log = () => {}, listele = zipGirisAdlariniOku,
} = {}) {
  if (!acikMi(env)) {
    log('icerik-kapisi KAPALI (env) — zip denetlenmedi, geçti sayıldı');
    return { gecti: true, sebep: null };
  }
  let girisler;
  try {
    girisler = listele(zipYolu);
  } catch (e) {
    const etiket = kaynakAdi ? ` <${kaynakAdi}>` : '';
    return {
      gecti: false,
      sebep: `${OKUNAMADI_ISARETI} zip giriş listesi okunamadı${etiket}: ${String(e && e.message || e).slice(0, 300)}`,
    };
  }
  return girisListesindenDegerlendir(girisler, { kaynakAdi });
}

module.exports = {
  KAPI_ISARETI,
  OKUNAMADI_ISARETI,
  macosArtigiMi,
  girisleriTemizle,
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
