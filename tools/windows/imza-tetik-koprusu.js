#!/usr/bin/env node
'use strict';
/**
 * İMZA TETİK KÖPRÜSÜ (Mac) — windows-kasa'nın bıraktığı imza isteklerini (src/agent/imza-istek.js)
 * mevcut Mac→kasa SSH'ı ile okur ve yayincilikadm'ı BU MAC'TE çalıştırır (panel oturumu burada).
 * Kasa yalnız yuvaya yazar/okur; tetik (exe-create) ve yuva temizliği (exe-remove) buradan çekilir.
 *
 * Güvenlik: istek dosyası komut taşımaz; argv yalnız `imza-istek.KOMUTLAR` sabit tablosundan kurulur
 * (`istekKomutu`). Bayat (>6 sa), adı/içeriği uyuşmayan istek çalıştırılmaz. Aynı turdaki birden çok
 * aynı komut TEK çağrıya indirilir. İşlenen istek kasada `islendi\` altına taşınır (silme yok).
 *
 * Kullanım: node tools/windows/imza-tetik-koprusu.js [--kuru]   (tek tur; launchd 60 sn'de bir koşturur
 *   — KURULUMU ŞEF YAPAR, Mac tarafı bu dalda değiştirilmedi)
 * Ortam: EMPP_KASA_SSH (Administrator@100.99.245.17), EMPP_KASA_ISTEK_DIZINI
 *   (C:\Users\Administrator\.empp-agent\imza-istek).
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const I = require('../../src/agent/imza-istek');

function ayarlar(env = process.env) {
  return {
    ssh: env.EMPP_KASA_SSH || 'Administrator@100.99.245.17',
    dizin: env.EMPP_KASA_ISTEK_DIZINI || 'C:\\Users\\Administrator\\.empp-agent\\imza-istek',
    defter: env.EMPP_KOPRU_DEFTER || path.join(os.homedir(), '.empp-agent', 'imza-kopru-islenen.json'),
  };
}

/**
 * İşlenen isteği `islendi\` altına taşıyan cmd komutu (saf). 04.10 OLAYI: eski biçim
 * `if not exist "D" mkdir "D" & move …` idi; cmd'de `& move` IF'in GÖVDESİNE dahildir, yani
 * `islendi` VARKEN taşıma hiç koşmadı. İstek yerinde kaldı ve köprü her turda exe-create +
 * exe-remove'u yeniden çalıştırdı (10:34–10:53, 9 create + 7 remove). Şimdi mkdir koşulsuz (var ise
 * hata susturulur), taşıma ayrı komut; çıkış kodu move'unkidir.
 */
function tasiKomutu(dizin, ad, sonuc) {
  const s = String(sonuc).replace(/[^0-9A-Za-z_-]/g, '');
  return `mkdir "${dizin}\\islendi" 2>nul & move /y "${dizin}\\${ad}" "${dizin}\\islendi\\${ad}.${s}"`;
}

/** Gerçek uzak uç (ssh + cmd). Ad deseni denetlendiği için kabuk enjeksiyonu yok. */
function sshUzak(cfg, kos = spawnSync) {
  const ssh = (komut) => kos('ssh', ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', cfg.ssh, komut],
    { encoding: 'utf8', timeout: 60000 });
  const guvenli = (ad) => { if (!I.AD_DESENI.test(ad)) throw new Error(`güvensiz ad: ${ad}`); return ad; };
  return {
    listele() {
      const r = ssh(`if exist "${cfg.dizin}" dir /b "${cfg.dizin}\\*.json"`);
      if (r.status !== 0 && !String(r.stdout || '').trim()) return [];
      return String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => I.AD_DESENI.test(s));
    },
    oku(ad) { return String(ssh(`type "${cfg.dizin}\\${guvenli(ad)}"`).stdout || ''); },
    tasi(ad, sonuc) {
      const r = ssh(tasiKomutu(cfg.dizin, guvenli(ad), sonuc));
      return r.status === 0;
    },
  };
}

/** Tek tur. @returns {Promise<{islenen:number, calisan:string[], reddedilen:number}>} */
/**
 * Bir kez çalıştırılan istek adları (Mac tarafı defter). Taşıma herhangi bir sebeple tutmazsa
 * (04.10 olayı) aynı istek İKİNCİ KEZ çalıştırılmaz; yalnız taşıma yeniden denenir.
 */
function defterOku(yol) {
  try { const a = JSON.parse(fs.readFileSync(yol, 'utf8')); return new Set(Array.isArray(a) ? a : []); } catch (_) { return new Set(); }
}
function defterYaz(yol, set, azami = 500) {
  const a = [...set].slice(-azami);
  fs.mkdirSync(path.dirname(yol), { recursive: true });
  fs.writeFileSync(`${yol}.part`, `${JSON.stringify(a)}\n`);
  fs.renameSync(`${yol}.part`, yol);
}

/**
 * 06.10 OLAYI: yayincilikadm hesap kilidi (aynı panel hesabını başka süreç tutuyor) `exe-create`'i
 * "İş BAŞLAMADAN durduruldu" ile çıkış 1 döndürdü; köprü yine de isteği `islendi\`ye taşıdı → kasa
 * imza bekçisi 2 sa yuva bekledi, 9 paket imzasız kaldı. Bu çıktı = iş HİÇ koşmadı.
 */
const KILIT_DESENI = /HESAP_KILIDI|İş BAŞLAMADAN durduruldu/i;
const KILIT_BEKLE_SN = '90';
const KILIT_BILDIR_ESIK = 3;
const BILDIRIM_TAVAN_MS = 3600 * 1000;

function kilitMi(r) { return !!r && r.kod !== 0 && KILIT_DESENI.test(String(r.cikti || '')); }

/** Saatte en çok 1 bildirim: damga dosyası. @returns {boolean} gönderildi mi */
function tavanliBildir(damgaYol, mesaj, gonder, simdi = Date.now) {
  let son = 0;
  try { son = Number(fs.readFileSync(damgaYol, 'utf8')) || 0; } catch (_) { son = 0; }
  if (simdi() - son < BILDIRIM_TAVAN_MS) return false;
  fs.mkdirSync(path.dirname(damgaYol), { recursive: true });
  fs.writeFileSync(damgaYol, String(simdi()));
  gonder(mesaj);
  return true;
}

/** Tek-kopya kilidi: pid canlıysa ve 15 dk'dan yeniyse başka köprü koşuyor. @returns {boolean} alındı mı */
function tekKopyaAl(yol, simdi = Date.now, canli = (pid) => { try { process.kill(pid, 0); return true; } catch (_) { return false; } }) {
  try {
    const [pid, ts] = fs.readFileSync(yol, 'utf8').trim().split(' ').map(Number);
    if (pid && canli(pid) && simdi() - ts < 15 * 60000) return false;
  } catch (_) { /* kilit yok */ }
  fs.mkdirSync(path.dirname(yol), { recursive: true });
  fs.writeFileSync(yol, `${process.pid} ${simdi()}`);
  return true;
}

async function tur({ uzak, kos, log, kuru = false, simdi = Date.now, islenmis = null, isaretle = () => {}, bildir = () => {} }) {
  const ozet = { islenen: 0, calisan: [], reddedilen: 0, tasinamayan: 0, kilitli: 0 };
  let ardisikKilit = 0;
  let bildirildi = false;
  const tasi = (ad, sonuc) => {
    if (uzak.tasi(ad, sonuc) === false) {
      ozet.tasinamayan += 1;
      log(`köprü: ${ad} islendi\\'ye TAŞINAMADI (${sonuc}) — defterde, tekrar ÇALIŞTIRILMAZ; taşıma sonraki turda yeniden denenir`);
    }
  };
  const adlar = uzak.listele().sort();
  if (!adlar.length) return ozet;
  const yapildi = new Map(); // komut -> sonuç (aynı turda tekrar çağrılmaz)
  for (const ad of adlar) {
    if (islenmis && islenmis.has(ad)) {
      log(`köprü: ${ad} zaten çalıştırıldı (defter) — yalnız taşıma yeniden deneniyor`);
      if (!kuru) tasi(ad, 'tamam-tekrar');
      continue;
    }
    const k = I.istekKomutu(ad, uzak.oku(ad), { simdiMs: simdi() });
    if (!k.argv) {
      log(`köprü: ${ad} REDDEDİLDİ — ${k.sebep}`);
      ozet.reddedilen += 1;
      if (!kuru) tasi(ad, 'red');
      continue;
    }
    let sonuc = yapildi.get(k.komut);
    if (sonuc === undefined) {
      if (kuru) { log(`köprü (kuru): çalıştırılırdı: ${k.argv.join(' ')}`); sonuc = 'kuru'; } else {
        const r = await kos(k.argv);
        sonuc = kilitMi(r) ? 'kilit' : (r.kod === 0 ? 'tamam' : `hata${r.kod}`);
        log(`köprü: ${k.argv.join(' ')} → ${sonuc}${r.cikti ? ` · ${String(r.cikti).trim().slice(-160)}` : ''}`);
        ozet.calisan.push(k.komut);
      }
      yapildi.set(k.komut, sonuc);
    } else if (sonuc !== 'kilit') {
      sonuc = `birlesik-${sonuc}`;
    }
    if (sonuc === 'kilit') {
      // İŞ KOŞMADI: istek yerinde kalır, defterlenmez, taşınmaz; sonraki turda yeniden denenir.
      // Bayatlık eşiği (6 sa) DEĞİŞMEDİ: kilit 6 sa sürerse istek bayat sayılıp reddedilir — bu bilinçli
      // (6 sa kilit = bildirim zaten gitti, insan bakmalı; sonsuz bekleyen istek eski sürümü imzalatır).
      log(`köprü: ${ad} hesap kilidi — sonraki turda yeniden`);
      ozet.kilitli += 1;
      ardisikKilit += 1;
      if (ardisikKilit >= KILIT_BILDIR_ESIK && !bildirildi && !kuru) {
        bildirildi = true;
        bildir(`imza tetiği hesap kilidinde bekliyor (${k.komut})`);
      }
      continue;
    }
    ardisikKilit = 0;
    if (!kuru) {
      if (islenmis) { islenmis.add(ad); isaretle(ad); }
      tasi(ad, sonuc);
    }
    ozet.islenen += 1;
  }
  return ozet;
}

async function ana(argv = process.argv.slice(2)) {
  const cfg = ayarlar();
  const log = (...a) => console.log(new Date().toISOString(), ...a);
  const kilitYol = path.join(os.homedir(), '.empp-agent', 'imza-tetik-koprusu.lock');
  if (!argv.includes('--kuru') && !tekKopyaAl(kilitYol)) {
    log('köprü: başka kopya koşuyor — tur atlandı');
    return { islenen: 0, calisan: [], reddedilen: 0, tasinamayan: 0, kilitli: 0 };
  }
  const kos = async (a) => {
    // Hesap kilidi doluysa çağrı 90 sn bekler (YAYINCILIKADM_HESAP_KILIDI=0 KULLANILMAZ: ortak freni kapatır).
    const r = spawnSync(a[0], a.slice(1), { encoding: 'utf8', timeout: 10 * 60000,
      env: { ...process.env, YAYINCILIKADM_HESAP_BEKLE: KILIT_BEKLE_SN } });
    return { kod: r.status === null ? -1 : r.status, cikti: `${r.stdout || ''}${r.stderr || ''}` };
  };
  const islenmis = defterOku(cfg.defter);
  const ozet = await tur({
    uzak: sshUzak(cfg), kos, log, kuru: argv.includes('--kuru'),
    islenmis, isaretle: () => defterYaz(cfg.defter, islenmis),
    bildir: (m) => tavanliBildir(path.join(os.homedir(), '.empp-agent', 'imza-kopru-bildirim.damga'), m,
      (x) => spawnSync('bildir', ['bekci', x], { encoding: 'utf8', timeout: 20000 })),
  });
  try { fs.rmSync(kilitYol, { force: true }); } catch (_) { /* yoksay */ }
  if (ozet.islenen || ozet.reddedilen || ozet.tasinamayan || ozet.kilitli) log('köprü: tur özeti', JSON.stringify(ozet));
  return ozet;
}

module.exports = { ayarlar, tasiKomutu, sshUzak, defterOku, defterYaz, tur, ana, kilitMi, tavanliBildir, tekKopyaAl };

if (require.main === module) {
  ana().then(() => process.exit(0)).catch((e) => { console.error('köprü HATA:', e && e.stack); process.exit(1); });
}
