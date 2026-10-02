'use strict';
/**
 * BAŞSIZ KABUL KOŞUMU — Electron ana süreci. `basliksiz-kabul.js` bunu paketin KENDİ
 * Electron ana sürümüyle başlatır; paketlenmiş uygulamanın kendisi ASLA açılmaz.
 *
 * ODAK ÇALMAMA (Nadir 2026-09-26, "bu bilgisayarda odak çalmadan"):
 *   • Çalışma zamanının Info.plist'i LSUIElement=YES (Dock simgesi yok, açılışta etkinleşmez).
 *   • app.dock.hide() + app.setActivationPolicy('accessory').
 *   • BrowserWindow({show:false, webPreferences:{offscreen:true}}) — pencere ekrana hiç gelmez;
 *     show()/focus() hiçbir yerde çağrılmaz. window.open reddedilir, alert/confirm/
 *     openExternal preload'da yutulur, ses kapalı, anahtarlık sahte (use-mock-keychain).
 *
 * Girdi: EMPP_KOSUM_GIRDI (JSON dosyası). Çıktı: girdi.sonucYolu (JSON) + kanıt PNG'leri.
 * Karar VERMEZ — ham ölçüm yazar; karar `../olcutler.js` ile CLI'dadır.
 *
 * K4 KİPİ (`girdi.k4`, ../k4-guncellik.js): ölçüm akışı KOŞMAZ. Kök sayfa yüklenir, uygulama
 * `--remote-debugging-port=<girdi.cdpPort>` ile dinler; kitaba girme ve güncelleme sorusunu
 * yakalama dışarıdaki CDP istemcisinin (tools/pardus/cdp-kitap-ac.js) işidir. Ağ AÇIK (motor
 * güncelleme sorusunu ancak ağ varken sorar) ama ZKitapZip(H)/*.zip indirmesi kesilir; Node
 * http(s) preload'da kapalı kalır (EMPP_KABUL_AG_KAPALI=1). `girdi.durDosyasi` belirince çıkar.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, session } = require('electron');
const { domYokla } = require('./dom-yoklama');
const {
  pikselMetrikleri, pikselKarari, okuyucuBasligiMi, sayfaIzi,
} = require('../olcutler');

const G = JSON.parse(fs.readFileSync(process.env.EMPP_KOSUM_GIRDI, 'utf8'));
const GENISLIK = G.genislik || 1366;
const K4 = Boolean(G.k4);
/** K4 kipinde kesilen indirmeler: İmpark içerik zip'i (ZKitapZip / ZKitapZipH) ve her .zip. */
const K4_INDIRME_DESENI = /\/ZKitapZipH?\/|\.zip(?:[?#]|$)/i;
const YUKSEKLIK = G.yukseklik || 768;

const sonuc = {
  surum: { electron: process.versions.electron, chrome: process.versions.chrome },
  baslangic: new Date().toISOString(),
  konsol: [],
  yuklemeHatalari: [],
  altKaynakHatalari: [],
  agEngellenen: [],
  engellenenPencere: [],
  engellenenGezinme: [],
  asamalar: {},
  ileriAdim: null,
  hata: null,
};

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
let yazildi = false;
function sonucYaz() {
  if (yazildi) return;
  yazildi = true;
  sonuc.bitis = new Date().toISOString();
  try { fs.writeFileSync(G.sonucYolu, JSON.stringify(sonuc, null, 2)); } catch (_) { /* CLI ÖLÇÜLEMEDİ der */ }
}

// Koşum kendi içinde de süre sınırlıdır (CLI'nın öldürme zamanlayıcısından ÖNCE yazar).
const bekci = setTimeout(() => {
  sonuc.hata = sonuc.hata || `koşum ${G.toplamSn} sn içinde bitmedi`;
  sonucYaz();
  app.exit(4);
}, Math.max(10, (G.toplamSn || 240) - 5) * 1000);
bekci.unref();

app.commandLine.appendSwitch('use-mock-keychain');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('mute-audio');
if (K4 && Number(G.cdpPort) > 0) app.commandLine.appendSwitch('remote-debugging-port', String(G.cdpPort));
app.setPath('userData', G.profilDizin);
try { app.setPath('sessionData', path.join(G.profilDizin, 'oturum')); } catch (_) { /* eski sürüm */ }
try { app.setPath('crashDumps', path.join(G.profilDizin, 'cokme')); } catch (_) { /* eski sürüm */ }
if (app.dock) app.dock.hide();
app.on('window-all-closed', () => { /* kendimiz çıkarız */ });

// SON SAVUNMA: uygulama bir an bile etkinleşirse (ölçüldü: node_modules v39 açılışta
// ~3 sn öne geçti) sayılır ve HEMEN gizlenir — odak önceki uygulamaya döner. Sayaç > 0
// ise CLI koşuyu "kapı kusuru" sayar ve bu çalışma zamanını kalıcı işaretler.
sonuc.etkinlesme = [];
app.on('did-become-active', () => {
  sonuc.etkinlesme.push(new Date().toISOString());
  try { app.hide(); } catch (_) { /* yok */ }
});

function korumaKur(wc) {
  wc.setAudioMuted(true);
  wc.setWindowOpenHandler(({ url }) => {
    sonuc.engellenenPencere.push(String(url).slice(0, 300));
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!String(url).startsWith('file:')) {
      e.preventDefault();
      sonuc.engellenenGezinme.push(String(url).slice(0, 300));
    }
  });
  wc.on('console-message', (_e, seviye, mesaj, satir, kaynak) => {
    if (sonuc.konsol.length < 2000) {
      const ad = ['verbose', 'info', 'warning', 'error'][seviye] || String(seviye);
      sonuc.konsol.push({ zamanMs: Date.now(), seviye: ad, mesaj: String(mesaj).slice(0, 1000), kaynak: `${kaynak}:${satir}` });
    }
  });
  wc.on('did-fail-load', (_e, kod, aciklama, url, anaCerceve) => {
    sonuc.yuklemeHatalari.push({ kod, aciklama, url: String(url).slice(0, 300), anaCerceve });
  });
  wc.on('render-process-gone', (_e, ayrinti) => {
    sonuc.cokme = `${ayrinti && ayrinti.reason} (${ayrinti && ayrinti.exitCode})`;
  });
}

app.on('web-contents-created', (_e, wc) => korumaKur(wc));

async function ekranAl(win) {
  try { win.webContents.invalidate(); } catch (_) { /* yok */ }
  await bekle(150);
  let img = null;
  try { img = await win.webContents.capturePage(); } catch (_) { img = null; }
  if ((!img || img.isEmpty()) && win.__sonKare) img = win.__sonKare;
  if (!img || img.isEmpty()) return { img: null, piksel: null };
  const { width, height } = img.getSize();
  const piksel = pikselMetrikleri(img.toBitmap(), width, height, { duzen: 'bgra' });
  return { img, piksel };
}

async function yokla(win) {
  try {
    return await win.webContents.executeJavaScript(`(${domYokla.toString()})()`, true);
  } catch (e) {
    return { yoklamaHatasi: String(e && e.message) };
  }
}

/**
 * Bir aşamayı ölçer: her saniye DOM + piksel; `yeterli` iki ardışık ölçümde tutunca
 * erken çıkar, tutmazsa süre sonuna kadar bekler ("N sn sonra hâlâ yükleniyor").
 */
async function asamaOlc(win, ad, beklemeSn, yeterli) {
  const bas = Date.now();
  let son = null;
  let sonImg = null;
  let ardisik = 0;
  let olcumSayisi = 0;
  const minSn = G.enAzBekleSn || 3;
  while ((Date.now() - bas) / 1000 < beklemeSn) {
    await bekle(1000);
    const dom = await yokla(win);
    const { img, piksel } = await ekranAl(win);
    olcumSayisi += 1;
    son = { ...dom, piksel };
    if (img) sonImg = img;
    const gecenSn = (Date.now() - bas) / 1000;
    if (gecenSn >= minSn && yeterli(son)) {
      ardisik += 1;
      if (ardisik >= 2) break;
    } else {
      ardisik = 0;
    }
  }
  son = son || {};
  son.beklenenSn = Math.round((Date.now() - bas) / 1000);
  son.olcumSayisi = olcumSayisi;
  son.erkenYeterli = ardisik >= 2;
  if (sonImg) {
    const png = path.join(G.kanitDizin, `${ad}.png`);
    try { fs.writeFileSync(png, sonImg.toPNG()); son.ekran = png; } catch (_) { /* kanıt eksik */ }
  }
  // DOM anlık görüntüsü — RED'in "neden"i sonradan paketi yeniden açmadan okunabilsin.
  try {
    const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML', true);
    fs.writeFileSync(path.join(G.kanitDizin, `${ad}.dom.html`), String(html).slice(0, 3 * 1024 * 1024));
  } catch (_) { /* kanıt eksik */ }
  if (sonuc.cokme) son.cokme = sonuc.cokme;
  return son;
}

function anaCerceveHatasi() {
  const h = sonuc.yuklemeHatalari.filter((y) => y.anaCerceve && y.kod !== -3);
  return h.length ? `${h[h.length - 1].aciklama} (${h[h.length - 1].kod}) ${h[h.length - 1].url}` : null;
}

function gezinmeBekle(win, ms) {
  return new Promise((coz) => {
    let bitti = false;
    const t = setTimeout(() => { if (!bitti) { bitti = true; coz(null); } }, ms);
    win.webContents.once('did-navigate', (_e, url) => {
      if (bitti) return;
      bitti = true;
      clearTimeout(t);
      coz(url);
    });
  });
}

function yuklenmeBekle(win, ms) {
  return new Promise((coz) => {
    const t = setTimeout(() => coz(false), ms);
    win.webContents.once('did-stop-loading', () => { clearTimeout(t); coz(true); });
  });
}

async function tikla(win, kart) {
  const wc = win.webContents;
  wc.sendInputEvent({ type: 'mouseMove', x: kart.x, y: kart.y });
  await bekle(80);
  wc.sendInputEvent({ type: 'mouseDown', x: kart.x, y: kart.y, button: 'left', clickCount: 1 });
  await bekle(60);
  wc.sendInputEvent({ type: 'mouseUp', x: kart.x, y: kart.y, button: 'left', clickCount: 1 });
}

async function kos() {
  await app.whenReady();
  if (app.dock) app.dock.hide();
  if (typeof app.setActivationPolicy === 'function') app.setActivationPolicy('accessory');

  if (G.agKapali) {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (ayrinti, cb) => {
        if (sonuc.agEngellenen.length < 200) sonuc.agEngellenen.push(String(ayrinti.url).slice(0, 200));
        cb({ cancel: true });
      },
    );
  } else if (K4 || G.indirmeKes) {
    // K4 ve aktivasyon kodlu seri (ağ açık içerik koşumu): sunucuya soru serbest, zip indirmesi kesik.
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (ayrinti, cb) => {
        if (K4_INDIRME_DESENI.test(String(ayrinti.url))) {
          if (sonuc.agEngellenen.length < 200) sonuc.agEngellenen.push(String(ayrinti.url).slice(0, 200));
          cb({ cancel: true });
          return;
        }
        cb({});
      },
    );
  }

  // Alt kaynak hataları (file:// dahil) — preload'ın yakalama dinleyicisine ek, gerçek ağ kodu.
  try {
    session.defaultSession.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, (ayrinti) => {
      if (sonuc.altKaynakHatalari.length < 300) {
        sonuc.altKaynakHatalari.push({ hata: ayrinti.error, url: String(ayrinti.url).slice(0, 300), tur: ayrinti.resourceType });
      }
    });
  } catch (_) { /* eski sürüm */ }

  const win = new BrowserWindow({
    show: false,
    width: GENISLIK,
    height: YUKSEKLIK,
    useContentSize: true,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      offscreen: true,
      // Paketlerin kendi main.js'i ile aynı (Web-Z kabuğu ve motor Node'a muhtaç).
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.webContents.setFrameRate(5);
  win.webContents.on('paint', (_e, _kirli, img) => { win.__sonKare = img; });

  const girisUrl = pathToFileURL(G.giris).href;
  sonuc.girisUrl = girisUrl;
  try {
    await win.loadURL(girisUrl);
  } catch (e) {
    // loadURL, sayfa içindeki bir alt kaynak ya da gezinme iptalinde de reddedebilir;
    // ana çerçeve hatası did-fail-load ile ayrıca kaydedilir.
    sonuc.loadUrlHatasi = String(e && e.message).slice(0, 300);
  }
  if (K4) {
    await k4Bekle();
    return;
  }

  const setMi = Boolean(G.setMi);
  const menuYeterli = (o) => !(o.yukleniyor || []).length
    && pikselKarari(o.piksel).gecti
    && (setMi
      ? ((o.kartSayisi || 0) >= G.beklenenKart && !okuyucuBasligiMi(o.baslik))
      : sayfaIzi(o) > 0);
  // Tek kitapta motor kitap rafı: sayfa izi yok ama kapak var, beyaz zemin (sapma aranmaz).
  const kitaplikYeterli = (o) => !setMi && !(o.yukleniyor || []).length && !sayfaIzi(o)
    && (o.kapaklar || []).length > 0 && pikselKarari(o.piksel, { sapmaAranmaz: true }).gecti;
  const menu = await asamaOlc(win, 'menu', G.menuBekleSn || 45, (o) => menuYeterli(o) || kitaplikYeterli(o));
  const hataM = anaCerceveHatasi();
  if (hataM) menu.yuklenemedi = hataM;
  sonuc.asamalar.menu = menu;

  if (!setMi && G.ileriAdim && !sayfaIzi(menu)) {
    await kitaplikIleriAdim(win, menu);
  }

  if (setMi && G.ileriAdim && (menu.kartlar || []).length) {
    const kart = menu.kartlar[0];
    const adim = { kart, yontem: null, gezinilen: null };
    sonuc.ileriAdim = adim;
    let gez = gezinmeBekle(win, 12000);
    await tikla(win, kart);
    adim.yontem = 'fare';
    let url = await gez;
    if ((!url || !/\/book\d+\//i.test(url)) && kart.tip === 'tema') {
      // Tema kabuğu: kart ünite penceresini açar → ilk görünür üniteye GERÇEK fare tıklaması.
      const unite = await win.webContents.executeJavaScript(`(() => {
        const el = [...document.querySelectorAll('#unitModal .unit-item')].find((e) => e.getClientRects().length);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), metin: el.innerText.trim().slice(0, 60) };
      })()`, true).catch(() => null);
      if (unite) {
        adim.unite = unite.metin;
        gez = gezinmeBekle(win, 12000);
        await tikla(win, unite);
        adim.yontem = 'fare+unite';
        url = await gez;
      }
    }
    if (!url || !/\/book\d+\//i.test(url)) {
      // Kart üstünde bir katman (tanıtım turu vb.) fareyi yutmuş olabilir → DOM tıklaması.
      gez = gezinmeBekle(win, 12000);
      const secici = kart.secici ? `${kart.secici} .book-cover, ${kart.secici}` : null;
      const kod = secici
        ? `(() => { const el = document.querySelector(${JSON.stringify(secici)}); if (el) { el.click(); return true; } return false; })()`
        : `(() => { const el = [...document.querySelectorAll('a[href],[data-url],[onclick]')].find((e) => /${kart.kitap || 'book\\d+'}\\//i.test([e.getAttribute('href'), e.getAttribute('data-url'), e.getAttribute('onclick')].join(' '))); if (el) { el.click(); return true; } return false; })()`;
      let tiklandi = false;
      try { tiklandi = await win.webContents.executeJavaScript(kod, true); } catch (_) { tiklandi = false; }
      adim.yontem = tiklandi ? 'fare+dom' : 'fare (dom öğesi bulunamadı)';
      url = await gez;
    }
    adim.gezinilen = url;
    if (url && /\/book\d+\//i.test(url)) {
      await yuklenmeBekle(win, 30000);
      const oncekiHata = sonuc.yuklemeHatalari.length;
      const kitapYeterli = (o) => !(o.yukleniyor || []).length && pikselKarari(o.piksel).gecti
        && sayfaIzi(o) > 0;
      const kitap = await asamaOlc(win, 'kitap', G.kitapBekleSn || 60, kitapYeterli);
      const yeniHatalar = sonuc.yuklemeHatalari.slice(oncekiHata).filter((y) => y.anaCerceve && y.kod !== -3);
      if (yeniHatalar.length) kitap.yuklenemedi = `${yeniHatalar[0].aciklama} (${yeniHatalar[0].kod})`;
      sonuc.asamalar.kitap = kitap;
    }
  }
}

/**
 * Tek kitap paketinde kök okuyucu yerine motorun kitap rafı açıldıysa (sayfa izi yok,
 * dikey kapak var): ilk kapağa tıklanır, okuyucu AYNI sayfada ya da gezinmeyle açılır,
 * "kitap" aşaması ölçülür.
 */
async function kitaplikIleriAdim(win, menu) {
  const kapak = (menu.kapaklar || [])[0];
  const adim = { tur: 'kitaplik', kart: kapak || null, yontem: null, gezinilen: null };
  sonuc.ileriAdim = adim;
  if (!kapak) return;
  const gez = gezinmeBekle(win, 6000);
  await tikla(win, kapak);
  adim.yontem = 'fare';
  let url = await gez;
  let ara = await yokla(win);
  if (!url && !sayfaIzi(ara) && ara.url === menu.url && (ara.kapaklar || []).length) {
    const kod = `(() => { const el = document.querySelector(${JSON.stringify(kapak.secici)}); if (el) { el.click(); return true; } return false; })()`;
    let tiklandi = false;
    try { tiklandi = await win.webContents.executeJavaScript(kod, true); } catch (_) { tiklandi = false; }
    adim.yontem = tiklandi ? 'fare+dom' : 'fare (dom öğesi bulunamadı)';
    url = await gezinmeBekle(win, 6000);
    ara = await yokla(win);
  }
  adim.gezinilen = url || ara.url || null;
  if (url) await yuklenmeBekle(win, 30000);
  const kitapYeterli = (o) => !(o.yukleniyor || []).length && pikselKarari(o.piksel).gecti && sayfaIzi(o) > 0;
  sonuc.asamalar.kitap = await asamaOlc(win, 'kitap', G.kitapBekleSn || 60, kitapYeterli);
}

/** K4 kipi: dışarıdaki CDP istemcisi işini bitirip dur dosyasını yazana dek (ya da süre dolana dek). */
async function k4Bekle() {
  sonuc.k4 = { cdpPort: Number(G.cdpPort) || null };
  const sinirMs = Math.max(10, (G.toplamSn || 240) - 10) * 1000;
  const bas = Date.now();
  while (Date.now() - bas < sinirMs) {
    if (G.durDosyasi && fs.existsSync(G.durDosyasi)) { sonuc.k4.durduruldu = true; return; }
    await bekle(300);
  }
  sonuc.k4.durduruldu = false;
}

kos()
  .catch((e) => { sonuc.hata = String((e && e.stack) || e).slice(0, 2000); })
  .finally(() => {
    sonucYaz();
    app.exit(0);
  });
