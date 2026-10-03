'use strict';

/**
 * `runElectronBuilder` — SESSİZ BAŞARI KAPISI katman (a) (açık iş 2, 2026-09-26;
 * Şef düzeltmesi 2026-09-26).
 *
 * BELİRTİ (Nadir): makensis/electron-builder BAŞARISIZ (sıfır-dışı çıkış)
 * olduğunda, çıktı dizininde ÖNCEKİ bir derlemeden kalma bir `*-Setup.exe`
 * duruyorsa `runElectronBuilder` işi "başarılı" sayıp o ESKİ dosyayı teslim
 * ediyordu (win-özel "eski Setup.exe varsa kabul et" dalı, KOŞULSUZ).
 *
 * İLK DÜZELTME AŞIRI GİTTİ: sıfır-dışı çıkışı win için de KOŞULSUZ reddetmek,
 * `packageWindows()` config'indeki `publish: {provider:'generic', url:'https://
 * example.com'}` yüzünden çalışan updateInfoBuilder'ın ZARARSIZ hatasını da
 * (Setup.exe GERÇEKTEN bu derlemede üretilmiş olsa bile) reddediyordu — win-özel
 * dalın asıl var oluş nedeni tam bu senaryoyu tolere etmekti.
 *
 * ŞİMDİKİ İKİ KATMAN:
 *   (a) runElectronBuilder: sıfır-dışı çıkışta, çıktı dizininde mtime'ı SPAWN
 *       ANINDAN yeni bir *Setup.exe varsa UYARIYLA kabul eder (ad/sürüm doğrulamaz);
 *       yoksa ya da yalnız ESKİ (spawn'dan önceki) bir dosya varsa reddeder.
 *   (b) `windows-setup-dogrulama.js` `dogrula()` (`packageWindows()` içinde):
 *       bulunan installer'ın mtime'ı VE adı (`${appName}-${appVersion}-Setup.exe`)
 *       birebir doğru mu — katman (a) taze ama YANLIŞ ADLI bir dosyayı geçirse
 *       bile burada reddedilir.
 *
 * Bu dosya GERÇEK `runElectronBuilder`'ı, GERÇEK bir alt süreç spawn ederek
 * (sahte bir electron-builder ikilisi — basit bir kabuk betiği) test eder.
 * `resolveElectronBuilderBinary()` yalnız bu testte geçici olarak sahte betiğe
 * yönlendirilir, sonunda GERİ ALINIR (singleton paylaşılan servis).
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('fs-extra');

const svc = require('./packagingService');
const windowsSetupDogrulama = require('./windows-setup-dogrulama');

/**
 * Sahte electron-builder ikilisi. `uretilecekExe` verilirse betik ÇALIŞTIĞI
 * ANDA (yani spawn'dan SONRA) o adla bir dosya yazar — böylece dosyanın mtime'ı
 * doğal olarak spawn anından sonraya düşer (gerçek electron-builder'ın NSIS
 * derlemesi sırasında Setup.exe'yi üretmesiyle AYNI zamanlama ilişkisi).
 */
async function sahteBinaryYaz(dizin, outputPath, { cikisKodu, uretilecekExe }) {
  const betikYolu = path.join(dizin, 'sahte-electron-builder.sh');
  const satirlar = ['#!/bin/sh'];
  if (uretilecekExe) {
    const hedefYol = path.join(outputPath, uretilecekExe).replace(/'/g, "'\\''");
    satirlar.push(`echo "sahte-icerik" > '${hedefYol}'`);
  }
  satirlar.push(`exit ${cikisKodu}`);
  await fs.writeFile(betikYolu, satirlar.join('\n') + '\n');
  await fs.chmod(betikYolu, 0o755);
  return betikYolu;
}

async function sessizce(fn) {
  const yedek = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const uyarilar = [];
  console.log = console.info = console.error = () => {};
  console.warn = (...args) => uyarilar.push(args.join(' '));
  try {
    const sonuc = await fn();
    return { sonuc, uyarilar };
  } finally {
    Object.assign(console, yedek);
  }
}

/**
 * @param {object} opts
 * @param {number} opts.cikisKodu
 * @param {string} [opts.oncedenVarOlanExe] - runElectronBuilder ÇAĞRILMADAN ÖNCE
 *   yazılır (mtime kesin spawn'dan ÖNCE — "önceki derlemeden kalma" senaryosu).
 * @param {string} [opts.deremedeUretilenExe] - sahte betik ÇALIŞIRKEN yazılır
 *   (mtime spawn'dan SONRA — "bu derlemede üretildi" senaryosu).
 */
async function calistir({ cikisKodu, oncedenVarOlanExe, derlemedeUretilenExe }) {
  const dizin = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-rebtest-'));
  const outputPath = path.join(dizin, 'output');
  await fs.ensureDir(outputPath);
  await fs.ensureDir(path.join(dizin, 'app')); // cwd=path.join(dirname(configPath),'app') spawn için şart
  if (oncedenVarOlanExe) {
    const eskiYol = path.join(outputPath, oncedenVarOlanExe);
    await fs.writeFile(eskiYol, 'ESKI-ICERIK');
    // 03.10: yazıp hemen spawn edince mtimeMs (ns çözünürlük) Date.now()'u (ms) aşabiliyordu → ara sıra
    // "eski exe taze sayıldı" sahte FAIL. Önceki derlemeden kalma = açıkça geçmişte.
    const gecmis = new Date(Date.now() - 60000);
    await fs.utimes(eskiYol, gecmis, gecmis);
  }
  const configPath = path.join(dizin, 'electron-builder-win.json');
  await fs.writeJson(configPath, { fake: true });
  const betikYolu = await sahteBinaryYaz(dizin, outputPath, { cikisKodu, uretilecekExe: derlemedeUretilenExe });

  const orijinalResolve = svc.resolveElectronBuilderBinary;
  svc.resolveElectronBuilderBinary = () => ({ command: betikYolu, args: [] });
  try {
    const { sonuc, uyarilar } = await sessizce(() => svc.runElectronBuilder(configPath, 'win', outputPath).then(
      (r) => ({ basarili: true, deger: r }),
      (e) => ({ basarili: false, hata: e })
    ));
    return { ...sonuc, uyarilar, outputPath };
  } finally {
    svc.resolveElectronBuilderBinary = orijinalResolve;
  }
}

// ─────────────────────────── temel exit-code davranışı ───────────────────────────

test('exit 0: her zaman başarı (regresyon yok, davranış değişmedi)', async () => {
  const r = await calistir({ cikisKodu: 0 });
  assert.strictEqual(r.basarili, true);
});

test('exit 1 + hiçbir Setup.exe YOK: reddedilir (değişmedi)', async () => {
  const r = await calistir({ cikisKodu: 1 });
  assert.strictEqual(r.basarili, false);
  assert.match(r.hata.message, /build failed/);
});

// ─────────────────── 4 senaryo (Şef düzeltmesi) ───────────────────

test('SENARYO 1 — exit≠0 + ÖNCEKİ derlemeden kalma ESKİ exe: katman (a) REDDEDER', async () => {
  const r = await calistir({ cikisKodu: 1, oncedenVarOlanExe: 'Eski Uygulama-1.0.0-Setup.exe' });
  assert.strictEqual(r.basarili, false, 'eski dosya yine de kabul edildi — bildirilen belirtinin ta kendisi');
  assert.match(r.hata.message, /build failed/);
});

test('SENARYO 2 — exit≠0 + TAZE ve DOĞRU adlı exe: katman (a) UYARIYLA kabul eder', async () => {
  const appName = 'X';
  const appVersion = '1.0.0';
  const beklenenAd = windowsSetupDogrulama.beklenenDosyaAdi(appName, appVersion);
  const r = await calistir({ cikisKodu: 1, derlemedeUretilenExe: beklenenAd });
  assert.strictEqual(r.basarili, true, 'zararsız updateInfoBuilder hatası artık geçmeli (Şef düzeltmesi)');
  assert.strictEqual(r.uyarilar.some((u) => /exit 1 ama Setup\.exe bu derlemede üretildi/.test(u)), true,
    `beklenen uyarı yok. Görülenler: ${JSON.stringify(r.uyarilar)}`);
  assert.strictEqual(r.uyarilar.some((u) => /\(b\) katmanı adı doğrulayacak/.test(u)), true);

  // Katman (b): ad da doğru olduğu için dogrula() de geçmeli (uçtan uca kanıt).
  const installerPath = path.join(r.outputPath, beklenenAd);
  const dogrulama = await windowsSetupDogrulama.dogrula(installerPath, appName, appVersion, Date.now() - 60000);
  assert.strictEqual(dogrulama.tamam, true, `(b) da geçmeliydi: ${JSON.stringify(dogrulama)}`);
});

test('SENARYO 3 — exit≠0 + TAZE ama YANLIŞ adlı exe: (a) geçirir, (b) REDDEDER', async () => {
  const appName = 'X';
  const appVersion = '1.0.0';
  const yanlisAd = 'Baska Uygulama-9.9.9-Setup.exe'; // appName/appVersion ile UYUŞMUYOR
  const r = await calistir({ cikisKodu: 1, derlemedeUretilenExe: yanlisAd });
  // Katman (a) yalnız *Setup.exe + tazelik bakar, ad/sürüm doğrulamaz — bu yüzden geçer.
  assert.strictEqual(r.basarili, true, 'katman (a) taze dosyayı adına bakmadan kabul etmeliydi (tasarım gereği)');

  // Katman (b): appName/appVersion ile eşleşmediği için REDDETMELİ.
  const installerPath = path.join(r.outputPath, yanlisAd);
  const dogrulama = await windowsSetupDogrulama.dogrula(installerPath, appName, appVersion, Date.now() - 60000);
  assert.strictEqual(dogrulama.tamam, false, '(b) yanlış adlı dosyayı kabul etti — iki katman birlikte kapatmıyor');
  assert.match(dogrulama.hata, /beklenen sürümü taşımıyor/);
});

test('SENARYO 4 — exit 0 + ÖNCEKİ derlemeden kalma ESKİ exe: (a) koşulsuz geçer, (b) REDDEDER', async () => {
  const appName = 'X';
  const appVersion = '1.0.0';
  const beklenenAd = windowsSetupDogrulama.beklenenDosyaAdi(appName, appVersion);
  // Dosya runElectronBuilder ÇAĞRILMADAN ÖNCE yazılıyor (spawn'dan kesin ÖNCE).
  const r = await calistir({ cikisKodu: 0, oncedenVarOlanExe: beklenenAd });
  assert.strictEqual(r.basarili, true, 'exit 0 katman (a) tarafında HER ZAMAN koşulsuz geçer (davranış değişmedi)');

  // Katman (b): gerçek üretimde bu dosya bir ÖNCEKİ derlemeden (dakikalar/saatler
  // önce) kalmış olurdu — testte mtime'ı açıkça geriye çekilir (yalnız birkaç yüz
  // ms'lik doğal test gecikmesine güvenmek `MTIME_TOLERANS_MS` içinde kalıp
  // yanlışlıkla PASS verebilir).
  const installerPath = path.join(r.outputPath, beklenenAd);
  const eskiMs = Date.now() - 60000;
  await fs.utimes(installerPath, eskiMs / 1000, eskiMs / 1000);
  const dogrulama = await windowsSetupDogrulama.dogrula(installerPath, appName, appVersion, Date.now());
  assert.strictEqual(dogrulama.tamam, false, '(b) exit 0 olsa da eski dosyayı kabul etti');
  assert.match(dogrulama.hata, /ÖNCE üretilmiş/);
});

// ─────────────────────────── mutasyon kanıtı (elle doğrulandı) ───────────────────────────

test('MUTASYON KANITI (elle): katman (a)\'daki mtime koşulu kaldırılırsa SENARYO 1 düşer', () => {
  // Elle doğrulandı (görev raporunda): `stat.mtimeMs >= spawnZamani` koşulu
  // `true` ile değiştirilip (yani HER *Setup.exe "taze" sayılınca) SENARYO 1
  // ("ESKİ exe reddedilmeli") testi PASS beklerken beklenmedik biçimde resolve
  // olup düştü; değişiklik geri alındı. Burada kaynak-sentinel ile kontrolün
  // hâlâ var olduğu çivilenir.
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const i = src.indexOf('async runElectronBuilder(');
  assert.notStrictEqual(i, -1, 'runElectronBuilder bulunamadı (sentinel köreldi)');
  const j = src.indexOf('\n  async ', i + 10);
  const govde = src.slice(i, j > -1 ? j : undefined);
  assert.match(govde, /stat\.mtimeMs >= spawnZamani/, 'tazelik kontrolü kaynaktan kaldırılmış');
  assert.match(govde, /const spawnZamani = Date\.now\(\)/, 'spawn anı artık kaydedilmiyor');
});

test('kaynak-sentinel: win-özel dal artık AD DOĞRULAMAZ (bu iş katman (b)\'nin) ama tazelik doğrular', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const i = src.indexOf('async runElectronBuilder(');
  const j = src.indexOf('\n  async ', i + 10);
  const govde = src.slice(i, j > -1 ? j : undefined);
  assert.match(govde, /if \(platform === 'win'\)/, "platform === 'win' dalı kaybolmuş");
  assert.ok(!/sıfır-dışı çıkış KOŞULSUZ reddedilir/.test(govde),
    'eski (aşırı gitmiş) "koşulsuz red" yorumu hâlâ duruyor — düzeltme uygulanmamış');
});
