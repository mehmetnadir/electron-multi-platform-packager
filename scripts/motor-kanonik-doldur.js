#!/usr/bin/env node
'use strict';
/**
 * KANONİK MOTOR ÖNBELLEĞİNİ DOLDURUR — `~/.empp-agent/motor/{kanonik.json, 43e…js}`.
 *
 * Kaynak: player-guncelle skill'inin `scripts/sync-engine.sh` çıktısı
 * (`~/01dev/etkinlik-creator-yeniden/build/43e23fce2b7009474555a77.js`) — srv21
 * `preview/build/` ile byte-aynı olması gereken dosya. `--srv21` verilirse srv21'deki
 * kopyanın sha'sı SALT OKUMA ile kıyaslanır; uyuşmazsa önbellek YAZILMAZ.
 *
 * Sürüm: motor dosyasında sürüm dizgesi yok (ölçüldü) → derleme tarihi `YYYY.M.D`
 * (release bundle mtime'ı), aynı gün ikinci farklı derleme `YYYY.M.D.N`. Her yazımda
 * önceki kanonik `surumler` haritasına eklenir (sha12 → surum) — motorDegistir
 * "kanonikten yeni" kopyayı bu haritadan tanır.
 *
 * Kullanım: node scripts/motor-kanonik-doldur.js [--kaynak <js>] [--hedef <dir>] [--srv21]
 */
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs-extra');

const AD = '43e23fce2b7009474555a77.js';
const ETK = path.join(os.homedir(), '01dev', 'etkinlik-creator-yeniden');
const VARSAYILAN_KAYNAK = path.join(ETK, 'build', AD);
const RELEASE = path.join(ETK, 'Activities_Player-main', 'release', 'impark-activity.bundle.js');
const VARSAYILAN_HEDEF = path.join(os.homedir(), '.empp-agent', 'motor');
/** Sağlamlık simgeleri (player-guncelle §3) — biri 0 ise kaynak kırık sayılır. */
const SIMGELER = ['createKeyboardWriteActivity', 'kbwrite', 'completionAction', 'regions',
  'answerKeysVisible'];

/** Derleme tarihinden sürüm üretir; aynı gün başka sha varsa .N eki. SAF. */
function surumUret(tarih, sha12, onceki) {
  const taban = `${tarih.getFullYear()}.${tarih.getMonth() + 1}.${tarih.getDate()}`;
  const harita = { ...((onceki && onceki.surumler) || {}) };
  if (onceki && onceki.sha12) harita[onceki.sha12] = onceki.surum;
  if (harita[sha12]) return harita[sha12];
  const ayniGun = Object.values(harita).filter((s) => s === taban || s.startsWith(`${taban}.`));
  return ayniGun.length ? `${taban}.${ayniGun.length}` : taban;
}

/** Yeni kanonik.json gövdesi. SAF. */
function kanonikKur({ sha12, boyut, surum, kaynak, onceki, zaman }) {
  const surumler = { ...((onceki && onceki.surumler) || {}) };
  if (onceki && onceki.sha12 && onceki.surum) surumler[onceki.sha12] = onceki.surum;
  surumler[sha12] = surum;
  return { sha12, surum, surumKaynagi: 'derleme-tarihi', boyut, kaynak, yazildi: zaman, surumler };
}

function ana(argv) {
  const al = (ad, vars) => { const i = argv.indexOf(ad); return i >= 0 ? argv[i + 1] : vars; };
  const kaynak = al('--kaynak', VARSAYILAN_KAYNAK);
  const hedef = al('--hedef', VARSAYILAN_HEDEF);
  const buf = fs.readFileSync(kaynak);
  const sha12 = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
  execFileSync(process.execPath, ['--check', kaynak]); // parse edilemezse fırlatır
  const metin = buf.toString('latin1');
  const eksik = SIMGELER.filter((s) => !metin.includes(s));
  if (eksik.length) throw new Error(`kaynak sağlamlık simgesi eksik: ${eksik.join(', ')}`);

  if (argv.includes('--srv21')) {
    const uzak = execFileSync('ssh', ['-p', '2222', '-o', 'ConnectTimeout=10', 'root@100.117.187.26',
      `sha256sum /var/www/interactive/preview/build/${AD}`]).toString().slice(0, 12);
    if (uzak !== sha12) throw new Error(`srv21 preview/build sha ${uzak} ≠ yerel ${sha12} — önce sync-engine.sh --push`);
  }

  let onceki = null;
  try { onceki = JSON.parse(fs.readFileSync(path.join(hedef, 'kanonik.json'), 'utf8')); } catch { /* ilk */ }
  const tarih = fs.existsSync(RELEASE) && kaynak === VARSAYILAN_KAYNAK
    ? fs.statSync(RELEASE).mtime : fs.statSync(kaynak).mtime;
  const surum = surumUret(tarih, sha12, onceki);
  const govde = kanonikKur({ sha12, boyut: buf.length, surum, kaynak, onceki,
    zaman: new Date().toISOString() });
  fs.ensureDirSync(hedef);
  fs.copyFileSync(kaynak, path.join(hedef, AD));
  fs.writeFileSync(path.join(hedef, 'kanonik.json'), `${JSON.stringify(govde, null, 2)}\n`);
  console.log(`kanonik motor: ${sha12} sürüm ${surum} (${buf.length} B) → ${hedef}`);
  return govde;
}

if (require.main === module) {
  try { ana(process.argv.slice(2)); } catch (e) { console.error(`HATA: ${e.message}`); process.exit(1); }
}

module.exports = { surumUret, kanonikKur, SIMGELER };
