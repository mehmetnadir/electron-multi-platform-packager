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
 *   2. her kitapta içerik (`assets/<id>/data/BookContent.xml` + ilk sayfa `pages/1.*`) VE kapak
 *      (`assets/<id>/thumbs/1.jpg`) — set-uyelik-ek kapısıyla aynı ölçüt.
 *   3. boyut ≥ oncekiBoyut × 0,8 (oncekiBoyut ya da boyut yoksa atlanır).
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
  ICERIK_YOK: 'icerik-yok', KAPAK_YOK: 'kapak-yok', BOYUT: 'boyut-dustu',
});

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
  buildDizini, zipYolu, setListesi = null, oncekiBoyut = null, boyut = null, tur = 'otomatik',
  vsler = {}, listele = zipGirisAdlariniOku, okuyucu = null,
} = {}) {
  const nedenler = [];
  const kodlar = new Set();
  const notlar = [];
  const ret = (kod, mesaj) => { kodlar.add(kod); nedenler.push(`${KAPI_ISARETI} ${mesaj}`); };
  let ham;
  try {
    if (zipYolu) ham = listele(zipYolu);
    else if (buildDizini) ham = dizinGirisleri(buildDizini);
    else throw new Error('buildDizini ya da zipYolu verilmedi');
  } catch (e) {
    const on = zipYolu ? OKUNAMADI_ISARETI : KAPI_ISARETI;
    return {
      gecti: false, kitaplar: [], webzVarliklari: [], notlar,
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
      if (!buildIdler.has(id)) ret(KOD.KITAP_EKSIK, `kitap-eksik: liste kimliği ${id} build'de yok${ozet}`);
    }
    const listeKume = new Set(listeImpark);
    denetlenecek = [];
    for (const k of kitaplar) {
      const ad = setYapili ? `book${k.n}` : 'kök';
      if (webzN.has(k.n)) continue;
      if (listeKume.has(String(k.id))) denetlenecek.push(k);
      else if (imparkKimligiMi(k.id)) {
        ret(KOD.LISTE_DISI, `liste-disi-kitap: ${ad} kimliği ${k.id} listede yok${ozet}`);
      } else notlar.push(`liste dışı ek korundu: ${ad}`);
    }
  } else if (tur !== 'manuel' && setYapili) {
    ret(KOD.LISTE_YOK, 'set listesi yok (otomatik tür) — kitap sayısı doğrulanamadı');
  }
  if (!kitaplar.length) ret(KOD.KITAP_YOK, 'kitap bulunamadı (bookN yok, assets/<id> yok)');

  // 2. içerik + kapak (liste kitapları; korunan ekler denetlenmez, sunucuya da gitmez)
  for (const k of denetlenecek) {
    const ad = setYapili ? `book${k.n}` : 'kök';
    if (k.id == null) ret(KOD.ID_YOK, `${ad}: assets/<id> yok`);
    if (!k.icerik) ret(KOD.ICERIK_YOK, `${ad}: içerik yok (${ICERIK} / ilk sayfa)`);
    if (!k.kapak) ret(KOD.KAPAK_YOK, `${ad}: kapak yok (${KAPAK})`);
  }

  // 3. boyut
  let b = boyut;
  if (b == null && zipYolu) { try { b = fs.statSync(zipYolu).size; } catch (_) { b = null; } }
  if (oncekiBoyut != null && b != null && b < oncekiBoyut * BOYUT_ORANI) {
    ret(KOD.BOYUT, `boyut ${b} < önceki ${oncekiBoyut} × ${BOYUT_ORANI}`);
  }

  return {
    gecti: nedenler.length === 0, kitaplar: denetlenecek, webzVarliklari, nedenler, nedenKodlari: [...kodlar], notlar,
  };
}

module.exports = { yazmaKapisi, imparkKimligiMi, KOD, KAPI_ISARETI, BOYUT_ORANI, ILK_SAYFA, KAPAK, ICERIK };
