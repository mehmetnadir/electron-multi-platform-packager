'use strict';

/**
 * WEB-Z TEMA KABUĞU (çevrimdışı kök menü) — 2026-10-02.
 * Tasarım: `.claude/docs/flashy-tema-offline.md`.
 *
 * NEDEN: Flashy setlerinin (74430, 59480, 60114) offline paketinde kök menü, kalıp build'den gelen
 * YDS'nin sf425 kabuğuydu (YDS logosu/teması). Nadir 02.10: "flashy'nin kendi index'i web'de var
 * onu aynen kullanabiliriz". Kaynak = Worker'ın `web-proxy-modern` teması (flashyelt.ndr.ist
 * `/go/<kod>/web-stream/`), bayt bayt kopyası `src/agent/webz-tema/web-proxy-modern/`
 * (`tools/webz-tema-esitle.js`; JS/CSS canlıyla 02.10'da cmp ile AYNI).
 *
 * NE YAPAR (SAF: girdi → Map<yol, Buffer>; ağ/fs yazımı YOK, yalnız paketli tema dosyaları okunur):
 *   · Tema JS/CSS/görselleri DEĞİŞTİRİLMEDEN çıkar.
 *   · `index.html`'de yalnız: CDN bağlantıları → `_vendor/` yerel kopyaları (FA 6.5.2 + Google
 *     Fonts), başlık = set adı, `scripts/cevrimdisi-yama.js` + `styles/cevrimdisi.css` eklenir,
 *     tanıma imzası `<meta name="empp-webz-tema">`.
 *   · `scripts/cevrimdisi-yama.js` (sf425 yamasıyla AYNI sözleşme: TEK `window.__setSettings`
 *     ataması → `g-yayin/menu.yamaAyir`, `set-uyelik-ek`, index üreteci yeniden yazabilir):
 *     config fetch'i gömülü ayardan, ünite listesi gömülü `__setUniteler`'den (yoksa boş →
 *     kitap doğrudan açılır; temanın "8 örnek ünite" yedeği ASLA çıkmaz), kapak = `coverUrl`,
 *     kitap açma = `bookN/index.html?defaultPageNo=<sayfa>` (İmpark motoru), link kartı dış adres.
 *   · `config/settings.json` + `set-menu.json` (aynı kitaplar; G/set-ek ikisinin eşitliğini arar).
 * Kitap içeriğine (bookN/**) DOKUNMAZ; kapak verilmezse `bookN/assets/<id>/thumbs/1.jpg`'yi
 * gösterir.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const gMenu = require('../../tools/g-yayin/menu');

const ISARET = '[webz-tema]';
const TEMA_KOKU = path.join(__dirname, 'webz-tema');
const YAMA = 'scripts/cevrimdisi-yama.js';
const STIL = 'styles/cevrimdisi.css';
const AYAR = 'config/settings.json';
const TANIM = 'set-menu.json';
const VENDOR = '_vendor';
const KAPAK = 'thumbs/1.jpg';
const IMZA_META = 'empp-webz-tema';

/**
 * Tanınan temalar. `dosyalar` = pakete GİREN tema dosyaları (örnek kapaklar/örnek ayar ve
 * index.html'in yüklemediği book-preloader.js girmez). `kurum` = İmpark UstKurumId (kanıt:
 * S_TestKitaplar 74430/69523/69084/59480/60114 → UstKurumId 310 "flashyelt", 02.10).
 */
const TEMALAR = Object.freeze({
  'web-proxy-modern': Object.freeze({
    yayinci: 'Flashy ELT',
    kurum: '310',
    dosyalar: Object.freeze([
      '_design/components.css', '_design/components.js', '_design/tokens.css', 'theme.css',
      'theme.js', 'scripts/library.js', 'scripts/xmlParser.js', 'images/bg.jpg',
      'images/logo.png',
    ]),
    cdn: Object.freeze([
      // [aranan bağlantı deseni, yerine konacak yerel stil yolu | null (satır silinir)]
      [/<link rel="preconnect" href="https:\/\/fonts\.(?:googleapis|gstatic)\.com"[^>]*>\s*/g,
        null],
      [/https:\/\/fonts\.googleapis\.com\/css2\?[^"]+/g, `${VENDOR}/fonts/fonts.css`],
      [/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/6\.5\.2\/css\/all\.min\.css/g,
        `${VENDOR}/fontawesome/css/all.min.css`],
    ]),
    yamaOncesi: '<script src="theme.js?v=2"></script>',
  }),
});

class KabukHatasi extends Error {
  constructor(mesaj, kod = 'kabuk') {
    super(`${ISARET} ${mesaj}`);
    this.kod = kod;
  }
}

// ─── Saf yardımcılar ────────────────────────────────────────────────────────────────────────

const htmlKacis = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Yayıncı adı ya da kurum numarasından tema; tanınmazsa null. SAF. */
function temaSec({ yayinci = '', kurum = null } = {}) {
  for (const [ad, t] of Object.entries(TEMALAR)) {
    if (kurum != null && String(kurum).trim() === t.kurum) return ad;
    if (yayinci && String(yayinci).trim().toLowerCase() === t.yayinci.toLowerCase()) return ad;
  }
  return null;
}

/** Görsel türü (ilk baytlar). Bilinmeyen → null. SAF. */
function gorselUzanti(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  const riff = buf.toString('latin1', 0, 4) === 'RIFF';
  if (riff && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** `data:image/...;base64,...` → Buffer (panel coverUrl'ü). Değilse null. SAF. */
function dataUriCoz(uri) {
  const m = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(uri || ''));
  return m ? Buffer.from(m[1].replace(/\s+/g, ''), 'base64') : null;
}

/**
 * BookContent.xml metni. Arşivde düz; bazı İmpark dağıtımlarında ilk 100 bayt `256-b` ile
 * gizli (motorun logo/xml gizlemesi). Okunamazsa null. SAF.
 */
function bookContentMetni(girdi) {
  if (girdi == null) return null;
  const buf = Buffer.isBuffer(girdi) ? Buffer.from(girdi) : Buffer.from(String(girdi), 'utf8');
  const duzMu = (b) => /<Book\b|<\?xml/.test(b.toString('utf8', 0, Math.min(b.length, 400)));
  if (duzMu(buf)) return buf.toString('utf8');
  for (let i = 0; i < 100 && i < buf.length; i++) buf[i] = (256 - buf[i]) & 255;
  return duzMu(buf) ? buf.toString('utf8') : null;
}

const attrOku = (etiket, ad) => {
  const m = new RegExp(`\\s${ad}="([^"]*)"`, 'i').exec(etiket);
  return m ? m[1] : null;
};
const xmlCoz = (s) => String(s).replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * Ünite listesi — temanın `scripts/xmlParser.js`'iyle AYNI kural (Unit/Chapter düğümleri;
 * ad = title || name; sayfa = page). Ünite yoksa []. SAF.
 * @returns {Array<{num:number, label:string, page:number|null}>}
 */
function uniteleriAyristir(xmlMetni) {
  if (!xmlMetni) return [];
  const etiketler = String(xmlMetni).match(/<(?:Unit|unit|Chapter|chapter)\b[^>]*>/g) || [];
  return etiketler.map((e, i) => ({
    num: i + 1,
    label: xmlCoz(attrOku(e, 'title') || attrOku(e, 'name') || '') || `Ünite ${i + 1}`,
    page: parseInt(attrOku(e, 'page') || '0', 10) || null,
  }));
}

/**
 * Kitap listesinden `settings.books` + kapak dosyaları + ünite haritası. SAF.
 * Anahtar sırası = liste sırası (tema `Object.entries` sırasıyla çizer); `displayOrder` da yazılır.
 */
function kitaplariKur(kitaplar) {
  if (!Array.isArray(kitaplar) || !kitaplar.length) {
    throw new KabukHatasi('kitap listesi boş', 'liste');
  }
  const books = {};
  const kapaklar = new Map();
  const uniteler = {};
  kitaplar.forEach((k, i) => {
    const link = !!(k && k.link);
    const dizin = String(k.dizin || (link ? `link${i + 1}` : `book${k.n || i + 1}`));
    if (!/^(?:book|link)\d+$/.test(dizin)) {
      throw new KabukHatasi(`geçersiz dizin ${dizin}`, 'liste');
    }
    if (books[dizin]) throw new KabukHatasi(`aynı dizin iki kez: ${dizin}`, 'liste');
    if (link) {
      const url = String(k.url || '');
      if (!/^https?:\/\/\S+$/i.test(url)) {
        throw new KabukHatasi(`${dizin}: link adresi geçersiz`, 'liste');
      }
      books[dizin] = {
        contentType: 'link', displayOrder: i, title: k.ad || 'Kısayol', type: 'link', url,
      };
      return;
    }
    const id = String(k.assetId == null ? '' : k.assetId);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new KabukHatasi(`${dizin}: assetId geçersiz`, 'liste');
    let coverUrl = `${dizin}/assets/${id}/${KAPAK}`;
    const kapak = Buffer.isBuffer(k.kapak) ? k.kapak : dataUriCoz(k.kapak);
    if (kapak) {
      const uz = gorselUzanti(kapak);
      if (!uz) throw new KabukHatasi(`${dizin}: kapak görsel değil`, 'kapak');
      coverUrl = `images/${dizin}.${uz}`;
      kapaklar.set(coverUrl, kapak);
    }
    books[dizin] = {
      assetId: id, contentType: k.contentType || 'book', coverUrl, displayOrder: i,
      title: k.ad || `Kitap ${i + 1}`, ...(k.grup ? { group: String(k.grup) } : {}),
    };
    const u = Array.isArray(k.uniteler)
      ? k.uniteler : uniteleriAyristir(bookContentMetni(k.bookContent));
    if (u.length) uniteler[id] = u;
  });
  return { books, kapaklar, uniteler };
}

/** Worker `generateSettingsJson` biçimi (çevrimdışı alanlarla). SAF. */
function ayarUret({ setAdi, yayinci, books }) {
  return {
    bookCount: Object.keys(books).length,
    books,
    contentVersion: null,
    extraMaterials: [],
    features: [],
    materials: { audio: false, 'extra-materials': false, games: false, videos: false },
    publisherName: yayinci,
    setTitle: setAdi,
    updates: { enabled: false },
  };
}

/** JSON'u <script> içine güvenle gömer (`</script>` ve U+2028/9 kırılmaz). SAF. */
const jsGom = (v) => JSON.stringify(v, null, 2).replace(/</g, '\\u003c')
  .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u' + '2028')
  .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u' + '2029');

/**
 * Çevrimdışı yama. Tema dosyalarına DOKUNMAZ; `file://` altında çalışmayanları sarar.
 * Yükleme sırası: components.js → xmlParser.js → library.js → BU → theme.js.
 * `openPage` theme.js'te `function` bildirimi (global, yazılabilir); theme.js onu tanımlamadan
 * ÖNCE atanırsa ezilir → atama DOMContentLoaded'da (bu dinleyici theme.js'inkinden önce kayıtlı,
 * önce koşar; theme.js'in `loadConfig`'i ondan sonra çalışır).
 * DİKKAT: `window.__setSettings` + `=` metinde TAM BİR KEZ geçer (yamaAyir sözleşmesi).
 */
function yamaUret({ ayarlar, uniteler }) {
  return `/* Web-Z tema kabuğu (web-proxy-modern) — çevrimdışı yaması. Üretici: runner
   src/agent/webz-tema-kabuk.js. Tema dosyalarına DOKUNULMAZ; burada yalnız \`file://\` altında
   çalışmayanlar sarılır: settings fetch'i, ünite XML'i, kitap açma yolu, kapak yolu. */
(function () {
  "use strict";
  window.__setSettings = ${jsGom(ayarlar)};
  window.__setUniteler = ${jsGom(uniteler)};
  window.__cevrimdisi = true;
  var ayar = window.__setSettings;
  if (ayar && ayar.books) {
    var ham = ayar.books;
    var sira = Object.keys(ham).sort(function (a, b) {
      var sa = ham[a] && typeof ham[a].displayOrder === "number" ? ham[a].displayOrder : 0;
      var sb = ham[b] && typeof ham[b].displayOrder === "number" ? ham[b].displayOrder : 0;
      return sa - sb;
    });
    var dizili = {};
    for (var i = 0; i < sira.length; i++) { dizili[sira[i]] = ham[sira[i]]; }
    ayar.books = dizili;
  }
  function kitaplar() { return (window.__setSettings && window.__setSettings.books) || {}; }
  function yanit(govde, tur) {
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: function () { return tur; } },
      json: function () { return Promise.resolve(JSON.parse(govde)); },
      text: function () { return Promise.resolve(govde); }
    });
  }
  var asilFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (girdi, secenekler) {
    var adres = typeof girdi === "string" ? girdi : (girdi && girdi.url) || "";
    if (String(adres).split("?")[0].indexOf("config/settings.json") !== -1) {
      return yanit(JSON.stringify(window.__setSettings), "application/json");
    }
    if (!asilFetch) { return Promise.reject(new Error("fetch yok")); }
    return asilFetch(girdi, secenekler);
  };
  /* Tema üniteleri kök-mutlak /Uploads/... adresinden çeker; çevrimdışında düşer ve "Unit N —
     Örnek" diye 8 SAHTE ünite gösterir. Gömülü liste yoksa [] → kitap doğrudan açılır. */
  if (window.xmlParser) {
    window.xmlParser.parseBookContent = function (assetId) {
      var u = window.__setUniteler && window.__setUniteler[String(assetId)];
      return Promise.resolve(u && u.length ? u.slice() : []);
    };
  }
  /* Kapak: tema images/bookN.png ister; çevrimdışı kapak settings.coverUrl'de. */
  if (window.FlashyUI && typeof window.FlashyUI.renderCardGrid === "function") {
    var asilCiz = window.FlashyUI.renderCardGrid;
    window.FlashyUI.renderCardGrid = function (kap, ogeler, tikla) {
      var b = kitaplar();
      (ogeler || []).forEach(function (o) {
        var k = b[o.id];
        if (!k) { return; }
        if (k.type === "link") { o.cover = ""; o.badge = "BAĞLANTI"; return; }
        if (k.coverUrl) { o.cover = k.coverUrl; }
      });
      return asilCiz.call(this, kap, ogeler, tikla);
    };
  }
  function kitapAc(kitapId, oge, unite) {
    var k = kitaplar()[kitapId];
    if (k && k.type === "link") {
      if (/^https?:\\/\\//i.test(String(k.url || ""))) { window.open(k.url, "_blank"); }
      return;
    }
    if (!/^book[0-9]+$/.test(String(kitapId))) { return; }
    var sayfa = (unite && unite.page) || 1;
    if (typeof window.showAcilisOrtusu === "function") {
      window.showAcilisOrtusu(oge && oge.title);
    }
    window.location.href = kitapId + "/index.html?defaultPageNo=" + sayfa;
  }
  window.__cevrimdisiKitapAc = kitapAc;
  document.addEventListener("DOMContentLoaded", function () { window.openPage = kitapAc; });
})();
`;
}

const STIL_METNI = `/* Web-Z tema kabuğu — çevrimdışı stiller (webz-tema-kabuk.js).
   Kütüphanem/PWA kısayolu web adresine (location.origin/go/<kod>) bağlı; file:// altında
   anlamsız ve kırık → gizlenir. Geri kalan tema aynen. */
#libraryBtn, #addSetBtn, #pwaInstallBanner, #installHelpModal, #libraryDrawer {
  display: none !important;
}
`;

/** Tema index.html'inin çevrimdışı hâli. SAF. */
function indexUret(ham, tema, setAdi) {
  const t = TEMALAR[tema];
  let s = String(ham);
  for (const [desen, yerine] of t.cdn) {
    const once = s;
    s = s.replace(desen, yerine == null ? '' : yerine);
    if (s === once) {
      throw new KabukHatasi(`index.html: beklenen CDN bağlantısı yok (${desen})`, 'tema');
    }
  }
  if (!/<title>[^<]*<\/title>/.test(s)) throw new KabukHatasi('index.html: <title> yok', 'tema');
  s = s.replace(/<title>[^<]*<\/title>/, `<title>${htmlKacis(setAdi)}</title>`);
  s = s.replace(/(<meta charset="UTF-8" \/>)/,
    `$1\n  <meta name="${IMZA_META}" content="${tema}" />`);
  if (!s.includes(IMZA_META)) throw new KabukHatasi('index.html: charset meta yok', 'tema');
  s = s.replace('</head>', `  <link rel="stylesheet" href="${STIL}" />\n</head>`);
  if (!s.includes(t.yamaOncesi)) throw new KabukHatasi(`index.html: ${t.yamaOncesi} yok`, 'tema');
  s = s.replace(t.yamaOncesi, `<script src="${YAMA}"></script>\n  ${t.yamaOncesi}`);
  return s;
}

function vendorDosyalari() {
  const kok = path.join(TEMA_KOKU, 'vendor');
  const out = new Map();
  const gez = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const y = path.join(d, e.name);
      if (e.isDirectory()) gez(y);
      else if (e.name !== 'KAYNAK.json') {
        out.set(`${VENDOR}/${path.relative(kok, y).split(path.sep).join('/')}`, fs.readFileSync(y));
      }
    }
  };
  gez(kok);
  return out;
}

/**
 * Ağa bağımlı başvurular (HTML src/href, CSS url()/@import; mutlak http(s), `//` ya da kök-mutlak
 * `/`). JS'te mutlak http(s) dizgisi. Yorumlar ve data: URI'ler sayılmaz. SAF.
 * @returns {Array<{dosya:string, adres:string}>}
 */
function agBagimliliklari(dosyalar) {
  const bulgu = [];
  const disMi = (a) => /^(?:https?:)?\/\//i.test(a) || (/^\//.test(a));
  for (const [ad, buf] of dosyalar) {
    const uz = path.extname(ad).toLowerCase();
    if (!['.html', '.css', '.js'].includes(uz)) continue;
    let m = buf.toString('utf8');
    if (ad === YAMA) {
      // Gömülü ayardaki link kartı adresi (Worksheet vb.) tıklamayla tarayıcıda açılır, yükleme
      // bağımlılığı değildir → ayar nesnesi taramaya girmez; yamanın KODU taranır.
      try {
        const yp = gMenu.yamaAyir(m);
        m = `${yp.once}{}${yp.sonra}`;
      } catch (_) { /* biçim dışı yama: tamamı taranır */ }
    }
    if (uz === '.css' || uz === '.js') m = m.replace(/\/\*[\s\S]*?\*\//g, '');
    if (uz === '.html') m = m.replace(/<!--[\s\S]*?-->/g, '');
    const adresler = [];
    if (uz === '.html') {
      for (const x of m.matchAll(/\s(?:src|href)\s*=\s*["']([^"']*)["']/gi)) adresler.push(x[1]);
    }
    if (uz === '.css' || uz === '.html') {
      for (const x of m.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) adresler.push(x[1]);
      for (const x of m.matchAll(/@import\s+["']([^"']+)["']/gi)) adresler.push(x[1]);
    }
    if (uz === '.js') {
      for (const x of m.matchAll(/["'`](https?:\/\/[^"'`\s]+)/gi)) adresler.push(x[1]);
    }
    for (const a of adresler) {
      if (/^(?:data:|#)/i.test(a)) continue;
      if (uz === '.js' || disMi(a)) bulgu.push({ dosya: ad, adres: a });
    }
  }
  return bulgu;
}

/** Üretilen JS'lerin sözdizimi (tema şablon kaçış tuzağı — gotchas). Hata → KabukHatasi. */
function sozdizimiDenetle(dosyalar) {
  for (const [ad, buf] of dosyalar) {
    if (!ad.endsWith('.js')) continue;
    try {
      new vm.Script(buf.toString('utf8'), { filename: ad }); // eslint-disable-line no-new
    } catch (e) {
      throw new KabukHatasi(`${ad} sözdizimi bozuk: ${e.message}`, 'sozdizimi');
    }
  }
}

// ─── Giriş noktası ──────────────────────────────────────────────────────────────────────────

/**
 * Kök kabuk dosyaları.
 * @param {{tema?:string, setAdi:string, yayinci?:string,
 *   kitaplar:Array<{n?:number, dizin?:string, assetId?:string, ad:string, grup?:string,
 *     contentType?:string, kapak?:Buffer|string|null, bookContent?:Buffer|string|null,
 *     uniteler?:Array<{num:number,label:string,page:number|null}>, link?:boolean, url?:string}>}} o
 * @returns {{dosyalar: Map<string, Buffer>, ayarlar: object, uniteler: object, tema: string}}
 */
function kabukUret(o) {
  const tema = (o && o.tema) || 'web-proxy-modern';
  const t = TEMALAR[tema];
  if (!t) throw new KabukHatasi(`bilinmeyen tema ${tema}`, 'parametre');
  const setAdi = String((o && o.setAdi) || '').trim();
  if (!setAdi) throw new KabukHatasi('set adı boş', 'parametre');
  const yayinci = String(o.yayinci || t.yayinci);
  const { books, kapaklar, uniteler } = kitaplariKur(o.kitaplar);
  const ayarlar = ayarUret({ setAdi, yayinci, books });

  const temaDizini = path.join(TEMA_KOKU, tema);
  const dosyalar = new Map();
  for (const y of t.dosyalar) dosyalar.set(y, fs.readFileSync(path.join(temaDizini, y)));
  dosyalar.set('index.html', Buffer.from(indexUret(
    fs.readFileSync(path.join(temaDizini, 'index.html'), 'utf8'), tema, setAdi)));
  dosyalar.set(YAMA, Buffer.from(yamaUret({ ayarlar, uniteler })));
  dosyalar.set(STIL, Buffer.from(STIL_METNI));
  dosyalar.set(AYAR, Buffer.from(`${JSON.stringify(ayarlar, null, 2)}\n`));
  const tanim = {
    arkaPlanVarMi: false,
    kitaplar: Object.entries(books).filter(([, b]) => b.type !== 'link').map(([d, b]) => ({
      ad: b.title, assetId: b.assetId, dugmeGorseliVarMi: false, grup: b.group || '',
      id: gMenu.kararliKimlik(d, b.assetId), kapakVarMi: b.coverUrl.startsWith('images/'),
      klasor: d, klasorElleYazildi: false,
    })),
    kunye: `© ${yayinci}`,
    logoVarMi: true,
    setAdi,
    tema,
  };
  dosyalar.set(TANIM, Buffer.from(`${JSON.stringify(tanim, null, 2)}\n`));
  for (const [y, b] of kapaklar) dosyalar.set(y, b);
  for (const [y, b] of vendorDosyalari()) dosyalar.set(y, b);

  sozdizimiDenetle(dosyalar);
  const ag = agBagimliliklari(dosyalar);
  if (ag.length) {
    const ozet = ag.slice(0, 3).map((x) => `${x.dosya}→${x.adres}`).join(', ');
    throw new KabukHatasi(`ağ bağımlılığı kaldı: ${ozet}`, 'ag');
  }
  return { dosyalar, ayarlar, uniteler, tema };
}

module.exports = {
  ISARET, TEMALAR, KabukHatasi, YAMA, STIL, AYAR, TANIM, VENDOR, IMZA_META, TEMA_KOKU,
  temaSec, gorselUzanti, dataUriCoz, bookContentMetni, uniteleriAyristir, kitaplariKur,
  ayarUret, yamaUret, indexUret, agBagimliliklari, sozdizimiDenetle, kabukUret,
};
