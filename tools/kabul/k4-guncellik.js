'use strict';
/**
 * K4 GÜNCELLİK KATMANI — başsız kabulün dördüncü ölçütü (uçtan uca sözleşmesi T3/K4):
 * paket açılınca motor İmpark'a "bu kitabın güncellemesi var mı" diye SORUYOR MU
 * (`…/TestlerMobil/GetKitapGuncellemeBilgi?id=&setMi=&versiyon=`) ve cevap "güncel" mi.
 *
 * ProBook kabulündeki E6/E7/E8'in (tools/pardus/probook-kabul.sh + cdp-kitap-ac.js +
 * kabul-karar.sh) Mac eşi. Kitaba girme + cevabı yakalama AYNI modülle yapılır
 * (`cdp-kitap-ac.js` `ana`): iki kapı aynı ölçer, aynı cevap yorumlayıcısını kullanır.
 *
 * Electron (mac DMG · Windows NSIS içeriği · pardus .impark · APK'nın assets/public'i):
 *   kosum/main.js K4 kipinde paketin kök sayfasını AYRI BOŞ profille (userData + HOME — E8
 *   dersi, 45482: gerçek evdeki K örtüsü motora v36 sordurdu, ayrı evde v33 → güncel değil)
 *   ve `--remote-debugging-port=<boş port, 3000 değil>` ile açar. Ağ AÇIK (motor soruyu ancak
 *   ağ varken sorar), ZKitapZip(H)/*.zip indirmesi kesik, Node http(s) kapalı. Pencere yok,
 *   Dock yok (içerik katmanıyla aynı LSUIElement çalışma zamanı) — odak kapının kendi
 *   izleyicisiyle ölçülür.
 * Android cihaz (pencerisiz emülatör, android-cihaz.js kancası): uygulamanın WebView'ına
 *   `adb forward tcp:<p> localabstract:webview_devtools_remote_<pid>`. CapacitorHttp fetch'i
 *   yerel köprüden geçirdiği için Network olayı doğmayabilir → belge-başı kaydedici
 *   (cdp-kitap-ac `--kaydedici 1`). Soket yoksa ÖLÇÜLEMEDİ + gerekçe (kırmızı değil).
 *   Motor açılışta `window.isOnline`ı bir HEAD yoklamasıyla BİR KEZ hesaplar; kök (besegitim.com)
 *   WebView başlıklı isteğe HTTP ≥400 döner, CapacitorHttp köprüsü gövdesiz HEAD hatasını ağ hatasına
 *   çevirir → cihazda isOnline=false, soru "Network is offline" ile kesilir (ölçüldü 26.09, 74451 —
 *   ağ VALIDATED, netpolicy kısıtsız, navigator.onLine=true; sıra/yeniden açma çözmez). Bu
 *   yüzden cihaz yolu `--cevrimici-sabitle 1` geçer: motorun kendi değeri `olcum.cevrimici.uygulama`ya
 *   yazılır, false ise karar notuna APK kusuru olarak düşer; soru cihazın gerçek ağından gider.
 *   Çevrimiçi motor güncelleme zip'ini indirmeye kalkar → Electron K4 gibi kesilir (`indirmeKesildi`).
 *
 * KARAR SÖZLÜĞÜ — tools/pardus/kabul-karar.sh ile AYNI: GEÇTİ 0 · GÜNCEL-DEĞİL 3 · ÖLÇÜLEMEDİ 4.
 *   GEÇTİ         motor sordu, cevap `Data=""` ve İmpark sürümü (Vs) paketteki sürümün ÜSTÜNDE değil.
 *   GÜNCEL-DEĞİL  cevap `Data` dolu (motor güncelleme indirmeye kalkar) YA DA Vs > paketteki
 *                 kapak sürümü (motor başka sürüm sorduysa bile — örtü tuzağı). Yükleme YOK,
 *                 `failed` + "güncel değil:" + yeniden kuyruk önerisi (Pardus K18 rc 3 ile aynı).
 *   ÖLÇÜLEMEDİ    soru görülmedi / cevap okunamadı / CDP kurulamadı / profil boş değil.
 *                 ENGELLER mi (yükleme yok, `failed` yazılmaz, kira dolunca kuyruğa döner)?
 *                 kabul-karar.sh'deki gibi: E8 (ayrı boş ev yok) ve CDP'nin hiç kurulamaması
 *                 (Pardus'ta E6 ÖLÇÜLEMEDİ → rc 4) ENGELLER; soru görülmedi / gövde okunamadı
 *                 (Pardus'ta E7 YOK/ÖLÇÜLEMEDİ + E6 GEÇTİ → GEÇTİ, "karar değiştirmez")
 *                 ENGELLEMEZ, karar.json `k4` alanında ÖLÇÜLEMEDİ olarak kalır (sahte yeşil yok).
 *                 Aktivasyonlu seri: KABUL_AKTIVASYON_OLCULEMEDI=1 değilse engellemez (Pardus aynı).
 *
 * Bayrak: `KABUL_K4=1` (ya da CLI `--k4`) — varsayılan KAPALI; kapalıyken başsız kabul birebir
 * eski (çıkış 0/1/3, karar.json `k4.durum = ATLANDI`).
 *
 * SET TÜM ALT KİTAPLAR (`KABUL_SET_TUM=1` / `--set-tum`, K4 açıkken; varsayılan KAPALI): motor
 * yalnız açılan kitabı sorar → Electron ölçümü `cdp-kitap-ac --set-tum 1` ile her alt kitabın menü
 * sürümünü İmpark'a doğrudan sorar (tools/kabul/set-guncellik.js); `olcum.setTum.karar` K4 kararına
 * `setTumBirlestir` ile (en kötüsü) katılır. Android cihaz WebView'ında Node yok → yalnız Electron.
 * BOZARSAN: tools/kabul/k4-guncellik.test.js kırılır.
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const cdpAc = require('../pardus/cdp-kitap-ac');
const ig = require('../../src/runtime/icerik-guncelleme');

const K4_DURUM = Object.freeze({
  GECTI: 'GECTI', GUNCEL_DEGIL: 'GUNCEL_DEGIL', OLCULEMEDI: 'OLCULEMEDI', ATLANDI: 'ATLANDI',
});
/** K4 katmanının kendi kodu (kabul-karar.sh KARAR_KOD ile aynı). */
const K4_KOD = Object.freeze({ GECTI: 0, GUNCEL_DEGIL: 3, OLCULEMEDI: 4 });
/** K4 açıkken başsız kabul CLI'ının çıkış sözlüğü (kabul-karar.sh / probook-kabul.sh ile aynı). */
const K4_CIKIS = Object.freeze({ GECTI: 0, RED: 1, GUNCEL_DEGIL: 3, OLCULEMEDI: 4 });
const K4_TR = Object.freeze({
  GECTI: 'GEÇTİ', RED: 'RED', GUNCEL_DEGIL: 'GÜNCEL-DEĞİL', OLCULEMEDI: 'ÖLÇÜLEMEDİ', ATLANDI: 'ATLANDI',
});
const MENU_GORELI = ig.MENU_GORELI; // classlibraries/ImWin32.dll — motorun menüsü (kapak ID + version)
/** Mac'te CDP portu tabanı: ProBook tüneli 9437+ (probook-kabul.sh), çakışmasın. 3000 ASLA. */
const CDP_PORT_TABANI = 9537;
const ADB_PORT_TABANI = 9637;
/** Capacitor WebView kökü (androidScheme 'https' → https://localhost/...). */
const ANDROID_HEDEF_DESENI = '^(https?|capacitor)://localhost(:\\d+)?/';

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/** K4 bu koşuda açık mı? Saf. */
function k4Etkin({ bayrak = false, env = process.env } = {}) {
  return Boolean(bayrak) || env.KABUL_K4 === '1';
}

/**
 * Paketteki kapak sürümleri: SET'te her `bookN/classlibraries/ImWin32.dll`, tek kitapta kök
 * menü; motorun kendi çözücüsüyle (runtime/icerik-guncelleme.js menuCoz + kapaklar — TEK KAYNAK).
 * Yan etkisiz (yalnız okur).
 * @returns {{surumler: Object<string,number>, okunan: string[], okunamayan: string[]}}
 */
function paketSurumleriOku(kok, asarMi, kitapDizinleri = []) {
  const surumler = {};
  const okunan = [];
  const okunamayan = [];
  let oku;
  if (asarMi) {
    // eslint-disable-next-line global-require
    const asar = require('@electron/asar');
    oku = (rel) => { try { return asar.extractFile(kok, rel); } catch (_) { return null; } };
  } else {
    oku = (rel) => { try { return fs.readFileSync(path.join(kok, rel)); } catch (_) { return null; } };
  }
  const yollar = (kitapDizinleri || []).length ? kitapDizinleri.map((d) => `${d}/${MENU_GORELI}`) : [MENU_GORELI];
  for (const rel of yollar) {
    const ham = oku(rel);
    const xml = ham ? ig.menuCoz(ham) : null;
    if (!xml) { okunamayan.push(rel); continue; }
    okunan.push(rel);
    for (const k of ig.kapaklar(xml)) {
      if (!k.ID || k.version === null || Object.prototype.hasOwnProperty.call(surumler, k.ID)) continue;
      surumler[k.ID] = k.version;
    }
  }
  return { surumler, okunan, okunamayan };
}

function sayiMi(x) { return x !== '' && x !== null && x !== undefined && Number.isFinite(Number(x)); }
function varMi(o, k) { return Boolean(o) && Object.prototype.hasOwnProperty.call(o, k); }

/**
 * `--cevrimici-sabitle` tanısını tek satıra çevirir. Saf.
 * @param {{url?:string, kopru?:object, webviewUA?:object, yalin?:object}|null} y
 */
function yoklamaTanisi(y) {
  if (!y || typeof y !== 'object') return '';
  if (y.hata && !y.kopru && !y.webviewUA && !y.yalin) return ` (tanı: ${y.hata})`;
  const bir = (o) => (!o ? '—' : o.http ? `HTTP ${o.http}${o.cf ? ` cf-mitigated: ${o.cf}` : ''}` : (o.hata || '?'));
  return ` (HEAD ${y.url || '?'}: Capacitor fetch köprüsü → ${bir(y.kopru)}; eklenti WebView UA → ${bir(y.webviewUA)}; `
    + `eklenti yalın → ${bir(y.yalin)})`;
}

/**
 * K4 kararı. Saf.
 * @param {{olcum?: {e6?:object, e7?:object, cevaplar?:object[]}, paketSurumleri?: Object<string,number>,
 *          aktivasyon?: boolean, aktivasyonOlculemedi?: boolean, profilBos?: boolean, kaynak?: string}} p
 * @returns {{durum:string, kod:number, sebep:string, oneri:string, notlar:string[], engeller:boolean, kaynak:string}}
 */
function k4Karari({
  olcum, paketSurumleri = {}, aktivasyon = false, aktivasyonOlculemedi = false, profilBos = true, kaynak = 'electron',
} = {}) {
  const notlar = [];
  const sonuc = (durum, sebep, ek = {}) => ({
    durum, kod: K4_KOD[durum], sebep, oneri: '', notlar, engeller: false, kaynak, ...ek,
  });
  if (profilBos === false) {
    return sonuc(K4_DURUM.OLCULEMEDI, 'E8: K4 profili (userData + HOME) koşudan önce boş değil — eski indirme/örtü '
      + 'motorun sorduğu sürümü değiştirir (45482: gerçek ev v36, ayrı ev v33); GEÇTİ verilmez', { engeller: true });
  }
  if (!olcum) return sonuc(K4_DURUM.OLCULEMEDI, 'K4 ölçümü yapılmadı', { engeller: true });
  const cevaplar = Array.isArray(olcum.cevaplar) ? olcum.cevaplar.filter(Boolean) : [];
  const e6 = olcum.e6 || {};
  const e7 = olcum.e7 || {};
  const cv = olcum.cevrimici;
  if (cv && cv.sabitlendi && Array.isArray(cv.uygulama) && cv.uygulama.includes(false)) {
    const tani = yoklamaTanisi(cv.yoklama);
    notlar.push(`APK KUSURU: uygulamanın açılış canlılık yoklaması isOnline=false dedi${tani} — kök HEAD'e `
      + 'HTTP ≥400 döndükçe motor güncelleme sorusunu (ve çevrimiçi aktivasyonu) "Network is offline" ile keser; '
      + 'K4 ölçümü için isOnline kabul aracınca true\'ya sabitlendi');
  }

  // Soru ↔ paket kıyası (motor örtüyle farklı sürüm sorarsa Data boş gelir ama paket eskidir).
  const eski = [];
  for (const c of cevaplar) {
    if (!c.id || !varMi(paketSurumleri, c.id)) continue;
    const p = Number(paketSurumleri[c.id]);
    if (sayiMi(c.versiyon) && Number(c.versiyon) !== p) {
      notlar.push(`motor ${c.id} için v${c.versiyon} sordu, pakette v${p} — soru paketi yansıtmıyor (örtü?)`);
    }
    if (c.durum === 'BOS' && sayiMi(c.vs) && Number(c.vs) > p) {
      eski.push({ id: c.id, paket: p, vs: Number(c.vs), versiyon: c.versiyon });
    }
  }

  if (cevaplar.some((c) => c.durum === 'DOLU')) {
    return sonuc(K4_DURUM.GUNCEL_DEGIL, `E7 ${e7.ayrinti || 'güncelleme cevabı Data dolu'}`, { oneri: e7.oneri || '' });
  }
  if (eski.length) {
    const tekil = [...new Map(eski.map((k) => [k.id, k])).values()];
    const oneri = `kaynak S1 ile yenilenmeli (${tekil.map((k) => `ZKitapZipH/${k.id}-${k.vs}.zip`).join(', ')}); `
      + 'yeni build zip arşive girince yeniden kuyruğa al (İmpark web katmanı gecikmeli: Vs tazeyse ≥10 dk sonra); '
      + 'aynı kaynakla yeniden üretim aynı sonucu verir';
    return sonuc(K4_DURUM.GUNCEL_DEGIL, tekil.map((k) => `${k.id} paket v${k.paket} < İmpark v${k.vs} `
      + `(motor v${k.versiyon || '?'} sordu, Data boş)`).join('; '), { oneri });
  }
  if (e7.durum === 'BOS') {
    for (const c of cevaplar) {
      if (c.durum === 'BOS' && varMi(paketSurumleri, c.id) && sayiMi(c.vs) && Number(c.vs) < Number(paketSurumleri[c.id])) {
        notlar.push(`UYARI İmpark v${c.vs} < paket v${paketSurumleri[c.id]} (${c.id}; geri alınmış olabilir)`);
      }
    }
    return sonuc(K4_DURUM.GECTI, `E7 ${e7.ayrinti || 'güncel'}`);
  }
  const e6Ozet = `E6=${e6.durum || '?'}${e6.sebep ? ` (${e6.sebep})` : ''}`;
  if (aktivasyon) {
    return sonuc(K4_DURUM.OLCULEMEDI, `aktivasyon kodlu seri — güncellik ölçülemedi (E7=${e7.durum || '?'}: `
      + `${e7.ayrinti || '-'}; ${e6Ozet})`, { engeller: Boolean(aktivasyonOlculemedi) });
  }
  if (!cevaplar.length && e6.durum === 'OLCULEMEDI') {
    return sonuc(K4_DURUM.OLCULEMEDI, `CDP ölçümü kurulamadı: ${e6.sebep || 'bilinmiyor'}`, { engeller: true });
  }
  const neden = e7.durum === 'YOK' ? 'motor güncelleme sorusunu sormadı (GetKitapGuncellemeBilgi görülmedi)'
    : `cevap okunamadı: ${e7.ayrinti || '-'}`;
  return sonuc(K4_DURUM.OLCULEMEDI, `${neden}; ${e6Ozet}`);
}

/**
 * Birden çok K4 ölçümünü (Android: Electron + cihaz WebView) tek karara indirger. Saf.
 * GÜNCEL-DEĞİL baskın; sonra GEÇTİ; hepsi ölçülemediyse ÖLÇÜLEMEDİ (biri engelliyorsa engeller).
 */
function k4Birlestir(...kararlar) {
  const l = kararlar.filter(Boolean);
  if (!l.length) return null;
  const kaynaklar = l.map((k) => ({ kaynak: k.kaynak, durum: k.durum, sebep: k.sebep }));
  if (l.length === 1) return { ...l[0], kaynaklar };
  // Diğer kaynakların sebebi + kendi notları (ör. cihazın "APK KUSURU" notu) kaybolmasın.
  const digerleri = (sec) => l.filter((k) => k !== sec)
    .flatMap((k) => [`${k.kaynak}: ${K4_TR[k.durum] || k.durum} — ${k.sebep}`,
      ...(k.notlar || []).map((n) => `${k.kaynak}: ${n}`)]);
  // Aynı durumda cihaz ölçümü öne geçer: APK'nın gerçek çalışma ortamı odur, Electron yedektir.
  const sec = (durum) => l.find((k) => k.durum === durum && k.kaynak === 'cihaz') || l.find((k) => k.durum === durum);
  const baskin = sec(K4_DURUM.GUNCEL_DEGIL) || sec(K4_DURUM.GECTI);
  if (baskin) return { ...baskin, notlar: [...baskin.notlar, ...digerleri(baskin)], kaynaklar };
  return {
    durum: K4_DURUM.OLCULEMEDI,
    kod: K4_KOD.OLCULEMEDI,
    sebep: l.map((k) => `${k.kaynak}: ${k.sebep}`).join(' | '),
    oneri: '',
    notlar: l.flatMap((k) => k.notlar || []),
    engeller: l.some((k) => k.engeller),
    kaynak: l.map((k) => k.kaynak).join('+'),
    kaynaklar,
  };
}

/**
 * Genel karar + K4. Saf. Öncelik: RED (paket kusuru, ağ kapalı ölçüldü) > GÜNCEL-DEĞİL >
 * ENGELLEYEN ÖLÇÜLEMEDİ > diğer katmanların kararı.
 */
function genelKararK4(genel, k4) {
  if (!k4 || k4.durum === K4_DURUM.ATLANDI) return genel;
  if (genel === 'RED') return 'RED';
  if (k4.durum === K4_DURUM.GUNCEL_DEGIL) return K4_DURUM.GUNCEL_DEGIL;
  if (k4.durum === K4_DURUM.OLCULEMEDI && k4.engeller && genel === 'GECTI') return K4_DURUM.OLCULEMEDI;
  return genel;
}

/**
 * Çıkış kodu. Saf. K4 açıkken sözlük ProBook kapısıyla aynı (0/1/3 GÜNCEL-DEĞİL/4 ÖLÇÜLEMEDİ);
 * kapalıyken başsız kabulün eski sözlüğü (0/1/3 ÖLÇÜLEMEDİ) — `eskiCikis` = olcutler.cikisKodu.
 */
function k4CikisKodu(durum, k4Acik, eskiCikis) {
  if (!k4Acik) return eskiCikis(durum);
  return varMi(K4_CIKIS, durum) ? K4_CIKIS[durum] : K4_CIKIS.OLCULEMEDI;
}

/**
 * karar.json `katmanlar.guncellik` — diğer katmanların sözlüğüyle (GECTI/RED/OLCULEMEDI) K4.
 * Uçtan uca okuyucu (tests/e2e kabul-kaniti.js `k4Basliksiz`) bu katmanı okur: GÜNCEL-DEĞİL
 * sözleşmedeki "RED 'güncel değil'"dir. Genel karar bu katmandan DEĞİL `genelKararK4`'ten gelir
 * (katman listesinden hariç tutulur). Saf.
 */
function guncellikKatmani(k4) {
  if (!k4 || k4.durum === K4_DURUM.ATLANDI) return null;
  const durum = { GECTI: 'GECTI', GUNCEL_DEGIL: 'RED', OLCULEMEDI: 'OLCULEMEDI' }[k4.durum] || 'OLCULEMEDI';
  return {
    durum,
    k4Durum: k4.durum,
    kod: k4.kod,
    engeller: Boolean(k4.engeller),
    sebepler: durum === 'GECTI' ? [] : [k4.durum === K4_DURUM.GUNCEL_DEGIL ? `güncel değil: ${k4.sebep}` : k4.sebep],
    ozet: k4.sebep,
    notlar: k4.notlar || [],
  };
}

/** cdp-kitap-ac `ANAHTAR=değer` satırları → nesne. Saf. */
function cdpSatirlariCoz(satirlar = []) {
  const v = {};
  for (const s of satirlar) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(String(s));
    if (m) v[m[1]] = m[2];
  }
  return v;
}

/** /proc/net/unix'ten uygulamanın WebView hata ayıklama soketi (yalnız o pid). Saf. */
function webviewSoketiSec(unix, pid) {
  const ad = `webview_devtools_remote_${pid}`;
  return String(unix || '').split('\n').some((l) => l.trim().endsWith(`@${ad}`)) ? ad : null;
}

function dizinBosMu(d) {
  try { return fs.readdirSync(d).length === 0; } catch (_) { return true; }
}

function jsonOku(y) {
  try { return JSON.parse(fs.readFileSync(y, 'utf8')); } catch (_) { return null; }
}

function portBosMu(port) {
  return new Promise((coz) => {
    const s = net.createServer();
    s.once('error', () => coz(false));
    s.listen(port, '127.0.0.1', () => s.close(() => coz(true)));
  });
}

/** Tabandan başlayarak 127.0.0.1'de boş TCP portu; 3000 ASLA (PORT_RULE). */
async function bosPortBul(taban = CDP_PORT_TABANI, adet = 60) {
  for (let p = taban; p < taban + adet; p += 1) {
    if (p === 3000) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await portBosMu(p)) return p;
  }
  return null;
}

/**
 * Harness'ı (kosum/main.js) K4 kipinde başlatır. İçerik katmanıyla aynı ortam temizliği
 * (ELECTRON_RUN_AS_NODE / NODE_OPTIONS silinir), HOME ayrı boş ev, Node ağı kapalı.
 */
function kosumBaslat({ ikili, girdiYolu, ev, kanit }) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.NODE_OPTIONS;
  env.HOME = ev;
  env.EMPP_KOSUM_GIRDI = girdiYolu;
  env.EMPP_KABUL_AG_KAPALI = '1'; // preload: Node http(s) kapalı (zip indirmesi Node'la yapılır)
  const cikti = fs.openSync(path.join(kanit, 'electron-stdout.log'), 'w');
  let kapali = false;
  const kapat = () => { if (!kapali) { kapali = true; try { fs.closeSync(cikti); } catch (_) { /* kapalı */ } } };
  const cocuk = spawn(ikili, [path.join(__dirname, 'kosum', 'main.js')], {
    env, detached: true, stdio: ['ignore', cikti, cikti],
  });
  let cikis = null;
  const bitti = new Promise((coz) => {
    cocuk.on('exit', (kod, sinyal) => { cikis = cikis || { kod, sinyal }; kapat(); coz(cikis); });
    cocuk.on('error', (e) => { cikis = cikis || { kod: -1, hata: e.message }; kapat(); coz(cikis); });
  });
  return {
    pid: cocuk.pid,
    bitti,
    async durdur(durDosyasi) {
      if (cikis) return cikis;
      try { fs.writeFileSync(durDosyasi, 'dur\n'); } catch (_) { /* aşağıda öldürülür */ }
      const r = await Promise.race([bitti, bekle(12000).then(() => null)]);
      if (r) return r;
      try { process.kill(-cocuk.pid, 'SIGKILL'); } catch (_) { /* ölü */ }
      return Promise.race([bitti, bekle(3000).then(() => ({ kod: null, sinyal: 'SIGKILL', zorla: true }))]);
    },
  };
}

/** cdp-kitap-ac'ı süreç içinde koşturur, E6/E7 + yakalanan cevapları döndürür. */
async function cdpOlc(argv, kanit, cdpAna) {
  const satirlar = [];
  const kod = await (cdpAna || cdpAc.ana)(argv, (x) => satirlar.push(x));
  const v = cdpSatirlariCoz(satirlar);
  const j = jsonOku(path.join(kanit, 'cdp-sonuc.json'));
  return {
    cdpCikis: kod,
    e6: { durum: v.E6 || 'OLCULEMEDI', sebep: v.E6_SEBEP || '', tur: v.E6_TUR || '', url: v.E6_URL || '' },
    e7: { durum: v.E7 || 'OLCULEMEDI', ayrinti: v.E7_AYRINTI || '', oneri: v.E7_ONERI || '' },
    cevaplar: (j && j.e7 && Array.isArray(j.e7.cevaplar)) ? j.e7.cevaplar : [],
    setTum: (j && j.setTum) || null,
    hedef: (j && j.hedef) || null,
    adim: (j && j.adim) || null,
    kaydedici: (j && j.kaydedici) || null,
    cevrimici: (j && j.cevrimici) || null,
  };
}

function sureArgumanlari(p) {
  const kitapSn = p.kitapSn || 60;
  const e7Sn = p.e7Sn || 20;
  const baglanSn = p.baglanSn || 30;
  const menuSn = p.menuSn || 30;
  const toplamSn = p.cdpToplamSn || (baglanSn + menuSn + kitapSn + e7Sn + 60);
  return {
    toplamSn,
    argv: ['--kitap-sn', String(kitapSn), '--e7-sn', String(e7Sn), '--baglan-sn', String(baglanSn),
      '--menu-sn', String(menuSn), '--toplam-sn', String(toplamSn), ...(p.cdpEkArg || [])],
  };
}

/**
 * Electron K4 ölçümü (mac/windows/pardus içeriği ve APK'nın web ağacı).
 * @param {{ikili?:string, girisYolu:string, kurulumKoku:string, kanit:string, calisma:string,
 *          log?:Function, kitapSn?:number, e7Sn?:number, cdpPort?:number, baslat?:Function,
 *          cdpAna?:Function, cdpEkArg?:string[], profil?:string, setTum?:boolean}} p
 *   setTum: cdp-kitap-ac `--set-tum 1` (her alt kitap; sonuç `olcum.setTum`)
 */
async function electronK4Olc(p) {
  const log = p.log || (() => {});
  const bas = Date.now();
  const kanit = path.join(p.kanit, 'k4');
  fs.mkdirSync(kanit, { recursive: true });
  const profil = p.profil || path.join(p.calisma, `k4-profil-${Date.now()}`);
  const olcum = {
    kaynak: 'electron', profil, profilBos: dizinBosMu(profil), cevaplar: [], e6: null, e7: null, kanit,
  };
  const bitir = (sebep) => {
    olcum.e6 = olcum.e6 || { durum: 'OLCULEMEDI', sebep };
    olcum.e7 = olcum.e7 || { durum: 'OLCULEMEDI', ayrinti: sebep, oneri: '' };
    olcum.sureSn = Math.round((Date.now() - bas) / 1000);
    return olcum;
  };
  if (!olcum.profilBos) return bitir(`K4 profili boş değil: ${profil}`);
  if (!p.ikili && !p.baslat) return bitir('Electron çalışma zamanı yok');
  const ev = path.join(profil, 'ev');
  fs.mkdirSync(ev, { recursive: true });
  // sessionData (kosum/main.js `profil/oturum`) önceden açılır: Chromium DevToolsActivePort'u oraya yazar.
  fs.mkdirSync(path.join(profil, 'oturum'), { recursive: true });
  const port = p.cdpPort || await bosPortBul(Number(process.env.KABUL_K4_CDP_PORT_TABAN) || CDP_PORT_TABANI);
  if (!port) return bitir('boş CDP portu bulunamadı');
  olcum.cdpPort = port;
  const sure = sureArgumanlari(p);
  const durDosyasi = path.join(p.calisma, `k4-dur-${port}`);
  const girdi = {
    k4: true,
    cdpPort: port,
    giris: p.girisYolu,
    kanitDizin: kanit,
    profilDizin: profil,
    sonucYolu: path.join(kanit, 'kosum.json'),
    agKapali: false,
    toplamSn: sure.toplamSn + 30 + (p.setTum ? 90 : 0), // set-tum: cdp-kitap-ac --set-tum-sn varsayılanı
    durDosyasi,
  };
  const girdiYolu = path.join(p.calisma, `k4-girdi-${port}.json`);
  fs.writeFileSync(girdiYolu, JSON.stringify(girdi, null, 2));
  log(`K4: ayrı boş profil ${profil} · CDP 127.0.0.1:${port} · ağ açık (zip indirmesi kesik, Node ağı kapalı)`);
  const surec = (p.baslat || kosumBaslat)({ ikili: p.ikili, girdiYolu, ev, kanit, girdi });
  olcum.pid = surec.pid;
  try {
    Object.assign(olcum, await cdpOlc(
      ['--port', String(port), '--kanit', kanit, '--kurulum-koku', p.kurulumKoku || '',
        ...(p.setTum ? ['--set-tum', '1'] : []), ...sure.argv], kanit, p.cdpAna,
    ));
  } catch (e) {
    olcum.e6 = { durum: 'OLCULEMEDI', sebep: `CDP istemcisi hatası: ${e.message}` };
  } finally {
    olcum.kosumCikis = await surec.durdur(durDosyasi);
  }
  const k = jsonOku(girdi.sonucYolu);
  olcum.etkinlesme = (k && k.etkinlesme) || [];
  olcum.indirmeKesildi = ((k && k.agEngellenen) || []).slice(0, 5);
  olcum.kosumHata = (k && k.hata) || null;
  return bitir('CDP sonucu yok');
}

/** Cihaz K4'te menü bekleme tavanı (sn): menü görünür görünmez erken döner. */
const CIHAZ_MENU_SN = 120;

/**
 * Android cihaz K4 ölçümü — android-cihaz.js `cihazKabulu`nun `k4Olc` kancası (uygulama açık,
 * kaldırılmadan önce). Pencere açmaz; yalnız adb forward + CDP.
 * @param {{adbKos:Function, paket:string, kanitDizin:string, log?:Function, kitapSn?:number,
 *          e7Sn?:number, cdpPort?:number, cdpAna?:Function, cdpEkArg?:string[]}} p
 */
async function cihazK4Olc(p) {
  const log = p.log || (() => {});
  const bas = Date.now();
  const kanit = path.join(p.kanitDizin, 'k4');
  fs.mkdirSync(kanit, { recursive: true });
  const olcum = { kaynak: 'cihaz', profilBos: true, cevaplar: [], e6: null, e7: null, kanit };
  const bitir = (sebep) => {
    olcum.e6 = olcum.e6 || { durum: 'OLCULEMEDI', sebep };
    olcum.e7 = olcum.e7 || { durum: 'OLCULEMEDI', ayrinti: sebep, oneri: '' };
    olcum.sureSn = Math.round((Date.now() - bas) / 1000);
    return olcum;
  };
  const pid = String((p.adbKos(['shell', 'pidof', p.paket]) || {}).stdout || '').trim().split(/\s+/)[0];
  if (!/^\d+$/.test(pid)) return bitir(`uygulama süreci yok (pidof ${p.paket})`);
  olcum.pid = Number(pid);
  const soket = webviewSoketiSec((p.adbKos(['shell', 'cat', '/proc/net/unix']) || {}).stdout, pid);
  if (!soket) {
    return bitir(`WebView hata ayıklama soketi yok (@webview_devtools_remote_${pid}) — uygulama WebView `
      + 'hata ayıklamasını açmıyor; cihazda ölçülemez');
  }
  olcum.soket = soket;
  const port = p.cdpPort || await bosPortBul(Number(process.env.KABUL_K4_ADB_PORT_TABAN) || ADB_PORT_TABANI);
  if (!port) return bitir('boş yerel port yok (adb forward)');
  const f = p.adbKos(['forward', `tcp:${port}`, `localabstract:${soket}`]) || {};
  if (f.status !== 0) return bitir(`adb forward düştü: ${String(f.stderr || f.stdout || '').trim().slice(0, 160)}`);
  olcum.cdpPort = port;
  log(`cihaz K4: WebView CDP ${soket} → 127.0.0.1:${port} (kaydedici + isOnline kancası + ilk kitap)`);
  // Çevrimiçi (kancalı) motor menüyü ağ zincirinden SONRA çizer ve soruları o an sorar: yeniden
  // yüklemeden menüye 46 sn ölçüldü (26.09, 74451, emülatör); 30 sn varsayılan soruyu kaçırıyordu.
  const sure = sureArgumanlari({ ...p, baglanSn: p.baglanSn || 15, menuSn: p.menuSn || CIHAZ_MENU_SN });
  try {
    Object.assign(olcum, await cdpOlc(['--port', String(port), '--kanit', kanit, '--hedef-deseni', ANDROID_HEDEF_DESENI,
      '--kaydedici', '1', '--cevrimici-sabitle', '1', ...sure.argv], kanit, p.cdpAna));
  } catch (e) {
    olcum.e6 = { durum: 'OLCULEMEDI', sebep: `CDP istemcisi hatası: ${e.message}` };
  } finally {
    p.adbKos(['forward', '--remove', `tcp:${port}`]);
  }
  olcum.indirmeKesildi = ((olcum.cevrimici && olcum.cevrimici.indirmeKesildi) || []).slice(0, 5);
  return bitir('CDP sonucu yok');
}

module.exports = {
  K4_DURUM,
  K4_KOD,
  K4_CIKIS,
  K4_TR,
  CDP_PORT_TABANI,
  ANDROID_HEDEF_DESENI,
  CIHAZ_MENU_SN,
  k4Etkin,
  paketSurumleriOku,
  k4Karari,
  yoklamaTanisi,
  k4Birlestir,
  genelKararK4,
  k4CikisKodu,
  guncellikKatmani,
  cdpSatirlariCoz,
  webviewSoketiSec,
  bosPortBul,
  kosumBaslat,
  electronK4Olc,
  cihazK4Olc,
};
