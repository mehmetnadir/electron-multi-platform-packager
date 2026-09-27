'use strict';
/**
 * Başsız kabul kapısı — ANDROID CİHAZ KATMANI (ikinci katman, APK'ya ek).
 *
 * Electron katmanı APK'nın `assets/public` ağacını masaüstü Chromium'da ölçer; bu katman
 * aynı APK'yı GERÇEK Android WebView'da (pencerisiz emülatör) kurar ve açar:
 *   emulator -avd <ad> -no-window -no-audio -no-boot-anim -read-only -port <boş port>
 *   → adb install → am start → bekle → screencap (ham RGBA) + uiautomator dump
 *   → aynı ölçütler (WebView alanında sapma/koyu/renk, kart, yükleniyor) → ilk karta dokun
 *   → okuyucu ölçümü → [K4: `p.k4Olc` kancası, WebView CDP] → adb uninstall → (biz başlattıysak) adb emu kill.
 *
 * Kurallar (Nadir 2026-09-26):
 *   • Emülatör penceresi AÇILMAZ (-no-window). -read-only: AVD kalıcı değişmez.
 *   • `TCDD_MITM` başka bir işin AVD'si — ASLA kullanılmaz.
 *   • Zaten koşan emülatöre DOKUNULMAZ; ayrı port seçilir, yalnız kendi başlattığımız öldürülür.
 * Ekran ölçümü WebView sınırlarına KIRPILIR: durum çubuğu/gezinme çubuğu koyu piksel ve
 * renk eklerse kırık "…" ekranı yanlışlıkla geçebilirdi.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const O = require('./olcutler');
const YK = require('./yuk-kapisi');

const YASAK_AVD = 'TCDD_MITM';
const VARSAYILAN_AVD = 'Pixel_Fold_API_35';
/**
 * Cihaz okuyucu aşaması üst sınırı (sn). Aşama iki ardışık yeterli ölçümde ERKEN biter;
 * sağlam pakette maliyeti yoktur. 27.09 45538 (English Up 5 Set): makine yükü ~100 iken
 * (kurulum 372 sn ≈ 3×, emülatörde 3 kez "System UI isn't responding") okuyucu ~85 sn'de
 * açıldı; 60 sn'lik sınır son ölçümü "Kitap Açılıyor.." karesinde aldı, hemen ardından
 * kaydedilen kitap.png ise açılmış okuyucuyu gösteriyordu → sahte RED.
 */
const CIHAZ_KITAP_SN = 120;

function sdkKoku() {
  return process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'Library', 'Android', 'sdk');
}

function aracBul() {
  const sdk = sdkKoku();
  const adbAday = [path.join(sdk, 'platform-tools', 'adb'), '/usr/local/bin/adb', '/opt/homebrew/bin/adb'];
  const adb = adbAday.find((a) => fs.existsSync(a)) || null;
  const emulator = [path.join(sdk, 'emulator', 'emulator')].find((a) => fs.existsSync(a)) || null;
  let aapt = null;
  try {
    const surumler = fs.readdirSync(path.join(sdk, 'build-tools')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    for (let i = surumler.length - 1; i >= 0 && !aapt; i -= 1) {
      const y = path.join(sdk, 'build-tools', surumler[i], 'aapt');
      if (fs.existsSync(y)) aapt = y;
    }
  } catch (_) { /* build-tools yok */ }
  return { adb, emulator, aapt, sdk };
}

/** Yük kapısı kanıtını (kosum.json) yazar; kanıt dizini yazılamazsa sessiz geçilir. Saf değil (fs). */
function yukKanitYaz(kanitDizin, veri) {
  try {
    fs.writeFileSync(path.join(kanitDizin, 'kosum.json'), JSON.stringify(veri, null, 2));
  } catch (_) { /* kanıt dizini yazılamadı — kabul sonucu bundan etkilenmez */ }
}

function kos(komut, argumanlar, secenek = {}) {
  const r = spawnSync(komut, argumanlar, { encoding: secenek.ham ? null : 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: secenek.zamanAsimiMs || 120000, ...secenek });
  return r;
}

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/** `aapt dump badging` çıktısından paket adı + başlatıcı etkinlik. Saf. */
function badgingCoz(cikti) {
  const s = String(cikti || '');
  const paket = (/package: name='([^']+)'/.exec(s) || [])[1] || null;
  const etkinlik = (/launchable-activity: name='([^']+)'/.exec(s) || [])[1] || null;
  const etiket = (/^application-label:'([^']*)'/m.exec(s) || [])[1] || null;
  return etiket ? { paket, etkinlik, etiket } : { paket, etkinlik };
}

/** `adb devices` çıktısından seri numaraları. Saf. */
function cihazlariCoz(cikti) {
  return String(cikti || '').split('\n')
    .map((l) => /^(\S+)\s+(device|offline|unauthorized)\b/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => ({ seri: m[1], durum: m[2] }));
}

/** Kullanımda olmayan en yüksek çift emülatör portu (5554–5584, adb'nin kendiliğinden bulduğu aralık). Saf. */
function bosPortSec(kullanilan = []) {
  const dolu = new Set(kullanilan.map(Number));
  for (let p = 5584; p >= 5554; p -= 2) {
    if (!dolu.has(p) && !dolu.has(p + 1)) return p;
  }
  return null;
}

/**
 * uiautomator XML dökümünden düğümler. Saf (basit öznitelik ayrıştırma — XML kütüphanesi yok).
 * @returns {Array<{sinif:string, metin:string, aciklama:string, tiklanir:boolean, sinir:{x1,y1,x2,y2}|null, paket:string}>}
 */
function uiDugumleri(xml) {
  const dugumler = [];
  const re = /<node\b([^>]*)\/?>/g;
  let m;
  const oz = (s, ad) => {
    const r = new RegExp(`\\b${ad}="([^"]*)"`).exec(s);
    return r ? r[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'") : '';
  };
  while ((m = re.exec(String(xml || '')))) {
    const a = m[1];
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(oz(a, 'bounds'));
    dugumler.push({
      sinif: oz(a, 'class'),
      metin: oz(a, 'text'),
      aciklama: oz(a, 'content-desc'),
      tiklanir: oz(a, 'clickable') === 'true',
      paket: oz(a, 'package'),
      kimlik: oz(a, 'resource-id'),
      sinir: b ? { x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4] } : null,
    });
  }
  return dugumler;
}

/** En büyük WebView'ın sınırları (ekran ölçümü buna kırpılır). Saf. */
function webViewSiniri(dugumler) {
  let en = null;
  for (const d of dugumler) {
    if (!/WebView/.test(d.sinif) || !d.sinir) continue;
    const alan = (d.sinir.x2 - d.sinir.x1) * (d.sinir.y2 - d.sinir.y1);
    if (!en || alan > en.alan) en = { ...d.sinir, alan };
  }
  return en;
}

/**
 * Menü kartlarını UI ağacında sayar: Web-Z kartının erişilebilirlik adı "<ad> kitabını aç",
 * sade/yayıncı menüsünde bağlantı metni kitap adı. Kitap adları set-menu.json'dan gelir.
 * Saf. @returns {Array<{anahtar:string, x:number, y:number}>}
 */
function cihazKartlari(dugumler, kitapAdlari = []) {
  const adlar = kitapAdlari.map((a) => String(a || '').trim().toLocaleLowerCase('tr')).filter(Boolean);
  const bulunan = new Map();
  for (const d of dugumler) {
    if (!d.sinir) continue;
    const etiket = `${d.aciklama || ''} ${d.metin || ''}`.trim();
    if (!etiket) continue;
    const kucuk = etiket.toLocaleLowerCase('tr');
    let anahtar = null;
    const acMi = /(.+?)\s+kitabını aç$/i.exec(etiket);
    if (acMi) anahtar = acMi[1].trim().toLocaleLowerCase('tr');
    else if (adlar.includes(kucuk)) anahtar = kucuk;
    if (!anahtar || bulunan.has(anahtar)) continue;
    bulunan.set(anahtar, {
      anahtar,
      x: Math.round((d.sinir.x1 + d.sinir.x2) / 2),
      y: Math.round((d.sinir.y1 + d.sinir.y2) / 2),
    });
  }
  return [...bulunan.values()];
}

/**
 * Sistem hata diyaloğu ("<uygulama> isn't responding" / "keeps stopping"). Ağır host
 * yükünde emülatörün KENDİ uygulamaları ANR verip ekranı örtüyor — 26.09 apk-bozuk
 * koşusunda "Messages isn't responding" WebView'ı kapattı, ölçüm "WebView yok" düştü.
 * Başkasınınki kapatılır (Close app), bizimki beklenir (Wait) ve kalırsa bulgu olur. Saf.
 * @returns {null|{baslik:string, kendi:boolean, dugme:{x:number,y:number}|null, dugmeAdi:string|null}}
 */
function sistemDiyalogu(dugumler, etiket) {
  const aerr = dugumler.filter((d) => /^android:id\/aerr_/.test(d.kimlik || ''));
  if (!aerr.length) return null;
  const baslikD = dugumler.find((d) => d.kimlik === 'android:id/alertTitle');
  const baslik = (baslikD && baslikD.metin) || '';
  const et = String(etiket || '').trim().toLocaleLowerCase('tr');
  const kendi = Boolean(et) && baslik.toLocaleLowerCase('tr').startsWith(et);
  const hedefKimlik = kendi ? 'android:id/aerr_wait' : 'android:id/aerr_close';
  const d = aerr.find((x) => x.kimlik === hedefKimlik && x.sinir)
    || (kendi ? null : aerr.find((x) => x.kimlik === 'android:id/aerr_wait' && x.sinir));
  return {
    baslik: baslik || '(başlıksız sistem diyaloğu)',
    kendi,
    dugme: d ? { x: Math.round((d.sinir.x1 + d.sinir.x2) / 2), y: Math.round((d.sinir.y1 + d.sinir.y2) / 2) } : null,
    dugmeAdi: d ? d.kimlik.replace('android:id/', '') : null,
  };
}

/**
 * `sistemDiyalogu` UI dökümündeki `aerr_*` düğümlerine dayanır — dökümün KENDİSİ hiç
 * çıkmadıysa (27.09 72379: host aşırı yüklüyken `uiautomator dump` UiAutomation'a
 * bağlanamadı, `/sdcard/empp-kabul-ui.xml` hiç yazılmadı, `cat` "No such file or
 * directory" döndürdü, düğüm sayısı 0) o fonksiyon hiçbir şey görmez ve ölçüm
 * "ekranda WebView yok" ile RED verir — ekranda asıl "Process system isn't responding /
 * Close app / Wait" sistem ANR diyaloğu vardı (menu.png). Bu, dökümün BAŞARISIZ OLDUĞU
 * durumda devreye giren yedek tanıyıcı: paket kusuru değil, altyapı arızası (ÖLÇÜLEMEDİ).
 * UYGULAMANIN KENDİ ANR'si ("<uygulama adı> isn't responding") EŞLEŞMEZ — yalnız özne
 * "system"/"system ui"/"system_server" olan diyaloglar (logcat'teki
 * "Timeout while connecting UiAutomation" de aynı kökten: UiAutomation, system_server'daki
 * AccessibilityManager'a bağlanamıyor — bu da system_server'ın yanıt vermediğinin kanıtı).
 * `gorunurMetin` şu an cihaz katmanında üretilmiyor (OCR yok, tek kanıt ham ekran görüntüsü);
 * parametre yalnız ileride bir metin çıkarma eklenirse diye — bugün her zaman undefined. Saf.
 * @returns {boolean}
 */
function sistemAnrMi({ uiXml, logcat, gorunurMetin } = {}) {
  const SISTEM_METIN = /\bsystem[\s_]?(ui|server)?\b[^.\n]{0,40}isn'?t\s+responding|\bprocess\s+system\s+isn'?t\s+responding/i;
  if (SISTEM_METIN.test(String(gorunurMetin || ''))) return true;
  if (SISTEM_METIN.test(String(uiXml || ''))) return true;
  const dokumBasarisiz = Boolean(uiXml) && !/<hierarchy\b/i.test(String(uiXml));
  const logcatSistemAnr = /Timeout while connecting UiAutomation|ANR in system(_server)?\b|system_server[^\n]{0,60}(isn'?t\s+responding|not\s+responding)/i
    .test(String(logcat || ''));
  return dokumBasarisiz && logcatSistemAnr;
}

/**
 * `!o.webView` (ekranda WebView yok) sonucunu RED / ÖLÇÜLEMEDİ arasında ayırır:
 * `sistemAnrMi` sistem ANR'si bulursa ekran örtülü sayılır (ortulen → ÖLÇÜLEMEDİ),
 * bulamazsa gerçek "ekranda WebView yok" RED'i kalır (27.09 72379). Saf.
 * @returns {{ortulen:boolean, mesaj:string}}
 */
function webViewYokKarari(ad, o, lcMetin) {
  if (sistemAnrMi({ uiXml: o && o.uiXmlHata, logcat: lcMetin })) {
    return { ortulen: true, mesaj: `${ad}: emülatör sistem ANR'si ("Process system isn't responding") ekranı örttü — altyapı, paket kusuru değil` };
  }
  return { ortulen: false, mesaj: `${ad}: ekranda WebView yok` };
}

/** UI ağacında görünür yükleniyor metni. Saf. */
function cihazYukleniyor(dugumler) {
  const desen = /^(yükleniyor|loading|kitap açılıyor|açılıyor|güncelleniyor)/i;
  return dugumler.filter((d) => desen.test((d.metin || d.aciklama || '').trim())).map((d) => `metin:${(d.metin || d.aciklama).trim().slice(0, 40)}`);
}

/**
 * Çok ekranlı cihazda (Pixel Fold: iç 2208×1840 + dış 1080×2092) etkin ekranın
 * SurfaceFlinger kimliği. `screencap` kimlik verilmezse stdout'a UYARI metni basıp
 * görüntüyü onunla kirletiyor (ölçüldü 26.09: PNG "[Warning] Multiple displays…" ile
 * başladı, ölçüm "ekran görüntüsü alınamadı" düştü). `dumpsys display` →
 * `DisplayViewport{… isActive=true, … uniqueId='local:<id>'`. Tek ekranda null. Saf.
 */
function etkinEkranCoz(dumpsysDisplay) {
  const re = /DisplayViewport\{[^}]*?isActive=true[^}]*?uniqueId='local:(\d+)'/g;
  const m = re.exec(String(dumpsysDisplay || ''));
  return m ? m[1] : null;
}

/** logcat satırlarını konsol satırına çevirir; Capacitor'un "asset yok"u = ERR_FILE_NOT_FOUND. Saf. */
function logcatKonsol(metin) {
  return String(metin || '').split('\n').filter(Boolean).map((l) => {
    const yok = /Unable to open asset URL:\s*(\S+)/.exec(l);
    if (yok) return { seviye: 'error', mesaj: `net::ERR_FILE_NOT_FOUND (Capacitor) ${yok[1]}` };
    return { seviye: /\sE\/|ERROR|Uncaught/.test(l) ? 'error' : 'info', mesaj: l };
  });
}

/** PNG çıktısının önündeki metni (screencap uyarısı) atar. Saf. */
function pngAyikla(tampon) {
  if (!tampon) return null;
  const imza = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const i = tampon.indexOf(imza);
  return i >= 0 ? tampon.subarray(i) : null;
}

/**
 * Ham `screencap` (başlık + RGBA) → {genislik, yukseklik, veri}. Başlık 12 ya da 16 bayt
 * (Android 10+ renk uzayı alanı ekler); boyuttan çıkarılır. Saf.
 */
function hamEkranCoz(tampon) {
  if (!tampon || tampon.length < 16) return null;
  const g = tampon.readUInt32LE(0);
  const y = tampon.readUInt32LE(4);
  const baslik = tampon.length - g * y * 4;
  if (!(g > 0 && y > 0) || (baslik !== 12 && baslik !== 16)) return null;
  return { genislik: g, yukseklik: y, veri: tampon.subarray(baslik) };
}

/** RGBA tamponunu bir dikdörtgene kırpar. Saf. */
function kirp(veri, genislik, yukseklik, s) {
  if (!s) return { veri, genislik, yukseklik };
  const x1 = Math.max(0, Math.min(genislik, s.x1));
  const y1 = Math.max(0, Math.min(yukseklik, s.y1));
  const x2 = Math.max(x1, Math.min(genislik, s.x2));
  const y2 = Math.max(y1, Math.min(yukseklik, s.y2));
  const g = x2 - x1;
  const h = y2 - y1;
  const cikti = Buffer.alloc(g * h * 4);
  for (let r = 0; r < h; r += 1) {
    const kaynak = ((y1 + r) * genislik + x1) * 4;
    cikti.set(veri.subarray(kaynak, kaynak + g * 4), r * g * 4);
  }
  return { veri: cikti, genislik: g, yukseklik: h };
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/**
 * `adb install` sonucundan tek satırlık sebep: çıkış kodu + stdout + stderr BİRLİKTE, son 300 karakter.
 * adb gerçek hatayı ("adb: failed to install …: Failure […]") stderr'e, "Performing Streamed Install"
 * satırını stdout'a basar — yalnız stdout gösterilince kök neden gizleniyordu (45482, 26.09). Saf.
 */
function kurulumSebebi(r) {
  const x = r || {};
  const parcalar = [x.stdout, x.stderr].map((v) => String(v || '').trim()).filter(Boolean);
  if (x.error) parcalar.push(`(${x.error.code || x.error.message || x.error})`);
  if (x.signal) parcalar.push(`(sinyal ${x.signal})`);
  const govde = parcalar.join(' | ').replace(/\s+/g, ' ').trim() || 'çıktı yok';
  return `rc=${x.status === undefined ? '?' : x.status} ${govde}`.slice(-300);
}

function adbKos(arac, seri, argumanlar, secenek = {}) {
  return kos(arac.adb, ['-s', seri, ...argumanlar], secenek);
}

/**
 * Kurulum düşünce kök nedeni ÖLÇÜLEBİLİR kılan döküm (kanıta `kurulum-tani.txt`): bağlantı durumu,
 * açılış bayrağı, system_server başlatma sayacı (yük altında yeniden başladıysa >1), /data boşluğu
 * ve PackageManager logcat satırları. 45482'de (26.09) emülatör kapandıktan sonra hiçbiri yoktu.
 */
function kurulumTanisi(arac, seri, dosya) {
  const k = (argumanlar, ms = 15000) => {
    const r = adbKos(arac, seri, argumanlar, { zamanAsimiMs: ms });
    return `${String(r.stdout || '').trim()} ${String(r.stderr || '').trim()}`.trim();
  };
  const tani = {
    durum: k(['get-state']),
    bootTamam: k(['shell', 'getprop', 'sys.boot_completed']),
    systemServerBaslatma: k(['shell', 'getprop', 'sys.system_server.start_count']),
    data: k(['shell', 'df', '/data']).split('\n').pop(),
  };
  const lc = k(['logcat', '-d', '-v', 'time', 'PackageManager:V', 'PackageInstaller:V', 'PackageInstallerSession:V',
    'InstallPackageHelper:V', 'AndroidRuntime:E', '*:S'], 30000);
  try {
    fs.writeFileSync(dosya, `${JSON.stringify(tani, null, 2)}\n--- logcat (PackageManager)\n${lc.split('\n').slice(-300).join('\n')}\n`);
  } catch (_) { /* kanıt dizini yazılamadı — tanı sonuçta yine var */ }
  return tani;
}

/**
 * Host aşırı yüklüyken (ölçüldü 26.09: load avg 133/10 çekirdek) virtio-wifi'nin sanal
 * "AndroidWifi" erişim noktasına DHCP kirası zaman aşımına uğrayabiliyor: wlan0 L2'de
 * BAĞLI (Supplicant COMPLETED) ama IP/DNS/varsayılan rota hiç gelmiyor, `dumpsys
 * connectivity` "Active default network: none" basıyor ve WebView "Network is offline"
 * ile açılıyor — kod/DNS-sunucusu/uçak-kipi sorunu DEĞİL. `svc wifi disable`+`enable`
 * DHCP'yi yeniden tetikliyor, birkaç saniyede VALIDATED oluyor (ölçüldü). Saf değil (adb).
 * @returns {Promise<boolean>} ağ VALIDATED oldu mu
 */
async function agHazirBekle(arac, seri, log, zamanAsimiSn = 20) {
  const hazirMi = () => /VALIDATED/.test(String(adbKos(arac, seri, ['shell', 'dumpsys', 'connectivity'], { zamanAsimiMs: 8000 }).stdout || ''));
  const beklermisin = async (sn) => {
    const bas = Date.now();
    while ((Date.now() - bas) / 1000 < sn) {
      if (hazirMi()) return true;
      await bekle(2000);
    }
    return false;
  };
  if (await beklermisin(zamanAsimiSn)) return true;
  log('cihaz: ağ VALIDATED olmadı (DHCP zaman aşımı olası) — wifi kapat/aç ile yeniden tetikleniyor');
  adbKos(arac, seri, ['shell', 'svc', 'wifi', 'disable']);
  await bekle(2000);
  adbKos(arac, seri, ['shell', 'svc', 'wifi', 'enable']);
  const tamam = await beklermisin(zamanAsimiSn);
  log(`cihaz: ağ yeniden deneme sonucu — ${tamam ? 'VALIDATED' : 'hâlâ ağsız'}`);
  return tamam;
}

async function bootBekle(arac, seri, zamanAsimiSn, log, bitti = () => false) {
  const bas = Date.now();
  let son = '';
  while ((Date.now() - bas) / 1000 < zamanAsimiSn) {
    if (bitti()) return null; // emülatör süreci çıktı — beklemenin anlamı yok
    const r = adbKos(arac, seri, ['shell', 'getprop', 'sys.boot_completed'], { zamanAsimiMs: 8000 });
    son = String(r.stdout || '').trim();
    if (son === '1') return Math.round((Date.now() - bas) / 1000);
    if (Math.round((Date.now() - bas) / 1000) % 30 < 3) log(`emülatör açılıyor… ${Math.round((Date.now() - bas) / 1000)} sn`);
    await bekle(3000);
  }
  return null;
}

function ekranArg(ekranId) {
  return ekranId ? ['-d', String(ekranId)] : [];
}

function ekranOlc(arac, seri, sinir, ekranId) {
  const r = adbKos(arac, seri, ['exec-out', 'screencap', ...ekranArg(ekranId)], { ham: true, zamanAsimiMs: 30000 });
  const e = hamEkranCoz(r.stdout);
  if (!e) return null;
  const k = kirp(e.veri, e.genislik, e.yukseklik, sinir);
  return { ...O.pikselMetrikleri(k.veri, k.genislik, k.yukseklik, { duzen: 'rgba' }), ekran: `${e.genislik}x${e.yukseklik}` };
}

function uiDokum(arac, seri, hedefXml) {
  adbKos(arac, seri, ['shell', 'uiautomator', 'dump', '/sdcard/empp-kabul-ui.xml'], { zamanAsimiMs: 30000 });
  const r = adbKos(arac, seri, ['exec-out', 'cat', '/sdcard/empp-kabul-ui.xml'], { zamanAsimiMs: 15000 });
  const xml = String(r.stdout || '');
  if (hedefXml && xml) fs.writeFileSync(hedefXml, xml);
  return xml;
}

function pngKaydet(arac, seri, hedef, ekranId) {
  const r = adbKos(arac, seri, ['exec-out', 'screencap', '-p', ...ekranArg(ekranId)], { ham: true, zamanAsimiMs: 30000 });
  const png = r.status === 0 ? pngAyikla(r.stdout) : null;
  if (png && png.length > 100) { fs.writeFileSync(hedef, png); return hedef; }
  return null;
}

/** Bir aşamayı ölçer (her 3 sn): UI dökümü + WebView'a kırpılmış ekran. */
async function asamaOlc(arac, seri, { paket, etiket, kitapAdlari, beklemeSn, yeterli, kanitDizin, ad, ekranId, diyaloglar = [] }) {
  const bas = Date.now();
  let son = null;
  let ardisik = 0;
  while ((Date.now() - bas) / 1000 < beklemeSn) {
    await bekle(3000);
    const xml = uiDokum(arac, seri, null);
    const dugumler = uiDugumleri(xml);
    const diyalog = sistemDiyalogu(dugumler, etiket);
    if (diyalog) {
      // Ekran örtülü: ölçüm yapma; diyaloğu kapat, sonraki turda yeniden ölç.
      diyaloglar.push({ asama: ad, sn: Math.round((Date.now() - bas) / 1000), ...diyalog });
      if (diyalog.dugme) adbKos(arac, seri, ['shell', 'input', 'tap', String(diyalog.dugme.x), String(diyalog.dugme.y)]);
      son = { ...(son || {}), diyalog, xml };
      ardisik = 0;
      continue;
    }
    const sinir = webViewSiniri(dugumler);
    const piksel = ekranOlc(arac, seri, sinir, ekranId);
    const pid = String(adbKos(arac, seri, ['shell', 'pidof', paket], { zamanAsimiMs: 8000 }).stdout || '').trim();
    son = {
      piksel,
      webView: sinir,
      kartlar: cihazKartlari(dugumler, kitapAdlari),
      yukleniyor: cihazYukleniyor(dugumler),
      surecCanli: Boolean(pid),
      dugumSayisi: dugumler.length,
      diyalog: null,
      xml,
    };
    son.kartSayisi = son.kartlar.length;
    if (yeterli(son)) { ardisik += 1; if (ardisik >= 2) break; } else ardisik = 0;
  }
  son = son || {};
  son.beklenenSn = Math.round((Date.now() - bas) / 1000);
  son.ekran = pngKaydet(arac, seri, path.join(kanitDizin, `${ad}.png`), ekranId);
  if (son.xml) fs.writeFileSync(path.join(kanitDizin, `${ad}-ui.xml`), son.xml);
  // Normal döküm binlerce baytlık gerçek hiyerarşidir (buraya taşınmaz); dump BAŞARISIZ olup
  // kısa bir kabuk hatası döndüyse ("cat: … No such file or directory") sistemAnrMi bunu
  // görsün diye küçük halde saklanır (27.09 72379).
  son.uiXmlHata = son.xml && son.xml.length < 500 && !/<hierarchy\b/i.test(son.xml) ? son.xml.trim().slice(0, 300) : null;
  delete son.xml;
  return son;
}

/**
 * @param {{apk:string, kanit:string, avd?:string, beklenenKart:number, setMi:boolean,
 *          kitapAdlari?:string[], aktivasyon?:boolean, log?:Function,
 *          bootSn?:number, menuBekleSn?:number, kitapBekleSn?:number,
 *          mevcutSeri?:string, kurulumYok?:boolean,
 *          onKapiEsigi?:number, sonSinifEsigi?:number, yukAraSn?:number, yukAzamiSn?:number,
 *          yukOlc?:Function, yukBekle?:Function}} p
 *   `mevcutSeri`: ZATEN koşan emülatörde ölç (başlatma/kapatma yok) — uzaktan güncelleme (G)
 *   gibi cihaz durumunu değiştiren bir adımın ÖNCESİ ve SONRASI aynı ölçütle ölçülsün diye.
 *   `kurulumYok`: paket kurulu kalır (kurma/kaldırma yok); uygulama `am start -S` ile baştan açılır.
 *   `onKapiEsigi`/`sonSinifEsigi`/`yukAraSn`/`yukAzamiSn`/`yukOlc`/`yukBekle`: yük kapısı
 *   (`yuk-kapisi.js`) enjeksiyonu — testte sahte yük/zaman verir, üretimde `undefined` bırakılır
 *   (varsayılanlar: ön kapı çekirdek×12, son sınıflandırma çekirdek×6 — İKİ FARKLI EŞİK,
 *   27.09 koordinatör düzeltmesi: tek eşik [çekirdek×3] normal-yoğun 100-130 aralığını da
 *   durdururdu).
 * @returns {Promise<{durum:string, sebepler:string[], notlar:string[], ...}>}
 */
async function cihazKabulu(p) {
  const log = p.log || (() => {});
  const sonuc = { durum: O.DURUM.OLCULEMEDI, sebepler: [], notlar: [], sistemDiyaloglari: [] };
  const kanitDizin = path.join(p.kanit, 'android');
  fs.mkdirSync(kanitDizin, { recursive: true });

  // yükKayit: {asama, yuk} — kosum.json kalibrasyonu için etiketli örnekler (koordinatör
  // 27.09: "başlangıç, açılış, karar, en yüksek, ortalama"). yukSayilari sonSiniflandirma'ya
  // giden düz dizi — tek kaynaktan türetilir, ikisi ıraksamaz.
  const yukKayit = [];
  const yukOrnekAl = (asama) => { const yuk = YK.birDkYuk(p.yukOlc); yukKayit.push({ asama, yuk }); return yuk; };
  const yukKanitYazVer = (ek = {}) => {
    yukKanitYaz(kanitDizin, { yukKapisi: sonuc.yukKapisi, yukOrnekleri: yukKayit, ozet: YK.yukOzeti(yukKayit), ...ek });
  };

  // YÜK KAPISI — ÖN KAPI (27.09 45482, load avg 138/142/101): emülatör AÇILMADAN önce host
  // yükü eşiğin altına düşene kadar beklenir; düşmezse emülatör hiç başlatılmadan
  // ÖLÇÜLEMEDİ ile ertelenir (adb/AVD denetiminden ÖNCE — bu kapı ortam kurulu olsun
  // olmasın, host meşgulken devreye girer). YÜKSEK eşik (varsayılan çekirdek×12) — yalnız
  // aşırı uçta durdurur, normal-yoğun dönemi (100-130) engellemez.
  const onKapi = await YK.onKapiBekle({
    esik: p.onKapiEsigi, araSn: p.yukAraSn, azamiSn: p.yukAzamiSn, yukOlc: p.yukOlc, bekle: p.yukBekle, log,
  });
  for (const yuk of onKapi.ornekler) yukKayit.push({ asama: 'on-kapi', yuk });
  yukKayit.push({ asama: 'baslangic', yuk: onKapi.sonYuk }); // gate'in geçtiği/son örneklediği yük
  sonuc.yukKapisi = {
    esik: onKapi.esik, gecti: onKapi.gecti, sonYuk: onKapi.sonYuk, beklenenSn: onKapi.beklenenSn,
  };
  yukKanitYazVer();
  if (!onKapi.gecti) {
    sonuc.sebepler.push(`makine yükü eşiği aştı (1dk=${onKapi.sonYuk.toFixed(1)} > eşik=${onKapi.esik.toFixed(1)}, `
      + `${onKapi.beklenenSn} sn beklendi) — emülatör açılmadı, iş ertelenmeli`);
    sonuc.yukOrnekleri = yukKayit;
    return sonuc; // durum zaten OLCULEMEDI
  }

  const arac = aracBul();
  if (!arac.adb || !arac.emulator) {
    sonuc.sebepler.push(`Android araçları yok (adb=${arac.adb || '—'}, emulator=${arac.emulator || '—'})`);
    return sonuc;
  }
  const adaylar = avdAdaylari(p.avd || process.env.EMPP_KABUL_AVD);
  if (!adaylar.length) {
    sonuc.sebepler.push(`${YASAK_AVD} başka bir işin AVD'si — kullanılmaz; başka AVD yok`);
    return sonuc;
  }

  let paketBilgi = { paket: null, etkinlik: null };
  if (arac.aapt) paketBilgi = badgingCoz(kos(arac.aapt, ['dump', 'badging', p.apk], { zamanAsimiMs: 60000 }).stdout);
  if (!paketBilgi.paket) {
    sonuc.sebepler.push('APK paket adı okunamadı (aapt dump badging)');
    return sonuc;
  }
  sonuc.paket = paketBilgi.paket;

  const oncekiler = cihazlariCoz(kos(arac.adb, ['devices']).stdout);
  const kullanilan = oncekiler.map((c) => Number((/^emulator-(\d+)$/.exec(c.seri) || [])[1])).filter(Boolean);
  const mevcut = p.mevcutSeri || null;
  const port = mevcut ? null : bosPortSec(kullanilan);
  if (!mevcut && !port) { sonuc.sebepler.push('boş emülatör portu yok'); return sonuc; }
  const seri = mevcut || `emulator-${port}`;
  sonuc.emulator = { seri, oncekiCihazlar: oncekiler.map((c) => c.seri), denemeler: [] };

  let emu = null;
  let emuCikti = null;
  let emuLog = null;
  let kurulu = false;
  try {
    let bootSn = mevcut ? 0 : null;
    if (mevcut) sonuc.emulator.mevcut = true;
    for (const avd of (mevcut ? [] : adaylar)) {
      log(`cihaz: ${avd} pencerisiz başlatılıyor (port ${port}; önceden koşan: ${oncekiler.map((c) => c.seri).join(',') || 'yok'})`);
      const logYolu = path.join(kanitDizin, `emulator-${avd}.log`);
      emuLog = fs.openSync(logYolu, 'w');
      const emuArg = ['-avd', avd, '-no-window', '-no-audio', '-no-boot-anim', '-read-only', '-port', String(port),
        '-gpu', process.env.EMPP_KABUL_EMU_GPU || 'swiftshader_indirect',
        '-memory', process.env.EMPP_KABUL_EMU_RAM || '3072', '-no-snapshot-save'];
      emuCikti = null;
      emu = spawn(arac.emulator, emuArg, { detached: true, stdio: ['ignore', emuLog, emuLog] });
      const buEmu = emu;
      buEmu.on('exit', (k, sg) => { if (buEmu === emu) emuCikti = { kod: k, sinyal: sg }; });
      sonuc.emulator.avd = avd;
      sonuc.emulator.pid = emu.pid;
      // Kapı dışarıdan öldürülürse (runner zaman aşımı) yetim emülatör kalmasın: çağıran bu
      // dosyadan süreç grubunu bulup kapatır (basliksiz-kabul-kapisi.js artikTemizle).
      if (p.durumDosyasi) {
        try { fs.writeFileSync(p.durumDosyasi, JSON.stringify({ pid: emu.pid, seri, avd })); } catch (_) { /* yok */ }
      }
      sonuc.emulator.komut = `emulator ${emuArg.join(' ')}`;
      bootSn = await bootBekle(arac, seri, p.bootSn || 240, log, () => Boolean(emuCikti));
      const deneme = { avd, bootSn, cikti: emuCikti };
      if (bootSn === null) {
        let son = '';
        try { son = fs.readFileSync(logYolu, 'utf8').split('\n').filter((l) => /ERROR|FATAL/.test(l)).slice(-2).join(' | '); } catch (_) { /* yok */ }
        deneme.hata = son || 'açılmadı';
        log(`cihaz: ${avd} açılamadı — ${deneme.hata}`);
        sonuc.emulator.denemeler.push(deneme);
        await emulatoruKapat(arac, seri, emu, () => emuCikti);
        fs.closeSync(emuLog);
        emuLog = null;
        emu = null;
        continue;
      }
      sonuc.emulator.denemeler.push(deneme);
      break;
    }
    if (bootSn === null) {
      sonuc.sebepler.push(`emülatör açılamadı (${sonuc.emulator.denemeler.map((d) => `${d.avd}: ${d.hata}`).join(' ; ')})`);
      return sonuc;
    }
    sonuc.emulator.acilisSn = bootSn;
    const tur = emu ? (kos('lsappinfo', ['info', '-only', 'ApplicationType', String(emu.pid)]).stdout || '') : '';
    sonuc.emulator.uygulamaTuru = (/"ApplicationType"="([^"]*)"/.exec(tur) || [])[1] || 'kayıtsız (GUI uygulaması değil)';
    log(`cihaz: açıldı (${bootSn} sn) · emülatör süreç türü ${sonuc.emulator.uygulamaTuru}`);
    yukOrnekAl('acilis'); // yük örneği: açılış (kabul boyunca her aşamada)
    // Ekran uykusu/kilidi ölçümü bozmasın.
    adbKos(arac, seri, ['shell', 'svc', 'power', 'stayon', 'true']);
    adbKos(arac, seri, ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
    adbKos(arac, seri, ['shell', 'wm', 'dismiss-keyguard']);
    // "Viewing full screen / Got it" tanıtım penceresi uygulamanın ÜSTÜNE biniyor: ui dökümü
    // yalnız onu görüyor, WebView hiç görünmüyordu (ölçüldü 26.09). -read-only: kalıcı değil.
    adbKos(arac, seri, ['shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed']);
    const ekranId = etkinEkranCoz(adbKos(arac, seri, ['shell', 'dumpsys', 'display'], { zamanAsimiMs: 30000 }).stdout);
    sonuc.emulator.ekranId = ekranId;
    sonuc.emulator.agHazir = await agHazirBekle(arac, seri, log);
    if (!sonuc.emulator.agHazir) sonuc.sebepler.push('ağ VALIDATED olmadı (DHCP zaman aşımı, host yükünü kontrol et) — ölçüm ağsız devam edebilir');

    if (!p.kurulumYok) {
      const kurBas = Date.now();
      const kur = adbKos(arac, seri, ['install', '-r', '-g', p.apk], { zamanAsimiMs: 600000 });
      sonuc.kurulumSn = Math.round((Date.now() - kurBas) / 1000);
      if (kur.status !== 0 || !/Success/.test(String(kur.stdout))) {
        sonuc.sebepler.push(`adb install düştü: ${kurulumSebebi(kur)}`);
        sonuc.kurulumTanisi = kurulumTanisi(arac, seri, path.join(kanitDizin, 'kurulum-tani.txt'));
        return sonuc;
      }
      kurulu = true;
      log(`cihaz: kuruldu (${sonuc.kurulumSn} sn) — ${paketBilgi.paket}`);
    } else {
      log(`cihaz: kurulu paket kullanılıyor (kurulum/kaldırma yok) — ${paketBilgi.paket}`);
    }
    yukOrnekAl('kurulum'); // yük örneği: kurulum/açılış sonrası
    adbKos(arac, seri, ['logcat', '-c']);
    const hedef = paketBilgi.etkinlik ? `${paketBilgi.paket}/${paketBilgi.etkinlik}` : null;
    const bas = hedef
      ? adbKos(arac, seri, ['shell', 'am', 'start', '-W', ...(p.kurulumYok ? ['-S'] : []), '-n', hedef], { zamanAsimiMs: 60000 })
      : adbKos(arac, seri, ['shell', 'monkey', '-p', paketBilgi.paket, '-c', 'android.intent.category.LAUNCHER', '1']);
    sonuc.baslat = String(bas.stdout || '').trim().split('\n').slice(-3).join(' | ');

    const kitapAdlari = p.kitapAdlari || [];
    const menuYeterli = (o) => o.surecCanli && !o.yukleniyor.length && O.pikselKarari(o.piksel, { aktivasyon: p.aktivasyon }).gecti
      && (!p.setMi || o.kartSayisi >= p.beklenenKart);
    const menu = await asamaOlc(arac, seri, {
      paket: paketBilgi.paket, etiket: paketBilgi.etiket, kitapAdlari, beklemeSn: p.menuBekleSn || 60, yeterli: menuYeterli,
      kanitDizin, ad: 'menu', ekranId, diyaloglar: sonuc.sistemDiyaloglari,
    });
    sonuc.menu = menu;
    yukOrnekAl('menu'); // yük örneği: menü ölçümü sonrası
    if (p.setMi && menu.kartlar && menu.kartlar.length) {
      const kart = menu.kartlar[0];
      adbKos(arac, seri, ['shell', 'input', 'tap', String(kart.x), String(kart.y)]);
      sonuc.ileriAdim = { kart };
      const kitapYeterli = (o) => o.surecCanli && !o.yukleniyor.length && O.pikselKarari(o.piksel, { aktivasyon: p.aktivasyon }).gecti
        && !o.kartSayisi;
      sonuc.kitap = await asamaOlc(arac, seri, {
        paket: paketBilgi.paket, etiket: paketBilgi.etiket, kitapAdlari, beklemeSn: p.kitapBekleSn || CIHAZ_KITAP_SN, yeterli: kitapYeterli,
        kanitDizin, ad: 'kitap', ekranId, diyaloglar: sonuc.sistemDiyaloglari,
      });
      yukOrnekAl('okuyucu'); // yük örneği: okuyucu ölçümü sonrası
    }
    const lc = adbKos(arac, seri, ['logcat', '-d', '-v', 'time', 'chromium:V', 'Capacitor/Console:V', 'Capacitor:V', 'AndroidRuntime:E', '*:S'],
      { zamanAsimiMs: 30000 });
    const lcMetin = String(lc.stdout || '');
    fs.writeFileSync(path.join(kanitDizin, 'logcat.txt'), lcMetin);
    const konsol = O.konsolSiniflandir(logcatKonsol(lcMetin));
    sonuc.konsol = {
      dosyaBulunamadi: konsol.dosyaBulunamadi.length, jsHatalari: konsol.jsHatalari.length,
      ornekDosya: konsol.dosyaBulunamadi.slice(0, 5), ornekJs: konsol.jsHatalari.slice(0, 5),
    };

    // K4 (güncellik) kancası — uygulama hâlâ açıkken, kaldırmadan ÖNCE. Cihaz kararını
    // DEĞİŞTİRMEZ; ölçüm `sonuc.k4`'e yazılır, kararı basliksiz-kabul.js (k4-guncellik.js) verir.
    if (typeof p.k4Olc === 'function') {
      try {
        sonuc.k4 = await p.k4Olc({
          paket: paketBilgi.paket, kanitDizin, log, adbKos: (argumanlar, secenek) => adbKos(arac, seri, argumanlar, secenek),
        });
      } catch (e) {
        sonuc.k4 = { kaynak: 'cihaz', e6: { durum: 'OLCULEMEDI', sebep: `K4 kancası düştü: ${e.message}` }, cevaplar: [] };
      }
    }

    // Karar (Electron katmanıyla aynı ölçüt kümesi, cihazda görülebilen kadarı).
    const sebepler = [];
    const ortulen = [];
    const asamaSebep = (ad, o, setMenu) => {
      if (!o) return;
      if (o.diyalog && o.diyalog.kendi) {
        sebepler.push(`${ad}: uygulama yanıt vermiyor — sistem diyaloğu "${o.diyalog.baslik}" ${o.beklenenSn} sn sonra hâlâ ekranda`);
        return;
      }
      if (o.diyalog) { ortulen.push(`${ad}: "${o.diyalog.baslik}" (emülatörün kendi uygulaması) ekranı örttü, kapatılamadı`); return; }
      if (!o.surecCanli) sebepler.push(`${ad}: uygulama süreci kapandı`);
      if (!o.webView) {
        // UI dökümü hiç çıkmadığı için `sistemDiyalogu` diyaloğu göremedi — logcat'teki
        // UiAutomation zaman aşımı (system_server yanıt vermiyor) yedek kanıt olarak kontrol edilir.
        const k = webViewYokKarari(ad, o, lcMetin);
        if (k.ortulen) ortulen.push(k.mesaj); else sebepler.push(k.mesaj);
      }
      if (setMenu && o.kartSayisi !== p.beklenenKart) sebepler.push(`${ad}: menü kartı ${o.kartSayisi} ≠ beklenen ${p.beklenenKart}`);
      if (o.yukleniyor && o.yukleniyor.length) sebepler.push(`${ad}: ${o.beklenenSn} sn sonra hâlâ yükleniyor (${o.yukleniyor.join(', ')})`);
      const pk = O.pikselKarari(o.piksel, { aktivasyon: p.aktivasyon });
      if (pk.olculemedi) sebepler.push(`${ad}: ekran görüntüsü alınamadı`);
      else if (!pk.gecti) sebepler.push(`${ad}: ${pk.sebep}`);
    };
    asamaSebep(p.setMi ? 'cihaz menü' : 'cihaz okuyucu', menu, p.setMi);
    if (p.setMi && menu.kartlar && menu.kartlar.length) asamaSebep('cihaz okuyucu', sonuc.kitap, false);
    for (const r of konsol.redImzalari) sebepler.push(`cihaz konsol: ${r}`);
    for (const d of sonuc.sistemDiyaloglari) {
      sonuc.notlar.push(`sistem diyaloğu (${d.asama}, ${d.sn}. sn): "${d.baslik}" → ${d.dugmeAdi || 'düğme yok'}`);
    }

    // YÜK KAPISI — SON SINIFLANDIRMA (27.09 45482, koordinatör düzeltmesi 27.09 gece): cihaz
    // katmanının TÜM sebepleri bilinen altyapı (host yükü) imzalarındaysa VE kabul boyunca
    // örneklenen yük eşiği (DÜŞÜK tutulan `sonSinifEsigi`, varsayılan çekirdek×6) aştıysa RED
    // ÖLÇÜLEMEDİ'ye çevrilir — mevcut `ortulen` mekanizması yeniden kullanılır (aşağıdaki
    // "ortulen && !sebepler" dalı zaten OLCULEMEDI döndürüyor). Yük normalken (72379 dersi:
    // sahte ÖLÇÜLEMEDİ'ye kaçış da yasak) ya da bilinmeyen bir sebep karışmışsa RED KALIR.
    const kararYuku = yukOrnekAl('karar'); // yük örneği: karar anı
    sonuc.yukOrnekleri = yukKayit;
    const yukSayilari = yukKayit.map((k) => k.yuk);
    const yukSiniflandirma = YK.sonSiniflandirma({ sebepler, yukOrnekleri: yukSayilari, esik: p.sonSinifEsigi });
    sonuc.yukSiniflandirma = yukSiniflandirma;
    if (yukSiniflandirma.ortulenMi) {
      const enYuksek = yukSiniflandirma.enYuksekYuk.toFixed(1);
      const esikTxt = yukSiniflandirma.esik.toFixed(1);
      ortulen.push(...sebepler.map((s) => `${s} (host yükü ${enYuksek} > eşik ${esikTxt} sırasında oluştu — altyapı, paket kusuru DEĞİL)`));
      sebepler.length = 0;
    }
    const yukOzet = YK.yukOzeti(yukKayit);
    log(`yük kapısı: karar anı 1dk=${kararYuku.toFixed(1)} · en yüksek=${yukOzet.enYuksek.toFixed(1)}`
      + ` · ortalama=${yukOzet.ortalama.toFixed(1)} · son sınıf eşiği=${yukSiniflandirma.esik.toFixed(1)}`);
    yukKanitYazVer({ yukSiniflandirma });

    if (ortulen.length && !sebepler.length) {
      // Ekranı başka bir uygulamanın diyaloğu örttüyse ya da yük kapısı devreye girdiyse
      // paket hakkında hüküm verilemez.
      sonuc.sebepler = ortulen;
      sonuc.durum = O.DURUM.OLCULEMEDI;
      return sonuc;
    }
    sonuc.notlar.push(...ortulen);
    sonuc.sebepler = sebepler;
    sonuc.durum = sebepler.length ? O.DURUM.RED : O.DURUM.GECTI;
    return sonuc;
  } finally {
    if (kurulu) {
      const k = adbKos(arac, seri, ['uninstall', paketBilgi.paket], { zamanAsimiMs: 120000 });
      sonuc.kaldirildi = /Success/.test(String(k.stdout));
      log(`cihaz: paket kaldırıldı (${sonuc.kaldirildi ? 'ok' : 'olmadı'})`);
    }
    // Yalnız KENDİ başlattığımız emülatör kapatılır.
    if (emu) {
      const temiz = await emulatoruKapat(arac, seri, emu, () => emuCikti);
      if (!temiz) sonuc.notlar.push('emülatör emu kill ile kapanmadı, süreç grubu öldürüldü');
      sonuc.emulator.kapandi = true;
      log(`cihaz: emülatör kapatıldı (${seri})`);
    }
    if (emuLog !== null) { try { fs.closeSync(emuLog); } catch (_) { /* kapalı */ } }
    if (p.durumDosyasi) { try { fs.writeFileSync(p.durumDosyasi, JSON.stringify({ kapandi: true, seri })); } catch (_) { /* yok */ } }
  }
}

/** Kendi başlattığımız emülatörü kapatır: önce `adb emu kill`, 20 sn sonra süreç grubu. */
async function emulatoruKapat(arac, seri, emu, cikti) {
  if (!cikti()) adbKos(arac, seri, ['emu', 'kill'], { zamanAsimiMs: 15000 });
  for (let i = 0; i < 20 && !cikti(); i += 1) await bekle(1000);
  if (cikti()) return true;
  try { process.kill(-emu.pid, 'SIGKILL'); } catch (_) { /* ölü */ }
  return false;
}

/**
 * Denenecek AVD'ler: verilmişse yalnız o; yoksa varsayılan sıra. TCDD_MITM daima dışarıda.
 * Saf. (Pixel_Fold yatay ekranlı — tahta uygulaması yatay; Pixel_8_Pro'da 9 Eylül'den kalma
 * bayat kilit dosyası var: "A snapshot operation ... is pending" ile çıkıyor.)
 */
function avdAdaylari(verilen) {
  const liste = verilen ? [verilen] : ['Pixel_Fold_API_35', 'Pixel_8_Pro_API_35'];
  return liste.filter((a) => a && a !== YASAK_AVD);
}

module.exports = {
  YASAK_AVD,
  VARSAYILAN_AVD,
  CIHAZ_KITAP_SN,
  avdAdaylari,
  badgingCoz,
  kurulumSebebi,
  cihazlariCoz,
  bosPortSec,
  uiDugumleri,
  sistemDiyalogu,
  sistemAnrMi,
  webViewYokKarari,
  webViewSiniri,
  cihazKartlari,
  cihazYukleniyor,
  hamEkranCoz,
  kirp,
  etkinEkranCoz,
  logcatKonsol,
  pngAyikla,
  cihazKabulu,
};
