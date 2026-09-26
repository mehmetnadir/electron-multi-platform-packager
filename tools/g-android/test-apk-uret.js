#!/usr/bin/env node
'use strict';
/**
 * G Android — uçtan uca sınama APK'sı üretir. YEREL: R2/DB'ye yazmaz, 3001'e dokunmaz.
 * Paketleyici kodu BU çalışma ağacınınkidir (cwd = depo kökü; `uploads/<oturum>` buradan okunur,
 * `temp/` buraya yazılır). Gradle çakışmasın diye `node_modules/@capacitor` bu ağaçta AYRI kopya olmalı.
 *
 * Kullanım:
 *   node tools/g-android/test-apk-uret.js --oturum g-e2e-73768 --kimlik 73768 \
 *     --taban https://127.0.0.1:8443/guncelleme --anahtar ~/.empp-agent/test-guncelleme-ed25519.key \
 *     --test-ca ~/.empp-agent/g-android-e2e/sertifika/ca.pem [--ad "SM3 G Test"]
 * Açık anahtar ÖZEL anahtar dosyasından türetilir; özel anahtarın içeriği basılmaz, pakete girmez.
 * Çıktı: son satır `APK=<yol>`.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function arg(ad, varsayilan = null) {
  const i = process.argv.indexOf(`--${ad}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : varsayilan;
}
const coz = (y) => (y && y.startsWith('~') ? path.join(process.env.HOME, y.slice(1)) : y);

(async () => {
  const oturum = arg('oturum');
  const kimlik = arg('kimlik');
  const taban = arg('taban');
  const anahtar = coz(arg('anahtar'));
  const testCa = coz(arg('test-ca'));
  const ad = arg('ad', `G Test ${kimlik}`);
  if (!oturum || !kimlik || !taban || !anahtar) {
    console.error('kullanım: --oturum --kimlik --taban --anahtar [--test-ca] [--ad]');
    process.exit(2);
  }
  if (!fs.existsSync(path.join('uploads', oturum))) throw new Error(`uploads/${oturum} yok (cwd depo kökü olmalı)`);
  const capKopya = fs.realpathSync(path.join('node_modules', '@capacitor', 'android'));
  if (!capKopya.startsWith(fs.realpathSync(process.cwd()))) {
    throw new Error(`@capacitor/android bu ağacın kopyası değil (${capKopya}) — canlı paketleyiciyle Gradle yarışı olur`);
  }
  const ozel = crypto.createPrivateKey(fs.readFileSync(anahtar));
  if (ozel.asymmetricKeyType !== 'ed25519') throw new Error('anahtar ed25519 değil');
  const acik = crypto.createPublicKey(ozel).export({ type: 'spki', format: 'der' }).toString('base64');

  // Canlı ajanla aynı Android bayrakları (run-agent.sh) + G'yi YALNIZ bu işte android için aç.
  process.env.EMPP_SET_MENU = '1';
  process.env.EMPP_SET_GUNCELLEME = 'android';
  process.env.EMPP_ICERIK_GUNCELLEME = 'windows';
  process.env.EMPP_SAYFA_WEBP = 'windows';
  if (testCa) process.env.EMPP_G_TEST_GUVEN_CA = testCa;
  else delete process.env.EMPP_G_TEST_GUVEN_CA;

  const svc = require(path.resolve('src/packaging/packagingService'));
  const jobId = `g-e2e-${kimlik}-${Date.now()}`;
  const io = { emit: () => {} };
  const t0 = Date.now();
  const r = await svc.startPackaging(jobId, {
    sessionId: oturum,
    platforms: ['android'],
    logoId: null,
    appName: ad,
    packageOptions: { setKimligi: kimlik, guncellemeTabani: taban, guncellemeAcikAnahtari: acik },
  }, io);
  const apk = r && r.android && (r.android.path || (r.android.result && r.android.result.path));
  console.log(`süre: ${Math.round((Date.now() - t0) / 1000)} sn`);
  console.log(`SONUC=${JSON.stringify(r).slice(0, 2000)}`);
  if (!apk || !fs.existsSync(apk)) { console.error('APK yok'); process.exit(1); }
  console.log(`APK=${path.resolve(apk)}`);
})().catch((e) => { console.error(`HATA=${e.message}`); process.exit(1); });
