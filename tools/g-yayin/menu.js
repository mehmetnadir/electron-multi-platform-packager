'use strict';

/**
 * G MENÜ — `--ekle` / `--cikar`'ın kurulu SET menüsüne yansıması (2026-09-26).
 *
 * NEDEN: g-yayin set bileşimini değiştiriyordu ama menüye dokunmuyordu → G ile ÇIKARILAN kitap
 * menüde kalıyor, EKLENEN görünmüyordu (Android ajanı bulgusu; koddan doğrulandı):
 *   · Web-Z (sf425) kabuğu kartları `settings.books`'un ANAHTARLARINDAN çizer (Üretim Masası
 *     `Kaynaklar/sf425/scripts/language-set.js` `loadLanguageSet`); anahtarı olmayan kitap aday
 *     bile olmaz. Çevrimdışı pakette `config/settings.json` `fetch` edilemez (`file://`), kaynak
 *     `scripts/cevrimdisi-yama.js`'teki gömülü `window.__setSettings`'tir (`WebZTemaUretici.swift`
 *     `yamaBetigi`). Yamanın `parseBookContent` sarmalayıcısı okunamayan kitaba tek ünite
 *     döndürdüğü için dizini silinmiş kitabın kartı da DÜŞMEZ.
 *   · K17 (paketleyici, `src/packaging/set-menu.js`) sade menüsünün kartları kök `index.html`'e
 *     yazılı `<a class="kart">` satırlarıdır.
 *
 * İKİ BİÇİM TANINIR, gerisi RED (sessiz geçiş yok):
 *   webz  kök index Web-Z kabuğu → düzenlenen: `scripts/cevrimdisi-yama.js`, `config/settings.json`
 *         (en az biri; ikisi de varsa `books`'ları birebir aynı olmalı, ayrışmışsa RED) ve varsa
 *         masaüstünün tanımı `set-menu.json` (kabul araçları kitap adlarını oradan okur).
 *   k17   kök index paketleyicinin sade menüsü → düzenlenen: `index.html`; kart satırı
 *         paketleyicinin satırının AYNISI (`set-menu-bicim.sadeKartHtml`).
 *   Yayıncı tasarımlı K17 (assets2 düğme görseli G ile üretilemez) ve yayıncının kendi menüsü RED.
 *
 * İDEMPOTENT: eklenen kitabın kartı yeni arşivden türetilen kartla zaten aynıysa, çıkarılan
 * zaten yoksa o dosyanın baytı değişmez (çıktıda yer almaz).
 *
 * Saf modül: ağ/fs YOK (tabanları çağıran okur). Node stdlib dışında bağımlılık yok.
 * BOZARSAN: `menu.test.js`, `yayinla.test.js` menü testleri ve `tools/g-uctan-uca` "gecerli"
 * (Web-Z) + "menu-k17" senaryoları kırılır.
 */

const crypto = require('crypto');
const bicim = require('../../src/packaging/set-menu-bicim');
const durum = require('./durum');

const { INDEX_YOLU, MENU_WEBZ_YAMA, MENU_WEBZ_AYAR, MENU_MASA_TANIMI } = durum;
/** Menü biçimini tanımak ve düzenlemek için okunan TABAN dosyaları. */
const TABAN_YOLLARI = Object.freeze([INDEX_YOLU, ...durum.MENU_YOLLARI]);
/** Eklenen kitabın arşivinde kitap kimliğini (assetId) veren dosya. */
const BOOKCONTENT_RE = /^assets\/([^/]+)\/(?:data\/)?BookContent\.xml$/;
const YAMA_ATAMASI = /window\.__setSettings\s*=\s*/g;
const KART_SATIRI = /^[ \t]*<a class="kart" href="(book\d+)\/index\.html">.*<\/a>[ \t]*$/;

function metin(v) {
  return Buffer.isBuffer(v) ? v.toString('utf8') : String(v);
}

/** Anahtar sırasından bağımsız JSON — "aynı mı" kıyası için. */
function kanonik(v) {
  if (Array.isArray(v)) return `[${v.map(kanonik).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${kanonik(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

function kitapNo(d) {
  return Number(String(d).slice(4));
}

function kacisCoz(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/* ------------------------------------------------------------------ biçim */

/** Kök `index.html` → 'webz' | 'k17'; düzenlenemeyen/tanınmayan biçim → HATA. */
function bicimTani(indexHtml) {
  const s = metin(indexHtml);
  if (s.includes(bicim.MENU_ISARETI)) {
    if (s.includes('class="book-buttons"')) {
      throw new Error(
        'menü düzenlenemez: yayıncı tasarımlı K17 menüsü (assets2 düğme görseli G ile ' +
          'üretilemez) — kartları taşıyan yeni bir --index verin',
      );
    }
    if (!/<main>[\s\S]*<\/main>/.test(s))
      throw new Error('menü biçimi tanınmadı: K17 imzası var ama <main> bölümü yok');
    return 'k17';
  }
  if (bicim.webZKabukIndexiMi(s)) return 'webz';
  throw new Error(
    'menü biçimi tanınmadı: kök index.html ne Web-Z kabuğu ne K17 menüsü (yayıncının kendi ' +
      'menüsü G ile düzenlenmez) — --ekle/--cikar menüye yansıtılamıyor, yayın RED',
  );
}

/** `bas`'taki `{` ile başlayan JSON nesnesinin bittiği indeks (dizgi/kaçış bilinçli); yoksa -1. */
function jsonSonu(s, bas) {
  if (s[bas] !== '{') return -1;
  let derinlik = 0;
  let dizgi = false;
  let kacis = false;
  for (let i = bas; i < s.length; i++) {
    const c = s[i];
    if (dizgi) {
      if (kacis) kacis = false;
      else if (c === '\\') kacis = true;
      else if (c === '"') dizgi = false;
    } else if (c === '"') dizgi = true;
    else if (c === '{' || c === '[') derinlik += 1;
    else if (c === '}' || c === ']') {
      derinlik -= 1;
      if (derinlik === 0) return i + 1;
    }
  }
  return -1;
}

/** Çevrimdışı yamayı gömülü ayar nesnesi + çevresine ayırır. Tek atama şart. */
function yamaAyir(yamaMetni) {
  const s = metin(yamaMetni);
  const eslesmeler = [...s.matchAll(YAMA_ATAMASI)];
  if (eslesmeler.length !== 1) {
    throw new Error(
      `${MENU_WEBZ_YAMA}: window.__setSettings ataması ${eslesmeler.length} kez var ` +
        '(tam 1 olmalı) — biçim tanınmadı',
    );
  }
  const bas = eslesmeler[0].index + eslesmeler[0][0].length;
  const son = jsonSonu(s, bas);
  if (son < 0 || !/^\s*;/.test(s.slice(son)))
    throw new Error(`${MENU_WEBZ_YAMA}: gömülü ayar nesnesi okunamadı — biçim tanınmadı`);
  let ayarlar;
  try {
    ayarlar = JSON.parse(s.slice(bas, son));
  } catch (e) {
    throw new Error(`${MENU_WEBZ_YAMA}: gömülü ayar JSON değil — biçim tanınmadı`);
  }
  return { once: s.slice(0, bas), sonra: s.slice(son), ayarlar };
}

function booksAl(ayarlar, ne) {
  const b = ayarlar && ayarlar.books;
  if (!b || typeof b !== 'object' || Array.isArray(b))
    throw new Error(`${ne}: books nesnesi yok — biçim tanınmadı`);
  return b;
}

/* ------------------------------------------------------------------ eklenen kitap */

/**
 * Eklenen kitabın menü girdisi — KAYNAK KURALI (sözleşme `kitap-guncelleme-sozlesmesi.md`
 * "G yayın aracı"):
 *   ad       `--baslik bookN=<ad>` > arşivdeki `BookContent.xml` `pdfUrl` adı (paketleyiciyle aynı
 *            kural; sayısal ad kimliktir, ad sayılmaz) > menüdeki mevcut ad > "Kitap <sıra>"
 *   assetId  arşivde `assets/<id>/(data/)BookContent.xml` taşıyan TEK dizin (Web-Z'de zorunlu:
 *            tema assetId'siz kartı eler)
 *   kapak    o dizindeki ilk `KAPAK_ADAYLARI` dosyası, köke göreli
 *            (`bookN/assets/<id>/thumbs/1.jpg`)
 * @param {string} dizin  `bookN`
 * @param {string[]} yollar  arşiv içi yollar (kitap köküne göreli, `/` ayraçlı)
 * @param {Object<string,string>} xmlBaslari  assetId → `BookContent.xml`'in ilk 8 KB'ı
 * @param {string|null} baslik  `--baslik` değeri
 */
function kitapBilgisi(dizin, yollar, xmlBaslari, baslik) {
  const kume = new Set((yollar || []).map((y) => String(y).replace(/\\/g, '/')));
  const idler = [
    ...new Set(
      [...kume]
        .map((y) => /^assets\/([^/]+)\//.exec(y))
        .filter(Boolean)
        .map((m) => m[1]),
    ),
  ].sort();
  const xmlli = [
    ...new Set(
      [...kume]
        .map((y) => BOOKCONTENT_RE.exec(y))
        .filter(Boolean)
        .map((m) => m[1]),
    ),
  ].sort();
  const assetId = xmlli.length === 1 ? xmlli[0] : null;
  let assetIdSebep = null;
  if (xmlli.length === 0) assetIdSebep = 'arşivde assets/<id>/data/BookContent.xml yok';
  else if (xmlli.length > 1) {
    assetIdSebep = `arşivde birden çok kitap kimliği (${xmlli.join(', ')})`;
  }
  const adaylar = assetId ? [assetId] : idler;
  let kapak = null;
  for (const id of adaylar) {
    const k = bicim.KAPAK_ADAYLARI.find((a) => kume.has(`assets/${id}/${a}`));
    if (k) {
      kapak = `${dizin}/assets/${id}/${k}`;
      break;
    }
  }
  let xmlAdi = null;
  for (const id of adaylar) {
    xmlAdi = bicim.kitapAdiBookContenttan((xmlBaslari || {})[id]);
    if (xmlAdi) break;
  }
  const b = baslik == null ? '' : String(baslik).trim();
  return { dizin, assetId, assetIdSebep, kapak, ad: b || xmlAdi || null, baslikVerildi: !!b };
}

/* ------------------------------------------------------------------ K17 */

function kartDizini(satir) {
  const m = KART_SATIRI.exec(satir);
  return m ? m[1] : null;
}

function k17Duzenle(html, ekleListe, cikar, sonuc) {
  let satirlar = html.split('\n');
  for (const d of cikar) {
    const once = satirlar.length;
    satirlar = satirlar.filter((s) => kartDizini(s) !== d);
    sonuc[d] = satirlar.length < once ? 'cikarildi' : 'zaten-yok';
  }
  for (const [d, b] of ekleListe) {
    const kartlar = satirlar.map((s, i) => [kartDizini(s), i]).filter(([k]) => k);
    const mevcut = satirlar.findIndex((s) => kartDizini(s) === d);
    let yer;
    let sira;
    let eskiAd = null;
    if (mevcut >= 0) {
      yer = mevcut;
      sira = kartlar.findIndex(([, i]) => i === mevcut);
      const m = /<span>(.*)<\/span><\/a>/.exec(satirlar[mevcut]);
      eskiAd = m ? kacisCoz(m[1]) : null;
    } else {
      // Paketleyici kartları kitap numarası sırasıyla yazar; yeni kart da sırasına girer.
      const sonraki = kartlar.find(([k]) => kitapNo(k) > kitapNo(d));
      sira = sonraki ? kartlar.indexOf(sonraki) : kartlar.length;
      if (sonraki) yer = sonraki[1];
      else if (kartlar.length) yer = kartlar[kartlar.length - 1][1] + 1;
      else {
        yer = satirlar.findIndex((s) => s.includes('</main>'));
        if (yer < 0) throw new Error('K17 menüsü: </main> satırı yok — biçim tanınmadı');
      }
    }
    const ad = b.ad || eskiAd || `Kitap ${sira + 1}`;
    const satir = bicim.sadeKartHtml({ dir: d, ad, kapak: b.kapak }, sira);
    if (mevcut >= 0) {
      sonuc[d] = satirlar[mevcut] === satir ? 'zaten-var' : 'guncellendi';
      satirlar[mevcut] = satir;
    } else {
      satirlar.splice(yer, 0, satir);
      sonuc[d] = 'eklendi';
    }
  }
  return satirlar.join('\n');
}

/* ------------------------------------------------------------------ Web-Z */

function webzKitaplar(books, ekleListe, cikar, sonuc) {
  const yeni = { ...books };
  for (const d of cikar) {
    sonuc[d] = d in yeni ? 'cikarildi' : 'zaten-yok';
    delete yeni[d];
  }
  for (const [d, b] of ekleListe) {
    if (!b.assetId) {
      throw new Error(
        `--ekle ${d}: Web-Z menüsü kitap kimliği (assetId) ister, tema kimliksiz kartı ` +
          `göstermez — ${b.assetIdSebep}`,
      );
    }
    if (!b.kapak) {
      throw new Error(
        `--ekle ${d}: menü kapağı yok (arşivde assets/${b.assetId}/` +
          `{${bicim.KAPAK_ADAYLARI.join(',')}} yok)`,
      );
    }
    const mevcut = yeni[d] && typeof yeni[d] === 'object' ? yeni[d] : null;
    const digerSiralar = Object.entries(yeni)
      .filter(([k, v]) => k !== d && v && typeof v.displayOrder === 'number')
      .map(([, v]) => v.displayOrder);
    let sira = Object.keys(yeni).length;
    if (mevcut && typeof mevcut.displayOrder === 'number') sira = mevcut.displayOrder;
    else if (digerSiralar.length) sira = Math.max(...digerSiralar) + 1;
    const kayit = {
      ...(mevcut || {}),
      assetId: String(b.assetId),
      contentType: 'book',
      coverUrl: b.kapak,
      displayOrder: sira,
      title:
        b.ad || (mevcut && mevcut.title) || `Kitap ${Object.keys(yeni).length + (mevcut ? 0 : 1)}`,
    };
    delete kayit.type;
    delete kayit.url;
    if (mevcut && kanonik(mevcut) === kanonik(kayit)) sonuc[d] = 'zaten-var';
    else {
      sonuc[d] = mevcut ? 'guncellendi' : 'eklendi';
      yeni[d] = kayit;
    }
  }
  return yeni;
}

function webzUygula(ayarlar, books) {
  const cikti = { ...ayarlar, books };
  if (typeof ayarlar.bookCount === 'number') cikti.bookCount = Object.keys(books).length;
  return cikti;
}

/** Deterministik UUID biçimli kimlik — masaüstü tanımı her kitaba bir `id` ister. */
function kararliKimlik(d, assetId) {
  const h = crypto.createHash('sha256').update(`g-yayin-menu:${d}:${assetId}`).digest('hex');
  const parca = [h.slice(0, 8), h.slice(8, 12), `4${h.slice(13, 16)}`, `8${h.slice(17, 20)}`];
  return [...parca, h.slice(20, 32)].join('-').toUpperCase();
}

function masaTanimiDuzenle(tanim, ekleListe, cikar, books) {
  if (!tanim || !Array.isArray(tanim.kitaplar))
    throw new Error(`${MENU_MASA_TANIMI}: kitaplar dizisi yok — biçim tanınmadı`);
  const kitaplar = tanim.kitaplar.filter((k) => !(k && cikar.includes(k.klasor)));
  for (const [d] of ekleListe) {
    const w = books[d];
    const i = kitaplar.findIndex((k) => k && k.klasor === d);
    const taban =
      i >= 0
        ? kitaplar[i]
        : {
            dugmeGorseliVarMi: false,
            grup: '',
            id: kararliKimlik(d, w.assetId),
            kapakVarMi: false,
            klasorElleYazildi: false,
          };
    const yeni = { ...taban, ad: w.title, assetId: w.assetId, klasor: d };
    if (i >= 0) kitaplar[i] = yeni;
    else kitaplar.push(yeni);
  }
  return { ...tanim, kitaplar };
}

/* ------------------------------------------------------------------ ana giriş */

/** Menü dosyası → kartı olan kitap dizinleri. `tur` önceden `bicimTani` ile belirlenmiş olmalı. */
function menuKitaplari(tur, yol, veri) {
  const s = metin(veri);
  if (tur === 'k17') {
    return yol === INDEX_YOLU ? s.split('\n').map(kartDizini).filter(Boolean) : [];
  }
  if (yol === MENU_WEBZ_YAMA) return Object.keys(booksAl(yamaAyir(s).ayarlar, yol));
  if (yol === MENU_WEBZ_AYAR) return Object.keys(booksAl(JSON.parse(s), yol));
  if (yol === MENU_MASA_TANIMI) return (JSON.parse(s).kitaplar || []).map((k) => k && k.klasor);
  return [];
}

/**
 * @param {{tabanlar: Map<string, Buffer|string|null>, ekle?: Object<string, object>,
 *   cikar?: string[]}} g  `tabanlar`: kurulu menünün bilinen hâli (`TABAN_YOLLARI`);
 *   `ekle`: bookN → `kitapBilgisi` çıktısı
 * @returns {{bicim:'webz'|'k17', dosyalar: Map<string, Buffer>, kitaplar: Object<string,string>}}
 *   `dosyalar` yalnız DEĞİŞEN menü dosyaları; `kitaplar` bookN → eklendi | guncellendi |
 *   zaten-var | cikarildi | zaten-yok
 */
function menuGuncelle({ tabanlar, ekle = {}, cikar = [] }) {
  const al = (y) => (tabanlar && tabanlar.get(y) != null ? metin(tabanlar.get(y)) : null);
  const index = al(INDEX_YOLU);
  // Web-Z'de index.html G'ye girmez; önceki G durumu yalnız menü dosyalarını taşıyorsa biçim
  // onlardan bellidir (o dosyalar G'ye ancak Web-Z menüsü düzenlenirken girer).
  const webzDosyasiVar = al(MENU_WEBZ_YAMA) != null || al(MENU_WEBZ_AYAR) != null;
  if (index == null && !webzDosyasiVar) {
    throw new Error(
      "menü tabanı yok: kurulu paketin kök index.html'i bilinmiyor — --menu-taban " +
        '<paketlenmiş SET kökü> verin (ya da --index)',
    );
  }
  const tur = index == null ? 'webz' : bicimTani(index);
  const ekleListe = Object.entries(ekle).sort(([a], [b]) => kitapNo(a) - kitapNo(b));
  const kitaplar = {};
  const dosyalar = new Map();
  if (tur === 'k17') {
    const yeni = k17Duzenle(index, ekleListe, cikar, kitaplar);
    if (yeni !== index) dosyalar.set(INDEX_YOLU, Buffer.from(yeni, 'utf8'));
  } else {
    const yama = al(MENU_WEBZ_YAMA);
    const ayar = al(MENU_WEBZ_AYAR);
    const tanim = al(MENU_MASA_TANIMI);
    if (yama == null && ayar == null) {
      throw new Error(
        `Web-Z menüsü: kartların kaynağı (${MENU_WEBZ_YAMA} / ${MENU_WEBZ_AYAR}) bilinmiyor — ` +
          '--menu-taban <paketlenmiş SET kökü> verin',
      );
    }
    const yp = yama != null ? yamaAyir(yama) : null;
    let ap = null;
    if (ayar != null) {
      try {
        ap = JSON.parse(ayar);
      } catch (e) {
        throw new Error(`${MENU_WEBZ_AYAR}: JSON değil — biçim tanınmadı`);
      }
    }
    const books = booksAl(yp ? yp.ayarlar : ap, yp ? MENU_WEBZ_YAMA : MENU_WEBZ_AYAR);
    if (yp && ap && kanonik(booksAl(ap, MENU_WEBZ_AYAR)) !== kanonik(books)) {
      throw new Error(
        `Web-Z menüsü ayrışmış: ${MENU_WEBZ_YAMA} ile ${MENU_WEBZ_AYAR} farklı kitaplar ` +
          'listeliyor — hangisinin doğru olduğu bilinmiyor, yayın RED',
      );
    }
    const yeniBooks = webzKitaplar(books, ekleListe, cikar, kitaplar);
    if (yp) {
      const y2 = webzUygula(yp.ayarlar, yeniBooks);
      if (kanonik(y2) !== kanonik(yp.ayarlar)) {
        dosyalar.set(MENU_WEBZ_YAMA, Buffer.from(yp.once + JSON.stringify(y2, null, 2) + yp.sonra));
      }
    }
    if (ap) {
      const a2 = webzUygula(ap, yeniBooks);
      if (kanonik(a2) !== kanonik(ap))
        dosyalar.set(MENU_WEBZ_AYAR, Buffer.from(JSON.stringify(a2, null, 2) + '\n'));
    }
    if (tanim != null) {
      let t;
      try {
        t = JSON.parse(tanim);
      } catch (e) {
        throw new Error(`${MENU_MASA_TANIMI}: JSON değil — biçim tanınmadı`);
      }
      const t2 = masaTanimiDuzenle(t, ekleListe, cikar, yeniBooks);
      if (kanonik(t2) !== kanonik(t))
        dosyalar.set(MENU_MASA_TANIMI, Buffer.from(JSON.stringify(t2, null, 2) + '\n'));
    }
  }
  // Tutarlılık kapısı: son hâl YENİDEN okunur — her menü dosyasında eklenen var, çıkarılan yok.
  const denetlenen = tur === 'k17' ? [INDEX_YOLU] : durum.MENU_YOLLARI;
  for (const yol of denetlenen) {
    const v = dosyalar.has(yol) ? dosyalar.get(yol) : al(yol);
    if (v == null) continue;
    const liste = menuKitaplari(tur, yol, v);
    for (const [d] of ekleListe)
      if (!liste.includes(d)) throw new Error(`iç tutarsızlık: ${d} menüye girmedi (${yol})`);
    for (const d of cikar)
      if (liste.includes(d)) throw new Error(`iç tutarsızlık: ${d} menüden kalkmadı (${yol})`);
  }
  return { bicim: tur, dosyalar, kitaplar };
}

module.exports = {
  TABAN_YOLLARI,
  BOOKCONTENT_RE,
  bicimTani,
  yamaAyir,
  kitapBilgisi,
  menuKitaplari,
  menuGuncelle,
  kanonik,
  kararliKimlik,
};
