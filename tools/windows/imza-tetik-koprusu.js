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
const I = require('../../src/agent/imza-istek');

function ayarlar(env = process.env) {
  return {
    ssh: env.EMPP_KASA_SSH || 'Administrator@100.99.245.17',
    dizin: env.EMPP_KASA_ISTEK_DIZINI || 'C:\\Users\\Administrator\\.empp-agent\\imza-istek',
  };
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
      const s = String(sonuc).replace(/[^0-9A-Za-z_-]/g, '');
      const r = ssh(`if not exist "${cfg.dizin}\\islendi" mkdir "${cfg.dizin}\\islendi" & move /y "${cfg.dizin}\\${guvenli(ad)}" "${cfg.dizin}\\islendi\\${ad}.${s}"`);
      return r.status === 0;
    },
  };
}

/** Tek tur. @returns {Promise<{islenen:number, calisan:string[], reddedilen:number}>} */
async function tur({ uzak, kos, log, kuru = false, simdi = Date.now }) {
  const ozet = { islenen: 0, calisan: [], reddedilen: 0 };
  const adlar = uzak.listele().sort();
  if (!adlar.length) return ozet;
  const yapildi = new Map(); // komut -> sonuç (aynı turda tekrar çağrılmaz)
  for (const ad of adlar) {
    const k = I.istekKomutu(ad, uzak.oku(ad), { simdiMs: simdi() });
    if (!k.argv) {
      log(`köprü: ${ad} REDDEDİLDİ — ${k.sebep}`);
      ozet.reddedilen += 1;
      if (!kuru) uzak.tasi(ad, 'red');
      continue;
    }
    let sonuc = yapildi.get(k.komut);
    if (sonuc === undefined) {
      if (kuru) { log(`köprü (kuru): çalıştırılırdı: ${k.argv.join(' ')}`); sonuc = 'kuru'; } else {
        const r = await kos(k.argv);
        sonuc = r.kod === 0 ? 'tamam' : `hata${r.kod}`;
        log(`köprü: ${k.argv.join(' ')} → ${sonuc}${r.cikti ? ` · ${String(r.cikti).trim().slice(-160)}` : ''}`);
        ozet.calisan.push(k.komut);
      }
      yapildi.set(k.komut, sonuc);
    } else {
      sonuc = `birlesik-${sonuc}`;
    }
    if (!kuru) uzak.tasi(ad, sonuc);
    ozet.islenen += 1;
  }
  return ozet;
}

async function ana(argv = process.argv.slice(2)) {
  const cfg = ayarlar();
  const log = (...a) => console.log(new Date().toISOString(), ...a);
  const kos = async (a) => {
    const r = spawnSync(a[0], a.slice(1), { encoding: 'utf8', timeout: 10 * 60000 });
    return { kod: r.status === null ? -1 : r.status, cikti: `${r.stdout || ''}${r.stderr || ''}` };
  };
  const ozet = await tur({ uzak: sshUzak(cfg), kos, log, kuru: argv.includes('--kuru') });
  if (ozet.islenen || ozet.reddedilen) log('köprü: tur özeti', JSON.stringify(ozet));
  return ozet;
}

module.exports = { ayarlar, sshUzak, tur, ana };

if (require.main === module) {
  ana().then(() => process.exit(0)).catch((e) => { console.error('köprü HATA:', e && e.stack); process.exit(1); });
}
