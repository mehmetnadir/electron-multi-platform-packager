'use strict';
/**
 * ÖLÜ YOL KAPISI — `src/platforms/` altındaki dosyaların CANLI mı ÖLÜ mü olduğunu
 * BEYANLA değil ÖLÇÜMLE saptar.
 *
 * NEDEN VAR (2026-09-21, gerçek zarar):
 *   Bir ajana `src/platforms/windows/WindowsPackagingService.js:348`'e `asar: false`
 *   eklemesi söylendi. O dosya HİÇBİR YERDEN require edilmiyor; onu dinamik yükleyecek
 *   `PlatformServiceRegistry` / `PlatformOrchestrator` de require edilmiyor. Yazılan
 *   değişiklik üretilen pakete DOKUNMAYACAKTI — sahte-yeşil. Canlı yol:
 *   `src/server/app.js` → `src/packaging/packagingService.js` → `packageWindows()`.
 *
 * NE ÖLÇER:
 *   1. GRAF: giriş noktalarından (`src/server/app.js`, `src/main.js`,
 *      `src/agent/runner.js`) statik `require('./...')` grafiği yürünür.
 *   2. VARLIK: grafikteki dosyalarda `path.join(__dirname, '../platforms/....js')`
 *      biçiminde çözülen yollar da CANLI'dır — `packagingService.js` fs-shim ve
 *      android-shim'i require etmez, `fs.copy` ile pakete VARLIK olarak kopyalar.
 *   3. Geriye kalan `.js` dosyaları ÖLÜ'dür ve UYARI_IMI taşımak ZORUNDADIR.
 *
 * NE ÖLÇMEZ — ve NEDEN (ölçülmüş yanlış pozitif, 2026-09-21):
 *   Bir dosya adının başka bir dosyada GEÇMESİ canlılık kanıtı DEĞİLDİR.
 *   `scripts/uretim-on-kontrol.js` `KRITIK_DOSYALAR` listesinde
 *   `'src/platforms/windows/WindowsPackagingService.js'` yazar — bu bir TAZELİK
 *   İZLEME listesidir, çalışma zamanı bağımlılığı değil. Yorum satırındaki anma da
 *   kanıt değildir (`windows-asarsiz.js` fs-shim.test.js'i yorumda anar). Bu yüzden
 *   dize taraması YORUMLARI ATAR ve yalnız `path.join/resolve(__dirname, …)`
 *   kalıbını — yani dosyayı gerçekten AÇAN kodun kullandığı biçimi — sayar.
 *
 * KAPININ İKİ YÖNÜ (bkz. testler):
 *   - Ölü bir dosya canlıya bağlanırsa → sınıfı değişir, beyan tutmaz, test kırılır.
 *   - Yeni bir yetim dosya eklenirse → uyarı imi yoksa test kırılır.
 *
 * KARANTİNA (2026-09-26, Librarian §8): `_graveyard/`e taşınmış yollar (`KARANTINA`).
 *   `karantinaIhlalleri()` yol eski yerinde YENİDEN var mı, ya da src/scripts/tools altında bir
 *   dosya (test dahil) onu göreli `require` ile istiyor mu — ikisini de ihlal sayar.
 */

const fs = require('node:fs');
const path = require('node:path');

const SRC = path.resolve(__dirname, '..');
const PLATFORMS = path.join(SRC, 'platforms');

/** Statik require grafiğinin başladığı gerçek çalıştırma girişleri. */
const GIRISLER = ['server/app.js', 'main.js', 'agent/runner.js'];

/** Dize referansı taranacak ek kökler (yama betikleri require etmez, kopyalar). */
const VARLIK_KOKLERI = [
  path.join(SRC, 'packaging'),
  path.join(SRC, 'server'),
  path.join(SRC, 'services'),
  path.join(SRC, 'utils'),
];

/** Ölü dosyanın taşımak ZORUNDA olduğu im. Dosyanın ilk UYARI_SATIR satırında aranır. */
const UYARI_IMI = 'ÖLÜ YOL UYARISI';
const UYARI_SATIR = 60;

/** Dosyayı gerçekten AÇAN kodun kullandığı yol biçimi. */
const MODUL_GORELI = /path\.(?:join|resolve)\(\s*__dirname\s*,\s*$/;

/** electron-builder 26'nın REDDETTİĞİ düz `desktop:` biçimi (2026-09-04 Tudem vakası). */
const DUZ_DESKTOP = /desktop:\s*\{\s*(?:\/\/[^\n]*\n\s*)*Name:/;

/** Bağlam penceresi: bir literalden önceki kaç karakter saklanır. */
const BAGLAM_TAVANI = 80;

function jsDosyalari(kok) {
  const cikti = [];
  if (!fs.existsSync(kok)) return cikti;
  for (const girdi of fs.readdirSync(kok, { withFileTypes: true })) {
    const tam = path.join(kok, girdi.name);
    if (girdi.isDirectory()) {
      if (girdi.name === 'node_modules' || girdi.name === '.git') continue;
      cikti.push(...jsDosyalari(tam));
    } else if (girdi.name.endsWith('.js')) {
      cikti.push(tam);
    }
  }
  return cikti;
}

/** `src/platforms` altındaki tüm .js dosyaları (test dosyaları dahil). */
function platformDosyalari() {
  return jsDosyalari(PLATFORMS).sort();
}

function testMi(dosya) {
  return dosya.endsWith('.test.js');
}

/**
 * Kaynaktaki dize literallerini, YORUMLARI ATARAK çıkarır.
 * Her literal için kendinden ÖNCEKİ (yorumsuz) metnin son BAGLAM_TAVANI karakteri de
 * döner — çağıranın literali hangi ifadenin içinde durduğunu ölçebilmesi için.
 * Bağlam KAYAN PENCEREDİR: 250 KB'lık `packagingService.js` üzerinde tüm önceki
 * metni her literalde birleştirmek kapıyı 2 dakikaya çıkarıyordu (ölçüldü).
 * @returns {{deger:string, oncesi:string}[]}
 */
function dizeLiteralleri(kaynak) {
  const cikti = [];
  let baglam = '';
  const ekle = (metin) => { baglam = (baglam + metin).slice(-BAGLAM_TAVANI); };
  let i = 0;
  const n = kaynak.length;
  while (i < n) {
    const c = kaynak[i];
    const d = kaynak[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && kaynak[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(kaynak[i] === '*' && kaynak[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const tirnak = c;
      const oncesi = baglam;
      let j = i + 1;
      let deger = '';
      while (j < n) {
        if (kaynak[j] === '\\') { deger += kaynak[j + 1] ?? ''; j += 2; continue; }
        if (kaynak[j] === tirnak) break;
        if (kaynak[j] === '\n' && tirnak !== '`') break; // kapanmamış literal
        deger += kaynak[j];
        j++;
      }
      cikti.push({ deger, oncesi });
      ekle(tirnak + deger + tirnak);
      i = j + 1;
      continue;
    }
    ekle(c);
    i++;
  }
  return cikti;
}

const _kaynakOnbellek = new Map();
const _literalOnbellek = new Map();
let _grafOnbellek = null;

/** Dosya kaynağı — süreç ömrü boyunca önbellekli (kapı tek koşuda onlarca kez okur). */
function oku(dosya) {
  if (_kaynakOnbellek.has(dosya)) return _kaynakOnbellek.get(dosya);
  let metin = '';
  try {
    metin = fs.readFileSync(dosya, 'utf8');
  } catch { /* okunamayan dosya boş sayılır */ }
  _kaynakOnbellek.set(dosya, metin);
  return metin;
}

/** Bir dosyanın dize literalleri (önbellekli). */
function dosyaLiteralleri(dosya) {
  if (!_literalOnbellek.has(dosya)) _literalOnbellek.set(dosya, dizeLiteralleri(oku(dosya)));
  return _literalOnbellek.get(dosya);
}

/** Önbellekleri boşaltır — dosyaları değiştiren çağıranlar için. */
function onbellegiBosalt() {
  _kaynakOnbellek.clear();
  _literalOnbellek.clear();
  _grafOnbellek = null;
}

function coz(kaynakDosya, istek) {
  if (!istek.startsWith('.')) return null;
  const aday = path.resolve(path.dirname(kaynakDosya), istek);
  for (const son of ['', '.js', '/index.js']) {
    const p = aday + son;
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch { /* erişilemeyen yol yok sayılır */ }
  }
  return null;
}

function _requireIstekleri(literaller) {
  return literaller
    .filter((l) => l.deger.startsWith('.') && /require\(\s*$/.test(l.oncesi))
    .map((l) => l.deger);
}

/** Bir kaynaktaki göreli `require('...')` istekleri (yorumlar hariç). */
function requireIstekleri(kaynak) {
  return _requireIstekleri(dizeLiteralleri(kaynak));
}

function _varlikYollari(literaller) {
  return literaller
    .filter((l) => l.deger.endsWith('.js') && l.deger.includes('platforms/'))
    .filter((l) => MODUL_GORELI.test(l.oncesi))
    .map((l) => l.deger);
}

/** `path.join/resolve(__dirname, '…platforms/….js')` biçimindeki VARLIK referansları. */
function varlikYollari(kaynak) {
  return _varlikYollari(dizeLiteralleri(kaynak));
}

/**
 * Giriş noktalarından statik require grafiğini yürür.
 * @param {string[]} [girisler] verilmezse varsayılan girişler kullanılır (önbellekli)
 * @returns {Set<string>} ulaşılan mutlak dosya yolları
 */
function canliGraf(girisler) {
  const varsayilan = girisler === undefined;
  if (varsayilan && _grafOnbellek) return _grafOnbellek;
  const kok = varsayilan ? GIRISLER.map((g) => path.join(SRC, g)) : girisler;
  const gorulen = new Set();
  const kuyruk = kok.filter((g) => fs.existsSync(g));
  while (kuyruk.length) {
    const dosya = kuyruk.pop();
    if (gorulen.has(dosya)) continue;
    gorulen.add(dosya);
    for (const istek of _requireIstekleri(dosyaLiteralleri(dosya))) {
      const hedef = coz(dosya, istek);
      if (hedef && !gorulen.has(hedef)) kuyruk.push(hedef);
    }
  }
  if (varsayilan) _grafOnbellek = gorulen;
  return gorulen;
}

/**
 * `platforms/` altındaki dosyalara çalışma zamanında AÇILAN (kopyalanan) referanslar.
 * @returns {Map<string, string[]>} hedef dosya → referans veren dosyalar
 */
function varlikReferanslari(graf = canliGraf()) {
  const tarananlar = new Set(graf);
  for (const kok of VARLIK_KOKLERI) for (const d of jsDosyalari(kok)) tarananlar.add(d);

  const harita = new Map();
  for (const dosya of tarananlar) {
    if (dosya.startsWith(PLATFORMS + path.sep)) continue; // ada içi referans canlılık kanıtı değil
    if (testMi(dosya)) continue;                          // test anması da kanıt değil
    for (const dize of _varlikYollari(dosyaLiteralleri(dosya))) {
      const hedef = coz(dosya, dize);
      if (!hedef || !hedef.startsWith(PLATFORMS + path.sep)) continue;
      if (!harita.has(hedef)) harita.set(hedef, []);
      if (!harita.get(hedef).includes(dosya)) harita.get(hedef).push(dosya);
    }
  }
  return harita;
}

/**
 * `src/platforms` altındaki her .js dosyasını sınıflandırır.
 * @returns {{canli:string[], olu:string[], test:string[]}} SRC'ye göreli yollar
 */
function siniflandir() {
  const graf = canliGraf();
  const varliklar = varlikReferanslari(graf);
  const canli = [];
  const olu = [];
  const testler = [];

  for (const dosya of platformDosyalari()) {
    const goreli = path.relative(SRC, dosya);
    if (testMi(dosya)) { testler.push(goreli); continue; }
    if (dosya === path.join(PLATFORMS, 'olu-yol-kapisi.js')) {
      // Kapının kendisi: ölçen araç, ölçülen değil.
      canli.push(goreli);
      continue;
    }
    if (graf.has(dosya) || varliklar.has(dosya)) canli.push(goreli);
    else olu.push(goreli);
  }
  return { canli: canli.sort(), olu: olu.sort(), test: testler.sort() };
}

/** Ölü dosyanın ilk UYARI_SATIR satırında uyarı imi var mı? */
function uyariVarMi(kaynak) {
  return kaynak.split('\n').slice(0, UYARI_SATIR).join('\n').includes(UYARI_IMI);
}

/** electron-builder 26'nın reddettiği düz `desktop:` biçimini taşıyor mu? */
function duzDesktopVarMi(kaynak) {
  return DUZ_DESKTOP.test(kaynak);
}

/** Depo kökü (`src/`in bir üstü). */
const DEPO = path.resolve(SRC, '..');

/**
 * KARANTİNADAKİ YOLLAR — depo köküne göreli, `.js` uzantılı. Her girdinin mezarı/kanıtı
 * `_graveyard/<tarih>-<ad>/OKU.md`'de. Geri alma `git revert` ile yapılırsa bu listeden de
 * çıkarılmalıdır (yoksa kapı "geri-geldi" der — bilerek).
 */
const KARANTINA = [
  // 2026-09-26 eski G üreticisi (D-2): _graveyard/2026-09-26-g-eski-uretici/OKU.md
  'src/packaging/guncelleme-paketi.js',
  'scripts/guncelleme-manifesti-uret.js',
  // 2026-10-01 exe'siz kaynak sözleşmesi sonrası ölü exe hattı: _graveyard/2026-10-01-exe-kaynak/OKU.md
  'src/agent/kaynak-isitici.js',
  'src/agent/kaynak-isitici.test.js',
  'src/agent/isitici-dongu.js',
  'src/agent/isitici-dongu.test.js',
  'src/agent/local-build.js',
];

/** Karantina require taramasının kökleri (depo köküne göreli). */
const KARANTINA_TARAMA_KOKLERI = ['src', 'scripts', 'tools'];

/**
 * Karantina ihlallerini ölçer. Dosya artık olmadığı için `coz()` onu ÇÖZEMEZ; eşleşme
 * `require` isteğinin mutlak hâli (uzantılı ya da uzantısız) ile yapılır. Yorumdaki ve düz
 * dizedeki anma ihlal DEĞİLDİR (aynı `dizeLiteralleri` kuralı).
 * @returns {{tur:'geri-geldi'|'require', yol:string, dosya?:string, istek?:string}[]}
 */
function karantinaIhlalleri({
  depo = DEPO, karantina = KARANTINA, kokler = KARANTINA_TARAMA_KOKLERI,
} = {}) {
  const hedefler = new Map();
  for (const k of karantina) {
    const mutlak = path.join(depo, k);
    hedefler.set(mutlak, k);
    hedefler.set(mutlak.replace(/\.js$/, ''), k);
  }
  const ihlaller = [];
  for (const k of karantina) {
    if (fs.existsSync(path.join(depo, k))) ihlaller.push({ tur: 'geri-geldi', yol: k });
  }
  for (const kok of kokler) {
    for (const dosya of jsDosyalari(path.join(depo, kok))) {
      for (const istek of _requireIstekleri(dosyaLiteralleri(dosya))) {
        const k = hedefler.get(path.resolve(path.dirname(dosya), istek));
        if (k) ihlaller.push({ tur: 'require', yol: k, dosya: path.relative(depo, dosya), istek });
      }
    }
  }
  return ihlaller;
}

module.exports = {
  SRC,
  PLATFORMS,
  GIRISLER,
  VARLIK_KOKLERI,
  UYARI_IMI,
  UYARI_SATIR,
  BAGLAM_TAVANI,
  jsDosyalari,
  platformDosyalari,
  dizeLiteralleri,
  dosyaLiteralleri,
  onbellegiBosalt,
  requireIstekleri,
  varlikYollari,
  canliGraf,
  varlikReferanslari,
  siniflandir,
  uyariVarMi,
  duzDesktopVarMi,
  oku,
  DEPO,
  KARANTINA,
  KARANTINA_TARAMA_KOKLERI,
  karantinaIhlalleri,
  _ic: { coz },
};
