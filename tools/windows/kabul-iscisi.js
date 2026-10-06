#!/usr/bin/env node
'use strict';
/**
 * KABUL İŞÇİSİ — "kabul-bekliyor" Windows paketlerinin imzasız kabulü (05.10, kabul kuyruğu).
 *
 * Amaç: windows-kasa'da üretim (claim → kaynak → paketleme → statik kapı) ile imzasız kabul
 * (tools/windows/kabul/kabul.py, tek masaüstü, sıralı) üst üste binsin. Ölçüm (05.10 kasa log): exe başına
 * kaynak 5-11 dk + paketleme 6-14 dk + statik kapı 1-2 dk + imzasız kabul 8-19 dk. Runner
 * `EMPP_WIN_KABUL_KUYRUK=1` iken kabulü çağırmaz; paketi `windows-hazir/<id>-<sürüm>/` altına
 * `durum:'kabul-bekliyor'` ile koyar, sunucuda imza-bekliyor tutmasını yapar ve sıradaki işe geçer.
 * Bu işçi kayıtları EN ESKİDEN sırayla kabul eder. Bayraktan BAĞIMSIZ koşar: bayrak kapatılsa da
 * kalan kabul-bekliyor kayıtlarını boşaltır.
 *
 * Kalıp: tools/windows/imza-bekcisi.js. Fark: bekçi tek tur koşup çıkar; işçi sürekli döngüdür
 * (kuyruk boşsa 60 sn uyur). Zamanlanmış görev `empp-kabul-iscisi` (kasa-ajan/kabul-iscisi-gorev-kur.ps1).
 *
 * Döngü:
 *   0. Tekil koşu: `<hazır kök>/.kabul-iscisi.kilit` — ikinci işçi açılmaz.
 *   1. `kabulListesi` (kabul-bekliyor, en eski önce). Her kayıt için:
 *        a. kayıt kilidi (runner devralma / bekçi ile ortak `.kilit`) — doluysa atla;
 *        b. sunucu yoklaması `/result/presign` (yükleme yok) — 409 (kira bizde değil) → atla;
 *        c. bayat kontrolü (bekçiyle aynı: kaynak sürümü + kanonik damga) — bayatsa `bayat/` + failed;
 *       c2. okuyucu sürümü kapısı (06.10): exe'deki okuyucu kabuğu ÖLÇÜLÜR (damga kanıt değil) —
 *           kanonikle eşit değilse `bayat/` + failed (kabul.py koşmaz); ölçülemezse ÖLÇÜLEMEDİ yolu;
 *           `KABUL_OKUYUCU_SURUM=uyar` → yalnız log;
 *        d. `windows-serit.kabulKos` (etiket imzasiz; kasa kabul kilidi 120 dk beklenir):
 *             GEÇTİ       → manifest `durum:'imza-bekliyor'` + kabulKapi/kabulKanit; iş kanıtı güncellenir.
 *                           Kayıt artık imza bekçisinin listesindedir. Sunucu tutması değişmez.
 *             KALDI       → `/result failed` (runner'ın satır içi KALDI metniyle AYNI), sonra `reddedildi/`.
 *             ÖLÇÜLEMEDİ  → kabulDeneme++ ve 10/20 dk bekleme; 3. denemede `/release` (durumsuz: satır
 *                           kuyruğa döner), sonra kayıt `olculemedi/`'ye taşınır (silinmez). Kasa meşgul
 *                           (kabul kilidi boşalmadı) deneme SAYILMAZ.
 *        Kesin sonuçta ÖNCE sunucuya bildirilir, yalnız başarılıysa kayıt taşınır; bildirim düşerse kayıt
 *        `bekleyenSonuc` ile yerinde kalır, sonraki turda yalnız bildirim + taşıma yeniden denenir.
 *        Kilit alınınca manifest diskten yeniden okunur (liste ile kilit arasındaki değişiklik ezilmez).
 *   2. Bu turda kesin sonuç (GEÇTİ/KALDI/bırakıldı) yoksa 60 sn uyu.
 *   3. Ömür (varsayılan 6 sa) dolduysa ve kuyruk boşsa temiz çık — görev 5 dk'da yeni kodla açar.
 *
 * Kullanım: node tools/windows/kabul-iscisi.js [--tek-tur]
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const runner = require('../../src/agent/runner.js');
const W = require('../../src/agent/windows-serit');
const H = require('../../src/agent/windows-hazir');
const { kabulKaldiMi, kiraBizdeDegilMi } = require('./imza-bekcisi');
const OSK = require('../kabul/okuyucu-surumu-kapisi');
const MK = require('../kabul/menu-kapak');

const TEKIL_KILIT = '.kabul-iscisi.kilit';

function isciAyarlari(env = process.env) {
  const sayi = (v, vars) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : vars; };
  return {
    // Kasa kabul kilidi (runner yok; bekçinin imzalı kabulüyle yarışır) uzun beklenir.
    isciKasaKilitBeklemeMs: sayi(env.EMPP_KABUL_ISCI_KILIT_DK, 120) * 60 * 1000,
    isciUykuMs: sayi(env.EMPP_KABUL_ISCI_UYKU_SN, 60) * 1000,
    isciAzamiDeneme: Math.floor(sayi(env.EMPP_KABUL_ISCI_DENEME, 3)),
    isciOmurMs: sayi(env.EMPP_KABUL_ISCI_OMUR_SA, 6) * 3600 * 1000,
    // Sayılan ÖLÇÜLEMEDİ sonrası bekleme: deneme × aralık (10 dk → 1. sonrası 10, 2. sonrası 20 dk).
    isciDenemeAraligiMs: sayi(env.EMPP_KABUL_ISCI_ARALIK_DK, 10) * 60 * 1000,
    // En eski kabul-bekliyor kaydı bu süreyi aşınca bildirim (Ö4).
    isciYasEsikMs: sayi(env.EMPP_KABUL_ISCI_YAS_ESIK_DK, 120) * 60 * 1000,
  };
}

async function tokenOku(cfg) {
  const t = JSON.parse(await fsp.readFile(cfg.tokenFile, 'utf8'));
  if (!t || !t.agentId || !t.token) throw new Error('ajan jetonu yok/eksik');
  return { agentId: t.agentId, token: t.token };
}

/** Kasa meşgul sınıfı ÖLÇÜLEMEDİ (kabul kilidi boşalmadı/açılamadı): paket ölçülmedi bile, deneme SAYILMAZ. Saf. */
function kasaMesgulMu(hata) {
  return /kabul kilidi/.test(String((hata && hata.message) || hata || ''));
}

/** İş kanıtına kabul sonucunu işler (red yolu). Hata loglanır, akış sürer. */
async function kanitGuncelle(cfg, m, ek, log) {
  const yol = W.kanitYolu(cfg, m.bookId, m.surum);
  let kanit = null;
  try { kanit = JSON.parse(await fsp.readFile(yol, 'utf8')); } catch (_) { kanit = null; }
  if (!kanit) {
    kanit = {
      bookId: String(m.bookId), bookTitle: (m.job && m.job.bookTitle) || null, surum: m.surum,
      imzasiz: { md5: m.md5, sha256: m.sha256, boyut: m.boyut },
      kapi: m.kanit && m.kanit.kapi, kokIndex: m.kanit && m.kanit.kokIndex,
    };
  }
  try { await W.kanitYaz(cfg, { ...kanit, ...ek }); } catch (e) { log(`kabul-işçisi: UYARI iş kanıtı yazılamadı: ${e.message}`); }
}

/**
 * KESİN SONUÇ: ÖNCE sunucuya bildir, YALNIZ başarılıysa kaydı taşı (05.10 inceleme K1). Bildirim düşerse
 * (409/5xx/ağ) kayıt yerinde kalır, `bekleyenSonuc` yazılır; sonraki turda kabul yeniden koşmadan yalnız
 * bildirim + taşıma denenir. Aksi hâlde satır sunucuda running + lease NULL kalır ve kimse yeniden denemezdi.
 * sonuc: {tur:'red'|'bayat'|'birakildi', mesaj, alt, ek, hata?}
 */
async function sonucuBildirVeTasi(giris, job, sonuc, d) {
  const { cfg, log } = d;
  let ok;
  let ayrinti;
  if (sonuc.tur === 'birakildi') {
    ok = (await d.releaseJob(d.auth, job, sonuc.mesaj)) === true;
    ayrinti = '/release';
  } else {
    const r = await d.postResultFailure(d.auth, job, sonuc.mesaj);
    ok = Boolean(r && r.ok);
    ayrinti = `/result failed (HTTP ${r && r.status != null ? r.status : 'yok'})`;
  }
  const kayitSonuc = { tur: sonuc.tur, mesaj: sonuc.mesaj, alt: sonuc.alt, ek: sonuc.ek, zaman: sonuc.zaman || new Date().toISOString() };
  if (!ok) {
    const sebep = `sunucu bildirimi başarısız (${ayrinti}) — kayıt yerinde, sonraki turda yeniden: ${String(sonuc.mesaj).slice(0, 200)}`;
    await H.manifestGuncelle(giris.dizin, { bekleyenSonuc: kayitSonuc, sonHata: sebep, sonDeneme: new Date().toISOString(), kabulIsleniyor: null });
    return { durum: 'hata', sebep };
  }
  const s = await H.sonuclandir(cfg, giris, sonuc.alt, { ...sonuc.ek, bekleyenSonuc: null, kabulIsleniyor: null });
  if (sonuc.tur === 'red') {
    await kanitGuncelle(cfg, giris.manifest, { kabulImzasiz: 'KALDI', durum: 'red', hazirDizini: s.dizin }, log);
    if (d.bekciBildir) await d.bekciBildir({ bookId: job.bookId, bookTitle: job.bookTitle, hata: new Error(sonuc.mesaj) }, log);
  }
  return { durum: sonuc.tur, sebep: sonuc.mesaj, dizin: s.dizin, ...(sonuc.ek && sonuc.ek.kabulDeneme ? { deneme: sonuc.ek.kabulDeneme } : {}) };
}

/** Okuyucu kapısı ÖLÇÜLEMEDİ hata metni işareti (kabulKaldiMi / kasaMesgulMu ile EŞLEŞMEZ). */
const OKUYUCU_OLCULEMEDI_ISARETI = '[okuyucu-surumu]';

/**
 * Paketteki okuyucu kabuğu sürümünü ölçer (`d.okuyucuOlc`, varsayılan OSK.paketOlc; exe NSIS'ten açılır).
 * Açılan ağaç `work/okuyucu` altındadır ve kabul.py'den ÖNCE silinir (disk: exe ~1,5 GB × 2).
 * @returns {Promise<{red?:object, sonuc:object}>} red: sonucuBildirVeTasi'ye gidecek bayat sonucu.
 *   ÖLÇÜLEMEDİ → throw (OKUYUCU_OLCULEMEDI_ISARETI): çağıranın ÖLÇÜLEMEDİ yolu deneme sayar.
 */
async function okuyucuKapisi(giris, gecerliKanonik, work, d) {
  const { log } = d;
  const olc = d.okuyucuOlc || OSK.paketOlc;
  const calisma = path.join(work, 'okuyucu');
  const ad = path.basename(giris.dizin);
  let sonuc;
  try {
    sonuc = await olc({
      paket: giris.exeYolu, platform: 'windows', calisma,
      kanonik: (gecerliKanonik && gecerliKanonik.kabukSurum) || undefined, env: d.env || process.env,
    });
  } catch (e) {
    const kp = OSK.kip(d.env || process.env);
    sonuc = {
      karar: kp === 'uyar' ? OSK.KARAR.GECTI : OSK.KARAR.OLCULEMEDI, hamKarar: OSK.KARAR.OLCULEMEDI,
      olculen: null, kanonik: (gecerliKanonik && gecerliKanonik.kabukSurum) || null, kip: kp, birimler: [],
      sebepler: [`paket açılamadı: ${e.message}`],
    };
    if (kp === 'uyar') sonuc.uyari = `KABUL_OKUYUCU_SURUM=uyar: paket açılamadı (${e.message}) — yalnız uyarı`;
  } finally {
    await fsp.rm(calisma, { recursive: true, force: true }).catch(() => {});
  }
  log(`kabul-işçisi: ${ad} ${OSK.ozetSatiri(sonuc)}`);
  const iz = {
    karar: sonuc.karar, hamKarar: sonuc.hamKarar, olculen: sonuc.olculen || null, kanonik: sonuc.kanonik || null,
    sebepler: (sonuc.sebepler || []).slice(0, 5), zaman: new Date().toISOString(),
  };
  if (OSK.gecerMi(sonuc)) {
    await H.manifestGuncelle(giris.dizin, { okuyucuSurumu: iz });
    return { sonuc };
  }
  if (sonuc.hamKarar === OSK.KARAR.RED) {
    const ayrinti = `okuyucu ${sonuc.olculen || '?'} ≠ kanonik ${sonuc.kanonik || '?'}`;
    return {
      sonuc,
      red: {
        tur: 'bayat', alt: 'bayat',
        mesaj: `[imza-bekliyor] ${H.KABUL_KUYRUGU_ISARETI} hazır kayıt bayat (${ayrinti}: `
          + `${(sonuc.sebepler || []).slice(0, 3).join('; ')})`.slice(0, 1500),
        ek: {
          durum: 'bayat', sebep: `okuyucu-surumu: ${ayrinti}`, zamanBayat: new Date().toISOString(), okuyucuSurumu: iz,
        },
      },
    };
  }
  throw new Error(`${OKUYUCU_OLCULEMEDI_ISARETI} okuyucu sürümü ÖLÇÜLEMEDİ: ${(sonuc.sebepler || []).join('; ').slice(0, 600)}`);
}

/**
 * MENÜ KAPAK KAPISI (06.10, 59835 Teacher's Pack/Worksheets): menüdeki her kartın kapağı pakette var mı
 * (`tools/kabul/menu-kapak.js`, tanım tek kaynak). Kip `KABUL_MENU_KAPAK`: uyar (varsayılan; yalnız log) |
 * reddet (RED → bayat; ÖLÇÜLEMEDİ yine yalnız uyarı) | kapali. Ölçüm hatası kabulü ASLA düşürmez.
 * @returns {Promise<{red?:object, kip:string, sonuc?:object}>}
 */
async function menuKapakKapisi(giris, work, d) {
  const { log } = d;
  const kp = MK.kip(d.env || process.env);
  if (kp === 'kapali') return { kip: kp };
  const olc = d.menuKapakOlc || MK.paketMenuKapakOlc;
  const calisma = path.join(work, 'menu-kapak');
  let sonuc;
  try {
    sonuc = await olc({ paket: giris.exeYolu, platform: 'windows', calisma });
  } catch (e) {
    sonuc = { durum: MK.DURUM.OLCULEMEDI, kartlar: [], sebepler: [`paket açılamadı: ${e.message}`], uyarilar: [] };
  } finally {
    await fsp.rm(calisma, { recursive: true, force: true }).catch(() => {});
  }
  const k = MK.kapiKarari(sonuc, kp);
  log(`kabul-işçisi: ${path.basename(giris.dizin)} ${k.log}`);
  if (!k.dusur) return { kip: kp, sonuc };
  const iz = { karar: sonuc.durum, sebepler: sonuc.sebepler.slice(0, 5), zaman: new Date().toISOString() };
  return {
    kip: kp,
    sonuc,
    red: {
      tur: 'bayat', alt: 'bayat',
      mesaj: `[imza-bekliyor] ${H.KABUL_KUYRUGU_ISARETI} hazır kayıt bayat (menü kapak eksik: `
        + `${sonuc.sebepler.slice(0, 3).join('; ')})`.slice(0, 1500),
      ek: {
        durum: 'bayat', sebep: `menu-kapak: ${k.sebep}`, zamanBayat: new Date().toISOString(), menuKapak: iz,
      },
    },
  };
}

/**
 * Tek kaydı kabul et. @returns {Promise<{durum:'gecti'|'red'|'olculemedi'|'birakildi'|'bayat'|'atlandi'|'hata',
 *   sebep?:string, dizin?:string, deneme?:number}>}
 */
async function kaydiIsle(listedeki, d) {
  const { cfg, log } = d;
  const kilit = await H.kayitKilidiDene(listedeki.dizin);
  if (!kilit) return { durum: 'atlandi', sebep: 'kayıt kilidi dolu (runner/bekçi bu kayıtta)' };
  let work = null;
  try {
    // K2: liste ile kilit arasında kayıt değişmiş olabilir (bayata taşınıp yeniden üretildi, bekçiye geçti):
    // kilit altında manifest diskten YENİDEN okunur; eski liste kopyası hiçbir yere yazılmaz.
    const m = await H.manifestOku(listedeki.dizin);
    if (!m || m.durum !== H.KABUL_BEKLIYOR || !m.exe) return { durum: 'atlandi', sebep: `kayıt artık kabul-bekliyor değil (${(m && m.durum) || 'manifest yok'})` };
    const giris = { dizin: listedeki.dizin, manifest: m, exeYolu: path.join(listedeki.dizin, m.exe) };
    const job = { ...(m.job || {}), bookId: m.bookId, platform: 'windows' };
    if (!job.kanonikSurum && m.kanonik && typeof m.kanonik === 'object') job.kanonikSurum = m.kanonik;
    // Önceki turda sunucu bildirimi düşmüş kesin sonuç: kabul yeniden KOŞMAZ, yalnız bildir + taşı.
    if (m.bekleyenSonuc && typeof m.bekleyenSonuc === 'object') return await sonucuBildirVeTasi(giris, job, m.bekleyenSonuc, d);
    const sonraki = Date.parse(m.sonrakiDeneme);
    if (Number.isFinite(sonraki) && d.simdi() < sonraki) return { durum: 'atlandi', sebep: `yeniden deneme beklemesi (${m.sonrakiDeneme})` };
    let yoklama;
    try {
      yoklama = await d.presignUpload(d.auth, job);
    } catch (e) {
      if (kiraBizdeDegilMi(e)) return { durum: 'atlandi', sebep: 'kira sunucuda bu ajanda değil — runner bir sonraki kiralamada devralır' };
      return { durum: 'hata', sebep: `sunucu yoklaması: ${e.message}` };
    }
    // BAYAT KONTROLÜ — imza-bekcisi.js ile AYNI ölçüt (kabul de bayat pakete harcanmasın).
    const gecerli = d.gecerliKaynakSurumu ? await d.gecerliKaynakSurumu(job, yoklama)
      : (yoklama && (yoklama.gecerliKaynakSurumu || yoklama.kaynakSurumu)) || null;
    const gecerliKanonik = await H.gecerliKanonikOku(cfg);
    const karar = H.bayatKarari(m, { gecerliKaynakSurumu: gecerli, gecerliKanonik });
    if (karar.bilinmiyor) log(`kabul-işçisi: ${path.basename(giris.dizin)} bayat kıyası yapılamadı: ${karar.bilinmiyor}`);
    if (karar.bayat) {
      const ayrinti = karar.kayitli ? `kayıt ${karar.kayitli}, geçerli ${karar.gecerli}` : karar.sebep;
      return await sonucuBildirVeTasi(giris, job, {
        tur: 'bayat', alt: 'bayat',
        mesaj: `[imza-bekliyor] ${H.KABUL_KUYRUGU_ISARETI} hazır kayıt bayat (${ayrinti})`.slice(0, 1500),
        ek: { durum: 'bayat', sebep: karar.sebep, zamanBayat: new Date().toISOString() },
      }, d);
    }
    await H.manifestGuncelle(giris.dizin, { kabulIsleniyor: { pid: process.pid, zaman: new Date().toISOString() } });
    work = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabul-iscisi-'));
    let k;
    let okuyucuRed = null;
    try {
      // OKUYUCU SÜRÜMÜ KAPISI (06.10, A1 olayı): manifest damgası kanıt DEĞİL — paketteki okuyucu kabuğu
      // ÖLÇÜLÜR (tools/kabul/okuyucu-surumu-kapisi.js, tanım tek kaynak). RED (eski/yeni okuyucu) → bayat;
      // ÖLÇÜLEMEDİ → aşağıdaki ÖLÇÜLEMEDİ yolu (deneme sayılır, paket suçlanmaz).
      // `KABUL_OKUYUCU_SURUM=uyar` → kapı yalnız loglar, kabul sürer (geri alma).
      okuyucuRed = (await okuyucuKapisi(giris, gecerliKanonik, work, d)).red || null;
      // MENÜ KAPAK KAPISI: okuyucu geçtikten sonra; varsayılan UYAR (yalnız log), RED → bayat yalnız `reddet` kipinde.
      if (!okuyucuRed) okuyucuRed = (await menuKapakKapisi(giris, work, d)).red || null;
      if (!okuyucuRed) {
        k = await d.kabulKos({
          exe: giris.exeYolu, job, work, cfg: { ...cfg, winKasaKilitBeklemeMs: cfg.isciKasaKilitBeklemeMs },
          log, aktivasyon: d.aktivasyonBeklenir(job.bookTitle), etiket: 'imzasiz', sleep: d.sleep,
        });
      }
    } catch (e) {
      const zaman = new Date().toISOString();
      if (kabulKaldiMi(e)) {
        // Paket kusuru: runner'ın satır içi akışındaki KALDI ile aynı sonuç (failed, aynı metin).
        return await sonucuBildirVeTasi(giris, job, {
          tur: 'red', alt: 'reddedildi', mesaj: e.message, ek: { durum: 'red', sebep: e.message, zamanRed: zaman },
        }, d);
      }
      // Ö5: kasa meşgul (kabul kilidi boşalmadı) → paket ölçülmedi bile; deneme SAYILMAZ.
      if (kasaMesgulMu(e)) {
        await H.manifestGuncelle(giris.dizin, { sonHata: e.message, sonDeneme: zaman, kabulIsleniyor: null });
        return { durum: 'olculemedi', sebep: `kasa meşgul (deneme sayılmadı): ${e.message}` };
      }
      // ÖLÇÜLEMEDİ (ya da beklenmeyen hata): paket kusuru DEĞİL. Azami denemede iş kuyruğa döner.
      const deneme = (Number(m.kabulDeneme) || 0) + 1;
      if (deneme >= cfg.isciAzamiDeneme) {
        return await sonucuBildirVeTasi(giris, job, {
          tur: 'birakildi', alt: 'olculemedi',
          mesaj: `${H.KABUL_KUYRUGU_ISARETI} imzasız kabul ${deneme} denemede ölçülemedi: ${e.message}`,
          ek: { durum: 'olculemedi', kabulDeneme: deneme, sonHata: e.message, sonDeneme: zaman },
        }, d);
      }
      // Denemeler arası artan bekleme: 1. ölçülemedi → 10 dk, 2. → 20 dk.
      const sonrakiDeneme = new Date(d.simdi() + deneme * cfg.isciDenemeAraligiMs).toISOString();
      await H.manifestGuncelle(giris.dizin, { kabulDeneme: deneme, sonHata: e.message, sonDeneme: zaman, sonrakiDeneme, kabulIsleniyor: null });
      return { durum: 'olculemedi', sebep: e.message, deneme };
    }
    // Okuyucu RED: kabul.py hiç koşmadı; kayıt bayat/'a, sunucuya failed (bayat kontrolüyle aynı yol).
    if (okuyucuRed) return await sonucuBildirVeTasi(giris, job, okuyucuRed, d);
    // GEÇTİ: kayıt yerinde kalır, imza bekçisinin listesine geçer (aynı kayıt, durum değişir).
    await H.kabulGectiIsle(cfg, giris, k, log);
    return { durum: 'gecti', dizin: giris.dizin };
  } catch (e) {
    try { await H.manifestGuncelle(listedeki.dizin, { sonHata: e.message, sonDeneme: new Date().toISOString(), kabulIsleniyor: null }); } catch (_) { /* kayıt taşınmış olabilir */ }
    return { durum: 'hata', sebep: e.message };
  } finally {
    await kilit();
    if (work) await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Ö4: en eski kabul-bekliyor kaydı eşiği (2 sa) aştıysa bildirim — imza bekçisinin kalıbı: `bildir` varsa
 * push, yoksa (windows-kasa) uyarı logu. Aynı sebep en çok `winHazirBildirimAralikMs`'de bir.
 */
async function yasAlarmi(d) {
  const { cfg, log } = d;
  const liste = await H.kabulListesi(cfg);
  if (!liste.length) return null;
  const yasMs = d.simdi() - liste[0].zamanMs;
  if (!(yasMs > cfg.isciYasEsikMs)) return null;
  const anahtar = 'kabul:yas';
  const durum = await H.bildirimDurumuOku(cfg);
  if (durum[anahtar] && d.simdi() - durum[anahtar] < cfg.winHazirBildirimAralikMs) return null;
  const mesaj = `${liste.length} Windows paketi kabul bekliyor: en eski ${Math.round(yasMs / 60000)} dk (${path.basename(liste[0].dizin)})`;
  if (cfg.bekciBildirIkili && fs.existsSync(cfg.bekciBildirIkili)) {
    const r = await (d.komutKos || W.komutKos)([cfg.bekciBildirIkili, 'paket', mesaj, '-p', 'yuksek'], { zamanAsimiMs: 20000 });
    log(`kabul-işçisi: bildirim ${r.kod === 0 ? 'gönderildi' : `GÖNDERİLEMEDİ (çıkış ${r.kod})`}: ${mesaj}`);
  } else {
    log(`kabul-işçisi: UYARI ${mesaj} (bildir yok: ${cfg.bekciBildirIkili || '-'})`);
  }
  await H.bildirimDurumuYaz(cfg, { ...durum, [anahtar]: d.simdi() });
  return mesaj;
}

/**
 * Kuyruğun bir geçişi (en eski önce). Tekil kilit çağırandadır. @returns {Promise<object>} özet
 */
async function tur(d) {
  const { cfg, log } = d;
  const ozet = { bekleyen: 0, gecti: 0, red: 0, olculemedi: 0, birakildi: 0, bayat: 0, atlandi: 0, hata: 0 };
  const liste = await H.kabulListesi(cfg);
  ozet.bekleyen = liste.length;
  for (const giris of liste) {
    const r = await kaydiIsle(giris, d);
    log(`kabul-işçisi: ${path.basename(giris.dizin)} → ${r.durum}${r.deneme ? ` (deneme ${r.deneme})` : ''}`
      + `${r.sebep ? ` (${String(r.sebep).slice(0, 200)})` : ''}`);
    ozet[r.durum] = (ozet[r.durum] || 0) + 1;
  }
  ozet.ilerleme = ozet.gecti + ozet.red + ozet.birakildi + ozet.bayat;
  try { ozet.yasAlarmi = await yasAlarmi(d); } catch (e) { log(`kabul-işçisi: yaş alarmı ölçülemedi: ${e.message}`); }
  return ozet;
}

/**
 * Sürekli döngü. `d.dur()` true dönünce (test / ömür) çıkar. @returns {Promise<object>} son durum
 */
async function dongu(d) {
  const { cfg, log } = d;
  await fsp.mkdir(cfg.winHazirKoku, { recursive: true });
  const tekil = await W.kilitDene(path.join(cfg.winHazirKoku, TEKIL_KILIT));
  if (!tekil.tutucu) {
    log(tekil.kod === 75 ? 'kabul-işçisi: başka işçi koşuyor — çıkılıyor' : `kabul-işçisi: tekil kilit açılamadı (çıkış ${tekil.kod})`);
    return { atlandi: 'tekil-kilit' };
  }
  const bas = d.simdi();
  let turSayisi = 0;
  try {
    for (;;) {
      if (d.dur && d.dur(turSayisi)) return { turSayisi, cikis: 'dur' };
      const ozet = await tur(d);
      turSayisi += 1;
      if (ozet.bekleyen === 0 && d.simdi() - bas > cfg.isciOmurMs) {
        log(`kabul-işçisi: ömür doldu (${Math.round(cfg.isciOmurMs / 3600000)} sa), kuyruk boş — temiz çıkış (görev yeniden açar)`);
        return { turSayisi, cikis: 'omur' };
      }
      if (!ozet.ilerleme) await d.sleep(cfg.isciUykuMs);
    }
  } finally {
    await W.kilitBirak(tekil.tutucu);
  }
}

async function ana(argv = process.argv.slice(2)) {
  const cfg = { ...runner.CONFIG, ...isciAyarlari() };
  const log = (...a) => console.log(new Date().toISOString(), ...a);
  const tekTur = argv.includes('--tek-tur');
  const d = {
    cfg, log, simdi: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    kabulKos: W.kabulKos, presignUpload: runner.presignUpload, postResultFailure: runner.postResultFailureYanit,
    releaseJob: runner.releaseJob, aktivasyonBeklenir: runner.aktivasyonBeklenir, bekciBildir: W.bekciBildir,
    auth: await tokenOku(cfg), dur: tekTur ? (n) => n >= 1 : null,
  };
  log(`kabul-işçisi: başladı (kuyruk ${cfg.winHazirKoku}, bayrak EMPP_WIN_KABUL_KUYRUK=${cfg.winKabulKuyrugu ? 1 : 0} — işçi bayraktan bağımsız boşaltır)`);
  const s = await dongu(d);
  log('kabul-işçisi: çıkış', JSON.stringify(s));
  return s;
}

if (require.main === module) {
  ana().then(() => process.exit(0)).catch((e) => { console.error('kabul-işçisi HATA:', e && e.stack); process.exit(1); });
}

module.exports = {
  menuKapakKapisi,
  isciAyarlari, kasaMesgulMu, kaydiIsle, sonucuBildirVeTasi, okuyucuKapisi, yasAlarmi, tur, dongu, ana, TEKIL_KILIT,
  OKUYUCU_OLCULEMEDI_ISARETI,
};
