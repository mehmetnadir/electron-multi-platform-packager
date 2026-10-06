'use strict';

/**
 * G MENÜ KAYNAĞI — build'in (zip ya da açık dizin) menü baytlarını AYNEN okur (06.10, Nadir:
 * "kapak/menü değişimi tüm kurulu paketlere gitmeli").
 *
 * NEDEN AYRI MODÜL: `yayinla.js --menu-kaynak` (yayın) ve `otomatik-yayin.js` (sha kıyası)
 * aynı okumayı ve aynı biçim kararını kullanır; liste `durum.js`'ten gelir (kopya liste yok).
 * Zip, `unzip -p` ile girdi girdi okunur — yüzlerce MB'lık build belleğe alınmaz.
 *
 * G'YE GİDEN: yalnız `durum.MENU_YOLLARI` (Web-Z menü dosyaları). Kök `index.html` yalnız biçim
 * tanımak için okunur, YAYINLANMAZ: paketleyici index'e platforma özel etiket koyar (Electron
 * `empp-fs-shim.js`, Android `empp-android-shim.js`); build'in ham index'i shim'siz olduğu için
 * Android istemcisi onu `index-android-shim-yok` ile RED eder ve birikimli manifest o sürümü her
 * yayına taşır (Android kalıcı donar). K17 menüsünün kartları index.html'de olduğundan K17 menü
 * değişimi G'ye menü olarak GİTMEZ (`K17_YASAK`); yolu `--index` + shim'li bayt (insan kararı).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const durum = require('./durum');
const menu = require('./menu');

const K17_YASAK = 'index-yasak-k17';
const KITAP_DIZIN_RE = /^(book\d+)\//;

function zipGirdisiOku(zipYolu, girdi) {
  const r = spawnSync('unzip', ['-p', zipYolu, girdi], {
    maxBuffer: 256 * 1024 * 1024,
    timeout: 120000,
  });
  return r.status === 0 ? r.stdout : null;
}

function zipListesi(zipYolu) {
  const r = spawnSync('unzip', ['-Z1', zipYolu], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 120000,
  });
  if (r.status !== 0) throw new Error(`zip okunamadı: ${zipYolu}`);
  return r.stdout.split('\n').filter(Boolean);
}

/**
 * @param {string} yol  build.zip ya da açık build dizini
 * @returns {{dosyalar: Map<string, Buffer>, kitapDizinleri: string[]}}
 *   `dosyalar`: index.html + MENU_YOLLARI'ndan build'de olanlar (bayt bayt)
 */
function oku(yol) {
  const hedef = path.resolve(String(yol));
  let st;
  try {
    st = fs.statSync(hedef);
  } catch (e) {
    throw new Error(`--menu-kaynak bulunamadı: ${hedef}`);
  }
  const aranan = [durum.INDEX_YOLU, ...durum.MENU_YOLLARI];
  const dosyalar = new Map();
  let kitaplar;
  if (st.isDirectory()) {
    for (const a of aranan) {
      const y = path.join(hedef, ...a.split('/'));
      if (fs.existsSync(y) && fs.statSync(y).isFile()) dosyalar.set(a, fs.readFileSync(y));
    }
    kitaplar = fs
      .readdirSync(hedef, { withFileTypes: true })
      .filter((d) => d.isDirectory() && durum.KITAP_DIZIN_DESENI.test(d.name))
      .map((d) => d.name);
  } else {
    const liste = zipListesi(hedef);
    const mevcut = new Set(liste);
    for (const a of aranan) {
      if (!mevcut.has(a)) continue;
      const v = zipGirdisiOku(hedef, a);
      if (v) dosyalar.set(a, v);
    }
    kitaplar = [...new Set(liste.map((g) => (KITAP_DIZIN_RE.exec(g) || [])[1]).filter(Boolean))];
  }
  kitaplar.sort((x, y) => Number(x.slice(4)) - Number(y.slice(4)));
  return { dosyalar, kitapDizinleri: kitaplar };
}

/**
 * Build menüsünü inceler ve G'ye gidecek dosyaları döndürür. RED (hata fırlatır):
 *   · kök index.html yok / biçim tanınmıyor (`menu.bicimTani`)
 *   · K17 menüsü → `index-yasak-k17`
 *   · Web-Z menü dosyası yok ya da yama ile settings'in `books`'ı eşit değil (menu.js kuralı)
 * @returns {{tur:'webz', menuDosyalari: Map<string, Buffer>, kartlar: string[]}}
 */
function incele(dosyalar) {
  const index = dosyalar.get(durum.INDEX_YOLU);
  if (!index) throw new Error('--menu-kaynak: kök index.html yok — menü biçimi bilinmiyor');
  const tur = menu.bicimTani(index);
  if (tur === 'k17') {
    throw new Error(
      `${K17_YASAK}: K17 menüsünün kartları index.html'de; ham build index'i platform ` +
        "shim'i taşımaz (Android RED eder) — menü G'ye menü olarak gitmez, --index kullanın",
    );
  }
  const yama = dosyalar.get(durum.MENU_WEBZ_YAMA);
  const ayar = dosyalar.get(durum.MENU_WEBZ_AYAR);
  if (!yama && !ayar) {
    throw new Error(
      `--menu-kaynak: Web-Z menü dosyası yok (${durum.MENU_WEBZ_YAMA} / ${durum.MENU_WEBZ_AYAR})`,
    );
  }
  let yamaKartlar = null;
  let ayarKartlar = null;
  if (yama) yamaKartlar = menu.menuKitaplari('webz', durum.MENU_WEBZ_YAMA, yama);
  if (ayar) ayarKartlar = menu.menuKitaplari('webz', durum.MENU_WEBZ_AYAR, ayar);
  if (yama && ayar) {
    const y = menu.yamaAyir(yama).ayarlar.books;
    const a = JSON.parse(ayar.toString('utf8')).books;
    if (menu.kanonik(y) !== menu.kanonik(a)) {
      throw new Error(
        `menü-books-ayrisik: ${durum.MENU_WEBZ_YAMA} ile ${durum.MENU_WEBZ_AYAR} farklı ` +
          'kitaplar listeliyor — hangisinin doğru olduğu bilinmiyor, yayın RED',
      );
    }
  }
  const menuDosyalari = new Map();
  for (const y of durum.MENU_YOLLARI) if (dosyalar.has(y)) menuDosyalari.set(y, dosyalar.get(y));
  const kartlar = [...new Set(yamaKartlar || ayarKartlar)].sort(
    (x, y) => Number(x.slice(4)) - Number(y.slice(4)),
  );
  return { tur, menuDosyalari, kartlar };
}

/** Kurulu menünün (tabanlar: yol → bayt) kart kümesi; taban yoksa null. */
function tabanKartlari(tabanlar) {
  const al = (y) => (tabanlar && tabanlar.get(y) != null ? tabanlar.get(y) : null);
  const index = al(durum.INDEX_YOLU);
  const tur = index == null ? 'webz' : menu.bicimTani(index);
  if (tur === 'k17') return { tur, kartlar: menu.menuKitaplari('k17', durum.INDEX_YOLU, index) };
  for (const y of [durum.MENU_WEBZ_YAMA, durum.MENU_WEBZ_AYAR]) {
    const v = al(y);
    if (v != null) return { tur, kartlar: menu.menuKitaplari('webz', y, v) };
  }
  return null;
}

function kumeAyni(a, b) {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((k) => y.has(k));
}

module.exports = { K17_YASAK, oku, incele, tabanKartlari, kumeAyni };
