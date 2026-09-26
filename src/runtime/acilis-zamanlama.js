'use strict';

/**
 * AÇILIŞ ZAMANLAMA GÜNLÜĞÜ — çalışma anı modülü (pakete `empp-acilis-zamanlama.js`
 * adıyla kopyalanır, ana sürecin EN BAŞINDA require edilir).
 *
 * Amaç (Windows sözleşmesi, madde 6 — "boş ekran"): Nadir'in VM'inde ve okul
 * tahtasında "çift tıklamadan menüye kadar nerede bekleniyor?" sorusunu TAHMİNLE
 * değil ölçümle cevaplamak. Kurulum (NSIS) evreleri AYNI dosyaya yazar:
 *   %APPDATA%\<uygulama adı>\acilis-zamanlama.log
 *
 * Satır biçimi (kurulumla ortak, tek dosya):
 *   <ISO-8601 UTC> [uygulama] +<ms süreç başından> <evre> | <ayrıntı>
 *   <ISO-8601 UTC> [kurulum] <evre> | <ayrıntı>
 *
 * DİSİPLİN:
 *   • Açılışı ASLA düşürmez: her şey try/catch içinde; yazılamazsa sessizce vazgeçer
 *     (günlük bir teşhis aracıdır, uygulamanın parçası değil).
 *   • Senkron küçük ekleme (appendFileSync) — satır başına tek çağrı; dosya
 *     `AZAMI_BOYUT`u aşarsa `.1` adıyla bir kez döndürülür (sınırsız büyümez).
 *   • Sahte yüzde/tahmin YOK: yalnız olayın gerçekleştiği an yazılır.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DOSYA_ADI = 'acilis-zamanlama.log';
const ISARET = 'EMPP_ACILIS_ZAMANLAMA';
const AZAMI_BOYUT = 512 * 1024;
const MENU_ZAMAN_ASIMI_MS = 120000;

/** Süreç başlangıç anı (ms, epoch). process.uptime() sürecin başından beri geçen süre. */
function surecBaslangici(simdi = Date.now(), uptimeSn = process.uptime()) {
  return simdi - Math.round(uptimeSn * 1000);
}

/** Tek satır üretir. Saf. */
function satirUret({ an, baslangic, evre, ayrinti }) {
  const iso = new Date(an).toISOString();
  const fark = Number.isFinite(baslangic) ? `+${Math.max(0, Math.round(an - baslangic))}ms ` : '';
  const ek = ayrinti == null || ayrinti === '' ? '' : ` | ${String(ayrinti).replace(/[\r\n]+/g, ' ')}`;
  return `${iso} [uygulama] ${fark}${evre}${ek}\n`;
}

/**
 * İşlemci mimarisi bilgisi — ia32 exe'nin x64 ya da ARM64 Windows'ta emülasyonla
 * koşup koşmadığını gösterir (PROCESSOR_ARCHITEW6432 yalnız WOW64 altında dolar).
 */
function mimariOzeti(env = process.env, proc = process, osMod = os) {
  let osArch = '?';
  try { osArch = osMod.arch(); } catch (e) { /* bilinmiyor */ }
  let cpu = '?';
  let cekirdek = 0;
  try {
    const c = osMod.cpus() || [];
    cekirdek = c.length;
    cpu = c[0] && c[0].model ? String(c[0].model).trim() : '?';
  } catch (e) { /* bilinmiyor */ }
  let bellek = '?';
  try { bellek = `${Math.round(osMod.totalmem() / (1024 * 1024))} MB`; } catch (e) { /* yok */ }
  let surum = '?';
  try { surum = osMod.release(); } catch (e) { /* yok */ }
  return [
    `process.arch=${proc.arch}`,
    `os.arch=${osArch}`,
    `PROCESSOR_ARCHITECTURE=${env.PROCESSOR_ARCHITECTURE || '-'}`,
    `PROCESSOR_ARCHITEW6432=${env.PROCESSOR_ARCHITEW6432 || '-'}`,
    `platform=${proc.platform}`,
    `os.release=${surum}`,
    `cpu=${cpu} x${cekirdek}`,
    `bellek=${bellek}`,
  ].join(' ');
}

/** Menü çizildi mi? — renderer'da koşar; `executeJavaScript` ile verilir. Saf metin. */
function menuBekleyiciKodu(zamanAsimiMs = MENU_ZAMAN_ASIMI_MS) {
  return `new Promise(function (bitir) {
  var bitti = false;
  function hazirMi() {
    var c = document.getElementById('bookSetContainer');
    if (c) return c.children.length > 0 ? 'bookSetContainer:' + c.children.length : '';
    var r = document.getElementById('root');
    if (r) return r.children.length > 0 ? 'root:' + r.children.length : '';
    return document.body && document.body.children.length > 0 ? 'body:' + document.body.children.length : '';
  }
  function son(sonuc) {
    if (bitti) return; bitti = true;
    try { gozcu && gozcu.disconnect(); } catch (e) {}
    requestAnimationFrame(function () { requestAnimationFrame(function () { bitir(sonuc); }); });
  }
  var gozcu = null;
  var ilk = hazirMi();
  if (ilk) { son(ilk); return; }
  try {
    gozcu = new MutationObserver(function () { var h = hazirMi(); if (h) son(h); });
    gozcu.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  setTimeout(function () { son('zaman-asimi'); }, ${Math.floor(zamanAsimiMs)});
})`;
}

/**
 * Günlükçü kurar. `app` verilmezse electron'dan alınır. Döner: { yaz, dosya }.
 * Test için `app`, `fsMod`, `simdi`, `baslangic` enjekte edilebilir.
 */
function gunlukcuKur({ app, fsMod = fs, simdi = () => Date.now(), baslangic } = {}) {
  let dosya = null;
  try {
    const kok = app.getPath('userData');
    fsMod.mkdirSync(kok, { recursive: true });
    dosya = path.join(kok, DOSYA_ADI);
    try {
      const d = fsMod.statSync(dosya);
      if (d.size > AZAMI_BOYUT) fsMod.renameSync(dosya, `${dosya}.1`);
    } catch (e) { /* ilk kez */ }
  } catch (e) {
    dosya = null;
  }
  const t0 = Number.isFinite(baslangic) ? baslangic : surecBaslangici();
  function yaz(evre, ayrinti, an) {
    if (!dosya) return false;
    try {
      fsMod.appendFileSync(dosya, satirUret({ an: an == null ? simdi() : an, baslangic: t0, evre, ayrinti }));
      return true;
    } catch (e) {
      return false;
    }
  }
  return { yaz, dosya, baslangic: t0 };
}

let etkin = null;

/**
 * Ana süreç kancaları. İdempotent: ikinci çağrı ilk günlükçüyü döndürür.
 * @param {{kok?:string, electron?:object, env?:object}} secenekler
 */
function baslat(secenekler = {}) {
  if (etkin) return etkin;
  const electron = secenekler.electron || require('electron');
  const { app } = electron;
  const env = secenekler.env || process.env;
  const g = gunlukcuKur({ app });
  etkin = g;
  if (!g.dosya) return g;

  let surum = '?';
  try { surum = app.getVersion(); } catch (e) { /* yok */ }
  g.yaz('süreç başladı', `sürüm ${surum} | exe ${process.execPath}`, g.baslangic);
  g.yaz('mimari', mimariOzeti(env));
  g.yaz('ana betik yüklendi', `userData ${path.dirname(g.dosya)}`);

  try {
    app.once('ready', () => g.yaz('app ready'));
  } catch (e) { /* yok */ }

  let pencereSayisi = 0;
  let menuIstendi = false;
  let yuklemeSayisi = 0;
  try {
    app.on('browser-window-created', (_olay, pencere) => {
      pencereSayisi += 1;
      const no = pencereSayisi;
      g.yaz('pencere oluştu', `pencere ${no}`);
      try {
        pencere.once('ready-to-show', () => g.yaz('ready-to-show', `pencere ${no}`));
        pencere.once('show', () => g.yaz('gösterildi', `pencere ${no}`));
        const wc = pencere.webContents;
        wc.on('did-finish-load', () => {
          yuklemeSayisi += 1;
          if (yuklemeSayisi > 20) return;
          let adres = '';
          try { adres = decodeURI(wc.getURL()).replace(/^.*[\\/]resources[\\/]app[\\/]/i, ''); } catch (e) { /* yok */ }
          g.yaz('did-finish-load', `pencere ${no} ${adres}`);
          if (menuIstendi) return;
          menuIstendi = true;
          try {
            wc.executeJavaScript(menuBekleyiciKodu(), false)
              .then((sonuc) => g.yaz(sonuc === 'zaman-asimi' ? 'menü çizilmedi (120 sn)' : 'menü çizildi', String(sonuc)))
              .catch((e) => g.yaz('menü ölçülemedi', e && e.message));
          } catch (e) {
            g.yaz('menü ölçülemedi', e && e.message);
          }
        });
        wc.once('render-process-gone', (_e, ayr) => g.yaz('renderer düştü', ayr && ayr.reason));
      } catch (e) { /* ölçüm kancası kurulamadı — uygulama etkilenmez */ }
    });
  } catch (e) { /* yok */ }

  try { app.once('will-quit', () => g.yaz('kapanıyor')); } catch (e) { /* yok */ }
  return g;
}

/** Başka çalışma anı modüllerinin (ör. İmpark kaldırıcı) aynı dosyaya yazması için. */
function yaz(evre, ayrinti) {
  return etkin ? etkin.yaz(evre, ayrinti) : false;
}

function _sifirla() { etkin = null; }

module.exports = {
  DOSYA_ADI,
  ISARET,
  AZAMI_BOYUT,
  MENU_ZAMAN_ASIMI_MS,
  surecBaslangici,
  satirUret,
  mimariOzeti,
  menuBekleyiciKodu,
  gunlukcuKur,
  baslat,
  yaz,
  _sifirla,
};
