'use strict';

/**
 * PANEL MENÜ HİZALAMA — kök menülü tek-motor setin paket menüsünü panelin üye listesine
 * hizalar (2026-10-05, seçenek B).
 *
 * KÖK NEDEN (ölçüldü 05.10, 45449 "YDT Impact Grade 12 Set"):
 *   Okuyucu çevrimiçi açılışta `GetPackageBooks?id=<main.ID>` listesiyle menüyü BAŞTAN kurar
 *   (okuyucu modülü 6395, `p()`): gruplar/sekmeler listede ilk görülme sırasıyla, her kapak
 *   panel satırından. Kapağın sürümü `h(GroupId, TabId, Id)` ile ESKİ menüde aranır:
 *   Group ID → Tab ID → cover ID. Bulunamazsa içerik diskteyse v1, değilse v0.
 *   45449 paket menüsünde Group ID=45449, Tab ID=1..4; panelde Group 683, Tab 4294/1419/1421/
 *   1420/1422 → h() hiçbir kapağı bulamaz → hepsi v1 → İmpark güncelleme teklif eder (yeşil
 *   bulut). Panel sete 73010 ve 73147'yi eklemiş, pakette içerikleri yok → v0 (mavi bulut).
 *   Nadir'in kuralı: paket her panel üyesinin güncel içeriğini taşır, kullanıcı buluta basmaz.
 *
 * NE YAPAR (iş kopyası zip üstünde; arşiv/önbellek zip'ine DOKUNULMAZ):
 *   1. Kapsam: kökte `classlibraries/ImWin32.dll` VAR, `bookN/` menüsü YOK, `main.ID` İmpark
 *      kimliği. bookN menülü setler dokunulmadan geçer. Manuel build'de runner adımı hiç çağırmaz
 *      (sözleşme M1); r2-al ve arşiv/r2-kur'da çalışır (bayat R2 build'lerin tek düzeltme yolu).
 *   2. Panel tabanı PAKETTEN türetilir (YDS'ye sabit değil): `EMPP_PANEL_PAKET_URL` (yalnız üstüne
 *      yazma) > kök `app.config.js` `baseEndpointUrl` > menü kapaklarının `URL` alanındaki
 *      İmpark içerik alanı. sorucoz.tv / localhost aday değildir (`MobilService` yolu bize
 *      Cloudflare 403 verir, ölçüldü 05.10). Taban yoksa NO-OP + uyarı.
 *   3. Panel listesi (GET, salt okuma, aday başına 3 deneme). İKİ ayrı sonuç:
 *        - meşru boş (JSON geldi, `Books` boş/null; ör. "Kitap bulunamadı") → NO-OP;
 *        - ÖLÇÜLEMEDİ (ağ / HTTP / JSON değil, bütün adaylarda) → GEÇİCİ hata (`gecici=true`;
 *          runner `r2Ertele` ile kirayı bırakır, failed yazılmaz) + kanıt JSON.
 *      Menüde beklenmeyen yapı ya da bozuk panel satırı → NO-OP + uyarı + kanıt (iş düşmez).
 *   4. Eksik üye (içeriği `assets/<FixName>/data/BookContent.xml` yok ya da eski menüde kapağı
 *      yok): İmpark'a motorun sorusu (`versiyon=0`) → ZKitapZipH → içerik merdiveninin önbellek
 *      + indirme + açma + doğrulama yolu (`icerikZipiGetir`, `varsayilanIcerikYaz`, `acmaDogrula`).
 *      Teklif ölçülemedi / indirme ağ hatası → GEÇİCİ; İmpark'ta içerik yok → kalıcı hata.
 *   5. Kapak görseli: panel `Resim` dosyası `assets/<FixName>/<ad>` olarak (okuyucu `source`'u
 *      orada arar; yoksa her çevrimiçi açılışta indirir). En iyi çaba, toplam süre bütçeli.
 *   6. Menü yeniden yazımı: `<main>` etiketi bayt-aynı (activation, key, label, ID…); Group/Tab
 *      ID+label = panel; sıra = panel listesi (okuyucunun sırası); kapak etiketi aynı Id'li eski
 *      kapaktan (ustBar, arkaPlan, URL, corpID, key…) — `tabID`, `actName` panelden,
 *      `xmlSource` = `assets/<FixName>/data/BookContent.xml`; `version` = paketteki içeriğin
 *      sürümü (eski kapak; yeni üyede indirilen Vs). Panelde olmayan eski kapak menüden çıkar;
 *      `assets/` dizini SİLİNMEZ.
 *   7. imKeys: runner bu adımdan SONRA imKeys'i koşar (son üye listesi + covers[0] orada bulunur).
 *      Burada yalnız ilk kapak değiştiyse eski ilk kapağın dolu imKeys'i yeni ilk kapağa kopyalanır
 *      (anahtarsız yeni üyeye kopya YOK).
 *   8. KAPI (aday kopya üstünde, rename'den ÖNCE): her panel (GroupId,TabId,Id) okuyucu h()'siyle
 *      bulunur ve sürüm > 0; her kapağın xmlSource'u `assets/<FixName>/…` ve zip'te; menü dışı
 *      kapak yok; `<main>` aynı; eski kapakların key/activation'ı aynı; eski ilk kapak imKeys'liyse
 *      yeni ilk kapak da; kök koruma (izin listesi: yalnız `assets/<FixName>/**` ve
 *      `classlibraries/ImWin32.dll`; silme yok). Kapı düşerse iş görünür hatayla düşer, iş kopyası
 *      DEĞİŞMEMİŞ olur (eksik içerikle paket üretilmez).
 *
 * YAPILMAYANLAR: panele/SQL'e yazmak (yalnız GET) · eski üyenin içeriğini tazelemek (merdiven
 * işi) · bookN setleri · `assets/` silmek.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const M = require('./icerik-merdiven');
const ig = require('../runtime/icerik-guncelleme');
const imk = require('./imkeys');
const setEk = require('./set-uyelik-ek');
const { BASE_ENDPOINT_HOST_RE } = require('../packaging/yayinci-domain-yamasi');

const ISARET = '[panel-menu]';
const HATA = 'PANEL MENÜ HİZALAMA';
const MENU = ig.MENU_GORELI; // 'classlibraries/ImWin32.dll'
const PANEL_YOLU = '/MobilService/GetPackageBooks?id={BOOK_ID}';
const PANEL_ZAMAN_ASIMI_MS = 20000;
const PANEL_DENEME = 3;
const RESIM_ONEK = '/Uploads/Resim/';
const RESIM_TAVAN = 20 * 1024 * 1024;
const RESIM_BUTCE_MS = 120000;
const RESIM_TEK_MS = 30000;
const ICERIK = 'data/BookContent.xml';
const DURUM = Object.freeze({
  TAMAM: 'TAMAM', BOS: 'BOS', OLCULEMEDI: 'OLCULEMEDI', BOZUK: 'BOZUK', UC_YOK: 'UC_YOK',
});
const PANEL_GOVDE_TAVAN = 5 * 1024 * 1024;
/** Tutarlılık: eski kapakların en çok bu oranı menüden çıkarılabilir (fazlası = yanlış set). */
const CIKARMA_TAVAN_ORANI = 0.5;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** `gecici=true` → runner kirayı bırakır (r2Ertele), failed yazılmaz. */
class PanelMenuHatasi extends Error {
  constructor(mesaj, { gecici = false } = {}) {
    super(mesaj);
    this.name = 'PanelMenuHatasi';
    this.gecici = Boolean(gecici);
  }
}

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const sayisalKimlik = (v) => /^[1-9]\d*$/.test(String(v == null ? '' : v));
/** Tek, güvenli yol bileşeni (FixName / görsel adı). */
const guvenliBilesen = (s) => {
  const t = String(s == null ? '' : s);
  return Boolean(t) && t !== '.' && t !== '..' && !/[/\\\0]/.test(t) && t.length <= 200;
};
/**
 * Panel tabanı olamayan alanlar: CF'li sorucoz.tv, localhost, IP literal (özel ağlar 10/8,
 * 172.16/12, 192.168/16, 169.254/16, 0.0.0.0, ::1 dahil — panel alan adıyla yayınlanır).
 */
const tabanOlamaz = (host) => {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  return !h || /(^|\.)sorucoz\.tv$/.test(h) || h === 'localhost' || h.endsWith('.localhost')
    || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || !/^[a-z0-9.-]+$/.test(h)
    || !h.includes('.');
};

/** URL → güvenli taban alan adı (kullanıcı/parola ya da port taşıyan URL reddedilir); yoksa null. */
function tabanHostu(adres) {
  let u;
  try { u = new URL(String(adres)); } catch (_) { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port) return null;
  return tabanOlamaz(u.hostname) ? null : { sema: u.protocol.slice(0, -1), host: u.hostname };
}

function attrOku(etiket, ad) {
  const m = new RegExp(`\\s${ad}="([^"]*)"`).exec(String(etiket || ''));
  return m ? m[1] : null;
}

/** Etikette alan yaz (yoksa ekle) — icerik-guncelleme `attrYaz` ile aynı kural. */
function attrYaz(etiket, ad, deger) {
  const re = new RegExp(`(\\s${ad}=")[^"]*(")`);
  if (re.test(etiket)) return etiket.replace(re, (_, a, b) => `${a}${deger}${b}`);
  return etiket.replace(/\s*\/?>$/, (son) => ` ${ad}="${deger}"${son}`);
}

function xmlKacis(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Saf kararlar ───────────────────────────────────────────────────────────────────────────

/**
 * Panel URL adayları — paketten türetilir. SAF.
 * `EMPP_PANEL_PAKET_URL` (şablon, `{BOOK_ID}`) verilmişse YALNIZ o. Yoksa: kök app.config.js
 * `baseEndpointUrl` (yayinci-domain-yamasi `BASE_ENDPOINT_HOST_RE`) > menü kapak `URL`
 * alanlarındaki https alanı (en sık önce). sorucoz.tv / localhost aday değil.
 * @param {{setId:string, appConfig?:string|null, menuXml?:string|null, env?:object}} o
 * @returns {Array<{url:string, kaynak:string}>}
 */
function panelAdaylari({ setId, appConfig = null, menuXml = null, env = process.env }) {
  const id = encodeURIComponent(String(setId));
  const ust = String((env && env.EMPP_PANEL_PAKET_URL) || '').trim();
  if (ust) return [{ url: ust.replace('{BOOK_ID}', id), kaynak: 'EMPP_PANEL_PAKET_URL' }];
  const adaylar = [];
  const ekle = (t, kaynak) => {
    if (!t || adaylar.some((a) => a.host === t.host)) return;
    adaylar.push({
      host: t.host, url: `${t.sema}://${t.host}${PANEL_YOLU.replace('{BOOK_ID}', id)}`, kaynak,
    });
  };
  // baseEndpointUrl (yayinci-domain-yamasi BASE_ENDPOINT_HOST_RE ile bulunur, new URL ile ayrışır).
  if (BASE_ENDPOINT_HOST_RE.test(String(appConfig || ''))) {
    const m = /baseEndpointUrl\s*:\s*["'](https?:\/\/[^"'\s]+)/i.exec(String(appConfig));
    if (m) ekle(tabanHostu(m[1]), 'app.config.js baseEndpointUrl');
  }
  const say = new Map();
  for (const u of String(menuXml || '').matchAll(/<cover\b[^>]*\sURL="(https:\/\/[^"]+)"/g)) {
    const t = tabanHostu(u[1].replace(/&amp;/g, '&'));
    if (!t || t.sema !== 'https') continue;
    const k = say.get(t.host) || { t, n: 0 };
    k.n += 1;
    say.set(t.host, k);
  }
  [...say.values()].sort((a, b) => b.n - a.n).forEach((k) => ekle(k.t, 'menü kapak URL alanı'));
  return adaylar.map(({ url, kaynak }) => ({ url, kaynak }));
}

/**
 * Panel cevabı → sınıf + normalleştirilmiş üye listesi. SAF, FIRLATMAZ.
 *   OLCULEMEDI: ağ hatası / HTTP ≠ 200 / JSON değil (Cloudflare sayfası dahil).
 *   BOS       : JSON geldi, `Books` boş ya da null (okuyucu da menüye dokunmaz) — meşru.
 *   BOZUK     : satırlardan biri kurallara uymuyor (okuyucu bozuk menü kurardı; dokunulmaz).
 *   TAMAM     : `books` dolu.
 * @param {{hata?:string, status?:number, govde?:string}} cevap
 * @returns {{durum:string, neden?:string, kitapAdi?:string|null, books?:Array<object>}}
 */
function panelCevabiYorumla(cevap) {
  const sonuc = (durum, neden) => ({ durum, neden });
  // Geçici (yeniden denenir, sonunda ertelenir): ağ hatası / zaman aşımı / 5xx / 429.
  if (!cevap || cevap.hata) {
    return sonuc(DURUM.OLCULEMEDI, cevap && cevap.hata ? cevap.hata : 'cevap yok');
  }
  // Kalıcı (bu adreste uç yok; sonsuz erteleme üretmez): yönlendirme reddi, 4xx, JSON-dışı 200.
  if (cevap.ucYok) return sonuc(DURUM.UC_YOK, cevap.ucYok);
  if (cevap.status >= 500 || cevap.status === 429) {
    return sonuc(DURUM.OLCULEMEDI, `HTTP ${cevap.status}`);
  }
  if (cevap.status !== 200) return sonuc(DURUM.UC_YOK, `HTTP ${cevap.status}`);
  let j;
  try {
    j = JSON.parse(cevap.govde);
  } catch (_) { return sonuc(DURUM.UC_YOK, 'cevap JSON değil'); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) {
    return sonuc(DURUM.UC_YOK, 'cevap nesne değil');
  }
  if (!Array.isArray(j.Books) || j.Books.length < 1) {
    const mesaj = j.statusMessage ? ` (${String(j.statusMessage).slice(0, 80)})` : '';
    return sonuc(DURUM.BOS, `Books boş${mesaj}`);
  }
  const books = [];
  const fixSahibi = new Map();
  for (let i = 0; i < j.Books.length; i++) {
    const b = j.Books[i];
    const yer = `Books[${i}]`;
    if (!b || typeof b !== 'object') return sonuc(DURUM.BOZUK, `${yer} nesne değil`);
    if (!sayisalKimlik(b.Id)) return sonuc(DURUM.BOZUK, `${yer} Id geçersiz (${b.Id})`);
    if (!sayisalKimlik(b.GroupId) || !sayisalKimlik(b.TabId)) {
      return sonuc(DURUM.BOZUK, `${yer} (${b.Id}) GroupId/TabId geçersiz`);
    }
    const fixName = b.FixName == null || b.FixName === '' ? String(b.Id) : String(b.FixName);
    if (!guvenliBilesen(fixName)) {
      return sonuc(DURUM.BOZUK, `${yer} (${b.Id}) FixName güvensiz: ${JSON.stringify(fixName)}`);
    }
    // Aynı içerik dizini iki ayrı kitaba verilemez (biri ötekinin içeriğini gösterirdi).
    if (fixSahibi.has(fixName) && fixSahibi.get(fixName) !== String(b.Id)) {
      return sonuc(DURUM.BOZUK, `${yer} FixName ${fixName} hem ${fixSahibi.get(fixName)} hem ${b.Id}`);
    }
    fixSahibi.set(fixName, String(b.Id));
    books.push({
      id: String(b.Id), fixName, groupId: String(b.GroupId), groupName: String(b.GroupName || ''),
      tabId: String(b.TabId), tabName: String(b.TabName || ''), adi: String(b.Adi || ''),
      dersId: b.DersId == null ? null : String(b.DersId),
      resim: b.Resim == null ? null : String(b.Resim),
      domain: b.Domain == null ? null : String(b.Domain),
    });
  }
  return {
    durum: DURUM.TAMAM, kitapAdi: j.KitapAdi == null ? null : String(j.KitapAdi), books,
  };
}

/**
 * Menü XML'ini parçalar; `<main>` gövdesinde yalnız Group > Tab > cover olmalı. SAF.
 * @returns {{bas:string, main:string, son:string, gruplar:Array<{etiket:string,
 *   sekmeler:Array<{etiket:string, kapaklar:Array<{tam:string, etiket:string, id:string}>}>}>}}
 */
function menuParcala(xml) {
  const s = String(xml || '');
  const mm = /<main\b[^>]*>/.exec(s);
  const kapanis = s.lastIndexOf('</main>');
  if (!mm || kapanis < mm.index) throw new Error(`${HATA}: menüde <main> yok`);
  const govdeBas = mm.index + mm[0].length;
  const govde = s.slice(govdeBas, kapanis);
  const artik = (metin, re) => metin.replace(re, '').trim();
  const grupRe = /<Group\b[^>]*>[\s\S]*?<\/Group>/g;
  if (artik(govde, grupRe)) throw new Error(`${HATA}: <main> içinde Group dışı öğe var`);
  const gruplar = (govde.match(grupRe) || []).map((g) => {
    const etiket = /^<Group\b[^>]*>/.exec(g)[0];
    const ic = g.slice(etiket.length, -'</Group>'.length);
    const sekmeRe = /<Tab\b[^>]*>[\s\S]*?<\/Tab>/g;
    if (artik(ic, sekmeRe)) throw new Error(`${HATA}: <Group> içinde Tab dışı öğe var`);
    const sekmeler = (ic.match(sekmeRe) || []).map((t) => {
      const tEtiket = /^<Tab\b[^>]*>/.exec(t)[0];
      const tIc = t.slice(tEtiket.length, -'</Tab>'.length);
      const kapakRe = /<cover\b[^>]*?(?:\/>|>[\s\S]*?<\/cover>)/g;
      if (artik(tIc, kapakRe)) throw new Error(`${HATA}: <Tab> içinde cover dışı öğe var`);
      const kapaklar = (tIc.match(kapakRe) || []).map((c) => {
        const cEtiket = /^<cover\b[^>]*>/.exec(c)[0];
        return { tam: c, etiket: cEtiket, id: attrOku(cEtiket, 'ID') };
      });
      return { etiket: tEtiket, kapaklar };
    });
    return { etiket, sekmeler };
  });
  return { bas: s.slice(0, mm.index), main: mm[0], son: s.slice(kapanis), gruplar };
}

/** Menüdeki kapaklar belge sırasıyla (okuyucunun `covers[]` sırası). SAF. */
function kapakSirasi(xml) {
  return menuParcala(xml).gruplar.flatMap((g) => g.sekmeler.flatMap((t) => t.kapaklar));
}

/**
 * Okuyucunun `h(e, n, r)`'si: Group ID → Tab ID → cover ID (parseInt eşitliği); kapağın
 * `version`'ı (yoksa undefined). SAF.
 */
function hSimule(xml, grup, sekme, id) {
  const p = (v) => parseInt(v, 10);
  const g = menuParcala(xml).gruplar.find((x) => p(attrOku(x.etiket, 'ID')) === p(grup));
  const t = g && g.sekmeler.find((x) => p(attrOku(x.etiket, 'ID')) === p(sekme));
  const c = t && t.kapaklar.find((x) => p(x.id) === p(id));
  if (!c) return undefined;
  const v = attrOku(c.etiket, 'version');
  return v == null ? undefined : v;
}

/**
 * Okuyucunun panel kapağına verdiği sürüm: içerik diskteyse `h()?.version ?? 1`, değilse 0.
 * 0 = mavi bulut (indir), eski menüde bulunamayan = 1 (yeşil bulut, güncelleme teklifi). SAF.
 */
function okuyucuSurumu(xml, book, varMi) {
  if (!varMi(`assets/${book.fixName}/${ICERIK}`)) return 0;
  const v = hSimule(xml, book.groupId, book.tabId, book.id);
  return v == null ? 1 : Number(v);
}

/**
 * Eksik üyeler: içeriği zip'te yok YA DA eski menüde kapağı yok (sürümü bilinemez → indirilir).
 * FixName başına tekil. SAF.
 */
function eksikUyeler(xml, books, varMi) {
  const eski = new Set(kapakSirasi(xml).map((c) => c.id));
  const gorulen = new Set();
  const out = [];
  for (const b of books) {
    if (gorulen.has(b.fixName)) continue;
    gorulen.add(b.fixName);
    const icerik = varMi(`assets/${b.fixName}/${ICERIK}`);
    if (!icerik || !eski.has(b.id)) {
      out.push({ book: b, sebep: !icerik ? 'içerik pakette yok' : 'eski menüde kapağı yok' });
    }
  }
  return out;
}

/** Yeni üyenin kapak etiketi: kalıp kapaktan, kimlik/yol alanları üyeye göre. SAF. */
function yeniKapakEtiketi(kalip, b, y) {
  const a = `assets/${b.fixName}`;
  let e = kalip;
  const alanlar = {
    guId: '', ID: b.id, etkID: b.id, etkAdi: b.fixName, ustBar: `${a}/skins/ustBar.swf`,
    arkaPlan: `${a}/skins/arkaplan.swf`, source: y.source || `${a}/thumbs/1.jpg`,
    actName: xmlKacis(b.adi), URL: xmlKacis(y.url), imageURL: `${a}/thumbs/1.jpg`,
    version: String(y.vs), xmlSource: `${a}/${ICERIK}`, tabID: b.tabId,
  };
  if (b.dersId != null && /^\d+$/.test(b.dersId)) alanlar.lessonID = b.dersId;
  for (const [k, v] of Object.entries(alanlar)) e = attrYaz(e, k, v);
  // Başka kitabın kapak anahtarı yeni üyeye taşınmaz.
  if (attrOku(e, 'key') != null) e = attrYaz(e, 'key', '');
  return e;
}

/**
 * Hizalanmış menü. `<main>` ve gövde dışı metin bayt-aynı; gövde panel sırasıyla yeniden kurulur
 * (okuyucu `p()`: gruplar ilk görülme sırası, grup içinde sekmeler ilk görülme sırası, sekmede
 * kapaklar liste sırası). SAF.
 * @param {string} xml eski (çözülmüş) menü
 * @param {Array<object>} books `panelCevabiYorumla().books`
 * @param {Map<string,{vs:number, url:string, source?:string}>} yeniler indirilen üyeler (Id →)
 * @returns {{xml:string, tasinan:string[], yenilenen:string[], eklenen:string[],
 *   cikarilan:string[]}} tasinan = eski kapak aynen; yenilenen = eski kapak, içerik yeniden indi
 */
function menuHizala(xml, books, yeniler = new Map()) {
  const p = menuParcala(xml);
  const eski = new Map();
  for (const c of p.gruplar.flatMap((g) => g.sekmeler.flatMap((t) => t.kapaklar))) {
    if (!eski.has(c.id)) eski.set(c.id, c);
  }
  const ilkGrup = p.gruplar[0];
  const ilkSekme = ilkGrup && ilkGrup.sekmeler[0];
  const kalipKapak = ilkSekme && ilkSekme.kapaklar[0];
  const grupKalip = ilkGrup ? ilkGrup.etiket : '<Group ID="" label="">';
  const sekmeKalip = ilkSekme ? ilkSekme.etiket : '<Tab ID="" label="">';
  const tasinan = [];
  const yenilenen = [];
  const eklenen = [];

  const kapakKur = (b) => {
    const y = yeniler.get(b.id);
    const o = eski.get(b.id);
    if (y) {
      if (o) {
        let e = o.etiket;
        e = attrYaz(e, 'version', String(y.vs));
        e = attrYaz(e, 'URL', xmlKacis(y.url));
        e = attrYaz(e, 'tabID', b.tabId);
        e = attrYaz(e, 'actName', xmlKacis(b.adi));
        e = attrYaz(e, 'xmlSource', `assets/${b.fixName}/${ICERIK}`);
        yenilenen.push(b.id);
        return o.tam.replace(o.etiket, () => e);
      }
      if (!kalipKapak) throw new Error(`${HATA}: eski menüde kalıp kapak yok (${b.id} kurulamaz)`);
      eklenen.push(b.id);
      const e = yeniKapakEtiketi(kalipKapak.etiket, b, y);
      return kalipKapak.tam.replace(kalipKapak.etiket, () => e)
        .replace(/>[\s\S]*<\/cover>$/, '></cover>');
    }
    if (!o) throw new Error(`${HATA}: ${b.id} ne eski menüde ne indirilenlerde (plan hatası)`);
    let e = attrYaz(o.etiket, 'tabID', b.tabId);
    e = attrYaz(e, 'actName', xmlKacis(b.adi));
    // İçerik `assets/<FixName>/` altında (eksikUyeler denetledi); okuyucu da orayı okur.
    e = attrYaz(e, 'xmlSource', `assets/${b.fixName}/${ICERIK}`);
    tasinan.push(b.id);
    return o.tam.replace(o.etiket, () => e);
  };

  const grupSirasi = [...new Set(books.map((b) => b.groupId))];
  const govde = grupSirasi.map((gid) => {
    const gb = books.filter((b) => b.groupId === gid);
    const gEtiket = attrYaz(attrYaz(grupKalip, 'ID', gid), 'label', xmlKacis(gb[0].groupName));
    const sekmeSirasi = [...new Set(gb.map((b) => b.tabId))];
    const sekmeler = sekmeSirasi.map((tid) => {
      const tb = gb.filter((b) => b.tabId === tid);
      const tEtiket = attrYaz(attrYaz(sekmeKalip, 'ID', tid), 'label', xmlKacis(tb[0].tabName));
      return `${tEtiket}${tb.map(kapakKur).join('')}</Tab>`;
    });
    return `${gEtiket}${sekmeler.join('')}</Group>`;
  }).join('');
  const panelIdler = new Set(books.map((b) => b.id));
  const cikarilan = [...eski.keys()].filter((id) => !panelIdler.has(id));
  return {
    xml: `${p.bas}${p.main}${govde}${p.son}`, tasinan, yenilenen, eklenen, cikarilan,
  };
}

/** Kapağın imKeys yolu (imkeys.js `kapaklariBul` ile aynı kural: xmlSource'tan). SAF. */
function imKeysYolu(kapakEtiketi) {
  const xs = attrOku(kapakEtiketi, 'xmlSource');
  if (!xs || !xs.endsWith(ICERIK)) return null;
  return `${xs.replace(/^\/+/, '').slice(0, -ICERIK.length)}${imk.DOSYA_ADI}`;
}

/**
 * Yazma izni: yalnız `assets/<izinli FixName>/…` ve kök menü; `..`/`.`/mutlak yol asla. SAF.
 * @param {string} ad
 * @param {Set<string>} izinli FixName kümesi
 */
function yazmaIzinli(ad, izinli) {
  const a = String(ad || '');
  if (!a || a.startsWith('/') || a.split('/').some((x) => x === '..' || x === '.')) return false;
  if (a === MENU) return true;
  const m = /^assets\/([^/]+)\/./.exec(a);
  return Boolean(m && izinli.has(m[1]));
}

/** Kök koruma: önce/sonra merkez dizin kıyası. Silme ve izin dışı değişiklik ihlaldir. SAF. */
function kokKorumaIhlalleri(once, sonra, izinli) {
  const ihlal = [];
  for (const [ad, o] of once) {
    const s = sonra.get(ad);
    if (!s) { ihlal.push(`silindi: ${ad}`); continue; }
    if (yazmaIzinli(ad, izinli)) continue;
    if (s.crc !== o.crc || s.boyut !== o.boyut) ihlal.push(`değişti: ${ad}`);
  }
  for (const ad of sonra.keys()) {
    if (!once.has(ad) && !yazmaIzinli(ad, izinli)) ihlal.push(`eklendi: ${ad}`);
  }
  return ihlal;
}

/**
 * HİZALAMA KAPISI. SAF.
 * @param {{xml:string|null, books:Array<object>, varMi:(ad:string)=>boolean,
 *   beklenenMain:string, eskiXml?:string|null, imKeysDolu?:(ad:string)=>boolean,
 *   ilkImKeysGerekli?:boolean}} o
 * @returns {string[]} ihlal satırları
 */
function hizalamaKapisi({
  xml, books, varMi, beklenenMain, eskiXml = null, imKeysDolu, ilkImKeysGerekli,
}) {
  if (!xml) return ['menü çözülemedi'];
  let p;
  try { p = menuParcala(xml); } catch (e) { return [`menü ayrıştırılamadı: ${e.message}`]; }
  const ihlal = [];
  if (p.main !== beklenenMain) ihlal.push('<main> etiketi değişti (activation/key/label/ID)');
  const kapaklar = p.gruplar.flatMap((g) => g.sekmeler.flatMap((t) => t.kapaklar));
  for (const b of books) {
    const v = hSimule(xml, b.groupId, b.tabId, b.id);
    if (v == null) {
      ihlal.push(`${b.id}: h(${b.groupId},${b.tabId},${b.id}) menüde yok`);
      continue;
    }
    if (!(Number(v) > 0)) ihlal.push(`${b.id}: version ${JSON.stringify(v)} > 0 değil`);
    if (!varMi(`assets/${b.fixName}/${ICERIK}`)) {
      ihlal.push(`${b.id}: assets/${b.fixName}/${ICERIK} yok`);
    } else if (okuyucuSurumu(xml, b, varMi) !== Number(v)) {
      ihlal.push(`${b.id}: okuyucu sürümü menü sürümüyle tutmuyor`);
    }
  }
  const panelIdler = new Set(books.map((b) => b.id));
  for (const c of kapaklar) {
    if (!panelIdler.has(c.id)) ihlal.push(`menüde panel dışı kapak: ${c.id}`);
    const xs = attrOku(c.etiket, 'xmlSource');
    if (!xs || !varMi(xs.replace(/^\/+/, ''))) ihlal.push(`${c.id}: xmlSource (${xs}) zip'te yok`);
    const b = books.find((x) => x.id === c.id);
    if (b && xs !== `assets/${b.fixName}/${ICERIK}`) {
      ihlal.push(`${c.id}: xmlSource ${xs} ≠ assets/${b.fixName}/${ICERIK}`);
    }
  }
  // Eski menüden taşınan kapakların anahtar alanları (key/activation) aynen kalmalı.
  if (eskiXml) {
    let eskiler = [];
    try { eskiler = kapakSirasi(eskiXml); } catch (_) { eskiler = []; }
    for (const c of kapaklar) {
      const o = eskiler.find((x) => x.id === c.id);
      if (!o) continue;
      for (const a of ['key', 'activation']) {
        if (attrOku(c.etiket, a) !== attrOku(o.etiket, a)) {
          ihlal.push(`${c.id}: ${a} eski menüyle aynı değil`);
        }
      }
    }
  }
  if (kapaklar.length !== books.length) {
    ihlal.push(`kapak sayısı ${kapaklar.length} ≠ panel ${books.length}`);
  }
  if (ilkImKeysGerekli) {
    const yol = kapaklar[0] ? imKeysYolu(kapaklar[0].etiket) : null;
    if (!yol || !imKeysDolu || !imKeysDolu(yol)) {
      ihlal.push(`ilk kapak imKeys.dll yok/boş (${yol || '-'}) — çevrimdışı 123456 açığı`);
    }
  }
  return ihlal;
}

/**
 * Yazma kapısının okuduğu set listesi (`setListesiAyristir` biçimi: `id | ad`, satır başına bir),
 * panel sırasıyla, kimlik başına tekil. Adda `|` ve satır sonu boşluğa çevrilir. SAF.
 */
function panelSetListesi(books) {
  const gorulen = new Set();
  const satirlar = [];
  for (const b of books) {
    if (gorulen.has(b.id)) continue;
    gorulen.add(b.id);
    satirlar.push(`${b.id} | ${String(b.adi || '').replace(/[|\r\n]+/g, ' ').trim()}`);
  }
  return satirlar.join('\n');
}

/**
 * Claim set listesi ↔ panel farkı (yalnız İmpark kimlikli kitap satırları). SAF.
 * @returns {{claimVar:boolean, listeFazla:string[], panelYeni:string[]}}
 */
function setListesiFarki(claimHam, books) {
  const panelIdler = [...new Set(books.map((b) => b.id))];
  const claim = claimHam == null || !String(claimHam).trim() ? null
    : setEk.setListesiAyristir(claimHam).filter((g) => !g.link && sayisalKimlik(g.assetId))
      .map((g) => String(g.assetId));
  if (!claim) return { claimVar: false, listeFazla: [], panelYeni: panelIdler };
  const c = new Set(claim);
  const p = new Set(panelIdler);
  return {
    claimVar: true, listeFazla: [...c].filter((id) => !p.has(id)),
    panelYeni: panelIdler.filter((id) => !c.has(id)),
  };
}

/**
 * Tek motorlu sette kimliğin içeriği kökte duruyor mu (`assets/<id>/data/BookContent.xml`)?
 * Panel hizalaması panelde olmayan üyeyi menüden çıkarır ama içeriğini silmez; taban kapsama bu
 * üyeyi "eksik" sayıp üreteci boşuna koşturmasın diye runner bunu sorar.
 */
function kokIcerikVarMi(zipYolu, id) {
  try {
    const g = M.zipDizini(zipYolu).get(`assets/${id}/${ICERIK}`);
    return Boolean(g && !g.dizin);
  } catch (_) { return false; }
}

/** Panel `Resim` → güvenli dosya adı (okuyucu: `Resim.replace("/Uploads/Resim/","")`). SAF. */
function resimAdi(resim) {
  const r = String(resim || '');
  if (!r.startsWith(RESIM_ONEK)) return null;
  const ad = r.slice(RESIM_ONEK.length);
  return guvenliBilesen(ad) && /\.(png|jpe?g|webp|gif)$/i.test(ad) ? ad : null;
}

// ─── IO ─────────────────────────────────────────────────────────────────────────────────────

/** Panel listesi GET (salt okuma). Hata FIRLATMAZ: `{hata}` döner. */
async function varsayilanPanelGetir(url, { zamanAsimiMs = PANEL_ZAMAN_ASIMI_MS } = {}) {
  const sinyal = AbortSignal.timeout(zamanAsimiMs);
  let adres = url;
  try {
    const host = new URL(url).host;
    for (let i = 0; i <= 2; i++) {
      const r = await fetch(adres, {
        headers: { 'User-Agent': UA, Accept: 'application/json' }, redirect: 'manual', signal: sinyal,
      });
      if (r.status >= 300 && r.status < 400) {
        const yeni = new URL(r.headers.get('location') || '', adres);
        if (yeni.host !== host || yeni.protocol !== 'https:') {
          return { ucYok: `başka alana yönlendirme (${yeni.protocol}//${yeni.host})` };
        }
        adres = yeni.href;
        continue;
      }
      const uzunluk = Number(r.headers.get('content-length'));
      if (Number.isFinite(uzunluk) && uzunluk > PANEL_GOVDE_TAVAN) {
        return { ucYok: `gövde ${uzunluk} bayt > tavan` };
      }
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length > PANEL_GOVDE_TAVAN) return { ucYok: `gövde ${b.length} bayt > tavan` };
      return { status: r.status, govde: b.toString('utf8') };
    }
    return { ucYok: 'yönlendirme döngüsü' };
  } catch (e) {
    const zaman = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { hata: zaman ? `zaman aşımı (${Math.round(zamanAsimiMs / 1000)} sn)` : 'bağlantı kurulamadı' };
  }
}

const varsayilanBekle = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Tek aday için panel sorusu: ÖLÇÜLEMEDİ'de en çok `deneme` kez (artan bekleme). Meşru
 * boş / bozuk / tamam cevap yeniden sorulmaz.
 */
async function panelSor(url, { getir, deneme = PANEL_DENEME, bekle = varsayilanBekle,
  bekleMs = 2000 } = {}) {
  let y = null;
  for (let i = 1; i <= deneme; i++) {
    y = panelCevabiYorumla(await getir(url, { zamanAsimiMs: PANEL_ZAMAN_ASIMI_MS }));
    y.deneme = i;
    if (y.durum !== DURUM.OLCULEMEDI) return y;
    if (i < deneme) await bekle(bekleMs * i);
  }
  return y;
}

/**
 * Kapak görseli indirmesi: anahtarsız GET; Content-Length ön denetimi; yönlendirme yalnız AYNI
 * alana (en çok 2); yalnız resim baytı (PNG/JPEG/WEBP/GIF); tavanlı.
 */
async function varsayilanResimIndir(url, hedef, { zamanAsimiMs = RESIM_TEK_MS } = {}) {
  const sinyal = AbortSignal.timeout(Math.max(1000, zamanAsimiMs));
  const host = new URL(url).host;
  let adres = url;
  let r = null;
  for (let i = 0; i <= 2; i++) {
    r = await fetch(adres, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: sinyal });
    if (r.status < 300 || r.status >= 400) break;
    const yeni = new URL(r.headers.get('location') || '', adres);
    if (yeni.host !== host || yeni.protocol !== 'https:') {
      throw new Error(`başka alana yönlendirme (${yeni.host})`);
    }
    adres = yeni.href;
  }
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const uzunluk = Number(r.headers.get('content-length'));
  if (Number.isFinite(uzunluk) && uzunluk > RESIM_TAVAN) throw new Error(`boyut ${uzunluk}`);
  const b = Buffer.from(await r.arrayBuffer());
  if (!b.length || b.length > RESIM_TAVAN) throw new Error(`boyut ${b.length}`);
  const imza = b.subarray(0, 12).toString('latin1');
  const resimMi = imza.startsWith('\x89PNG') || imza.startsWith('\xff\xd8\xff')
    || imza.startsWith('GIF8') || (imza.startsWith('RIFF') && imza.slice(8, 12) === 'WEBP');
  if (!resimMi) throw new Error('resim değil');
  await fsp.mkdir(path.dirname(hedef), { recursive: true });
  await fsp.writeFile(hedef, b);
}

/** İndirme hatası ağ kaynaklı mı (geçici)? merdiven `varsayilanIndir` metni + fetch/curl. */
const AG_HATASI = new RegExp('indirilemedi \\(indirme kodu|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|'
  + 'EAI_AGAIN|socket|zaman aşımı', 'i');
const agHatasiMi = (e) => AG_HATASI.test(String((e && e.message) || e));

async function kanitYaz(dosya, veri) {
  try {
    await fsp.mkdir(path.dirname(dosya), { recursive: true });
    await fsp.writeFile(dosya, `${JSON.stringify(veri, null, 2)}\n`);
    return dosya;
  } catch (_) { return null; }
}

/**
 * Runner adımı. Kapsam dışı / taban yok / meşru boş / bozuk panel satırı / beklenmeyen menü
 * yapısı → no-op. Panel ölçülemedi, teklif ölçülemedi, indirme ağ hatası → GEÇİCİ hata
 * (`e.gecici`). İçeriksiz üye ya da kapı RED → kalıcı hata. İş kopyası hata yolunda değişmez.
 * @param {{zip:string, calisma:string, bookId?:string, platform?:string, log?:Function,
 *   warn?:Function, panelGetir?:Function, getir?:Function, indir?:Function,
 *   resimIndir?:Function, onbellek?:string, kanitDizini?:string, zipKomutu?:Function,
 *   env?:object, bekle?:Function, resimButcesiMs?:number, simdi?:Function,
 *   claimListesi?:string|null}} o  claimListesi = claim set listesi (fark ölçümü için)
 * Menü panele hizalı biterse (UYGULANDI ya da zaten hizalı) rapor `hizali=true`,
 * `panelSetListesi` (yazma kapısının okuduğu `id | ad` satırları) ve `setListesiPanelFarki` taşır.
 * @returns {Promise<object>} rapor
 */
async function panelMenuHizala(o) {
  const log = o.log || (() => {});
  const warn = o.warn || log;
  const simdi = o.simdi || Date.now;
  const rapor = {
    bookId: o.bookId == null ? null : String(o.bookId), platform: o.platform || null,
    zaman: new Date().toISOString(), sonuc: null, setId: null, panel: 0, panelUrl: null,
    tasinan: [], yenilenen: [], eklenen: [], cikarilan: [], resim: { indirilen: 0, hata: 0 },
    imKeysKopya: [],
  };
  const kanitla = async () => {
    const damga = rapor.zaman.replace(/[:.]/g, '-');
    rapor.kanit = await kanitYaz(path.join(o.kanitDizini || M.kanitKoku(),
      `${rapor.bookId || 'kitap'}-${rapor.platform || 'x'}-panel-menu-${damga}.json`), rapor);
    return rapor.kanit;
  };
  const bitir = async (sonuc, { kanit = false } = {}) => {
    rapor.sonuc = sonuc;
    if (kanit) await kanitla();
    log(`${ISARET} ${sonuc}${rapor.kanit ? ` (kanıt ${rapor.kanit})` : ''}`);
    return rapor;
  };
  const dokunma = async (neden) => {
    warn(`${ISARET} ${neden} — menü olduğu gibi (dokunulmadı)`);
    return bitir(`dokunulmadı: ${neden}`, { kanit: true });
  };

  const once = M.zipDizini(o.zip);
  const varMi = (ad) => { const g = once.get(ad); return Boolean(g && !g.dizin); };
  if (!varMi(MENU)) return bitir('kök menü yok — dokunulmadı');
  if (M.menuKonumlari(once.keys()).set) return bitir('bookN menülü set — dokunulmadı');
  const ham = M.zipGirdiOku(o.zip, once.get(MENU));
  const xml = ig.menuCoz(ham);
  if (!xml) {
    warn(`${ISARET} kök menü çözülemedi — hizalama yapılmadı`);
    return bitir('menü çözülemedi — dokunulmadı');
  }
  const main = (/<main\b[^>]*>/.exec(xml) || [''])[0];
  const setId = attrOku(main, 'ID');
  rapor.setId = setId;
  if (!sayisalKimlik(setId)) return bitir('main.ID yok — dokunulmadı');
  if (rapor.bookId && rapor.bookId !== setId) {
    log(`${ISARET} not: menü main.ID ${setId} ≠ iş ${rapor.bookId} (okuyucu main.ID'yi sorar)`);
  }

  const appConfig = varMi('app.config.js')
    ? M.zipGirdiOku(o.zip, once.get('app.config.js')).toString('utf8') : '';
  const adaylar = panelAdaylari({ setId, appConfig, menuXml: xml, env: o.env || process.env });
  if (!adaylar.length) {
    warn(`${ISARET} panel tabanı paketten türetilemedi (baseEndpointUrl / kapak URL alanı yok) `
      + `— menü olduğu gibi: ${setId}`);
    return bitir('panel tabanı yok — dokunulmadı');
  }
  let panel = null;
  const olcumler = [];
  for (const a of adaylar) {
    const getir = o.panelGetir || varsayilanPanelGetir;
    const y = await panelSor(a.url, { getir, bekle: o.bekle });
    olcumler.push({
      url: a.url, kaynak: a.kaynak, durum: y.durum, neden: y.neden || null, deneme: y.deneme,
    });
    if (y.durum !== DURUM.OLCULEMEDI && y.durum !== DURUM.UC_YOK) {
      panel = y;
      rapor.panelUrl = a.url;
      break;
    }
  }
  rapor.olcumler = olcumler;
  if (!panel && olcumler.every((x) => x.durum === DURUM.UC_YOK)) {
    const ozet = olcumler.map((x) => `${x.url} → ${x.neden}`).join('; ');
    return dokunma(`panel ucu yok (${ozet})`);
  }
  if (!panel) {
    rapor.sonuc = 'panel ÖLÇÜLEMEDİ — ertelendi';
    await kanitla();
    const ozet = olcumler.map((x) => `${x.url} → ${x.neden}`).join('; ');
    throw new PanelMenuHatasi(`${HATA}: panel listesi ölçülemedi (${ozet}) — iş ertelendi `
      + `(kanıt ${rapor.kanit || '-'})`, { gecici: true });
  }
  if (panel.durum === DURUM.BOS) {
    return bitir(`panel listesi boş (${panel.neden}) — dokunulmadı`);
  }
  if (panel.durum === DURUM.BOZUK) return dokunma(`panel satırı bozuk: ${panel.neden}`);
  const { books } = panel;
  // TUTARLILIK: panel listesi bu setin listesi mi? Ortak kimlik yoksa ya da eski kapakların yarıdan
  // fazlası çıkacaksa yanlış set / yanlış alan şüphesi → dokunulmaz (panel listesi kapıya gitmez).
  {
    let eskiIdler = [];
    try { eskiIdler = [...new Set(kapakSirasi(xml).map((c) => c.id))]; } catch (_) { eskiIdler = []; }
    const panelKume = new Set(books.map((b) => b.id));
    const ortak = eskiIdler.filter((id) => panelKume.has(id));
    if (eskiIdler.length && !ortak.length) {
      return dokunma(`tutarlılık: panel ile menünün ortak kimliği yok (menü ${eskiIdler.length}, `
        + `panel ${books.length})`);
    }
    const cikacak = eskiIdler.length - ortak.length;
    if (eskiIdler.length && cikacak / eskiIdler.length > CIKARMA_TAVAN_ORANI) {
      return dokunma(`tutarlılık: eski ${eskiIdler.length} kapaktan ${cikacak} tanesi çıkacaktı (> %`
        + `${CIKARMA_TAVAN_ORANI * 100})`);
    }
  }
  const fark = setListesiFarki(o.claimListesi, books);
  rapor.setListesiPanelFarki = fark;
  const hizaliIsaretle = () => {
    rapor.hizali = true;
    rapor.listeKaynagi = 'panel';
    rapor.panelSetListesi = panelSetListesi(books);
    log(`${ISARET} kapı set listesi PANELDEN (${books.length} üye); claim `
      + (fark.claimVar ? `fazla [${fark.listeFazla.join(',') || '-'}], panel yeni `
        + `[${fark.panelYeni.join(',') || '-'}]` : 'listesi YOK'));
  };
  rapor.panel = books.length;
  try { menuParcala(xml); } catch (e) { return dokunma(`menü yapısı beklenmedik: ${e.message}`); }

  // İmKeys: eski ilk kapak doluysa ve sıra değişince ilk kapak değişirse yeni ilk kapağa kopya.
  const eskiKapaklar = kapakSirasi(xml);
  const imKeysOku = (yol, dizin, zip) => {
    const g = yol && dizin.get(yol);
    if (!g || g.dizin) return null;
    try {
      const v = M.zipGirdiOku(zip, g);
      return imk.imKeysCoz(v).length ? v : null;
    } catch (_) { return null; }
  };
  const ilkEskiYol = eskiKapaklar[0] ? imKeysYolu(eskiKapaklar[0].etiket) : null;
  const ilkImKeys = imKeysOku(ilkEskiYol, once, o.zip);
  const ilkImKeysGerekli = Boolean(ilkImKeys);

  const sahne = await fsp.mkdtemp(path.join(o.calisma, 'panel-menu-sahne-'));
  const aday = `${o.zip}.panel-menu-aday`;
  try {
    const izinli = new Set();
    const yeniler = new Map();
    const eksik = eksikUyeler(xml, books, varMi);
    if (eksik.length) {
      const sablon = M.ucSablonu(appConfig);
      if (!sablon || !/^https?:\/\//i.test(sablon)) {
        throw new PanelMenuHatasi(`${HATA}: ${eksik.length} eksik üye var ama app.config.js `
          + 'updateBookEndPoint yok — eksik içerikle paket üretilmedi');
      }
      for (const { book: b, sebep } of eksik) {
        const soru = M.teklifUrl(sablon, b.id, 0);
        const cevap = await (o.getir || M.varsayilanGetir)(soru, {});
        const t = M.teklifYorumla({ id: b.id, surum: 0 }, cevap);
        if (t.durum === M.DURUM.GUNCEL) {
          throw new PanelMenuHatasi(`${HATA}: panel üyesi ${b.id} (${sebep}) İmpark'ta içeriksiz `
            + '(Data boş) — eksik içerikle paket üretilmedi');
        }
        if (t.durum !== M.DURUM.GERIDE) {
          throw new PanelMenuHatasi(`${HATA}: panel üyesi ${b.id} (${sebep}) İmpark ölçülemedi: `
            + `${t.not} — iş ertelendi`, { gecici: true });
        }
        let arsiv;
        try {
          arsiv = await M.icerikZipiGetir({
            id: b.id, vs: t.vs, url: t.data, onbellek: o.onbellek || M.icerikOnbellekKoku(),
            indir: o.indir || M.varsayilanIndir,
            log: (x) => log(x.replace('[merdiven] S1', ISARET)),
          });
        } catch (e) {
          throw new PanelMenuHatasi(`${HATA}: panel üyesi ${b.id} indirilemedi: ${e.message}`,
            { gecici: agHatasiMi(e) });
        }
        const gDizin = M.zipDizini(arsiv);
        const hedef = await M.varsayilanIcerikYaz({
          sahne, kok: '', id: b.fixName, guncellemeZip: arsiv,
        });
        M.acmaDogrula(arsiv, gDizin, hedef);
        izinli.add(b.fixName);
        yeniler.set(b.id, { vs: t.vs, url: t.data, fx: b.fixName });
        log(`${ISARET} üye ${b.id} v${t.vs} indirildi (${sebep}; ${gDizin.size} girdi)`);
      }
    }

    // Kapak görseli (en iyi çaba, toplam süre bütçeli): okuyucu source'u assets/<FixName>/'da arar.
    const butceBitis = simdi() + (o.resimButcesiMs == null ? RESIM_BUTCE_MS : o.resimButcesiMs);
    const resimGorulen = new Set();
    let butceAsildi = 0;
    for (const b of books) {
      const ad = resimAdi(b.resim);
      const yol = ad && `assets/${b.fixName}/${ad}`;
      if (!yol || resimGorulen.has(yol) || varMi(yol)) continue;
      resimGorulen.add(yol);
      if (!b.domain || !/^https:\/\/[^/]+$/i.test(b.domain.replace(/\/+$/, ''))) continue;
      const kalan = butceBitis - simdi();
      if (kalan <= 0) { butceAsildi += 1; continue; }
      try {
        await (o.resimIndir || varsayilanResimIndir)(`${b.domain.replace(/\/+$/, '')}${b.resim}`,
          path.join(sahne, 'assets', b.fixName, ad),
          { zamanAsimiMs: Math.min(RESIM_TEK_MS, kalan) });
        izinli.add(b.fixName);
        rapor.resim.indirilen += 1;
      } catch (e) {
        rapor.resim.hata += 1;
        warn(`${ISARET} kapak görseli inmedi ${b.id} (${e.message}) — okuyucu çevrimiçi indirir`);
      }
    }
    if (butceAsildi) {
      rapor.resim.butceAsildi = butceAsildi;
      warn(`${ISARET} kapak görseli süre bütçesi doldu: ${butceAsildi} görsel atlandı`);
    }

    const h = menuHizala(xml, books, yeniler);
    rapor.tasinan = h.tasinan;
    rapor.yenilenen = h.yenilenen;
    rapor.eklenen = h.eklenen;
    rapor.cikarilan = h.cikarilan;

    // imKeys: YALNIZ yeni ilk kapak (set diyaloğu covers[0]'ı okur). Yeni üyelerin anahtarı
    // runner'da bu adımdan sonra koşan imKeys adımının işi (anahtarlı mı sorusu orada sorulur).
    if (ilkImKeys) {
      const yeniIlk = kapakSirasi(h.xml)[0];
      const yol = yeniIlk ? imKeysYolu(yeniIlk.etiket) : null;
      const fx = yol && /^assets\/([^/]+)\//.exec(yol);
      if (yol && fx && yol !== ilkEskiYol && !imKeysOku(yol, once, o.zip)) {
        await fsp.mkdir(path.dirname(path.join(sahne, yol)), { recursive: true });
        await fsp.writeFile(path.join(sahne, yol), ilkImKeys, { mode: 0o600 });
        izinli.add(fx[1]);
        rapor.imKeysKopya.push(yol);
      }
    }

    const kapiOrtak = { books, beklenenMain: main, eskiXml: xml, ilkImKeysGerekli };
    const menuDegisti = h.xml !== xml;
    if (!menuDegisti && !izinli.size) {
      const ihlal = hizalamaKapisi({
        ...kapiOrtak, xml, varMi, imKeysDolu: (y) => Boolean(imKeysOku(y, once, o.zip)),
      });
      if (ihlal.length) {
        rapor.ihlal = ihlal.slice(0, 50);
        await bitir(`KAPI RED (${ihlal.length})`, { kanit: true });
        throw new PanelMenuHatasi(`${HATA} KAPI RED (${ihlal.length}; ilk: ${ihlal[0]})`);
      }
      hizaliIsaretle();
      return await bitir(`zaten hizalı — ${books.length} üye, değişiklik yok`, { kanit: true });
    }
    if (menuDegisti) {
      const yol = path.join(sahne, MENU);
      await fsp.mkdir(path.dirname(yol), { recursive: true });
      const rnd = setEk.tohumluRastgele(`${setId}:${md5(h.xml)}`);
      await fsp.writeFile(yol, ig.menuKodla(h.xml, rnd, ig.menuBicimi(ham) || undefined));
    }

    // KÖK KORUMA 1: sahnedeki her dosya izin listesinde (zip'e girmeden).
    const sahneDosyalari = await M.dosyalariTopla(sahne);
    // Sembolik bağ zip'e girmez (izinli yol dışını gösterebilir); açılan arşivde bağ = görünür hata.
    for (const d of sahneDosyalari) {
      if ((await fsp.lstat(path.join(sahne, d))).isSymbolicLink()) {
        throw new PanelMenuHatasi(`${HATA} KÖK KORUMA: sembolik bağ reddedildi: ${d}`);
      }
    }
    const izinsiz = sahneDosyalari.filter((d) => !yazmaIzinli(d, izinli));
    if (izinsiz.length) {
      throw new PanelMenuHatasi(`${HATA} KÖK KORUMA: izin dışı ${izinsiz.length} dosya `
        + `(ilk: ${izinsiz[0]})`);
    }

    // YAZIM: aday = klon → zip adaya yazar → kapı adayı ölçer → GEÇTİ ise tek rename.
    await fsp.rm(aday, { force: true });
    await fsp.copyFile(o.zip, aday, fs.constants.COPYFILE_FICLONE);
    const ust = [...new Set(sahneDosyalari.map((d) => d.split('/')[0]))];
    const z = await (o.zipKomutu || M.komut)('zip', ['-q', '-r', '-D', '-X', '-y', '-n',
      M.SIKISIK_UZANTILAR, path.resolve(aday), ...ust], { cwd: sahne });
    if (z.code !== 0) {
      const ek = String(z.stderr).slice(-200);
      throw new PanelMenuHatasi(`${HATA}: zip yazılamadı (${z.code}): ${ek}`);
    }
    const sonra = M.zipDizini(aday);
    const sonraVar = (ad) => { const g = sonra.get(ad); return Boolean(g && !g.dizin); };
    let yeniXml = null;
    try {
      yeniXml = ig.menuCoz(M.zipGirdiOku(aday, sonra.get(MENU)));
    } catch (_) { yeniXml = null; }
    const ihlal = kokKorumaIhlalleri(once, sonra, izinli).concat(hizalamaKapisi({
      ...kapiOrtak, xml: yeniXml, varMi: sonraVar,
      imKeysDolu: (y) => Boolean(imKeysOku(y, sonra, aday)),
    }));
    if (yeniXml !== h.xml) ihlal.push("zip'teki menü yazılanla aynı değil");
    if (ihlal.length) {
      rapor.ihlal = ihlal.slice(0, 50);
      await bitir(`KAPI RED (${ihlal.length})`, { kanit: true });
      throw new PanelMenuHatasi(`${HATA} KAPI RED (${ihlal.length}; ilk: ${ihlal[0]}) — iş kopyası `
        + `DEĞİŞMEDİ, eksik içerikle paket üretilmedi (kanıt ${rapor.kanit || '-'})`);
    }
    await fsp.rename(aday, o.zip);
    hizaliIsaretle();
    return await bitir(`UYGULANDI — ${setId}: ${books.length} panel üyesi; taşınan `
      + `${h.tasinan.length}, eklenen ${h.eklenen.length} [${h.eklenen.join(',') || '-'}], `
      + `yenilenen ${h.yenilenen.length}, çıkarılan ${h.cikarilan.length} `
      + `[${h.cikarilan.join(',') || '-'}], görsel ${rapor.resim.indirilen}, `
      + `imKeys kopya ${rapor.imKeysKopya.length}`, { kanit: true });
  } finally {
    await fsp.rm(aday, { force: true }).catch(() => {});
    await fsp.rm(sahne, { recursive: true, force: true }).catch(() => {});
  }
}

/** Runner için varsayılan bağımlılıklar (test-yalitim burayı sahteler — internete çıkılmaz). */
function varsayilanBagimliliklar() {
  return { panelGetir: varsayilanPanelGetir };
}

module.exports = {
  ISARET, HATA, DURUM, PanelMenuHatasi, panelAdaylari, panelCevabiYorumla, panelSor, menuParcala,
  kapakSirasi, hSimule, okuyucuSurumu, eksikUyeler, menuHizala, imKeysYolu, yazmaIzinli,
  kokKorumaIhlalleri, hizalamaKapisi, resimAdi, panelMenuHizala, varsayilanBagimliliklar,
  varsayilanPanelGetir, varsayilanResimIndir, panelSetListesi, setListesiFarki, kokIcerikVarMi,
  tabanHostu, CIKARMA_TAVAN_ORANI,
};
