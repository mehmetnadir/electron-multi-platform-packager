#!/usr/bin/env node
'use strict';
/**
 * imza-yuva-win.js — scripts/imza-yuva-smb.sh'in Node sürümü (windows-kasa; Mac bash betiğinde kalır).
 * Aynı yuva (66902/windows.exe), aynı _hazir kopyası, aynı pencere → takas → imza bekleme kuralı
 * (180 dk + exe-remove + yeniden hazırlama + 60 dk; sonra bildir + çıkış 3), aynı çıkış kodları ve
 * windows-serit'in izlediği AYNI log işaretleri ("PENCERE BEKLENİYOR", "PENCERE: ", "takas N/3",
 * "İMZALI: ").
 *
 * Farklar (Windows):
 *   - tetik ve yuva temizliği yayincilikadm ÇAĞIRMAZ — imza-istek dosyası bırakır (panel oturumu Mac'te;
 *     köprü: tools/windows/imza-tetik-koprusu.js);
 *   - doğrulama: pe_is_signed + gövde eşitliği + `Get-AuthenticodeSignature` (Status Valid, İm Park,
 *     DigiCert zinciri) — osslsigncode yok;
 *   - hizli-kontrol openssl'siz: WIN_CERTIFICATE + imzacı adı PKCS#7 bloğunda (UTF-8/BMPString) +
 *     zaman damgası + gövde örneği.
 *
 * Kullanım:
 *   node imza-yuva-win.js hazirla <yerel.exe> [--kuru]
 *   node imza-yuva-win.js bekle-ve-tak <yerel.exe> [--tavan-dk 180] [--tavan2-dk 60] [--kuru]
 *   node imza-yuva-win.js hizli-kontrol <yuva-yolu> [<yerel-orijinal.exe>]
 * Ortam: EMPP_IMZA_YUVA_KOKU (canlı kök; win32 varsayılanı Storage7 UNC), IMZALI_DIZIN, SMB_SHA (0: takasta
 *   yalnız boyut), EMPP_IMZA_GERI_OKUMA=1 (hazırlamada _hazir kopyasını SMB'den geri okuyup sha256 kıyasla —
 *   eski davranış; varsayılan KAPALI, Nadir 06.10: kopya ~1,3 MB/s, geri okuma paket başına ~14 dk), TETIK=1 (yeniden denemede tetik isteği), EMPP_IMZA_ISTEK_DIZINI, ARALIK_SN, TAVAN_SN,
 *   TAVAN2_SN, KURU=1 + KURU_DIZIN (yerel sahte kök; istek yalnız EMPP_IMZA_ISTEK_DIZINI verilmişse),
 *   KURU_TAKAS_BOZ (test kancası), IMZA_BEKLENEN_CN, EMPP_BILDIR_IKILI.
 * Çıkış: 0 tamam · 2 kullanım/ön koşul · 3 tavan ya da imzasız · 4 takas/imza kimliği.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { ikiliKomutu } = require('./bildir-ikili');

const W = require('./windows-serit');
const A = require('./authenticode-win');
const I = require('./imza-istek');

const YUVA_ID = '66902'; // SABİT
/** `hazirla` başarı kanıtı satır öneki (JSON: ad, boyut, sha256, geriOkuma). */
const HAZIR_KANIT = 'HAZIR-KANIT';
const UNC_KOK = W.WIN_YUVA_KOKU; // tek kaynak: windows-serit
const MAC_KOK = path.join(os.homedir(), 'Impark', 'Storage7', 'vhosts', 'akillitahta.ydspublishing.com',
  'httpdocs', 'Uploads', 'KitapTekExe');

class CikisHatasi extends Error {
  constructor(kod, mesaj) { super(mesaj); this.kod = kod; }
}
const hata = (kod, mesaj) => { throw new CikisHatasi(kod, mesaj); };

function saat() { return new Date().toTimeString().slice(0, 8); }

/** Yol SMB'ye mi çıkıyor? (KURU kök reddi). Saf. */
function smbMi(p) {
  const s = String(p || '');
  return !s || s.startsWith('\\\\') || s.startsWith('//') || s.startsWith(path.join(os.homedir(), 'Impark'))
    || s.startsWith('/Volumes/');
}

/** Ortam + bayraklardan ayarlar. Saf (fs'e yalnız KURU denetiminde bakar). */
function ayarlar(env, bayrak, platform = process.platform) {
  const kuru = bayrak.kuru || env.KURU === '1';
  const sayi = (v, d) => (v === undefined || v === '' ? d : Number(v));
  const o = {
    kuru, platform,
    aralikMs: Math.max(1, Math.round(sayi(env.ARALIK_SN, 2) * 1000)),
    smbSha: env.SMB_SHA !== '0',
    // Geri okuma (06.10, Nadir: "geri okumayı atla"): varsayılan KAPALI. Bütünlük: sha256 yerelde kopyadan
    // ÖNCE (hedef) + kopya sonrası uzak BOYUT eşitliği + imzalı dönüşte gövde eşitliği/Authenticode.
    geriOkuma: env.EMPP_IMZA_GERI_OKUMA === '1',
    tetik: env.TETIK === '1',
    beklenenCn: env.IMZA_BEKLENEN_CN || 'İm Park Bilişim',
    bildirIkili: env.EMPP_BILDIR_IKILI || path.join(os.homedir(), '.local', 'bin', 'bildir'),
  };
  const tavanDk = bayrak.tavanDk === undefined ? 180 : bayrak.tavanDk;
  const tavan2Dk = bayrak.tavan2Dk === undefined ? 60 : bayrak.tavan2Dk;
  o.tavanSn = sayi(env.TAVAN_SN, tavanDk * 60);
  o.tavan2Sn = sayi(env.TAVAN2_SN, tavan2Dk * 60);
  if (kuru) {
    if (smbMi(env.KURU_DIZIN)) hata(2, 'KURU: yerel KURU_DIZIN şart (SMB değil)');
    if (!fs.existsSync(env.KURU_DIZIN)) hata(2, `KURU_DIZIN yok: ${env.KURU_DIZIN}`);
    if (smbMi(fs.realpathSync(env.KURU_DIZIN))) hata(2, 'KURU_DIZIN SMB\'ye çıkıyor');
    o.kok = env.KURU_DIZIN;
    o.imzaliDizin = path.join(o.kok, 'imzali');
    o.istekDizini = env.EMPP_IMZA_ISTEK_DIZINI || null; // KURU'da yalnız açıkça verilmişse
    o.authenticode = false;
  } else {
    o.kok = env.EMPP_IMZA_YUVA_KOKU || (platform === 'win32' ? UNC_KOK : MAC_KOK);
    // FAIL-CLOSED (04.10): win32 canlı kipte yuva kökü UNC olmalı — yerel yola 'yuva' yazıp imza beklemek
    // sessiz duruştur (Mac'te Storage7 bağlı değilken yaşandı). Yerel deneme yalnız KURU kipte.
    if (platform === 'win32' && !W.yuvaKokuUncMu(o.kok)) hata(2, `win32 canlı kipte yuva kökü UNC olmalı: ${o.kok}`);
    o.imzaliDizin = env.IMZALI_DIZIN || null; // null → yerel exe'nin yanında imzali/
    o.istekDizini = I.varsayilanIstekDizini(env);
    o.authenticode = platform === 'win32';
  }
  o.hazirDizin = path.join(o.kok, '_hazir');
  o.yuva = path.join(o.kok, YUVA_ID, 'windows.exe');
  if (`${o.hazirDizin}${path.sep}`.includes(`${path.sep}${YUVA_ID}${path.sep}`)) hata(2, 'hazırlık dizini yuva klasöründe olamaz');
  return o;
}

function boyut(p) { try { return fs.statSync(p).size; } catch (_) { return null; } }
function iz(p) {
  try { const s = fs.statSync(p); return `${s.size}/${Math.floor(s.mtimeMs / 1000)}`; } catch (_) { return 'yok'; }
}
async function sha(p) {
  const h = crypto.createHash('sha256');
  for await (const b of fs.createReadStream(p, { highWaterMark: 8 << 20 })) h.update(b);
  return h.digest('hex');
}
function hiz(b, ms) { const m = Math.max(1, ms); return `${(m / 1000).toFixed(2)} sn, ${(b / 1048576 / (m / 1000)).toFixed(1)} MB/s`; }
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/** PE sertifika dizini dolu mu (yayincilikadm pe_is_signed ölçütü). */
async function peImzaliMi(p) {
  try {
    const dz = W.peImzaDizini(await ilk(p, 4096));
    return Boolean(dz && dz.ofset && dz.boyut);
  } catch (_) { return false; }
}
async function ilk(p, n) {
  const fh = await fsp.open(p, 'r');
  try { const b = Buffer.alloc(n); const { bytesRead } = await fh.read(b, 0, n, 0); return b.subarray(0, bytesRead); } finally { await fh.close(); }
}
async function aralikOku(fh, konum, n) {
  const b = Buffer.alloc(n);
  const { bytesRead } = await fh.read(b, 0, n, konum);
  return b.subarray(0, bytesRead);
}

/** PKCS#7 bloğunda imzacı adı var mı (UTF8String ya da BMPString). Saf. */
function blokImzaciIceriyor(blok, cn) {
  if (blok.includes(Buffer.from(cn, 'utf8'))) return true;
  const be = Buffer.from(cn, 'utf16le');
  for (let i = 0; i + 1 < be.length; i += 2) { const t = be[i]; be[i] = be[i + 1]; be[i + 1] = t; }
  return blok.includes(be);
}

/** PKCS#7 bloğundan zaman damgası (GeneralizedTime / signingTime UTCTime). Saf. */
function blokZamanDamgasi(blok) {
  const s = blok.toString('latin1');
  let m = /\x18[\x0f-\x17](\d{14})/.exec(s);
  let t = m ? m[1] : '';
  if (!t) {
    m = /\x2a\x86\x48\x86\xf7\x0d\x01\x09\x05\x31[\s\S]\x17\x0d(\d{12})Z/.exec(s);
    t = m ? `20${m[1]}` : '';
  }
  return t ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12)} UTC` : null;
}

/** Başlığın imzalamada değişen iki alanını sıfırlar. Saf. */
function maskele(h, k) {
  const b = Buffer.from(h);
  if (k.checksum + 4 <= b.length) b.fill(0, k.checksum, k.checksum + 4);
  if (k.dizin + 8 <= b.length) b.fill(0, k.dizin, k.dizin + 8);
  return b;
}

/**
 * İNDİRMEDEN hızlı kontrol (bash `py hizli`): başlık + WIN_CERTIFICATE + imzacı + (orijinal varsa)
 * ≤2 MB gövde örneği. @returns {Promise<{kod:number, satirlar:string[]}>} 0 imzalı(+bizim) · 3 imzasız · 4 bizim değil
 */
async function hizliKontrol(yol, orj, { beklenenCn = 'İm Park Bilişim', rastgele = Math.random } = {}) {
  const t0 = Date.now();
  const satirlar = [];
  let okunan = 0;
  const n = fs.statSync(yol).size;
  const fh = await fsp.open(yol, 'r');
  const at = async (p, c) => { const d = await aralikOku(fh, p, c); okunan += d.length; return d; };
  const son = (kod, m) => {
    satirlar.push(`hızlı: ${m}`);
    satirlar.push(`hızlı: SMB'den okunan ${okunan} B / ${n} B, ${((Date.now() - t0) / 1000).toFixed(2)} sn`);
    return { kod, satirlar };
  };
  try {
    const h = await at(0, 4096);
    const k = W.peKonumlari(h);
    if (!k) return son(3, 'PE değil');
    const va = h.readUInt32LE(k.dizin);
    const sz = h.readUInt32LE(k.dizin + 4);
    satirlar.push(`hızlı: sertifika dizini ofset ${va} boyut ${sz} · dosya ${n} B`);
    if (!(va && sz)) return son(3, 'İMZASIZ (sertifika dizini boş)');
    if (va + sz !== n) return son(3, `İMZASIZ ya da yarım: ofset+boyut ${va + sz} ≠ dosya ${n}`);
    const w = await at(va, sz);
    const L = w.length >= 8 ? w.readUInt32LE(0) : 0;
    if (!(L > 8 && L <= sz) || w[6] !== 0x02 || w[7] !== 0x00) return son(3, 'WIN_CERTIFICATE PKCS#7 değil');
    const blok = w.subarray(8, L);
    const ts = blokZamanDamgasi(blok);
    const imzaciVar = blokImzaciIceriyor(blok, beklenenCn);
    satirlar.push(`hızlı: imzacı ${imzaciVar ? beklenenCn : '?'} · zaman damgası ${ts || 'YOK'}`);
    if (!imzaciVar) return son(4, `imzalı ama imzacı beklenen '${beklenenCn}' değil`);
    if (orj) {
      const m = fs.statSync(orj).size;
      const g = await fsp.open(orj, 'r');
      try {
        const q = 256 << 10;
        const ko = W.peKonumlari(await aralikOku(g, 0, 4096));
        if (!(m <= va && va < m + 8) || !ko || ko.checksum !== k.checksum || ko.dizin !== k.dizin) {
          return son(4, `imzalı ama bizim değil: ofset ${va}, orijinal ${m} B (≤7 B hizalama beklenir)`);
        }
        if (va > m && (await at(m, va - m)).some((x) => x !== 0)) return son(4, 'imzalı ama bizim değil: hizalama baytları dolu');
        const ar = [[0, Math.min(1 << 20, m)]];
        if (m > (1 << 20) + q) {
          const ek = [];
          for (let i = 0; i < 3; i += 1) ek.push([(1 << 20) + Math.floor(rastgele() * (m - q - (1 << 20))), q]);
          ar.push(...ek.sort((a, b) => a[0] - b[0]));
        }
        for (const [p, c] of ar) {
          let x = await aralikOku(g, p, c);
          let y = await at(p, c);
          if (p === 0) { x = maskele(x, k); y = maskele(y, k); }
          if (!x.equals(y)) return son(4, `imzalı ama bizim değil: ${p}+${c} aralığı farklı`);
        }
        satirlar.push(`hızlı: gövde örneği eşit — ${ar.map(([p, c]) => `${p}+${c}`).join(', ')}`);
      } finally { await g.close(); }
    }
    return son(0, `İMZALI${orj ? ' ve BİZİM' : ''} (${beklenenCn})`);
  } finally { await fh.close(); }
}

/** Gözcü durumu: tek exe için. */
class Gozcu {
  constructor(o, yerel, { log, istekYaz = I.istekYaz, authenticode = A.authenticodeDogrula, komutKos = W.komutKos } = {}) {
    this.o = o;
    this.yerel = yerel;
    this.ad = path.basename(yerel);
    this.hazir = path.join(o.hazirDizin, this.ad);
    this.log = log;
    this.istekYaz = istekYaz;
    this.authenticode = authenticode;
    this.komutKos = komutKos;
    this.imzaliDizin = o.imzaliDizin || path.join(path.dirname(path.resolve(yerel)), 'imzali');
  }

  async hedef() { this.yerelBoyut = boyut(this.yerel); this.yerelSha = await sha(this.yerel); }

  async ayniMi(p) {
    if (boyut(p) !== this.yerelBoyut) return false;
    return !this.o.smbSha || (await sha(p)) === this.yerelSha;
  }

  async hazirla() {
    try { await fsp.mkdir(this.o.hazirDizin, { recursive: true }); } catch (e) { hata(2, `hazırlık dizini açılamadı: ${this.o.hazirDizin}`); }
    this.log(`hazırla: ${this.ad} (${this.yerelBoyut} B, sha256 ${this.yerelSha.slice(0, 16)}…) → ${this.hazir}`);
    const t0 = Date.now();
    // Yarım kopya (çöken süreç) `.kopyalaniyor` adında kalır; copyFile üzerine yazar → yeniden başlar (idempotent).
    const ara = `${this.hazir}.kopyalaniyor`;
    try { await fsp.copyFile(this.yerel, ara); } catch (e) { hata(4, `kopyalama başarısız: ${e.message}`); }
    const kb = boyut(ara);
    if (kb !== this.yerelBoyut) hata(4, `kopya boyutu tutmadı (uzak ${kb === null ? 'yok' : kb} B, yerel ${this.yerelBoyut} B)`);
    try { await fsp.rename(ara, this.hazir); } catch (e) { hata(4, `adlandırma başarısız: ${e.message}`); }
    const t1 = Date.now();
    const b = boyut(this.hazir);
    if (b !== this.yerelBoyut) hata(4, `kopya boyutu tutmadı (uzak ${b === null ? 'yok' : b} B, yerel ${this.yerelBoyut} B)`);
    if (this.o.geriOkuma) {
      const s = await sha(this.hazir);
      this.log(`kopya: ${hiz(this.yerelBoyut, t1 - t0)} · geri okuma+sha256: ${hiz(b || 0, Date.now() - t1)}`);
      if (s !== this.yerelSha) hata(4, `geri okuma tutmadı (boyut ${b}, sha256 ${s.slice(0, 16)}…)`);
      this.log(`HAZIR — boyut+sha256 DOĞRULANDI: ${this.hazir}`);
    } else {
      this.log(`kopya: ${hiz(this.yerelBoyut, t1 - t0)} · geri okuma KAPALI (EMPP_IMZA_GERI_OKUMA=1 açar)`);
      this.log(`HAZIR — boyut DOĞRULANDI (sha256 yerelde, kopyadan önce): ${this.hazir}`);
    }
    // Makine okur kanıt satırı (windows-serit imzaHazirla ayrıştırır → hazır manifest `onKopya`).
    this.log(`${HAZIR_KANIT} ${JSON.stringify({ ad: this.ad, boyut: this.yerelBoyut, sha256: this.yerelSha, geriOkuma: this.o.geriOkuma })}`);
  }

  async takas() {
    const k = this.o.smbSha ? 'boyut+sha256' : 'boyut';
    for (let d = 1; d <= 3; d += 1) {
      if (d > 1) await bekle(this.o.aralikMs);
      if (!fs.existsSync(this.hazir)) {
        this.log(`takas ${d}/3: hazırlık dosyası yok, yerelden yeniden kopyalanıyor`);
        try {
          await fsp.copyFile(this.yerel, `${this.hazir}.kopyalaniyor`);
          await fsp.rename(`${this.hazir}.kopyalaniyor`, this.hazir);
        } catch (e) { this.log(`takas ${d}/3: yeniden kopya başarısız`); continue; }
      }
      const t0 = Date.now();
      try { await fsp.rename(this.hazir, this.o.yuva); } catch (e) { this.log(`takas ${d}/3: mv başarısız (${e.code || e.message})`); continue; }
      this.log(`takas ${d}/3: mv ${Date.now() - t0} ms`);
      if (this.o.kuru && Number(process.env.KURU_TAKAS_BOZ || 0) >= d) fs.appendFileSync(this.o.yuva, 'bozuk'); // test kancası
      if (await this.ayniMi(this.o.yuva)) {
        this.log(`takas ${d}/3: yuva geri okundu, ${k} EŞİT (+${Date.now() - t0} ms)`);
        return true;
      }
      const b = boyut(this.o.yuva);
      if ((b || 0) > this.yerelBoyut && (await peImzaliMi(this.o.yuva))) {
        this.log(`takas ${d}/3: yuvada imzalı dosya — imza erken geldi, takas tekrarlanmaz`);
        return true;
      }
      this.log(`takas ${d}/3: geri okuma TUTMADI (boyut ${b === null ? 'yok' : b})`);
    }
    return false;
  }

  /** 0 geçti · 3 henüz imzalı değil · 4 imzalı ama bizim değil. */
  async imzaDogrula(kopya) {
    if (!(await peImzaliMi(kopya))) { this.log('imza: sertifika dizini boş (pe_is_signed)'); return 3; }
    const g = await W.govdeEsitMi(this.yerel, kopya);
    if (!g.esit) { this.log(`imza: imzalı ama bizim exe DEĞİL (${g.sebep})`); return 4; }
    if (!this.o.authenticode) { this.log('imza: Authenticode atlandı (KURU / win32 değil) — yalnız pe_is_signed + gövde'); return 0; }
    const k = await this.authenticode(kopya, { komutKos: this.komutKos, beklenenImzaci: this.o.beklenenCn });
    if (!k.gecti) {
      this.log(`imza: Get-AuthenticodeSignature RED: ${k.sebep}`);
      return k.imzaci && !k.imzaci.includes(this.o.beklenenCn) ? 4 : 3;
    }
    this.log(`imza: Get-AuthenticodeSignature Valid · imzacı: ${k.imzaci} · zaman damgası: ${k.zamanDamgasi}`);
    return 0;
  }

  async istek(komut, sebep) {
    if (!this.o.istekDizini) { this.log(`${komut} isteği: istek dizini tanımsız (KURU) — atlandı`); return; }
    try {
      const yol = await this.istekYaz(this.o.istekDizini, komut, { exe: this.ad, sebep });
      this.log(`${komut} isteği bırakıldı (köprü Mac'ten çeker): ${yol}`);
    } catch (e) { this.log(`${komut} isteği YAZILAMADI: ${e.message}`); }
  }

  async tetik() {
    if (this.o.tetik) await this.istek('exe-create', 'yeniden deneme');
    else this.log(`TETİK — Mac'te ŞİMDİ çalıştır: ${I.KOMUTLAR['exe-create'].join(' ')}`);
  }

  async yuvaDurumuLogla() {
    if (!fs.existsSync(this.o.yuva)) { this.log('yuvada kalan (hizli-kontrol): dosya yok'); return; }
    this.log('yuvada kalan (hizli-kontrol, bu koşuda ölçülen):');
    try {
      const r = await hizliKontrol(this.o.yuva, this.yerel, { beklenenCn: this.o.beklenenCn });
      for (const s of r.satirlar) this.log(`  ${s}`);
    } catch (e) { this.log(`  hizli-kontrol hata: ${e.message}`); }
  }

  bildir(mesaj) {
    if (this.o.kuru || !fs.existsSync(this.o.bildirIkili)) { this.log(`bildirim komutu yok/KURU — yalnız logla: ${mesaj}`); return; }
    const [bk, ba] = ikiliKomutu(this.o.bildirIkili, ['onay', mesaj, '-b', 'İmza kuyruğu', '-p', 'yuksek', '-e', 'warning']);
    const r = spawnSync(bk, ba, { encoding: 'utf8', timeout: 20000 });
    this.log(r.status === 0 ? `bildirim gönderildi: ${mesaj}` : `bildirim HATA (yine de çıkış 3 kalır): ${r.error ? r.error.message : r.status}`);
  }

  /** TEK deneme. 0 başarı · 3 tavan. 2/4 fırlatır. */
  async deneme(tavanSn) {
    if (!(await this.ayniMi(this.hazir))) hata(2, `hazırlık yok ya da yerelle aynı değil: ${this.hazir} (önce: hazirla)`);
    const bas = Date.now();
    let asama = 'pencere';
    const taban = iz(this.o.yuva);
    let onceki = taban;
    let red = '';
    let tP = null;
    let tT = null;
    let gecen = 0;
    const L = (m) => this.log(`[${asama} +${gecen}s] ${m}`);
    this.log(`başlangıç: yuva izi ${taban} · tavan ${tavanSn} sn (bu deneme) · aralık ${this.o.aralikMs / 1000} sn`);
    if (await this.ayniMi(this.o.yuva)) { this.log('yuvada zaten bizim dosya — imza aşamasına geçiliyor'); asama = 'imza'; } else this.log('PENCERE BEKLENİYOR — exe-create tetiği şimdi çekilebilir');
    for (;;) {
      gecen = Math.floor((Date.now() - bas) / 1000);
      if (Date.now() - bas > tavanSn * 1000) {
        this.log(`tavan aşıldı (${tavanSn} sn, bu denemede), aşama: ${asama}, yuva: ${iz(this.o.yuva)}`);
        return 3;
      }
      let simdi = iz(this.o.yuva);
      if (asama === 'pencere') {
        if (simdi === taban) L(`yuva ${simdi} — değişim yok`);
        else if (simdi === 'yok') L('yuva boş (exe-create boşalttı?)');
        else if (simdi !== onceki) L(`yuva değişti: ${simdi} — kararlılık bekleniyor`);
        else {
          tP = gecen;
          L(`PENCERE: İmpark dosyası yuvada (${simdi}) — takas`);
          if (!(await this.takas())) hata(4, `takas 3 denemede doğrulanamadı — yuvayı elle kontrol et: ${this.o.yuva}`);
          tT = Math.floor((Date.now() - bas) / 1000);
          asama = 'imza';
          simdi = iz(this.o.yuva);
          this.log(`takas tamam (+${tT}s) — imza bekleniyor`);
        }
      } else {
        const b = simdi === 'yok' ? 0 : Number(simdi.split('/')[0]);
        if (simdi === 'yok') L('yuva boş');
        else if (b <= this.yerelBoyut) L(`yuva ${simdi} — imza bekleniyor`);
        else if (simdi !== onceki) L(`boyut büyüdü: ${simdi} — kararlılık bekleniyor`);
        else if (simdi === red) L(`yuva ${simdi} — reddedildi, değişim bekleniyor`);
        else {
          L(`imzalı aday (+${b - this.yerelBoyut} B) — yerele kopyalanıyor`);
          await fsp.mkdir(this.imzaliDizin, { recursive: true });
          const yk = path.join(this.imzaliDizin, `${path.basename(this.ad, path.extname(this.ad))}-imzali.exe`);
          try { await fsp.copyFile(this.o.yuva, `${yk}.part`); } catch (e) { hata(4, `imzalı dosya yerele kopyalanamadı: ${e.message}`); }
          let rc = 5;
          if (iz(this.o.yuva) === simdi) rc = await this.imzaDogrula(`${yk}.part`);
          if (rc === 0) { await fsp.rename(`${yk}.part`, yk); this.log(`sha256 ${await sha(yk)}`); }
          if (rc === 0) {
            this.log(`İMZALI: ${yk}`);
            this.log(`  boyut ${this.yerelBoyut} → ${b} B (+${b - this.yerelBoyut} B)`);
            this.log(`  süre (bu koşuda, gözcü başından): pencere +${tP === null ? '?' : tP}s · takas +${tT === null ? '?' : tT}s · imza +${gecen}s`);
            return 0;
          }
          if (rc === 4) hata(4, 'yuvadaki imzalı dosya bizim exe\'miz değil / imzacı yanlış (pencere kaçtı?)');
          if (rc === 5) L('kopya sırasında yuva değişti — yeniden');
          else red = simdi;
        }
      }
      onceki = simdi;
      await bekle(this.o.aralikMs);
    }
  }

  async bekleVeTak() {
    let rc = await this.deneme(this.o.tavanSn);
    if (rc !== 3) return rc;
    this.log(`1. deneme tavanı doldu (${this.o.tavanSn} sn) — YENİDEN DENEME başlıyor (2. deneme tavanı ${this.o.tavan2Sn} sn)`);
    await this.yuvaDurumuLogla();
    await this.istek('exe-remove', '1. deneme tavanı');
    await this.hazirla();
    await this.tetik();
    rc = await this.deneme(this.o.tavan2Sn);
    if (rc === 3) {
      this.log(`2. deneme de tavanı doldu (${this.o.tavan2Sn} sn) — imza kuyruğu 2 denemede de imzalamadı`);
      await this.yuvaDurumuLogla();
      this.bildir(`${this.ad}: ${YUVA_ID} imza kuyruğu 2 denemede imzalamadı — İmpark'tan düzeltme talebi`);
      hata(3, `imza kuyruğu 2 denemede de tavanı doldurdu (${this.ad})`);
    }
    return rc;
  }
}

function bayraklariAyristir(argv) {
  const b = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--kuru') b.kuru = true;
    else if (a === '--tavan-dk' || a === '--tavan2-dk') {
      const v = argv[i + 1];
      if (!/^\d+$/.test(String(v || ''))) hata(2, `${a} tamsayı olmalı`);
      b[a === '--tavan-dk' ? 'tavanDk' : 'tavan2Dk'] = Number(v);
      i += 1;
    } else hata(2, `bilinmeyen seçenek: ${a}`);
  }
  return b;
}

/** CLI. @returns {Promise<number>} çıkış kodu */
async function ana(argv, { env = process.env, platform = process.platform, out = console.log, err = console.error, bag = {} } = {}) {
  const log = (m) => out(`${saat()} ${m}`);
  try {
    const [komut, a, b] = argv;
    if (komut === 'hizli-kontrol') {
      if (!a || !fs.existsSync(a)) hata(2, `dosya yok: ${a || ''}`);
      if (b && !fs.existsSync(b)) hata(2, `orijinal yok: ${b}`);
      const r = await hizliKontrol(a, b, { beklenenCn: env.IMZA_BEKLENEN_CN || 'İm Park Bilişim' });
      r.satirlar.forEach((s) => out(s));
      return r.kod;
    }
    if (!['hazirla', 'bekle-ve-tak'].includes(komut)) {
      err('kullanım: imza-yuva-win.js hazirla|bekle-ve-tak <yerel.exe> [--kuru] | hizli-kontrol <yol> [<orijinal>]');
      return 2;
    }
    const bayrak = bayraklariAyristir(argv.slice(2));
    if (!a || !fs.existsSync(a)) hata(2, `dosya yok: ${a || ''}`);
    const o = ayarlar(env, bayrak, platform);
    log(o.kuru ? `KURU KİP — sahte kök: ${o.kok}` : `CANLI KİP — yuva: ${o.yuva}`);
    const g = new Gozcu(o, a, { log, ...bag });
    await g.hedef();
    if (komut === 'hazirla') await g.hazirla();
    else return await g.bekleVeTak();
    return 0;
  } catch (e) {
    if (e instanceof CikisHatasi) { err(`${saat()} HATA: ${e.message}`); return e.kod; }
    err(`${saat()} HATA: ${e && e.stack}`);
    return 4;
  }
}

module.exports = {
  YUVA_ID, UNC_KOK, HAZIR_KANIT, CikisHatasi, smbMi, ayarlar, hizliKontrol, blokImzaciIceriyor, blokZamanDamgasi, maskele,
  Gozcu, ana,
};

if (require.main === module) {
  ana(process.argv.slice(2)).then((k) => { process.exitCode = k; });
}
