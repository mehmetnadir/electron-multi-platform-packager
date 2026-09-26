#!/usr/bin/env node
'use strict';
/**
 * G ANDROID — CANLI UÇTAN UCA sürücüsü (gerçek APK · pencerisiz emülatör · gerçek WebView).
 * Her komut KISA sürer (≤ ~110 sn); emülatör ayrı süreçte (agir.sh) koşar, bu araç ona bağlanır.
 * Sunucu: tools/g-android/g-test-sunucu.js (127.0.0.1:8443, `adb reverse` ile cihaza).
 *
 *   node tools/g-android/g-canli-e2e.js <komut> --seri emulator-5584 [--apk <apk>] …
 *     hazirla                 açılış bekle, ekran açık, tanıtım penceresi kapalı, adb reverse 8443
 *     kur                     adb install -r -g
 *     baslat                  am start -S -W (uygulamayı baştan aç)
 *     tetikle                 CDP: G kısıtını (empp_g_son) sil + sayfayı yeniden yükle → ~10 sn sonra G koşar
 *     sonuc  [--bekle 100]    logcat'te "[EMPP_G] sonuç:" satırını bekle; rapor JSON'unu bas
 *     durum                   run-as: files/empp-g/durum.txt + dizin özeti (katmanın kesin durumu)
 *     cdp --ifade '<js>'      sayfada ifade değerlendir (await edilir), sonucu JSON bas
 *     kabul --etiket once|sonra --kanit <dizin> [--kart 3]
 *                             başsız kabulün cihaz katmanı, KURULU paketle (kurma/kaldırma yok);
 *                             ANR diyaloğu ÖLÇÜLEMEDİ sayılır (yük altında sahte RED, 26.09)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { jsonGetir, wsBaglan, CdpOturum } = require('../kabul/cdp-istemci');
const { badgingCoz, cihazKabulu } = require('../kabul/android-cihaz');

function arg(ad, v = null) {
  const i = process.argv.indexOf(`--${ad}`);
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : v;
}
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

function sdk() {
  return process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'Library', 'Android', 'sdk');
}
const ADB = path.join(sdk(), 'platform-tools', 'adb');
function aapt() {
  const k = path.join(sdk(), 'build-tools');
  const s = fs.readdirSync(k).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).reverse();
  for (const v of s) if (fs.existsSync(path.join(k, v, 'aapt'))) return path.join(k, v, 'aapt');
  return null;
}
function adb(seri, a, zamanAsimiMs = 60000) {
  const r = spawnSync(ADB, ['-s', seri, ...a], { encoding: 'utf8', timeout: zamanAsimiMs, maxBuffer: 64 * 1024 * 1024 });
  return { kod: r.status, cikti: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}
function paketBilgisi(apk) {
  const r = spawnSync(aapt(), ['dump', 'badging', apk], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  const b = badgingCoz(r.stdout);
  if (!b.paket) throw new Error('aapt: paket adı okunamadı');
  return b;
}

/** WebView devtools soketi → CDP oturumu (debug APK: Capacitor WebView hata ayıklaması açık). */
async function cdpAc(seri, paket) {
  const pid = adb(seri, ['shell', 'pidof', paket]).cikti.split(/\s+/)[0];
  if (!pid) throw new Error('uygulama koşmuyor (pidof boş)');
  const soketler = adb(seri, ['shell', 'cat', '/proc/net/unix']).cikti;
  const ad = (new RegExp(`@(webview_devtools_remote_${pid})\\b`).exec(soketler) || [])[1];
  if (!ad) throw new Error(`webview_devtools_remote_${pid} yok (WebView hata ayıklaması kapalı?)`);
  const port = 9333;
  adb(seri, ['forward', `tcp:${port}`, `localabstract:${ad}`]);
  const hedefler = await jsonGetir(`http://127.0.0.1:${port}/json`, 5000);
  const sayfa = (hedefler || []).find((h) => h.type === 'page' && h.webSocketDebuggerUrl);
  if (!sayfa) throw new Error(`sayfa hedefi yok: ${JSON.stringify(hedefler).slice(0, 300)}`);
  const u = new URL(sayfa.webSocketDebuggerUrl);
  u.hostname = '127.0.0.1';
  u.port = String(port);
  return { oturum: new CdpOturum(await wsBaglan(u.toString(), 8000)), url: sayfa.url };
}

function gSatirlari(seri) {
  const lc = adb(seri, ['logcat', '-d', '-v', 'time'], 60000).cikti.split('\n');
  return lc.filter((l) => l.includes('[EMPP_G]') || /\bEmppG\b/.test(l));
}

async function main() {
  const komut = process.argv[2];
  const seri = arg('seri');
  if (!komut || !seri) { console.error('kullanım: <komut> --seri <emulator-N> [--apk]'); process.exit(2); }
  const apk = arg('apk');
  const b = apk ? paketBilgisi(apk) : null;

  if (komut === 'hazirla') {
    for (let i = 0; i < 30; i += 1) {
      if (adb(seri, ['shell', 'getprop', 'sys.boot_completed'], 8000).cikti === '1') break;
      await bekle(3000);
    }
    const acik = adb(seri, ['shell', 'getprop', 'sys.boot_completed']).cikti === '1';
    adb(seri, ['shell', 'svc', 'power', 'stayon', 'true']);
    adb(seri, ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
    adb(seri, ['shell', 'wm', 'dismiss-keyguard']);
    adb(seri, ['shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed']);
    const rev = adb(seri, ['reverse', 'tcp:8443', 'tcp:8443']);
    console.log(JSON.stringify({ acik, reverse: adb(seri, ['reverse', '--list']).cikti, revKod: rev.kod }));
    process.exit(acik ? 0 : 1);
  }
  if (komut === 'kur') {
    const bas = Date.now();
    const r = adb(seri, ['install', '-r', '-g', apk], 600000);
    console.log(JSON.stringify({ kod: r.kod, sn: Math.round((Date.now() - bas) / 1000), cikti: r.cikti.slice(-200), paket: b.paket }));
    process.exit(/Success/.test(r.cikti) ? 0 : 1);
  }
  if (komut === 'baslat') {
    adb(seri, ['logcat', '-c']);
    const r = adb(seri, ['shell', 'am', 'start', '-S', '-W', '-n', `${b.paket}/${b.etkinlik}`], 90000);
    console.log(r.cikti.split('\n').slice(-4).join(' | '));
    process.exit(r.kod === 0 ? 0 : 1);
  }
  if (komut === 'tetikle') {
    adb(seri, ['logcat', '-c']);
    const { oturum, url } = await cdpAc(seri, b.paket);
    const once = await oturum.degerlendir("(function(){var s=localStorage.getItem('empp_g_son');"
      + "localStorage.removeItem('empp_g_son');setTimeout(function(){location.reload();},50);return s;})()");
    oturum.kapat();
    console.log(JSON.stringify({ tetiklendi: true, url, oncekiKisit: once, zaman: new Date().toISOString() }));
    return;
  }
  if (komut === 'sonuc') {
    const sure = Number(arg('bekle', '100')) * 1000;
    const bas = Date.now();
    while (Date.now() - bas < sure) {
      const s = gSatirlari(seri);
      const sonuc = s.find((l) => l.includes('[EMPP_G] sonuç:'));
      const olcum = s.find((l) => l.includes('[EMPP_G] webcrypto-ed25519:'));
      if (sonuc && (olcum || Date.now() - bas > 20000)) {
        const rapor = JSON.parse(sonuc.slice(sonuc.indexOf('{', sonuc.indexOf('sonuç:')), sonuc.lastIndexOf('}') + 1));
        console.log(JSON.stringify({ rapor, webcrypto: olcum ? olcum.slice(olcum.indexOf('webcrypto-ed25519:')) : null,
          satirlar: s.slice(-25) }, null, 1));
        return;
      }
      await bekle(4000);
    }
    console.log(JSON.stringify({ zamanAsimi: true, satirlar: gSatirlari(seri).slice(-25) }, null, 1));
    process.exit(3);
  }
  if (komut === 'durum') {
    const d = adb(seri, ['shell', 'run-as', b.paket, 'cat', 'files/empp-g/durum.txt']);
    const ls = adb(seri, ['shell', 'run-as', b.paket, 'ls', '-R', 'files/empp-g']);
    const du = adb(seri, ['shell', 'run-as', b.paket, 'du', '-sk', 'files/empp-g']);
    console.log(JSON.stringify({ durumTxt: d.kod === 0 ? d.cikti : null, durumHata: d.kod === 0 ? null : d.cikti,
      dizinSatir: ls.cikti.split('\n').length, dizinBas: ls.cikti.split('\n').slice(0, 30), du: du.cikti }, null, 1));
    return;
  }
  if (komut === 'cdp') {
    const { oturum, url } = await cdpAc(seri, b.paket);
    const deger = await oturum.degerlendir(arg('ifade'), 60000);
    oturum.kapat();
    console.log(JSON.stringify({ url, deger }, null, 1));
    return;
  }
  if (komut === 'kabul') {
    const kanit = arg('kanit');
    fs.mkdirSync(kanit, { recursive: true });
    const kart = Number(arg('kart', '3'));
    const r = await cihazKabulu({
      apk, kanit, mevcutSeri: seri, kurulumYok: true, setMi: kart > 0, beklenenKart: kart,
      kitapAdlari: [], log: (s) => console.error(s), menuBekleSn: Number(arg('menu-bekle', '60')),
      kitapBekleSn: Number(arg('kitap-bekle', '60')),
    });
    // Yük altında ANR diyaloğu paket hakkında hüküm değildir (Şef 26.09): ÖLÇÜLEMEDİ.
    const anr = (r.sebepler || []).filter((s) => /yanıt vermiyor/.test(s));
    if (r.durum === 'RED' && anr.length && anr.length === r.sebepler.length) {
      r.durumHam = r.durum;
      r.durum = 'OLCULEMEDI';
      r.notlar = [...(r.notlar || []), 'ANR diyaloğu → ÖLÇÜLEMEDİ (RED değil)'];
    }
    const ozet = { etiket: arg('etiket'), durum: r.durum, sebepler: r.sebepler, notlar: r.notlar,
      menu: r.menu && { kartSayisi: r.menu.kartSayisi, webView: Boolean(r.menu.webView), beklenenSn: r.menu.beklenenSn,
        ekran: r.menu.ekran, yukleniyor: r.menu.yukleniyor },
      kitap: r.kitap && { webView: Boolean(r.kitap.webView), beklenenSn: r.kitap.beklenenSn, ekran: r.kitap.ekran },
      konsol: r.konsol, sistemDiyaloglari: r.sistemDiyaloglari };
    fs.writeFileSync(path.join(kanit, `kabul-${arg('etiket')}.json`), JSON.stringify({ ...ozet, ham: r }, null, 1));
    console.log(JSON.stringify(ozet, null, 1));
    process.exit(r.durum === 'GECTI' ? 0 : (r.durum === 'RED' ? 1 : 3));
  }
  console.error(`bilinmeyen komut: ${komut}`);
  process.exit(2);
}

main().catch((e) => { console.error(`HATA: ${e.message}`); process.exit(1); });
