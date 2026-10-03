'use strict';

/**
 * İÇERİK MERDİVENİ S0 + S1 — üretim anında kitap içeriğini İmpark'ın en son sürümüne tazeler
 * (2026-09-26, kitap-kaynak-sozlesmesi.md "Kaynak merdiveni").
 *
 * NEDEN (ölçüldü 26.09):
 *   - 45482 SW8 arşiv build zip'inde book1 = İmpark 44187 v33; İmpark Vs=36
 *     (`ZKitapZipH/44187-36.zip`). Runner arşiv yolunda yayıncı güncellemesini bilinçli atlıyor
 *     → paket 3 sürüm geride çıkıyordu.
 *   - İmpark exe yolu da aynı: 45549 `ShallWe7-v50.exe` 26.09 11:00'de SIFIRDAN indirildi (önbellek
 *     MISS), üç gerçek kitabın üçü de geride (25775 v23<25, 25777 v5<6, 25830 v4<5). İmpark exe'si
 *     ZipVersiyon artınca yeniden üretilmiyor; `publisher-update.js` ise yalnız OKUYUCU
 *     güncellemesini (kurum 060 `Update/<sürüm>.zip`) uygular, `ZKitapZipH` içeriğine hiç dokunmaz.
 *   Nadir'in kabul spec'i: "açılan kitapta güncelleme var mı, varsa paket yeniden üretilmeli";
 *   ortak özellik: "kitap içerikleri İmpark'tan gelen güncellemeler ile güncellenecek".
 *
 * NE YAPAR (iş kopyası üstünde; arşiv/önbellek zip'ine DOKUNULMAZ):
 *   S0  Her kitap menüsünden (`bookN/classlibraries/ImWin32.dll`, tek kitapta kök) kapak kimliği ve
 *       sürümü okunur (`runtime/icerik-guncelleme.js` `menuCoz` + `kapaklar` — TEK KAYNAK),
 *       kitabın `app.config.js` `updateBookEndPoint` ucuna motorun sorduğu soru AYNEN sorulur
 *       (`GetKitapGuncellemeBilgi?id=<ID>&setMi=0&versiyon=<v>`, salt okuma). Tablo agent.log'a ve
 *       iş kanıtına (`EMPP_MERDIVEN_KANIT`, varsayılan `~/.empp-agent/merdiven-kanit/`) yazılır.
 *       Kimlik 0 / sayısal değil (45482 book4 video derlemesi) → ATLANDI + not.
 *   S1  Geride olan her kitap için `Data` (ZKitapZipH/<ID>-<Vs>.zip) indirilir (içerik önbelleği,
 *       anahtar = <ID>-<Vs>), önce KİMLİK doğrulanır (kaynaktaki `assets/<ID>/thumbs` kapak + iç
 *       sayfa md5'leri ↔ İmpark zip'i; memory set-klasor-kimligi-thumbs-md5-ile), sonra
 *       `bookN/assets/<ID>/` üstüne AÇILIR — motorun kendi `extractAllTo(assets/<id>, true)`
 *       anlamı: üzerine yazar, silmez. Açma doğrulanınca (BookContent md5 + her girdi diskte)
 *       menü sürümü ve URL'si ilerletilir (çalışma anındaki `menuSuz` süzgecinin kalıbı: içerik
 *       doğrulanmadan sürüm ilerlemez). Ya hep ya hiç: tek kitap düşerse zip'e hiç yazılmaz.
 *
 * KÖK KORUMA: yazılabilen YALNIZ `<kitap>/assets/<ID>/**` ve `<kitap>/classlibraries/ImWin32.dll`
 * (setlerde <kitap> = bookN; tek kitapta kök). Kök `index.html`, set kabuğu, `43e23…js` ana motor,
 * `bookN/index.html` ve geri kalan her şey DOKUNULMAZ. İki kapı: sahneye konan her dosya zip'e
 * girmeden önce, zip'in merkez dizini (CRC + boyut) güncellemeden SONRA izin listesiyle kıyaslanır.
 * İhlal = iş düşer (`publisher-update.js`'in 73768/59834'te kök index'i ezmesi sınıfı).
 *
 * ANAHTAR: `EMPP_ARSIV_MERDIVEN=1` (varsayılan KAPALI; canlıya alma Şef'te). Açıkken hem arşiv
 * hem İmpark exe yolu (önbellek HIT/MISS) aynı fonksiyondan geçer.
 *
 * ÖLÇÜLEMEDİ = İŞ DÜŞER (görünür hata; bilerek böyle):
 *   İmpark ucu 404/5xx, zaman aşımı, JSON olmayan/tutarsız cevap, menü çözülemedi, uç yok → iş
 *   `İÇERİK MERDİVENİ ÖLÇÜLEMEDİ` hatasıyla düşer; eski içerikle DEVAM EDİLMEZ.
 *   Gerekçe:
 *   1. Ölçemediysek "güncel" diyemeyiz (sahte yeşil yasak — motor-surumu "bilinmiyor" ilkesi).
 *      Devam etmek = 45482'deki 3 sürüm geri paketi yeniden yayınlamak.
 *   2. Ertelemek (failed yazmadan kira dönüşü) panelde görünmez; 404 gibi kalıcı hatada iş sonsuza
 *      dek sessizce döner. Bu yüzden hata metni `isTransientNetworkError`/`ertelenebilirKaynakHatasi`
 *      desenlerine BİLEREK uymaz (alt hata kısa Türkçe koda çevrilir: "zaman aşımı", "HTTP 404";
 *      "fetch failed", "curl exit N", "ETIMEDOUT" metne girmez) → `failed` + `bildir … -p yuksek`.
 *   3. İmpark web katmanı DB'nin 7 dk'ya kadar gerisinde kalabiliyor (e2e 24.09): yeniden kuyruk
 *      elle ya da bekçiyle, ≥10 dk sonra (kabul kanıtı §B.3).
 *
 * YAPILMAYANLAR: İmpark paneline/SQL'e/SMB'ye yazmak (yalnız GET) · S2 (delta tamamlama; üzerine
 * yazma silmediği için alt ağaç azalmaz) · menü çözülemeyen kitabı tahminle sürümlemek.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ig = require('../runtime/icerik-guncelleme');

const ISARET = 'İÇERİK MERDİVENİ';
const DURUM = Object.freeze({
  GUNCEL: 'GUNCEL', GERIDE: 'GERIDE', ATLANDI: 'ATLANDI', OLCULEMEDI: 'OLCULEMEDI',
});
const MENU = ig.MENU_GORELI; // 'classlibraries/ImWin32.dll'
const VARSAYILAN_ZAMAN_ASIMI_MS = 15000;
const OKUMA_TAVANI = 64 * 1024 * 1024; // tek girdi belleğe okunurken üst sınır
const SIKISIK_UZANTILAR = '.png:.jpg:.jpeg:.webp:.mp3:.mp4:.m4a:.zip';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function merdivenAcik(env = process.env) {
  return String(env.EMPP_ARSIV_MERDIVEN || '') === '1';
}

// ─── ZIP okuma (merkez dizin; CLI'ye bağımlı değil, ad eşlemesi birebir) ────────────────────

const crcTablosu = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTablosu[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function okuFd(fd, uzunluk, konum) {
  const b = Buffer.alloc(uzunluk);
  let okunan = 0;
  while (okunan < uzunluk) {
    const n = fs.readSync(fd, b, okunan, uzunluk - okunan, konum + okunan);
    if (!n) break;
    okunan += n;
  }
  if (okunan !== uzunluk) throw new Error(`zip kısa okundu (${okunan}/${uzunluk})`);
  return b;
}

/**
 * Zip'in merkez dizini: Map<ad, {ad, crc, boyut, sikisik, yontem, bayrak, yerelOfs, dizin}>.
 * Zip64 desteklenir. Adlar UTF-8 çözülür.
 */
function zipDizini(zipYolu) {
  const fd = fs.openSync(zipYolu, 'r');
  try {
    const boyut = fs.fstatSync(fd).size;
    const kuyrukBoy = Math.min(boyut, 22 + 65535 + 20);
    const kuyruk = okuFd(fd, kuyrukBoy, boyut - kuyrukBoy);
    let e = -1;
    for (let i = kuyrukBoy - 22; i >= 0; i--) {
      if (kuyruk.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    }
    if (e < 0) throw new Error(`zip değil (merkez dizin sonu yok): ${zipYolu}`);
    let adet = kuyruk.readUInt16LE(e + 10);
    let cdBoy = kuyruk.readUInt32LE(e + 12);
    let cdOfs = kuyruk.readUInt32LE(e + 16);
    if (adet === 0xffff || cdBoy === 0xffffffff || cdOfs === 0xffffffff) {
      const l = e - 20;
      if (l < 0 || kuyruk.readUInt32LE(l) !== 0x07064b50) throw new Error('zip64 bulucusu yok');
      const z = okuFd(fd, 56, Number(kuyruk.readBigUInt64LE(l + 8)));
      if (z.readUInt32LE(0) !== 0x06064b50) throw new Error('zip64 dizin sonu yok');
      adet = Number(z.readBigUInt64LE(32));
      cdBoy = Number(z.readBigUInt64LE(40));
      cdOfs = Number(z.readBigUInt64LE(48));
    }
    const cd = okuFd(fd, cdBoy, cdOfs);
    const girdiler = new Map();
    let p = 0;
    for (let k = 0; k < adet; k++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('zip merkez dizini bozuk');
      const bayrak = cd.readUInt16LE(p + 8);
      const yontem = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      let sikisik = cd.readUInt32LE(p + 20);
      let acik = cd.readUInt32LE(p + 24);
      const adBoy = cd.readUInt16LE(p + 28);
      const ekBoy = cd.readUInt16LE(p + 30);
      const yorumBoy = cd.readUInt16LE(p + 32);
      let yerelOfs = cd.readUInt32LE(p + 42);
      const ad = cd.subarray(p + 46, p + 46 + adBoy).toString('utf8');
      if (acik === 0xffffffff || sikisik === 0xffffffff || yerelOfs === 0xffffffff) {
        let q = p + 46 + adBoy;
        const son = q + ekBoy;
        while (q + 4 <= son) {
          const id = cd.readUInt16LE(q);
          const n = cd.readUInt16LE(q + 2);
          if (id === 0x0001) {
            let r = q + 4;
            if (acik === 0xffffffff) { acik = Number(cd.readBigUInt64LE(r)); r += 8; }
            if (sikisik === 0xffffffff) { sikisik = Number(cd.readBigUInt64LE(r)); r += 8; }
            if (yerelOfs === 0xffffffff) { yerelOfs = Number(cd.readBigUInt64LE(r)); r += 8; }
          }
          q += 4 + n;
        }
      }
      girdiler.set(ad, {
        ad, crc, boyut: acik, sikisik, yontem, bayrak, yerelOfs, dizin: ad.endsWith('/'),
      });
      p += 46 + adBoy + ekBoy + yorumBoy;
    }
    return girdiler;
  } finally {
    fs.closeSync(fd);
  }
}

/** Tek girdiyi belleğe okur (stored/deflate), CRC doğrular. */
function zipGirdiOku(zipYolu, girdi) {
  if (!girdi) throw new Error('zip girdisi yok');
  if (girdi.bayrak & 1) throw new Error(`şifreli zip girdisi okunamaz: ${girdi.ad}`);
  if (girdi.boyut > OKUMA_TAVANI || girdi.sikisik > OKUMA_TAVANI) {
    throw new Error(`zip girdisi okuma tavanını aşıyor: ${girdi.ad}`);
  }
  const fd = fs.openSync(zipYolu, 'r');
  try {
    const lh = okuFd(fd, 30, girdi.yerelOfs);
    if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error(`yerel başlık bozuk: ${girdi.ad}`);
    const veriOfs = girdi.yerelOfs + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    const ham = okuFd(fd, girdi.sikisik, veriOfs);
    let veri;
    if (girdi.yontem === 0) veri = ham;
    else if (girdi.yontem === 8) veri = zlib.inflateRawSync(ham);
    else throw new Error(`desteklenmeyen sıkıştırma ${girdi.yontem}: ${girdi.ad}`);
    if (veri.length !== girdi.boyut || crc32(veri) !== girdi.crc) {
      throw new Error(`zip girdisi CRC/boyut tutmuyor: ${girdi.ad}`);
    }
    return veri;
  } finally {
    fs.closeSync(fd);
  }
}

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

// ─── Saf kararlar ───────────────────────────────────────────────────────────────────────────

/**
 * Menü konumları. Set: `<dizin>/classlibraries/ImWin32.dll` (bir düzey). Set VARSA kökteki menü
 * set KABUĞUNUN menüsüdür → KÖK, işlenmez. Set yoksa kökteki menü = tek kitap.
 * @param {Iterable<string>} adlar
 * @returns {{set: boolean, konumlar: Array<{kitap: string, kok: string}>}}
 */
function menuKonumlari(adlar) {
  const liste = [...adlar];
  const altMenuRe = new RegExp(`^([^/]+)/${MENU.replace(/[.]/g, '\\.')}$`);
  const kitaplar = liste
    .map((a) => altMenuRe.exec(a))
    .filter((m) => m && m[1] !== 'classlibraries' && m[1] !== '..' && m[1] !== '.')
    .map((m) => m[1])
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (kitaplar.length) {
    return { set: true, konumlar: kitaplar.map((k) => ({ kitap: k, kok: `${k}/` })) };
  }
  if (liste.includes(MENU)) return { set: false, konumlar: [{ kitap: '.', kok: '' }] };
  return { set: false, konumlar: [] };
}

/** `app.config.js` metninden `updateBookEndPoint` şablonu (yoksa null). */
function ucSablonu(appConfigMetni) {
  const m = /updateBookEndPoint\s*:\s*(["'`])([^"'`]+)\1/.exec(String(appConfigMetni || ''));
  return m ? m[2].trim() : null;
}

/** Motorun kurduğu URL'nin birebiri (`setMi` motorda HER ZAMAN "0"). */
function teklifUrl(sablon, id, surum) {
  return String(sablon)
    .replace('{bookId}', encodeURIComponent(id))
    .replace('{isSet}', '0')
    .replace('{version}', encodeURIComponent(surum));
}

/** Kimlik İmpark kitabı mı? (0, boş, sayısal olmayan → hayır) */
function imparkKimligiMi(id) {
  return /^[1-9]\d*$/.test(String(id == null ? '' : id));
}

/**
 * İmpark cevabını yorumlar. SAF.
 * Canlı davranış (yayincilikadm guncelleme_teklifi.py, ölçüldü 25.09):
 *   versiyon <  ZipVersiyon → Data = ".../ZKitapZipH/<id>-<ZipVersiyon>.zip", Vs = ZipVersiyon
 *   versiyon >= ZipVersiyon → Data = "", Vs = SORULAN versiyon
 *   olmayan kitap id        → Success true, Data "" (Success tek başına kanıt değil)
 * @param {{id: string, surum: number}} kapak
 * @param {{hata?: string, status?: number, govde?: string}} cevap
 * @returns {{durum: string, vs: number|null, data: string|null, not: string}}
 */
function teklifYorumla(kapak, cevap) {
  const olc = (not) => ({ durum: DURUM.OLCULEMEDI, vs: null, data: null, not });
  if (!cevap || cevap.hata) return olc(cevap && cevap.hata ? cevap.hata : 'cevap yok');
  if (cevap.status !== 200) return olc(`HTTP ${cevap.status}`);
  let j;
  try { j = JSON.parse(cevap.govde); } catch (_) { return olc('cevap JSON değil'); }
  if (!j || j.Success !== true) return olc('Success=false');
  const data = String(j.Data == null ? '' : j.Data).trim();
  if (!data) return { durum: DURUM.GUNCEL, vs: kapak.surum, data: null, not: 'Data boş' };
  const m = /^https?:\/\/[^/?#]+\/.*\/ZKitapZipH\/(\d+)-(\d+)\.zip(?:[?#].*)?$/i.exec(data);
  if (!m) return olc(`Data beklenen biçimde değil: ${data.slice(0, 120)}`);
  if (m[1] !== String(kapak.id)) return olc(`Data başka kitabın zip'i: ${m[1]} ≠ ${kapak.id}`);
  const vs = Number(m[2]);
  if (j.Vs != null && Number(j.Vs) !== vs) return olc(`Vs (${j.Vs}) zip adıyla (${vs}) tutmuyor`);
  if (!(vs > kapak.surum)) return olc(`Data dolu ama İmpark v${vs} ≤ paket v${kapak.surum}`);
  return { durum: DURUM.GERIDE, vs, data, not: `v${kapak.surum} < İmpark v${vs}` };
}

/**
 * Kimlik kararı (memory set-klasor-kimligi-thumbs-md5-ile): kapak `thumbs/1.jpg` md5 EŞİT olmalı;
 * iç sayfa örneği varsa en az biri eşit olmalı (ortak kapaklı iki kitap — iki Workbook — ancak
 * iç sayfayla ayrılır). SAF.
 * @param {Array<{ad: string, arsiv: string|null, impark: string|null}>} ornekler ilk öğe kapak
 */
function kimlikKarari(ornekler, kitapIdler = null) {
  const [kapak, ...ic] = ornekler || [];
  if (!kapak || kapak.ad !== '1.jpg') return { eslesti: false, neden: 'kapak örneği yok' };
  if (!kapak.arsiv) return { eslesti: false, neden: 'kaynakta thumbs/1.jpg yok' };
  if (!kapak.impark) return { eslesti: false, neden: "İmpark zip'inde thumbs/1.jpg yok" };
  if (kapak.arsiv !== kapak.impark) {
    // 03.10 (59835 book3 58237: kapak yeniden kodlanmış 641x797 aynı görsel; 73581 book4 73710:
    // kaynak v1 boş yer tutucu sayfalar, İmpark v2 gerçek içerik): görsel md5 sürüm arası
    // değişebilir. BookContent.xml `kitapId` (İmpark kitap kimliği) iki tarafta eşitse AYNI kitaptır.
    const a = kitapIdler && kitapIdler.arsiv;
    if (a && a.length >= 4 && a === kitapIdler.impark) {
      return { eslesti: true, neden: `kapak md5 farklı ama BookContent kitapId eşit (${a})` };
    }
    return { eslesti: false, neden: 'kapak thumbs/1.jpg md5 farklı' };
  }
  const olculen = ic.filter((o) => o.arsiv && o.impark);
  if (!olculen.length) return { eslesti: true, neden: 'kapak eşit (iç sayfa örneği yok)' };
  const esit = olculen.filter((o) => o.arsiv === o.impark).length;
  if (!esit) {
    return {
      eslesti: false,
      neden: `kapak eşit ama iç sayfa örneklerinin hiçbiri eşit değil (0/${olculen.length}; `
        + 'ortak kapaklı başka kitap?)',
    };
  }
  return { eslesti: true, neden: `kapak + ${esit}/${olculen.length} iç sayfa eşit` };
}

/** Kimlik örnek adları: 1.jpg + iç sayfalar (2., orta, son) — iki tarafta da olanlardan. SAF. */
function ornekAdlari(kaynakNumaralari, imparkNumaralari) {
  const ortak = [...new Set(imparkNumaralari)]
    .filter((n) => kaynakNumaralari.includes(n) && n !== 1)
    .sort((a, b) => a - b);
  const sec = ortak.length
    ? [ortak[0], ortak[Math.floor(ortak.length / 2)], ortak[ortak.length - 1]]
    : [];
  return ['1.jpg', ...[...new Set(sec)].map((n) => `${n}.jpg`)];
}

/**
 * KÖK KORUMA — yazılabilir mi? Yalnız `<kok>assets/<ID>/…` ve `<kok>classlibraries/ImWin32.dll`
 * (hedeflenen kitaplar için). `..`/`.` bileşeni ya da mutlak yol taşıyan ad asla. SAF.
 * @param {string} ad zip içi göreli yol (posix)
 * @param {Array<{kok: string, id: string}>} hedefler
 */
function yazmaIzinliMi(ad, hedefler) {
  const a = String(ad || '');
  if (!a || a.startsWith('/') || a.split('/').some((p) => p === '..' || p === '.')) return false;
  return (hedefler || []).some((h) => imparkKimligiMi(h.id)
    && (a.startsWith(`${h.kok}assets/${h.id}/`) || a === `${h.kok}${MENU}`));
}

/**
 * Güncelleme öncesi/sonrası merkez dizinleri kıyaslar: izin DIŞI her ekleme/değişiklik ve HER
 * silme (üzerine yazma asla silmez) ihlaldir. SAF.
 * @param {Map<string,{crc:number,boyut:number}>} once
 * @param {Map<string,{crc:number,boyut:number}>} sonra
 * @returns {string[]} ihlal satırları
 */
function kokKorumaIhlalleri(once, sonra, hedefler) {
  const ihlal = [];
  for (const [ad, o] of once) {
    const s = sonra.get(ad);
    if (!s) { ihlal.push(`silindi: ${ad}`); continue; }
    if (yazmaIzinliMi(ad, hedefler)) continue;
    if (s.crc !== o.crc || s.boyut !== o.boyut) ihlal.push(`değişti: ${ad}`);
  }
  for (const ad of sonra.keys()) {
    if (!once.has(ad) && !yazmaIzinliMi(ad, hedefler)) ihlal.push(`eklendi: ${ad}`);
  }
  return ihlal;
}

// ─── IO yardımcıları ────────────────────────────────────────────────────────────────────────

function komut(cmd, args, { cwd, girdi } = {}) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn(cmd, args, { cwd, stdio: [girdi == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e && e.message) });
      return;
    }
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ code: -1, stdout: out, stderr: `${err}${e.message}` }));
    p.on('close', (code) => resolve({ code, stdout: out, stderr: err }));
    if (girdi != null) p.stdin.end(girdi);
  });
}

/** İmpark sorusu (GET). Hata metni BİLEREK kısa Türkçe koda çevrilir (başlıktaki gerekçe 2). */
async function varsayilanGetir(url, { zamanAsimiMs = VARSAYILAN_ZAMAN_ASIMI_MS } = {}) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(zamanAsimiMs),
    });
    return { status: r.status, govde: await r.text() };
  } catch (e) {
    const zaman = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    const sn = Math.round(zamanAsimiMs / 100) / 10;
    return { hata: zaman ? `zaman aşımı (${sn} sn)` : 'bağlantı kurulamadı' };
  }
}

/** `x-impark-key` (varsa): IMPARK_KEY ortamı ya da ~/.yayincilikadm/impark-key. Loglanmaz. */
function imparkAnahtari(env = process.env) {
  const e = String(env.IMPARK_KEY || '').trim();
  if (e) return e;
  try {
    const d = fs.readFileSync(path.join(os.homedir(), '.yayincilikadm', 'impark-key'), 'utf8');
    return d.trim() || null;
  } catch (_) { return null; }
}

/**
 * ZKitapZipH indirmesi (curl). Anahtar argv'ye/diske YAZILMAZ: curl yapılandırması stdin'den.
 * Statik `Uploads/` yolu anahtarsız da 200 (ölçüm: mobil-zip-kaynak-olcumu §6).
 */
async function varsayilanIndir(url, hedef) {
  const gecici = `${hedef}.indiriliyor-${process.pid}`;
  const anahtar = imparkAnahtari();
  const args = ['-sS', '-4', '-L', '--fail', '--retry', '5', '--retry-delay', '3',
    '--retry-all-errors', '--connect-timeout', '20', '--speed-limit', '1024',
    '--speed-time', '120', '-A', UA, '-o', gecici];
  if (anahtar) args.push('-K', '-');
  args.push(url);
  const r = await komut('curl', args, {
    girdi: anahtar ? `header = "x-impark-key: ${anahtar.replace(/"/g, '')}"\n` : null,
  });
  if (r.code !== 0) {
    await fsp.rename(gecici, `${gecici}.yarim`).catch(() => {});
    throw new Error(`indirilemedi (indirme kodu ${r.code}): ${url}`);
  }
  await fsp.rename(gecici, hedef);
}

function icerikOnbellekKoku(env = process.env) {
  return env.EMPP_ICERIK_ONBELLEK || path.join(os.homedir(), '.empp-agent', 'icerik-onbellek');
}

function kanitKoku(env = process.env) {
  return env.EMPP_MERDIVEN_KANIT || path.join(os.homedir(), '.empp-agent', 'merdiven-kanit');
}

/** Güncelleme zip'inin düzeni: kökte data/BookContent.xml; her ad güvenli göreli. */
function guncellemeZipDenetle(dizin, zipAdi) {
  if (!dizin.has('data/BookContent.xml')) {
    throw new Error(`${zipAdi}: kökte data/BookContent.xml yok (beklenmeyen düzen)`);
  }
  for (const ad of dizin.keys()) {
    const rel = ig.girdiGoreli(path, ad);
    if (rel == null || rel !== ad.replace(/\/+$/, '')) {
      throw new Error(`${zipAdi}: güvensiz girdi adı ${JSON.stringify(ad)}`);
    }
  }
}

/**
 * İçerik önbelleği: `<kok>/<ID>/<ID>-<Vs>.zip` (anahtar = içerik sürümü). Varsa ve düzeni
 * geçerliyse yeniden indirilmez; yeni sürüm girince aynı kitabın eski sürümleri budanır.
 */
async function icerikZipiGetir({ id, vs, url, onbellek, indir, log }) {
  const dizin = path.join(onbellek, String(id));
  const hedef = path.join(dizin, `${id}-${vs}.zip`);
  await fsp.mkdir(dizin, { recursive: true });
  let hazir = false;
  try {
    guncellemeZipDenetle(zipDizini(hedef), path.basename(hedef));
    hazir = true;
  } catch (_) { /* yok ya da bozuk → indir */ }
  if (hazir) {
    log(`[merdiven] S1 ${id}-${vs}.zip içerik önbelleğinden`);
  } else {
    const bas = Date.now();
    await indir(url, hedef);
    const mb = ((await fsp.stat(hedef)).size / 1e6).toFixed(0);
    const sn = ((Date.now() - bas) / 1000).toFixed(0);
    log(`[merdiven] S1 ${id}-${vs}.zip indirildi (${mb} MB, ${sn} sn)`);
    guncellemeZipDenetle(zipDizini(hedef), path.basename(hedef));
  }
  for (const ad of await fsp.readdir(dizin).catch(() => [])) {
    if (ad !== path.basename(hedef) && /^\d+-\d+\.zip$/.test(ad)) {
      await fsp.rm(path.join(dizin, ad), { force: true }).catch(() => {});
    }
  }
  return hedef;
}

async function dosyalariTopla(kok) {
  const out = [];
  async function yuru(rel) {
    for (const d of await fsp.readdir(path.join(kok, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) await yuru(r);
      else out.push(r);
    }
  }
  await yuru('');
  return out;
}

/** `<onek>` altındaki alt ağaç dosya sayıları (pages/thumbs/htmletk/audio/data …). */
function altAgacSayilari(dizin, onek) {
  const say = {};
  for (const [ad, g] of dizin) {
    if (g.dizin || !ad.startsWith(onek)) continue;
    const rel = ad.slice(onek.length);
    if (rel.includes('/')) {
      const ust = rel.split('/')[0];
      say[ust] = (say[ust] || 0) + 1;
    }
  }
  return say;
}

// ─── S0 ─────────────────────────────────────────────────────────────────────────────────────

/**
 * S0 ÇEKİRDEĞİ — kaynaktan bağımsız: build zip'i (s0Olc), kabul kapılarında kurulu uygulama ağacı
 * (tools/kabul/set-guncellik.js: yerel dizin/asar ya da CDP ile canlı sayfanın fs'i). Alt kitap
 * listesi `menuKonumlari`, kimlik+sürüm `menuCoz`+`kapaklar`, soru `ucSablonu`+`teklifUrl`, cevap
 * `teklifYorumla` — TEK KAYNAK (kabul "hangi alt kitap, hangi sürüm" sorusunu merdivenle aynı cevaplar).
 * Salt okuma.
 * @param {{adlar: Iterable<string>, oku: (rel: string) => (Buffer|null), getir?: Function,
 *          zamanAsimiMs?: number}} o  adlar = kök-göreli POSIX yollar; oku yoksa null/fırlatır
 * @returns {Promise<{set: boolean, satirlar: Array<object>}>}
 */
async function s0Kaynaktan({
  adlar, oku, getir = varsayilanGetir, zamanAsimiMs,
} = {}) {
  const { set, konumlar } = menuKonumlari(adlar || []);
  const satirlar = [];
  for (const { kitap, kok } of konumlar) {
    const bos = { kitap, kok, id: null, surum: null, durum: DURUM.OLCULEMEDI };
    let xml = null;
    try { xml = ig.menuCoz(oku(`${kok}${MENU}`)); } catch (_) { xml = null; }
    if (!xml) {
      satirlar.push({ ...bos, not: 'menü çözülemedi' });
      continue;
    }
    let sablon = null;
    try {
      sablon = ucSablonu(oku(`${kok}app.config.js`).toString('utf8'));
    } catch (_) { sablon = null; }
    const kapakListesi = ig.kapaklar(xml);
    if (!kapakListesi.length) satirlar.push({ ...bos, not: 'menüde kapak yok' });
    for (const c of kapakListesi) {
      const satir = { kitap, kok, id: c.ID, surum: c.version, url: c.URL };
      if (!imparkKimligiMi(c.ID)) {
        const not = `kimlik ${JSON.stringify(c.ID)} — İmpark kitabı değil`;
        satirlar.push({ ...satir, durum: DURUM.ATLANDI, not });
        continue;
      }
      if (c.version == null) {
        satirlar.push({ ...satir, durum: DURUM.OLCULEMEDI, not: 'menüde sürüm yok' });
        continue;
      }
      if (!sablon || !/^https?:\/\//i.test(sablon)) {
        const not = 'app.config.js updateBookEndPoint yok';
        satirlar.push({ ...satir, durum: DURUM.OLCULEMEDI, not });
        continue;
      }
      const soru = teklifUrl(sablon, c.ID, c.version);
      const y = teklifYorumla({ id: c.ID, surum: c.version }, await getir(soru, { zamanAsimiMs }));
      satirlar.push({ ...satir, soru, durum: y.durum, vs: y.vs, data: y.data, not: y.not });
    }
  }
  return { set, satirlar };
}

/**
 * S0: zip'teki her kitap kapağı için (kimlik, sürüm) + İmpark cevabı. Salt okuma.
 * @returns {Promise<{set: boolean, satirlar: Array<object>}>}
 */
async function s0Olc({ zip, getir = varsayilanGetir, zamanAsimiMs } = {}) {
  const dizin = zipDizini(zip);
  return s0Kaynaktan({
    adlar: dizin.keys(), oku: (rel) => zipGirdiOku(zip, dizin.get(rel)), getir, zamanAsimiMs,
  });
}

function satirMetni(s) {
  const kim = s.id == null ? '?' : s.id;
  const sur = s.surum == null ? '?' : `v${s.surum}`;
  const imp = s.vs == null ? '' : ` İmpark v${s.vs}`;
  return `${s.kitap} ${kim} ${sur}${imp} ${s.durum}${s.not ? ` (${s.not})` : ''}`;
}

// ─── S1 ─────────────────────────────────────────────────────────────────────────────────────

/** Varsayılan içerik yazıcısı: güncelleme zip'i sahnede `<kok>assets/<ID>/` altına açılır. */
async function varsayilanIcerikYaz({ sahne, kok, id, guncellemeZip }) {
  const hedef = path.join(sahne, kok, 'assets', String(id));
  await fsp.mkdir(hedef, { recursive: true });
  const r = await komut('unzip', ['-o', '-q', guncellemeZip, '-d', hedef]);
  if (r.code !== 0) {
    throw new Error(`güncelleme açılamadı (unzip ${r.code}): ${r.stderr.slice(-200)}`);
  }
  return hedef;
}

/** Açma doğrulaması: BookContent md5 zip = disk; her dosya girdisi diskte, boyutu eşit. */
function acmaDogrula(guncellemeZip, gDizin, hedefDizin) {
  const bc = zipGirdiOku(guncellemeZip, gDizin.get('data/BookContent.xml'));
  const disk = path.join(hedefDizin, 'data', 'BookContent.xml');
  if (!fs.existsSync(disk) || md5(fs.readFileSync(disk)) !== md5(bc)) {
    throw new Error('açma doğrulanamadı (BookContent md5)');
  }
  const eksik = [];
  for (const g of gDizin.values()) {
    if (g.dizin) continue;
    let st = null;
    try { st = fs.statSync(path.join(hedefDizin, g.ad)); } catch (_) { st = null; }
    if (!st || st.size !== g.boyut) eksik.push(g.ad);
  }
  if (eksik.length) throw new Error(`açma eksik (${eksik.length}, ilk: ${eksik[0]})`);
  return { bookContentMd5: md5(bc), girdi: gDizin.size };
}

/** BookContent.xml `<Book kitapId="…">` değeri (yoksa null). SAF. */
function kitapIdOku(xmlBuf) {
  const m = /<Book\b[^>]*?\bkitapId="([^"]+)"/i.exec(String(xmlBuf || ''));
  return m ? m[1] : null;
}

/** KİMLİK: kaynaktaki kitap klasörü gerçekten bu kitap mı? (yanlış kitabı ezme) */
function kimlikOlc({ zip, once, kok, id, guncellemeZip, gDizin }) {
  const onek = `${kok}assets/${id}/thumbs/`;
  const numara = (ad, bas) => (ad.startsWith(bas) && /^\d+\.jpg$/.test(ad.slice(bas.length))
    ? Number(ad.slice(bas.length, -4)) : null);
  const kaynakNo = [...once.keys()].map((a) => numara(a, onek)).filter((n) => n != null);
  const imparkNo = [...gDizin.keys()].map((a) => numara(a, 'thumbs/')).filter((n) => n != null);
  const ornekler = ornekAdlari(kaynakNo, imparkNo).map((ad) => {
    const k = once.get(`${onek}${ad}`);
    const i = gDizin.get(`thumbs/${ad}`);
    return {
      ad,
      arsiv: k ? md5(zipGirdiOku(zip, k)) : null,
      impark: i ? md5(zipGirdiOku(guncellemeZip, i)) : null,
    };
  });
  const kb = once.get(`${kok}assets/${id}/data/BookContent.xml`);
  const ib = gDizin.get('data/BookContent.xml');
  const kitapIdler = {
    arsiv: kb ? kitapIdOku(zipGirdiOku(zip, kb).toString('utf8')) : null,
    impark: ib ? kitapIdOku(zipGirdiOku(guncellemeZip, ib).toString('utf8')) : null,
  };
  return kimlikKarari(ornekler, kitapIdler);
}

/**
 * S1: geride kalan kitapları iş kopyası zip'e uygular (ya hep ya hiç).
 * @param {{zip: string, calisma: string, set: boolean, geride: Array<object>, indir?: Function,
 *   onbellek?: string, icerikYaz?: Function, log?: Function}} o
 * @returns {Promise<Array<object>>} kitap başına S1 raporu
 */
async function s1Uygula(o) {
  const log = o.log || (() => {});
  const indir = o.indir || varsayilanIndir;
  const icerikYaz = o.icerikYaz || varsayilanIcerikYaz;
  const onbellek = o.onbellek || icerikOnbellekKoku();
  const hedefler = o.geride.map((s) => ({ kok: s.kok, id: String(s.id) }));
  if (o.set && hedefler.some((h) => !h.kok)) {
    throw new Error(`${ISARET} KÖK KORUMA (S1): sette kök menü hedeflenemez (kabuk menüsü)`);
  }
  const once = zipDizini(o.zip);
  const sahne = await fsp.mkdtemp(path.join(o.calisma, 'merdiven-sahne-'));
  const rapor = [];
  const menuler = new Map(); // kitap dizini başına bir menü; o dizindeki TÜM geride kapaklar
  for (const s of o.geride) {
    const id = String(s.id);
    const guncellemeZip = await icerikZipiGetir({
      id, vs: s.vs, url: s.data, onbellek, indir, log,
    });
    const gDizin = zipDizini(guncellemeZip);
    guncellemeZipDenetle(gDizin, path.basename(guncellemeZip));

    const kimlik = kimlikOlc({ zip: o.zip, once, kok: s.kok, id, guncellemeZip, gDizin });
    if (!kimlik.eslesti) {
      throw new Error(`${ISARET} KİMLİK TUTMUYOR (S1): ${s.kitap} ${id} — ${kimlik.neden}; `
        + `${path.basename(guncellemeZip)} UYGULANMADI (yanlış kitabı ezme), elle doğrulanmalı`);
    }

    const hedefDizin = await icerikYaz({ sahne, kok: s.kok, id, guncellemeZip });
    const dogrulama = acmaDogrula(guncellemeZip, gDizin, path.join(sahne, s.kok, 'assets', id));

    // Menü sürümü YALNIZ içerik doğrulandıktan sonra ilerler (runtime menuSuz kalıbı).
    let m = menuler.get(s.kok);
    if (!m) {
      const ham = zipGirdiOku(o.zip, once.get(`${s.kok}${MENU}`));
      const xml = ig.menuCoz(ham);
      if (!xml) throw new Error(`${s.kitap}: menü çözülemedi (S1)`);
      m = { xml, bicim: ig.menuBicimi(ham) }; // kaynağın kodlama biçimi korunur (27/5 ya da 127/17)
      menuler.set(s.kok, m);
    }
    m.xml = ig.kapakAyarla(m.xml, id, { version: s.vs, URL: s.data });
    const yeni = ig.kapaklar(m.xml).find((c) => c.ID === id);
    if (!yeni || yeni.version !== s.vs) throw new Error(`${s.kitap}: menü sürümü yazılamadı`);
    rapor.push({
      kitap: s.kitap, kok: s.kok, id, once: s.surum, sonra: s.vs, kimlik: kimlik.neden,
      bookContentMd5: dogrulama.bookContentMd5, girdi: dogrulama.girdi, hedef: hedefDizin,
      altAgacOnce: altAgacSayilari(once, `${s.kok}assets/${id}/`),
    });
  }
  for (const [kok, m] of menuler) {
    const yol = path.join(sahne, kok, MENU);
    await fsp.mkdir(path.dirname(yol), { recursive: true });
    await fsp.writeFile(yol, ig.menuKodla(m.xml, undefined, m.bicim));
  }

  // KÖK KORUMA 1: sahnedeki her dosya izin listesinde olmalı (zip'e girmeden).
  const sahneDosyalari = await dosyalariTopla(sahne);
  const izinsiz = sahneDosyalari.filter((d) => !yazmaIzinliMi(d, hedefler));
  if (izinsiz.length) {
    throw new Error(`${ISARET} KÖK KORUMA (S1): izin dışı ${izinsiz.length} dosya `
      + `(ilk: ${izinsiz[0]}) — zip'e yazılmadı`);
  }
  const ust = [...new Set(sahneDosyalari.map((d) => d.split('/')[0]))];
  // -D: dizin girdisi EKLEME (kaynakta olmayan `book1/` girdisi kök ihlali sayılırdı).
  // -n: zaten sıkıştırılmış içerik (sayfa/ses/video) yeniden deflate edilmez — yalnız CPU yer.
  const z = await komut('zip', ['-q', '-r', '-D', '-X', '-n', SIKISIK_UZANTILAR,
    path.resolve(o.zip), ...ust], { cwd: sahne });
  if (z.code !== 0) throw new Error(`zip güncellenemedi (${z.code}): ${z.stderr.slice(-200)}`);

  // KÖK KORUMA 2: merkez dizin kıyası (CRC + boyut) — izin dışı hiçbir girdi değişmemeli.
  const sonra = zipDizini(o.zip);
  const ihlal = kokKorumaIhlalleri(once, sonra, hedefler);
  if (ihlal.length) {
    throw new Error(`${ISARET} KÖK KORUMA (S1): ${ihlal.length} izin dışı değişiklik `
      + `(ilk: ${ihlal[0]}) — iş kopyası bozuldu, paket üretilmedi`);
  }
  for (const r of rapor) {
    r.altAgacSonra = altAgacSayilari(sonra, `${r.kok}assets/${r.id}/`);
    const bc = zipGirdiOku(o.zip, sonra.get(`${r.kok}assets/${r.id}/data/BookContent.xml`));
    if (md5(bc) !== r.bookContentMd5) throw new Error(`${r.kitap}: zip'teki BookContent tutmuyor`);
    const xml = ig.menuCoz(zipGirdiOku(o.zip, sonra.get(`${r.kok}${MENU}`)));
    const c = xml && ig.kapaklar(xml).find((k) => k.ID === r.id);
    if (!c || c.version !== r.sonra) throw new Error(`${r.kitap}: zip'teki menü sürümü tutmuyor`);
  }
  return rapor;
}

// ─── Giriş noktası ──────────────────────────────────────────────────────────────────────────

async function kanitYaz(dosya, veri) {
  try {
    await fsp.mkdir(path.dirname(dosya), { recursive: true });
    await fsp.writeFile(dosya, `${JSON.stringify(veri, null, 2)}\n`);
    return dosya;
  } catch (_) { return null; }
}

/**
 * S0 + S1. İş kopyası `zip` üstünde çalışır (arşiv/önbellek zip'i DEĞİL).
 * @param {{zip: string, calisma: string, bookId?: string, platform?: string, log?: Function,
 *   warn?: Function, getir?: Function, indir?: Function, onbellek?: string,
 *   kanitDizini?: string, icerikYaz?: Function, zamanAsimiMs?: number}} o
 * @returns {Promise<{satirlar: Array<object>, s1: Array<object>, kanit: string|null}>}
 */
async function icerikMerdiveni(o) {
  const log = o.log || (() => {});
  const warn = o.warn || log;
  const damga = new Date().toISOString().replace(/[:.]/g, '-');
  const kanitDosyasi = path.join(o.kanitDizini || kanitKoku(),
    `${o.bookId || 'kitap'}-${o.platform || 'x'}-${damga}.json`);
  const kanit = {
    bookId: o.bookId, platform: o.platform, zaman: new Date().toISOString(), zip: o.zip,
  };

  const s0 = await s0Olc({ zip: o.zip, getir: o.getir, zamanAsimiMs: o.zamanAsimiMs });
  kanit.set = s0.set;
  kanit.satirlar = s0.satirlar;
  if (!s0.satirlar.length) {
    kanit.sonuc = 'menü yok — İmpark okuyucu kitabı bulunmadı, merdiven uygulanmadı';
    kanit.dosya = await kanitYaz(kanitDosyasi, kanit);
    warn(`[merdiven] S0: menü (${MENU}) yok — İmpark kitabı değil, atlandı`);
    return { satirlar: [], s1: [], kanit: kanit.dosya };
  }
  for (const s of s0.satirlar) log(`[merdiven] S0 ${satirMetni(s)}`);

  const olculemeyen = s0.satirlar.filter((s) => s.durum === DURUM.OLCULEMEDI);
  if (olculemeyen.length) {
    kanit.sonuc = 'OLCULEMEDI — iş düştü, eski içerikle devam edilmedi';
    kanit.dosya = await kanitYaz(kanitDosyasi, kanit);
    throw new Error(`${ISARET} ÖLÇÜLEMEDİ (S0): ${olculemeyen.map(satirMetni).join('; ')} — `
      + `eski içerikle üretilmedi (kanıt ${kanit.dosya || '-'})`);
  }
  const geride = s0.satirlar.filter((s) => s.durum === DURUM.GERIDE);
  if (!geride.length) {
    kanit.sonuc = 'GUNCEL';
    kanit.dosya = await kanitYaz(kanitDosyasi, kanit);
    log(`[merdiven] S0: tüm kitaplar güncel — kanıt ${kanit.dosya || '-'}`);
    return { satirlar: s0.satirlar, s1: [], kanit: kanit.dosya };
  }
  try {
    kanit.s1 = await s1Uygula({
      zip: o.zip, calisma: o.calisma, set: s0.set, geride, indir: o.indir,
      onbellek: o.onbellek, icerikYaz: o.icerikYaz, log,
    });
  } catch (e) {
    kanit.sonuc = `S1 DÜŞTÜ: ${e.message}`;
    kanit.dosya = await kanitYaz(kanitDosyasi, kanit);
    throw String(e.message).startsWith(ISARET)
      ? e
      : new Error(`${ISARET} S1 DÜŞTÜ: ${e.message} (kanıt ${kanit.dosya || '-'})`);
  }
  kanit.sonuc = 'S1 UYGULANDI';
  kanit.dosya = await kanitYaz(kanitDosyasi, kanit);
  for (const r of kanit.s1) {
    log(`[merdiven] S1 ${r.kitap} ${r.id} v${r.once}→v${r.sonra} UYGULANDI (${r.kimlik}; `
      + `alt ağaç ${JSON.stringify(r.altAgacOnce)}→${JSON.stringify(r.altAgacSonra)})`);
  }
  log(`[merdiven] kanıt ${kanit.dosya || '-'}`);
  return { satirlar: s0.satirlar, s1: kanit.s1, kanit: kanit.dosya };
}

module.exports = {
  ISARET, DURUM, merdivenAcik, icerikMerdiveni, s0Olc, s0Kaynaktan, s1Uygula,
  menuKonumlari, ucSablonu, teklifUrl, teklifYorumla, imparkKimligiMi, kimlikKarari, kitapIdOku, ornekAdlari,
  yazmaIzinliMi, kokKorumaIhlalleri, zipDizini, zipGirdiOku, satirMetni, varsayilanGetir,
  icerikOnbellekKoku, kanitKoku,
  // set-uyelik-ek.js (2026-09-30) eksik set kitabını AYNI indirme/önbellek yolundan alır.
  icerikZipiGetir, varsayilanIndir, komut, SIKISIK_UZANTILAR,
};

// CLI (salt okuma S0 kuru koşusu): node src/agent/icerik-merdiven.js s0 <build.zip>
if (require.main === module) {
  const [kip, zip] = process.argv.slice(2);
  if (kip !== 's0' || !zip) {
    console.error('kullanım: node src/agent/icerik-merdiven.js s0 <build.zip>');
    process.exit(2);
  }
  s0Olc({ zip }).then((r) => {
    for (const s of r.satirlar) console.log(satirMetni(s));
    console.log(JSON.stringify(r, null, 2));
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
