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
 *        e. imzalı kopya `D:\empp-imzali-son\<Set adı>.exe` (src/agent/imzali-arsiv.js; Nadir 06.10): sha
 *           doğrulanınca eski *.exe silinir. Hata yayını düşürmez (uyarı + bildir bekci).
 *        İmzalı kopya kabulden KALDI → `reddedildi/`'ye taşı + bildir (paket kusuru). İmza/doğrulama/
 *        yükleme hatası → kayıt yerinde kalır, `sonHata` yazılır, tur DURUR (kuyruk tek yuvalı).
 *      BORU HATTI (06.10, Nadir: "imzayı da paralel yapalım"): bir kaydın `_hazir` kopyası bitince
 *      (imza/kabul/yayın sürerken) SIRADAKİ kaydın kopyası arka planda başlar — en çok 1 ileri kopya, kayıt
 *      kilidi altında; bitince manifest'e `onKopya` yazılır. Sıra o kayda gelince kopya ATLANIR (uzak boyut
 *      eşitse; değilse normal kopya). Yuva/istek/takas/imza TEK sıralı kalır (imza kilidi + tek döngü).
 *      Çökme: yarım kopya `.kopyalaniyor` adında kalır, onKopya yazılmaz → sonraki tur baştan kopyalar.
 *      Kapatma: EMPP_IMZA_ON_KOPYA=0. (Geri okuma ayrı bayrak: EMPP_IMZA_GERI_OKUMA=1.)
 *   4. Bildirim: bekleyen varken yuva erişilemiyorsa ya da en eski bekleyen 3 saati aştıysa
 *      `bildir paket "<N> Windows paketi imza bekliyor: <sebep>" -p yuksek`; aynı sebep için en çok
 *      3 saatte bir (`.bildirim-durum.json`).
 *
 * İmzasız paket buradan ASLA yüklenmez: yükleme yalnız `imzaliYayinZinciri`'nin döndürdüğü, Authenticode'u
 * doğrulanmış ve kabulden geçmiş imzalı kopyayla yapılır.
 *
 * Kullanım: node tools/windows/imza-bekcisi.js [--kuru] [--yalniz=<bookId>]
 *   (--kuru: yalnız ölç + raporla, dokunma; --yalniz: yalnız o kitabın kaydı — elle ilk tur)
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const runner = require('../../src/agent/runner.js');
const { ikiliKomutu } = require('../../src/agent/bildir-ikili');
const W = require('../../src/agent/windows-serit');
const H = require('../../src/agent/windows-hazir');
const A = require('../../src/agent/imzali-arsiv');
const { WIN_KASA_KABUL_ISARETI, ertelenebilirKaynakHatasi } = require('../../src/agent/runner-helpers');

const IMPARK_PROBLARI = ['172.17.2.21', '172.17.2.22', '172.17.2.23', '172.17.2.24'];

function bekciAyarlari(env = process.env) {
  return {
    bekciDiskBetigi: env.EMPP_IMPARK_DISK_BETIGI || path.join(os.homedir(), 'bin', 'impark-diskler.sh'),
    bekciVpnDene: env.EMPP_IMZA_BEKCI_VPN !== '0',
    bekciOpenvpn: env.EMPP_OPENVPN_IKILI || '/usr/local/sbin/openvpn',
    // Bekçi imza kilidini uzun beklemez: runner imzadaysa bu tur atlanır, 30 dk sonra yeniden.
    bekciImzaKilitBeklemeMs: Number(env.EMPP_IMZA_BEKCI_KILIT_MS || 2 * 60 * 1000),
    // İmzalı kabul runner'ın imzasız kabuluyla kasa makine kilidinde yarışır; 30 dk (varsayılan) aşılırsa
    // kabul ÖLÇÜLEMEDİ olur ve aynı exe sonraki turda yeniden imzalanır. Bekçi kilidi uzun bekler.
    bekciKasaKilitBeklemeMs: Math.max(0, Number(env.EMPP_BEKCI_KILIT_BEKLEME_DK || 120) || 120) * 60 * 1000,
    bekciBildirIkili: env.EMPP_BILDIR_IKILI || path.join(os.homedir(), '.local', 'bin', 'bildir'),
    // İmzalı son sürüm arşivi (Nadir 06.10): win32 varsayılanı D:\empp-imzali-son; win32 dışı/`0` → kapalı.
    imzaliArsivKoku: A.arsivKoku(env),
    // Boru hattı (06.10): sıradaki paketin _hazir kopyası önceki paket imzadayken. `0` kapatır.
    bekciOnKopya: env.EMPP_IMZA_ON_KOPYA !== '0',
    bekciUzakStatMs: Number(env.EMPP_IMZA_UZAK_STAT_MS || 30000),
  };
}

/** Uzak (SMB) dosya boyutu; yok/erişilemez/zaman aşımı → null. Asılmaz. */
async function uzakBoyut(yol, msTavan = 30000) {
  if (!yol) return null;
  let t = null;
  try {
    return await Promise.race([
      fsp.stat(yol).then((s) => s.size).catch(() => null),
      new Promise((coz) => { t = setTimeout(() => coz(null), msTavan); }),
    ]);
  } finally { if (t) clearTimeout(t); }
}

/** Kaydın `_hazir` ön-kopyası kullanılabilir mi (manifest diskten TAZE okunur). */
async function onKopyaHazirMi(giris, cfg) {
  const m = (await H.manifestOku(giris.dizin)) || giris.manifest;
  if (!m || !m.onKopya) return { gecerli: false, sebep: 'ön-kopya kaydı yok' };
  const exeAdi = path.basename(giris.exeYolu);
  return H.onKopyaKarari(m, { exeAdi, uzakBoyut: await uzakBoyut(W.hazirKopyaYolu(cfg, giris.exeYolu), cfg.bekciUzakStatMs) });
}

/**
 * Ön-kopya (boru hattı): kaydın `_hazir` kopyasını windows-serit `imzaHazirla` ile (runner'ın AYNI kopya
 * adımı) yapar; kayıt kilidi altında, yuvaya dokunmaz. Başarıda manifest'e `onKopya` yazar. ASLA fırlatmaz.
 * @returns {Promise<{durum:'hazir'|'zaten'|'atlandi'|'hata', sebep?:string}>}
 */
async function onKopyala(giris, d) {
  const { cfg, log } = d;
  const ad = path.basename(giris.dizin);
  try {
    if ((await onKopyaHazirMi(giris, cfg)).gecerli) { log(`imza-bekçisi: ön-kopya ${ad}: zaten hazır`); return { durum: 'zaten' }; }
  } catch (_) { /* karar verilemedi → kopyala */ }
  const kilit = await H.kayitKilidiDene(giris.dizin);
  if (!kilit) return { durum: 'atlandi', sebep: 'kayıt başka süreçte' };
  let work = null;
  try {
    work = await fsp.mkdtemp(path.join(os.tmpdir(), 'imza-onkopya-'));
    const t0 = Date.now();
    log(`imza-bekçisi: ön-kopya başladı: ${ad} (önceki paket imza/kabul/yayında)`);
    const hazirla = d.imzaHazirla || W.imzaHazirla;
    const kanit = await hazirla({ exe: giris.exeYolu, work, cfg, log: (...a) => log('[ön-kopya]', ...a) });
    const m = (await H.manifestOku(giris.dizin)) || giris.manifest;
    const sha256 = (kanit && kanit.sha256) || m.sha256 || null;
    if (kanit && kanit.sha256 && m.sha256 && kanit.sha256 !== m.sha256) {
      return { durum: 'hata', sebep: `yerel exe sha256 kayıtla tutmadı (${kanit.sha256.slice(0, 12)} ≠ ${String(m.sha256).slice(0, 12)})` };
    }
    const boyut = (kanit && kanit.boyut) || m.boyut || (await fsp.stat(giris.exeYolu)).size;
    const uzak = await uzakBoyut(W.hazirKopyaYolu(cfg, giris.exeYolu), cfg.bekciUzakStatMs);
    if (uzak !== boyut) return { durum: 'hata', sebep: `uzak kopya boyutu ${uzak === null ? 'yok' : uzak} ≠ ${boyut}` };
    await H.manifestGuncelle(giris.dizin, {
      onKopya: {
        ad: path.basename(giris.exeYolu), boyut, sha256, geriOkuma: Boolean(kanit && kanit.geriOkuma),
        zaman: new Date().toISOString(), sureSn: Math.round((Date.now() - t0) / 1000),
      },
    });
    log(`imza-bekçisi: ön-kopya bitti: ${ad} (${Math.round((Date.now() - t0) / 1000)} sn, ${boyut} B)`);
    return { durum: 'hazir' };
  } catch (e) {
    return { durum: 'hata', sebep: e.message };
  } finally {
    await kilit();
    if (work) await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
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

async function pingVar(komutKos, ip, platform = process.platform) {
  const r = await komutKos(platform === 'win32' ? ['ping', '-n', '1', '-w', '2000', ip]
    : ['ping', '-c', '1', '-W', '2000', ip], { zamanAsimiMs: 5000 });
  return r.kod === 0;
}

/**
 * Diskleri bağlamayı dener (yuva erişilemezken). @returns {Promise<{denendi:boolean, sebep:string}>}
 */
async function diskBagla(cfg, { komutKos, log, platform = process.platform }) {
  // windows-kasa: VPN = OpenVPNService (config-auto, açılışta kalkar), SMB = Administrator kimlik
  // kasası (cmdkey). Bekçi ne VPN açar ne disk bağlar; yalnız ölçer.
  if (platform === 'win32') return { denendi: false, sebep: 'win32: VPN servisi + cmdkey ile kalıcı — bekçi bağlamaz' };
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

/** Bayat kayıt: `bayat/`'a al + sunucu satırını kapat (best-effort). */
async function bayatIsle(giris, job, karar, d) {
  const b = await H.bayatKenaraAl(d.cfg, giris, karar);
  if (d.postResultFailure) {
    const ayrinti = karar.kayitli ? `kayıt ${karar.kayitli}, geçerli ${karar.gecerli}` : karar.sebep;
    await d.postResultFailure(d.auth, job, `[imza-bekliyor] hazır kayıt bayat (${ayrinti})`.slice(0, 1500));
  }
  return { durum: 'bayat', sebep: b.sebep, dizin: b.dizin };
}

/**
 * Tek kaydı imzalat + doğrula + yayınla. @returns {Promise<{durum:string, sebep?:string, dizin?:string}>}
 */
async function kaydiIsle(giris, d, boru = {}) {
  const { cfg, log } = d;
  const m = giris.manifest;
  const job = { ...(m.job || {}), bookId: m.bookId, platform: 'windows' };
  // Kanonik damga hazır kayıtta `manifest.kanonik`te durur (m.job'da yok): /result'a motor/kabuk
  // sütunları gitsin (04.10: 45449 yayınlandı, sütunlar NULL kaldı).
  if (!job.kanonikSurum && m.kanonik && typeof m.kanonik === 'object') job.kanonikSurum = m.kanonik;
  const kilit = await H.kayitKilidiDene(giris.dizin);
  if (!kilit) return { durum: 'atlandi', sebep: 'kayıt başka süreçte (runner devralıyor)' };
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'imza-bekcisi-'));
  try {
    let yoklama;
    try {
      yoklama = await d.presignUpload(d.auth, job);
    } catch (e) {
      if (kiraBizdeDegilMi(e)) {
        return { durum: 'atlandi', sebep: 'kira sunucuda bu ajanda değil — runner bir sonraki kiralamada devralır' };
      }
      return { durum: 'hata', sebep: `sunucu yoklaması: ${e.message}` };
    }
    // BAYAT KONTROLÜ (04.10, imzadan ve R2'den ÖNCE): (a) kaynak sürümü — sunucunun geçerli sürümü
    // `d.gecerliKaynakSurumu` enjeksiyonundan ya da presign yanıtının `gecerliKaynakSurumu` alanından
    // (book-update `/result/presign`, gecerliBuildOku — /result paritesiyle AYNI değer); (b) kanonik damga
    // (motor sha12 / kabuk sürümü, ajanın kendi kanonik.json'ları). Bayatsa imza istenmez, kayıt `bayat/`'a
    // alınır ve sunucu satırı kapatılır (imza-bekliyor tutması sonsuza dek running kalmasın → failed → yeniden kuyruk).
    const gecerli = d.gecerliKaynakSurumu ? await d.gecerliKaynakSurumu(job, yoklama)
      : (yoklama && (yoklama.gecerliKaynakSurumu || yoklama.kaynakSurumu)) || null;
    const karar = H.bayatKarari(m, { gecerliKaynakSurumu: gecerli, gecerliKanonik: await H.gecerliKanonikOku(cfg) });
    if (karar.bilinmiyor) log(`imza-bekçisi: ${path.basename(giris.dizin)} bayat kıyası yapılamadı: ${karar.bilinmiyor}`);
    if (karar.bayat) return bayatIsle(giris, job, karar, d);
    const kanit = await kanitOku(cfg, giris);
    kanit.hazirDizini = giris.dizin;
    // Boru hattı: ön-kopya hazırsa (uzak boyut eşit) `_hazir` kopyası atlanır.
    let hazirlaAtla = false;
    if (cfg.bekciOnKopya) {
      const ok = await onKopyaHazirMi(giris, cfg).catch((e) => ({ gecerli: false, sebep: e.message }));
      hazirlaAtla = ok.gecerli;
      if (giris.manifest.onKopya || ok.gecerli) log(`imza-bekçisi: ${path.basename(giris.dizin)} ön-kopya: ${ok.sebep}${ok.gecerli ? ' → kopya ATLANIR' : ' → kopya yeniden'}`);
    }
    boru.hazirlaAtlandi = hazirlaAtla;
    let zincir;
    try {
      zincir = await d.imzaliYayinZinciri({
        imzasiz: giris.exeYolu, job, work, cfg: { ...cfg, winImzaKilitBeklemeMs: cfg.bekciImzaKilitBeklemeMs, winKasaKilitBeklemeMs: cfg.bekciKasaKilitBeklemeMs },
        log, sleep: d.sleep, aktivasyon: d.aktivasyonBeklenir(job.bookTitle), kanit,
        hazirlaAtla, hazirlandi: typeof boru.hazirlandi === 'function' ? boru.hazirlandi : null,
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
    let yayin;
    try {
      yayin = await d.postResultSuccess(d.auth, job, zincir.imzaliYol);
    } catch (e) {
      // Sunucu kaynak paritesi reddi (yüklemeden/imzadan sonra bile): kayıt yayınlanmış sayılmaz → bayat.
      if (/kaynak-surumu-eski/.test(String((e && e.message) || ''))) return bayatIsle(giris, job, { sebep: `kaynak-surumu-eski: ${e.message}`.slice(0, 300) }, d);
      throw e;
    }
    if (yayin && yayin.yenidenKuyruk) {
      // 200 + yenidenKuyruk: sunucu satırı zaten yeniden kuyruğa aldı; kayıt yayınlandı DEĞİL, bayat.
      const yk = yayin.yenidenKuyruk;
      const b = await H.bayatKenaraAl(cfg, giris, { sebep: `kaynak-surumu-eski: claim ${yk.claim}, geçerli ${yk.gecerli} (/result yeniden kuyruğa aldı)` });
      return { durum: 'bayat', sebep: b.sebep, dizin: b.dizin };
    }
    await W.yayinKaniti(zincir, yayin, cfg, log);
    const yayinZamani = new Date().toISOString();
    const s = await H.sonuclandir(cfg, giris, 'yayinlandi', {
      durum: 'yayinlandi', imzali: zincir.kanit.imzali,
      yayin: { r2ObjectKey: yayin.r2ObjectKey, publicUrl: yayin.publicUrl, zaman: yayinZamani, yayinlayan: 'imza-bekcisi' },
    });
    await yayinBildir(d, m, job);
    // İmzalı kopya `work`'te durur: `finally` work'ü silmeden ÖNCE D: arşivine. Yayını etkilemez.
    const arsiv = await imzaliArsivle(d, {
      kaynak: zincir.imzaliYol, m, job, imzali: zincir.kanit && zincir.kanit.imzali, yayin, yayinZamani,
    });
    return { durum: 'yayinlandi', dizin: s.dizin, arsiv: arsiv.durum };
  } catch (e) {
    try { await H.manifestGuncelle(giris.dizin, { sonHata: e.message, sonDeneme: new Date().toISOString() }); } catch (_) { /* kayıt taşınmış olabilir */ }
    return { durum: 'hata', sebep: e.message };
  } finally {
    await kilit();
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Yayın SONRASI imzalı son sürüm arşivi (`<arşiv kökü>\<Set adı>.exe` + `<bookId>\\son.json`;
 * eski *.exe yalnız sha doğrulandıktan sonra silinir). ASLA fırlatmaz; hata → uyarı + `bildir bekci`.
 */
async function imzaliArsivle(d, { kaynak, m, job, imzali, yayin, yayinZamani }) {
  const { cfg, log } = d;
  try {
    const iz = imzali || {};
    return await A.arsivle({
      kaynak, bookId: m.bookId, exeAdi: m.exe, beklenenSha256: iz.sha256 || null,
      meta: {
        baslik: (job && job.bookTitle) || null, surum: m.surum || null, imzaZamani: iz.zamanDamgasi || null,
        yayinZamani, r2Anahtari: (yayin && yayin.r2ObjectKey) || null,
      },
      kok: cfg.imzaliArsivKoku || null, log,
      bildir: d.arsivBildir || A.varsayilanBildir({ ikili: cfg.bekciBildirIkili, komutKos: d.komutKos, log }),
    });
  } catch (e) {
    log(`imza-bekçisi: UYARI imzalı arşiv adımı: ${e.message}`);
    return { durum: 'hata', sebep: e.message };
  }
}

async function bildirimGonder(d, karar, durum) {
  const { cfg, komutKos, log } = d;
  if (!fs.existsSync(cfg.bekciBildirIkili)) { // windows-kasa'da bildir yok (şef 03.10: ENOENT yutulur)
    log(`imza-bekçisi: bildir yok (${cfg.bekciBildirIkili}) — bildirim atlandı: ${karar.mesaj}`);
    return;
  }
  const [bk, ba] = ikiliKomutu(cfg.bekciBildirIkili, ['paket', karar.mesaj, '-p', 'yuksek']);
  const r = await komutKos([bk, ...ba], { zamanAsimiMs: 20000 });
  log(`imza-bekçisi: bildirim ${r.kod === 0 ? 'gönderildi' : `GÖNDERİLEMEDİ (çıkış ${r.kod})`}: ${karar.mesaj}`);
  if (r.kod === 0) await H.bildirimDurumuYaz(cfg, { ...durum, [karar.anahtar]: d.simdi() });
}

/** Yayın başarı mesajı: `<bookId> <kitap adı> — <MB> MB, imzalı, kabulden geçti, yayınlandı`. */
function yayinMesaji(m, job) {
  const ad = job && job.bookTitle && String(job.bookTitle) !== String(m.bookId) ? ` ${job.bookTitle}` : '';
  const mb = m.boyut ? ` — ${Math.round(m.boyut / 1e6)} MB,` : ' —';
  return `${m.bookId}${ad}${mb} imzalı, kabulden geçti, yayınlandı`;
}

/** Yayın sonrası BAŞARI bildirimi (kanal `paket`). Asla fırlatmaz; EMPP_BILDIRIM=0 kapatır. */
async function yayinBildir(d, m, job) {
  const { cfg, komutKos, log } = d;
  try {
    if (process.env.EMPP_BILDIRIM === '0') return;
    if (!fs.existsSync(cfg.bekciBildirIkili)) { log(`imza-bekçisi: bildir yok (${cfg.bekciBildirIkili}) — yayın bildirimi atlandı`); return; }
    const mesaj = yayinMesaji(m, job);
    const [bk, ba] = ikiliKomutu(cfg.bekciBildirIkili, ['paket', mesaj, '-b', '✅ windows yayınlandı', '-p', 'normal', '-e', 'white_check_mark']);
    const r = await komutKos([bk, ...ba], { zamanAsimiMs: 20000 });
    log(`imza-bekçisi: yayın bildirimi ${r.kod === 0 ? 'gönderildi' : `GÖNDERİLEMEDİ (çıkış ${r.kod})`}: ${mesaj}`);
  } catch (e) { log(`imza-bekçisi: yayın bildirimi hatası: ${e.message}`); }
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
    // --yalniz=<bookId>: elle ilk tur (04.10, şef) — yalnız o kayıt işlenir; ilk imzalı paket
    // kanıtlanmadan kuyruğun geri kalanına dokunulmaz.
    if (d.yalniz) liste = liste.filter((g) => String(g.manifest && g.manifest.bookId) === String(d.yalniz));
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
      // Liste her kayıttan sonra YENİDEN okunur (05.10): tur saatler sürer; bu arada gelen öncelikli
      // kayıt (imza-oncelik.txt) ya da yeni kayıt sıradaki ilk aday olur. Bu turda işlenmiş dizin
      // (atlandı/bayat vb.) aynı turda tekrar alınmaz.
      const islenen = new Set();
      // BORU HATTI (06.10): tek ileri kopya yuvası. Mevcut kaydın `_hazir` kopyası bitince (hazirlandi)
      // sıradaki ilk aday arka planda kopyalanır; bir sonraki kayda geçmeden önce beklenir (kayıt kilidi
      // ön-kopyada; aynı anda iki kopya yok → bant genişliği bölünmez).
      const ileri = { is: null };
      const listeOku = async () => {
        const l = await H.hazirListesi(cfg);
        return d.yalniz ? l.filter((g) => String(g.manifest && g.manifest.bookId) === String(d.yalniz)) : l;
      };
      const onKopyaBaslat = () => {
        if (!cfg.bekciOnKopya || ileri.is) return;
        ileri.is = (async () => {
          const aday = (await listeOku()).find((g) => !islenen.has(g.dizin));
          if (!aday) return null;
          const r = await onKopyala(aday, d);
          log(`imza-bekçisi: ön-kopya ${path.basename(aday.dizin)} → ${r.durum}${r.sebep ? ` (${String(r.sebep).slice(0, 200)})` : ''}`);
          if (r.durum === 'hazir') ozet.onKopya = (ozet.onKopya || 0) + 1;
          return r;
        })().catch((e) => { log(`imza-bekçisi: ön-kopya hatası: ${e.message}`); return null; });
      };
      const ileriBekle = async () => { if (ileri.is) { const p = ileri.is; await p; ileri.is = null; } };
      try {
        for (;;) {
          await ileriBekle();
          const giris = liste.find((g) => !islenen.has(g.dizin));
          if (!giris) break;
          islenen.add(giris.dizin);
          const boru = { hazirlandi: onKopyaBaslat };
          const r = await kaydiIsle(giris, d, boru);
          if (boru.hazirlaAtlandi) ozet.hazirlaAtlanan = (ozet.hazirlaAtlanan || 0) + 1;
          log(`imza-bekçisi: ${path.basename(giris.dizin)} → ${r.durum}${r.sebep ? ` (${String(r.sebep).slice(0, 200)})` : ''}`);
          if (r.durum === 'yayinlandi') ozet.yayinlanan += 1;
          else if (r.durum === 'red') {
            ozet.reddedilen += 1;
            await bildirimGonder(d, { anahtar: `red:${giris.manifest.bookId}`, mesaj: `Windows paketi ${giris.manifest.bookId} imzalı kabulden KALDI — yayınlanmadı: ${String(r.sebep).slice(0, 160)}` }, await H.bildirimDurumuOku(cfg));
          } else if (r.durum === 'bayat') { ozet.bayat = (ozet.bayat || 0) + 1; }
          else if (r.durum === 'atlandi') { ozet.atlanan += 1; sebep = sebep || r.sebep; }
          else { sebep = `imza/yayın hatası: ${String(r.sebep).slice(0, 160)}`; break; }
          liste = await listeOku();
        }
      } finally {
        // Süren ön-kopya yarıda bırakılmaz (süreç çıkarsa `.kopyalaniyor` kalır; sonraki tur baştan alır).
        await ileriBekle();
      }
      liste = await H.hazirListesi(cfg);
      if (d.yalniz) liste = liste.filter((g) => String(g.manifest && g.manifest.bookId) === String(d.yalniz));
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
    yalniz: (argv.find((a) => a.startsWith('--yalniz=')) || '').slice('--yalniz='.length) || null,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)), imzaliYayinZinciri: W.imzaliYayinZinciri,
    postResultSuccess: runner.postResultSuccess, postResultFailure: runner.postResultFailure, presignUpload: runner.presignUpload,
    aktivasyonBeklenir: runner.aktivasyonBeklenir, auth: null, imzaHazirla: W.imzaHazirla,
  };
  if ((await H.hazirListesi(cfg)).length && !d.kuru) d.auth = await tokenOku(cfg);
  const ozet = await tur(d);
  log('imza-bekçisi: tur özeti', JSON.stringify(ozet));
  return ozet;
}

if (require.main === module) {
  ana().then(() => process.exit(0)).catch((e) => { console.error('imza-bekçisi HATA:', e && e.stack); process.exit(1); });
}

module.exports = { onKopyala, onKopyaHazirMi, uzakBoyut, imzaliArsivle, yayinMesaji, yayinBildir, bekciAyarlari, kabulKaldiMi, kiraBizdeDegilMi, diskBagla, kaydiIsle, tur, ana, IMPARK_PROBLARI };
