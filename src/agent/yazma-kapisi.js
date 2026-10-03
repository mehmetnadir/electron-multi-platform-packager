'use strict';

/**
 * build.zip YAZMA KAPISI (exe'siz kaynak Dalga B / B5) — saf modül.
 * Sözleşme: `exesiz-kaynak-sozlesmesi.md` §5 "Kapı (yazmadan önce)".
 *
 * Runner bir set build'ini kurunca (arşiv + içerik merdiveni + set eki) R2'ye YAZMADAN önce
 * buradan geçirir. Geçmeyen yazılmaz, eski sürüm geçerli kalır. Kurallar:
 *   1. kitap kimlikleri = set listesi (link: satırları kitap değildir). Sayı eşitliği DEĞİL, kimlik
 *      eşlemesi (02.10, 45549: Web-Z listesi 4 İmpark kitabı, build'de kimliği "0" olan korunan 5. ek):
 *      - listedeki her İmpark kimliğinin build'de bir bookN'si olmalı (yoksa `kitap-eksik`);
 *      - build'de listede olmayan, kimliği İmpark kimliği OLAN bookN → RED `liste-disi-kitap`;
 *      - kimliği İmpark kimliği olmayan (null, "0", boş, sayısal değil) fazla bookN KABUL edilir,
 *        `notlar`'a "liste dışı ek korundu: bookN" yazılır (merdiven ATLANDI + set eki "korundu").
 *      KİMLİK ÇÖZÜMÜ (02.10, 45550/45538/45695): bookN'in kimliği sırayla
 *        (a) `bookN/assets/<id>` dizin adı İmpark kimliğiyse o;
 *        (a2) değilse `bookN/classlibraries/ImWin32.dll` menüsündeki TEK kapak kimliği İmpark
 *            kimliğiyse o — merdivenin (S0), K4 kabulünün ve set ekinin okuduğu yer (motorun
 *            `menuCoz` + `kapaklar`). 45538 book2 `assets/English-Up-5-Workbook` = 6376, 45695
 *            `Classmate-A1-WorkBook` = 3358. Bu kitap İmpark kitabıdır (`kitaplar`, liste/içerik/kapak
 *            denetimi aynen);
 *        (b) hâlâ İmpark kimliği yoksa (Games/Videos: dizin `Grade-6-Games`, kapak ID "0") liste
 *            kimliği uygulamanın assetId'yi okuduğu yerden eşlenir — menü `settings.books[bookN]
 *            .assetId` (`scripts/cevrimdisi-yama.js` `window.__setSettings` öncelikli, yoksa
 *            `config/settings.json`; tema `language-set.js` bunu `xmlParser.parseBookContent`'e verir);
 *        (c) son çare liste başlığı ↔ menü başlığı (`set-uyelik-ek.eslestir` `ad` yolu — set eki
 *            ile AYNI fonksiyon, ikinci eşleyici yok).
 *      (b)/(c) ile eşleşen bookN `webzVarliklari`'na `{n, id, yol: 'config'|'ad', icerik, kapak}`
 *      girer (`kitaplar`'a KARIŞMAZ, İmpark içerik sürümü beklenmez); `icerik` = `assets/<dizin>/
 *      data/BookContent.xml` var ve boş değil — yoksa RED `icerik-yok`. Hiçbir yoldan eşleşmeyen
 *      liste kimliği yine `kitap-eksik` (gerçek eksik kitap reddi korunur).
 *      İmpark kimliği ölçütü `icerik-merdiven.imparkKimligiMi` ile aynı (/^[1-9]\d*$/).
 *      Liste yoksa: tür `manuel` → kimlik denetimi
 *      ATLANIR (Nadir 01.10); `otomatik` ve set yapılı build → liste yok = ret. Tek kitap yapılı
 *      build (bookN yok) listesiz geçer.
 *      TEK MOTORLU SET (02.10, index üreteci; İmpark'ın kendi set exe'si 45472/45480 aynı düzen):
 *      bookN yok, kök `classlibraries/ImWin32.dll` ≥2 İmpark kapağı → her kapak bir kitap (n = menü
 *      sırası), içerik/kapak `assets/<kapak ID>/` altında ölçülür; listesiz otomatik tür = ret.
 *   2. her kitapta içerik (`assets/<id>/data/BookContent.xml` + ilk sayfa `pages/1.*`) VE kapak
 *      (`assets/<id>/thumbs/1.jpg`) — set-uyelik-ek kapısıyla aynı ölçüt.
 *   2c. kök `index.html`'in YEREL başvuruları (script src, link href, img src; göreli yol) zip'te var
 *      olmalı (03.10, 59480 Flashy: `_design/`, `_vendor/` pakette yoktu, menü açılmadı). http(s), `//`,
 *      `data:`, `#`, kök-mutlak `/…` ve betik/mailto şemaları sayılmaz. RED `index-referans-eksik`.
 *      NOT: bu kapı ZIP'i ölçer; paketleyicinin sonradan dışladığı dosyayı (`!_*`) görmez — o sınıf
 *      için `webz-tema-kabuk` üretimi `_` önekli kök dizini reddeder + paket-disi-liste sözleşme testi.
 *   3. boyut ≥ oncekiBoyut × 0,8 (oncekiBoyut ya da boyut yoksa atlanır). Altındaysa ve önceki build
 *      sayfa envanteri (`oncekiEnvanter`) kitap başına sayfa-tam ise RED değil UYARI `boyut-dustu-sayfa-tam`.
 * Zip listesi `icerik-kapisi.zipGirisAdlariniOku` (= `unzip -Z1`) ile okunur; adm-zip KULLANILMAZ
 * (2 GiB+ zip'te ERR_FS_FILE_TOO_LARGE). `__MACOSX`, `._*`, `.DS_Store` yok sayılır; tek sarmalayıcı
 * klasör bir seviye tolere edilir (icerik-kapisi ile aynı).
 *
 * Dönen `kitaplar` = sunucu `POST /agents/:id/kaynak/tamamla` gövdesindeki `kitaplar` alanı:
 * `{n, id, vs?, icerik, kapak}`. `vs` yalnız `vsler` ({ n: vs }) verildiyse (merdiven kanıtı).
 * Kabul edilen liste dışı ekler `kitaplar`'a GİRMEZ (sunucuya yalnız liste kitapları gider), `notlar`'da görünür.
 * `webzVarliklari` = `tamamla` gövdesinin aynı adlı alanı (sunucu `sunucuKapisi` liste kimliğini
 * `kitaplar ∪ webzVarliklari` içinde arar; eski sunucu alanı yok sayar).
 * `nedenKodlari` = makine okur ret kodları (tekilleştirilmiş), `birak` gövdesine gider.
 */

const fs = require('fs');
const path = require('path');
const { girisleriTemizle, bookNMi, zipGirisAdlariniOku, OKUNAMADI_ISARETI } = require('./icerik-kapisi');
const { setListesiAyristir, eslestir, menuBooksOku, MENU_YOLLARI } = require('./set-uyelik-ek');
const M = require('./icerik-merdiven');
const ig = require('../runtime/icerik-guncelleme');

const KAPI_ISARETI = '[yazma-kapisi]';
const BOYUT_ORANI = 0.8;
const ILK_SAYFA = Object.freeze(['pages/1.png', 'pages/1.jpg', 'pages/1.jpeg', 'pages/1.webp']);
const KAPAK = 'thumbs/1.jpg';
const KOD = Object.freeze({
  OKUNAMADI: 'giris-listesi-okunamadi', LISTE_YOK: 'liste-yok', KITAP_YOK: 'kitap-yok',
  KITAP_EKSIK: 'kitap-eksik', LISTE_DISI: 'liste-disi-kitap', ID_YOK: 'id-yok',
  ICERIK_YOK: 'icerik-yok', KAPAK_YOK: 'kapak-yok', BOYUT: 'boyut-dustu', BOYUT_SAYFA_TAM: 'boyut-dustu-sayfa-tam', GIRIS_YOK: 'giris-yok',
  REFERANS_EKSIK: 'index-referans-eksik',
});

/**
 * Kök index.html'in YEREL başvuruları (script src / link href / img src). Yorumlar yok sayılır;
 * `?sorgu` ve `#parça` atılır, `%xx` çözülür. Yalnız göreli yollar (http(s), `//`, `/…`, `data:`,
 * `#`, `javascript:`, `mailto:` ve diğer şemalar dışarıda). SAF.
 * @returns {string[]} kökten göreli, normalleştirilmiş, tekilleştirilmiş yollar
 */
function indexYerelReferanslari(html) {
  const m = String(html || '').replace(/<!--[\s\S]*?-->/g, '');
  const out = new Set();
  const al = (adres) => {
    let a = String(adres || '').trim();
    if (!a || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(a)) return;
    a = a.split('#')[0].split('?')[0];
    try { a = decodeURIComponent(a); } catch (_) { /* olduğu gibi */ }
    a = path.posix.normalize(a);
    if (!a || a === '.' || a.startsWith('..')) return;
    out.add(a);
  };
  for (const t of m.matchAll(/<(script|link|img)\b[^>]*>/gi)) {
    const oz = t[1].toLowerCase() === 'link' ? 'href' : 'src';
    const x = new RegExp(`\\s${oz}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(t[0]);
    if (x) al(x[1] != null ? x[1] : x[2]);
  }
  return [...out];
}

/**
 * Build kökünün Electron giriş dosyası (03.10, saha 74430/59480): `main.js` | `electron.js` |
 * `package.json` `main` alanının gösterdiği dosya. Yoksa paketleyici yedek main.js şablonuna düşer
 * (nodeIntegration:false → okuyucu YÜKLENMEZ) — artık kabul edilmez. Bulunan yol ya da null. SAF.
 */
function girisDosyasi(kume, okuyucu) {
  for (const y of ['main.js', 'electron.js']) if (kume.has(y)) return y;
  if (kume.has('package.json')) {
    try {
      const m = JSON.parse(metinOku(okuyucu, 'package.json') || '{}').main;
      const y = typeof m === 'string' ? m.replace(/^\.\//, '') : '';
      if (y && kume.has(y)) return `package.json → ${y}`;
    } catch (_) { /* bozuk package.json: giriş yok sayılır */ }
  }
  return null;
}

/** İmpark kimliği mi? `icerik-merdiven.imparkKimligiMi` ile BİREBİR (0, boş, sayısal değil → hayır). */
function imparkKimligiMi(id) {
  return /^[1-9]\d*$/.test(String(id == null ? '' : id));
}
const ICERIK = 'data/BookContent.xml';

/** Dizindeki tüm DOSYALARIN göreli yolları (`/` ayraçlı). */
function dizinGirisleri(kok) {
  const out = [];
  (function yuru(d, onEk) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const g = onEk + e.name;
      if (e.isDirectory()) yuru(path.join(d, e.name), `${g}/`);
      else out.push(g);
    }
  }(kok, ''));
  return out;
}

/**
 * Temizlenmiş yollar; kökte assets/bookN yoksa ve hepsi TEK klasör altındaysa bir seviye iner.
 * @returns {{yollar: string[], onEk: string}} `onEk` = inilen sarmalayıcı (`''` ya da `<klasör>/`)
 */
function kokuBul(yollar) {
  const kokte = (l) => l.some((y) => y.split('/')[0] === 'assets' || bookNMi(y.split('/')[0]));
  if (kokte(yollar)) return { yollar, onEk: '' };
  const segs = new Set(yollar.map((y) => y.split('/')[0]));
  if (segs.size === 1) {
    const [tek] = segs;
    const ic = yollar.filter((y) => y.startsWith(`${tek}/`)).map((y) => y.slice(tek.length + 1)).filter(Boolean);
    if (kokte(ic)) return { yollar: ic, onEk: `${tek}/` };
  }
  return { yollar, onEk: '' };
}

/**
 * Build içinden dosya okuyucu (kök = sarmalayıcıdan sonraki kök). Zip'te merkez dizin TEMBEL okunur
 * (`icerik-merdiven.zipDizini`, Zip64; adm-zip yok) — yalnız kimlik/Web-Z çözümü gerektiğinde.
 * Okunamayan/olmayan girdi → null (kapı bunu "menü yok" / "boyut bilinmiyor" sayar).
 * @returns {{veri: (yol: string) => Buffer|null, boyut: (yol: string) => number|null}}
 */
function varsayilanOkuyucu({ zipYolu, buildDizini, onEk }) {
  if (zipYolu) {
    let dizin;
    const al = (yol) => {
      if (dizin === undefined) { try { dizin = M.zipDizini(zipYolu); } catch (_) { dizin = null; } }
      const g = dizin && dizin.get(onEk + yol);
      return g && !g.dizin ? g : null;
    };
    return {
      veri(yol) {
        const g = al(yol);
        if (!g) return null;
        try { return M.zipGirdiOku(zipYolu, g); } catch (_) { return null; }
      },
      boyut(yol) { const g = al(yol); return g ? g.boyut : null; },
    };
  }
  const tam = (yol) => path.join(buildDizini, onEk, yol);
  return {
    veri(yol) { try { return fs.readFileSync(tam(yol)); } catch (_) { return null; } },
    boyut(yol) { try { return fs.statSync(tam(yol)).size; } catch (_) { return null; } },
  };
}

/**
 * Kitap başına sayfa envanteri (boyut-düştü kararı için, 03.10 72380 dersi): `assets/<id>/pages/*`
 * dosya sayısı + `data/BookContent.xml` `<Page>` sayısı. İmpark sayfaları yeniden sıkıştırınca
 * boyut düşer ama sayfa sayısı düşmez; içerik kaybında sayı düşer. SAF (okuyucu verilir).
 * @param {string[]} yollar kök-göreli dosya yolları (dizin girişleri atılmış)
 * @returns {Record<string, {pages: number, xml: number|null}>}
 */
function sayfaEnvanteri(yollar, okuyucu) {
  const env = {};
  const al = (id) => { if (!env[id]) env[id] = { pages: 0, xml: null }; return env[id]; };
  for (const y of yollar) {
    const m = /^(?:book\d+\/)?assets\/([^/]+)\/pages\/.+$/.exec(y);
    if (m) al(m[1]).pages += 1;
  }
  for (const y of yollar) {
    const m = /^(?:(book\d+)\/)?assets\/([^/]+)\/data\/BookContent\.xml$/.exec(y);
    if (!m) continue;
    const b = okuyucu.veri(y);
    if (b == null) continue;
    const say = (b.toString('utf8').match(/<Page(?=[\s>/])/g) || []).length;
    const e = al(m[2]);
    e.xml = Math.max(e.xml == null ? 0 : e.xml, say);
  }
  return env;
}

/** Zip'ten envanter (önceki build için runner çağırır). Okunamazsa null → kapı fail-closed. I/O. */
function zipSayfaEnvanteri(zipYolu, { listele = zipGirisAdlariniOku } = {}) {
  try {
    const { yollar, onEk } = kokuBul(girisleriTemizle(listele(zipYolu)).filter((y) => !y.endsWith('/')));
    const env = sayfaEnvanteri(yollar, varsayilanOkuyucu({ zipYolu, onEk }));
    return Object.keys(env).length ? env : null;
  } catch (_) { return null; }
}

/**
 * Boyut düşüşünde sayfa karşılaştırması. @returns {{tam: boolean, neden: string}}
 * Fail-closed: önceki envanter yok/boş, kitap eksik, sayfa azalmış ya da sayılamıyor → tam=false.
 */
function sayfaTamMi(onceki, yeni) {
  if (!onceki || typeof onceki !== 'object' || !Object.keys(onceki).length) {
    return { tam: false, neden: 'önceki build sayfa envanteri yok' };
  }
  const sorunlar = [];
  for (const [id, o] of Object.entries(onceki)) {
    const y = yeni[id];
    if (!y) { sorunlar.push(`kitap ${id} yeni build'de yok`); continue; }
    if (!(o.pages > 0) && !(o.xml > 0)) { sorunlar.push(`kitap ${id}: önceki sayfa sayısı ölçülemedi`); continue; }
    if (y.pages < o.pages) sorunlar.push(`kitap ${id}: pages/ ${y.pages} < önceki ${o.pages}`);
    if (o.xml != null && (y.xml == null || y.xml < o.xml)) {
      sorunlar.push(`kitap ${id}: BookContent <Page> ${y.xml == null ? 'okunamadı' : y.xml} < önceki ${o.xml}`);
    }
  }
  return sorunlar.length ? { tam: false, neden: sorunlar.slice(0, 5).join('; ') } : { tam: true, neden: '' };
}

const metinOku = (okuyucu, yol) => {
  const b = okuyucu.veri(yol);
  return b == null ? null : b.toString('utf8');
};

/** Uygulamanın kitap menüsü (`settings.books`) — set eki ile AYNI okuma (`menuBooksOku`, yama öncelikli). */
function menuKitaplari(okuyucu) {
  const [yama, ayar] = MENU_YOLLARI;
  try { return menuBooksOku(metinOku(okuyucu, yama), metinOku(okuyucu, ayar)) || null; } catch (_) { return null; }
}

/**
 * bookN'in ImWin32 menüsündeki TEK kapak kimliği (merdiven S0 / K4 / set eki `exeKitaplari` ile
 * aynı okuma: `ig.menuCoz` + `ig.kapaklar`). Menü yok/çözülemedi/çok kapak → null.
 */
function menuKapakKimligi(okuyucu, dizin) {
  try {
    const ham = okuyucu.veri(`${dizin}/${ig.MENU_GORELI}`);
    const xml = ham ? ig.menuCoz(ham) : null;
    const c = xml ? ig.kapaklar(xml) : [];
    return c.length === 1 && c[0].ID != null ? String(c[0].ID) : null;
  } catch (_) { return null; }
}

/** Bir kitap kökü (`''` ya da `bookN/`) için `{id, icerik, kapak}`. */
function kitapOlc(kume, onEk) {
  const idler = new Set();
  for (const y of kume) {
    if (!y.startsWith(`${onEk}assets/`)) continue;
    const id = y.slice(onEk.length + 'assets/'.length).split('/')[0];
    if (id) idler.add(id);
  }
  // İçerik/kapak sahibi id'yi tercih et (aynı bookN'de birden çok assets/<id> olabilir).
  const sirali = [...idler].sort();
  let secili = null;
  for (const id of sirali) {
    const a = `${onEk}assets/${id}/`;
    if (kume.has(a + ICERIK) || kume.has(a + KAPAK)) { secili = id; break; }
  }
  if (secili == null && sirali.length) [secili] = sirali;
  if (secili == null) return { id: null, icerik: false, kapak: false };
  const a = `${onEk}assets/${secili}/`;
  return {
    id: secili,
    icerik: kume.has(a + ICERIK) && ILK_SAYFA.some((p) => kume.has(a + p)),
    kapak: kume.has(a + KAPAK),
  };
}

/** Belirli bir `assets/<id>` için `{icerik, kapak}` (tek motorlu sette her kapak ayrı ölçülür). */
function kitapOlcId(kume, onEk, id) {
  const a = `${onEk}assets/${id}/`;
  return {
    icerik: kume.has(a + ICERIK) && ILK_SAYFA.some((p) => kume.has(a + p)),
    kapak: kume.has(a + KAPAK),
  };
}

/**
 * Tek motorlu set: kök `classlibraries/ImWin32.dll` menüsündeki İmpark kapak kimlikleri (menü
 * sırası, tekilleştirilmiş). 2'den az kapak → [] (tek kitap yapılı build bugünkü yolda kalır).
 */
function kokMenuKapaklari(okuyucu, kume) {
  if (!kume.has(ig.MENU_GORELI)) return [];
  try {
    const ham = okuyucu.veri(ig.MENU_GORELI);
    const xml = ham ? ig.menuCoz(ham) : null;
    const idler = [...new Set((xml ? ig.kapaklar(xml) : []).map((c) => String(c.ID)).filter(imparkKimligiMi))];
    return idler.length >= 2 ? idler : [];
  } catch (_) { return []; }
}

/** Listedeki kitap (link olmayan) satırları (`setListesiAyristir`); liste yok/boşsa null. */
function listeGirdileri(setListesi) {
  if (setListesi == null) return null;
  const ham = Array.isArray(setListesi) ? setListesi.join('\n') : String(setListesi);
  if (!ham.trim()) return null;
  return setListesiAyristir(ham).filter((g) => !g.link);
}

/**
 * @param {{ buildDizini?: string, zipYolu?: string, setListesi?: string|string[]|null,
 *   oncekiBoyut?: number|null, boyut?: number|null, tur?: 'otomatik'|'manuel',
 *   vsler?: Record<number, number>, listele?: (zip: string) => string[],
 *   okuyucu?: {veri: (yol: string) => Buffer|null, boyut: (yol: string) => number|null} }} girdi
 *   `okuyucu` testler içindir; verilmezse zip/dizinden okunur (yalnız kimlik çözümü gerektiğinde).
 * @returns {{ gecti: boolean,
 *   kitaplar: Array<{n: number, id: string|null, vs?: number, icerik: boolean, kapak: boolean}>,
 *   webzVarliklari: Array<{n: number, id: string, yol: 'config'|'ad', icerik: boolean, kapak: boolean}>,
 *   nedenler: string[], nedenKodlari: string[], notlar: string[] }}
 */
function yazmaKapisi({
  buildDizini, zipYolu, setListesi = null, oncekiBoyut = null, oncekiEnvanter = null, boyut = null,
  tur = 'otomatik', vsler = {}, listele = zipGirisAdlariniOku, okuyucu = null,
} = {}) {
  const nedenler = [];
  const kodlar = new Set();
  const notlar = [];
  const uyarilar = [];
  const eksikKimlikler = []; // `kitap-eksik` verilen liste kimlikleri (taban kapsama ölçüsü bunu kullanır)
  let listeKitapSayisi = null;
  const ret = (kod, mesaj) => { kodlar.add(kod); nedenler.push(`${KAPI_ISARETI} ${mesaj}`); };
  let ham;
  try {
    if (zipYolu) ham = listele(zipYolu);
    else if (buildDizini) ham = dizinGirisleri(buildDizini);
    else throw new Error('buildDizini ya da zipYolu verilmedi');
  } catch (e) {
    const on = zipYolu ? OKUNAMADI_ISARETI : KAPI_ISARETI;
    return {
      gecti: false, kitaplar: [], webzVarliklari: [], notlar, eksikKimlikler, listeKitapSayisi,
      nedenler: [`${on} giriş listesi okunamadı: ${String(e && e.message || e).slice(0, 300)}`],
      nedenKodlari: [KOD.OKUNAMADI],
    };
  }
  const { yollar, onEk } = kokuBul(girisleriTemizle(ham).filter((y) => !y.endsWith('/')));
  const kume = new Set(yollar);
  const oku = okuyucu || varsayilanOkuyucu({ zipYolu, buildDizini, onEk });

  const bookNler = [...new Set(yollar.map((y) => y.split('/')[0]).filter(bookNMi))]
    .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
  const setYapili = bookNler.length > 0;
  const tekMotorKapaklar = setYapili ? [] : kokMenuKapaklari(oku, kume);
  const ad = (k) => (setYapili ? `book${k.n}` : tekMotorKapaklar.length ? `kök#${k.n}(${k.id})` : 'kök');

  const kitaplar = [];
  const dizinAdi = new Map(); // n → assets/<dizin> (kimlik menüden çözülünce de içerik oradan ölçülür)
  if (setYapili) {
    for (const d of bookNler) {
      const n = Number(d.replace(/\D/g, ''));
      const k = kitapOlc(kume, `${d}/`);
      dizinAdi.set(n, k.id);
      let { id } = k;
      // (a2) dizin adı İmpark kimliği değilse ImWin32 menüsünün tek kapak kimliği (merdiven/K4 kaynağı).
      if (!imparkKimligiMi(id) && kume.has(`${d}/${ig.MENU_GORELI}`)) {
        const mk = menuKapakKimligi(oku, d);
        if (imparkKimligiMi(mk)) {
          id = mk;
          notlar.push(`kimlik ImWin32 menüsünden: ${d} = ${mk} (dizin ${k.id == null ? '-' : k.id})`);
        }
      }
      kitaplar.push({ n, id, ...(vsler[n] != null ? { vs: vsler[n] } : {}), icerik: k.icerik, kapak: k.kapak });
    }
  } else if (tekMotorKapaklar.length) {
    // TEK MOTORLU SET (02.10, index üreteci + İmpark'ın kendi set exe'si 45472/45480): bookN yok,
    // kök ImWin32 menüsünde ≥2 İmpark kapağı → her kapak bir kitap, menü sırasıyla n=1..N.
    tekMotorKapaklar.forEach((id, i) => {
      const k = kitapOlcId(kume, '', id);
      kitaplar.push({ n: i + 1, id, ...(vsler[i + 1] != null ? { vs: vsler[i + 1] } : {}), icerik: k.icerik, kapak: k.kapak });
    });
    notlar.push(`tek motorlu set: kök menüde ${tekMotorKapaklar.length} kapak`);
  } else {
    const k = kitapOlc(kume, '');
    if (k.id != null) kitaplar.push({ n: 1, id: k.id, ...(vsler[1] != null ? { vs: vsler[1] } : {}), icerik: k.icerik, kapak: k.kapak });
  }

  // 1. kitap kimlikleri (sayı eşitliği değil — liste dışı İmpark-dışı ek korunur)
  const liste = listeGirdileri(setListesi);
  const listeIdler = liste == null ? null : liste.map((g) => String(g.assetId));
  let denetlenecek = kitaplar;
  const webzVarliklari = [];
  if (listeIdler != null) {
    const listeImpark = listeIdler.filter(imparkKimligiMi);
    listeKitapSayisi = new Set(listeImpark).size;
    const buildIdler = new Set(kitaplar.map((k) => (k.id == null ? '' : String(k.id))));
    const ozet = kitaplar.length === listeIdler.length ? '' : ` (kitap sayısı ${kitaplar.length} ≠ liste ${listeIdler.length})`;

    // (b)/(c) İmpark kimliği çözülemeyen bookN ↔ build'de bulunmayan liste kimliği: Web-Z varlığı.
    const webzN = new Set();
    const bekleyen = [];
    for (const g of liste) {
      if (imparkKimligiMi(g.assetId) && !buildIdler.has(String(g.assetId))
        && !bekleyen.some((b) => b.assetId === g.assetId)) bekleyen.push(g);
    }
    const adaylar = setYapili ? kitaplar.filter((k) => !imparkKimligiMi(k.id)) : [];
    if (bekleyen.length && adaylar.length) {
      const books = menuKitaplari(oku) || {};
      const es = eslestir(bekleyen, adaylar.map((k) => {
        const m = books[`book${k.n}`];
        return {
          dizin: `book${k.n}`, id: null,
          menuAssetId: m && m.assetId != null ? String(m.assetId) : null,
          ad: m && m.title ? String(m.title) : null,
        };
      }));
      for (const e of es.eslesen) {
        const k = adaylar.find((x) => `book${x.n}` === e.dizin);
        const dz = dizinAdi.get(k.n);
        const bc = dz == null ? null : `book${k.n}/assets/${dz}/${ICERIK}`;
        // Boyut okunamıyorsa (bilinmiyor) giriş listesindeki varlık yeter; ölçülmüş 0 bayt = içerik yok.
        const icerik = !!bc && kume.has(bc) && oku.boyut(bc) !== 0;
        const yol = e.yol === 'ad' ? 'ad' : 'config';
        webzVarliklari.push({ n: k.n, id: String(e.liste.assetId), yol, icerik, kapak: k.kapak });
        webzN.add(k.n);
        buildIdler.add(String(e.liste.assetId));
        notlar.push(`Web-Z varlığı kabul: book${k.n} ← liste ${e.liste.assetId}`
          + ` (${yol === 'ad' ? `ad "${e.liste.ad}"` : 'menü assetId'}; dizin ${dz == null ? '-' : dz})`);
        if (!icerik) {
          ret(KOD.ICERIK_YOK, `book${k.n}: Web-Z varlığı ${e.liste.assetId} içerik yok (${ICERIK} yok ya da boş)`);
        }
      }
    }

    for (const id of new Set(listeImpark)) {
      if (!buildIdler.has(id)) {
        eksikKimlikler.push(id);
        ret(KOD.KITAP_EKSIK, `kitap-eksik: liste kimliği ${id} build'de yok${ozet}`);
      }
    }
    const listeKume = new Set(listeImpark);
    denetlenecek = [];
    for (const k of kitaplar) {
      const adi = ad(k);
      if (webzN.has(k.n)) continue;
      if (listeKume.has(String(k.id))) denetlenecek.push(k);
      else if (imparkKimligiMi(k.id)) {
        ret(KOD.LISTE_DISI, `liste-disi-kitap: ${adi} kimliği ${k.id} listede yok${ozet}`);
      } else notlar.push(`liste dışı ek korundu: ${adi}`);
    }
  } else if (tur !== 'manuel' && (setYapili || tekMotorKapaklar.length)) {
    ret(KOD.LISTE_YOK, 'set listesi yok (otomatik tür) — kitap sayısı doğrulanamadı');
  }
  if (!kitaplar.length) ret(KOD.KITAP_YOK, 'kitap bulunamadı (bookN yok, assets/<id> yok)');

  // 2. içerik + kapak (liste kitapları; korunan ekler denetlenmez, sunucuya da gitmez)
  for (const k of denetlenecek) {
    const adi = ad(k);
    if (k.id == null) ret(KOD.ID_YOK, `${adi}: assets/<id> yok`);
    if (!k.icerik) ret(KOD.ICERIK_YOK, `${adi}: içerik yok (${ICERIK} / ilk sayfa)`);
    if (!k.kapak) ret(KOD.KAPAK_YOK, `${adi}: kapak yok (${KAPAK})`);
  }

  // 2b. Electron giriş dosyası (yedek şablona düşmek kabul edilmez)
  if (!girisDosyasi(kume, oku)) {
    ret(KOD.GIRIS_YOK, 'build kökünde Electron giriş dosyası yok (main.js / electron.js / package.json main)'
      + ' — paketleyici yedek şablona düşer, okuyucu yüklenmez');
  }

  // 2c. kök index.html yerel başvuruları zip'te var mı
  if (kume.has('index.html')) {
    const ham = oku.veri('index.html');
    if (ham) {
      const kucuk = new Set(yollar.map((y) => y.toLowerCase()));
      const yok = indexYerelReferanslari(ham.toString('utf8')).filter((y) => !kume.has(y));
      // Yalnız BÜYÜK/küçük harf farkı (45478 `core/kurumLogo.png` ↔ `kurumlogo.png`; macOS/Windows'ta
      // çalışır, süs dosyası) RED değil not; gerçek eksik RED.
      const eksik = yok.filter((y) => !kucuk.has(y.toLowerCase()));
      for (const y of yok.filter((x) => kucuk.has(x.toLowerCase()))) {
        notlar.push(`index.html başvurusu harf farkıyla eşleşiyor (Linux'ta açılmaz): ${y}`);
      }
      if (eksik.length) {
        ret(KOD.REFERANS_EKSIK, `index-referans-eksik: kök index.html ${eksik.length} yerel dosyaya başvuruyor,`
          + ` zip'te yok: ${eksik.slice(0, 5).join(', ')}${eksik.length > 5 ? ', …' : ''}`);
      }
    }
  }

  // 3. boyut
  let b = boyut;
  if (b == null && zipYolu) { try { b = fs.statSync(zipYolu).size; } catch (_) { b = null; } }
  if (oncekiBoyut != null && b != null && b < oncekiBoyut * BOYUT_ORANI) {
    const mesaj = `boyut ${b} < önceki ${oncekiBoyut} × ${BOYUT_ORANI}`;
    // İmpark yeniden sıkıştırması (72380, PNG 531→142 MB) meşru: kitap başına sayfa sayısı önceki
    // build'e eşit/fazlaysa UYARI; envanter yoksa ya da sayfa eksikse RED (fail-closed).
    let sk = { tam: false, neden: 'yeni build envanteri okunamadı' };
    try { sk = sayfaTamMi(oncekiEnvanter, sayfaEnvanteri(yollar, oku)); } catch (_) { /* RED */ }
    if (sk.tam) {
      uyarilar.push(KOD.BOYUT_SAYFA_TAM);
      notlar.push(`UYARI ${KOD.BOYUT_SAYFA_TAM}: ${mesaj}; ${Object.keys(oncekiEnvanter).length} kitabın sayfaları tam`
        + ' (yeniden sıkıştırma) — geçti');
    } else {
      ret(KOD.BOYUT, `${mesaj} (sayfa doğrulaması geçmedi: ${sk.neden})`);
    }
  }

  return {
    gecti: nedenler.length === 0, kitaplar: denetlenecek, webzVarliklari, nedenler, nedenKodlari: [...kodlar], notlar,
    eksikKimlikler, listeKitapSayisi, buildKitapSayisi: kitaplar.length, uyarilar,
  };
}

/**
 * Taban kapsama ölçüsü: build'de bulunmayan liste kimlikleri — yazma kapısının `kitap-eksik`i ile AYNI
 * hesap (kapıyı koşturur, `eksikKimlikler`ini döner). Liste yoksa/okunamazsa eksik yok sayılır.
 * I/O: zip dizini okuma.
 * @returns {{eksik: string[], listeKitapSayisi: number|null, buildKitapSayisi: number}}
 */
function eksikKitaplar({ zipYolu, setListesi = null } = {}) {
  const k = yazmaKapisi({ zipYolu, setListesi });
  return { eksik: k.eksikKimlikler, listeKitapSayisi: k.listeKitapSayisi, buildKitapSayisi: k.buildKitapSayisi };
}

module.exports = {
  yazmaKapisi, eksikKitaplar, sayfaEnvanteri, zipSayfaEnvanteri, sayfaTamMi, imparkKimligiMi, girisDosyasi, indexYerelReferanslari, varsayilanOkuyucu, KOD, KAPI_ISARETI, BOYUT_ORANI, ILK_SAYFA, KAPAK, ICERIK,
};
