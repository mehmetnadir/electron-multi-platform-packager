'use strict';

/**
 * WINDOWS ŞERİDİ — runner'da sözleşmeli NSIS paketinin yayın öncesi zinciri (2026-09-26).
 *
 * Sözleşme: `.claude/docs/windows-paketleme-sozlesmesi.md` [ONAYLI], "Toplu üretim ve imza akışı":
 * 1 Üret → 2 Yükle `_hazir` → 3 İmzala (sıralı, kuyruk kilidi) → 4 İndir + doğrula → 5 Yayınla.
 * Kanıt: `~/.empp-agent/arastirma/e2e-kanit-windows-20260926.md` — A1: runner Windows işini hiç
 * almıyordu; A2: `EMPP_RUNNER_WINDOWS=1` açılsaydı runner İMZASIZ NSIS'i R2'ye yükleyecekti
 * (`processJob` paketleyici → indir → kabul → postResultSuccess).
 *
 * KURAL — imzasız yayın yolu YOK. `yayinOncesiZincir` tek bir yayın dosyası döndürür: İmpark imza
 * yuvasından (66902, `scripts/imza-yuva-smb.sh`) dönmüş, Authenticode'u `osslsigncode verify` ile
 * (imzacı İm Park Bilişim, zincir + CRL + zaman damgası) geçmiş, gövdesi üretilen exe ile bayt bayt
 * aynı kopya. Herhangi bir adım düşerse FIRLATIR; runner R2'ye hiçbir şey yazmadan düşer. İmzayı
 * kapatan bir anahtar/ortam değişkeni YOKTUR (bilerek).
 *
 * Sıra (her adım bir öncekinin kanıtı olmadan başlamaz):
 *   0. ön koşul (indirmeden ÖNCE): claim'de `surum` = 2.<panel kodu>.<paket sayacı> (madde 1),
 *      kimlik = book_id, `guncellemeTabani` https, imza betiği + osslsigncode + kapı var.
 *   1. statik kapı `scripts/windows-paket-kapisi.js` — 0 FAIL; 13 (G), 14 (K), 15 (kurulum dizinine
 *      yazma) PASS; ÖLÇÜLEMEDİ yalnız 3/5 (sıkıştırılmış NSIS metni). Kök index.html sha256'sı ölçülür.
 *   2. kabul (imzasız) — RED olan imzaya gitmez. Kapı: windows-kasa (gerçek Windows: kur → aç →
 *      her kitap → ilk sayfa + thumbnail → kaldır; `windows-kasa-kabul.js`) erişilebilirse o,
 *      erişilemezse bugünkü Mac başsız kabulü (yedek). 02.10, Nadir: "windows kasa'yı kabul kapısı
 *      olarak kullanmıyor musun?"
 *   3. `_hazir`'a yükleme (`hazirla`, kilitsiz: yuvaya dokunmaz).
 *   4. imza (`bekle-ve-tak`, bekleme kuralı betikte: 180 dk + yuva temizliği + 60 dk + bildirim) —
 *      imza kuyruğu tek yuvalı: makine geneli flock kilidi + elle koşan betik süreci beklenir.
 *   5. imzalı kopya yerelde: PE güvenlik dizini EOF'ta, gövde eşit, `osslsigncode verify`, md5.
 *   6. kabul (imzalı, aynı kapı seçimi) — sözleşme adım 4 "ikisi de geçmeden yayına çıkmaz".
 *   7. iş kanıtı `~/.empp-agent/windows-kanit/<id>/<surum>.json` (md5, kök index, sürüm).
 *
 * G (güncelleme) kanalı: runner G set dosyalarını HİÇBİR YERE yüklemez — G manifestlerinin tek
 * yazarı `g-yayin` aracıdır (Şef kararı, Nadir onayı 26.09). Runner yalnız g-yayin'in ilk
 * manifesti (`--ilk`) için gereken iki şeyi kanıta yazar: paket içindeki kök index.html'in
 * yolu + sha256'sı ve paket sürümü.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { basliksizKabulKapisi } = require('./basliksiz-kabul-kapisi');
const kasaKabul = require('./windows-kasa-kabul');
const hazir = require('./windows-hazir');
const authenticode = require('./authenticode-win');
const imzaIstek = require('./imza-istek');

const ISARET = '[windows-serit]';
/** İmza eşiği (runner imzayı beklemeden paketi hazır kuyruğa alır) hata işareti. */
const IMZA_ESIK_ISARETI = '[imza-esik]';

/** İmza eşiği aşıldı hatası: yayın YOK, paket kusuru DEĞİL — çağıran hazır kuyruğa alır. */
function imzaEsigiHatasi(sebep) {
  const e = new Error(`${ISARET} ${IMZA_ESIK_ISARETI} ${sebep} — imzasız paket R2'ye YAZILMADI`);
  e.imzaEsigi = true;
  return e;
}
const imzaEsigiMi = (e) => Boolean(e && e.imzaEsigi);
const YUVA_ID = '66902';
const SURUM_DESENI = /^2\.\d+\.\d+$/;
const KAPI_ZORUNLU_PASS = { 13: 'G güncelleme kanalı', 14: 'K içerik kanalı', 15: 'kurulum dizinine yazma yok' };
const KAPI_IZINLI_OLCULEMEDI = [3, 5];
const KAPI_DURUMLARI = ['PASS', 'FAIL', 'ÖLÇÜLEMEDİ', 'RAPOR'];
const KOK_INDEX_YOLU = 'resources/app/index.html';
const REPO_KOKU = path.join(__dirname, '..', '..');
const CANLI_YUVA_KOKU = path.join(os.homedir(), 'Impark', 'Storage7', 'vhosts',
  'akillitahta.ydspublishing.com', 'httpdocs', 'Uploads', 'KitapTekExe');
// windows-kasa (win32): Storage7 172.17.2.23'te (impark-diskler.sh SHARES; .21 Storage1-2'dir).
const WIN_YUVA_KOKU = '\\\\172.17.2.23\\Storage7\\vhosts\\akillitahta.ydspublishing.com\\httpdocs\\Uploads\\KitapTekExe';

/** Runner CONFIG'ine eklenen şerit ayarları. Testler CONFIG alanlarını doğrudan ezer. */
function varsayilanAyarlar(platform = process.platform, env = process.env) {
  const ev = path.join(os.homedir(), '.empp-agent');
  const agir = path.join(ev, 'agir.sh');
  // windows-kasa: imza gözcüsü Node (imza-yuva-win.js), tetik/temizlik İSTEK DOSYASI (yayincilikadm
  // panel oturumu Mac'te; köprü tools/windows/imza-tetik-koprusu.js), doğrulama Get-AuthenticodeSignature.
  const win = platform === 'win32';
  return {
    winImzaBetigi: win ? path.join(__dirname, 'imza-yuva-win.js') : path.join(REPO_KOKU, 'scripts', 'imza-yuva-smb.sh'),
    winImzaKabuk: win ? process.execPath : 'bash',
    // KAPI (win32): yuva kökü YALNIZ açıkça verilirse (EMPP_IMZA_YUVA_KOKU, kanonik değer WIN_YUVA_KOKU).
    // Mac runner aynı tek yuvayı besliyor ve kilit makine başına — iki makine arası yuva kilidi
    // kurulmadan kasa yuvaya yazarsa takaslar çakışır. Boş kök = erişilemez → 'hazir' kipi (bugünkü).
    winImzaYuvaKoku: win ? (env.EMPP_IMZA_YUVA_KOKU || '') : CANLI_YUVA_KOKU,
    winImzaIstekDizini: win ? imzaIstek.varsayilanIstekDizini(env) : '', // boş = yayincilikadm'ı kendisi çağırır
    winImzaDogrulama: win ? 'authenticode' : 'osslsigncode',
    winImzaYuvaSunucu: '172.17.2.21', // İmpark Storage7; boş = ping atlanır
    winImzaTetik: ['yayincilikadm', 'book', 'exe-create', YUVA_ID, '--wait', '0'],
    winImzaYuvaTemizle: ['yayincilikadm', 'book', 'exe-remove', '--windows', '--yes', YUVA_ID],
    winImzaKilit: path.join(ev, 'imza-yuva.kilit'),
    winImzaYabanciDesen: win ? '' : 'imza-yuva-smb\\.sh (bekle-ve-tak|toplu)',
    winImzaKilitBeklemeMs: 6 * 3600 * 1000,
    winImzaKilitAralikMs: 60 * 1000,
    winImzaHazirlaTimeoutMs: 3 * 3600 * 1000,
    // Bekleme kuralı betikte (180 + 60 dk + yeniden hazırlama). Bu dış tavan yalnız asılı kalmış
    // betiğe karşı emniyettir; kuralı kısaltmaz.
    winImzaTimeoutMs: 5 * 3600 * 1000,
    winOsslsigncode: 'osslsigncode',
    winImzaBeklenenImzaci: 'İm Park Bilişim',
    winKapiBetigi: path.join(REPO_KOKU, 'scripts', 'windows-paket-kapisi.js'),
    winKapiTimeoutMs: 45 * 60 * 1000,
    winKabulCli: null, // null = tools/kabul/basliksiz-kabul.js (yedek kapı)
    ...kasaKabul.kasaAyarlari(),
    ...hazir.hazirAyarlari(),
    winAgirSh: fs.existsSync(agir) ? agir : '',
    winKanitDizini: path.join(ev, 'windows-kanit'),
  };
}

// ---------------------------------------------------------------------------
// Saf kararlar
// ---------------------------------------------------------------------------

/**
 * Ön koşul — kaynak İNDİRİLMEDEN önce. Sözleşme madde 1: sürüm `2.<panel kodu>.<paket sayacı>`;
 * panel kodu İmpark panelinden gelir (exe adındaki vNN DEĞİL: 59835 exe v50, panel v51), runner
 * türetemez → claim taşımalı. Kimlik = book_id (elle alan yok). Saf.
 * @returns {{surum:string, setKimligi:string, guncellemeTabani:string}}
 */
function onKosul(job) {
  const bookId = String(job && job.bookId != null ? job.bookId : '').trim();
  if (!bookId) throw new Error(`${ISARET} claim bookId taşımıyor — üretim BAŞLAMADI`);
  const hamSurum = job.surum != null ? job.surum : job.appVersion;
  const surum = String(hamSurum == null ? '' : hamSurum).trim();
  if (!SURUM_DESENI.test(surum)) {
    throw new Error(`${ISARET} sözleşme madde 1: claim'de Windows sürümü `
      + `(2.<panel kodu>.<paket sayacı>) yok ya da biçimi yanlış ("${surum}") — üretim BAŞLAMADI`);
  }
  if (job.setKimligi != null && String(job.setKimligi).trim() !== bookId) {
    throw new Error(`${ISARET} kimlik = book_id (sözleşme): claim setKimligi "${job.setKimligi}" `
      + `≠ bookId "${bookId}" — üretim BAŞLAMADI`);
  }
  const taban = String(job.guncellemeTabani || '').trim();
  if (!/^https:\/\/[^\s/]+/.test(taban)) {
    throw new Error(`${ISARET} claim guncellemeTabani https değil ("${taban}") — G istemcisi `
      + 'enjekte edilemez, kapı madde 13 geçemez; üretim BAŞLAMADI');
  }
  return { surum, setKimligi: bookId, guncellemeTabani: taban };
}

/** İmza yuvasındaki (`_hazir`/`_imzali`) ad: runner'a ait olduğu görünsün, elle akışla çakışmasın. */
function imzaDosyaAdi(bookId, appName, surum) {
  const ad = String(appName || 'book').replace(/[^A-Za-z0-9._()-]+/g, '-').replace(/-+/g, '-');
  return `runner-${bookId}-${ad}-${surum}-Setup.exe`;
}

/** Kapı (`--json --tut`) çıktısından JSON gövdesini ve tutulan çıkarım dizinini ayıklar. Saf. */
function kapiCiktisiniAyristir(metin) {
  const ham = String(metin || '');
  const m = /^Çıkarım:\s*(.+?)\s*$/m.exec(ham);
  const satirlar = ham.split('\n');
  const bas = satirlar.indexOf('{');
  let son = -1;
  for (let i = satirlar.length - 1; i > bas; i -= 1) {
    if (satirlar[i] === '}') { son = i; break; }
  }
  let sonuc = null;
  if (bas >= 0 && son > bas) {
    try { sonuc = JSON.parse(satirlar.slice(bas, son + 1).join('\n')); } catch (_) { sonuc = null; }
  }
  return { sonuc, cikarimDizini: m ? m[1] : null };
}

/**
 * Kapı hükmü. Geçme: hiç FAIL yok; 13/14/15 PASS; ÖLÇÜLEMEDİ yalnız 3 ve 5 (NSIS metni
 * sıkıştırılmış — kanıt raporu adım 4). Okunamayan çıktı = RED (ölçemediğini PASS sayma). Saf.
 */
function kapiKarari(sonuc) {
  const maddeler = sonuc && Array.isArray(sonuc.maddeler) ? sonuc.maddeler : [];
  if (!maddeler.length) return { gecti: false, sebep: 'kapı çıktısı okunamadı (JSON yok)', ozet: 'okunamadı' };
  const say = (d) => maddeler.filter((x) => x && x.durum === d).length;
  const ozet = `${say('PASS')} PASS · ${say('FAIL')} FAIL · ${say('ÖLÇÜLEMEDİ')} ÖLÇÜLEMEDİ · ${say('RAPOR')} RAPOR`;
  const kisa = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').slice(0, 160);
  const sorunlar = [];
  const durum = new Map();
  for (const x of maddeler) {
    const no = Number(x && x.no);
    durum.set(no, x && x.durum);
    if (!KAPI_DURUMLARI.includes(x && x.durum)) sorunlar.push(`madde ${no}: bilinmeyen durum "${x && x.durum}"`);
    else if (x.durum === 'FAIL') sorunlar.push(`madde ${no} FAIL: ${kisa(x.detay)}`);
    else if (x.durum === 'ÖLÇÜLEMEDİ' && !KAPI_IZINLI_OLCULEMEDI.includes(no)) {
      sorunlar.push(`madde ${no} ÖLÇÜLEMEDİ: ${kisa(x.detay)}`);
    }
  }
  for (const [no, ad] of Object.entries(KAPI_ZORUNLU_PASS)) {
    const d = durum.get(Number(no));
    if (d !== 'PASS' && d !== 'FAIL') sorunlar.push(`madde ${no} (${ad}) PASS değil: ${d || 'YOK'}`);
  }
  return { gecti: sorunlar.length === 0, sebep: sorunlar.join('; '), ozet };
}

/**
 * `osslsigncode verify` hükmü: çıkış 0 + "Signature verification: ok" + CRL ok + "Succeeded" +
 * zaman damgası + özet eşit + birincil imzacının CN'i beklenen (İm Park Bilişim). Saf.
 * @returns {{gecti:boolean, sebep:string, imzaci:string|null, zamanDamgasi:string|null}}
 */
function imzaDogrulamaKarari(r, beklenenImzaci) {
  const cikti = String((r && r.cikti) || '');
  const imzaciM = /Signer's certificate:[\s\S]*?Subject:\s*CN=((?:\\,|[^,\n])+)/.exec(cikti);
  const imzaci = imzaciM ? imzaciM[1].replace(/\\,/g, ',').trim() : null;
  const zamanM = /^\s*Timestamp time:\s*(.+?)\s*$/m.exec(cikti);
  const zamanDamgasi = zamanM ? zamanM[1] : null;
  const sonuc = (gecti, sebep) => ({ gecti, sebep, imzaci, zamanDamgasi });
  if (!r || r.hata) return sonuc(false, `osslsigncode başlatılamadı: ${(r && r.hata) || 'sonuç yok'}`);
  if (r.zamanAsimi) return sonuc(false, 'osslsigncode zaman aşımı');
  if (r.kod !== 0) {
    const ilk = cikti.split('\n').find((s) => /error|fail|invalid/i.test(s)) || '';
    return sonuc(false, `osslsigncode çıkış ${r.kod}: ${ilk.trim().slice(0, 160)}`);
  }
  if (!/^Signature verification: ok\s*$/m.test(cikti)) return sonuc(false, '"Signature verification: ok" yok');
  if (!/^Signature CRL verification: ok\s*$/m.test(cikti)) return sonuc(false, 'CRL doğrulaması yok/başarısız');
  if (!/^Succeeded\s*$/m.test(cikti)) return sonuc(false, '"Succeeded" yok');
  const guncel = /Current message digest\s*:\s*([0-9A-F]+)/i.exec(cikti);
  const hesap = /Calculated message digest\s*:\s*([0-9A-F]+)/i.exec(cikti);
  if (!guncel || !hesap || guncel[1].toUpperCase() !== hesap[1].toUpperCase()) {
    return sonuc(false, 'Authenticode özeti eşleşmiyor ya da okunamadı');
  }
  if (!zamanDamgasi) return sonuc(false, 'zaman damgası (countersignature) yok');
  if (!imzaci || !imzaci.includes(beklenenImzaci)) {
    return sonuc(false, `imzacı beklenen "${beklenenImzaci}" değil: ${imzaci || 'okunamadı'}`);
  }
  return sonuc(true, 'ok');
}

/**
 * PE başlığından (ilk 4 KB) CheckSum ve güvenlik dizini girdisinin konumları. Saf.
 * (imza-yuva-smb.sh `ofsb` ile aynı ölçüt.) @returns {{checksum:number, dizin:number}|null}
 */
function peKonumlari(baslik) {
  if (!baslik || baslik.length < 0x40 || baslik[0] !== 0x4d || baslik[1] !== 0x5a) return null;
  const e = baslik.readUInt32LE(0x3c);
  if (e + 24 + 2 > baslik.length || baslik.toString('latin1', e, e + 4) !== 'PE\0\0') return null;
  const magic = baslik.readUInt16LE(e + 24);
  const dd = magic === 0x10b ? 96 : (magic === 0x20b ? 112 : null);
  if (dd === null || e + 24 + dd + 40 > baslik.length) return null;
  return { checksum: e + 88, dizin: e + 24 + dd + 32 };
}

/** Güvenlik dizini (ofset, boyut). Saf. */
function peImzaDizini(baslik) {
  const k = peKonumlari(baslik);
  if (!k) return null;
  return { ofset: baslik.readUInt32LE(k.dizin), boyut: baslik.readUInt32LE(k.dizin + 4) };
}

// ---------------------------------------------------------------------------
// Süreç / dosya yardımcıları
// ---------------------------------------------------------------------------

/** Süreç grubu olarak koşturur; zaman aşımında grubu öldürür. Asla fırlatmaz. */
function komutKos(argv, { env = {}, zamanAsimiMs = 0, satir = () => {}, cwd, yumusak = null } = {}) {
  return new Promise((coz) => {
    let bitti = false;
    const bitir = (v) => { if (!bitti) { bitti = true; coz(v); } };
    let cocuk;
    try {
      cocuk = spawn(argv[0], argv.slice(1), {
        cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      bitir({ kod: -1, hata: e.message, cikti: '', zamanAsimi: false });
      return;
    }
    let cikti = '';
    let tampon = '';
    const isle = (d) => {
      const s = d.toString();
      cikti += s;
      tampon += s;
      const parcalar = tampon.split('\n');
      tampon = parcalar.pop();
      for (const p of parcalar) if (p.trim()) satir(p);
    };
    cocuk.stdout.on('data', isle);
    cocuk.stderr.on('data', isle);
    let zamanAsimi = false;
    // Yumuşak kesme (imza eşiği): `yumusak.ms` dolunca, `yumusak.uygun()` doğru olduğu ilk anda
    // grup öldürülür (uygun değilse — ör. yuva takası sürerken — beklenir, asla yarıda kesilmez).
    let yumusakKesildi = false;
    let yumusakT = null;
    if (yumusak && yumusak.ms > 0) {
      const kontrol = () => {
        if (bitti) return;
        if (yumusak.uygun()) {
          yumusakKesildi = true;
          try { process.kill(-cocuk.pid, 'SIGKILL'); } catch (_) { /* ölü */ }
          return;
        }
        yumusakT = setTimeout(kontrol, yumusak.aralikMs || 1000);
      };
      yumusakT = setTimeout(kontrol, yumusak.ms);
    }
    const t = zamanAsimiMs > 0 ? setTimeout(() => {
      zamanAsimi = true;
      try { process.kill(-cocuk.pid, 'SIGKILL'); } catch (_) { /* ölü */ }
    }, zamanAsimiMs) : null;
    cocuk.on('error', (e) => { if (t) clearTimeout(t); if (yumusakT) clearTimeout(yumusakT); bitir({ kod: -1, hata: e.message, cikti, zamanAsimi }); });
    cocuk.on('close', (kod) => {
      if (t) clearTimeout(t);
      if (yumusakT) clearTimeout(yumusakT);
      if (tampon.trim()) satir(tampon);
      bitir({ kod: kod == null ? -1 : kod, cikti, zamanAsimi, yumusakKesildi });
    });
  });
}

/** md5 + sha256 + boyut (akışla). */
function ozetHesapla(dosya) {
  return new Promise((coz, red) => {
    const md5 = crypto.createHash('md5');
    const sha = crypto.createHash('sha256');
    let boyut = 0;
    fs.createReadStream(dosya, { highWaterMark: 8 << 20 })
      .on('data', (d) => { md5.update(d); sha.update(d); boyut += d.length; })
      .on('error', red)
      .on('end', () => coz({ md5: md5.digest('hex'), sha256: sha.digest('hex'), boyut }));
  });
}

async function ilkBaytlar(dosya, n) {
  const fh = await fsp.open(dosya, 'r');
  try {
    const b = Buffer.alloc(n);
    const { bytesRead } = await fh.read(b, 0, n, 0);
    return b.subarray(0, bytesRead);
  } finally { await fh.close(); }
}

/**
 * İmzalı dosya BİZİM exe'mizin imzalanmış hâli mi? (imza-yuva-smb.sh `govde` + `hizli` ölçütleri,
 * tam okuma): başlık (CheckSum + güvenlik dizini girdisi maskeli) ve gövde bayt bayt eşit; imza
 * bloğu orijinalin ≤7 bayt sonrasında (8 bayt hizalama, aradaki baytlar sıfır), dosya sonunda
 * bitiyor ve WIN_CERTIFICATE türü PKCS#7.
 * @returns {Promise<{esit:boolean, sebep:string}>}
 */
async function govdeEsitMi(imzasiz, imzali) {
  const n = (await fsp.stat(imzasiz)).size;
  const m = (await fsp.stat(imzali)).size;
  const ha = await ilkBaytlar(imzasiz, 4096);
  const hb = await ilkBaytlar(imzali, 4096);
  const ka = peKonumlari(ha);
  const kb = peKonumlari(hb);
  if (!ka || !kb || ka.checksum !== kb.checksum || ka.dizin !== kb.dizin) return { esit: false, sebep: 'PE başlığı okunamadı ya da farklı' };
  if (m <= n) return { esit: false, sebep: `imzalı (${m} B) orijinalden (${n} B) büyük değil` };
  const dz = peImzaDizini(hb);
  if (!dz.boyut || dz.ofset < n || dz.ofset >= n + 8) return { esit: false, sebep: `imza ofseti ${dz.ofset} orijinal sonuna (${n}) hizalı değil` };
  if (dz.ofset + dz.boyut !== m) return { esit: false, sebep: `imza bloğu dosya sonunda bitmiyor (${dz.ofset}+${dz.boyut} ≠ ${m})` };
  const maske = (h, k) => {
    const c = Buffer.from(h);
    c.fill(0, k.checksum, k.checksum + 4);
    c.fill(0, k.dizin, k.dizin + 8);
    return c;
  };
  const bl = Math.min(ha.length, n);
  if (!maske(ha, ka).subarray(0, bl).equals(maske(hb.subarray(0, bl), kb).subarray(0, bl))) {
    return { esit: false, sebep: 'başlık farklı (CheckSum/güvenlik dizini dışında)' };
  }
  const fa = await fsp.open(imzasiz, 'r');
  const fb = await fsp.open(imzali, 'r');
  try {
    const PARCA = 8 << 20;
    const ba = Buffer.alloc(PARCA);
    const bb = Buffer.alloc(PARCA);
    for (let p = bl; p < n; p += PARCA) {
      const u = Math.min(PARCA, n - p);
      await fa.read(ba, 0, u, p);
      await fb.read(bb, 0, u, p);
      if (!ba.subarray(0, u).equals(bb.subarray(0, u))) return { esit: false, sebep: `gövde ${p}+${u} aralığında farklı` };
    }
    const ara = Buffer.alloc(dz.ofset - n);
    if (ara.length) {
      await fb.read(ara, 0, ara.length, n);
      if (ara.some((x) => x !== 0)) return { esit: false, sebep: 'hizalama baytları sıfır değil' };
    }
    const wc = Buffer.alloc(8);
    await fb.read(wc, 0, 8, dz.ofset);
    const L = wc.readUInt32LE(0);
    if (!(L > 8 && L <= dz.boyut) || wc.readUInt16LE(6) !== 0x0002) return { esit: false, sebep: 'WIN_CERTIFICATE PKCS#7 değil' };
  } finally {
    await fa.close();
    await fb.close();
  }
  return { esit: true, sebep: 'ok' };
}

// ---------------------------------------------------------------------------
// Adımlar
// ---------------------------------------------------------------------------

function kanitYolu(cfg, bookId, surum) {
  return path.join(cfg.winKanitDizini, String(bookId), `${surum}.json`);
}

async function kanitYaz(cfg, kanit) {
  const yol = kanitYolu(cfg, kanit.bookId, kanit.surum);
  await fsp.mkdir(path.dirname(yol), { recursive: true });
  const gecici = `${yol}.tmp-${process.pid}`;
  await fsp.writeFile(gecici, `${JSON.stringify({ ...kanit, guncelleme: new Date().toISOString() }, null, 2)}\n`);
  await fsp.rename(gecici, yol);
  return yol;
}

/** Araçlar var mı + imza yuvası erişilir mi (üretim BAŞLAMADAN). Fırlatır. */
async function araclariDenetle(cfg, { yuva = true } = {}) {
  const eksik = [];
  if (!fs.existsSync(cfg.winKapiBetigi)) eksik.push(`kapı betiği yok: ${cfg.winKapiBetigi}`);
  // "imza bekliyor" kipinde (yuva yok, sözleşme §2a) imza araçları bu işte KULLANILMAZ — imzayı
  // sonra bekçi atar; burada aranmaz ki yuva kapalıyken üretim araç yüzünden durmasın.
  if (yuva) {
    if (!fs.existsSync(cfg.winImzaBetigi)) eksik.push(`imza betiği yok: ${cfg.winImzaBetigi}`);
    if (cfg.winImzaDogrulama !== 'authenticode') {
      const ossl = await komutKos(process.platform === 'win32' ? ['where', cfg.winOsslsigncode]
        : ['/bin/sh', '-c', 'command -v "$1"', 'sh', cfg.winOsslsigncode], { zamanAsimiMs: 10000 });
      if (ossl.kod !== 0) eksik.push(`osslsigncode bulunamadı: ${cfg.winOsslsigncode}`);
    }
    if (!(await imzaYuvasiErisilirMi(cfg))) eksik.push(`imza yuvası erişilemiyor (İmpark VPN / Storage7): ${cfg.winImzaYuvaKoku}`);
  }
  if (eksik.length) throw new Error(`${ISARET} ön koşul: ${eksik.join('; ')} — üretim BAŞLAMADI`);
}

/**
 * İmza kipi (sözleşme exesiz-kaynak §2a, Nadir 02.10): yuva erişilirse 'yuva' (bugünkü zincir
 * aynen); erişilemezse ve hazır kuyruk açıksa 'hazir' (üret → kabul → imzasız paket hazır kuyruğa,
 * yayın YOK); hazır kuyruk kapalıysa 'yuva' döner ve araclariDenetle eskisi gibi düşürür.
 * @returns {Promise<{kip:'yuva'|'hazir', sebep:string}>}
 */
async function imzaKipiSec(cfg) {
  if (await imzaYuvasiErisilirMi(cfg)) return { kip: 'yuva', sebep: 'imza yuvası erişilir' };
  if (cfg.winHazirAcik) {
    return { kip: 'hazir', sebep: `imza yuvası erişilemiyor (İmpark VPN / Storage7: ${cfg.winImzaYuvaKoku})` };
  }
  return { kip: 'yuva', sebep: 'imza yuvası erişilemiyor, hazır kuyruk KAPALI (EMPP_WIN_IMZA_BEKLEME=0)' };
}

/**
 * Yuva probu komutları. Saf. Windows (windows-kasa ajanı, 2026-10-02): `ping -n/-w` ve dizin
 * denetimi Node ile (`/bin/test` yok) — SMB stat asılabileceği için yine ayrı süreç + zaman aşımı.
 * macOS/Linux komutları AYNEN.
 */
function yuvaProbKomutlari(cfg, platform = process.platform, node = process.execPath) {
  const k = [];
  if (cfg.winImzaYuvaSunucu) {
    k.push(platform === 'win32'
      ? ['ping', '-n', '1', '-w', '2000', cfg.winImzaYuvaSunucu]
      : ['ping', '-c', '1', '-W', '2000', cfg.winImzaYuvaSunucu]);
  }
  k.push(platform === 'win32'
    ? [node, '-e', 'process.exit(require("fs").statSync(process.argv[1]).isDirectory()?0:1)', cfg.winImzaYuvaKoku]
    : ['/bin/test', '-d', cfg.winImzaYuvaKoku]);
  // 04.10: dizinin VARLIĞI kanıt değil — Storage7 düşükken ~/Impark/... yerel diskte kalır (45540
  // yerel sahte yuvada saatlerce bekledi). macOS/Linux'ta kök gerçekten SMB bağlamasında mı (df kaynağı //…).
  if (platform !== 'win32') {
    k.push(['/bin/sh', '-c', 'df -P "$1" | tail -1 | grep -q "^//"', 'sh', cfg.winImzaYuvaKoku]);
  }
  return k;
}

/** İmpark sunucusu ping'e cevap veriyor ve yuva kökü görünüyor mu (sınırlı süreli, asılmaz). */
async function imzaYuvasiErisilirMi(cfg) {
  if (!cfg.winImzaYuvaKoku) return false; // win32 kapısı: kök verilmedi
  const komutlar = yuvaProbKomutlari(cfg);
  for (let i = 0; i < komutlar.length; i += 1) {
    const son = i === komutlar.length - 1;
    const r = await komutKos(komutlar[i], { zamanAsimiMs: son ? 8000 : 5000 });
    if (r.kod !== 0) return false;
  }
  return true;
}

/** Statik kapı + kök index ölçümü. RED → fırlatır. */
async function kapiKos({ exe, work, cfg, log, bookId }) {
  const tmp = path.join(work, 'kapi-tmp');
  await fsp.mkdir(tmp, { recursive: true });
  const temel = [process.execPath, cfg.winKapiBetigi, exe, '--json', '--tut'];
  const argv = cfg.winAgirSh ? [cfg.winAgirSh, `rwin-kapi-${bookId}`, ...temel] : temel;
  log('windows: statik kapı başlıyor (madde 13 G dahil) —', path.basename(cfg.winKapiBetigi));
  const r = await komutKos(argv, { env: { TMPDIR: tmp }, zamanAsimiMs: cfg.winKapiTimeoutMs });
  if (r.hata || r.zamanAsimi) {
    throw new Error(`${ISARET} statik kapı koşamadı (${r.hata || 'zaman aşımı'}) — R2'ye YAZILMADI`);
  }
  const { sonuc, cikarimDizini } = kapiCiktisiniAyristir(r.cikti);
  const karar = kapiKarari(sonuc);
  log(`windows: statik kapı — ${karar.ozet} (çıkış ${r.kod})`);
  if (!karar.gecti) {
    throw new Error(`${ISARET} statik kapı RED — ${karar.sebep}; imzaya GÖNDERİLMEDİ, R2'ye YAZILMADI`);
  }
  const indexYolu = cikarimDizini ? path.join(cikarimDizini, 'app', ...KOK_INDEX_YOLU.split('/')) : null;
  if (!indexYolu || !fs.existsSync(indexYolu)) {
    throw new Error(`${ISARET} paket içinde kök ${KOK_INDEX_YOLU} ölçülemedi (çıkarım: ${cikarimDizini || 'yok'}) `
      + '— g-yayin ilk manifesti için gerekli; R2\'ye YAZILMADI');
  }
  const oz = await ozetHesapla(indexYolu);
  return {
    karar,
    maddeler: sonuc.maddeler.map((x) => ({ no: x.no, durum: x.durum })),
    kokIndex: { yol: KOK_INDEX_YOLU, sha256: oz.sha256, boyut: oz.boyut },
  };
}

/**
 * Kabul — Windows şeridinde ZORUNLU (bayraktan bağımsız). Önce windows-kasa (gerçek Windows);
 * kasa erişilemez/kullanılamazsa Mac başsız kabulü. KALDI/RED → fırlatır (failed); ÖLÇÜLEMEDİ →
 * ertelenebilir işaretli fırlatır (failed yazılmaz, kira bırakılır).
 * @returns {Promise<{kapi:'kasa'|'basliksiz', kanitDizini?:string, sebep?:string}>}
 */
async function kabulKos({ exe, job, work, cfg, log, aktivasyon, etiket, sleep }) {
  const kasa = await kasaKabul.kasaKabulKapisi({
    exe, bookId: job.bookId, etiket, baslik: job.bookTitle || String(job.bookId), aktivasyon, cfg, log, sleep,
  });
  if (kasa.kullanildi) return { kapi: 'kasa', kanitDizini: kasa.kanitDizini };
  log(`windows: windows-kasa kabulü kullanılamıyor (${kasa.sebep}) — Mac başsız kabul kapısına düşülüyor [${etiket}]`);
  await basliksizKabul({ exe, job, work, cfg, log, aktivasyon, etiket });
  return { kapi: 'basliksiz', sebep: kasa.sebep };
}

/** Bugünkü (02.10 öncesi tek) kapı: Mac'te başsız kabul. RED/ÖLÇÜLEMEDİ → fırlatır. */
async function basliksizKabul({ exe, job, work, cfg, log, aktivasyon, etiket }) {
  const env = { ...process.env, EMPP_BASLIKSIZ_KABUL: '1', EMPP_BASLIKSIZ_KABUL_PLATFORMLAR: 'windows' };
  const calismaDizini = path.join(work, `kabul-${etiket}`);
  await fsp.mkdir(calismaDizini, { recursive: true });
  const calistir = (argumanlar, { zamanAsimiMs, env: e, satir }) => {
    const temel = [process.execPath, ...argumanlar];
    const argv = cfg.winAgirSh ? [cfg.winAgirSh, `rwin-kabul-${job.bookId}-${etiket}`, ...temel] : temel;
    return komutKos(argv, { env: e, zamanAsimiMs, satir });
  };
  await basliksizKabulKapisi({
    artifactPath: exe, platform: 'windows', bookId: job.bookId, aktivasyon, calismaDizini, log, env, calistir,
    ...(cfg.winKabulCli ? { cli: cfg.winKabulCli } : {}),
  });
}

const PERL_KILIT = 'open(my $f, ">>", $ARGV[0]) or exit 74; flock($f, LOCK_EX | LOCK_NB) or exit 75; '
  + '$| = 1; print "KILIT-ALINDI\\n"; 1 while <STDIN>; exit 0;';

/**
 * win32 kilidi (perl/flock yok): O_EXCL kilit dosyası {pid, zaman}. Sahibi ölmüşse (pid yok) bayat sayılır,
 * kenara taşınır (silme yok) ve bir kez yeniden denenir. Dolu → {kod: 75} (perl ile aynı sözleşme).
 */
async function dosyaKilidiDene(yol, { pidYasiyor = pidCanliMi } = {}) {
  for (let deneme = 0; deneme < 2; deneme += 1) {
    try {
      const fh = await fsp.open(yol, 'wx');
      await fh.writeFile(JSON.stringify({ pid: process.pid, zaman: new Date().toISOString() }));
      await fh.close();
      return { tutucu: { dosyaKilidi: yol } };
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return { kod: 74, hata: (e && e.message) || String(e) };
    }
    let sahip = null;
    try { sahip = JSON.parse(await fsp.readFile(yol, 'utf8')); } catch (_) { sahip = null; }
    if (sahip && pidYasiyor(sahip.pid)) return { kod: 75 };
    try { await fsp.rename(yol, `${yol}.bayat-${Date.now()}`); } catch (_) { /* yarış: başkası aldı */ }
  }
  return { kod: 75 };
}

function pidCanliMi(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return Boolean(e && e.code === 'EPERM'); }
}

/** flock tutucu süreç: runner ölünce stdin kapanır, kilit kendiliğinden boşalır. win32: dosya kilidi. */
function kilitDene(yol) {
  if (process.platform === 'win32') return dosyaKilidiDene(yol);
  return new Promise((coz) => {
    let bitti = false;
    const c = spawn('/usr/bin/perl', ['-MFcntl=:flock', '-e', PERL_KILIT, yol], { stdio: ['pipe', 'pipe', 'ignore'] });
    c.stdin.on('error', () => {});
    c.stdout.on('data', (d) => {
      if (!bitti && d.toString().includes('KILIT-ALINDI')) { bitti = true; coz({ tutucu: c }); }
    });
    c.on('exit', (kod) => { if (!bitti) { bitti = true; coz({ kod }); } });
    c.on('error', (e) => { if (!bitti) { bitti = true; coz({ kod: -1, hata: e.message }); } });
  });
}

function kilitBirak(c) {
  if (c && c.dosyaKilidi) {
    return fsp.rename(c.dosyaKilidi, `${c.dosyaKilidi}.birakildi`).catch(() => {});
  }
  return new Promise((coz) => {
    if (c.exitCode !== null || c.signalCode !== null) { coz(); return; }
    const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch (_) { /* ölü */ } coz(); }, 5000);
    c.on('exit', () => { clearTimeout(t); coz(); });
    c.stdin.end();
  });
}

async function yabanciImzaSurecleri(desen) {
  if (!desen || process.platform === 'win32') return []; // win32: elle akış yok, tek yol kilitli gözcü
  const r = await komutKos(['pgrep', '-f', desen], { zamanAsimiMs: 10000 });
  return r.kod === 0 ? r.cikti.split('\n').map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * İmza kuyruğu kilidi (tek yuva, sıralı). Önce makine geneli flock, sonra kilidi kullanmayan
 * elle akış (imzala.sh / betiğin kendisi) beklenir. Tavan dolarsa fırlatır.
 * @returns {Promise<() => Promise<void>>} bırak
 */
async function imzaKilidiAl(cfg, { log, sleep, esikBitisMs = 0 }) {
  const bitis = Date.now() + cfg.winImzaKilitBeklemeMs;
  // Eşik: kilit/yabancı süreç beklemesi eşiği aşarsa paket hazır kuyruğa alınır (kilit alınmadan
  // çıkılır → yuvaya HİÇ dokunulmamış olur).
  const esikAsildi = () => esikBitisMs > 0 && Date.now() > esikBitisMs;
  await fsp.mkdir(path.dirname(cfg.winImzaKilit), { recursive: true });
  let tutucu = null;
  let ilk = true;
  while (!tutucu) {
    const r = await kilitDene(cfg.winImzaKilit);
    if (r.tutucu) { tutucu = r.tutucu; break; }
    if (r.kod !== 75) throw new Error(`${ISARET} imza kilidi açılamadı (perl çıkış ${r.kod}${r.hata ? `, ${r.hata}` : ''})`);
    if (ilk) { log('windows: imza kuyruğu kilidi dolu (başka iş imzada) — sıra bekleniyor'); ilk = false; }
    if (esikAsildi()) throw imzaEsigiHatasi('imza kuyruğu kilidi eşik süresinde boşalmadı (başka iş imzada)');
    if (Date.now() > bitis) throw new Error(`${ISARET} imza kuyruğu kilidi ${Math.round(cfg.winImzaKilitBeklemeMs / 60000)} dk boşalmadı — R2'ye YAZILMADI`);
    await sleep(cfg.winImzaKilitAralikMs);
  }
  const birak = () => kilitBirak(tutucu);
  try {
    for (let ilkY = true; ; ilkY = false) {
      const yabanci = await yabanciImzaSurecleri(cfg.winImzaYabanciDesen);
      if (!yabanci.length) break;
      if (ilkY) log(`windows: yuvayı elle koşan imza süreci var (pid ${yabanci.join(',')}) — bekleniyor`);
      if (esikAsildi()) throw imzaEsigiHatasi('yuva elle koşan imza sürecinden eşik süresinde boşalmadı');
      if (Date.now() > bitis) throw new Error(`${ISARET} yuva elle koşan imza sürecinden boşalmadı — R2'ye YAZILMADI`);
      await sleep(cfg.winImzaKilitAralikMs);
    }
  } catch (e) {
    await birak();
    throw e;
  }
  return birak;
}

function tetikCek(cfg, work, log, exe) {
  if (cfg.winImzaIstekDizini) {
    try {
      const yol = imzaIstek.istekYazSenkron(cfg.winImzaIstekDizini, 'exe-create', { exe });
      log('windows: imza tetiği İSTEK olarak bırakıldı (Mac köprüsü exe-create çeker):', yol);
    } catch (e) { log('windows: imza tetiği isteği yazılamadı:', e.message); }
    return;
  }
  try {
    const fd = fs.openSync(path.join(work, 'imza-tetik.log'), 'a');
    const p = spawn(cfg.winImzaTetik[0], cfg.winImzaTetik.slice(1), { detached: true, stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    p.on('error', (e) => log('windows: imza tetiği başlatılamadı (betik 1. deneme tavanında yeniden tetikler):', e.message));
    p.unref();
    log('windows: imza tetiği çekildi:', cfg.winImzaTetik.join(' '));
  } catch (e) {
    log('windows: imza tetiği çekilemedi:', e.message);
  }
}

function imzaEnv(work, cfg = {}) {
  const e = { SMB_SHA: '0', TETIK: '1', IMZALI_DIZIN: path.join(work, 'imzali') };
  if (cfg.winImzaIstekDizini) {
    e.EMPP_IMZA_ISTEK_DIZINI = cfg.winImzaIstekDizini;
    e.EMPP_IMZA_YUVA_KOKU = cfg.winImzaYuvaKoku;
  }
  return e;
}

/** Toplu akış 2: `_hazir`'a kopyala + geri oku (yuvaya dokunmaz → kilitsiz). */
async function imzaHazirla({ exe, work, cfg, log, esikBitisMs = 0 }) {
  log('windows: imza hazırlığı (_hazir kopyası + geri okuma) —', path.basename(exe));
  // Eşik: hazırlık yuvaya dokunmaz (yalnız _hazir kopyası) → eşikte kesmek güvenlidir.
  const kalan = esikBitisMs > 0 ? Math.max(1000, esikBitisMs - Date.now()) : 0;
  const sure = kalan > 0 ? Math.min(cfg.winImzaHazirlaTimeoutMs, kalan) : cfg.winImzaHazirlaTimeoutMs;
  const r = await komutKos([cfg.winImzaKabuk, cfg.winImzaBetigi, 'hazirla', exe], {
    env: imzaEnv(work, cfg), zamanAsimiMs: sure, satir: (s) => log('  [imza]', s),
  });
  if (r.zamanAsimi && kalan > 0 && kalan < cfg.winImzaHazirlaTimeoutMs) {
    throw imzaEsigiHatasi('_hazir kopyası eşik süresinde bitmedi');
  }
  if (r.hata || r.zamanAsimi || r.kod !== 0) {
    throw new Error(`${ISARET} imza hazırlığı (_hazir) düştü: ${r.hata || (r.zamanAsimi ? 'zaman aşımı' : `çıkış ${r.kod}`)} — R2'ye YAZILMADI`);
  }
}

/** Toplu akış 3: pencere → takas → imza (bekleme kuralı betikte). İmzalı yerel kopyanın yolu. */
async function imzaBekleVeTak({ exe, work, cfg, log, esikBitisMs = 0 }) {
  let tetik = false;
  // Takas başladıysa (yuvada bizim dosyamız imzada) betik ASLA yarıda kesilmez: tek yuva paylaşımlı,
  // yarım takas ya da imzadaki dosya sonraki işi bozar. Eşik yalnız pencere beklenirken geçerlidir.
  let takasBasladi = false;
  const satir = (s) => {
    log('  [imza]', s);
    if (!tetik && s.includes('PENCERE BEKLENİYOR')) { tetik = true; tetikCek(cfg, work, log, exe); }
    if (!takasBasladi && /PENCERE: |takas \d\/3/.test(s)) takasBasladi = true;
  };
  const r = await komutKos([cfg.winImzaKabuk, cfg.winImzaBetigi, 'bekle-ve-tak', exe], {
    env: imzaEnv(work, cfg), zamanAsimiMs: cfg.winImzaTimeoutMs, satir,
    yumusak: esikBitisMs > 0
      ? { ms: Math.max(1, esikBitisMs - Date.now()), uygun: () => !takasBasladi, aralikMs: 1000 } : null,
  });
  if (r.yumusakKesildi) throw imzaEsigiHatasi('imza yuvası penceresi eşik süresinde açılmadı (takas başlamadan bırakıldı)');
  if (r.hata) throw new Error(`${ISARET} imza betiği başlatılamadı: ${r.hata} — R2'ye YAZILMADI`);
  if (r.zamanAsimi) {
    throw new Error(`${ISARET} imza zaman aşımı (${Math.round(cfg.winImzaTimeoutMs / 60000)} dk) — `
      + "imzasız paket R2'ye YAZILMADI");
  }
  if (r.kod === 3) {
    throw new Error(`${ISARET} imza kuyruğu 2 denemede imzalamadı (bekleme kuralı) — imzasız paket R2'ye YAZILMADI`);
  }
  if (r.kod !== 0) {
    throw new Error(`${ISARET} imza adımı çıkış ${r.kod} (4: takas/imza kimliği) — R2'ye YAZILMADI`);
  }
  const imzali = path.join(imzaEnv(work, cfg).IMZALI_DIZIN, `${path.basename(exe, '.exe')}-imzali.exe`);
  if (!fs.existsSync(imzali)) throw new Error(`${ISARET} imza betiği başarı dedi ama imzalı kopya yok: ${imzali}`);
  return imzali;
}

/**
 * Yuvadaki imzalıyı `_imzali/`'ye taşı + yuvayı temizle (toplu akış 3'ün son adımı). Yayın yerel,
 * doğrulanmış kopyadan yapıldığı için BURADAKİ hata işi düşürmez; loglanır.
 */
async function yuvayiArsivle({ exe, cfg, log }) {
  const yuva = path.join(cfg.winImzaYuvaKoku, YUVA_ID, 'windows.exe');
  const hk = await komutKos([cfg.winImzaKabuk, cfg.winImzaBetigi, 'hizli-kontrol', yuva, exe], { zamanAsimiMs: 10 * 60000 });
  if (hk.kod === 0) {
    try {
      const hedef = path.join(cfg.winImzaYuvaKoku, '_imzali', path.basename(exe));
      await fsp.mkdir(path.dirname(hedef), { recursive: true });
      await fsp.rename(yuva, hedef);
      log('windows: yuvadaki imzalı →', hedef);
    } catch (e) { log('windows: UYARI yuva _imzali/\'ye taşınamadı:', e.message); }
  } else {
    log(`windows: UYARI yuva son hızlı kontrolü çıkış ${hk.kod} — _imzali/'ye taşınmadı (yayın yerel doğrulanmış kopyadan)`);
  }
  if (cfg.winImzaIstekDizini) {
    try {
      const yol = await imzaIstek.istekYaz(cfg.winImzaIstekDizini, 'exe-remove', { exe, sebep: 'imzalı arşivlendi' });
      log('windows: yuva temizliği İSTEK olarak bırakıldı (Mac köprüsü exe-remove çeker):', yol);
    } catch (e) { log('windows: UYARI yuva temizliği isteği yazılamadı:', e.message); }
    return;
  }
  const t = await komutKos(cfg.winImzaYuvaTemizle, { zamanAsimiMs: 5 * 60000 });
  if (t.kod !== 0) log(`windows: UYARI yuva temizliği çıkış ${t.kod}: ${String(t.hata || t.cikti).trim().slice(-160)}`);
}

/** Toplu akış 4: imzalı yerel kopya — PE, gövde, Authenticode, md5. Geçmezse FIRLATIR. */
async function imzaDogrula({ imzasiz, imzali, cfg, log }) {
  const dz = peImzaDizini(await ilkBaytlar(imzali, 4096));
  const boyut = (await fsp.stat(imzali)).size;
  if (!dz || !dz.boyut || dz.ofset + dz.boyut !== boyut) {
    throw new Error(`${ISARET} imzalı kopyada Authenticode bloğu yok ya da dosya sonunda değil — R2'ye YAZILMADI`);
  }
  const g = await govdeEsitMi(imzasiz, imzali);
  if (!g.esit) throw new Error(`${ISARET} imzalı dosya bizim exe'miz değil (${g.sebep}) — R2'ye YAZILMADI`);
  const karar = cfg.winImzaDogrulama === 'authenticode'
    ? await authenticode.authenticodeDogrula(imzali, { komutKos, beklenenImzaci: cfg.winImzaBeklenenImzaci })
    : imzaDogrulamaKarari(await komutKos([cfg.winOsslsigncode, 'verify', '-in', imzali], { zamanAsimiMs: 10 * 60000 }),
      cfg.winImzaBeklenenImzaci);
  if (!karar.gecti) {
    throw new Error(`${ISARET} Authenticode doğrulaması BAŞARISIZ — ${karar.sebep}; R2'ye YAZILMADI`);
  }
  const oz = await ozetHesapla(imzali);
  log(`windows: imza doğrulandı — imzacı ${karar.imzaci}, zaman damgası ${karar.zamanDamgasi}, md5 ${oz.md5}`);
  return { ...oz, imzaci: karar.imzaci, zamanDamgasi: karar.zamanDamgasi };
}

/**
 * Yayın öncesi zincirin tamamı. Dönen `imzaliYol` şeridin TEK yayın dosyasıdır.
 * @returns {Promise<{imzaliYol:string, kanit:object, kanitYolu:string}>}
 */
async function yayinOncesiZincir({ artifactPath, job, plan, work, jobId, cfg, log, sleep, aktivasyon, imzaKipi, r2Hedef }) {
  const bekle = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const kanit = {
    bookId: String(job.bookId), bookTitle: job.bookTitle || null, surum: plan.surum,
    setKimligi: plan.setKimligi, paketleyiciJobId: jobId || null, durum: 'uretildi',
    baslangic: new Date().toISOString(),
  };
  kanit.imzasiz = await ozetHesapla(artifactPath);
  log(`windows: üretilen ${path.basename(artifactPath)} ${kanit.imzasiz.boyut} B, md5 ${kanit.imzasiz.md5}`);

  const kapi = await kapiKos({ exe: artifactPath, work, cfg, log, bookId: job.bookId });
  kanit.kapi = { ozet: kapi.karar.ozet, maddeler: kapi.maddeler };
  kanit.kokIndex = kapi.kokIndex;

  const k1 = await kabulKos({ exe: artifactPath, job, work, cfg, log, aktivasyon, etiket: 'imzasiz', sleep: bekle });
  kanit.kabulImzasiz = 'GECTI';
  kanit.kabulImzasizKapi = k1.kapi;
  if (k1.kanitDizini) kanit.kabulImzasizKanit = k1.kanitDizini;

  // İMZA BEKLİYOR (§2a): imzasız paket hazır kuyruğa; yayın YOK, imzalı dosya YOK.
  const hazirdaTut = async (sebep) => {
    const hedef = typeof r2Hedef === 'function' ? await r2Hedef() : r2Hedef;
    const h = await hazir.hazirKoy({
      exe: artifactPath, job, surum: plan.surum, kanit, cfg, kabul: k1, r2Hedef: hedef, sebep,
    });
    kanit.durum = hazir.IMZA_BEKLIYOR_FAZI;
    kanit.hazirDizini = h.dizin;
    const yol = await kanitYaz(cfg, kanit);
    log(`windows: İMZA BEKLİYOR — imzasız paket hazır kuyrukta (${h.dizin}); R2'ye YAZILMADI, `
      + 'imza bekçisi yuva açılınca imzalatıp yayınlar');
    return { hazir: h, kanit, kanitYolu: yol, sebep };
  };
  if (imzaKipi === 'hazir') return hazirdaTut('imza yuvası erişilemiyor');

  // Yuva açık: imza eşiği (varsayılan 5 dk, EMPP_WIN_IMZA_ESIK_DK; 0 = eski: sonuna kadar bekle).
  // Aşılırsa runner imzayı beklemez — paket hazır kuyruğa, iş imza-bekliyor.
  const esikMs = cfg.winHazirAcik ? Number(cfg.winImzaEsikMs) || 0 : 0;
  try {
    return await imzaliYayinZinciri({ imzasiz: artifactPath, job, work, cfg, log, sleep: bekle, aktivasyon, kanit, esikMs });
  } catch (e) {
    if (!imzaEsigiMi(e)) throw e;
    log(`windows: imza eşiği aşıldı (${Math.round(esikMs / 60000)} dk) — ${e.message}`);
    return hazirdaTut(`imza ${Math.round(esikMs / 60000)} dk içinde tamamlanmadı: ${e.message.replace(/^.*\[imza-esik\] /, '').slice(0, 160)}`);
  }
}

/**
 * İmza → doğrulama → imzalı kabul (yayın öncesi zincirin ikinci yarısı). Runner (yuva açık) ve imza
 * bekçisi (hazır kuyruk) AYNI fonksiyonu kullanır — ikinci bir imza yolu YOK. `kanit` yerinde
 * tamamlanır ve diske yazılır. Düşerse FIRLATIR (R2'ye hiçbir şey yazılmamıştır).
 * @returns {Promise<{imzaliYol:string, kanit:object, kanitYolu:string}>}
 */
async function imzaliYayinZinciri({ imzasiz, job, work, cfg, log, sleep, aktivasyon, kanit, esikMs = 0 }) {
  const bekle = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  // esikMs > 0 (yalnız runner): imza adımı (hazırlık + kilit + pencere) bu süreyi aşarsa
  // `imzaEsigiHatasi` fırlar — çağıran paketi hazır kuyruğa alır. Takas başladıktan sonra eşik YOK.
  const esikBitisMs = esikMs > 0 ? Date.now() + esikMs : 0;
  await imzaHazirla({ exe: imzasiz, work, cfg, log, esikBitisMs });
  const birak = await imzaKilidiAl(cfg, { log, sleep: bekle, esikBitisMs });
  let imzaliYol;
  try {
    imzaliYol = await imzaBekleVeTak({ exe: imzasiz, work, cfg, log, esikBitisMs });
    await yuvayiArsivle({ exe: imzasiz, cfg, log });
  } finally {
    await birak();
  }

  kanit.imzali = await imzaDogrula({ imzasiz, imzali: imzaliYol, cfg, log });
  const k2 = await kabulKos({ exe: imzaliYol, job, work, cfg, log, aktivasyon, etiket: 'imzali', sleep: bekle });
  kanit.kabulImzali = 'GECTI';
  kanit.kabulImzaliKapi = k2.kapi;
  if (k2.kanitDizini) kanit.kabulImzaliKanit = k2.kanitDizini;
  kanit.durum = 'imzali-dogrulandi';
  const yol = await kanitYaz(cfg, kanit);
  log('windows: iş kanıtı (md5 + kök index + sürüm) →', yol);
  return { imzaliYol, kanit, kanitYolu: yol };
}

/** Yayın sonrası kanıt: R2 anahtarı. Kanıt yazılamasa bile yayın geri alınmaz — loglanır. */
async function yayinKaniti(zincir, yayin, cfg, log) {
  try {
    zincir.kanit.durum = 'yayinlandi';
    zincir.kanit.r2ObjectKey = (yayin && yayin.r2ObjectKey) || null;
    zincir.kanit.publicUrl = (yayin && yayin.publicUrl) || null;
    zincir.kanit.yayin = new Date().toISOString();
    await kanitYaz(cfg, zincir.kanit);
  } catch (e) {
    log('windows: UYARI yayın kanıtı yazılamadı:', e.message);
  }
}

/** `bildir bekci` — şerit düştüğünde (EMPP_BILDIRIM=0 kapatır). Asla fırlatmaz. */
async function bekciBildir({ bookId, bookTitle, hata }, log) {
  if (process.env.EMPP_BILDIRIM === '0') return;
  const ikili = process.env.EMPP_BILDIR_IKILI || path.join(os.homedir(), '.local', 'bin', 'bildir');
  const mesaj = `${bookTitle || bookId} (${bookId}) Windows şeridi düştü, R2'ye yazılmadı: `
    + `${String((hata && hata.message) || hata).slice(0, 300)}`;
  const r = await komutKos([ikili, 'bekci', mesaj, '-b', 'Windows şeridi düştü', '-p', 'yuksek', '-e', 'warning'],
    { zamanAsimiMs: 20000 });
  if (r.kod !== 0) log('windows: bekçi bildirimi gönderilemedi:', r.hata || `çıkış ${r.kod}`);
}

module.exports = {
  ISARET, YUVA_ID, SURUM_DESENI, KAPI_ZORUNLU_PASS, KAPI_IZINLI_OLCULEMEDI, KOK_INDEX_YOLU,
  varsayilanAyarlar, onKosul, imzaDosyaAdi, kapiCiktisiniAyristir, kapiKarari, imzaDogrulamaKarari,
  peKonumlari, peImzaDizini, komutKos, ozetHesapla, govdeEsitMi, araclariDenetle, imzaYuvasiErisilirMi, imzaKipiSec,
  yuvaProbKomutlari,
  imzaliYayinZinciri, kanitYaz, IMZA_ESIK_ISARETI, imzaEsigiHatasi, imzaEsigiMi,
  kapiKos, kabulKos, basliksizKabul, imzaKilidiAl, kilitDene, kilitBirak, dosyaKilidiDene, tetikCek, imzaEnv, WIN_YUVA_KOKU, imzaHazirla, imzaBekleVeTak, yuvayiArsivle, imzaDogrula,
  yayinOncesiZincir, yayinKaniti, kanitYolu, bekciBildir,
};
