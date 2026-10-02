'use strict';

/**
 * INDEX ÜRETECİ — build kaynağı OLMAYAN setler için build.zip'i kendimiz kurarız (2026-10-02).
 * Sözleşme: book-update `exesiz-kaynak-sozlesmesi.md` §K ("set index'i BİZİMDİR, kitap listesi =
 * panel Web-Z listesi"), §5 (yazma kapısı), §2b (imKeys). Tasarım: `.claude/docs/index-ureteci-tasarimi.md`.
 *
 * NE YAPAR (yalnız yerel; R2/DB/İmpark'a YAZMAZ — İmpark'a yalnız motorun kendi GET sorusu):
 *   1. Web-Z listesi (`setListesiAyristir`, `link:` hariç) → plan (sıra, ad, grup).
 *   2. Her kitap için motorun sorusu `GetKitapGuncellemeBilgi?id=<id>&setMi=0&versiyon=0` → `Data`
 *      (ZKitapZipH/<id>-<Vs>.zip) → içerik önbelleği (`icerikZipiGetir`, merdivenle AYNI yol).
 *      Ölçüm (02.10): ZKitapZipH = Web-Z `WebDijitapDosyalar/<id>/` = arşiv `assets/<id>/` bayt bayt
 *      (73454 pages/1.png, thumbs/1.jpg, BookContent.xml md5 aynı; ilk 100 bayt gizleme dahil).
 *   3. Motor kabuğu = AYNI yayıncının arşivli bir build'indeki tek kapaklı İmpark `bookN/` motoru
 *      (assets/ classlibraries/ temp/ hariç). Exe KULLANILMAZ.
 *   4. İki düzen:
 *      - `tek-motor` (varsayılan; İmpark'ın kendi set exe'si gibi, 45472/45480): kök = motor,
 *        `classlibraries/ImWin32.dll` = TÜM kapaklar (Group/Tab = Web-Z grup sütunu), `assets/<id>/`.
 *        Aktivasyonlu sette ZORUNLU: kod setin ilk açılışında BİR kez sorulur (`main.activation`).
 *      - `bookN` (Web-Z kabuğu kökte, her kitap ayrı motor): kök menü = arşivli build'in Web-Z
 *        kabuğu (sf425 + çevrimdışı yama), `settings.books`/yama/`set-menu.json` listeden YENİDEN
 *        yazılır. Aktivasyonlu sette YASAK (her kitap ayrı sorar; kapak düzeyi dal çevrimdışında kırık).
 *   5. AKTİVASYON KANCASI: `aktivasyon` = 'set' | 'yok' | 'otomatik'. 'otomatik' → `anahtarliMi(id)`
 *      (varsayılan YOK; runner `imkeys.hasZKitapKeyIstemcisi` verir) en az bir kapakta true ise 'set'.
 *      'set' → `main.activation="true"`, `main.key=""`. imKeys.dll YAZILMAZ (runner `imkeys.js`
 *      her kaynakta set-ek sonrası yazar ve kapısını uygular).
 *   6. build.zip yazılır; yazma kapısı (`yazma-kapisi.js`) runner'da AYNEN koşar.
 *
 * YA HEP YA HİÇ: listedeki tek bir İmpark kitabı alınamazsa build YAZILMAZ (`eksik[]` + hata) —
 * kapı zaten `kitap-eksik` ile reddederdi; yarım set üretmeyiz.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const M = require('./icerik-merdiven');
const ig = require('../runtime/icerik-guncelleme');
const setEk = require('./set-uyelik-ek');
const gMenu = require('../../tools/g-yayin/menu');

const ISARET = '[index-ureteci]';
const DUZEN = Object.freeze({ TEK_MOTOR: 'tek-motor', BOOKN: 'bookN' });
const AKTIVASYON = Object.freeze({ SET: 'set', YOK: 'yok', OTOMATIK: 'otomatik' });
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

class UretecHatasi extends Error {
  constructor(mesaj, { kod = 'uretec', eksik = [] } = {}) {
    super(`${ISARET} ${mesaj}`);
    this.kod = kod;
    this.eksik = eksik;
  }
}

// ─── Saf kararlar ───────────────────────────────────────────────────────────────────────────

const imparkKimligiMi = (id) => /^[1-9]\d*$/.test(String(id == null ? '' : id));

function xmlKacis(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attrYaz(etiket, ad, deger) {
  const re = new RegExp(`(\\s${ad}=")[^"]*(")`);
  if (re.test(etiket)) return etiket.replace(re, (_, a, b) => `${a}${deger}${b}`);
  return etiket.replace(/\s*\/?>$/, (son) => ` ${ad}="${deger}"${son}`);
}

/** Satırın 5. alanı (grup). `setListesiAyristir` grubu döndürmez; ham satırdan okunur. SAF. */
function grupOku(listeHam, assetId) {
  const satirlar = String(listeHam || '').replace(/\\n/g, '\n').split(/\r?\n/).filter((s) => s.trim());
  const s = satirlar.find((x) => x.split('|')[0].trim() === String(assetId));
  if (!s) return '';
  return s.split('|').map((x) => x.trim())[4] || '';
}

/**
 * Plan — listeden kitaplar (sıra, ad, grup). SAF.
 * Aktivasyon 'set' iken `bookN` düzeni REDDEDİLİR (çok motorda her kitap ayrı sorar).
 * İmpark kimliği olmayan satır (Web-Z varlığı) build'e GİRMEZ → `disarida`.
 * @returns {{duzen:string, kitaplar:Array<{n:number, id:string, ad:string, grup:string,
 *   contentType:string|null}>, disarida:Array<object>, linkler:Array<object>}}
 */
function planKur({ listeHam, duzen = DUZEN.TEK_MOTOR, aktivasyon = AKTIVASYON.YOK } = {}) {
  if (!Object.values(DUZEN).includes(duzen)) {
    throw new UretecHatasi(`bilinmeyen düzen ${duzen}`, { kod: 'parametre' });
  }
  if (aktivasyon === AKTIVASYON.SET && duzen === DUZEN.BOOKN) {
    throw new UretecHatasi('aktivasyonlu set bookN düzeninde üretilmez (her kitap ayrı sorar) — tek-motor kullan',
      { kod: 'aktivasyon-duzen' });
  }
  const ham = listeHam == null ? '' : String(listeHam).replace(/\\n/g, '\n');
  const liste = setEk.setListesiAyristir(ham);
  if (!liste.length) throw new UretecHatasi('Web-Z listesi boş', { kod: 'liste-yok' });
  const linkler = liste.filter((g) => g.link);
  const kitapSatiri = liste.filter((g) => !g.link);
  const disarida = kitapSatiri.filter((g) => !imparkKimligiMi(g.assetId));
  const goruldu = new Set();
  const kitaplar = [];
  for (const g of kitapSatiri.filter((x) => imparkKimligiMi(x.assetId))) {
    if (goruldu.has(g.assetId)) continue; // aynı kitap iki kez → tek kapak
    goruldu.add(g.assetId);
    kitaplar.push({
      n: kitaplar.length + 1, id: String(g.assetId), ad: g.ad || `Kitap ${kitaplar.length + 1}`,
      grup: grupOku(ham, g.assetId), contentType: g.contentType || null,
    });
  }
  if (!kitaplar.length) throw new UretecHatasi('listede İmpark kitabı yok', { kod: 'liste-yok' });
  return { duzen, kitaplar, disarida, linkler };
}

/** Aktivasyon kararı: 'set' | 'yok'. 'otomatik' → anahtarliMi sonuçlarından. SAF. */
function aktivasyonKarari(aktivasyon, anahtarliSonuclari = []) {
  if (aktivasyon === AKTIVASYON.SET) return AKTIVASYON.SET;
  if (aktivasyon === AKTIVASYON.YOK) return AKTIVASYON.YOK;
  if (aktivasyon === AKTIVASYON.OTOMATIK) {
    return anahtarliSonuclari.some((x) => x === true) ? AKTIVASYON.SET : AKTIVASYON.YOK;
  }
  throw new UretecHatasi(`bilinmeyen aktivasyon ${aktivasyon}`, { kod: 'parametre' });
}

/**
 * Tek motorlu set menüsü (çözülmüş XML). Biçim: İmpark'ın kendi set exe'si (45472 Marvel 12, 02.10
 * çözüldü): `<main type="1" ID="<set>" activation key ...><Group><Tab><cover/></Tab></Group>`.
 * Kapak etiketi kalıp kitabın (bookN menüsü) tek kapağından türetilir; alanlar set-ek
 * `menuXmlUret` ile aynı. Kapak görseli içerikteki `thumbs/1.jpg` (ZKitapZipH ayrı kapak taşımaz). SAF.
 * @param {{kalipXml:string, setId:string, setAdi:string, aktivasyon:'set'|'yok', kurum?:string|null,
 *   kitaplar:Array<{id:string, vs:number, url:string, ad:string, grup:string}>}} p
 */
function tekMotorMenuXml({ kalipXml, setId, setAdi, aktivasyon, kurum = null, kitaplar }) {
  const kalip = String(kalipXml || '');
  const mainM = /<main\b[^>]*>/.exec(kalip);
  const kapakM = kalip.match(/<cover\b[^>]*>/g) || [];
  if (!mainM) throw new UretecHatasi('kalıp menüde <main> yok', { kod: 'kalip' });
  if (kapakM.length !== 1) {
    throw new UretecHatasi(`kalıp menüde ${kapakM.length} kapak (tam 1 olmalı)`, { kod: 'kalip' });
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
    throw new UretecHatasi('üretilen menü doğrulanamadı (kapak sırası/sürümü)', { kod: 'menu' });
  }
  return xml;
}

/**
 * bookN düzeninin Web-Z menü dosyaları (kabuk kalıbından, liste ile YENİDEN). Kalıbın eski kitap
 * girdileri TAŞINMAZ (set-ek `webzYaz` mevcut girdiyi korur; burada set sıfırdan kurulur). SAF.
 * @param {{yama:string|null, ayar:string|null, tanim:string|null, index:string|null}} t
 * @returns {Map<string, Buffer>}
 */
function webzMenuDosyalari(t, { setAdi, kitaplar }) {
  if (t.yama == null && t.ayar == null) {
    throw new UretecHatasi('kabuk kalıbında Web-Z menüsü yok', { kod: 'kalip' });
  }
  const books = {};
  kitaplar.forEach((k, i) => {
    const d = `book${k.n}`;
    books[d] = {
      assetId: String(k.id), contentType: k.contentType || 'book',
      coverUrl: `${d}/assets/${k.id}/${KAPAK}`, displayOrder: i, title: k.ad,
      ...(k.grup ? { group: k.grup } : {}),
    };
  });
  const uygula = (a) => ({
    ...a, books, bookCount: kitaplar.length, ...(setAdi ? { setTitle: setAdi } : {}),
  });
  const out = new Map();
  if (t.yama != null) {
    const yp = gMenu.yamaAyir(t.yama);
    out.set(YAMA, Buffer.from(yp.once + JSON.stringify(uygula(yp.ayarlar), null, 2) + yp.sonra));
  }
  if (t.ayar != null) {
    out.set(AYAR, Buffer.from(`${JSON.stringify(uygula(JSON.parse(t.ayar)), null, 2)}\n`));
  }
  if (t.tanim != null) {
    const tn = JSON.parse(t.tanim);
    const kit = kitaplar.map((k) => ({
      ad: k.ad, assetId: String(k.id), dugmeGorseliVarMi: false, grup: k.grup || '',
      id: gMenu.kararliKimlik(`book${k.n}`, String(k.id)), kapakVarMi: false, klasor: `book${k.n}`,
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

// ─── Kalıp (motor kabuğu) ───────────────────────────────────────────────────────────────────

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
  throw new UretecHatasi('kalıp build\'de tek kapaklı İmpark motoru (bookN) yok', { kod: 'kalip' });
}

async function unzipKomut(args, komut) {
  const r = await komut('unzip', ['-q', '-o', ...args]);
  if (r.code !== 0) throw new UretecHatasi(`unzip ${r.code}: ${String(r.stderr).slice(-200)}`, { kod: 'io' });
}

/** Motoru `hedef` dizinine açar (assets/classlibraries/temp hariç). */
async function motorAc(kalip, hedef, komut) {
  const gecici = `${hedef}.motor-${process.pid}`;
  const d = kalip.motor;
  await unzipKomut([kalip.zip, `${d}/*`, '-x', ...MOTOR_HARIC.map((h) => `${d}/${h}/*`), '-d', gecici], komut);
  await fsp.rename(path.join(gecici, d), hedef);
  await fsp.rmdir(gecici).catch(() => {});
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

/** Her kitabın içerik zip'i (önbellek ya da indirme). Ya hep ya hiç (eksik listesi döner). */
async function icerikleriTopla({ plan, sablon, getir, indir, onbellek, log, bekleMs }) {
  const sonuc = [];
  const eksik = [];
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
      sonuc.push({ ...k, vs: t.vs, url: t.data, arsiv, gDizin });
    } catch (e) {
      eksik.push({ id: k.id, ad: k.ad, sebep: String((e && e.message) || e).slice(0, 300) });
    }
    if (bekleMs) await new Promise((r) => { setTimeout(r, bekleMs); }); // İmpark'a ≥1,5 sn ara
  }
  return { sonuc, eksik };
}

async function icerikAc(k, hedef, komut) {
  await fsp.mkdir(hedef, { recursive: true });
  await unzipKomut([k.arsiv, '-d', hedef], komut);
  const bozuk = [...k.gDizin.values()].filter((g) => !g.dizin).find((g) => {
    try { return fs.statSync(path.join(hedef, g.ad)).size !== g.boyut; } catch (_) { return true; }
  });
  if (bozuk) throw new UretecHatasi(`${k.id} açma eksik: ${bozuk.ad}`, { kod: 'io' });
}

async function menuYaz(kok, xml, bicim, tohum) {
  const y = path.join(kok, MENU);
  await fsp.mkdir(path.dirname(y), { recursive: true });
  const veri = ig.menuKodla(xml, setEk.tohumluRastgele(tohum), bicim);
  if (ig.menuCoz(veri) !== xml) throw new UretecHatasi('menü kodlama gidiş-dönüş tutmadı', { kod: 'menu' });
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
 *   kurum?:string|null, onbellek?:string, getir?:Function, indir?:Function, komut?:Function,
 *   log?:Function, bekleMs?:number, sahneyiTut?:boolean}} o
 * @returns {Promise<object>} rapor (zip, duzen, aktivasyon, kitaplar[{n,id,vs,yer}], disarida, motor…)
 */
async function uret(o) {
  const log = o.log || (() => {});
  const komut = o.komut || M.komut;
  const istenen = o.aktivasyon || AKTIVASYON.YOK;
  const plan = planKur({
    listeHam: o.listeHam, duzen: o.duzen || DUZEN.TEK_MOTOR,
    aktivasyon: istenen === AKTIVASYON.OTOMATIK ? AKTIVASYON.YOK : istenen,
  });
  const kalip = kalipOku(o.kalipZip);
  if (plan.duzen === DUZEN.BOOKN && !kalip.kabuk) {
    throw new UretecHatasi('bookN düzeni için kalıpta Web-Z kabuğu (config/settings.json + '
      + 'scripts/language-set.js) yok', { kod: 'kalip' });
  }
  // Aktivasyon kancası: 'otomatik' → anahtarliMi her kapak için (çağıran verir).
  const anahtarli = [];
  if (istenen === AKTIVASYON.OTOMATIK) {
    if (typeof o.anahtarliMi !== 'function') {
      throw new UretecHatasi("aktivasyon 'otomatik' ama anahtarliMi verilmedi", { kod: 'parametre' });
    }
    for (const k of plan.kitaplar) anahtarli.push(await o.anahtarliMi(k.id));
  }
  const aktivasyon = aktivasyonKarari(istenen, anahtarli);
  if (aktivasyon === AKTIVASYON.SET && plan.duzen === DUZEN.BOOKN) {
    throw new UretecHatasi('anahtarlı kapak var — bookN düzeni reddedildi (tek-motor kullan)',
      { kod: 'aktivasyon-duzen' });
  }
  log(`${ISARET} ${o.setId}: ${plan.kitaplar.length} kitap, düzen ${plan.duzen}, aktivasyon ${aktivasyon}, `
    + `motor ${path.basename(path.dirname(o.kalipZip))}/${kalip.motor} (kurum ${kalip.kurum || '-'})`);

  const { sonuc, eksik } = await icerikleriTopla({
    plan, sablon: kalip.sablon || VARSAYILAN_SABLON, getir: o.getir || M.varsayilanGetir,
    indir: o.indir || M.varsayilanIndir, onbellek: o.onbellek || M.icerikOnbellekKoku(), log,
    bekleMs: o.bekleMs == null ? 1500 : o.bekleMs,
  });
  if (eksik.length) {
    throw new UretecHatasi(`${eksik.length} kitap alınamadı (ilk: ${eksik[0].id} ${eksik[0].sebep})`
      + ' — build YAZILMADI', { kod: 'kitap-eksik', eksik });
  }

  await fsp.mkdir(o.calisma, { recursive: true });
  const sahne = await fsp.mkdtemp(path.join(o.calisma, 'uretec-sahne-'));
  const kurum = o.kurum != null ? String(o.kurum) : null;
  const kok = path.join(sahne, 'build');
  const kitapRapor = [];
  try {
    if (plan.duzen === DUZEN.TEK_MOTOR) {
      await motorAc(kalip, kok, komut);
      for (const y of kalip.kokEkleri) await unzipKomut([kalip.zip, y, '-d', kok], komut);
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
      // Kabuk: kalıbın kökü (bookN/ ve eski kapak görselleri hariç); menü dosyaları liste ile yeniden.
      await unzipKomut([kalip.zip, '-x', 'book*/*', 'images/book*', '-d', kok], komut);
      const motorKalibi = path.join(sahne, '.motor');
      await motorAc(kalip, motorKalibi, komut);
      for (const k of sonuc) {
        const d = `book${k.n}`;
        await fsp.cp(motorKalibi, path.join(kok, d), { recursive: true, errorOnExist: true, force: false });
        const xml = setEk.menuXmlUret(kalip.kalipXml, { id: k.id, vs: k.vs, url: k.url, ad: k.ad });
        await menuYaz(path.join(kok, d), xml, kalip.menuBicim, `${k.id}:${k.vs}`);
        await icerikAc(k, path.join(kok, d, 'assets', k.id), komut);
        kitapRapor.push({ n: k.n, id: k.id, vs: k.vs, yer: `${d}/assets/${k.id}`, ad: k.ad, grup: k.grup });
      }
      const oku = (y) => { try { return fs.readFileSync(path.join(kok, y), 'utf8'); } catch (_) { return null; } };
      const dosyalar = webzMenuDosyalari(
        { yama: oku(YAMA), ayar: oku(AYAR), tanim: oku(TANIM), index: oku('index.html') },
        { setAdi: o.setAdi || '', kitaplar: sonuc },
      );
      for (const [y, v] of dosyalar) await fsp.writeFile(path.join(kok, y), v);
    }
    if (kurum) await fsp.writeFile(path.join(kok, 'kurum.txt'), kurum);

    await fsp.mkdir(path.dirname(o.cikti), { recursive: true });
    const gecici = `${o.cikti}.yazim-${process.pid}`;
    const z = await komut('zip', ['-q', '-r', '-D', '-X', '-n', M.SIKISIK_UZANTILAR,
      path.resolve(gecici), '.'], { cwd: kok });
    if (z.code !== 0) {
      throw new UretecHatasi(`zip yazılamadı (${z.code}): ${String(z.stderr).slice(-200)}`, { kod: 'io' });
    }
    await fsp.rename(gecici, o.cikti);
    const boyut = (await fsp.stat(o.cikti)).size;
    const sha256 = await sha256Dosya(o.cikti);
    log(`${ISARET} ${o.setId}: build.zip ${(boyut / 1e6).toFixed(0)} MB, sha256 ${sha256.slice(0, 12)}…`);
    return {
      setId: String(o.setId), zip: o.cikti, boyut, sha256, duzen: plan.duzen, aktivasyon,
      motor: { kalip: o.kalipZip, dizin: kalip.motor, kurum: kalip.kurum, kurumYazilan: kurum },
      kitaplar: kitapRapor, disarida: plan.disarida.map((g) => ({ assetId: g.assetId, ad: g.ad })),
      linkler: plan.linkler.map((g) => ({ ad: g.ad, url: g.url })),
      // kaynak_build_surumleri.kaynak (varchar 32): üretecin kalıbı — rollback notuyla karışmaz (tasarım §6)
      kaynak: `uretec:${path.basename(path.dirname(o.kalipZip))}`.slice(0, 32),
      sahne: o.sahneyiTut ? sahne : null,
    };
  } finally {
    if (!o.sahneyiTut) await fsp.rm(sahne, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  ISARET, DUZEN, AKTIVASYON, UretecHatasi, planKur, grupOku, aktivasyonKarari, tekMotorMenuXml,
  webzMenuDosyalari, kalipOku, uret, KOK_MOTOR_EKLERI, MOTOR_HARIC,
};
