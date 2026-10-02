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
 *      Kimlik kaynağı = bookN/assets/<id> dizin adı; İmpark kimliği ölçütü `icerik-merdiven.
 *      imparkKimligiMi` ile aynı (/^[1-9]\d*$/). Liste yoksa: tür `manuel` → kimlik denetimi
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
 * `nedenKodlari` = makine okur ret kodları (tekilleştirilmiş), `birak` gövdesine gider.
 */

const fs = require('fs');
const path = require('path');
const { girisleriTemizle, bookNMi, zipGirisAdlariniOku, OKUNAMADI_ISARETI } = require('./icerik-kapisi');
const { setListesiAyristir } = require('./set-uyelik-ek');

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

/** Temizlenmiş yollar; kökte assets/bookN yoksa ve hepsi TEK klasör altındaysa bir seviye iner. */
function kokuBul(yollar) {
  const kokte = (l) => l.some((y) => y.split('/')[0] === 'assets' || bookNMi(y.split('/')[0]));
  if (kokte(yollar)) return yollar;
  const segs = new Set(yollar.map((y) => y.split('/')[0]));
  if (segs.size === 1) {
    const [tek] = segs;
    const ic = yollar.filter((y) => y.startsWith(`${tek}/`)).map((y) => y.slice(tek.length + 1)).filter(Boolean);
    if (kokte(ic)) return ic;
  }
  return yollar;
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

/** Listedeki kitap (link olmayan) kimlikleri; liste yok/boşsa null. */
function listeKimlikleri(setListesi) {
  if (setListesi == null) return null;
  const ham = Array.isArray(setListesi) ? setListesi.join('\n') : String(setListesi);
  if (!ham.trim()) return null;
  return setListesiAyristir(ham).filter((g) => !g.link).map((g) => String(g.assetId));
}

/**
 * @param {{ buildDizini?: string, zipYolu?: string, setListesi?: string|string[]|null,
 *   oncekiBoyut?: number|null, boyut?: number|null, tur?: 'otomatik'|'manuel',
 *   vsler?: Record<number, number>, listele?: (zip: string) => string[] }} girdi
 * @returns {{ gecti: boolean,
 *   kitaplar: Array<{n: number, id: string|null, vs?: number, icerik: boolean, kapak: boolean}>,
 *   nedenler: string[] }}
 */
function yazmaKapisi({
  buildDizini, zipYolu, setListesi = null, oncekiBoyut = null, boyut = null, tur = 'otomatik',
  vsler = {}, listele = zipGirisAdlariniOku,
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
      gecti: false, kitaplar: [], notlar,
      nedenler: [`${on} giriş listesi okunamadı: ${String(e && e.message || e).slice(0, 300)}`],
      nedenKodlari: [KOD.OKUNAMADI],
    };
  }
  const yollar = kokuBul(girisleriTemizle(ham).filter((y) => !y.endsWith('/')));
  const kume = new Set(yollar);

  const bookNler = [...new Set(yollar.map((y) => y.split('/')[0]).filter(bookNMi))]
    .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
  const setYapili = bookNler.length > 0;

  const kitaplar = [];
  if (setYapili) {
    for (const d of bookNler) {
      const n = Number(d.replace(/\D/g, ''));
      const k = kitapOlc(kume, `${d}/`);
      kitaplar.push({ n, id: k.id, ...(vsler[n] != null ? { vs: vsler[n] } : {}), icerik: k.icerik, kapak: k.kapak });
    }
  } else {
    const k = kitapOlc(kume, '');
    if (k.id != null) kitaplar.push({ n: 1, id: k.id, ...(vsler[1] != null ? { vs: vsler[1] } : {}), icerik: k.icerik, kapak: k.kapak });
  }

  // 1. kitap kimlikleri (sayı eşitliği değil — liste dışı İmpark-dışı ek korunur)
  const listeIdler = listeKimlikleri(setListesi);
  let denetlenecek = kitaplar;
  if (listeIdler != null) {
    const listeImpark = listeIdler.filter(imparkKimligiMi);
    const buildIdler = new Set(kitaplar.map((k) => (k.id == null ? '' : String(k.id))));
    const ozet = kitaplar.length === listeIdler.length ? '' : ` (kitap sayısı ${kitaplar.length} ≠ liste ${listeIdler.length})`;
    for (const id of new Set(listeImpark)) {
      if (!buildIdler.has(id)) ret(KOD.KITAP_EKSIK, `kitap-eksik: liste kimliği ${id} build'de yok${ozet}`);
    }
    const listeKume = new Set(listeImpark);
    denetlenecek = [];
    for (const k of kitaplar) {
      const ad = setYapili ? `book${k.n}` : 'kök';
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
    gecti: nedenler.length === 0, kitaplar: denetlenecek, nedenler, nedenKodlari: [...kodlar], notlar,
  };
}

module.exports = { yazmaKapisi, imparkKimligiMi, KOD, KAPI_ISARETI, BOYUT_ORANI, ILK_SAYFA, KAPAK, ICERIK };
