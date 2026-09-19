#!/usr/bin/env node
'use strict';
/**
 * srv21 şeridinde ZATEN ÜRETİLMİŞ .impark'ı Mac'e devralır — YENİDEN DERLEMEZ.
 *
 * Neden ayrı araç (2026-09-19): `serit-uret.js` üretimi kendisi başlatır ve
 * `SRCVERSION`'ı o koşunun stdout'undan okur. Şerit kuyruğu (`/opt/lane-kuyruk*.sh`)
 * ise `lane-hazirla.mjs`'i kendi başına koşturur; paket `/opt/lane-work/<id>/out.impark`
 * içinde hazır bekler ama Mac'e hiç inmez. Bugün (19 Eylül) üretilen paketlerin
 * bir kısmı tam bu yüzden kullanılmadan kaldı.
 *
 * `SRCVERSION` şerit günlüğünden (`/opt/lane-<id>.log`) okunur — ŞART: `.json`
 * yanında olmayan paketi ajan devralmaz (`hazirPardusPaketi`), sürüm tutmazsa da
 * atlar. Sürüm okunamazsa devir YAPILMAZ; uydurma sürüm yazmak paketi sessizce
 * yanlış kitaba bağlardı.
 *
 * srv21 kopyası devirden SONRA ve yalnız bütünlük ölçümü geçerse silinir
 * (`--birak` ile hiç silinmez).
 *
 * Kullanım: node tools/agent/serit-devral.js <bookId> ["<Kitap Adı>"] [--birak]
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { asciiAppName } = require('../../src/agent/runner-helpers');

const SRV21 = process.env.SERIT_HOST || 'root@10.0.0.21';
const SSH = ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', '-p', '2222'];
// scp port bayrağı BÜYÜK -P (serit-uret.js'teki 2026-09-17 dersi).
const SCP = ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', '-P', '2222'];
const HAZIR = process.env.EMPP_PARDUS_HAZIR_DIR || path.join(os.homedir(), '.empp-agent', 'pardus-hazir');
const kayit = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

/** AppImage squashfs superblock'undan beklenen dosya boyutu (pardus-yonetim skill'i §5). */
function imparkButunMu(dosya) {
  const OFS = 193728;
  const fd = fs.openSync(dosya, 'r');
  try {
    const b = Buffer.alloc(8);
    fs.readSync(fd, b, 0, 8, OFS + 40);          // bytes_used, 8 bayt LE
    const beklenen = OFS + Number(b.readBigUInt64LE(0));
    const gercek = fs.statSync(dosya).size;
    return { tam: gercek >= beklenen, beklenen, gercek };
  } finally {
    fs.closeSync(fd);
  }
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== '--birak');
  const birak = process.argv.includes('--birak');
  const [bookId, baslik] = argv;
  if (!bookId) {
    console.error('kullanım: serit-devral.js <bookId> ["<Kitap Adı>"] [--birak]');
    process.exit(2);
  }
  await fsp.mkdir(HAZIR, { recursive: true });

  const uzak = `/opt/lane-work/${bookId}/out.impark`;
  const bak = spawnSync('ssh', [...SSH, SRV21,
    `[ -s ${uzak} ] && stat -c %s ${uzak} || echo YOK`], { encoding: 'utf8' });
  const uzakBoyut = String(bak.stdout || '').trim();
  if (uzakBoyut === 'YOK' || !/^\d+$/.test(uzakBoyut)) {
    throw new Error(`srv21'de hazır paket yok: ${uzak}`);
  }

  const sv = spawnSync('ssh', [...SSH, SRV21,
    `grep -oE 'SRCVERSION=.*' /opt/lane-${bookId}.log 2>/dev/null | tail -1`], { encoding: 'utf8' });
  const srcVersion = (String(sv.stdout || '').match(/SRCVERSION=(.+)/) || [])[1]?.trim();
  if (!srcVersion) {
    throw new Error(`kaynak sürümü okunamadı (/opt/lane-${bookId}.log) — devir YAPILMADI`);
  }

  const gecici = path.join(HAZIR, `${bookId}.impark.indiriliyor`);
  kayit(`${bookId}: ${(Number(uzakBoyut) / 1e6).toFixed(0)} MB indiriliyor (IPsec) — kaynak ${srcVersion}`);
  const cek = spawnSync('scp', ['-q', ...SCP, `${SRV21}:${uzak}`, gecici], { encoding: 'utf8' });
  if (cek.status !== 0) throw new Error(`indirilemedi: ${String(cek.stderr || '').slice(-300)}`);

  const boyut = fs.statSync(gecici).size;
  if (String(boyut) !== uzakBoyut) {
    await fsp.rm(gecici, { force: true });
    throw new Error(`boyut tutmadı (uzak ${uzakBoyut}, yerel ${boyut}) — kesik indirme atıldı`);
  }
  const b = imparkButunMu(gecici);
  if (!b.tam) {
    await fsp.rm(gecici, { force: true });
    throw new Error(`paket KESİK (beklenen ${b.beklenen}, gelen ${b.gercek}) — devir iptal`);
  }

  // Önce .json, sonra atomik rename — ajan yarım dosyayı ASLA görmez.
  await fsp.writeFile(path.join(HAZIR, `${bookId}.json`), JSON.stringify({
    srcVersion,
    appName: baslik ? asciiAppName(baslik, `book-${bookId}`) : undefined,
    uretim: 'srv21-serit-devir',
    tarih: new Date().toISOString(),
  }, null, 2));
  await fsp.rename(gecici, path.join(HAZIR, `${bookId}.impark`));
  kayit(`${bookId}: HAZIR (${(boyut / 1e6).toFixed(0)} MB, bütünlük TAM) — ajan devralacak`);

  if (!birak) {
    spawnSync('ssh', [...SSH, SRV21, `rm -rf /opt/lane-work/${bookId}`], { stdio: 'ignore' });
    kayit(`${bookId}: srv21 çalışma dizini bırakıldı (disk)`);
  }
}

main().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
