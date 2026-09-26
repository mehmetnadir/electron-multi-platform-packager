'use strict';
/**
 * Kabul koşumunun preload'ı. Paketlerin kendi `main.js`'i `contextIsolation:false`
 * kullanır; bu yüzden bu betik SAYFAYLA AYNI dünyada, sayfa betiklerinden ÖNCE koşar.
 *
 * Görevi: sayfanın ODAK ÇALABİLECEK ya da makineye DOKUNABİLECEK her yolunu kesmek.
 *   • alert/confirm/prompt → yerel modal diyalog açar (odak çalar) → konsola yazılır.
 *   • shell.openExternal / openPath / showItemInFolder → tarayıcı/Finder öne gelir → yutulur.
 *   • Node http/https → yayıncı güncellemesi yüzlerce MB indirebilir → ağ kapalıyken
 *     (varsayılan) istek anında 'error' olayıyla düşer, tıpkı ağsız bir tahtadaki gibi.
 * Yakalanmayan hatalar ve reddedilen promise'ler konsola `[kabul]` önekiyle düşer;
 * ana süreç `console-message` ile toplar.
 */
/* eslint-disable no-console */
(function kabulPreload() {
  const yaz = (m) => { try { console.warn(`[kabul] ${m}`); } catch (_) { /* yok */ } };
  window.alert = (m) => { yaz(`alert bastırıldı: ${String(m).slice(0, 200)}`); };
  window.confirm = (m) => { yaz(`confirm bastırıldı: ${String(m).slice(0, 200)}`); return false; };
  window.prompt = (m) => { yaz(`prompt bastırıldı: ${String(m).slice(0, 200)}`); return null; };
  window.print = () => { yaz('print bastırıldı'); };

  try {
    // eslint-disable-next-line global-require
    const { shell } = require('electron');
    if (shell) {
      shell.openExternal = async (u) => { yaz(`openExternal engellendi: ${u}`); };
      shell.openPath = async (p) => { yaz(`openPath engellendi: ${p}`); return ''; };
      shell.showItemInFolder = (p) => { yaz(`showItemInFolder engellendi: ${p}`); };
      shell.beep = () => {};
    }
  } catch (_) { /* electron modülü yoksa (olmamalı) sessizce geç */ }

  if (process.env.EMPP_KABUL_AG_KAPALI === '1') {
    try {
      // eslint-disable-next-line global-require
      const { EventEmitter } = require('events');
      const sahteIstek = (modAd) => function engelliIstek(...args) {
        const hedef = args.find((a) => typeof a === 'string' || (a && typeof a === 'object' && (a.host || a.hostname || a.href)));
        const ad = typeof hedef === 'string' ? hedef : (hedef && (hedef.href || hedef.hostname || hedef.host)) || '?';
        yaz(`ağ isteği engellendi (node ${modAd}): ${String(ad).slice(0, 160)}`);
        const istek = new EventEmitter();
        istek.end = () => istek;
        istek.write = () => true;
        istek.abort = () => {};
        istek.destroy = () => istek;
        istek.setTimeout = () => istek;
        istek.setHeader = () => {};
        istek.setNoDelay = () => {};
        process.nextTick(() => {
          const hata = new Error('EMPP kabul: ağ kapalı');
          hata.code = 'ENETUNREACH';
          if (istek.listenerCount('error')) istek.emit('error', hata);
          else yaz(`engellenen isteğin 'error' dinleyicisi yok (${modAd})`);
        });
        return istek;
      };
      for (const modAd of ['http', 'https']) {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const mod = require(modAd);
        mod.request = sahteIstek(modAd);
        mod.get = sahteIstek(modAd);
      }
    } catch (e) {
      yaz(`node ağ kesici kurulamadı: ${e && e.message}`);
    }
  }

  // Yakalama evresinde dinlenir: <script>/<img>/<link> yükleme hataları kabarcıklanmaz,
  // yalnız yakalama evresinde pencereye ulaşır. file:// kaynağı yüklenemediyse bu,
  // Chromium'un konsola HER ZAMAN yazmadığı ERR_FILE_NOT_FOUND'un kendisidir
  // (73768 bozuk DMG: kök app.config.js yok → konsolda yalnız "AppConfig is not defined").
  window.addEventListener('error', (e) => {
    try {
      const hedef = e && e.target;
      const kaynak = hedef && hedef !== window && (hedef.src || hedef.href || hedef.currentSrc);
      if (kaynak) {
        const tur = String(kaynak).startsWith('file:') ? 'net::ERR_FILE_NOT_FOUND' : 'kaynak yüklenemedi';
        console.error(`[kabul] ${tur}: <${(hedef.tagName || '?').toLowerCase()}> ${kaynak}`);
        return;
      }
      console.error(`[kabul] window.onerror: ${e.message} @ ${e.filename || '?'}:${e.lineno || '?'}`);
    } catch (_) { /* yok */ }
  }, true);
  window.addEventListener('unhandledrejection', (e) => {
    try {
      const r = e.reason;
      console.error(`[kabul] unhandledrejection: ${(r && (r.message || r.stack)) || r}`);
    } catch (_) { /* yok */ }
  });
}());
