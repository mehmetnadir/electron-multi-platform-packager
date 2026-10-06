#!/usr/bin/env node
'use strict';
/**
 * İMZA TETİK KÖPRÜSÜ (Mac + srv21) — windows-kasa'nın bıraktığı imza isteklerini (src/agent/imza-istek.js)
 * konak→kasa SSH'ı ile okur ve yayincilikadm'ı NÖBETÇİ KONAKTA çalıştırır (panel oturumu her konakta ayrı).
 * Kasa yalnız yuvaya yazar/okur; tetik (exe-create) ve yuva temizliği (exe-remove) buradan çekilir.
 *
 * Güvenlik: istek dosyası komut taşımaz; argv yalnız `imza-istek.KOMUTLAR` sabit tablosundan kurulur
 * (`istekKomutu`). Bayat (>6 sa), adı/içeriği uyuşmayan istek çalıştırılmaz. Aynı turdaki birden çok
 * aynı komut TEK çağrıya indirilir. İşlenen istek kasada `islendi\` altına taşınır (silme yok).
 *
 * Kullanım: node tools/windows/imza-tetik-koprusu.js [--kuru]   (tek tur; Mac'te launchd, srv21'de systemd
 *   timer 60 sn'de bir koşturur — KURULUMU ŞEF YAPAR)
 * Ortam: EMPP_KASA_SSH (Administrator@100.99.245.17), EMPP_KASA_ISTEK_DIZINI
 *   (C:\Users\Administrator\.empp-agent\imza-istek), EMPP_KASA_SSH_ANAHTAR (srv21: /root/.ssh/kasa-kopru),
 *   EMPP_KOPRU_KONAK (mac|srv21), EMPP_KOPRU_NOBET (zorla = elle devir).
 *
 * NÖBET (Nadir 06.10): Pzt-Cum 09:30-17:45 (Europe/Istanbul, iki uç dahil) → Mac nöbetçi; diğer bütün
 * zamanlar → srv21 nöbetçi. Pasif konak kasaya HİÇ bağlanmaz (istek okumaz/tüketmez). Çift tetik freni:
 * nöbetçi her turda kasaya `imza-istek\.nobetci.json` damgası yazar; karşı konağın damgası son 3 dk
 * içindeyse konak ÇEKİLİR (yazmaz, istek okumaz). Her komuttan önce damga yeniden denetlenir.
 *   EMPP_KOPRU_KONAK YOKSA = eski davranış ("hep" kipi): saatten bağımsız nöbetçi, ama damga yazar ve
 *   karşı konağın taze damgasına uyar. Böylece dal birleşince Mac sessizce pasife düşmez; srv21 açılınca
 *   da Mac'in damgası srv21'i durdurur. Saat kuralı Mac launchd'ye EMPP_KOPRU_KONAK=mac eklenince başlar.
 *   Devir boşluğu: saat sınırında yeni nöbetçi, eskinin damgası bayatlayana dek (≤3 dk) bekler.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const I = require('../../src/agent/imza-istek');

const KONAKLAR = Object.freeze(['mac', 'srv21']);

function ayarlar(env = process.env) {
  const konakAcik = String(env.EMPP_KOPRU_KONAK || '').trim();
  const zorla = String(env.EMPP_KOPRU_NOBET || '').trim() === 'zorla';
  return {
    ssh: env.EMPP_KASA_SSH || 'Administrator@100.99.245.17',
    dizin: env.EMPP_KASA_ISTEK_DIZINI || 'C:\\Users\\Administrator\\.empp-agent\\imza-istek',
    defter: env.EMPP_KOPRU_DEFTER || path.join(os.homedir(), '.empp-agent', 'imza-kopru-islenen.json'),
    anahtar: env.EMPP_KASA_SSH_ANAHTAR || '',
    konak: konakAcik || 'mac',
    // saat = Nadir'in kuralı · hep = eski tek-konak davranışı (konak verilmemiş) · zorla = elle devir
    kip: zorla ? 'zorla' : (konakAcik ? 'saat' : 'hep'),
  };
}

// ------------------------------------------------------------------ nöbet kuralı (saf)
const NOBET_SAAT_DILIMI = 'Europe/Istanbul';
const OFIS_BASLA_DK = 9 * 60 + 30; // 09:30 dahil
const OFIS_BITIS_DK = 17 * 60 + 45; // 17:45 dahil (17:46 → srv21)
const DAMGA_TAZE_MS = 3 * 60000;
const DAMGA_ADI = '.nobetci.json';
const GUNLER = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });

/** İstanbul yerel gün (0=Pazar) ve gün içi dakika. Konağın TZ ayarına bağlı DEĞİL. */
function istanbulZamani(ms) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: NOBET_SAAT_DILIMI, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const al = (t) => (p.find((x) => x.type === t) || {}).value;
  return { gun: GUNLER[al('weekday')], dk: Number(al('hour')) * 60 + Number(al('minute')) };
}

/** Saate göre nöbetçi konak: Pzt-Cum 09:30-17:45 → 'mac', diğer her an → 'srv21'. */
function saatNobetcisi(ms) {
  const { gun, dk } = istanbulZamani(ms);
  const isGunu = gun >= 1 && gun <= 5;
  return isGunu && dk >= OFIS_BASLA_DK && dk <= OFIS_BITIS_DK ? 'mac' : 'srv21';
}

/** Kasadaki damga metni → {konak, zaman, zorla} ya da null (yok/bozuk/bilinmeyen konak). */
function damgaCoz(metin) {
  let o = null;
  try { o = JSON.parse(String(metin || '').trim()); } catch (_) { return null; }
  if (!o || !KONAKLAR.includes(o.konak) || !Number.isFinite(Number(o.zaman))) return null;
  return { konak: o.konak, zaman: Number(o.zaman), zorla: o.zorla === true };
}

/** Karşı konağın damgası son 3 dk içinde mi (saat kayması iki yönlü tolere edilir). */
function yabanciTaze(damga, konak, simdiMs) {
  return !!damga && damga.konak !== konak && Math.abs(simdiMs - damga.zaman) < DAMGA_TAZE_MS;
}

/** Saat kuralına göre pasif mi? Kasaya bağlanmadan karar verir. */
function saatePasifMi(cfg, simdiMs) {
  return cfg.kip === 'saat' && saatNobetcisi(simdiMs) !== cfg.konak;
}

/**
 * Nöbet hükmü (saf). `damga` kasadan okunan (çözülmüş) damga ya da null.
 * @returns {{rol:'pasif'|'nobetci'|'cekildi'|'devir', damgaYaz:boolean, sebep:string}}
 *   pasif   — saat kuralı karşı konağı gösteriyor; kasaya hiç dokunulmaz
 *   nobetci — damga yazılır, istekler işlenir
 *   cekildi — karşı konak son 3 dk içinde damga yazmış; damga yazılmaz, istek okunmaz (çift tetik freni)
 *   devir   — zorla kipinde karşı konak taze: damga yazılır, bu tur İŞ YAPILMAZ (karşı taraf görüp çekilsin)
 */
function nobetKarari({ konak, kip, simdiMs, damga }) {
  if (!KONAKLAR.includes(konak)) return { rol: 'pasif', damgaYaz: false, sebep: `bilinmeyen konak: ${konak}` };
  if (kip === 'saat' && saatNobetcisi(simdiMs) !== konak) {
    return { rol: 'pasif', damgaYaz: false, sebep: `saat kuralı: nöbetçi ${saatNobetcisi(simdiMs)}` };
  }
  if (!yabanciTaze(damga, konak, simdiMs)) return { rol: 'nobetci', damgaYaz: true, sebep: `kip ${kip}` };
  const yas = Math.round(Math.abs(simdiMs - damga.zaman) / 1000);
  if (kip === 'zorla' && !damga.zorla) {
    return { rol: 'devir', damgaYaz: true, sebep: `zorla: ${damga.konak} damgası ${yas} sn önce — bu tur yalnız damga` };
  }
  return { rol: 'cekildi', damgaYaz: false,
    sebep: `${damga.konak} damgası ${yas} sn önce${damga.zorla ? ' (zorla)' : ''} — çift tetik freni` };
}

/** Damga yazan cmd komutu (saf). JSON yalnız [a-z0-9{}":,] içerir; `}` sonda → `N>` tanıtıcı tuzağı yok. */
function damgaYazKomutu(dizin, konak, zaman, zorla = false) {
  if (!KONAKLAR.includes(konak)) throw new Error(`güvensiz konak: ${konak}`);
  const govde = JSON.stringify({ konak, zaman: Math.trunc(Number(zaman)), zorla: zorla === true });
  return `mkdir "${dizin}" 2>nul & echo ${govde}>"${dizin}\\${DAMGA_ADI}"`;
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
  const kimlik = cfg.anahtar ? ['-i', cfg.anahtar, '-o', 'IdentitiesOnly=yes'] : [];
  const ssh = (komut) => kos('ssh', ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', ...kimlik, cfg.ssh, komut],
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
    /** @returns {{konak,zaman,zorla}|null} — dosya yok/bozuk → null */
    damgaOku() { return damgaCoz(ssh(`type "${cfg.dizin}\\${DAMGA_ADI}" 2>nul`).stdout); },
    damgaYaz(konak, zaman, zorla) { return ssh(damgaYazKomutu(cfg.dizin, konak, zaman, zorla)).status === 0; },
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

/**
 * Konağa göre yayincilikadm ortamı (saf). srv21 PAYLAŞILAN sunucu: aynı hesapla (nadir.net_60) uzun süren
 * işler var. HESAP_BEKLE=90 → etkin devralma eşiği 5 dk olur ve kilit sahibi ÖLDÜRÜLÜR (06.10 10:37
 * ölçüldü: srv21'de salt-okur `exe-status` 1450 dk'lık bir `web-create`'i düşürdü). srv21 köprüsü
 * başkasının işini öldürmez: devralma kapalı; kilit doluysa istek yerinde bekler, 3 turda bildirim.
 */
function kosOrtami(konak, env = process.env) {
  const o = { ...env, YAYINCILIKADM_HESAP_BEKLE: KILIT_BEKLE_SN };
  if (konak === 'srv21' && env.YAYINCILIKADM_HESAP_DEVRAL_SN === undefined) o.YAYINCILIKADM_HESAP_DEVRAL_SN = '0';
  return o;
}

async function tur({ uzak, kos, log, kuru = false, simdi = Date.now, islenmis = null, isaretle = () => {}, bildir = () => {},
  nobetTazele = () => true }) {
  const ozet = { islenen: 0, calisan: [], reddedilen: 0, tasinamayan: 0, kilitli: 0, kesildi: false };
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
      if (!kuru && !nobetTazele()) {
        // Karşı konak bu arada damga yazdı (devir / çift tetik freni): kalan istekler ona kalır.
        log(`köprü: nöbet karşı konağa geçti — tur ${ad} öncesinde kesildi, istek yerinde`);
        ozet.kesildi = true;
        break;
      }
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

/** Rol değişince true (log gürültüsü: pasif konak dakikada bir satır yazmasın). */
function rolDegisti(yol, rol) {
  let onceki = '';
  try { onceki = fs.readFileSync(yol, 'utf8').trim(); } catch (_) { onceki = ''; }
  if (onceki === rol) return false;
  try { fs.mkdirSync(path.dirname(yol), { recursive: true }); fs.writeFileSync(yol, rol); } catch (_) { /* yoksay */ }
  return true;
}

const BOS_OZET = () => ({ islenen: 0, calisan: [], reddedilen: 0, tasinamayan: 0, kilitli: 0, kesildi: false });

/**
 * Tek tur: nöbet → damga → istekler. `uzak`/`simdi` test için enjekte edilir. Pasifte `uzak`a HİÇ dokunulmaz.
 * @returns {Promise<object>} tur özeti + `rol`
 */
async function nobetliTur({ cfg, uzak, kos, log, kuru = false, simdi = Date.now, islenmis = null,
  isaretle = () => {}, bildir = () => {}, rolYol = null }) {
  const rolBildir = (rol, sebep) => {
    if (!rolYol || rolDegisti(rolYol, rol)) log(`köprü [${cfg.konak}/${cfg.kip}]: rol ${rol} — ${sebep}`);
  };
  if (saatePasifMi(cfg, simdi())) {
    rolBildir('pasif', `saat kuralı: nöbetçi ${saatNobetcisi(simdi())}`);
    return { ...BOS_OZET(), rol: 'pasif' };
  }
  const karar = nobetKarari({ konak: cfg.konak, kip: cfg.kip, simdiMs: simdi(), damga: uzak.damgaOku() });
  rolBildir(karar.rol, karar.sebep);
  const zorla = cfg.kip === 'zorla';
  if (karar.damgaYaz && !kuru && uzak.damgaYaz(cfg.konak, simdi(), zorla) === false) {
    log('köprü: nöbet damgası YAZILAMADI — tur atlandı (çift tetik freni kör kalmasın)');
    return { ...BOS_OZET(), rol: 'damga-yok' };
  }
  if (karar.rol !== 'nobetci') return { ...BOS_OZET(), rol: karar.rol };
  // Her komuttan ÖNCE: karşı konak taze damga yazdıysa dur (zorla da durur — devir el sıkışması bir sonraki
  // turun `nobetKarari`na kalır); yoksa damgayı tazele (uzun turda bayatlamasın).
  const nobetTazele = () => {
    if (yabanciTaze(uzak.damgaOku(), cfg.konak, simdi())) return false;
    return uzak.damgaYaz(cfg.konak, simdi(), zorla) !== false;
  };
  const ozet = await tur({ uzak, kos, log, kuru, simdi, islenmis, isaretle, bildir, nobetTazele });
  if (!kuru && !ozet.kesildi && ozet.calisan.length) uzak.damgaYaz(cfg.konak, simdi(), zorla);
  return { ...ozet, rol: 'nobetci' };
}

async function ana(argv = process.argv.slice(2)) {
  const cfg = ayarlar();
  const log = (...a) => console.log(new Date().toISOString(), ...a);
  const kuru = argv.includes('--kuru');
  if (!KONAKLAR.includes(cfg.konak)) {
    log(`köprü: EMPP_KOPRU_KONAK geçersiz (${cfg.konak}) — mac|srv21; tur atlandı`);
    return { ...BOS_OZET(), rol: 'pasif' };
  }
  const ajanDiz = path.join(os.homedir(), '.empp-agent');
  const rolYol = path.join(ajanDiz, 'imza-kopru-rol');
  // Pasif konak kilit almaz, kasaya bağlanmaz, defter okumaz.
  if (saatePasifMi(cfg, Date.now())) return nobetliTur({ cfg, uzak: null, kos: null, log, kuru, rolYol });
  const kilitYol = path.join(ajanDiz, 'imza-tetik-koprusu.lock');
  if (!kuru && !tekKopyaAl(kilitYol)) {
    log('köprü: başka kopya koşuyor — tur atlandı');
    return BOS_OZET();
  }
  const kos = async (a) => {
    // Hesap kilidi doluysa çağrı 90 sn bekler (YAYINCILIKADM_HESAP_KILIDI=0 KULLANILMAZ: ortak freni kapatır).
    const r = spawnSync(a[0], a.slice(1), { encoding: 'utf8', timeout: 10 * 60000, env: kosOrtami(cfg.konak) });
    return { kod: r.status === null ? -1 : r.status, cikti: `${r.stdout || ''}${r.stderr || ''}` };
  };
  const islenmis = defterOku(cfg.defter);
  let ozet;
  try {
    ozet = await nobetliTur({
      cfg, uzak: sshUzak(cfg), kos, log, kuru, rolYol,
      islenmis, isaretle: () => defterYaz(cfg.defter, islenmis),
      bildir: (m) => tavanliBildir(path.join(ajanDiz, 'imza-kopru-bildirim.damga'), m,
        (x) => spawnSync('bildir', ['bekci', `[${cfg.konak}] ${x}`], { encoding: 'utf8', timeout: 20000 })),
    });
  } finally {
    if (!kuru) { try { fs.rmSync(kilitYol, { force: true }); } catch (_) { /* yoksay */ } }
  }
  if (ozet.islenen || ozet.reddedilen || ozet.tasinamayan || ozet.kilitli || ozet.kesildi) {
    log('köprü: tur özeti', JSON.stringify(ozet));
  }
  return ozet;
}

module.exports = {
  ayarlar, tasiKomutu, sshUzak, defterOku, defterYaz, tur, ana, kilitMi, tavanliBildir, tekKopyaAl,
  KONAKLAR, DAMGA_ADI, DAMGA_TAZE_MS, istanbulZamani, saatNobetcisi, damgaCoz, yabanciTaze, saatePasifMi,
  nobetKarari, damgaYazKomutu, kosOrtami, rolDegisti, nobetliTur,
};

if (require.main === module) {
  ana().then(() => process.exit(0)).catch((e) => { console.error('köprü HATA:', e && e.stack); process.exit(1); });
}
