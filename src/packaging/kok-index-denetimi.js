'use strict';

/**
 * KÖK INDEX DENETİMİ — üretim anında "kaynağın kök index.html'i sadakatle mi taşındı" ölçümü.
 *
 * NEDEN (2026-09-26, ölçüm: `~/.empp-agent/arastirma/shallwe-pardus-index-20260926.md`) —
 * ProBook kabul kapısı (K18) yalnız pencere pikseline bakıyor, HANGİ menünün açıldığını
 * bilmiyor. 45482 (25.09) ve 45551 (17.09) pardus paketleri yanlış kök menüyle (yayıncının
 * kendi tasarımı yerine bizim `empp-set-menu` menümüz) kapıdan GEÇTİ — ekran açılıyordu,
 * ama yayıncının menüsü değil bizimkiydi. Kök neden zincirlerinden biri: eski kod
 * `publisher-update.js`'in güncelleme zip'ini koşulsuz köke açması → kök `index.html`
 * okuyucu/motor kopyasıyla EZİLDİ → `set-menu.js`'in K17 kapısı bu ezilmiş kökü "motor
 * kopyası" sanıp üstüne sade menü yazdı. Kapı bunu YAKALAYAMADI çünkü "bir menü var mı"
 * ölçüyordu, "DOĞRU menü mü" değil.
 *
 * BU MODÜLÜN ÖLÇTÜĞÜ: paketin kök `index.html`'i, build zip kökündeki (yamalardan ÖNCEKİ)
 * kök `index.html` ile — paketleyicinin BİLEREK enjekte ettiği `<script>` satırları
 * (`empp-fs-shim.js`, `empp-ag-politikasi.js` vb.) dışında — AYNI OLMALI. Kaynak
 * kök YOKTU/MOTOR KOPYASIYDI durumunda İKİ geçerli üretilen-menü İSTİSNASI var:
 *   1. Kaynağın kök `index.html`'i YOKTU → kök hiç yoktan üretildi, sorun değil.
 *   2. Kaynağın kök `index.html`'i MOTOR KOPYASIYDI (`set-menu.js`'in `motorKopyasiMi`
 *      imzası — K17'nin tam sorun tespit ettiği durum) → K17'nin ürettiği menü
 *      (`MENU_ISARETI` işaretli) PAKETTE olması BEKLENEN ve DOĞRU davranıştır.
 *   3. (2026-09-27, 60015 pardus — panel yanlış-pozitifi) Pakette K17 imzası YOK ama
 *      Üretim Masası'nın (WebZTemaUretici) ürettiği Web-Z kabuğu (`set-menu-bicim.js`'in
 *      `webZKabukIndexiMi` imzası, `scripts/language-set.js` referansı) var — bu da K17
 *      dışı ama MEŞRU bir "panel SET menüsü" üreticisi, ezilme SAYILMAZ.
 * Bunların DIŞINDA bir fark varsa (yayıncının/Nadir'in kendi özel menüsü sessizce
 * değişmiş/kaybolmuşsa, ya da hiçbir tanınan imza taşımayan yabancı içerik varsa)
 * KÖK EZİLMİŞ demektir — iş HATA ile düşer, paket yüklenmez.
 * `harf-kapisi.js`'teki `mod=dusur` ilkesiyle aynı: yutma, yukarı taşı.
 *
 * NEREYE BAĞLI: `packagingService.js` içinde, set-menu (K17) adımından SONRA ve platform
 * fan-out'undan (`switch(platform)`) ÖNCE — `harf-kapisi.js` ile TAM AYNI konum, TEK
 * noktadan tüm platformlar (pardus/mac/android/windows) için geçerli. Kaynak kök
 * anlık görüntüsü ise workingPath İLK DOLDURULDUĞUNDA (kopyadan hemen sonra, HİÇBİR
 * yamadan önce) alınır — `packagingService.js`'te bu modülün `oku()`'su ile.
 *
 * BAĞIMLILIK KURALI: yalnız Node stdlib + `./set-menu` (motor kopyası imzası TEK
 * kaynaktan gelsin — kopya tanım YASAK, bkz. `set-kabuk.js` aynı ilke).
 *
 * BOZARSAN: `kok-index-denetimi.test.js`'teki dört senaryo (sadık kaynak, ezilmiş kaynak,
 * motor-sayfa kaynağı + üretilen menü, yalnız shim enjekte edilmiş kaynak) kırılır.
 */

const fs = require('fs').promises;
const path = require('path');
const { motorKopyasiMi, MENU_ISARETI, webZKabukIndexiMi } = require('./set-menu');

/**
 * Paketleyicinin köke bilerek enjekte ettiği `<script src="empp-*.js"></script>` etiketleri.
 * Konumdan bağımsız (satır başı/`<head>` bitişik) yakalanır — yalnız etiketin kendisi
 * metinden çıkarılır, geri kalan HTML dokunulmadan kalır.
 */
const ENJEKTE_SCRIPT_DESENI = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*\bempp-[a-z0-9-]+\.js(?:[?#][^"']*)?["'][^>]*>\s*<\/script\s*>/gi;

/** Bilerek enjekte edilen `<script>` etiketlerini metinden çıkarır. Saf. */
function enjekteSatirlariCikar(html) {
  if (typeof html !== 'string') return html;
  return html.replace(ENJEKTE_SCRIPT_DESENI, '');
}

/**
 * `okuyucu-kabugu.js`'nin (`indexYenidenYaz`) köke yazdığı webpack content-hash'li
 * `<20 hex>.main.js` / `<20 hex>.main.css` referansları — kanonik okuyucu sürümü
 * değiştikçe hash de değişir, bu İÇERİK farkı DEĞİLDİR (2026-09-26, T2 — bkz.
 * `~/.empp-agent/arastirma/set-koku-ezilmis-kok-neden-20260926.md` "yanlış-pozitif
 * riski" bölümü: 11845 kaynak→paket kıyası TEK bu farktan `ezilmis` çıkıyordu).
 * Kıyastan ÖNCE ikisi de aynı sabit adla değiştirilir; dosyanın kendisi paketten
 * silinmez, yalnız KARŞILAŞTIRMA metni normalize edilir.
 */
const ANA_DOSYA_HASH_DESENI = /\b[0-9a-f]{20}\.main\.(js|css)\b/gi;

/** `ANA_DOSYA_HASH_DESENI` eşleşmelerini sabit bir adla değiştirir. Saf. */
function anaDosyaReferanslariniNormallestir(html) {
  if (typeof html !== 'string') return html;
  return html.replace(ANA_DOSYA_HASH_DESENI, 'HASH.main.$1');
}

/** Runner'ın güncellemeden ÖNCE bıraktığı gerçek kaynak kök index'i (bkz. T5 / dosya başlığı). */
const KAYNAK_KOK_INDEX_MARKER = '.empp-kaynak-kok-index.html';

/**
 * Karşılaştırmaya hazır normal biçim: enjekte satırlar çıkarılır, satır sonu biçimi
 * (CRLF/LF) birleştirilir, baş/son boşluk kırpılır. `null`/`undefined` → `null`. Saf.
 */
function normalle(html) {
  if (html === null || html === undefined) return null;
  return anaDosyaReferanslariniNormallestir(enjekteSatirlariCikar(String(html)))
    .replace(/\r\n/g, '\n').trim();
}

/**
 * İki kök index.html'i karşılaştırır. Saf fonksiyon — dosya sistemine dokunmaz.
 *
 * @param {string|null} kaynakHtml - workingPath ilk doldurulduğunda okunan kök index.html
 *   (dosya yoksa `null`).
 * @param {string|null} guncelHtml - set-menu adımından SONRA okunan kök index.html
 *   (dosya yoksa `null`).
 * @returns {{ sonuc: 'sadik'|'uretilen-menu-beklenir'|'yok'|'ezilmis', detay: string }}
 *   sonuc ∈ 'sadik' (enjekte satırlar dışında değişmedi) | 'uretilen-menu-beklenir'
 *   (kaynak yok/motor kopyasıydı, K17 menüsü doğru biçimde üretildi) | 'yok' (ne
 *   kaynakta ne pakette kök index var — denetim dışı) | 'ezilmis' (ARIZA).
 */
function karsilastir(kaynakHtml, guncelHtml) {
  const kNorm = normalle(kaynakHtml);
  const gNorm = normalle(guncelHtml);

  if (kNorm === null && gNorm === null) {
    return { sonuc: 'yok', detay: 'ne kaynakta ne pakette kök index.html var — denetim dışı' };
  }

  if (kNorm !== null && gNorm !== null && kNorm === gNorm) {
    return { sonuc: 'sadik', detay: 'kök index, enjekte edilen script satırları dışında kaynakla birebir aynı' };
  }

  // Kaynak yoktu ya da motorun tek-kitap sayfasının kopyasıydı (K17'nin tam bu
  // durumu tespit edip menü ürettiği senaryo) → üretilen menü BEKLENEN davranıştır.
  const kaynakUretilenMenuBekler = kNorm === null || motorKopyasiMi(kaynakHtml);
  if (kaynakUretilenMenuBekler) {
    if (gNorm !== null && String(guncelHtml).includes(MENU_ISARETI)) {
      return {
        sonuc: 'uretilen-menu-beklenir',
        detay: kNorm === null
          ? 'kaynakta kök index.html yoktu; K17 tarafından üretilen SET menüsü kabul edildi'
          : 'kaynağın kökü motorun tek-kitap sayfasının kopyasıydı; K17 tarafından üretilen SET menüsü kabul edildi',
      };
    }
    // Panel tarzı SET menüsü: Üretim Masası'nın (WebZTemaUretici) ürettiği Web-Z kabuğu —
    // K17 (set-menu.js) BUNA dokunmaz (`custom-menu-kept, kabuk: 'webz'`), kendi imzasını
    // (`scripts/language-set.js` referansı, `webZKabukIndexiMi`) taşır. Yayıncı güncellemesi
    // bu kabuğu meşru biçimde YENİDEN üretebilir (sekme/kapak tazeleme) — bu bir ezilme
    // DEĞİLDİR (2026-09-27, 60015 pardus: konteyner kabulünden GEÇTİ, ekranda geçerli SET
    // menüsü vardı ama denetim bu menü türünü tanımadığı için yanlış alarm verdi).
    if (gNorm !== null && webZKabukIndexiMi(guncelHtml)) {
      return {
        sonuc: 'uretilen-menu-beklenir',
        detay: 'kaynak kök yok/motor kopyasıydı; pakette Üretim Masası\'nın Web-Z kabuğu '
          + '(panel SET menüsü, scripts/language-set.js imzalı) bulundu — kabul edildi',
      };
    }
    return {
      sonuc: 'ezilmis',
      detay: 'kaynak kök yok/motor kopyasıydı ama pakette ne kaynakla aynı ne K17 imzalı (' +
        `${MENU_ISARETI}) ne de Web-Z kabuk imzalı bir menü var — beklenmeyen kök içeriği`,
    };
  }

  // Kaynakta özel (yayıncının ya da Nadir'in) bir kök menüsü vardı ve şimdi
  // enjekte satırların ötesinde değişmiş/kaybolmuş: KÖK EZİLMİŞ.
  return {
    sonuc: 'ezilmis',
    detay: 'kaynakta özel (yayıncı) kök menüsü vardı, pakette enjekte satırların ötesinde değişmiş',
  };
}

/**
 * `EMPP_KOK_INDEX_DENETIMI` env'inden modu okur. Varsayılan: `uyar` (2026-09-26, Şef): gerçek
 * kaynaklarda yanlış-pozitif oranı henüz ölçülmedi — ölçülmemiş kapı kilit yapılmaz. İlk tam YDS
 * koşusunda 'ezilmis' satırları sayılır; sıfır yanlış-pozitifle `dusur`a çekilir (run-agent.sh
 * `EMPP_KOK_INDEX_DENETIMI=dusur`). Bilinmeyen değer yine `dusur` (açık yazılmış sertlik).
 */
function modOku(env) {
  const kaynak = env || process.env;
  const ham = kaynak.EMPP_KOK_INDEX_DENETIMI;
  if (ham === undefined || ham === null || ham === '') return 'uyar';
  const s = String(ham).trim().toLowerCase();
  if (s === '0' || s === 'false' || s === 'kapali' || s === 'kapalı') return 'kapali';
  if (s === 'uyar' || s === 'warn') return 'uyar';
  return 'dusur';
}

function acikMi(env) {
  return modOku(env) !== 'kapali';
}

const GECERLI_SONUCLAR = new Set(['sadik', 'uretilen-menu-beklenir', 'yok']);

/**
 * Paketleme çağrı noktası. Saf `karsilastir`i sarar; moda göre uyarır/düşürür.
 *
 * @param {string|null} kaynakHtml
 * @param {string|null} guncelHtml
 * @param {{ env?: object, log?: (s:string)=>void }} [secenekler]
 * @returns {Promise<{ mod: string, uygulandi: boolean, sonuc: object|null, ozet?: string }>}
 *   `mod==='dusur'` ve sonuç geçersizse (`ezilmis`) hata fırlatır; hatada `e.kokIndexSonucu`
 *   dolu gelir — `harf-kapisi.js`'teki `e.harfSonucu` ile aynı disiplin.
 */
async function denetle(kaynakHtml, guncelHtml, secenekler = {}) {
  const env = secenekler.env || process.env;
  const mod = modOku(env);
  const log = secenekler.log || (() => {});
  if (mod === 'kapali') return { mod, uygulandi: false, sonuc: null };

  const sonuc = karsilastir(kaynakHtml, guncelHtml);
  const gecerli = GECERLI_SONUCLAR.has(sonuc.sonuc);
  const ozet = `🔍 Kök index denetimi (${mod}): ${sonuc.sonuc} — ${sonuc.detay}`;
  log(ozet);

  if (!gecerli && mod === 'dusur') {
    const e = new Error(`Kök index denetimi DÜŞÜRDÜ: ${sonuc.detay}`);
    e.kokIndexSonucu = sonuc;
    throw e;
  }

  return { mod, uygulandi: true, sonuc, ozet };
}

/**
 * `workingPath` kökündeki index.html'i okur (yoksa `null` döner — hata fırlatmaz).
 * Kaynak anlık görüntüsü (yamalardan ÖNCE) ve güncel okuma (set-menu'den SONRA) ikisi
 * için de kullanılır — TEK okuma yolu, `packagingService.js` içinde tekrarlanmaz.
 */
async function kokIndexOku(workingPath) {
  try {
    return await fs.readFile(path.join(workingPath, 'index.html'), 'utf8');
  } catch (e) {
    return null;
  }
}

/**
 * `workingPath`'in GERÇEK kaynak anlık görüntüsünü alır (T5 — bkz. dosya başlığı).
 * Runner'ın `applyPublisherUpdate`'ten HEMEN ÖNCE bıraktığı `KAYNAK_KOK_INDEX_MARKER`
 * dosyası varsa ASIL kaynak odur — okunur okunmaz SİLİNİR (pakete sızmaz, tek okuma
 * hakkı vardır). Yoksa (arşiv/hazır paket/publisher-update uygulanmamış akış) eski
 * davranış sürer: `workingPath`'in kendi kök index'i "yamalardan önceki tek bilgi"
 * sayılır. TEK okuma yolu — `packagingService.js` bunu tekrarlamaz.
 *
 * @param {string} workingPath
 * @returns {Promise<string|null>}
 */
async function kaynakSnapshotAl(workingPath) {
  const markerYolu = path.join(workingPath, KAYNAK_KOK_INDEX_MARKER);
  try {
    const html = await fs.readFile(markerYolu, 'utf8');
    await fs.unlink(markerYolu).catch(() => {});
    return html;
  } catch (_) {
    return kokIndexOku(workingPath);
  }
}

/**
 * `packagingService.js` çağrı noktası: `workingPath`'in GÜNCEL kök index'ini okur,
 * önceden alınmış `kaynakHtml` anlık görüntüsüyle karşılaştırır.
 */
async function paketeUygula(workingPath, kaynakHtml, secenekler = {}) {
  const guncelHtml = await kokIndexOku(workingPath);
  return denetle(kaynakHtml, guncelHtml, secenekler);
}

module.exports = {
  ENJEKTE_SCRIPT_DESENI,
  enjekteSatirlariCikar,
  ANA_DOSYA_HASH_DESENI,
  anaDosyaReferanslariniNormallestir,
  KAYNAK_KOK_INDEX_MARKER,
  normalle,
  karsilastir,
  modOku,
  acikMi,
  denetle,
  kokIndexOku,
  kaynakSnapshotAl,
  paketeUygula,
};
