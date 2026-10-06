#!/usr/bin/env node
'use strict';
/**
 * İMZALI ARŞİV GERİ DOLDURMA (Nadir 06.10) — imza bekçisinin yeni "imzalı son sürüm arşivi" adımından
 * ÖNCE yayınlanmış kitaplar için tek seferlik doldurma. Kural bekçiyle AYNI (src/agent/imzali-arsiv.js):
 * `<arşiv kökü>\<Set adı>.exe` + `<bookId>\\son.json`; sha doğrulanınca eski *.exe silinir.
 *
 * Kaynak: `<hazır kök>\yayinlandi\*\manifest.json` (durum yayinlandi, imzali.sha256 dolu). Her kitap
 * için YALNIZ en son yayın alınır. İmzalı kopya şu sırayla aranır ve sha256'sı manifest'teki
 * `imzali.sha256` ile birebir eşleşmelidir (eşleşmeyen dosya — ör. yayinlandi\ altındaki İMZASIZ exe —
 * asla arşive girmez):
 *   1. kayıt dizinindeki exe   2. `<imza yuvası>\_imzali\<exe>`   3. `--kaynak=<dizin>` (tekrarlanabilir)
 * Kaynak dosyalar KOPYALANIR (taşınmaz, silinmez). Arşivde aynı/yeni yayın varsa dokunulmaz.
 *
 * Kullanım: node tools/windows/imzali-arsiv-doldur.js [--kuru] [--kok=<arşiv kökü>]
 *             [--kaynak=<dizin>]... [--yalniz=<bookId>]
 *   --kuru: yalnız ölç + raporla (yazma/silme yok). Kök verilmezse EMPP_IMZALI_ARSIV_KOKU /
 *   win32 varsayılanı D:\empp-imzali-son; win32 dışında kök zorunlu.
 */

const fsp = require('fs/promises');
const path = require('path');

const A = require('../../src/agent/imzali-arsiv');
const H = require('../../src/agent/windows-hazir');
const W = require('../../src/agent/windows-serit');

function argumanlar(argv) {
  const al = (ad) => argv.filter((a) => a.startsWith(`--${ad}=`)).map((a) => a.slice(ad.length + 3)).filter(Boolean);
  const bilinen = /^--(kuru$|kok=|kaynak=|yalniz=)/;
  const bilinmeyen = argv.filter((a) => !bilinen.test(a));
  return {
    kuru: argv.includes('--kuru'), kok: al('kok')[0] || null, kaynaklar: al('kaynak'),
    yalniz: al('yalniz')[0] || null, bilinmeyen,
  };
}

/** yayinlandi\ kayıtları → kitap başına en son yayın. */
async function enSonYayinlar(cfg) {
  const kok = path.join(cfg.winHazirKoku, 'yayinlandi');
  let girdiler = [];
  try { girdiler = await fsp.readdir(kok, { withFileTypes: true }); } catch (_) { return { liste: [], atlanan: [] }; }
  const enSon = new Map();
  const atlanan = [];
  for (const g of girdiler) {
    if (!g.isDirectory()) continue;
    const dizin = path.join(kok, g.name);
    const m = await H.manifestOku(dizin);
    if (!m || m.durum !== 'yayinlandi') { atlanan.push({ dizin, sebep: 'manifest yok / durum yayinlandi değil' }); continue; }
    const zaman = Date.parse((m.yayin && m.yayin.zaman) || m.zaman) || 0;
    const id = String(m.bookId);
    const onceki = enSon.get(id);
    if (!onceki || zaman > onceki.zaman) {
      if (onceki) atlanan.push({ dizin: onceki.dizin, bookId: id, sebep: 'daha yeni yayın var' });
      enSon.set(id, { dizin, manifest: m, zaman });
    } else {
      atlanan.push({ dizin, bookId: id, sebep: 'daha yeni yayın var' });
    }
  }
  return { liste: [...enSon.values()].sort((a, b) => a.zaman - b.zaman), atlanan };
}

/** sha256'sı manifest `imzali.sha256` ile eşleşen ilk aday. @returns {Promise<string|null>} */
async function imzaliKaynakBul(giris, cfg, kaynaklar) {
  const m = giris.manifest;
  const iz = m.imzali || {};
  if (!iz.sha256 || !A.exeAdiGecerli(m.exe)) return null;
  const adaylar = [path.join(giris.dizin, m.exe)];
  if (cfg.winImzaYuvaKoku) adaylar.push(path.join(cfg.winImzaYuvaKoku, '_imzali', m.exe));
  for (const k of kaynaklar) {
    adaylar.push(path.join(k, m.exe), path.join(k, `${path.basename(m.exe, path.extname(m.exe))}-imzali.exe`));
  }
  for (const a of adaylar) {
    let st;
    try { st = await fsp.stat(a); } catch (_) { continue; }
    if (!st.isFile() || (iz.boyut != null && st.size !== iz.boyut)) continue;
    try {
      if ((await A.sha256Hesapla(a)).sha256 === String(iz.sha256).toLowerCase()) return a;
    } catch (_) { /* okunamadı → sıradaki aday */ }
  }
  return null;
}

/**
 * @returns {Promise<{satirlar:object[], eskiKayit:number, ozet:object}>}
 */
async function doldur({ cfg, kok, kaynaklar = [], kuru = false, yalniz = null, log = () => {}, bildir }) {
  const { liste, atlanan } = await enSonYayinlar(cfg);
  const satirlar = [];
  for (const g of liste) {
    const m = g.manifest;
    if (yalniz && String(m.bookId) !== String(yalniz)) continue;
    const satir = { bookId: String(m.bookId), surum: m.surum || null, exe: m.exe || null };
    if (!m.imzali || !m.imzali.sha256) {
      satirlar.push({ ...satir, durum: 'atlandi', sebep: 'manifest\'te imzali.sha256 yok' });
      continue;
    }
    const kaynak = await imzaliKaynakBul(g, cfg, kaynaklar);
    if (!kaynak) {
      satirlar.push({ ...satir, durum: 'atlandi', sebep: 'imzalı kopya bulunamadı (sha eşleşen dosya yok; yayinlandi\\ exe imzasız)' });
      continue;
    }
    const r = await A.arsivle({
      kaynak, bookId: m.bookId, exeAdi: m.exe, beklenenSha256: m.imzali.sha256, kok, kuru, eskiyseAtla: true, log,
      bildir: bildir || (async () => {}),
      meta: {
        baslik: (m.job && m.job.bookTitle) || null, surum: m.surum || null, imzaZamani: m.imzali.zamanDamgasi || null,
        yayinZamani: (m.yayin && m.yayin.zaman) || m.zaman || null, r2Anahtari: (m.yayin && m.yayin.r2ObjectKey) || null,
      },
    });
    satirlar.push({ ...satir, durum: r.durum, sebep: r.sebep || null, kaynak, hedef: r.hedef || null, silinen: r.silinen || [] });
  }
  const say = (d) => satirlar.filter((s) => s.durum === d).length;
  return {
    satirlar, eskiKayit: atlanan.length,
    ozet: { kitap: satirlar.length, arsivlendi: say('arsivlendi'), kuru: say('kuru'), atlandi: say('atlandi'), hata: say('hata') },
  };
}

async function ana(argv = process.argv.slice(2)) {
  const a = argumanlar(argv);
  if (a.bilinmeyen.length) { console.error(`bilinmeyen argüman: ${a.bilinmeyen.join(' ')}`); return 2; }
  const kok = a.kok || A.arsivKoku();
  if (!kok) { console.error('arşiv kökü yok: --kok=<dizin> ya da EMPP_IMZALI_ARSIV_KOKU ver (win32 dışında varsayılan yok)'); return 2; }
  const cfg = { ...W.varsayilanAyarlar(), ...H.hazirAyarlari() };
  const log = (...x) => console.log(new Date().toISOString(), ...x);
  log(`imzalı-arşiv doldurma: hazır kök ${cfg.winHazirKoku}, arşiv kökü ${kok}${a.kuru ? ' (KURU)' : ''}`);
  const r = await doldur({ cfg, kok, kaynaklar: a.kaynaklar, kuru: a.kuru, yalniz: a.yalniz, log });
  for (const s of r.satirlar) {
    const silinen = s.silinen && s.silinen.length ? `\tsilinen: ${s.silinen.join(', ')}` : '';
    log(`  ${s.bookId}\t${s.surum || '-'}\t${s.durum}\t${s.sebep || s.hedef || ''}${silinen}`);
  }
  log('imzalı-arşiv doldurma özeti', JSON.stringify({ ...r.ozet, eskiKayit: r.eskiKayit }));
  return r.ozet.hata ? 1 : 0;
}

if (require.main === module) {
  ana().then((k) => process.exit(k)).catch((e) => { console.error('imzalı-arşiv doldurma HATA:', e && e.stack); process.exit(1); });
}

module.exports = { argumanlar, enSonYayinlar, imzaliKaynakBul, doldur, ana };
