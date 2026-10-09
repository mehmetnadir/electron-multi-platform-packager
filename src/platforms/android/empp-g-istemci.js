/* eslint-disable */
/**
 * EMPP G — ANDROID UZAKTAN GÜNCELLEME İSTEMCİSİ (WebView'da koşar; politika katmanı).
 *
 * Sözleşme: `.claude/docs/platform-kanallari-sozlesmesi.md` O3/O4 + "Android G katmanı".
 * Nadir (2026-09-26): "Tüm paketlerde bizim güncelleme istemcimiz (G kanalı) olacak." G ile
 * uzaktan değişenler: (a) kök `index.html` (bizim set menümüz — menü kabuğu tek kaynaktan:
 * `src/packaging/set-kabuk.js`), (b) eklenen/çıkarılan kitaplar (set bileşimi), (c) her kitabın
 * ana klasöründeki `bookN/43e23fce2b7009474555a77.js` (etkinlik kopyaları KAPSAM DIŞI).
 *
 * KATMANLAR:
 *   • Bu dosya: yapılandırma, iki kademe (surum.json → manifest), ed25519 İMZA, kapsam, plan.
 *   • Yerel eklenti `EmppG` (Java, `g-java/`): https getir, sha256 doğrulayarak hazırlığa yaz,
 *     kitap arşivini indir+aç, ATOMİK uygula. WebView istekleri `EmppGRota` ile önce yazılabilir
 *     katmandan (`filesDir/empp-g`), yoksa APK'dan cevaplanır.
 *
 * KURALLAR (ihlali arıza sayılır):
 *   • Açılışı bloklamaz (shim bu dosyayı sayfa açıldıktan ~10 sn sonra yükler).
 *   • Manifest yok (404) / ağ hatası / bozuk JSON → HİÇBİR ŞEY yapılmaz, uygulama sürer.
 *   • İmzasız ya da imzası tutmayan manifest REDDEDİLİR (G4). İmza: önce WebCrypto Ed25519,
 *     tarayıcı desteklemiyorsa gömülü tweetnacl 1.0.3 (Cure53 denetimli; `empp-g-nacl.js`).
 *   • Varsayılan RET: kapsam dışı tek girdi, bozuk alan, yinelenen yol → TÜM güncelleme reddedilir.
 *   • Android bekçisi: yeni kök `index.html` ve eklenen kitabın `index.html`i
 *     `empp-android-shim.js`'i çağırmıyorsa RET (yoksa G kendi kendini paketten koparır).
 *   • Uç: `<taban>/set/<kimlik>/android/{surum.json, manifest.json, manifest.json.sig, dosya/…}`
 *     — Android içeriği platforma uyarlanmış ağaçtan (www) üretilir; Windows manifesti Android'e
 *     uygulanmaz.
 *   • Hiçbir istisna dışarı sızmaz.
 *
 * ÜÇ GÜVENLİK KURALI (2026-09-26 — Electron istemcisi `kitap-guncelleyici.js` e07bc37 ile AYNI):
 *   1. MONOTON SÜRÜM. İmzası doğru manifest de ancak `surum` G3 biçiminde (`2.<panel>.<sayaç>`)
 *      ve KURULU sürümden KESİN BÜYÜKse uygulanır. Kurulu = max(paketin sürümü
 *      [`empp-g-paket.json`], son uygulanan G [katman durumu]); G3 olmayan paket sürümü
 *      (içerik-hash) kıyasa girmez. APK değişince eski katman zaten atılır (ikili kimliği).
 *      `surum.json` imzasız TETİKTİR: kurulu sürümden büyük değilse manifest hiç istenmez.
 *   2. KİMLİK. `kanal == "G"` ve `setKimligi == gömülü kimlik` değilse RET (başka setin
 *      imzalı manifesti bu pakete uygulanmaz). `surum.json` başka seti söylüyorsa manifest istenmez.
 *   3. YA HEP YA HİÇ. Her şey önce yerel hazırlık alanına iner ve doğrulanır (boyut burada,
 *      sha256 + arşiv açma yerel tarafta); TEK hata → `uygula` HİÇ çağrılmaz, canlı katmana
 *      dokunulmaz. Kesinleşme tek `uygula` çağrısı = yerelde tek `durum.txt` rename'i.
 */
(function (kok, fabrika) {
  var m = fabrika();
  if (typeof module !== 'undefined' && module.exports) module.exports = m;
  if (kok && kok.document) {
    kok.__emppGIstemci = m;
    m.baslat(kok);
  }
})(typeof window !== 'undefined' ? window : undefined, function () {
  'use strict';

  var ISARET = '[EMPP_G]';
  var PLATFORM = 'android';
  var MOTOR_ADI = '43e23fce2b7009474555a77.js';
  var SHIM_ADI = 'empp-android-shim.js';
  /** Kökte `empp-` önekli dosyalar bizim çalışma zamanımızdır (shim, manifest, G) — G bunları değiştirmez. */
  var PLATFORM_DOSYASI_RE = /^empp-/;
  var SHA256_RE = /^[0-9a-f]{64}$/i;
  var KABUK_TAVANI = 64 * 1024 * 1024;
  var SON_ANAHTARI = 'empp_g_son';
  var ARALIK = 30 * 60 * 1000;
  var IMZA_UZANTI = '.sig';
  /** Ed25519 SPKI DER öneki (RFC 8410): 12 bayt + 32 bayt ham anahtar. */
  var SPKI_ONEK = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
  /** G kanalının adı — manifestte `kanal` alanı (sözleşme G3/G4). */
  var KANAL = 'G';
  /** G3 sürümü `2.<panel>.<sayaç>` — tools/g-yayin/g-surum.js ve Electron istemcisiyle AYNI desen. */
  var G_SURUM_RE = /^2\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

  /* ------------------------------------------------------------- yardımcılar */

  function b64Coz(s) {
    var ham = atob(String(s));
    var u = new Uint8Array(ham.length);
    for (var i = 0; i < ham.length; i++) u[i] = ham.charCodeAt(i);
    return u;
  }
  function utf8(u) { return new TextDecoder('utf-8').decode(u); }
  function adresGuvenliMi(a) {
    try {
      var u = new URL(String(a));
      return u.protocol === 'https:' && !!u.hostname;
    } catch (e) { return false; }
  }
  function kimlikKoku(taban, kimlik) {
    return String(taban).replace(/\/+$/, '') + '/set/' + encodeURIComponent(kimlik) + '/' + PLATFORM;
  }
  function dosyaAdresi(kokAdres, yol) {
    return kokAdres + '/dosya/' + String(yol).split('/').map(encodeURIComponent).join('/');
  }
  function Bitis(durum, sebep) { this.durum = durum; this.sebep = sebep; }

  /* ------------------------------------------------------------ yapılandırma */

  /** `empp-set.json` → tek biçim. Kimlik yoksa `null` kalır (sessiz düşürme yok). */
  function setiNormalize(veri) {
    var n = (veri && typeof veri === 'object' && !Array.isArray(veri)) ? veri : {};
    var imza = (n.imza && typeof n.imza === 'object') ? n.imza : {};
    return {
      setKimligi: (n.setKimligi == null || n.setKimligi === '') ? null : String(n.setKimligi),
      taban: typeof n.taban === 'string' ? n.taban.trim() : '',
      imzaAnahtari: (imza.alg === 'ed25519' && typeof imza.acikAnahtar === 'string') ? imza.acikAnahtar.trim() : '',
      sebep: typeof n.sebep === 'string' ? n.sebep : ''
    };
  }

  /** Pakete gömülü `empp-g-paket.json` metni → paketin sürümü (yoksa/bozuksa `null`). */
  function paketSurumuCoz(metin) {
    if (typeof metin !== 'string' || !metin) return null;
    try {
      var n = JSON.parse(metin);
      return (n && typeof n.surum === 'string' && n.surum.trim()) ? n.surum.trim() : null;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------ sürüm + kimlik (kural 1-2) */

  /** `"2.51.4"` → `{panel:51, sayac:4}`; G3 biçimi dışındaysa `null`. */
  function gSurumCoz(s) {
    if (typeof s !== 'string') return null;
    var m = G_SURUM_RE.exec(s.trim());
    return m ? { panel: Number(m[1]), sayac: Number(m[2]) } : null;
  }

  /** a<b → -1, a=b → 0, a>b → 1; biri G3 değilse `null` (kıyaslanamaz). */
  function gSurumKiyasla(a, b) {
    var x = gSurumCoz(a);
    var y = gSurumCoz(b);
    if (!x || !y) return null;
    if (x.panel !== y.panel) return x.panel < y.panel ? -1 : 1;
    if (x.sayac !== y.sayac) return x.sayac < y.sayac ? -1 : 1;
    return 0;
  }

  /** Listedeki en büyük G3 sürümü; hiç yoksa `null`. Biçim dışılar (içerik-hash vb.) yok sayılır. */
  function enBuyukGSurum(liste) {
    var en = null;
    for (var i = 0; i < (liste || []).length; i++) {
      var s = liste[i];
      if (!gSurumCoz(s)) continue;
      if (en === null || gSurumKiyasla(s, en) > 0) en = s.trim();
    }
    return en;
  }

  /**
   * İmzası doğrulanmış manifestin KİMLİK denetimi. '' → kabul, aksi → red kodu.
   * @param {object} n            ayrıştırılmış manifest
   * @param {string} setKimligi   paketin gömülü kimliği
   * @param {string|null} kurulu  kurulu sürüm (paket ya da son uygulanan G); `null` → ilk G
   */
  function manifestKimligiDenetle(n, setKimligi, kurulu) {
    if (!n || typeof n !== 'object' || Array.isArray(n)) return 'manifest-gecersiz';
    if (n.kanal !== KANAL) return 'kanal-g-degil';
    var mk = (n.setKimligi == null || n.setKimligi === '') ? null : String(n.setKimligi);
    if (mk === null || setKimligi == null || mk !== String(setKimligi)) return 'baska-set';
    if (!gSurumCoz(n.surum)) return 'surum-bicimi';
    if (kurulu && gSurumCoz(kurulu) && gSurumKiyasla(n.surum, kurulu) <= 0) return 'surum-eski';
    return '';
  }

  /* -------------------------------------------------------------------- imza */

  /** SPKI DER (44 bayt) → ham 32 bayt Ed25519 anahtarı; başka her şey `null`. */
  function hamAcikAnahtar(der) {
    if (!der || der.length !== 44) return null;
    for (var i = 0; i < SPKI_ONEK.length; i++) if (der[i] !== SPKI_ONEK[i]) return null;
    return der.subarray(12);
  }

  /**
   * WebCrypto Ed25519 ile doğrular. `true/false` = kesin karar; `null` = bu WebView Ed25519'u
   * DESTEKLEMİYOR (importKey/verify atıldı) → gömülü doğrulayıcıya geçilir.
   */
  function webcryptoDogrula(subtle, der, imza, govde) {
    if (!subtle || typeof subtle.importKey !== 'function') return Promise.resolve(null);
    var alg = { name: 'Ed25519' };
    return Promise.resolve().then(function () {
      return subtle.importKey('spki', der, alg, false, ['verify']);
    }).then(function (k) {
      return subtle.verify(alg, k, imza, govde);
    }).then(function (s) { return s === true; }, function () { return null; });
  }

  /** WebView'ın Ed25519 desteğini ÖLÇER (kendi ürettiği anahtarla değil, gömülü anahtarı içe alarak). */
  function webcryptoOlc(subtle, acikAnahtarB64) {
    if (!subtle || typeof subtle.importKey !== 'function') return Promise.resolve({ destek: false, sebep: 'subtle-yok' });
    var der;
    try { der = b64Coz(acikAnahtarB64); } catch (e) { return Promise.resolve({ destek: false, sebep: 'anahtar-cozulemedi' }); }
    return Promise.resolve().then(function () {
      return subtle.importKey('spki', der, { name: 'Ed25519' }, false, ['verify']);
    }).then(function () { return { destek: true, sebep: '' }; },
      function (e) { return { destek: false, sebep: (e && (e.name || e.message)) || 'importKey-atti' }; });
  }

  /**
   * Manifestin HAM baytları üzerindeki imza. Hiç atmaz.
   * @returns {Promise<{gecerli:boolean, yol:string|null, sebep:string}>}
   */
  function imzaDogrula(govde, imzaMetni, anahtarB64, ortam) {
    var o = ortam || {};
    var temiz = String(imzaMetni == null ? '' : imzaMetni).trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(temiz)) return Promise.resolve({ gecerli: false, yol: null, sebep: 'imza-bicimi' });
    var imza, der, ham;
    try { imza = b64Coz(temiz); der = b64Coz(anahtarB64); } catch (e) {
      return Promise.resolve({ gecerli: false, yol: null, sebep: 'base64' });
    }
    if (imza.length !== 64) return Promise.resolve({ gecerli: false, yol: null, sebep: 'imza-boyu' });
    ham = hamAcikAnahtar(der);
    if (!ham) return Promise.resolve({ gecerli: false, yol: null, sebep: 'anahtar-gecersiz' });
    return webcryptoDogrula(o.subtle, der, imza, govde).then(function (karar) {
      if (karar !== null) return { gecerli: karar, yol: 'webcrypto', sebep: karar ? '' : 'imza-tutmadi' };
      if (typeof o.naclYukle !== 'function') return { gecerli: false, yol: null, sebep: 'dogrulayici-yok' };
      return Promise.resolve().then(o.naclYukle).then(function (nacl) {
        if (!nacl || !nacl.sign || !nacl.sign.detached || typeof nacl.sign.detached.verify !== 'function') {
          return { gecerli: false, yol: null, sebep: 'dogrulayici-yok' };
        }
        var s = nacl.sign.detached.verify(govde, imza, ham) === true;
        return { gecerli: s, yol: 'tweetnacl', sebep: s ? '' : 'imza-tutmadi' };
      }, function () { return { gecerli: false, yol: null, sebep: 'dogrulayici-yuklenemedi' }; });
    });
  }

  /* ------------------------------------------------------------------ kapsam */

  /**
   * 'kapsam'  → G değiştirir: menü kabuğu (`set-kabuk.kabukYoluMu`) ya da `bookN/43e23…js`.
   * 'platform'→ kökteki `empp-*` (çalışma zamanımız) — sessizce ATLANIR, güncellemeyi düşürmez.
   * 'disi'    → başka her şey (kitap içi, `classlibraries/`, `assets/`, kaçış) — TÜM güncelleme RET.
   */
  function kapsamSinifi(yol, kabuk) {
    if (typeof yol !== 'string' || !kabuk.yolGuvenliMi(yol)) return 'disi';
    if (kabuk.yolNormalle(yol) !== yol) return 'disi';
    var p = yol.split('/');
    if (p.length === 1 && PLATFORM_DOSYASI_RE.test(p[0])) return 'platform';
    if (p.length === 2 && kabuk.KITAP_DIZIN_DESENI.test(p[0]) && p[1] === MOTOR_ADI) return 'kapsam';
    return kabuk.kabukYoluMu(yol) ? 'kapsam' : 'disi';
  }

  function tamSayiMi(x) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x && x >= 0; }

  /** Manifest gövdesi → plan. Tek kusur → `{red}` (varsayılan RET). */
  function planKur(n, kabuk) {
    if (!n || typeof n !== 'object' || Array.isArray(n)) return { red: 'manifest-gecersiz' };
    if (typeof n.surum !== 'string' || !n.surum.trim()) return { red: 'manifest-surum-yok' };
    if (!Array.isArray(n.kabuk)) return { red: 'manifest-kabuk-yok' };
    var kitaplarHam = Array.isArray(n.kitaplar) ? n.kitaplar : [];
    var plan = { surum: n.surum.trim(), kabuk: [], platform: [], ekle: [], cikar: [], atlanan: [] };
    var dizinler = {};
    for (var i = 0; i < kitaplarHam.length; i++) {
      var k = kitaplarHam[i];
      if (!k || typeof k.dizin !== 'string' || !kabuk.KITAP_DIZIN_DESENI.test(k.dizin)) return { red: 'uyelik-dizini-gecersiz' };
      if (dizinler[k.dizin]) return { red: 'uyelik-yinelenen:' + k.dizin };
      dizinler[k.dizin] = k.durum;
      if (k.durum === 'cikar') { plan.cikar.push(k.dizin); continue; }
      if (k.durum !== 'ekle') return { red: 'uyelik-durumu-gecersiz:' + k.dizin };
      // 09.10 (kalıcı donma gerekçesi): Android istemcisinde Electron alanları (kaynak, sha256, boyut) yerine
      // Android özel arşiv alanları (androidKaynak, androidSha256, androidBoyut) beklenir.
      // Alan eksikse indirme başlamadan o kitap ATLANIR (plan.atlanan → rapor.atlanan, günlükte görünür);
      // atlanan ekleme manifestin diğer kısımlarını (motor/kabuk düzeltmeleri) ENGELLEMEZ (kalıcı donma kırılır).
      // BİLİNÇLİ SONUÇ: `uygula` manifest sürümünü damgalar → aynı sürüm bir daha istenmez; atlanan kitap
      // ancak yayıncı Android alanlı YENİ bir sürüm yayınlayınca kurulur (sessiz değil, raporda `atlanan`).
      // Bu dal da imza doğrulamasından SONRA çalışır (planKur yalnız doğrulanmış ham baytlardan çağrılır).
      if (!k.androidKaynak || !k.androidSha256 || k.androidBoyut == null) {
        plan.atlanan.push('android-arsivi-eksik:' + k.dizin);
        continue;
      }
      if (!adresGuvenliMi(k.androidKaynak)) return { red: 'uyelik-kaynak-https-degil:' + k.dizin };
      if (typeof k.androidSha256 !== 'string' || !SHA256_RE.test(k.androidSha256) || !tamSayiMi(k.androidBoyut)) {
        return { red: 'uyelik-ozet-boyut:' + k.dizin };
      }
      plan.ekle.push({ dizin: k.dizin, kaynak: k.androidKaynak, sha256: k.androidSha256.toLowerCase(), boyut: k.androidBoyut });
    }
    var goruldu = {};
    for (var j = 0; j < n.kabuk.length; j++) {
      var g = n.kabuk[j];
      if (!g || typeof g.yol !== 'string' || typeof g.sha256 !== 'string' || !SHA256_RE.test(g.sha256)
        || !tamSayiMi(g.boyut) || g.boyut > KABUK_TAVANI) {
        return { red: 'kabuk-girdisi-bozuk:' + (g && g.yol) };
      }
      if (goruldu[g.yol]) return { red: 'kabuk-yinelenen:' + g.yol };
      goruldu[g.yol] = 1;
      var sinif = kapsamSinifi(g.yol, kabuk);
      if (sinif === 'disi') return { red: 'kapsam-disi:' + g.yol };
      if (sinif === 'platform') { plan.platform.push(g.yol); continue; }
      var dal = g.yol.indexOf('/') > 0 ? g.yol.split('/')[0] : '';
      if (dal && dizinler[dal] === 'cikar') return { red: 'cikarilan-kitabin-motoru:' + g.yol };
      plan.kabuk.push({ yol: g.yol, sha256: g.sha256.toLowerCase(), boyut: g.boyut });
    }
    return plan;
  }

  /** Android bekçisi: sayfa `empp-android-shim.js`'i script olarak çağırıyor mu? */
  function androidSayfasiMi(html) {
    return /<script\b[^>]*\bsrc\s*=\s*["']?[^"'>]*empp-android-shim\.js/i.test(String(html || ''));
  }

  /* --------------------------------------------------------------- ana akış */

  function bosRapor() {
    return {
      platform: PLATFORM, setKimligi: null, durum: 'atlandi', sebep: '', istek: 0, imzaYolu: null, kuruluSurum: null,
      kabukIndirilen: 0, kabukAyni: 0, platformAtlanan: 0, eklenen: [], atlanan: [], cikarilan: [], surum: null, hata: ''
    };
  }

  /**
   * Tek koşu. **Hiç atmaz.** `o.yerel` = EmppG köprüsü (testte sahte); `o.kabuk` = set-kabuk modülü.
   * @returns {Promise<object>} rapor
   */
  function guncellemeyiCalistir(o) {
    var rapor = bosRapor();
    var yerel = o && o.yerel;
    var kabuk = o && o.kabuk;
    var gunluk = (o && typeof o.gunluk === 'function') ? o.gunluk : function () {};
    var set, kokAdres, uzakSurum, manifestHam, plan, paketSurumu, kurulu;

    function getir(adres, tavan) {
      rapor.istek += 1;
      return Promise.resolve(yerel.getir({ adres: adres, tavan: tavan || 0 }));
    }

    return Promise.resolve().then(function () {
      if (!yerel || !kabuk) throw new Bitis('kapali', 'yerel-kopru-ya-da-kabuk-yok');
      return yerel.yapilandirma();
    }).then(function (y) {
      var ham;
      try { ham = JSON.parse(y && y.metin); } catch (e) { throw new Bitis('kapali', 'empp-set-json-okunamadi'); }
      set = setiNormalize(ham);
      paketSurumu = paketSurumuCoz(y && y.paket);
      rapor.setKimligi = set.setKimligi;
      if (set.setKimligi == null) throw new Bitis('kapali', 'set-kimligi-yok' + (set.sebep ? ' (' + set.sebep + ')' : ''));
      if (!/^[A-Za-z0-9._:-]{1,64}$/.test(set.setKimligi)) throw new Bitis('kapali', 'set-kimligi-gecersiz');
      if (!adresGuvenliMi(set.taban)) throw new Bitis('kapali', 'taban-https-degil');
      if (!hamAcikAnahtar((function () { try { return b64Coz(set.imzaAnahtari); } catch (e) { return null; } })())) {
        throw new Bitis('kapali', 'imza-anahtari-yok');
      }
      kokAdres = kimlikKoku(set.taban, set.setKimligi);
      return yerel.durum();
    }).then(function (d) {
      var yerelSurum = d && typeof d.surum === 'string' ? d.surum : null;
      // Kural 1: KURULU = max(paket sürümü, son uygulanan G). Katman eski APK'ya aitse yerel
      // taraf onu zaten atmıştır (ikili kimliği) — burada görülen sürüm bu APK'nındır.
      kurulu = enBuyukGSurum([yerelSurum, paketSurumu]);
      rapor.kuruluSurum = kurulu;
      return getir(kokAdres + '/surum.json', 64 * 1024).then(function (s) {
        if (!s || s.durum !== 200 || typeof s.b64 !== 'string') throw new Bitis('atlandi', 'surum-alinamadi:durum-' + (s ? s.durum : 'yok'));
        var j;
        try { j = JSON.parse(utf8(b64Coz(s.b64))); } catch (e) { throw new Bitis('atlandi', 'surum-json-bozuk'); }
        if (!j || typeof j.surum !== 'string' || !j.surum.trim()) throw new Bitis('atlandi', 'surum-alani-yok');
        uzakSurum = j.surum.trim();
        rapor.surum = uzakSurum;
        // Kural 2 (tetik): surum.json başka seti söylüyorsa manifest hiç istenmez.
        if (j.setKimligi != null && j.setKimligi !== '' && String(j.setKimligi) !== set.setKimligi) {
          throw new Bitis('atlandi', 'uzak-baska-set');
        }
        if (yerelSurum && yerelSurum === uzakSurum) throw new Bitis('guncel', 'surum-ayni');
        // Kural 1 (tetik): kurulu sürümden KESİN büyük olmayan uç için manifest hiç istenmez.
        if (kurulu && gSurumCoz(uzakSurum) && gSurumKiyasla(uzakSurum, kurulu) <= 0) {
          throw new Bitis('guncel', 'uzak-surum-buyuk-degil');
        }
      }, function (e) {
        if (e instanceof Bitis) throw e;
        throw new Bitis('atlandi', 'surum-alinamadi:' + ((e && e.message) || 'ag'));
      });
    }).then(function () {
      return getir(kokAdres + '/manifest.json', KABUK_TAVANI).then(function (m) {
        if (!m || m.durum !== 200 || typeof m.b64 !== 'string') throw new Bitis('atlandi', 'manifest-alinamadi:durum-' + (m ? m.durum : 'yok'));
        manifestHam = b64Coz(m.b64);
        return getir(kokAdres + '/manifest.json' + IMZA_UZANTI, 4096).then(null, function () { return null; });
      }, function (e) {
        if (e instanceof Bitis) throw e;
        throw new Bitis('atlandi', 'manifest-alinamadi:' + ((e && e.message) || 'ag'));
      });
    }).then(function (sig) {
      if (!sig || sig.durum !== 200 || typeof sig.b64 !== 'string') throw new Bitis('red', 'manifest-imzasiz');
      return imzaDogrula(manifestHam, utf8(b64Coz(sig.b64)), set.imzaAnahtari, o);
    }).then(function (karar) {
      rapor.imzaYolu = karar.yol;
      if (!karar.gecerli) throw new Bitis('red', 'manifest-imzasi-gecersiz:' + karar.sebep);
      var n;
      try { n = JSON.parse(utf8(manifestHam)); } catch (e) { throw new Bitis('red', 'manifest-json-bozuk'); }
      // Kural 1-2 — imza doğru olsa da: kanal G, BU setin kimliği, kurulu sürümden KESİN büyük.
      var kimlikRed = manifestKimligiDenetle(n, set.setKimligi, kurulu);
      if (kimlikRed) throw new Bitis('red', 'manifest-reddedildi:' + kimlikRed);
      plan = planKur(n, kabuk);
      if (plan.red) throw new Bitis('red', plan.red);
      rapor.platformAtlanan = plan.platform.length;
      rapor.atlanan = plan.atlanan.slice();
      var yollar = plan.kabuk.map(function (g) { return g.yol; });
      return yollar.length ? yerel.ozetler({ yollar: yollar }) : { ozetler: {} };
    }).then(function (oz) {
      var mevcut = (oz && oz.ozetler) || {};
      var degisen = plan.kabuk.filter(function (g) { return mevcut[g.yol] !== g.sha256; });
      rapor.kabukAyni = plan.kabuk.length - degisen.length;
      // Kural 3 — YA HEP YA HİÇ: 1) ve 2) yalnız HAZIRLIĞA yazar (canlı katman görmez); herhangi
      // bir hata zinciri keser ve 3) `uygula` HİÇ çağrılmaz. Hata yutulup "kalanıyla devam" YOK.
      // 1) Kabuk dosyaları → hazırlık (yerel taraf sha256'yı yeniden doğrular).
      return degisen.reduce(function (pr, g) {
        return pr.then(function () {
          return getir(dosyaAdresi(kokAdres, g.yol), g.boyut + 1).then(function (y) {
            if (!y || y.durum !== 200 || typeof y.b64 !== 'string') throw new Bitis('red', 'kabuk-indirilemedi:' + g.yol);
            var bayt = b64Coz(y.b64);
            if (bayt.length !== g.boyut) throw new Bitis('red', 'boyut-uyusmaz:' + g.yol);
            if (g.yol === 'index.html' && !androidSayfasiMi(utf8(bayt))) throw new Bitis('red', 'index-android-shim-yok');
            return Promise.resolve(yerel.yaz({ sha256: g.sha256, b64: y.b64 })).then(function () {
              rapor.kabukIndirilen += 1;
            }, function (e) { throw new Bitis('red', 'yazilamadi:' + g.yol + ':' + ((e && e.message) || '')); });
          }, function (e) {
            if (e instanceof Bitis) throw e;
            throw new Bitis('atlandi', 'kabuk-alinamadi:' + g.yol + ':' + ((e && e.message) || 'ag'));
          });
        });
      }, Promise.resolve()).then(function () { return degisen; });
    }).then(function (degisen) {
      // 2) Eklenen kitaplar → yerel indir + doğrula + aç (hazırlıkta bekler).
      var kitaplar = [];
      return plan.ekle.reduce(function (pr, k) {
        return pr.then(function () {
          rapor.istek += 1;
          return Promise.resolve(yerel.kitapKur({ dizin: k.dizin, adres: k.kaynak, sha256: k.sha256, boyut: k.boyut }))
            .then(function (s) {
              if (!s || !s.klasor) throw new Bitis('red', 'kitap-kurulamadi:' + k.dizin);
              if (!(s.indexShimli && s.shimVar && s.manifestVar)) throw new Bitis('red', 'kitap-android-hazir-degil:' + k.dizin);
              kitaplar.push({ dizin: k.dizin, klasor: s.klasor, sha256: k.sha256 });
            }, function (e) {
              if (e instanceof Bitis) throw e;
              throw new Bitis('atlandi', 'kitap-alinamadi:' + k.dizin + ':' + ((e && e.message) || ''));
            });
        });
      }, Promise.resolve()).then(function () { return { degisen: degisen, kitaplar: kitaplar }; });
    }).then(function (h) {
      // 3) TEK atomik adım: kabuk + üyelik birlikte görünür olur (yarım menü mümkün değil).
      return Promise.resolve(yerel.uygula({
        surum: plan.surum,
        dosyalar: h.degisen.map(function (g) { return { yol: g.yol, sha256: g.sha256 }; }),
        kitaplar: h.kitaplar,
        cikarilan: plan.cikar
      })).then(function () {
        rapor.eklenen = h.kitaplar.map(function (k) { return k.dizin; });
        rapor.cikarilan = plan.cikar.slice();
        rapor.durum = (h.degisen.length || h.kitaplar.length || plan.cikar.length) ? 'guncellendi' : 'guncel';
        rapor.sebep = rapor.durum === 'guncellendi' ? 'tamam' : 'icerik-ayni-surum-damgalandi';
        return rapor;
      }, function (e) { throw new Bitis('red', 'uygulanamadi:' + ((e && e.message) || '')); });
    }).then(null, function (e) {
      if (e instanceof Bitis) { rapor.durum = e.durum; rapor.sebep = e.sebep; }
      else { rapor.durum = 'atlandi'; rapor.hata = 'beklenmeyen:' + ((e && e.message) || String(e)); }
      return rapor;
    }).then(function (r) {
      gunluk(ISARET + ' sonuç: ' + JSON.stringify(r));
      return r;
    });
  }

  /* ------------------------------------------------------ tarayıcı başlatıcı */

  function betikYukle(win, adres, ad) {
    return new Promise(function (coz, red) {
      if (win[ad]) { coz(win[ad]); return; }
      var s = win.document.createElement('script');
      s.src = adres;
      s.async = true;
      s.onload = function () { if (win[ad]) coz(win[ad]); else red(new Error(ad + ' yok')); };
      s.onerror = function () { red(new Error(adres + ' yüklenemedi')); };
      (win.document.head || win.document.documentElement).appendChild(s);
    });
  }

  function yerelKopru(C) {
    function cagir(yontem, arg) {
      if (C && typeof C.nativePromise === 'function') return C.nativePromise('EmppG', yontem, arg || {});
      var P = C && C.Plugins && C.Plugins.EmppG;
      if (P && typeof P[yontem] === 'function') return P[yontem](arg || {});
      return Promise.reject(new Error('EmppG eklentisi yok'));
    }
    return {
      yapilandirma: function () { return cagir('yapilandirma'); },
      durum: function () { return cagir('durum'); },
      getir: function (a) { return cagir('getir', a); },
      ozetler: function (a) { return cagir('ozetler', a); },
      yaz: function (a) { return cagir('yaz', a); },
      kitapKur: function (a) { return cagir('kitapKur', a); },
      uygula: function (a) { return cagir('uygula', a); }
    };
  }

  function eklentiVarMi(C) {
    try {
      if (C && typeof C.isPluginAvailable === 'function') return !!C.isPluginAvailable('EmppG');
      return !!(C && C.Plugins && C.Plugins.EmppG);
    } catch (e) { return false; }
  }

  function baslat(win) {
    try {
      if (!win || win.__emppGBasladi) return false;
      win.__emppGBasladi = true;
      var gunluk = function (s) { try { win.console.log(s); } catch (e) {} };
      var C = win.Capacitor;
      if (!eklentiVarMi(C)) { gunluk(ISARET + ' EmppG eklentisi yok — G kapalı'); return false; }
      var st = null;
      try { st = win.localStorage; } catch (e) { st = null; }
      var simdi = Date.now();
      var son = 0;
      try { son = Number((st && st.getItem(SON_ANAHTARI)) || 0) || 0; } catch (e) { son = 0; }
      if (simdi - son >= 0 && simdi - son < ARALIK) { gunluk(ISARET + ' yakında denendi — atlandı'); return false; }
      var yerel = yerelKopru(C);
      betikYukle(win, '/empp-g-kabuk.js', '__emppSetKabuk').then(function (kabuk) {
        return guncellemeyiCalistir({
          yerel: yerel,
          kabuk: kabuk,
          subtle: win.crypto && win.crypto.subtle,
          naclYukle: function () { return betikYukle(win, '/empp-g-nacl.js', 'nacl'); },
          gunluk: gunluk
        });
      }, function (e) {
        gunluk(ISARET + ' kabuk tanımı yüklenemedi — G atlandı: ' + (e && e.message));
        return null;
      }).then(function (r) {
        win.__emppGRapor = r;
        try { if (st) st.setItem(SON_ANAHTARI, String(Date.now())); } catch (e) {}
        return yerel.yapilandirma().then(function (y) {
          var a = setiNormalize(JSON.parse(y.metin)).imzaAnahtari;
          return webcryptoOlc(win.crypto && win.crypto.subtle, a);
        }).then(function (olc) {
          gunluk(ISARET + ' webcrypto-ed25519: ' + JSON.stringify(olc)
            + ' ua=' + ((win.navigator && win.navigator.userAgent) || ''));
        }, function () {});
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    ISARET: ISARET, PLATFORM: PLATFORM, MOTOR_ADI: MOTOR_ADI, SHIM_ADI: SHIM_ADI, SON_ANAHTARI: SON_ANAHTARI,
    ARALIK: ARALIK, KABUK_TAVANI: KABUK_TAVANI, KANAL: KANAL,
    gSurumCoz: gSurumCoz, gSurumKiyasla: gSurumKiyasla, enBuyukGSurum: enBuyukGSurum,
    manifestKimligiDenetle: manifestKimligiDenetle, paketSurumuCoz: paketSurumuCoz,
    adresGuvenliMi: adresGuvenliMi, kimlikKoku: kimlikKoku, dosyaAdresi: dosyaAdresi, setiNormalize: setiNormalize,
    hamAcikAnahtar: hamAcikAnahtar, webcryptoDogrula: webcryptoDogrula, webcryptoOlc: webcryptoOlc,
    imzaDogrula: imzaDogrula, kapsamSinifi: kapsamSinifi, planKur: planKur, androidSayfasiMi: androidSayfasiMi,
    guncellemeyiCalistir: guncellemeyiCalistir, yerelKopru: yerelKopru, eklentiVarMi: eklentiVarMi, baslat: baslat
  };
});
