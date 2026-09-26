'use strict';
/**
 * SAĞLIK KİMLİĞİ — saf karar modülü (I/O YOK: dosya/ağ/süreç okumaz, yalnız verilen
 * girdiyi değerlendirir).
 *
 * NEDEN (2026-09-21, ölçülmüş arıza — kaçak paketleyici): `~/.empp-agent/run-agent.sh`
 * başlatma öncesi `/api/health`'e bakıp YALNIZ CANLILIĞI (süreç cevap veriyor mu)
 * ölçüyordu. 2026-09-20 23:30'da elle başlatılmış, terminalden kopmuş (PPID=1) bir TEST
 * süreci — ortamında `EMPP_SAYFA_WEBP=1` ile — o porta oturmuştu. Sağlık kontrolü
 * canlılık ölçtüğü için yeşil döndü → launchd-yönetimli asıl ajan kendi temiz kopyasını
 * HİÇ başlatmadı → o tarihten sonraki TÜM paketleme trafiği kaçak süreçten geçti.
 *
 * Bu modül "cevap veren süreç canlı mı" sorusunu "bu süreç BENİM BAŞLATACAĞIM KOPYA MI"
 * sorusuna çevirir: üretim davranışını değiştiren kapı bayraklarının o süreçteki
 * açık/kapalı durumu + git commit'i beklenenle karşılaştırılır. ŞÜPHEDE DAİMA `false` —
 * yanlış yeşil, bu arızanın ta kendisiydi.
 *
 * BİREBİR KAYNAK (drift'i önlemek için kopya mantık değil, doğrudan çağrı):
 *   - sayfaWebp, setGuncelleme, icerikGuncelleme → src/packaging/platform-kapisi.js
 *                   `kapiDurumu()` (sayfa-webp / guncelleyici-enjekte / icerik-guncelleme
 *                   `acikMi()`'lerinin kullandığı AYNI çözücü)
 *   - surumNormallestir → src/agent/surum-normallestir.js `acikMi()`
 *   - yama       → src/packaging/yama-katmani.js      `acikMi()`
 *   - windowsAsarsiz → src/packaging/windows-asarsiz.js `acikMi()`
 * setMenu ve pardusKabul için ayrı export edilmiş bir `acikMi()` YOK — koşulları
 * kaynağında (aşağıdaki BİREBİR yorumlar) inline olarak taşındı:
 *   - setMenu     → src/packaging/set-menu.js `ensureSetMenu()`:
 *                   `opts.force === true || process.env.EMPP_SET_MENU === '1'`
 *                   (force bir çağrı-parametresi, süreç KİMLİĞİYLE ilgisiz — yalnız
 *                   env parçası buraya taşındı)
 *   - pardusKabul → src/agent/runner.js CONFIG: `process.env.EMPP_PARDUS_KABUL === '1'`
 *
 * EKSİK KAPI (2026-09-21, kör nokta kapatıldı): `EMPP_SET_GUNCELLEME` aynı gün
 * eklenmiş, ÜRETİM DAVRANIŞINI DEĞİŞTİREN bir kapıdır (`empp-set.json` yazılır mı +
 * güncelleyici enjekte edilir mi) ama bu listede YOKTU. `EMPP_SET_GUNCELLEME=0` ile
 * başlatılmış KAÇAK bir süreç, sağlık ucunda temiz kopyadan ayırt EDİLEMİYORDU —
 * modülün var olma sebebi olan arızanın (2026-09-20 kaçak paketleyici) tıpatıp
 * aynısı. Kapı listesi, üretim davranışını değiştiren HER bayrağı taşımalıdır.
 *
 * PLATFORM KAPSAMI (2026-09-26, Windows sözleşmesi ONAYLI): `sayfaWebp`, `setGuncelleme` ve
 * `icerikGuncelleme` bayrakları virgüllü platform listesi alabilir (`EMPP_SET_GUNCELLEME=windows`).
 * Bu üçünün gösterimi `src/packaging/platform-kapisi.js` `kapiDurumu()` üzerinden — kararı
 * veren `kapiAcikMi()` ile AYNI çözücü: `0`/`1`/tanımsız → boolean (eski gösterim aynen),
 * kapsamlı değer → kanonik sıralı platform dizgesi (`"windows"`, `"windows,macos"`), tanınan
 * ad yoksa `false`. Dizgede yalnız sabit platform adları bulunur — ham değer taşınmaz.
 * `icerikGuncelleme` bu listede YOKTU (üretim davranışını değiştiren kapı — kör nokta).
 *
 * BOZARSAN: `saglik-kimligi.test.js` kırılır. O dosyalardaki koşul DEĞİŞİRSE burası da
 * (setMenu/pardusKabul için) elle güncellenmeli — aksi halde sağlık ucu YALAN söyler.
 */

const { kapiDurumu } = require('../packaging/platform-kapisi');
const { acikMi: surumNormallestirAcikMi } = require('../agent/surum-normallestir');
const { acikMi: yamaAcikMi } = require('../packaging/yama-katmani');
const { acikMi: windowsAsarsizAcikMi } = require('../packaging/windows-asarsiz');

/**
 * Bir sürecin ortam değişkenlerinden üretim-davranışı kapılarının açık/kapalı
 * durumunu okur. Dönen nesne boolean taşır; yalnız platform kapsamlı üç kapı
 * (sayfaWebp, setGuncelleme, icerikGuncelleme) kapsamlı değerde kanonik platform dizgesi
 * (`"windows"`) taşır. Ham env değeri (örn. hangi kalite/dizin/anahtar) asla dışarı taşınmaz.
 *
 * @param {NodeJS.ProcessEnv|Object} env
 * @returns {{sayfaWebp: boolean|string, setMenu: boolean, pardusKabul: boolean,
 *            surumNormallestir: boolean, yama: boolean, setGuncelleme: boolean|string,
 *            icerikGuncelleme: boolean|string, windowsAsarsiz: boolean}}
 */
function kapilariOku(env) {
  const e = (env && typeof env === 'object') ? env : {};
  return {
    // Varsayılan KAPALI — `sayfa-webp.js` acikMi ile AYNI çözücü (platform-kapisi).
    sayfaWebp: kapiDurumu('EMPP_SAYFA_WEBP', e, false),
    setMenu: e.EMPP_SET_MENU === '1',
    pardusKabul: e.EMPP_PARDUS_KABUL === '1',
    surumNormallestir: surumNormallestirAcikMi(e) === true,
    yama: yamaAcikMi(e) === true,
    // Varsayılan AÇIK ('0' kapatır) — `guncelleyici-enjekte.js` ile AYNI çözücü.
    setGuncelleme: kapiDurumu('EMPP_SET_GUNCELLEME', e, true),
    // Varsayılan AÇIK ('0' kapatır) — `icerik-guncelleme.js` ile AYNI çözücü.
    icerikGuncelleme: kapiDurumu('EMPP_ICERIK_GUNCELLEME', e, true),
    // Varsayılan AÇIK ('0' kapatır) — Windows NSIS paketinde `asar` kapalı mı?
    // PAKET DÜZENİNİ değiştirir (içerik `resources/app.asar` yerine `resources/app/`
    // altında düz dosya olarak durur), yani üretim davranışı kapısıdır: bu bayrağı
    // kapatmış KAÇAK bir süreç temiz kopyadan ayırt edilebilmeli.
    windowsAsarsiz: windowsAsarsizAcikMi(e) === true,
  };
}

/** boolean → insan-okunur Türkçe etiket; diğer tipler aynen string'e çevrilir. */
function etiketle(deger) {
  if (typeof deger === 'boolean') return deger ? 'açık' : 'kapalı';
  if (deger === undefined) return 'tanımsız';
  return String(deger);
}

/**
 * `saglik` cevabının `beklenen` ile kimlik uyuşup uyuşmadığını denetler.
 * `beklenen`'de VERİLMEYEN alan yok sayılır (kısmi karşılaştırma). `beklenen.kapilar`
 * içindeki her kapı ayrı ayrı, insan-okunur tek satır sebeple raporlanır.
 *
 * @param {Object} saglik  /api/health'ten dönen (parse edilmiş) cevap
 * @param {{commit?: string, [x: string]: any, kapilar?: Object}} beklenen
 * @returns {{uygun: boolean, sebepler: string[]}}
 */
function kimlikUyusuyorMu(saglik, beklenen) {
  const s = (saglik && typeof saglik === 'object') ? saglik : {};
  const b = (beklenen && typeof beklenen === 'object') ? beklenen : {};
  const sebepler = [];

  for (const alan of Object.keys(b)) {
    if (alan === 'kapilar') {
      const beklenenKapilar = (b.kapilar && typeof b.kapilar === 'object') ? b.kapilar : {};
      const gelenKapilar = (s.kapilar && typeof s.kapilar === 'object') ? s.kapilar : {};
      for (const kapiAdi of Object.keys(beklenenKapilar)) {
        const beklenenDeger = beklenenKapilar[kapiAdi];
        const gelenDeger = gelenKapilar[kapiAdi];
        if (gelenDeger !== beklenenDeger) {
          sebepler.push(
            `${kapiAdi}: bekleniyor ${etiketle(beklenenDeger)}, gelen ${etiketle(gelenDeger)}`
          );
        }
      }
      continue;
    }
    if (s[alan] !== b[alan]) {
      sebepler.push(`${alan}: bekleniyor ${etiketle(b[alan])}, gelen ${etiketle(s[alan])}`);
    }
  }

  return { uygun: sebepler.length === 0, sebepler };
}

/**
 * Bir sağlık cevabının "bu süreç benim beklediğim kopya" sayılıp sayılmayacağına
 * karar verir. ŞÜPHEDE DAİMA `false` döner — cevap yoksa, bozuksa (obje değilse,
 * `kapilar` beklenip gelmiyorsa) ya da kimlik uyuşmuyorsa yeşil sayılmaz. Yanlış
 * yeşil, bu modülün var olma sebebi olan arızanın ta kendisiydi.
 *
 * @param {*} saglik
 * @param {Object} [beklenen]
 * @returns {boolean}
 */
function yesilSayilirMi(saglik, beklenen) {
  try {
    if (!saglik || typeof saglik !== 'object' || Array.isArray(saglik)) return false;

    const b = (beklenen && typeof beklenen === 'object') ? beklenen : {};
    if (b.kapilar && (!saglik.kapilar || typeof saglik.kapilar !== 'object')) {
      // beklenen kapı denetimi istiyor ama cevapta kapilar YOK/bozuk — şüphede false.
      return false;
    }

    const { uygun } = kimlikUyusuyorMu(saglik, b);
    return uygun === true;
  } catch (hata) {
    // Hiçbir koşulda fırlatma — çağıran (run-agent.sh reçetesi) burada asla çökmemeli.
    return false;
  }
}

module.exports = { kapilariOku, kimlikUyusuyorMu, yesilSayilirMi };
