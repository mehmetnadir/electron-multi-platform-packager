/*
 * EMPP — Açılış ağ politikası (K21)
 *
 * NEDEN (2026-09-19, gerçek paket üzerinde ölçüldü — sm4/book1):
 *   3 nokta ekranı 1048–1104 ms sürüyor ve bunun ~%91'i AĞ beklemesi. Ölçülen zincir:
 *     101→ 603 (502ms) https://www.sorucoz.tv            <- canlılık probu
 *     615→ 726 (111ms) GetPackageBooks?id=undefined      <- HER ZAMAN HTTP 500
 *     727→ 841 (114ms) HasZKitapKey?kitapId=45516
 *     844→1097 (253ms) https://www.sorucoz.tv            <- ikinci prob
 *     927→1051 (124ms) GetKitapGuncellemeBilgi
 *   Aynı paket ağ kapalıyken 318 ms'de ve BİREBİR aynı ekranla açılıyor.
 *
 * Bu dosya motorun kodunu DEĞİŞTİRMEZ; yalnız `window.fetch`i sarar ve iki
 * tartışmasız israfı keser:
 *
 *  1) 'engelle' — sorgusunda `undefined`/`null` DEĞERİ olan istek.
 *     Sunucu bunlara determinist olarak HTTP 500 + HTML döner ("The parameters
 *     dictionary contains a null entry for parameter 'id'"). Motor zaten
 *     `.json()` üzerinde patlayıp catch'e düşüyor — biz sadece 111 ms erken
 *     düşürüyoruz. Davranış aynı, süre eksik.
 *
 *  2) 'zamanasimi' — çıplak köke atılan canlılık probu.
 *     Motorun kendi kodu `fetch(url, {method:"HEAD", mode:"no-cors", timeout:5e3})`
 *     yazıyor; fakat `timeout` fetch'te BİR SEÇENEK DEĞİLDİR, sessizce yok sayılır.
 *     Yani "5 sn" hiç uygulanmıyor: karadelik bir ağda (okul filtresi, kopuk VPN)
 *     prob işletim sisteminin TCP zaman aşımını bekler ve açılış dakikalarca asılır.
 *     Burada AbortController ile motorun KENDİ beyan ettiği 5000 ms uygulanır.
 *     Yeni bir politika değil — yazılmış ama çalışmayan niyetin infazı.
 *
 * Kesin olarak YAPMADIĞI: HasZKitapKey / IsZKitapKurumAktif / GetKitapGuncellemeBilgi
 * çağrılarına dokunmaz. Onlar ürün kararıdır, ölçüm değil.
 */
(function () {
  'use strict';
  var PROB_MS = 5000; // motorun kendi beyanı: timeout: 5e3

  function sorguTanimsizMi(sorgu) {
    if (!sorgu) return false;
    var parcalar = String(sorgu).replace(/^\?/, '').split('&');
    for (var i = 0; i < parcalar.length; i++) {
      var esit = parcalar[i].indexOf('=');
      if (esit < 0) continue;
      var deger = parcalar[i].slice(esit + 1).toLowerCase();
      if (deger === 'undefined' || deger === 'null') return true;
    }
    return false;
  }

  // Saf karar fonksiyonu — ağ yok, yan etki yok, testte doğrudan çağrılır.
  function kararVer(url, init) {
    var u = (url === null || url === undefined) ? '' : String(url);
    if (!/^https?:\/\//i.test(u)) return { eylem: 'gecir', sebep: 'yerel' };

    var kalan = u.replace(/^https?:\/\//i, '');
    var egikCizgi = kalan.indexOf('/');
    var yol = egikCizgi < 0 ? '' : kalan.slice(egikCizgi);
    var diyez = yol.indexOf('#');
    if (diyez >= 0) yol = yol.slice(0, diyez);
    var soru = yol.indexOf('?');
    var sorgu = soru < 0 ? '' : yol.slice(soru + 1);
    var salt = soru < 0 ? yol : yol.slice(0, soru);

    if (sorguTanimsizMi(sorgu)) {
      return { eylem: 'engelle', sebep: 'tanimsiz-parametre' };
    }
    if (salt === '' || salt === '/') {
      return { eylem: 'zamanasimi', sebep: 'canlilik-probu', ms: PROB_MS };
    }
    return { eylem: 'gecir', sebep: 'normal' };
  }

  function kur(win) {
    if (!win || typeof win.fetch !== 'function') return false;
    if (win.fetch.__emppAg) return false;
    var asil = win.fetch;
    var AC = win.AbortController;

    var sarmal = function (girdi, ayar) {
      var url = (girdi && typeof girdi === 'object' && 'url' in girdi) ? girdi.url : girdi;
      var karar;
      try { karar = kararVer(url, ayar); } catch (e) { karar = { eylem: 'gecir', sebep: 'karar-hatasi' }; }

      if (karar.eylem === 'engelle') {
        return Promise.reject(new TypeError('EMPP ag-politikasi: ' + karar.sebep));
      }

      // Çağıran kendi signal'ini verdiyse ona DOKUNMA (sahibi o).
      var signalVar = !!(ayar && ayar.signal);
      if (karar.eylem === 'zamanasimi' && AC && !signalVar) {
        var kontrol = new AC();
        var yeniAyar = {};
        if (ayar) for (var k in ayar) if (Object.prototype.hasOwnProperty.call(ayar, k)) yeniAyar[k] = ayar[k];
        yeniAyar.signal = kontrol.signal;
        var sayac = win.setTimeout(function () { try { kontrol.abort(); } catch (e) {} }, karar.ms);
        var bitir = function () { try { win.clearTimeout(sayac); } catch (e) {} };
        return asil.call(this, girdi, yeniAyar).then(
          function (y) { bitir(); return y; },
          function (h) { bitir(); throw h; }
        );
      }
      return asil.apply(this, arguments);
    };
    sarmal.__emppAg = true;
    win.fetch = sarmal;
    return true;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { kararVer, kur };
  if (typeof window !== 'undefined' && typeof window.document !== 'undefined') kur(window);
})();
