'use strict';

/**
 * SET KABUK TANIMI — TEK KAYNAK.
 *
 * Bu modül "setin kabuğu hangi dosyalardır?" sorusunun KODDAKİ TEK cevabıdır.
 * İki tüketicisi vardır ve İKİSİ DE buradan ithal eder (kopya tanım YASAK):
 *   · ÜRETİCİ — `src/packaging/set-kimligi.js` (`empp-set.json` envanterini yazar)
 *   · KAPI    — `scripts/windows-paket-kapisi.js` madde 13 (üretilen .exe'yi ölçer)
 * Ayrışırlarsa `set-kabuk.test.js` içindeki SÖZLEŞME testi düşer — kapı, üreticinin
 * hatasını göremeyen bir kopya taşıyamaz (fan-out sapması; memory: `purge-listesi-iki-yerde`,
 * `kardes-verb-kor-noktasi`).
 *
 * BAĞIMLILIK KURALI: YALNIZ Node stdlib — hatta hiç `require` yok. Kapı betiği
 * "Bağımlılık eklenmedi: yalnız Node stdlib" sözünü verir; `fs-extra` çeken bir
 * modülü ithal edemez. Bu yüzden tanım `set-kimligi.js`'in İÇİNDE değil, burada.
 *
 * ─────────────────────────────── NEDEN BU TANIM ───────────────────────────────
 *
 * ÖNCEKİ TANIM YANLIŞTI (ölçüldü, 2026-09-21): kabuk = `index.html` + `set_app.config`
 * + `assets2/**`. Gerçek bir SET ağacında (SM4 Set, 6 kitap, `temp/d4100a93…/app`):
 *   · `index.html` 12 varlık referanslıyor; HİÇBİRİ `assets2/` altında değil.
 *   · O tanım 460 kabuk dosyasının 54'ünü kapsıyordu ve `index.html`in yüklediklerinin
 *     0/12'sini. Kanal yeni bir `index.html` gönderdiğinde yeni hash'li paketler
 *     envanterde olmadığı için hiç inmez → set BOŞ EKRANA açılır.
 *
 * İKİ ADAY ÖLÇÜLDÜ (iki gerçek ağaçta, kitap dizinleri hariç):
 *
 *   A) STATİK TRANSİTİF KAPANIŞ — `index.html`i ayrıştır, referansları izle.
 *      SM4 Set: 87 dosyaya ulaşır; kökteki 34 hash'li webpack parçasının 32'sini
 *      KAÇIRIR. İkinci ağaç (`uploads/579b35ed…`): 168 parçanın 166'sını kaçırır.
 *      SEBEP ölçülebilir: parça adları `<contenthash>.<chunkId>.js` biçiminde
 *      webpack ÇALIŞMA ANI haritasından kurulur (`a8f43f74….main.js` içinde
 *      `{chunkId: contenthash}` sözlüğü olarak durur) — statik olarak ayrıştırılamaz.
 *      Ayrıca `app.config.js` referansı GERÇEKTE YOK (bkz. `set-app-config-kasitli-yok.test.js`),
 *      yani kapanış "referans = dosya" varsayımına da dayanamaz. → ELENDİ.
 *
 *   B) DİZİN TABANLI BEYAZ LİSTE (bu modül) — kök dosyaları + `core/` + `i18n/` +
 *      `assets2/`. SM4 Set: 459 dosya · 12/12 referans kapsandı · 0 kitap sızması ·
 *      0 `node_modules` · 0 `temp`. İkinci ağaç: 585 dosya · 10/10 · 0 sızma.
 *      Hash'li YENİ dosya köke düştüğü an kapsama otomatik girer — A'nın öldüğü yer.
 *
 * NEDEN BEYAZ LİSTE, KARA LİSTE DEĞİL: aynı ağaçta "book dizinleri,
 * `node_modules` ve `temp` dışında her şey" kuralı da 459 verir — ama `temp/` paketleyicinin kendi çıktı dizinidir ve o
 * ağaçta 1,8 GB'tır. Kara liste yeni bir artefakt dizinini (`dist/`, `out/`, `.cache/`)
 * SESSİZCE kabuğa sokar; beyaz liste sokmaz. Kod tabanının doktrini de budur
 * ("varsayılan RET" — `set-kimligi.js` §Yol güvenliği, `kitap-guncelleyici.js` §Tasarım).
 *
 * BEYAZ LİSTENİN KÖR NOKTASI GÖRÜNÜR KILINDI: yayıncı yarın `fonts/` eklerse beyaz
 * liste onu kaçırır. Bu yüzden `dallariSinifla()` "ne kabuk ne kitap ne bilinen
 * artefakt" olan kök dizinlerini BİLİNMEYEN olarak döner; üretici bunu
 * `empp-set.json → kapsamDisiDallar` alanına yazar, kapı da FAIL eder. Sessiz
 * eksik yerine gürültülü eksik (memory: `tablo-esleme-sessiz-varsayilan`).
 *
 * KAPSAM DIŞI, BİLEREK: `book\d+/` — kitapların içi. Onlar kendi uçlarından
 * güncellenir (Nadir, 2026-09-21). Set kanalı kitabın içine DOKUNMAZ.
 */

/** Tanımın sürümü. Değişirse `empp-set.json` şeması ve kapı beklentisi birlikte değişir. */
const SOZLESME_SURUMU = 2;

/**
 * Kabuk sayılan kök ALT DİZİNLERİ (beyaz liste, tam eşleşme).
 *
 * 2026-09-26 (Windows sözleşmesi, kapı madde 13 C2 — ölçüldü): Web-Z sf425 kök kabuğu
 * (Super Monsters 2 Set, 59835) menüsünü `config/ features/ images/ languages/
 * scripts/ styles/` altından yüklüyor (`index.html` → `styles/language-set.css`,
 * `images/logo.png` …). Eski liste bunları "bilinmeyen" sayıyor, kanal o menünün
 * dosyalarını hiç güncellemiyordu. Altısı meşru kabuk dizinidir → listeye eklendi.
 */
const KABUK_DIZINLERI = Object.freeze([
  'assets2', 'core', 'i18n',
  'config', 'features', 'images', 'languages', 'scripts', 'styles',
]);

/**
 * YEDEK/ARŞİV dizinleri: `_` ile başlayan her kök dizin (ör. SM2 zip'indeki
 * `_eski/index-2026-09-25-182210.html` — eski menünün yedeği). Bilinir ama güncelleme
 * kapsamına HİÇBİR ZAMAN girmez; "bilinmeyen" de sayılmaz (kapı FAIL etmez).
 * Yalnız DİZİN adına uygulanır — kökteki `_x.js` gibi DOSYALAR kabukta kalır.
 */
const YEDEK_DIZIN_DESENI = /^_/;

/**
 * Kabuk OLMAYAN, BİLİNEN artefakt dizinleri. "Bilinmeyen" sayılmazlar (kapı
 * FAIL etmez) ama kabuğa da girmezler.
 *   · `node_modules` — Electron çalışma-anı bağımlılıkları; uygulamayla birlikte
 *     kurulur, güncelleme kanalının işi değildir.
 *   · `temp` — electron-builder'ın çıktı dizini; ölçülen ağaçta 1,8 GB.
 *   · `.empp-gecici` — güncelleyicinin kendi geçici dizini (`kitap-guncelleyici.js`).
 */
const KABUK_DISI_DIZINLER = Object.freeze(['node_modules', 'temp', '.empp-gecici']);

/** Üyelik listesine giren kitap dizini deseni — kabuk DEĞİL. */
const KITAP_DIZIN_DESENI = /^book\d+$/;

/**
 * Kabuk sayılmayan kök DOSYALARI: kanalın kendi durum dosyaları.
 * `empp-set.json` envanterin kendisidir (kendini listelemez); `.empp` ile
 * başlayan her kök dosyası güncelleyicinin durumudur (damga, `.indirme` artığı).
 * DİKKAT: `empp-fs-shim.js` / `empp-ag-politikasi.js` / `empp-set-guncelleyici.js`
 * NOKTA ile başlamaz — onlar kabuktur ve kabukta KALIR.
 */
const ENVANTER_DOSYASI = 'empp-set.json';
const DURUM_DOSYA_ONEKI = '.empp';

/**
 * Tanımın parmak izi. İki tüketici de bunu raporlar; biri tanımı kopyalayıp
 * değiştirirse imzalar ayrışır ve sözleşme testi düşer.
 */
const IMZA = [
  `v${SOZLESME_SURUMU}`,
  `dizin=${KABUK_DIZINLERI.join(',')}`,
  `artefakt=${KABUK_DISI_DIZINLER.join(',')}`,
  `kitap=${KITAP_DIZIN_DESENI.source}`,
  `yedek=${YEDEK_DIZIN_DESENI.source}`,
  `durum=${ENVANTER_DOSYASI}|${DURUM_DOSYA_ONEKI}*`,
].join(' ');

/** Yolu POSIX ayraçlı, baştaki `./` ve `/` temizlenmiş hâle getirir. Saf. */
function yolNormalle(ham) {
  return String(ham == null ? '' : ham)
    .replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * Yol biçimsel olarak güvenli mi? VARSAYILAN RET.
 * Reddedilenler: dize değil, boş, `\0`, Windows sürücü öneki, herhangi bir
 * segmenti boş / `.` / `..` olan yollar (yol kaçışı).
 */
function yolGuvenliMi(ham) {
  if (typeof ham !== 'string' || !ham) return false;
  if (ham.indexOf('\0') !== -1) return false;
  const yol = yolNormalle(ham);
  if (!yol) return false;
  if (/^[a-zA-Z]:/.test(yol)) return false;
  const parcalar = yol.split('/');
  for (const p of parcalar) {
    if (p === '' || p === '.' || p === '..') return false;
  }
  return true;
}

/** Göreli yolun kök dal adı; kök dosyası için `''`. Saf. */
function dalAdi(ham) {
  const yol = yolNormalle(ham);
  return yol.includes('/') ? yol.split('/')[0] : '';
}

/**
 * Bir kök dizin adının sınıfı: `'kabuk' | 'kitap' | 'artefakt' | 'yedek' | 'bilinmeyen'`.
 * DOSYA değil DİZİN adı bekler. Saf.
 */
function dalSinifi(ad) {
  const d = String(ad == null ? '' : ad);
  if (YEDEK_DIZIN_DESENI.test(d)) return 'yedek';
  if (KABUK_DIZINLERI.includes(d)) return 'kabuk';
  if (KITAP_DIZIN_DESENI.test(d)) return 'kitap';
  if (KABUK_DISI_DIZINLER.includes(d)) return 'artefakt';
  return 'bilinmeyen';
}

/**
 * Bu göreli DOSYA yolu kabuğa ait mi? Saf. Tek karar noktası — hem üretici hem
 * kapı bu fonksiyonu çağırır.
 *
 * Kök dosyası (tek parça): bilinen bir DİZİN adı değilse ve kanalın durum
 * dosyası değilse KABUKTUR. Kökteki hash'li webpack parçaları, `electron.js`,
 * `main.js`, `set_app.config`, `index.html`, `favicon.ico`… hepsi buradan geçer.
 * Alt yol (2+ parça): yalnız beyaz listedeki dizinlerin altı kabuktur.
 */
function kabukYoluMu(ham) {
  return kabukDisiSebep(ham) === null;
}

/**
 * Kabuk DEĞİLSE nedenini döner, kabuksa `null`. Saf.
 * Kapı bu metni kullanıcıya gösterir — "sızdı" demek yetmez, NEDEN sızdığı yazılır.
 */
function kabukDisiSebep(ham) {
  if (typeof ham !== 'string' || !ham) return 'dize değil ya da boş';
  if (!yolGuvenliMi(ham)) return 'yol güvensiz (boş segment, `.`/`..` kaçışı ya da sürücü öneki)';
  const parcalar = yolNormalle(ham).split('/');

  if (parcalar.length === 1) {
    const ad = parcalar[0];
    if (ad === ENVANTER_DOSYASI) return `${ENVANTER_DOSYASI} envanterin kendisidir`;
    if (ad.startsWith(DURUM_DOSYA_ONEKI)) return 'güncelleyicinin durum dosyası';
    const sinif = dalSinifi(ad);
    // `yedek` deseni yalnız DİZİN adlarına uygulanır — kökteki `_x.js` dosyası kabuktur.
    if (sinif !== 'bilinmeyen' && sinif !== 'yedek') {
      return `"${ad}" bir DİZİN adıdır (${sinif}) — kabuk girdisi dosya yolu olmalı`;
    }
    return null;
  }

  const dal = parcalar[0];
  const sinif = dalSinifi(dal);
  if (sinif === 'kabuk') return null;
  if (sinif === 'kitap') return `kitap içeriği (${dal}/) — kitabın kendi kanalına ait`;
  if (sinif === 'artefakt') return `kabuk dışı artefakt dizini (${dal}/)`;
  if (sinif === 'yedek') return `yedek/arşiv dizini (${dal}/) — "_" ile başlayan dizinler güncelleme kapsamına hiçbir zaman girmez`;
  return `kabuk beyaz listesinde olmayan kök dizin (${dal}/)`;
}

/**
 * Kök-göreli dosya yolu listesinden KABUK dosyalarını süzer; tekilleştirir,
 * sıralar, normalleştirir. Saf.
 */
function kabukDosyalariSuz(dosyaListesi) {
  const sonuc = new Set();
  for (const ham of Array.isArray(dosyaListesi) ? dosyaListesi : []) {
    if (kabukYoluMu(ham)) sonuc.add(yolNormalle(ham));
  }
  return [...sonuc].sort();
}

/**
 * Bir envanter listesindeki KABUK OLMAYAN girdileri HAM hâliyle döner
 * (sıra korunur, tekilleştirme YOK — kapı "kaç girdi sızmış" der).
 * `kabukDosyalariSuz` ile tam ikilidir: sözleşme testi bunu çivi ile çakar.
 */
function kabukSizintilari(kabukDosyalari) {
  const liste = Array.isArray(kabukDosyalari) ? kabukDosyalari : [];
  return liste.filter((ham) => !kabukYoluMu(ham));
}

/**
 * Kök DİZİN adlarını sınıflarına ayırır. Saf.
 * `bilinmeyen` boş değilse kabuk tanımı o ağacı KAPSAMIYOR demektir —
 * üretici bunu pakete yazar, kapı FAIL eder.
 */
function dallariSinifla(dizinAdlari) {
  const c = { kabuk: [], kitap: [], artefakt: [], yedek: [], bilinmeyen: [] };
  for (const ad of Array.isArray(dizinAdlari) ? dizinAdlari : []) {
    if (typeof ad !== 'string' || !ad) continue;
    c[dalSinifi(ad)].push(ad);
  }
  for (const k of Object.keys(c)) c[k] = [...new Set(c[k])].sort();
  return c;
}

module.exports = {
  SOZLESME_SURUMU, IMZA,
  KABUK_DIZINLERI, KABUK_DISI_DIZINLER, KITAP_DIZIN_DESENI, YEDEK_DIZIN_DESENI,
  ENVANTER_DOSYASI, DURUM_DOSYA_ONEKI,
  yolNormalle, yolGuvenliMi, dalAdi, dalSinifi,
  kabukYoluMu, kabukDisiSebep, kabukDosyalariSuz, kabukSizintilari, dallariSinifla,
};
