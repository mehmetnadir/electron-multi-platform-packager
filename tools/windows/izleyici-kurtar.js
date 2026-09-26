#!/usr/bin/env node
'use strict';
/**
 * UZAKTAN İZLEYİCİ KURTARMA — host (Mac) tarafı tetikleyici.
 *
 * NE YAPAR: `~/vm-kapi/yeniden-baslat-<makine>.txt` dosyasına yeni bir damga yazar.
 * Windows'taki gözcü (`tools/windows/vm-gozcu.ps1`) bu dosyayı köprünün var olan
 * `GET /<belirtec>/dosya/<ad>` ucundan çeker; damga değişmişse izleyiciyi öldürüp
 * yeniden başlatır.
 *
 * NEDEN BÖYLE: windows-kasa'da SSH(22) ve WinRM(5985/5986) KAPALI. Köprü PULL
 * modelidir — host guest'e ULAŞAMAZ. Bu yüzden "uzaktan kurtarma" bir PORT AÇMAK
 * değil, guest'in zaten yaptığı çekmeye bir bayrak bırakmaktır. Windows tarafında
 * açılan port YOKTUR; yetki tailnet üyeliği + 24 hex yol belirtecinde durur.
 * Köprü sunucusunda TEK SATIR değişiklik gerekmedi.
 *
 * Kullanım:
 *   node tools/windows/izleyici-kurtar.js                      # varsayılan: windows-kasa
 *   node tools/windows/izleyici-kurtar.js --makine vm
 *   node tools/windows/izleyici-kurtar.js --durum              # yalnız oku, yazma
 *
 * Bu araç guest'e komut GÖNDERMEZ ve hiçbir süreci öldürmez; yalnız bir dosya yazar.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tetikDamgasi } = require('../../src/windows/izleyici-kurtarma');

const KOK = process.env.EMPP_VM_KOK || path.join(os.homedir(), 'vm-kapi');

function bayrak(ad, varsayilan) {
  const i = process.argv.indexOf(ad);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : varsayilan;
}

const MAKINE = bayrak('--makine', process.env.EMPP_VM_MAKINE || 'windows-kasa');
// Dosya adı köprünün `dosya` ucundan `path.basename` ile servis edilir; makine adı
// yol ayracı içeremez, yoksa gözcü başka bir dosyayı çeker.
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(MAKINE)) {
  console.error(`makine adı geçersiz: ${MAKINE}`);
  process.exit(2);
}
const YOL = path.join(KOK, `yeniden-baslat-${MAKINE}.txt`);

if (process.argv.includes('--durum')) {
  let mevcut = null;
  try { mevcut = fs.readFileSync(YOL, 'utf8').trim(); } catch { /* hiç yazılmamış */ }
  console.log(JSON.stringify({ makine: MAKINE, yol: YOL, damga: mevcut }, null, 2));
  process.exit(0);
}

fs.mkdirSync(KOK, { recursive: true });
const damga = tetikDamgasi(Date.now());
fs.writeFileSync(YOL, damga);
console.log(JSON.stringify({
  makine: MAKINE,
  damga,
  yol: YOL,
  not: 'gözcü en geç bir tur (varsayılan 15 sn) içinde görür; ' +
    `kanıt: node tools/windows/vm-kapi.js hazir --makine ${MAKINE}-gozcu`,
}, null, 2));
