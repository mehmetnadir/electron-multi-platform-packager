#!/usr/bin/env node
'use strict';
/**
 * KABUL KAPISI CANLI YARISI — E6 (kitap gerçekten açılıyor mu) + E7 (motor güncelleme soruyor mu).
 *
 * Kaynak: ~/.empp-agent/arastirma/e2e-kanit-pardus-kabul-20260926.md §B E6/E7; sağlık sözleşmesi
 * T3 K3/K4. Nadir 26.09: "kabul kapısı yalnız açılıyor mu diye bakmamalı".
 *
 * probook-kabul.sh uygulamayı `--remote-debugging-port=<boş port>` ile başlatır, pencere + menü
 * piksel ölçümü geçince bu betiği çağırır. Uzak kipte (Mac → ProBook) ssh -L tüneliyle, yerel
 * kipte (ProBook şeridi) doğrudan 127.0.0.1'e bağlanır. xdotool tıklaması KULLANILMAZ
 * (koordinat yayıncı tasarımına bağlı; yabancı pencere tuzağı 45487).
 *
 * E6 akışı (kart/kitap tanıma TEK KAYNAK: tools/kabul/kosum/dom-yoklama.js):
 *   • SET menüsü (kart var)  → ilk kitap kartına DOM tıklaması (main.js'in yedek yöntemi), URL
 *     `bookN/` altına geçmezse CDP fare olayı; 60 sn içinde okuyucu sayfa izi + yükleniyor yok.
 *   • Tek kitap, kök okuyucu → kitap zaten açık; güncelleme sorusu açılışta sorulduğu için
 *     (acilis-ilk-sayfa.js: `covers.map(c => sorgula(c))`) ve biz sonradan bağlandığımız için
 *     sayfa BİR KEZ yeniden yüklenir, okuyucu yeniden ölçülür.
 *   • Tek kitap, motor kitap rafı → ilk kapağa tıklanır (MEÇ 73714 / BES 74451 dersi).
 *   • Hiçbiri tanınmadı → ÖLÇÜLEMEDİ (tanımadığımız menü RED sayılmaz, GEÇTİ de sayılmaz).
 *   • Konsolda `assets not found` / `ImWin32.dll … okunamadı` (olcutler.RED_IMZALARI) → RED.
 * E7: Network.responseReceived + getResponseBody ile motorun `GetKitapGuncellemeBilgi` cevabı.
 *   `Data` dolu → DOLU (kapı RED-GÜNCEL-DEĞİL verir); boş → BOS; istek yok → YOK (karar E4'te,
 *   statik; E7 yalnız ek kanıt); gövde okunamadı / Success=false → ÖLÇÜLEMEDİ (karar değiştirmez).
 *
 * Çıktı: stdout'ta `ANAHTAR=değer` satırları (probook-kabul.sh okur) + <kanit>/cdp-sonuc.json,
 * kitap-cdp.png (Page.captureScreenshot), RED/ÖLÇÜLEMEDİ'de kitap-cdp.dom.html.
 * Çıkış: 0 E6 GEÇTİ · 1 E6 RED · 4 E6 ÖLÇÜLEMEDİ.
 *
 * Kullanım: node cdp-kitap-ac.js --port <n> [--host 127.0.0.1] [--kanit <dizin>]
 *             [--kurulum-koku </home/.../DijiTap>] [--baglan-sn 20] [--menu-sn 30]
 *             [--gezinme-sn 15] [--kitap-sn 60] [--e7-sn 20] [--toplam-sn 200]
 *             [--yeniden-yukle 0|1] [--aralik-ms 1000]
 *             [--hedef-deseni <regex>] [--kaydedici 0|1]
 *
 * K4 eki (başsız kabul, tools/kabul/k4-guncellik.js — ikisi de varsayılan KAPALI, ProBook yolu
 * birebir aynı kalır):
 *   --hedef-deseni  file: dışı sayfa hedefi (Android WebView `https://localhost/...`): URL'si bu
 *                   düzenli ifadeye uyan ilk 'page'.
 *   --kaydedici 1   belge-başı fetch/XHR kaydedicisi (Page.addScriptToEvaluateOnNewDocument + bir kez
 *                   yeniden yükleme). CapacitorHttp fetch'i yerel köprüden geçirir, Network olayı
 *                   DOĞMAZ; kaydedici cevabı sayfa içinde yakalar (sessionStorage, gezinmede
 *                   kaybolmaz). Kayıtlar Network cevaplarıyla aynı yorumlayıcıdan geçer.
 *
 * SET TÜM ALT KİTAPLAR (KABUL_SET_TUM=1 → `--set-tum 1`, varsayılan KAPALI; iki kapı da bu bayrakla
 * çağırır): motor yalnız açılan kitabı sorar (SM2 Set: 58237 hiç sorulmadı). E7'den sonra, oturum
 * açıkken sayfanın Node fs'iyle (paketler nodeIntegration:true) hedef sayfanın dizinindeki her alt
 * kitabın menüsü okunur, motorun sorusu doğrudan sorulur (tools/kabul/set-guncellik.js — içerik
 * merdiveni S0 ile tek kaynak). Çıktı `SET_TUM=GECTI|GUNCEL_DEGIL|OLCULEMEDI|ATLANDI` +
 * `SET_TUM_AYRINTI/ONERI/NOT`; cdp-sonuc.json `setTum`. E6 çıkış kodunu DEĞİŞTİRMEZ.
 */
const fs = require('fs');
const path = require('path');
const {
  jsonGetir, wsBaglan, CdpOturum, hedefSec, wsAdresiniCevir,
} = require('../kabul/cdp-istemci');
const { domYokla } = require('../kabul/kosum/dom-yoklama');
const { sayfaIzi, konsolSiniflandir } = require('../kabul/olcutler');
const setTum = require('../kabul/set-guncellik');

const GUNCELLEME_DESENI = /\/GetKitapGuncellemeBilgi(?:[/?#]|$)/i;
const KITAP_URL_DESENI = /\/book\d+\//i;
const CIKIS = Object.freeze({ GECTI: 0, RED: 1, OLCULEMEDI: 4 });
const YOKLAMA_IFADESI = `(${domYokla.toString()})()`;

function argumanlar(argv) {
  const a = {
    port: 0,
    host: '127.0.0.1',
    kanit: '',
    kurulumKoku: '',
    baglanSn: 20,
    menuSn: 30,
    gezinmeSn: 15,
    kitapSn: 60,
    e7Sn: 20,
    toplamSn: 200,
    yenidenYukle: true,
    aralikMs: 1000,
    hedefDeseni: '',
    kaydedici: false,
    setTum: false,
    setTumSn: 90,
  };
  const sayi = { '--port': 'port', '--baglan-sn': 'baglanSn', '--menu-sn': 'menuSn', '--gezinme-sn': 'gezinmeSn',
    '--kitap-sn': 'kitapSn', '--e7-sn': 'e7Sn', '--toplam-sn': 'toplamSn', '--aralik-ms': 'aralikMs',
    '--set-tum-sn': 'setTumSn' };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const v = argv[i + 1];
    if (sayi[k]) { a[sayi[k]] = Number(v); i += 1; } else if (k === '--host') { a.host = v; i += 1; } else if (k === '--kanit') { a.kanit = v; i += 1; } else if (k === '--kurulum-koku') { a.kurulumKoku = v; i += 1; } else if (k === '--yeniden-yukle') { a.yenidenYukle = v !== '0'; i += 1; } else if (k === '--hedef-deseni') { a.hedefDeseni = v || ''; i += 1; } else if (k === '--kaydedici') { a.kaydedici = v === '1'; i += 1; } else if (k === '--set-tum') { a.setTum = v === '1'; i += 1; }
  }
  return a;
}

/** Tek satır, `ANAHTAR=değer` biçimine uygun metin. Saf. */
function tekSatir(s, sinir = 400) {
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim().slice(0, sinir);
}

/**
 * Motorun güncelleme cevabını yorumlar. Saf.
 * Cevap biçimi (ölçüldü, e2e 24.09 ve rapor §B E4): `{Success, Data, Vs}` — versiyon=Vs ise
 * `Data=""`, versiyon<Vs ise `Data=<ZKitapZipH zip URL>`.
 * @param {{url:string, govde?:string, durum?:string, hata?:string, http?:number}} k
 */
function guncellemeCevabiCoz(k) {
  let q;
  try { q = new URL(k.url).searchParams; } catch (_) { q = new URLSearchParams(); }
  const temel = {
    url: tekSatir(k.url, 300), id: q.get('id') || '', versiyon: q.get('versiyon') || '', setMi: q.get('setMi') || '',
  };
  if (k.govde === undefined || k.govde === null) {
    const sebep = k.durum === 'basarisiz' ? `istek başarısız: ${k.hata || '?'}`
      : k.hata ? `gövde okunamadı: ${k.hata}` : 'cevap tamamlanmadı';
    return { ...temel, durum: 'OLCULEMEDI', sebep };
  }
  let j;
  try { j = JSON.parse(k.govde); } catch (_) {
    return { ...temel, durum: 'OLCULEMEDI', sebep: `cevap JSON değil (HTTP ${k.http || '?'}): ${tekSatir(k.govde, 80)}` };
  }
  if (!j || typeof j !== 'object') return { ...temel, durum: 'OLCULEMEDI', sebep: 'cevap nesne değil' };
  if (j.Success === false) return { ...temel, durum: 'OLCULEMEDI', sebep: 'Success=false' };
  const data = j.Data === null || j.Data === undefined ? '' : String(j.Data).trim();
  const vs = j.Vs === null || j.Vs === undefined ? '' : String(j.Vs);
  if (data) {
    return {
      ...temel, vs, data, durum: 'DOLU', sebep: `${temel.id || '?'} v${temel.versiyon || '?'} < İmpark v${vs || '?'}`,
    };
  }
  const geri = vs !== '' && temel.versiyon !== '' && Number(vs) < Number(temel.versiyon);
  return {
    ...temel, vs, data: '', durum: 'BOS', uyari: geri ? `İmpark v${vs} < paket v${temel.versiyon} (geri alınmış olabilir)` : '',
  };
}

/**
 * Yakalanan cevapları E7 kararına indirger. Saf.
 * @param {Array<object>} cevaplar guncellemeCevabiCoz çıktıları
 * @returns {{durum:'DOLU'|'BOS'|'YOK'|'OLCULEMEDI', ayrinti:string, oneri:string}}
 */
function e7Ozetle(cevaplar = []) {
  if (!cevaplar.length) {
    return { durum: 'YOK', ayrinti: 'güncelleme ucu çağrılmadı (GetKitapGuncellemeBilgi görülmedi) — karar E4 (statik) kontrolünde', oneri: '' };
  }
  const dolu = cevaplar.filter((c) => c.durum === 'DOLU');
  if (dolu.length) {
    const tekil = [...new Map(dolu.map((c) => [`${c.id}|${c.versiyon}`, c])).values()];
    const ayrinti = tekil.map((c) => `${c.sebep} (Data=${c.data})`).join('; ');
    const zipler = tekil.map((c) => `ZKitapZipH/${c.id}-${c.vs}.zip`).join(', ');
    const oneri = `kaynak S1 ile yenilenmeli (${zipler}); yeni build zip arşive girince yeniden kuyruğa al `
      + '(İmpark web katmanı gecikmeli: Vs tazeyse ≥10 dk sonra); aynı kaynakla yeniden üretim aynı RED\'i verir';
    return { durum: 'DOLU', ayrinti, oneri };
  }
  const olc = cevaplar.filter((c) => c.durum === 'OLCULEMEDI');
  const bos = cevaplar.filter((c) => c.durum === 'BOS');
  if (olc.length) {
    return {
      durum: 'OLCULEMEDI',
      ayrinti: olc.map((c) => `${c.id || '?'}: ${c.sebep}`).concat(bos.map((c) => `${c.id} v${c.versiyon} güncel`)).join('; '),
      oneri: '',
    };
  }
  const tekil = [...new Map(bos.map((c) => [`${c.id}|${c.versiyon}`, c])).values()];
  const uyarilar = tekil.map((c) => c.uyari).filter(Boolean);
  return {
    durum: 'BOS',
    ayrinti: tekil.map((c) => `${c.id} v${c.versiyon} güncel (Vs=${c.vs || '?'})`).concat(uyarilar.map((u) => `UYARI ${u}`)).join('; '),
    oneri: '',
  };
}

/** Yoklamadan sayfa türü. Saf. @returns {'set'|'kok-okuyucu'|'kitaplik'|null} */
function sayfaTuru(y) {
  if (!y || y.yoklamaHatasi) return null;
  if ((y.kartlar || []).length) return 'set';
  if (sayfaIzi(y) > 0) return 'kok-okuyucu';
  if ((y.kapaklar || []).length) return 'kitaplik';
  return null;
}

/** Tıklanacak kart: ilk KİTAP kartı; yalnız grup varsa ilk grup. Saf. */
function kartSec(kartlar = []) {
  return kartlar.find((k) => k && k.tip !== 'webz-grup') || kartlar[0] || null;
}

/**
 * Kartı DOM'da bulup `el.click()` yapan ifade (main.js'in yedek yöntemi). Saf.
 * Web-Z: `.book-item[data-book-id] .book-cover`; yayıncı/sade menü: `bookN/` taşıyan
 * a[href] / [data-url] / [onclick]; kapak: dom-yoklama'nın işaretlediği `[data-empp-kapak]`.
 */
function tiklamaIfadesi(kart) {
  if (!kart) return 'false';
  if (kart.secici) {
    const ic = JSON.stringify(`${kart.secici} .book-cover`);
    const dis = JSON.stringify(kart.secici);
    return `(() => { const el = document.querySelector(${ic}) || document.querySelector(${dis}); `
      + 'if (!el) return false; el.click(); return true; })()';
  }
  const kitap = String(kart.kitap || '');
  if (!/^book\d+$/i.test(kitap)) return 'false';
  const desen = JSON.stringify(`(?:^|[/'"(\\s])${kitap}\\/`);
  return `(() => { const re = new RegExp(${desen}, 'i'); `
    + 'const el = [...document.querySelectorAll(\'a[href],[data-url],[onclick]\')].find((e) => '
    + 're.test([e.getAttribute(\'href\'), e.getAttribute(\'data-url\'), e.getAttribute(\'onclick\')].filter(Boolean).join(\' \'))); '
    + 'if (!el) return false; el.click(); return true; })()';
}

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/** sessionStorage anahtarı — kaydedici yazar, `kaydediciOku` okur. */
const KAYDEDICI_ANAHTAR = 'empp-k4-kayit';

/**
 * Belge-başı kaydedici (sayfa betiklerinden ÖNCE koşar). window.fetch bir erişimciyle sarılır:
 * sonradan atanan fetch (CapacitorHttp köprüsü, ag-politikasi sarmalı) da sarılır. XHR open/send
 * de izlenir. Yalnız güncelleme ucu kaydedilir; cevap klonlanıp okunur, sayfanın akışı değişmez.
 */
const KAYDEDICI_KAYNAK = `(function () {
  if (window.__emppK4Kaydedici) return;
  window.__emppK4Kaydedici = true;
  var ANAHTAR = ${JSON.stringify(KAYDEDICI_ANAHTAR)};
  var DESEN = ${GUNCELLEME_DESENI.toString()};
  function mutlak(u) { try { return new URL(String(u), location.href).href; } catch (e) { return String(u); } }
  function kaydet(k) {
    try {
      var l = JSON.parse(sessionStorage.getItem(ANAHTAR) || '[]');
      if (l.length < 50) { l.push(k); sessionStorage.setItem(ANAHTAR, JSON.stringify(l)); }
    } catch (e) { /* depolama yok */ }
  }
  function hata(e) { return String((e && e.message) || e); }
  function sar(f) {
    if (typeof f !== 'function' || f.__emppK4) return f;
    var s = function (girdi) {
      var url = '';
      try { url = mutlak(typeof girdi === 'string' ? girdi : ((girdi && girdi.url) || girdi)); } catch (e) { url = ''; }
      var p = f.apply(this, arguments);
      if (DESEN.test(url) && p && typeof p.then === 'function') {
        p.then(function (r) {
          try {
            r.clone().text().then(function (t) { kaydet({ url: url, http: r.status, govde: t, kanal: 'fetch' }); },
              function (e) { kaydet({ url: url, http: r.status, hata: hata(e), kanal: 'fetch' }); });
          } catch (e) { kaydet({ url: url, hata: hata(e), kanal: 'fetch' }); }
        }, function (e) { kaydet({ url: url, durum: 'basarisiz', hata: hata(e), kanal: 'fetch' }); });
      }
      return p;
    };
    s.__emppK4 = true;
    return s;
  }
  var ic = sar(window.fetch);
  try {
    Object.defineProperty(window, 'fetch', { configurable: true, enumerable: true,
      get: function () { return ic; }, set: function (v) { ic = sar(v); } });
  } catch (e) { window.fetch = ic; }
  try {
    var X = window.XMLHttpRequest.prototype;
    var ac = X.open;
    var yolla = X.send;
    X.open = function (m, u) { this.__emppK4Url = mutlak(u); return ac.apply(this, arguments); };
    X.send = function () {
      var x = this;
      if (DESEN.test(x.__emppK4Url || '')) {
        x.addEventListener('loadend', function () {
          var t;
          try {
            if (x.responseType === '' || x.responseType === 'text') t = x.responseText;
            else if (x.responseType === 'json') t = JSON.stringify(x.response);
          } catch (e) { t = undefined; }
          if (x.status) kaydet({ url: x.__emppK4Url, http: x.status, govde: t, kanal: 'xhr' });
          else kaydet({ url: x.__emppK4Url, durum: 'basarisiz', hata: 'XHR durum 0', kanal: 'xhr' });
        });
      }
      return yolla.apply(this, arguments);
    };
  } catch (e) { /* XHR yok */ }
}());`;

/** Kaydedicinin sessionStorage'daki ham kayıtları (okunamazsa boş). */
async function kaydediciOku(cdp) {
  try {
    const ham = await cdp.degerlendir(
      `(() => { try { return sessionStorage.getItem(${JSON.stringify(KAYDEDICI_ANAHTAR)}) || '[]'; } catch (e) { return '[]'; } })()`,
      5000,
    );
    const l = JSON.parse(String(ham || '[]'));
    return Array.isArray(l) ? l.filter((k) => k && typeof k.url === 'string') : [];
  } catch (_) {
    return [];
  }
}

/**
 * Network kayıtlarına kaydedicinin gördüklerini ekler: aynı URL Network'te GÖVDESİYLE varsa
 * kaydedicininki atlanır (çift sayılmasın). Saf.
 */
function kayitlariBirlestir(ag = [], kayit = []) {
  const govdeli = new Set(ag.filter((k) => k.govde !== undefined && k.govde !== null).map((k) => k.url));
  const gorulen = new Set();
  const ek = [];
  for (const k of kayit) {
    const anahtar = `${k.url}|${k.govde === undefined ? '' : k.govde}`;
    if (govdeli.has(k.url) || gorulen.has(anahtar)) continue;
    gorulen.add(anahtar);
    ek.push(k);
  }
  return [...ag, ...ek];
}

/** --hedef-deseni: URL'si desene uyan ilk 'page' hedefi (file: şartı yok). Saf. */
function desenleHedefSec(hedefler, desen) {
  let re;
  try { re = new RegExp(desen, 'i'); } catch (_) { return null; }
  const h = (Array.isArray(hedefler) ? hedefler : [])
    .find((x) => x && x.type === 'page' && x.webSocketDebuggerUrl && re.test(String(x.url || '')));
  return h ? { hedef: h, eslesti: null } : null;
}

/** Motorun güncelleme isteklerini dinler (ön uçuş/Preflight sayılmaz). */
class GuncellemeDinleyici {
  constructor(cdp) {
    this.cdp = cdp;
    this.kayit = new Map();
    const ilgili = (p, url) => GUNCELLEME_DESENI.test(String(url || '')) && p.type !== 'Preflight';
    cdp.on('Network.requestWillBeSent', (p) => {
      const r = p.request || {};
      if (!ilgili(p, r.url) || r.method === 'OPTIONS') return;
      this.kayit.set(p.requestId, { url: r.url, durum: 'istek' });
    });
    cdp.on('Network.responseReceived', (p) => {
      const r = p.response || {};
      if (!ilgili(p, r.url)) return;
      const k = this.kayit.get(p.requestId) || { url: r.url };
      k.http = r.status;
      k.durum = 'cevap';
      this.kayit.set(p.requestId, k);
    });
    cdp.on('Network.loadingFinished', (p) => {
      const k = this.kayit.get(p.requestId);
      if (!k) return;
      k.durum = 'govde-bekleniyor';
      k.soz = cdp.gonder('Network.getResponseBody', { requestId: p.requestId }, 10000)
        .then((r) => { k.govde = r.base64Encoded ? Buffer.from(r.body || '', 'base64').toString('utf8') : r.body; k.durum = 'bitti'; })
        .catch((e) => { k.durum = 'govde-yok'; k.hata = e.message; });
    });
    cdp.on('Network.loadingFailed', (p) => {
      const k = this.kayit.get(p.requestId);
      if (!k) return;
      k.durum = 'basarisiz';
      k.hata = p.errorText || p.blockedReason || 'bilinmiyor';
    });
  }

  goruldu() { return this.kayit.size > 0; }

  hamlar() { return [...this.kayit.values()]; }

  suruyor() { return [...this.kayit.values()].some((k) => ['istek', 'cevap', 'govde-bekleniyor'].includes(k.durum)); }

  async tamamla() { await Promise.all([...this.kayit.values()].map((k) => k.soz).filter(Boolean)); }

  cevaplar() { return this.hamlar().map(guncellemeCevabiCoz); }
}

async function yokla(cdp) {
  try {
    const y = await cdp.degerlendir(YOKLAMA_IFADESI, 8000);
    return y && typeof y === 'object' ? y : { yoklamaHatasi: 'boş yoklama' };
  } catch (e) {
    return { yoklamaHatasi: e.message };
  }
}

async function adresOku(cdp) {
  try { return String(await cdp.degerlendir('location.href', 5000)); } catch (_) { return ''; }
}

async function fareTikla(cdp, x, y) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    const p = { type, x, y };
    if (type !== 'mouseMoved') Object.assign(p, { button: 'left', clickCount: 1 });
    await cdp.gonder('Input.dispatchMouseEvent', p, 5000);
  }
}

/** Sayfa türü iki ardışık yoklamada aynı ve yükleniyor göstergesi yokken döner. */
async function turBekle(cdp, a) {
  const bas = Date.now();
  let onceki = null;
  let son = null;
  while ((Date.now() - bas) / 1000 < a.menuSn) {
    son = await yokla(cdp);
    const tur = sayfaTuru(son);
    if (tur && !(son.yukleniyor || []).length && tur === onceki) return { tur, yoklama: son };
    onceki = tur;
    await bekle(a.aralikMs);
  }
  return { tur: sayfaTuru(son), yoklama: son };
}

/** URL `bookN/` altına geçene dek bekler. */
async function kitapAdresiBekle(cdp, a, baslangic) {
  const bas = Date.now();
  let url = '';
  while ((Date.now() - bas) / 1000 < a.gezinmeSn) {
    url = await adresOku(cdp);
    if (url && url !== baslangic && KITAP_URL_DESENI.test(url)) return url;
    await bekle(a.aralikMs);
  }
  return '';
}

/** Okuyucu: iki ardışık yoklamada sayfa izi var ve yükleniyor göstergesi yok. */
async function okuyucuBekle(cdp, a, { kapakDene = true } = {}) {
  const bas = Date.now();
  let ardisik = 0;
  let son = null;
  let kapakTiklandi = false;
  while ((Date.now() - bas) / 1000 < a.kitapSn) {
    await bekle(a.aralikMs);
    son = await yokla(cdp);
    if (son.yoklamaHatasi) { ardisik = 0; continue; }
    const hazir = !(son.yukleniyor || []).length && sayfaIzi(son) > 0;
    if (hazir) {
      ardisik += 1;
      if (ardisik >= 2) return { tamam: true, son, sn: Math.round((Date.now() - bas) / 1000), kapakTiklandi };
      continue;
    }
    ardisik = 0;
    // Kitabın içinde motor kitap rafı (çok kapaklı kitap) → ilk kapağa bir kez tıkla.
    if (kapakDene && !kapakTiklandi && !(son.yukleniyor || []).length && (son.kapaklar || []).length
      && Date.now() - bas >= 3 * a.aralikMs) {
      kapakTiklandi = true;
      try { await cdp.degerlendir(tiklamaIfadesi(son.kapaklar[0]), 5000); } catch (_) { /* sonraki yoklama söyler */ }
    }
  }
  return { tamam: false, son, sn: Math.round((Date.now() - bas) / 1000), kapakTiklandi };
}

function okuyucuRedSebebi(s, a) {
  const son = s.son || {};
  if ((son.yukleniyor || []).length) return `${a.kitapSn} sn sonra hâlâ yükleniyor göstergesi: ${(son.yukleniyor || []).slice(0, 3).join(' | ')}`;
  if (son.yoklamaHatasi) return `okuyucu yoklanamadı: ${son.yoklamaHatasi}`;
  return `okuyucu ${a.kitapSn} sn içinde sayfa çizmedi (görünür sayfa görseli / tuval yok)`;
}

async function kanitYaz(cdp, a, ad, dom) {
  if (!a.kanit) return;
  try {
    const r = await cdp.gonder('Page.captureScreenshot', { format: 'png' }, 15000);
    if (r && r.data) fs.writeFileSync(path.join(a.kanit, `${ad}.png`), Buffer.from(r.data, 'base64'));
  } catch (_) { /* kanıt eksik — karar değişmez */ }
  if (!dom) return;
  try {
    const html = await cdp.degerlendir('document.documentElement.outerHTML', 8000);
    fs.writeFileSync(path.join(a.kanit, `${ad}.dom.html`), String(html).slice(0, 3 * 1024 * 1024));
  } catch (_) { /* kanıt eksik */ }
}

/** Asıl akış. Karar nesnesi döndürür, fırlatmaz. */
async function kos(a, sonuc) {
  // 1. Hedef: uygulama penceresi zaten görüldü, port açılmış olmalı.
  const bitis = Date.now() + a.baglanSn * 1000;
  let secim = null;
  let sonHata = '';
  while (Date.now() < bitis) {
    try {
      const liste = await jsonGetir(`http://${a.host}:${a.port}/json/list`, 3000);
      secim = a.hedefDeseni ? desenleHedefSec(liste, a.hedefDeseni) : hedefSec(liste, a.kurulumKoku);
      if (secim) break;
      sonHata = a.hedefDeseni ? `/${a.hedefDeseni}/ sayfa hedefi yok (${(liste || []).length} hedef)`
        : `file: sayfa hedefi yok (${(liste || []).length} hedef)`;
    } catch (e) {
      sonHata = e.message;
    }
    await bekle(a.aralikMs);
  }
  if (!secim) {
    sonuc.e6 = { durum: 'OLCULEMEDI', sebep: `CDP bağlanamadı (${a.baglanSn} sn, port ${a.port}): ${sonHata}` };
    return;
  }
  sonuc.hedef = { url: secim.hedef.url, eslesti: secim.eslesti };

  const ws = await wsBaglan(wsAdresiniCevir(secim.hedef.webSocketDebuggerUrl, a.host, a.port), 5000);
  const cdp = new CdpOturum(ws);
  sonuc.cdp = cdp;
  const dinleyici = new GuncellemeDinleyici(cdp);
  sonuc.dinleyici = dinleyici;
  const konsol = [];
  sonuc.konsol = konsol;
  const ekle = (seviye, mesaj) => { if (konsol.length < 2000) konsol.push({ seviye, mesaj: String(mesaj || '').slice(0, 1000) }); };
  cdp.on('Runtime.consoleAPICalled', (p) => ekle(p.type === 'error' ? 'error' : p.type,
    (p.args || []).map((x) => (x.value !== undefined ? String(x.value) : (x.description || ''))).join(' ')));
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    ekle('error', (d.exception && d.exception.description) || d.text || '');
  });
  cdp.on('Log.entryAdded', (p) => { const e = p.entry || {}; ekle(e.level, `${e.text || ''}${e.url ? ` ${e.url}` : ''}`); });
  // Motor alert/confirm açarsa Runtime.evaluate asılı kalır → diyalog kabul edilir, kanıta yazılır.
  sonuc.diyaloglar = [];
  cdp.on('Page.javascriptDialogOpening', (p) => {
    sonuc.diyaloglar.push(tekSatir(`${p.type}: ${p.message}`, 200));
    cdp.gonder('Page.handleJavaScriptDialog', { accept: true }, 5000).catch(() => {});
  });
  await cdp.gonder('Network.enable', {}, 10000);
  await cdp.gonder('Runtime.enable', {}, 10000);
  await Promise.all([
    cdp.gonder('Log.enable', {}, 10000).catch(() => {}),
    cdp.gonder('Page.enable', {}, 10000).catch(() => {}),
  ]);
  // --kaydedici: belge-başı kaydedici + bir kez yeniden yükleme (açılıştaki soru da kaydedilsin).
  if (a.kaydedici) {
    try {
      await cdp.gonder('Page.addScriptToEvaluateOnNewDocument', { source: KAYDEDICI_KAYNAK }, 10000);
      await cdp.gonder('Page.reload', { ignoreCache: false }, 10000);
      sonuc.kaydedici = { kuruldu: true };
      sonuc.yenidenYuklendi = true;
      await bekle(Math.max(200, a.aralikMs * 2));
    } catch (e) {
      sonuc.kaydedici = { kuruldu: false, hata: tekSatir(e.message, 200) };
    }
  }

  // 2. İlk yoklama. Kart yoksa kök sayfa kitabın kendisidir (tek kitap): güncelleme sorusu
  //    açılışta sorulup biz bağlanmadan bitmiş olabilir → bir kez yeniden yükle.
  const ilk = await yokla(cdp);
  sonuc.ilkUrl = ilk.url || '';
  if (a.yenidenYukle && sonuc.yenidenYuklendi !== true && !(ilk.kartlar || []).length && !dinleyici.goruldu()) {
    try {
      await cdp.gonder('Page.reload', { ignoreCache: false }, 10000);
      sonuc.yenidenYuklendi = true;
      await bekle(Math.max(200, a.aralikMs * 2));
    } catch (e) {
      sonuc.yenidenYuklendi = `başarısız: ${e.message}`;
    }
  }

  // 3. Sayfa türü.
  const { tur, yoklama } = await turBekle(cdp, a);
  sonuc.tur = tur;
  sonuc.menu = yoklama ? {
    url: yoklama.url, baslik: yoklama.baslik, kartSayisi: yoklama.kartSayisi, kapak: (yoklama.kapaklar || []).length,
    sayfaIzi: sayfaIzi(yoklama), yukleniyor: yoklama.yukleniyor, yoklamaHatasi: yoklama.yoklamaHatasi,
  } : null;
  if (!tur) {
    sonuc.e6 = {
      durum: 'OLCULEMEDI',
      sebep: `kitap listesi/okuyucu tanınmadı (${a.menuSn} sn: kart 0, kapak 0, sayfa izi 0${yoklama && yoklama.yoklamaHatasi ? `, ${yoklama.yoklamaHatasi}` : ''})`,
    };
    await kanitYaz(cdp, a, 'kitap-cdp', true);
    return;
  }

  // 4. Kitaba gir.
  let kapakDene = true;
  if (tur === 'set') {
    let kart = kartSec(yoklama.kartlar);
    if (kart && kart.tip === 'webz-grup') {
      await cdp.degerlendir(tiklamaIfadesi(kart), 5000).catch(() => false);
      await bekle(Math.max(200, a.aralikMs * 2));
      const ic = await yokla(cdp);
      kart = kartSec((ic.kartlar || []).filter((k) => k.tip !== 'webz-grup')) || kart;
    }
    const adim = { kart: kart && { tip: kart.tip, anahtar: kart.anahtar, metin: kart.metin }, yontem: 'dom' };
    sonuc.adim = adim;
    const bas = await adresOku(cdp);
    let tiklandi = false;
    try { tiklandi = await cdp.degerlendir(tiklamaIfadesi(kart), 5000); } catch (_) { tiklandi = false; }
    let url = tiklandi ? await kitapAdresiBekle(cdp, a, bas) : '';
    if (!url && kart && Number.isFinite(kart.x) && Number.isFinite(kart.y)) {
      adim.yontem = tiklandi ? 'dom+cdp-fare' : 'cdp-fare (dom öğesi bulunamadı)';
      try { await fareTikla(cdp, kart.x, kart.y); } catch (_) { /* aşağıda URL söyler */ }
      url = await kitapAdresiBekle(cdp, a, bas);
    }
    adim.url = url;
    if (!url) {
      sonuc.e6 = { durum: 'RED', sebep: `ilk kitap kartına tıklandı (${adim.yontem}), okuyucu açılmadı — URL bookN/ altına geçmedi (${tekSatir(bas, 160)})` };
      await kanitYaz(cdp, a, 'kitap-cdp', true);
      return;
    }
  } else if (tur === 'kitaplik') {
    const kapak = (yoklama.kapaklar || [])[0];
    sonuc.adim = { kart: kapak && { tip: 'kapak', anahtar: kapak.anahtar, metin: kapak.metin }, yontem: 'dom' };
    try { await cdp.degerlendir(tiklamaIfadesi(kapak), 5000); } catch (_) { /* okuyucu beklemesi söyler */ }
    kapakDene = true;
  } else {
    sonuc.adim = { yontem: sonuc.yenidenYuklendi === true ? 'kök okuyucu yeniden yüklendi' : 'kök okuyucu (zaten açık)' };
  }

  // 5. Okuyucu çizildi mi?
  const ok = await okuyucuBekle(cdp, a, { kapakDene });
  sonuc.kitap = {
    url: ok.son && ok.son.url, baslik: ok.son && ok.son.baslik, sayfaIzi: sayfaIzi(ok.son),
    yukleniyor: ok.son && ok.son.yukleniyor, sn: ok.sn, kapakTiklandi: ok.kapakTiklandi,
  };
  if (!ok.tamam) {
    sonuc.e6 = { durum: 'RED', sebep: okuyucuRedSebebi(ok, a) };
    await kanitYaz(cdp, a, 'kitap-cdp', true);
    return;
  }
  const k = konsolSiniflandir(konsol);
  sonuc.konsolOzet = { dosyaBulunamadi: k.dosyaBulunamadi.length, jsHatalari: k.jsHatalari.slice(0, 10), redImzalari: k.redImzalari };
  if (k.redImzalari.length) {
    sonuc.e6 = { durum: 'RED', sebep: `okuyucu açıldı ama konsolda kusur imzası: ${k.redImzalari.join('; ')}` };
    await kanitYaz(cdp, a, 'kitap-cdp', true);
    return;
  }
  sonuc.e6 = {
    durum: 'GECTI',
    sebep: `${tur}: okuyucu açıldı (sayfa izi ${sayfaIzi(ok.son)}, ${ok.sn} sn)`,
    url: ok.son.url,
  };
  await kanitYaz(cdp, a, 'kitap-cdp', false);
}

/**
 * E7 penceresi: istek hiç görülmediyse ya da sürüyorsa e7Sn kadar daha bekler. `ekGoruldu`
 * (kaydedici) verilirse Network görmese de kaydedicideki kayıt "görüldü" sayılır.
 */
async function e7Bekle(dinleyici, a, ekGoruldu = null) {
  if (!dinleyici) return;
  const bas = Date.now();
  const goruldu = async () => dinleyici.goruldu() || Boolean(ekGoruldu && await ekGoruldu());
  while ((Date.now() - bas) / 1000 < a.e7Sn && (!(await goruldu()) || dinleyici.suruyor())) {
    await bekle(Math.min(500, a.aralikMs));
  }
  await Promise.race([dinleyici.tamamla(), bekle(10000)]);
}

/**
 * --set-tum: oturum açıkken hedef sayfanın dizinindeki her alt kitap (fırlatmaz, kendi süre sınırı).
 * @param {{getir?: Function}} secenek testte sahte İmpark
 */
async function setTumOlc(sonuc, a, secenek = {}) {
  const kok = setTum.kokuUrldenBul(sonuc.hedef && sonuc.hedef.url);
  const is = setTum.sayfadanOlc({ cdp: sonuc.cdp || null, kok, getir: secenek.getir });
  let bekci;
  const sure = new Promise((coz) => {
    bekci = setTimeout(() => coz(null), a.setTumSn * 1000);
  });
  const r = await Promise.race([is, sure]);
  clearTimeout(bekci);
  if (r) return r;
  const olcum = { set: false, satirlar: [], hata: `${a.setTumSn} sn içinde bitmedi` };
  return { kok, adlar: [], olcum, karar: setTum.setTumKarari(olcum) };
}

async function ana(argv = process.argv.slice(2), yaz = (s) => process.stdout.write(`${s}\n`), secenek = {}) {
  const a = argumanlar(argv);
  if (!a.port) {
    yaz('E6=OLCULEMEDI');
    yaz('E6_SEBEP=CDP portu verilmedi');
    return CIKIS.OLCULEMEDI;
  }
  if (a.kanit) fs.mkdirSync(a.kanit, { recursive: true });
  const sonuc = { e6: { durum: 'OLCULEMEDI', sebep: 'başlamadı' }, baslangic: new Date().toISOString() };
  let bekci;
  const sure = new Promise((coz) => {
    bekci = setTimeout(() => coz('zaman'), a.toplamSn * 1000);
  });
  try {
    const r = await Promise.race([kos(a, sonuc).then(() => 'bitti'), sure]);
    if (r === 'zaman' && sonuc.e6.durum !== 'RED' && sonuc.e6.durum !== 'GECTI') {
      sonuc.e6 = { durum: 'OLCULEMEDI', sebep: `CDP koşusu ${a.toplamSn} sn içinde bitmedi (${sonuc.e6.sebep})` };
    }
    const ekGoruldu = a.kaydedici && sonuc.cdp ? async () => (await kaydediciOku(sonuc.cdp)).length > 0 : null;
    if (r === 'bitti') await Promise.race([e7Bekle(sonuc.dinleyici, a, ekGoruldu), sure]);
  } catch (e) {
    if (sonuc.e6.durum !== 'RED') sonuc.e6 = { durum: 'OLCULEMEDI', sebep: `CDP hatası: ${e.message}` };
  } finally {
    clearTimeout(bekci);
  }
  let cevaplar = sonuc.dinleyici ? sonuc.dinleyici.cevaplar() : [];
  if (a.kaydedici && sonuc.cdp && sonuc.dinleyici) {
    const kayit = await kaydediciOku(sonuc.cdp);
    sonuc.kaydedici = { ...(sonuc.kaydedici || {}), kayit: kayit.length };
    cevaplar = kayitlariBirlestir(sonuc.dinleyici.hamlar(), kayit).map(guncellemeCevabiCoz);
  }
  const e7 = sonuc.dinleyici ? e7Ozetle(cevaplar) : { durum: 'OLCULEMEDI', ayrinti: 'CDP oturumu kurulamadı', oneri: '' };
  let st = null;
  if (a.setTum) st = await setTumOlc(sonuc, a, secenek);
  try { if (sonuc.cdp) sonuc.cdp.kapat(); } catch (_) { /* kapalı */ }

  const kayit = {
    ...sonuc, cdp: undefined, dinleyici: undefined, e7: { ...e7, cevaplar }, bitis: new Date().toISOString(),
    ...(st ? { setTum: { kok: st.kok, adlar: st.adlar, karar: st.karar } } : {}),
  };
  if (a.kanit) {
    try { fs.writeFileSync(path.join(a.kanit, 'cdp-sonuc.json'), JSON.stringify(kayit, null, 2)); } catch (_) { /* kanıt eksik */ }
  }
  yaz(`E6=${sonuc.e6.durum}`);
  yaz(`E6_SEBEP=${tekSatir(sonuc.e6.sebep)}`);
  yaz(`E6_TUR=${sonuc.tur || ''}`);
  yaz(`E6_URL=${tekSatir(sonuc.e6.url || (sonuc.kitap && sonuc.kitap.url) || '', 300)}`);
  yaz(`CDP_HEDEF=${tekSatir(sonuc.hedef ? sonuc.hedef.url : '', 300)}`);
  yaz(`CDP_HEDEF_ESLESTI=${sonuc.hedef ? (sonuc.hedef.eslesti === true ? '1' : sonuc.hedef.eslesti === false ? '0' : '') : ''}`);
  yaz(`E7=${e7.durum}`);
  yaz(`E7_AYRINTI=${tekSatir(e7.ayrinti, 600)}`);
  yaz(`E7_ONERI=${tekSatir(e7.oneri, 600)}`);
  if (st) setTum.satirlariYaz(st.karar, yaz);
  return CIKIS[sonuc.e6.durum] === undefined ? CIKIS.OLCULEMEDI : CIKIS[sonuc.e6.durum];
}

if (require.main === module) {
  ana().then((kod) => process.exit(kod), (e) => {
    process.stdout.write(`E6=OLCULEMEDI\nE6_SEBEP=${tekSatir(e && e.message)}\nE7=OLCULEMEDI\n`);
    process.exit(CIKIS.OLCULEMEDI);
  });
}

module.exports = {
  GUNCELLEME_DESENI, KITAP_URL_DESENI, CIKIS, argumanlar, tekSatir, guncellemeCevabiCoz, e7Ozetle,
  sayfaTuru, kartSec, tiklamaIfadesi, ana,
  KAYDEDICI_ANAHTAR, KAYDEDICI_KAYNAK, kayitlariBirlestir, desenleHedefSec,
};
