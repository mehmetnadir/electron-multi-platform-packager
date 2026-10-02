'use strict';

/**
 * INDEX ÜRETECİ — build kaynağı OLMAYAN setler için build.zip'i kendimiz kurarız (2026-10-02).
 * Sözleşme: book-update `exesiz-kaynak-sozlesmesi.md` §K ("set index'i BİZİMDİR, kitap listesi =
 * panel Web-Z listesi"), §5 (yazma kapısı), §2b (imKeys). Tasarım: `.claude/docs/index-ureteci-tasarimi.md`.
 * Runner'da r2-kur'un KAYNAK ADIMIDIR (`uretec-kaynak.js`); sonra zincir aynen (merdiven, set eki,
 * imKeys, yazma kapısı, R2).
 *
 * NE YAPAR (yalnız yerel; R2/DB/İmpark'a YAZMAZ — İmpark'a yalnız motorun kendi GET sorusu):
 *   1. Web-Z listesi (`setListesiAyristir`) → plan (sıra, ad, grup, liste anahtarı bookN/linkN).
 *   2. Her kitap için motorun sorusu `GetKitapGuncellemeBilgi?id=<id>&setMi=0&versiyon=0` → `Data`
 *      (ZKitapZipH/<id>-<Vs>.zip) → içerik önbelleği (`icerikZipiGetir`, merdivenle AYNI yol).
 *      Ölçüm (02.10): ZKitapZipH = Web-Z `WebDijitapDosyalar/<id>/` = arşiv `assets/<id>/` bayt bayt.
 *   3. Motor = AYNI kurumun arşivli build'indeki tek kapaklı İmpark `bookN/` motoru (assets/
 *      classlibraries/ temp/ hariç). Exe KULLANILMAZ.
 *   4. Düzen (şef kararı 02.10): `otomatik` → aktivasyonlu set `tek-motor`, aktivasyonsuz `bookN`.
 *      - `tek-motor`: kök = motor, `classlibraries/ImWin32.dll` = TÜM kapaklar (Group/Tab = Web-Z grup
 *        sütunu), `assets/<id>/`; `main.activation="true" key=""` → kod setin ilk açılışında BİR kez.
 *      - `bookN`: kök = Web-Z menü KABUĞU (TEMA KANCASI `kabuk`), `bookN/` (liste anahtarıyla) = motor +
 *        tek kapaklı menü + içerik; `settings.books`/yama/`set-menu.json` listeden SIFIRDAN.
 *        Kabuk verilmezse `uretec-tema-yok`. Kabuk `{tema}` ise kök = `webz-tema-kabuk.kabukUret`
 *        (Flashy web-proxy-modern; kalıbın kökü AÇILMAZ, language-set.js aranmaz), kapak = panel
 *        coverUrl (liste 3. alanı). Aktivasyonlu sette bookN YASAK (her kitap ayrı sorar).
 *   4b. YAYINCI DÖNÜŞÜMÜ (`motorDonusumu`, faz 3): başka kurumun motoru kullanılınca okuyucunun kurumu
 *        okuduğu dört nokta yazılır — iki `kurum.txt`, `bookN/core/kurumlogo.png` (motorun kendi
 *        gizlemesiyle; düz PNG olsa motor çevrimiçi İmpark logosuyla ezer), `app.config.js`
 *        `baseEndpointUrl`. Yazım sonrası dört nokta yeniden okunup doğrulanır (kanıt rapora).
 *   5. AKTİVASYON KANCASI: 'set' | 'yok' | 'otomatik' (`anahtarliMi(id)`, ≥1 true → set). imKeys.dll
 *      YAZILMAZ (runner `imkeys.js` set-ek sonrası yazar ve kapısını uygular).
 *   6. Zip'i olmayan oyun/çalışma kâğıdı (contentType kitap değil): bookN'de `webzAdresi` verilirse
 *      LİNK KARTI (set-ek 4fbb8c1 ile aynı `type:'link'` + yama bloğu), yoksa atlanır; ikisi de
 *      rapora sayılır ve `kapiListesi`'nde link satırına çevrilir/çıkarılır (kapı `kitap-eksik` demesin).
 *
 * YA HEP YA HİÇ: listedeki bir KİTAP (contentType kitap/boş) alınamazsa build YAZILMAZ (`kitap-eksik`).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const M = require('./icerik-merdiven');
const ig = require('../runtime/icerik-guncelleme');
const setEk = require('./set-uyelik-ek');
const gMenu = require('../../tools/g-yayin/menu');
const bicim = require('../packaging/set-menu-bicim');
const temaKabuk = require('./webz-tema-kabuk');

const ISARET = '[index-ureteci]';
const DUZEN = Object.freeze({ TEK_MOTOR: 'tek-motor', BOOKN: 'bookN', OTOMATIK: 'otomatik' });
const AKTIVASYON = Object.freeze({ SET: 'set', YOK: 'yok', OTOMATIK: 'otomatik' });
const KOD = Object.freeze({
  TEMA_YOK: 'uretec-tema-yok', KITAP_EKSIK: 'kitap-eksik', AKT_DUZEN: 'aktivasyon-duzen',
  LISTE_YOK: 'liste-yok', PARAMETRE: 'parametre', KALIP: 'kalip', MENU: 'menu', IO: 'io',
  TEMA: 'tema', DONUSUM: 'donusum',
});
const MENU = ig.MENU_GORELI; // classlibraries/ImWin32.dll
const KAPAK = 'thumbs/1.jpg';
const ICERIK = 'data/BookContent.xml';
const ILK_SAYFA = Object.freeze(['pages/1.png', 'pages/1.jpg', 'pages/1.jpeg', 'pages/1.webp']);
const YAMA = 'scripts/cevrimdisi-yama.js';
const AYAR = 'config/settings.json';
const TANIM = 'set-menu.json';
/** Motor kopyalanırken alınmayan alt ağaçlar (içerik, menü, kullanıcı verisi). */
const MOTOR_HARIC = Object.freeze(['assets', 'classlibraries', 'temp']);
/** bookN motorunda olmayan, arşiv kökünden tamamlanan motor dosyaları (ölçüm 02.10, 45472 kökü). */
const KOK_MOTOR_EKLERI = Object.freeze(['electronUpdate.js', 'old_app.config.js']);
const VARSAYILAN_SABLON = 'https://www.sorucoz.tv/TestlerMobil/GetKitapGuncellemeBilgi'
  + '?id={bookId}&setMi={isSet}&versiyon={version}';
/** "Kitap 3" gibi genel ad (KV'de başlık yoksa Worker böyle verir) → BookContent'ten ad çıkarılır. */
const GENEL_AD = /^\s*(kitap|book)\s*\d*\s*$/i;
const KURUM_LOGO = 'core/kurumlogo.png';
const APP_CONFIG = 'app.config.js';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/131.0.0.0 Safari/537.36';

class UretecHatasi extends Error {
  constructor(mesaj, { kod = 'uretec', eksik = [] } = {}) {
    super(`${ISARET} ${mesaj}`);
    this.kod = kod;
    this.eksik = eksik;
  }
}

// ─── Saf kararlar ───────────────────────────────────────────────────────────────────────────

const imparkKimligiMi = (id) => /^[1-9]\d*$/.test(String(id == null ? '' : id));
const kitapTuruMu = (ct) => !ct || /^(book|kitap)$/i.test(String(ct));

function xmlKacis(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attrYaz(etiket, ad, deger) {
  const re = new RegExp(`(\\s${ad}=")[^"]*(")`);
  if (re.test(etiket)) return etiket.replace(re, (_, a, b) => `${a}${deger}${b}`);
  return etiket.replace(/\s*\/?>$/, (son) => ` ${ad}="${deger}"${son}`);
}

/** DB metnindeki kaçışlı `\n` → gerçek satır. SAF. */
const listeNormal = (ham) => (ham == null ? '' : String(ham).replace(/\\n/g, '\n'));

/** Satırın i. alanı (0 tabanlı; 2 = panel kapağı, 4 = grup). Ayrıştırıcı bunları döndürmez. SAF. */
function alanOku(listeHam, assetId, i) {
  const satirlar = listeNormal(listeHam).split(/\r?\n/).filter((s) => s.trim());
  const s = satirlar.find((x) => x.split('|')[0].trim() === String(assetId));
  if (!s) return '';
  return s.split('|').map((x) => x.trim())[i] || '';
}

/** Satırın 5. alanı (grup). SAF. */
const grupOku = (listeHam, assetId) => alanOku(listeHam, assetId, 4);

/**
 * Plan — listeden kitaplar (sıra, ad, grup, liste anahtarı). SAF.
 * `duzen` 'tek-motor' | 'bookN' | 'otomatik' (otomatik aktivasyon kararından sonra çözülür).
 * İmpark kimliği olmayan satır build'e GİRMEZ → `disarida`.
 */
function planKur({ listeHam, duzen = DUZEN.OTOMATIK, aktivasyon = AKTIVASYON.YOK } = {}) {
  if (!Object.values(DUZEN).includes(duzen)) {
    throw new UretecHatasi(`bilinmeyen düzen ${duzen}`, { kod: KOD.PARAMETRE });
  }
  if (aktivasyon === AKTIVASYON.SET && duzen === DUZEN.BOOKN) {
    throw new UretecHatasi('aktivasyonlu set bookN düzeninde üretilmez (her kitap ayrı sorar) — tek-motor kullan',
      { kod: KOD.AKT_DUZEN });
  }
  const ham = listeNormal(listeHam);
  const liste = setEk.setListesiAyristir(ham);
  if (!liste.length) throw new UretecHatasi('Web-Z listesi boş', { kod: KOD.LISTE_YOK });
  const linkler = liste.filter((g) => g.link);
  const kitapSatiri = liste.filter((g) => !g.link);
  const disarida = kitapSatiri.filter((g) => !imparkKimligiMi(g.assetId));
  const goruldu = new Set();
  const kitaplar = [];
  for (const g of kitapSatiri.filter((x) => imparkKimligiMi(x.assetId))) {
    if (goruldu.has(g.assetId)) continue; // aynı kitap iki kez → tek kapak
    goruldu.add(g.assetId);
    kitaplar.push({
      n: kitaplar.length + 1, id: String(g.assetId), ad: g.ad || '', anahtar: g.anahtar,
      grup: grupOku(ham, g.assetId), contentType: g.contentType || null,
      kapak: alanOku(ham, g.assetId, 2) || null,
    });
  }
  if (!kitaplar.length) throw new UretecHatasi('listede İmpark kitabı yok', { kod: KOD.LISTE_YOK });
  return { duzen, kitaplar, disarida, linkler, liste };
}

/** Aktivasyon kararı: 'set' | 'yok'. 'otomatik' → anahtarliMi sonuçlarından. SAF. */
function aktivasyonKarari(aktivasyon, anahtarliSonuclari = []) {
  if (aktivasyon === AKTIVASYON.SET) return AKTIVASYON.SET;
  if (aktivasyon === AKTIVASYON.YOK) return AKTIVASYON.YOK;
  if (aktivasyon === AKTIVASYON.OTOMATIK) {
    return anahtarliSonuclari.some((x) => x === true) ? AKTIVASYON.SET : AKTIVASYON.YOK;
  }
  throw new UretecHatasi(`bilinmeyen aktivasyon ${aktivasyon}`, { kod: KOD.PARAMETRE });
}

/** Düzen kararı (şef 02.10): otomatik → set ? tek-motor : bookN. Açık düzen + set + bookN = RED. SAF. */
function duzenKarari(duzen, aktivasyon) {
  const d = duzen === DUZEN.OTOMATIK
    ? (aktivasyon === AKTIVASYON.SET ? DUZEN.TEK_MOTOR : DUZEN.BOOKN) : duzen;
  if (aktivasyon === AKTIVASYON.SET && d === DUZEN.BOOKN) {
    throw new UretecHatasi('anahtarlı kapak var — bookN düzeni reddedildi (tek-motor kullan)', { kod: KOD.AKT_DUZEN });
  }
  return d;
}

/**
 * Yazma kapısına/set ekine gidecek liste: link'e çevrilen satır `link:<url> | ad` olur, atlanan
 * satır çıkar, kalanı AYNEN. SAF.
 * @param {string} listeHam  @param {Map<string, string|null>} cevrilen assetId → url (null = atla)
 */
function kapiListesiKur(listeHam, cevrilen) {
  return listeNormal(listeHam).split(/\r?\n/).filter((s) => s.trim()).flatMap((s) => {
    const p = s.split('|').map((x) => x.trim());
    if (!cevrilen.has(p[0])) return [s];
    const url = cevrilen.get(p[0]);
    return url ? [`link:${url} | ${p[1] || 'Kısayol'}`] : [];
  }).join('\n');
}

/**
 * Tek motorlu set menüsü (çözülmüş XML). Biçim: İmpark'ın kendi set exe'si (45472 Marvel 12, 02.10
 * çözüldü). Kapak etiketi kalıp kitabın tek kapağından türetilir; alanlar set-ek `menuXmlUret` ile
 * aynı; kapak görseli içerikteki `thumbs/1.jpg`. SAF.
 */
function tekMotorMenuXml({ kalipXml, setId, setAdi, aktivasyon, kurum = null, kitaplar }) {
  const kalip = String(kalipXml || '');
  const mainM = /<main\b[^>]*>/.exec(kalip);
  const kapakM = kalip.match(/<cover\b[^>]*>/g) || [];
  if (!mainM) throw new UretecHatasi('kalıp menüde <main> yok', { kod: KOD.KALIP });
  if (kapakM.length !== 1) {
    throw new UretecHatasi(`kalıp menüde ${kapakM.length} kapak (tam 1 olmalı)`, { kod: KOD.KALIP });
  }
  let main = mainM[0].replace(/\s*\/>$/, '>');
  main = attrYaz(main, 'activation', aktivasyon === AKTIVASYON.SET ? 'true' : 'false');
  main = attrYaz(main, 'key', '');
  main = attrYaz(main, 'type', '1');
  main = attrYaz(main, 'ID', xmlKacis(setId));
  const onEk = kalip.slice(0, mainM.index);
  const kapakTaban = kapakM[0].replace(/\s*\/?>$/, '>');

  const sekmeler = [];
  for (const k of kitaplar) {
    const sekmeAdi = k.grup || '';
    if (!sekmeler.some((s) => s.ad === sekmeAdi)) {
      sekmeler.push({ id: String(sekmeler.length + 1), ad: sekmeAdi, kapaklar: [] });
    }
    const sekme = sekmeler.find((s) => s.ad === sekmeAdi);
    const id = String(k.id);
    const a = `assets/${id}`;
    const alanlar = {
      ID: id, etkID: id, etkAdi: id, guId: '', ustBar: `${a}/skins/ustBar.swf`,
      arkaPlan: `${a}/skins/arkaplan.swf`, source: `${a}/${KAPAK}`, actName: xmlKacis(k.ad),
      URL: xmlKacis(k.url), imageURL: `${a}/${KAPAK}`, version: String(k.vs),
      xmlSource: `${a}/${ICERIK}`, tabID: sekme.id, kullaniciAktif: 'true', install: 'true',
      update: 'false',
    };
    if (kurum != null) alanlar.corpID = xmlKacis(kurum);
    let e = kapakTaban;
    for (const [ad, v] of Object.entries(alanlar)) e = attrYaz(e, ad, v);
    sekme.kapaklar.push(`${e}</cover>`);
  }
  const govde = sekmeler
    .map((s) => `<Tab ID="${s.id}" label="${xmlKacis(s.ad)}">${s.kapaklar.join('')}</Tab>`).join('');
  const xml = `${onEk}${main}<Group ID="${xmlKacis(setId)}" label="${xmlKacis(setAdi || '')}">`
    + `${govde}</Group></main>`;
  const c = ig.kapaklar(xml);
  if (c.length !== kitaplar.length || c.some((x, i) => x.ID !== String(kitaplar[i].id)
    || x.version !== Number(kitaplar[i].vs))) {
    throw new UretecHatasi('üretilen menü doğrulanamadı (kapak sırası/sürümü)', { kod: KOD.MENU });
  }
  return xml;
}

/**
 * bookN düzeninin Web-Z menü dosyaları (kabuktan, liste ile YENİDEN). Kabuğun eski kitap girdileri
 * TAŞINMAZ. `girdiler` liste sırasıyla: kitap `{dizin, id, ad, grup, contentType}` ya da link
 * `{dizin, link: true, url, ad}`. Link varsa yamaya set-ek'in link-tıkla bloğu eklenir. SAF.
 */
function webzMenuDosyalari(t, { setAdi, girdiler }) {
  if (t.yama == null && t.ayar == null) {
    throw new UretecHatasi('kabukta Web-Z menüsü yok (config/settings.json / yama)', { kod: KOD.KALIP });
  }
  const books = {};
  girdiler.forEach((k, i) => {
    books[k.dizin] = k.link
      ? { contentType: 'link', displayOrder: i, title: k.ad || 'Kısayol', type: 'link', url: k.url }
      : {
        assetId: String(k.id), contentType: k.contentType || 'book',
        coverUrl: `${k.dizin}/assets/${k.id}/${KAPAK}`, displayOrder: i, title: k.ad,
        ...(k.grup ? { group: k.grup } : {}),
      };
  });
  const linkVar = girdiler.some((k) => k.link);
  const uygula = (a) => ({
    ...a, books, bookCount: girdiler.length, ...(setAdi ? { setTitle: setAdi } : {}),
  });
  const out = new Map();
  if (t.yama != null) {
    const yp = gMenu.yamaAyir(t.yama);
    let yeni = yp.once + JSON.stringify(uygula(yp.ayarlar), null, 2) + yp.sonra;
    if (linkVar) yeni = setEk.linkYamasiEkle(yeni);
    out.set(YAMA, Buffer.from(yeni));
  }
  if (t.ayar != null) {
    out.set(AYAR, Buffer.from(`${JSON.stringify(uygula(JSON.parse(t.ayar)), null, 2)}\n`));
  }
  if (t.tanim != null) {
    const tn = JSON.parse(t.tanim);
    const kit = girdiler.filter((k) => !k.link).map((k) => ({
      ad: k.ad, assetId: String(k.id), dugmeGorseliVarMi: false, grup: k.grup || '',
      id: gMenu.kararliKimlik(k.dizin, String(k.id)), kapakVarMi: false, klasor: k.dizin,
      klasorElleYazildi: false,
    }));
    const t2 = { ...tn, kitaplar: kit, ...(setAdi ? { setAdi } : {}) };
    out.set(TANIM, Buffer.from(`${JSON.stringify(t2, null, 2)}\n`));
  }
  if (t.index != null && setAdi) {
    const yeni = String(t.index).replace(/<title>[^<]*<\/title>/, `<title>${xmlKacis(setAdi)}</title>`);
    out.set('index.html', Buffer.from(yeni));
  }
  return out;
}

// ─── Kalıp (motor) ve kabuk (tema) ──────────────────────────────────────────────────────────

const metinAl = (zip, dizin, yol) => (dizin.has(yol)
  ? M.zipGirdiOku(zip, dizin.get(yol)).toString('utf8') : null);

/**
 * Kalıp build'inden motor: tek kapaklı, İmpark kimlikli menüsü + index.html + app.config.js olan
 * İLK bookN (set-ek kalıp seçimiyle aynı ölçüt). Kalıbın kurum.txt'si döner (yayıncı denetimi için).
 */
function kalipOku(kalipZip) {
  const dizin = M.zipDizini(kalipZip);
  const kitaplar = [...new Set([...dizin.keys()].map((a) => a.split('/')[0])
    .filter((d) => /^book\d+$/.test(d)))].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  for (const d of kitaplar) {
    const menu = dizin.get(`${d}/${MENU}`);
    if (!menu || !dizin.has(`${d}/index.html`) || !dizin.has(`${d}/app.config.js`)) continue;
    const ham = M.zipGirdiOku(kalipZip, menu);
    let xml = null;
    try { xml = ig.menuCoz(ham); } catch (_) { xml = null; }
    const c = xml ? ig.kapaklar(xml) : [];
    if (c.length !== 1 || !imparkKimligiMi(c[0].ID)) continue;
    const kurumMetni = metinAl(kalipZip, dizin, `${d}/kurum.txt`) || metinAl(kalipZip, dizin, 'kurum.txt');
    return {
      zip: kalipZip, dizin, motor: d, kalipXml: xml, menuBicim: ig.menuBicimi(ham),
      sablon: M.ucSablonu(metinAl(kalipZip, dizin, `${d}/app.config.js`)),
      kurum: (kurumMetni || '').trim() || null,
      kokEkleri: KOK_MOTOR_EKLERI.filter((y) => dizin.has(y) && !dizin.has(`${d}/${y}`)),
      kabuk: !!(dizin.has(AYAR) && dizin.has('scripts/language-set.js')),
    };
  }
  throw new UretecHatasi('kalıp build\'de tek kapaklı İmpark motoru (bookN) yok', { kod: KOD.KALIP });
}

/**
 * TEMA KANCASI — `kabuk` biçimi: 'kalip' (kalıp build'in kendi Web-Z kökü, ör. YDS sf425) |
 * {zip} (kök menü kabuğu zip'i) | {dizin} (kök menü kabuğu klasörü). null/undefined → kabuk yok. SAF.
 */
function kabukGecerliMi(kabuk, kalip) {
  if (kabuk === 'kalip') return !!(kalip && kalip.kabuk);
  // Tema kabuğu kökü kendisi üretir: kalıpta sf425 (language-set.js) ARANMAZ.
  if (kabuk && typeof kabuk === 'object' && kabuk.tema) return !!temaKabuk.TEMALAR[kabuk.tema];
  return !!(kabuk && typeof kabuk === 'object' && (kabuk.zip || kabuk.dizin));
}

async function unzipKomut(args, komut) {
  const r = await komut('unzip', ['-q', '-o', ...args]);
  if (r.code !== 0) throw new UretecHatasi(`unzip ${r.code}: ${String(r.stderr).slice(-200)}`, { kod: KOD.IO });
}

/** Kabuğu `kok`e açar (bookN/ ve eski kapak görselleri `images/book*` alınmaz). */
async function kabukAc(kabuk, kalip, kok, komut) {
  if (kabuk === 'kalip' || kabuk.zip) {
    await unzipKomut([kabuk === 'kalip' ? kalip.zip : kabuk.zip, '-x', 'book*/*', 'images/book*', '-d', kok], komut);
    return;
  }
  await fsp.cp(kabuk.dizin, kok, {
    recursive: true,
    filter: (k) => {
      const rel = path.relative(kabuk.dizin, k).split(path.sep);
      return !/^book\d+$/.test(rel[0]) && !(rel[0] === 'images' && /^book/.test(rel[1] || ''));
    },
  });
}

/** Motoru `hedef` dizinine açar (assets/classlibraries/temp hariç). */
async function motorAc(kalip, hedef, komut) {
  const gecici = `${hedef}.motor-${process.pid}`;
  const d = kalip.motor;
  await unzipKomut([kalip.zip, `${d}/*`, '-x', ...MOTOR_HARIC.map((h) => `${d}/${h}/*`), '-d', gecici], komut);
  await fsp.rename(path.join(gecici, d), hedef);
  await fsp.rmdir(gecici).catch(() => {});
}

// ─── Yayıncı dönüşümü (faz 3) ──────────────────────────────────────────────────────────────────

/** Motorun logo gizlemesi (ilk 100 bayt 256-b; kendi kendinin tersi). SAF. */
function logoGizle(buf) {
  const b = Buffer.from(buf);
  for (let i = 0; i < 100 && i < b.length; i++) b[i] = (256 - b[i]) & 255;
  return b;
}

/** Motor bu dosyayı "düz" sayar mı (ilk 10 baytta "PNG" → çevrimiçi İmpark logosuyla EZER). SAF. */
const logoDuzMu = (buf) => Buffer.isBuffer(buf) && buf.subarray(0, 10).toString('latin1').includes('PNG');

/** `app.config.js` metninde `baseEndpointUrl` yaz (varsa değiştir, yoksa AppConfig'in başına). SAF. */
function tabanUcYaz(metin, uc) {
  const m = String(metin);
  const re = /(baseEndpointUrl\s*:\s*)(["'])[^"']*\2/;
  if (re.test(m)) return m.replace(re, (_, a) => `${a}"${uc}"`);
  const ac = /((?:const|let|var)\s+AppConfig\s*=\s*\{)/;
  if (!ac.test(m)) throw new UretecHatasi('app.config.js: AppConfig nesnesi yok', { kod: KOD.DONUSUM });
  return m.replace(ac, (a) => `${a}\n    baseEndpointUrl: "${uc}",`);
}

/** Dönüşüm parametresi denetimi. SAF. */
function donusumDenetle(d) {
  if (!d) return null;
  if (!/^\d+$/.test(String(d.kurum || ''))) throw new UretecHatasi('motorDonusumu.kurum geçersiz', { kod: KOD.PARAMETRE });
  if (!Buffer.isBuffer(d.logo) || temaKabuk.gorselUzanti(d.logo) !== 'png') {
    throw new UretecHatasi('motorDonusumu.logo düz PNG değil', { kod: KOD.PARAMETRE });
  }
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(String(d.baseEndpointUrl || ''))) {
    throw new UretecHatasi('motorDonusumu.baseEndpointUrl geçersiz', { kod: KOD.PARAMETRE });
  }
  return { ...d, kurum: String(d.kurum) };
}

/** Motor dizinine (bookN ya da tek-motor kökü) üç motor noktasını yazar. I/O. */
async function motorDonusumuUygula(dizin, d) {
  await fsp.writeFile(path.join(dizin, 'kurum.txt'), d.kurum);
  await fsp.mkdir(path.join(dizin, 'core'), { recursive: true });
  await fsp.writeFile(path.join(dizin, KURUM_LOGO), logoGizle(d.logo));
  const ac = path.join(dizin, APP_CONFIG);
  await fsp.writeFile(ac, tabanUcYaz(await fsp.readFile(ac, 'utf8'), d.baseEndpointUrl));
}

/**
 * Dört noktanın KANITI — yazılanı diskten yeniden okur; tutmayan nokta → UretecHatasi(donusum).
 * @returns {{kurum:string, uc:string, logoSha256:string, motorlar:string[], kokKurum:string}}
 */
function motorDonusumuDogrula(kok, motorlar, d) {
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const beklenenLogo = sha(d.logo);
  const hata = [];
  const oku = (y) => { try { return fs.readFileSync(path.join(kok, y)); } catch (_) { return null; } };
  const kokKurum = String(oku('kurum.txt') || '').trim();
  if (kokKurum !== d.kurum) hata.push(`kök kurum.txt=${kokKurum || '-'}`);
  for (const m of motorlar) {
    const on = m ? `${m}/` : '';
    const kt = String(oku(`${on}kurum.txt`) || '').trim();
    if (kt !== d.kurum) hata.push(`${on}kurum.txt=${kt || '-'}`);
    const logo = oku(`${on}${KURUM_LOGO}`);
    if (!logo || logoDuzMu(logo) || sha(logoGizle(logo)) !== beklenenLogo) hata.push(`${on}${KURUM_LOGO}`);
    const ac = String(oku(`${on}${APP_CONFIG}`) || '');
    const um = /baseEndpointUrl\s*:\s*["']([^"']*)["']/.exec(ac);
    if (!um || um[1] !== d.baseEndpointUrl) hata.push(`${on}${APP_CONFIG} baseEndpointUrl=${um ? um[1] : '-'}`);
  }
  if (hata.length) {
    throw new UretecHatasi(`yayıncı dönüşümü tutmadı: ${hata.slice(0, 4).join(', ')}`, { kod: KOD.DONUSUM });
  }
  return { kurum: d.kurum, uc: d.baseEndpointUrl, logoSha256: beklenenLogo, motorlar, kokKurum };
}

/** Panel kapağı (liste 3. alanı): data URI → Buffer, http(s) → indirilir; görsel değilse null. */
async function kapakCoz(deger, kapakGetir) {
  const v = String(deger || '').trim();
  if (!v) return null;
  let buf = temaKabuk.dataUriCoz(v);
  if (!buf && /^https?:\/\/\S+$/i.test(v)) {
    try { buf = await kapakGetir(v); } catch (_) { buf = null; }
  }
  return buf && temaKabuk.gorselUzanti(buf) ? buf : null;
}

async function varsayilanKapakGetir(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// ─── İçerik ─────────────────────────────────────────────────────────────────────────────────

function icerikDenetle(gDizin, id) {
  const eksik = [];
  if (!gDizin.has(ICERIK)) eksik.push(ICERIK);
  if (!gDizin.has(KAPAK)) eksik.push(KAPAK);
  if (!ILK_SAYFA.some((p) => gDizin.has(p))) eksik.push('pages/1.*');
  if (eksik.length) throw new Error(`${id} içerik zip'inde ${eksik.join(', ')} yok`);
  for (const ad of gDizin.keys()) {
    const rel = ig.girdiGoreli(path, ad);
    if (rel == null || rel !== ad.replace(/\/+$/, '')) {
      throw new Error(`${id} içerik zip'inde güvensiz girdi ${JSON.stringify(ad)}`);
    }
  }
}

/** Genel/boş ad → BookContent `pdfUrl`'den ad (set-ek ile aynı çözücü); bulunamazsa eldeki. */
function adCoz(k, arsiv, gDizin) {
  if (k.ad && !GENEL_AD.test(k.ad)) return k.ad;
  try {
    const bc = M.zipGirdiOku(arsiv, gDizin.get(ICERIK)).subarray(0, 8192).toString('utf8');
    return bicim.kitapAdiBookContenttan(bc) || k.ad || `Kitap ${k.n}`;
  } catch (_) { return k.ad || `Kitap ${k.n}`; }
}

/** Her kitabın içerik zip'i. Kitap alınamazsa `eksik`; kitap olmayan varlık `kitapDisi` (link/atla). */
async function icerikleriTopla({ plan, sablon, getir, indir, onbellek, log, bekleMs }) {
  const sonuc = [];
  const eksik = [];
  const kitapDisi = [];
  for (const k of plan.kitaplar) {
    try {
      const soru = M.teklifUrl(sablon, k.id, 0);
      const t = M.teklifYorumla({ id: k.id, surum: 0 }, await getir(soru, {}));
      if (t.durum === M.DURUM.GUNCEL) throw new Error("İmpark'ta içerik yok (Data boş)");
      if (t.durum !== M.DURUM.GERIDE) throw new Error(`İmpark ölçülemedi: ${t.not}`);
      const arsiv = await M.icerikZipiGetir({
        id: k.id, vs: t.vs, url: t.data, onbellek, indir,
        log: (s) => log(s.replace('[merdiven] S1', ISARET)),
      });
      const gDizin = M.zipDizini(arsiv);
      icerikDenetle(gDizin, k.id);
      sonuc.push({ ...k, ad: adCoz(k, arsiv, gDizin), vs: t.vs, url: t.data, arsiv, gDizin });
    } catch (e) {
      const satir = { id: k.id, ad: k.ad, contentType: k.contentType, anahtar: k.anahtar,
        sebep: String((e && e.message) || e).slice(0, 300) };
      (kitapTuruMu(k.contentType) ? eksik : kitapDisi).push(satir);
    }
    if (bekleMs) await new Promise((r) => { setTimeout(r, bekleMs); }); // İmpark'a ≥1,5 sn ara
  }
  return { sonuc, eksik, kitapDisi };
}

async function icerikAc(k, hedef, komut) {
  await fsp.mkdir(hedef, { recursive: true });
  await unzipKomut([k.arsiv, '-d', hedef], komut);
  const bozuk = [...k.gDizin.values()].filter((g) => !g.dizin).find((g) => {
    try { return fs.statSync(path.join(hedef, g.ad)).size !== g.boyut; } catch (_) { return true; }
  });
  if (bozuk) throw new UretecHatasi(`${k.id} açma eksik: ${bozuk.ad}`, { kod: KOD.IO });
}

async function menuYaz(kok, xml, menuBicimi, tohum) {
  const y = path.join(kok, MENU);
  await fsp.mkdir(path.dirname(y), { recursive: true });
  const veri = ig.menuKodla(xml, setEk.tohumluRastgele(tohum), menuBicimi);
  if (ig.menuCoz(veri) !== xml) throw new UretecHatasi('menü kodlama gidiş-dönüş tutmadı', { kod: KOD.MENU });
  await fsp.writeFile(y, veri);
}

function sha256Dosya(dosya) {
  return new Promise((res, rej) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(dosya).on('data', (d) => h.update(d)).on('error', rej)
      .on('end', () => res(h.digest('hex')));
  });
}

// ─── Giriş noktası ──────────────────────────────────────────────────────────────────────────

/**
 * build.zip üretir. I/O: kalıp zip okunur, içerik önbelleği/indirme, sahne dizini, çıktı zip.
 * @param {{setId:string, setAdi?:string, listeHam:string, kalipZip:string, cikti:string,
 *   calisma:string, duzen?:string, aktivasyon?:string, anahtarliMi?:(id:string)=>Promise<boolean>,
 *   kabuk?:'kalip'|{zip?:string, dizin?:string}|{tema:string}|null, webzAdresi?:(g:object)=>string|null,
 *   kurum?:string|null, motorDonusumu?:{kurum:string, logo:Buffer, baseEndpointUrl:string}|null,
 *   kapakGetir?:(url:string)=>Promise<Buffer>, onbellek?:string, getir?:Function, indir?:Function, komut?:Function,
 *   log?:Function, bekleMs?:number, sahneyiTut?:boolean}} o
 * @returns {Promise<object>} rapor (zip, duzen, aktivasyon, kitaplar, linkKarti, atlanan, kapiListesi…)
 */
async function uret(o) {
  const log = o.log || (() => {});
  const komut = o.komut || M.komut;
  const istenen = o.aktivasyon || AKTIVASYON.YOK;
  const plan = planKur({
    listeHam: o.listeHam, duzen: o.duzen || DUZEN.OTOMATIK,
    aktivasyon: istenen === AKTIVASYON.OTOMATIK ? AKTIVASYON.YOK : istenen,
  });
  const kalip = kalipOku(o.kalipZip);
  const donusum = donusumDenetle(o.motorDonusumu);
  const temaAdi = o.kabuk && typeof o.kabuk === 'object' && o.kabuk.tema ? String(o.kabuk.tema) : null;
  // Aktivasyon kancası: 'otomatik' → anahtarliMi her kapak için (çağıran verir).
  const anahtarli = [];
  if (istenen === AKTIVASYON.OTOMATIK) {
    if (typeof o.anahtarliMi !== 'function') {
      throw new UretecHatasi("aktivasyon 'otomatik' ama anahtarliMi verilmedi", { kod: KOD.PARAMETRE });
    }
    for (const k of plan.kitaplar) anahtarli.push(await o.anahtarliMi(k.id));
  }
  const aktivasyon = aktivasyonKarari(istenen, anahtarli);
  const duzen = duzenKarari(plan.duzen, aktivasyon);
  // TEMA KANCASI: bookN kökü dışarıdan verilen kabuktur; yoksa ERTELE (içerik indirilmeden).
  if (duzen === DUZEN.BOOKN && !kabukGecerliMi(o.kabuk, kalip)) {
    throw new UretecHatasi('bookN düzeni için kök menü kabuğu (tema) yok — tema hazır olana kadar ertelenir',
      { kod: KOD.TEMA_YOK });
  }
  log(`${ISARET} ${o.setId}: ${plan.kitaplar.length} kitap, düzen ${duzen}, aktivasyon ${aktivasyon}, `
    + `motor ${path.basename(path.dirname(o.kalipZip))}/${kalip.motor} (kurum ${kalip.kurum || '-'})`);

  const { sonuc, eksik, kitapDisi } = await icerikleriTopla({
    plan, sablon: kalip.sablon || VARSAYILAN_SABLON, getir: o.getir || M.varsayilanGetir,
    indir: o.indir || M.varsayilanIndir, onbellek: o.onbellek || M.icerikOnbellekKoku(), log,
    bekleMs: o.bekleMs == null ? 1500 : o.bekleMs,
  });
  if (eksik.length) {
    throw new UretecHatasi(`${eksik.length} kitap alınamadı (ilk: ${eksik[0].id} ${eksik[0].sebep})`
      + ' — build YAZILMADI', { kod: KOD.KITAP_EKSIK, eksik });
  }
  // Zip'i olmayan kitap-dışı varlık: bookN'de link kartı (adres verilirse), tek-motorda atlanır.
  const cevrilen = new Map();
  const linkKarti = [];
  const atlanan = [];
  for (const g of [...kitapDisi, ...plan.disarida.map((x) => ({ id: x.assetId, ad: x.ad, anahtar: x.anahtar,
    contentType: x.contentType, sebep: 'İmpark kimliği değil' }))]) {
    const url = duzen === DUZEN.BOOKN && o.webzAdresi ? o.webzAdresi(g) : null;
    if (url) linkKarti.push({ ...g, url }); else atlanan.push(g);
    cevrilen.set(String(g.id), url || null);
  }
  const kapiListesi = kapiListesiKur(o.listeHam, cevrilen);

  await fsp.mkdir(o.calisma, { recursive: true });
  const sahne = await fsp.mkdtemp(path.join(o.calisma, 'uretec-sahne-'));
  const kurum = o.kurum != null ? String(o.kurum) : (donusum ? donusum.kurum : null);
  const kok = path.join(sahne, 'build');
  const kitapRapor = [];
  const motorlar = [];
  const kapakSay = { panel: 0, yedek: 0 };
  let donusumKaniti = null;
  try {
    if (duzen === DUZEN.TEK_MOTOR) {
      await motorAc(kalip, kok, komut);
      for (const y of kalip.kokEkleri) await unzipKomut([kalip.zip, y, '-d', kok], komut);
      if (donusum) await motorDonusumuUygula(kok, donusum);
      motorlar.push('');
      const xml = tekMotorMenuXml({
        kalipXml: kalip.kalipXml, setId: String(o.setId), setAdi: o.setAdi || '', aktivasyon, kurum,
        kitaplar: sonuc,
      });
      await menuYaz(kok, xml, kalip.menuBicim, `${o.setId}:${sonuc.map((k) => `${k.id}-${k.vs}`).join(',')}`);
      for (const k of sonuc) {
        await icerikAc(k, path.join(kok, 'assets', k.id), komut);
        kitapRapor.push({ n: k.n, id: k.id, vs: k.vs, yer: `assets/${k.id}`, ad: k.ad, grup: k.grup });
      }
    } else {
      await fsp.mkdir(kok, { recursive: true });
      if (!temaAdi) await kabukAc(o.kabuk, kalip, kok, komut);
      const motorKalibi = path.join(sahne, '.motor');
      await motorAc(kalip, motorKalibi, komut);
      if (donusum) await motorDonusumuUygula(motorKalibi, donusum); // bir kez; kopyalar miras alır
      for (const k of sonuc) {
        const d = k.anahtar; // liste anahtarı (bookN; link ile aynı sayaç — Worker/set-ek ile aynı)
        await fsp.cp(motorKalibi, path.join(kok, d), { recursive: true, errorOnExist: true, force: false });
        const xml = setEk.menuXmlUret(kalip.kalipXml, { id: k.id, vs: k.vs, url: k.url, ad: k.ad });
        await menuYaz(path.join(kok, d), xml, kalip.menuBicim, `${k.id}:${k.vs}`);
        await icerikAc(k, path.join(kok, d, 'assets', k.id), komut);
        motorlar.push(d);
        kitapRapor.push({ n: k.n, id: k.id, vs: k.vs, yer: `${d}/assets/${k.id}`, ad: k.ad, grup: k.grup });
      }
      // Menü girdileri liste sırasıyla: kitap / liste linki / kitap-dışı varlığın link kartı.
      const girdiler = [];
      for (const g of plan.liste) {
        const k = sonuc.find((x) => x.anahtar === g.anahtar);
        if (k) girdiler.push({ dizin: k.anahtar, id: k.id, ad: k.ad, grup: k.grup, contentType: k.contentType });
        else if (g.link && /^https?:\/\/\S+$/i.test(g.url || '')) {
          girdiler.push({ dizin: g.anahtar, link: true, url: g.url, ad: g.ad });
        } else {
          const lk = linkKarti.find((x) => x.anahtar === g.anahtar);
          if (lk) girdiler.push({ dizin: `link${g.sira}`, link: true, url: lk.url, ad: lk.ad || g.ad });
        }
      }
      let dosyalar;
      if (temaAdi) {
        // Kök = tema kabuğu (kalıbın kökü AÇILMADI). Kapak = panel coverUrl; ünite = BookContent.
        const kitaplar = [];
        for (const g of girdiler) {
          if (g.link) { kitaplar.push({ dizin: g.dizin, link: true, url: g.url, ad: g.ad }); continue; }
          const k = sonuc.find((x) => x.anahtar === g.dizin);
          const kapak = await kapakCoz(k && k.kapak, o.kapakGetir || varsayilanKapakGetir);
          kapakSay[kapak ? 'panel' : 'yedek'] += 1;
          let bookContent = null;
          try { bookContent = fs.readFileSync(path.join(kok, g.dizin, 'assets', g.id, ICERIK)); } catch (_) { /* yok */ }
          kitaplar.push({ dizin: g.dizin, assetId: g.id, ad: g.ad, grup: g.grup, contentType: g.contentType || 'book',
            kapak, bookContent });
        }
        try {
          dosyalar = temaKabuk.kabukUret({ tema: temaAdi, setAdi: o.setAdi || String(o.setId), kitaplar }).dosyalar;
        } catch (e) {
          throw new UretecHatasi(`tema kabuğu üretilemedi: ${e.message}`, { kod: KOD.TEMA });
        }
      } else {
        const oku = (y) => { try { return fs.readFileSync(path.join(kok, y), 'utf8'); } catch (_) { return null; } };
        dosyalar = webzMenuDosyalari(
          { yama: oku(YAMA), ayar: oku(AYAR), tanim: oku(TANIM), index: oku('index.html') },
          { setAdi: o.setAdi || '', girdiler },
        );
      }
      for (const [y, v] of dosyalar) {
        await fsp.mkdir(path.dirname(path.join(kok, y)), { recursive: true });
        await fsp.writeFile(path.join(kok, y), v);
      }
    }
    if (kurum) await fsp.writeFile(path.join(kok, 'kurum.txt'), kurum);
    if (donusum) donusumKaniti = motorDonusumuDogrula(kok, motorlar, donusum);

    await fsp.mkdir(path.dirname(o.cikti), { recursive: true });
    const gecici = `${o.cikti}.yazim-${process.pid}`;
    const z = await komut('zip', ['-q', '-r', '-D', '-X', '-n', M.SIKISIK_UZANTILAR,
      path.resolve(gecici), '.'], { cwd: kok });
    if (z.code !== 0) {
      throw new UretecHatasi(`zip yazılamadı (${z.code}): ${String(z.stderr).slice(-200)}`, { kod: KOD.IO });
    }
    await fsp.rename(gecici, o.cikti);
    const boyut = (await fsp.stat(o.cikti)).size;
    const sha256 = await sha256Dosya(o.cikti);
    log(`${ISARET} ${o.setId}: build.zip ${(boyut / 1e6).toFixed(0)} MB, sha256 ${sha256.slice(0, 12)}…`
      + `${linkKarti.length ? `; link kartı ${linkKarti.length}` : ''}${atlanan.length ? `; atlanan ${atlanan.length}` : ''}`);
    return {
      setId: String(o.setId), zip: o.cikti, boyut, sha256, duzen, aktivasyon,
      motor: { kalip: o.kalipZip, dizin: kalip.motor, kurum: kalip.kurum, kurumYazilan: kurum },
      kabuk: duzen === DUZEN.BOOKN
        ? (o.kabuk === 'kalip' ? 'kalip' : (temaAdi ? `tema:${temaAdi}` : (o.kabuk.zip || o.kabuk.dizin))) : null,
      donusum: donusumKaniti,
      kapak: temaAdi ? kapakSay : null,
      kitaplar: kitapRapor,
      // n = liste satır sırası (link kartının dizini link<n>; bookN ile ORTAK sayaç — çakışmaz).
      linkKarti: linkKarti.map((g) => ({
        n: Number(String(g.anahtar || '').replace(/\D/g, '')) || null, assetId: g.id, ad: g.ad, url: g.url, sebep: g.sebep,
      })),
      atlanan: atlanan.map((g) => ({ assetId: g.id, ad: g.ad, sebep: g.sebep })),
      linkler: plan.linkler.map((g) => ({ ad: g.ad, url: g.url })),
      kapiListesi,
      sahne: o.sahneyiTut ? sahne : null,
    };
  } finally {
    if (!o.sahneyiTut) await fsp.rm(sahne, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Link kartına çevrilen liste öğeleri → `tamamla` `webzVarliklari` (yol 'link'). Sunucu kapısı kendi
 * (çevrilmemiş) listesindeki kimliği `kitaplar ∪ webzVarliklari` içinde arar; link kartı build'de
 * kitap değildir, içerik/kapak beklenmez (saha 02.10, 59480 3100010 Games: 409 kitap-eksik). SAF.
 */
function linkVarliklari(r) {
  return (r && Array.isArray(r.linkKarti) ? r.linkKarti : [])
    .filter((g) => Number.isSafeInteger(g.n) && g.n >= 1 && g.assetId != null && String(g.assetId) !== '')
    .map((g) => ({ n: g.n, id: String(g.assetId), yol: 'link', icerik: false, kapak: false }));
}

/** `tamamla` gövdesine giden üreteç özeti (sunucu bilinmeyen alanı atar; kayıt için book-update işi). SAF. */
function uretecOzeti(r) {
  return {
    kaynak: 'uretec', duzen: r.duzen, aktivasyon: r.aktivasyon,
    kalip: path.basename(path.dirname(r.motor.kalip)), motor: r.motor.dizin, kurum: r.motor.kurumYazilan || r.motor.kurum,
    kabuk: r.kabuk ? (r.kabuk === 'kalip' ? 'kalip' : path.basename(String(r.kabuk))) : null,
    kitap: r.kitaplar.length, linkKarti: r.linkKarti.length, atlanan: r.atlanan.length,
    ...(r.donusum ? { donusum: { kurum: r.donusum.kurum, uc: r.donusum.uc, motor: r.donusum.motorlar.length } } : {}),
    ...(r.kapak ? { kapak: r.kapak } : {}),
  };
}

module.exports = {
  ISARET, DUZEN, AKTIVASYON, KOD, UretecHatasi, planKur, grupOku, aktivasyonKarari, duzenKarari,
  kapiListesiKur, tekMotorMenuXml, webzMenuDosyalari, kalipOku, kabukGecerliMi, uret, uretecOzeti,
  KOK_MOTOR_EKLERI, MOTOR_HARIC, alanOku, logoGizle, logoDuzMu, tabanUcYaz, donusumDenetle,
  motorDonusumuUygula, motorDonusumuDogrula, kapakCoz, KURUM_LOGO, linkVarliklari,
};
