#!/usr/bin/env node
'use strict';
/**
 * İMZA BEKÇİSİ — "imza bekliyor" Windows paketlerinin tek yayın yolu (sözleşme exesiz-kaynak §2a,
 * Nadir 02.10). launchd her 30 dk'da bir koşturur (şablon: tools/windows/com.empp.imza-bekcisi.plist;
 * KURULUMU ŞEF YAPAR). Tek tur, sonra çıkar.
 *
 * Tur:
 *   0. Tekil koşu: `<hazır kök>/.bekci.kilit` (flock, bloklamaz) — önceki tur sürüyorsa çık.
 *   1. Bekleyen yoksa hiçbir şey yapma (VPN/diske dokunma).
 *   2. Yuva erişilemiyorsa diskleri bağlamayı DENE (impark-vpn §0: önce ölç, bağlıysa dokunma):
 *        İmpark VPN ayakta (172.17.2.21-24'ten biri ping'e cevap) → `impark-diskler.sh --sessiz`
 *        (yalnız disk bağlar, VPN'e dokunmaz).
 *        VPN kapalı → yalnız PAROLASIZ sudo kuralı varsa (`sudo -n -l openvpn`) betik VPN'i de açar;
 *        yoksa denenmez (betiğin yedeği yönetici parolası penceresi açar — odak çalan pencere yasak).
 *   3. Yuva erişilirse kuyruğu EN ESKİDEN sırayla işle, her kayıt için:
 *        a. kayıt kilidi (runner aynı kaydı devralıyorsa atla);
 *        b. sunucu yoklaması: `/result/presign` (yükleme yok) — kira bu ajanda değilse (409) imzalama;
 *           runner bir sonraki kiralamada kaydı kendisi devralır (bugünkü sunucuda yol budur);
 *        c. windows-serit `imzaliYayinZinciri` — runner'ın AYNI imza + Authenticode + imzalı kabul
 *           fonksiyonu, AYNI imza kilidi (`winImzaKilit`); ikinci bir imza yolu YOK;
 *        d. runner `postResultSuccess` (R2 + /result completed), kanıt, `yayinlandi/`'ye TAŞI.
 *        İmzalı kopya kabulden KALDI → `reddedildi/`'ye taşı + bildir (paket kusuru). İmza/doğrulama/
 *        yükleme hatası → kayıt yerinde kalır, `sonHata` yazılır, tur DURUR (kuyruk tek yuvalı).
 *   4. Bildirim: bekleyen varken yuva erişilemiyorsa ya da en eski bekleyen 3 saati aştıysa
 *      `bildir paket "<N> Windows paketi imza bekliyor: <sebep>" -p yuksek`; aynı sebep için en çok
 *      3 saatte bir (`.bildirim-durum.json`).
 *
 * İmzasız paket buradan ASLA yüklenmez: yükleme yalnız `imzaliYayinZinciri`'nin döndürdüğü, Authenticode'u
 * doğrulanmış ve kabulden geçmiş imzalı kopyayla yapılır.
 *
 * Kullanım: node tools/windows/imza-bekcisi.js [--kuru]   (--kuru: yalnız ölç + raporla, dokunma)
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const runner = require('../../src/agent/runner.js');
const W = require('../../src/agent/windows-serit');
const H = require('../../src/agent/windows-hazir');
const { WIN_KASA_KABUL_ISARETI, ertelenebilirKaynakHatasi } = require('../../src/agent/runner-helpers');

const IMPARK_PROBLARI = ['172.17.2.21', '172.17.2.22', '172.17.2.23', '172.17.2.24'];

function bekciAyarlari(env = process.env) {
  return {
    bekciDiskBetigi: env.EMPP_IMPARK_DISK_BETIGI || path.join(os.homedir(), 'bin', 'impark-diskler.sh'),
    bekciVpnDene: env.EMPP_IMZA_BEKCI_VPN !== '0',
    bekciOpenvpn: env.EMPP_OPENVPN_IKILI || '/usr/local/sbin/openvpn',
    // Bekçi imza kilidini uzun beklemez: runner imzadaysa bu tur atlanır, 30 dk sonra yeniden.
    bekciImzaKilitBeklemeMs: Number(env.EMPP_IMZA_BEKCI_KILIT_MS || 2 * 60 * 1000),
    bekciBildirIkili: env.EMPP_BILDIR_IKILI || path.join(os.homedir(), '.local', 'bin', 'bildir'),
  };
}

/** Kabul KALDI mı (paket kusuru) — imza/ağ/ölçülemedi DEĞİL. Saf. */
function kabulKaldiMi(hata) {
  const m = String((hata && hata.message) || hata || '');
  if (ertelenebilirKaynakHatasi(hata) || m.includes(WIN_KASA_KABUL_ISARETI)) return false;
  return /kabul kapısından geçemedi \(KALDI\)|başsız kabul kapısından geçemedi \(RED\)/.test(m);
}

/** Sunucu yoklaması hatası "kira bizde değil" mi? Saf. */
function kiraBizdeDegilMi(hata) {
  return /HTTP 409|lease_not_held/.test(String((hata && hata.message) || hata || ''));
}

async function pingVar(komutKos, ip) {
  const r = await komutKos(['ping', '-c', '1', '-W', '2000', ip], { zamanAsimiMs: 5000 });
  return r.kod === 0;
}

/**
 * Diskleri bağlamayı dener (yuva erişilemezken). @returns {Promise<{denendi:boolean, sebep:string}>}
 */
async function diskBagla(cfg, { komutKos, log }) {
  if (!fs.existsSync(cfg.bekciDiskBetigi)) return { denendi: false, sebep: `disk betiği yok: ${cfg.bekciDiskBetigi}` };
  let vpn = false;
  for (const ip of IMPARK_PROBLARI) {
    if (await pingVar(komutKos, ip)) { vpn = true; break; }
  }
  if (!vpn) {
    if (!cfg.bekciVpnDene) return { denendi: false, sebep: 'İmpark VPN kapalı (bekçi VPN açmaz: EMPP_IMZA_BEKCI_VPN=0)' };
    const sudo = await komutKos(['sudo', '-n', '-l', cfg.bekciOpenvpn], { zamanAsimiMs: 10000 });
    if (sudo.kod !== 0) {
      return { denendi: false, sebep: 'İmpark VPN kapalı — parolasız sudo kuralı yok, VPN açılmadı (parola penceresi açılmaz)' };
    }
  }
  log(`imza-bekçisi: diskler bağlanıyor (${vpn ? 'VPN ayakta, yalnız disk' : 'VPN kapalı, parolasız sudo ile VPN + disk'})`);
  const r = await komutKos(['/bin/bash', cfg.bekciDiskBetigi, '--sessiz'], { zamanAsimiMs: 3 * 60 * 1000 });
  return { denendi: true, sebep: r.kod === 0 ? 'disk betiği 0' : `disk betiği çıkış ${r.kod}${r.zamanAsimi ? ' (zaman aşımı)' : ''}` };
}

async function kanitOku(cfg, giris) {
  const m = giris.manifest;
  try {
    return JSON.parse(await fsp.readFile(W.kanitYolu(cfg, m.bookId, m.surum), 'utf8'));
  } catch (_) {
    return {
      bookId: String(m.bookId), bookTitle: (m.job && m.job.bookTitle) || null, surum: m.surum,
      imzasiz: { md5: m.md5, sha256: m.sha256, boyut: m.boyut },
      kapi: m.kanit && m.kanit.kapi, kokIndex: m.kanit && m.kanit.kokIndex,
      kabulImzasiz: 'GECTI', kabulImzasizKapi: m.kabulKapi, kabulImzasizKanit: m.kabulKanit,
    };
  }
}

async function tokenOku(cfg) {
  const t = JSON.parse(await fsp.readFile(cfg.tokenFile, 'utf8'));
  if (!t || !t.agentId || !t.token) throw new Error('ajan jetonu yok/eksik');
  return { agentId: t.agentId, token: t.token };
}

/**
 * Tek kaydı imzalat + doğrula + yayınla. @returns {Promise<{durum:string, sebep?:string, dizin?:string}>}
 */
async function kaydiIsle(giris, d) {
  const { cfg, log } = d;
  const m = giris.manifest;
  const job = { ...(m.job || {}), bookId: m.bookId, platform: 'windows' };
  const kilit = await H.kayitKilidiDene(giris.dizin);
  if (!kilit) return { durum: 'atlandi', sebep: 'kayıt başka süreçte (runner devralıyor)' };
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'imza-bekcisi-'));
  try {
    try {
      await d.presignUpload(d.auth, job);
    } catch (e) {
      if (kiraBizdeDegilMi(e)) {
        return { durum: 'atlandi', sebep: 'kira sunucuda bu ajanda değil — runner bir sonraki kiralamada devralır' };
      }
      return { durum: 'hata', sebep: `sunucu yoklaması: ${e.message}` };
    }
    const kanit = await kanitOku(cfg, giris);
    kanit.hazirDizini = giris.dizin;
    let zincir;
    try {
      zincir = await d.imzaliYayinZinciri({
        imzasiz: giris.exeYolu, job, work, cfg: { ...cfg, winImzaKilitBeklemeMs: cfg.bekciImzaKilitBeklemeMs },
        log, sleep: d.sleep, aktivasyon: d.aktivasyonBeklenir(job.bookTitle), kanit,
      });
    } catch (e) {
      if (kabulKaldiMi(e)) {
        const s = await H.sonuclandir(cfg, giris, 'reddedildi', { durum: 'red', sebep: e.message, zamanRed: new Date().toISOString() });
        // Sunucu satırı TUTUYOR (imza-bekliyor hold): kapatılmazsa sonsuza dek running kalır. Paket kusuru
        // → failed (kira + faz temizlenir; panel "yeniden kuyruğa al" ile yeni üretim). Best-effort:
        // postResultFailure fırlatmaz; sunucu eskiyse (satır zaten kuyruğa dönmüş) 409 zararsızdır.
        if (d.postResultFailure) await d.postResultFailure(d.auth, job, `[imza-bekliyor] imzalı kabul KALDI: ${e.message}`.slice(0, 1500));
        return { durum: 'red', sebep: e.message, dizin: s.dizin };
      }
      await H.manifestGuncelle(giris.dizin, { sonHata: e.message, sonDeneme: new Date().toISOString() });
      return { durum: 'hata', sebep: e.message };
    }
    const yayin = await d.postResultSuccess(d.auth, job, zincir.imzaliYol);
    await W.yayinKaniti(zincir, yayin, cfg, log);
    const s = await H.sonuclandir(cfg, giris, 'yayinlandi', {
      durum: 'yayinlandi', imzali: zincir.kanit.imzali,
      yayin: { r2ObjectKey: yayin.r2ObjectKey, publicUrl: yayin.publicUrl, zaman: new Date().toISOString(), yayinlayan: 'imza-bekcisi' },
    });
    return { durum: 'yayinlandi', dizin: s.dizin };
  } catch (e) {
    try { await H.manifestGuncelle(giris.dizin, { sonHata: e.message, sonDeneme: new Date().toISOString() }); } catch (_) { /* kayıt taşınmış olabilir */ }
    return { durum: 'hata', sebep: e.message };
  } finally {
    await kilit();
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

async function bildirimGonder(d, karar, durum) {
  const { cfg, komutKos, log } = d;
  const r = await komutKos([cfg.bekciBildirIkili, 'paket', karar.mesaj, '-p', 'yuksek'], { zamanAsimiMs: 20000 });
  log(`imza-bekçisi: bildirim ${r.kod === 0 ? 'gönderildi' : `GÖNDERİLEMEDİ (çıkış ${r.kod})`}: ${karar.mesaj}`);
  if (r.kod === 0) await H.bildirimDurumuYaz(cfg, { ...durum, [karar.anahtar]: d.simdi() });
}

/**
 * Tek tur. Bağımlılıklar testte ezilir. @returns {Promise<object>} tur özeti
 */
async function tur(d) {
  const { cfg, log } = d;
  const ozet = { bekleyen: 0, yayinlanan: 0, reddedilen: 0, atlanan: 0, yuva: null, disk: null, bildirim: null };
  // Bekleyen yoksa HİÇBİR ŞEY yazılmaz/ölçülmez (kök dizin bile açılmaz) — salt okuma.
  if (!(await H.hazirListesi(cfg)).length) { log('imza-bekçisi: bekleyen paket yok'); return ozet; }
  await fsp.mkdir(cfg.winHazirKoku, { recursive: true });
  const tekil = await W.kilitDene(path.join(cfg.winHazirKoku, '.bekci.kilit'));
  if (!tekil.tutucu) {
    log(tekil.kod === 75 ? 'imza-bekçisi: önceki tur sürüyor — çıkılıyor' : `imza-bekçisi: tekil kilit açılamadı (perl çıkış ${tekil.kod})`);
    ozet.atlandi = 'tekil-kilit';
    return ozet;
  }
  try {
    let liste = await H.hazirListesi(cfg);
    ozet.bekleyen = liste.length;
    if (!liste.length) { log('imza-bekçisi: bekleyen paket yok'); return ozet; }
    let yuva = await W.imzaYuvasiErisilirMi(cfg);
    let sebep = yuva ? null : 'imza yuvası erişilemiyor (İmpark VPN / Storage7)';
    if (!yuva && !d.kuru) {
      ozet.disk = await diskBagla(cfg, d);
      yuva = await W.imzaYuvasiErisilirMi(cfg);
      if (!yuva) sebep = `imza yuvası erişilemiyor — ${ozet.disk.sebep}`;
    }
    ozet.yuva = yuva;
    if (yuva && !d.kuru) {
      for (const giris of liste) {
        const r = await kaydiIsle(giris, d);
        log(`imza-bekçisi: ${path.basename(giris.dizin)} → ${r.durum}${r.sebep ? ` (${String(r.sebep).slice(0, 200)})` : ''}`);
        if (r.durum === 'yayinlandi') ozet.yayinlanan += 1;
        else if (r.durum === 'red') {
          ozet.reddedilen += 1;
          await bildirimGonder(d, { anahtar: `red:${giris.manifest.bookId}`, mesaj: `Windows paketi ${giris.manifest.bookId} imzalı kabulden KALDI — yayınlanmadı: ${String(r.sebep).slice(0, 160)}` }, await H.bildirimDurumuOku(cfg));
        } else if (r.durum === 'atlandi') { ozet.atlanan += 1; sebep = sebep || r.sebep; }
        else { sebep = `imza/yayın hatası: ${String(r.sebep).slice(0, 160)}`; break; }
      }
      liste = await H.hazirListesi(cfg);
    }
    const durum = await H.bildirimDurumuOku(cfg);
    const karar = H.bildirimKarari({
      bekleyenSayisi: liste.length, enEskiMs: liste.length ? liste[0].zamanMs : null, yuvaErisilir: yuva,
      sebep, simdiMs: d.simdi(), durum, esikMs: cfg.winHazirBildirimEsikMs, aralikMs: cfg.winHazirBildirimAralikMs,
    });
    ozet.bildirim = karar.gonder ? karar.mesaj : null;
    if (karar.gonder && !d.kuru) await bildirimGonder(d, karar, durum);
    ozet.kalan = liste.length;
    return ozet;
  } finally {
    await W.kilitBirak(tekil.tutucu);
  }
}

async function ana(argv = process.argv.slice(2)) {
  const cfg = { ...runner.CONFIG, ...bekciAyarlari() };
  const log = (...a) => console.log(new Date().toISOString(), ...a);
  const d = {
    cfg, log, kuru: argv.includes('--kuru'), komutKos: W.komutKos, simdi: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)), imzaliYayinZinciri: W.imzaliYayinZinciri,
    postResultSuccess: runner.postResultSuccess, postResultFailure: runner.postResultFailure, presignUpload: runner.presignUpload,
    aktivasyonBeklenir: runner.aktivasyonBeklenir, auth: null,
  };
  if ((await H.hazirListesi(cfg)).length && !d.kuru) d.auth = await tokenOku(cfg);
  const ozet = await tur(d);
  log('imza-bekçisi: tur özeti', JSON.stringify(ozet));
  return ozet;
}

if (require.main === module) {
  ana().then(() => process.exit(0)).catch((e) => { console.error('imza-bekçisi HATA:', e && e.stack); process.exit(1); });
}

module.exports = { bekciAyarlari, kabulKaldiMi, kiraBizdeDegilMi, diskBagla, kaydiIsle, tur, ana, IMPARK_PROBLARI };
