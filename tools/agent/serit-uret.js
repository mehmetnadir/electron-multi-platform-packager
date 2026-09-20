#!/usr/bin/env node
'use strict';
/**
 * srv21 ÜRETİM ŞERİDİ — .impark BAŞKA makinede üretilir, Mac ajanı devralır.
 *
 * Neden (2026-09-17, Nadir: "srv21'i kullanıp paralelliği yükseltebilirsin"):
 * ölçülen faz dağılımı indirme %29 · derleme %47 · yükleme %16; derleme sırasında
 * konteyner 8 çekirdeğin 8'ini yiyor → AYNI Mac'te ikinci derleme kazanç vermez,
 * BAŞKA makinede derlemek verir.
 *
 * Neden hazırlık da srv21'de: Mac→srv21 1,26 GB yükleme ÖLÇÜLDÜ = 1,1 MB/s
 * (Tailscale rölesi, ~20 dk). srv21 kaynağı köprüden (aynı DC) çok daha hızlı çeker;
 * Mac'e yalnız bitmiş .impark iner ve o da IPsec üzerinden (ölçülen 4,8 MB/s;
 * Tailscale'in 3,6 katı — bu yüzden 10.0.0.21 kullanılır, 100.117.187.26 değil).
 *
 * Kabul kapısı ve R2 yüklemesi Mac'te KALIR: paket ProBook'ta açılmadan yüklenmez.
 *
 * Kullanım: node tools/agent/serit-uret.js <bookId> "<Kitap Adı>" ["<Yayınevi>"]
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { asciiAppName } = require('../../src/agent/runner-helpers');

const SRV21 = process.env.SERIT_HOST || 'root@10.0.0.21';   // IPsec yolu (ölçüm: 4,8 MB/s)
const SSH = ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', '-p', '2222'];
// scp'de port bayrağı BÜYÜK -P'dir; SSH dizisini olduğu gibi vermek scp'yi 22'ye
// yollar ve indirme sessizce düşer (ölçüldü 2026-09-17, 45695 devri).
const SCP = ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', '-P', '2222'];
const HAZIR = process.env.EMPP_PARDUS_HAZIR_DIR || path.join(os.homedir(), '.empp-agent', 'pardus-hazir');
const kayit = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function main() {
  const [bookId, baslik, yayinci = 'YDS Publishing'] = process.argv.slice(2);
  if (!bookId || !baslik) {
    console.error('kullanım: serit-uret.js <bookId> "<Kitap Adı>" ["<Yayınevi>"]');
    process.exit(2);
  }
  const appName = asciiAppName(baslik, `book-${bookId}`);
  await fsp.mkdir(HAZIR, { recursive: true });
  kayit(`${bookId} → srv21 şeridi (appName=${appName})`);

  const uret = spawnSync('ssh', [...SSH, SRV21,
    `node /opt/lane-hazirla.mjs ${bookId} "${appName}" "${yayinci}"`,
  ], { encoding: 'utf8', maxBuffer: 1 << 24 });
  for (const s of String(uret.stdout || '').split('\n').filter(Boolean)) kayit(`  [srv21] ${s}`);
  if (uret.status !== 0) {
    throw new Error(`srv21 şeridi düştü (rc=${uret.status}): ${String(uret.stderr || '').slice(-400)}`);
  }
  const srcVersion = (String(uret.stdout).match(/SRCVERSION=(.+)/) || [])[1]?.trim();
  if (!srcVersion) throw new Error('srv21 kaynak sürümünü bildirmedi — hazır paket işaretlenemez');

  const gecici = path.join(HAZIR, `${bookId}.impark.indiriliyor`);
  kayit(`${bookId}: paket Mac'e indiriliyor (IPsec)`);
  const cek = spawnSync('scp', ['-q', ...SCP, `${SRV21}:/opt/lane-work/${bookId}/out.impark`, gecici],
    { encoding: 'utf8' });
  if (cek.status !== 0) throw new Error(`paket indirilemedi: ${String(cek.stderr || '').slice(-300)}`);
  const boyut = fs.statSync(gecici).size;
  if (boyut < 100000) throw new Error(`gelen paket çok küçük: ${boyut} bayt`);

  // Önce .json, sonra atomik rename: ajan yarım dosyayı ASLA görmez ve sürüm
  // bilgisi olmayan paketi devralmaz (hazirPardusPaketi .json yoksa atlar).
  await fsp.writeFile(path.join(HAZIR, `${bookId}.json`),
    JSON.stringify({ srcVersion, appName, yayinci, uretim: 'srv21', tarih: new Date().toISOString() }, null, 2));
  await fsp.rename(gecici, path.join(HAZIR, `${bookId}.impark`));
  spawnSync('ssh', [...SSH, SRV21, `rm -rf /opt/lane-work/${bookId}`], { stdio: 'ignore' });
  kayit(`${bookId}: HAZIR (${(boyut / 1e6).toFixed(0)} MB, kaynak ${srcVersion}) — ajan devralacak`);
}

main().catch((e) => { console.error('ŞERİT HATASI:', e.message); process.exit(1); });
