'use strict';
/**
 * İMPARK OKUYUCU ÇIKARICI — .impark (AppImage = ELF + squashfs) içindeki `resources/app.asar`'tan
 * YALNIZ okuyucu sürümü ölçümüne gereken dosyaları çıkarır; paket ya da asar diske AÇILMAZ (06.10).
 *
 * NEDEN: pardus paketi 0,7-1,6 GB; içinde tek dosya `resources/app.asar` (ölçüldü: New Prestige
 * 1,73 GB, Shall We 5 Set 1,73 GB). `paket-cikar.js pardusAc` asar'ı TAM açar (diske 1,7 GB). Kapı
 * ise birkaç küçük dosya ister (index.html, kapak/index.html, `<h20>*.js` ...). Burada 7z asar'ı
 * stdout'a AKITIR (`7z x -so`), akış ayrıştırılır: önce asar başlığı (JSON dizin), sonra yalnız
 * gereken bayt aralıkları belleğe alınır; son aralık gelince 7z durdurulur. Disk yükü: yalnız seçilen
 * dosyalar (KB'lar). Süre (ölçüldü 06.10, Mac M-serisi, 7zz 1,73 GB tam akış): ≤ 7,7 sn.
 *
 * KENDİ KENDİNE YETER: yalnız Node yerleşikleri. ProBook'a `ssh … node - <kip> …` ile stdin'den
 * gönderilip orada koşturulabilir (uzak kip: paket ProBook'ta, Mac'e taşınmaz). Seçim tanımı
 * (hangi dosya gerekli) ÇAĞIRANDAN gelir (`okuyucu-surumu-kapisi.js asarGerekliMi`) — burada kopya YOK.
 *
 * asar biçimi: [0..8) pickle{uint32 başlık-boyu B}; [8..8+B) pickle{uint32 uzunluk, JSON}; veri tabanı
 * 8+B; dosya {size, offset(string)} veri tabanına göre; `unpacked` olan asar'ın DIŞINDADIR.
 *
 * Komut satırı (uzak kip gövdesi; stdout JSON):
 *   node impark-okuyucu-cikar.js baslik <paket> [--yediz <7z>]          → {dosyalar:[rel], dizinler:[rel]}
 *   node impark-okuyucu-cikar.js cikar <paket> <base64(JSON [rel])> [--yediz <7z>]
 *                                                                       → {dosyalar:{rel: base64}, eksik:[rel]}
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ASAR_ICYOLU = 'resources/app.asar';

/** asar başlık JSON'undan dosya ve dizin listesi (kök-göreli POSIX). Saf. */
function basliktanListe(baslik) {
  const dosyalar = [];
  const dizinler = [];
  const gez = (dugum, onek) => {
    for (const [ad, d] of Object.entries((dugum && dugum.files) || {})) {
      const rel = onek ? `${onek}/${ad}` : ad;
      if (d && d.files) {
        dizinler.push(rel);
        gez(d, rel);
      } else if (d && !d.link) {
        dosyalar.push({
          rel,
          size: Number(d.size) || 0,
          offset: d.offset != null ? Number(d.offset) : null,
          unpacked: Boolean(d.unpacked),
        });
      }
    }
  };
  gez(baslik, '');
  return { dosyalar, dizinler };
}

/**
 * Bir asar AKIŞINI ayrıştırır. `sec(liste)` başlık okununca bir kez çağrılır ve gereken rel'lerin
 * kümesini (Set/Array) döner; boşsa akış hemen bırakılır.
 * @param {import('stream').Readable} akis
 * @param {(liste:{dosyalar:Array, dizinler:string[]}) => Iterable<string>} sec
 * @returns {Promise<{liste:object, dosyalar:Map<string,Buffer>, eksik:string[], okunan:number}>}
 *   `bitir()` çağıranın akışı/süreci durdurması içindir; promise çözülünce akış artık okunmaz.
 */
function asarAkisiniAyristir(akis, sec) {
  return new Promise((coz, reddet) => {
    let bitti = false;
    let tampon = [];
    let tamponBoy = 0;
    let konum = 0; // akıştaki mutlak konum (işlenen bayt)
    let baslikBoyu = null;
    let veriTabani = null;
    let liste = null;
    let araliklar = null; // [{rel, bas, son, buf, dolu}]
    let kalan = 0;
    const dosyalar = new Map();
    const eksik = [];

    const sonuclandir = () => {
      if (bitti) return;
      bitti = true;
      akis.removeListener('data', veri);
      coz({ liste, dosyalar, eksik, okunan: konum });
    };
    const hata = (e) => {
      if (bitti) return;
      bitti = true;
      akis.removeListener('data', veri);
      reddet(e);
    };

    const araliklariKur = () => {
      const istenen = new Set(sec(liste) || []);
      const dizin = new Map(liste.dosyalar.map((d) => [d.rel, d]));
      araliklar = [];
      for (const rel of istenen) {
        const d = dizin.get(rel);
        if (!d || d.unpacked || d.offset == null) { eksik.push(rel); continue; }
        if (d.size === 0) { dosyalar.set(rel, Buffer.alloc(0)); continue; }
        const bas = veriTabani + d.offset;
        araliklar.push({ rel, bas, son: bas + d.size, buf: Buffer.alloc(d.size), dolu: 0 });
      }
      araliklar.sort((a, b) => a.bas - b.bas);
      kalan = araliklar.length;
    };

    const parcaIsle = (parca, parcaBas) => {
      const parcaSon = parcaBas + parca.length;
      for (const a of araliklar) {
        if (a.dolu === a.son - a.bas) continue;
        if (a.bas >= parcaSon) break; // sıralı: sonrakiler de ileride
        if (a.son <= parcaBas) continue;
        const kb = Math.max(a.bas, parcaBas);
        const ks = Math.min(a.son, parcaSon);
        parca.copy(a.buf, kb - a.bas, kb - parcaBas, ks - parcaBas);
        a.dolu += ks - kb;
        if (a.dolu === a.son - a.bas) {
          dosyalar.set(a.rel, a.buf);
          kalan -= 1;
        }
      }
    };

    function veri(parca) {
      if (bitti) return;
      try {
        if (araliklar === null) {
          tampon.push(parca);
          tamponBoy += parca.length;
          const t = Buffer.concat(tampon, tamponBoy);
          tampon = [t];
          if (baslikBoyu === null && t.length >= 8) {
            if (t.readUInt32LE(0) !== 4) throw new Error('asar değil (pickle boyu 4 değil)');
            baslikBoyu = t.readUInt32LE(4);
            if (baslikBoyu < 8 || baslikBoyu > 256 * 1024 * 1024) throw new Error(`asar başlık boyu akıl dışı: ${baslikBoyu}`);
          }
          if (baslikBoyu === null || t.length < 8 + baslikBoyu) return;
          const jsonBoy = t.readUInt32LE(12);
          if (16 + jsonBoy > 8 + baslikBoyu) throw new Error('asar başlık JSON boyu başlığı aşıyor');
          liste = basliktanListe(JSON.parse(t.toString('utf8', 16, 16 + jsonBoy)));
          veriTabani = 8 + baslikBoyu;
          araliklariKur();
          konum = 0;
          tampon = null;
          if (kalan === 0) { konum = t.length; sonuclandir(); return; }
          parcaIsle(t, 0);
          konum = t.length;
        } else {
          parcaIsle(parca, konum);
          konum += parca.length;
        }
        if (kalan === 0) sonuclandir();
      } catch (e) {
        hata(e);
      }
    }

    akis.on('data', veri);
    akis.on('error', hata);
    akis.on('end', () => {
      if (bitti) return;
      if (araliklar === null) {
        hata(new Error(konum || tamponBoy ? 'asar akışı başlık bitmeden kesildi' : 'asar akışı boş (paket açılamadı ya da resources/app.asar yok)'));
        return;
      }
      for (const a of araliklar) if (!dosyalar.has(a.rel)) eksik.push(a.rel);
      sonuclandir();
    });
  });
}

/** 7z adayı (uzak kipte paket-cikar.js yok): verilen ya da PATH'te ilk çalışan. I/O. */
function yedizSec(verilen) {
  if (verilen) return verilen;
  for (const ad of ['7zz', '7z', '7za']) {
    const r = spawnSync(ad, ['i'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (!r.error && r.status === 0) return ad;
  }
  return null;
}

/**
 * Paketin asar akışını açar ve ayrıştırır; iş bitince 7z durdurulur. I/O.
 * @param {{paket:string, sec:Function, yediz?:string|null, zamanAsimiMs?:number}} p
 */
async function paketAsariniAyristir({ paket, sec, yediz = null, zamanAsimiMs = 10 * 60 * 1000 }) {
  const y = yedizSec(yediz);
  if (!y) throw new Error('7z/7zz yok — impark asar akışı açılamadı');
  if (!fs.existsSync(paket)) throw new Error(`paket yok: ${paket}`);
  const cocuk = spawn(y, ['x', '-so', '-y', paket, ASAR_ICYOLU], { stdio: ['ignore', 'pipe', 'pipe'] });
  let hataMetni = '';
  cocuk.stderr.on('data', (d) => { if (hataMetni.length < 4000) hataMetni += d.toString(); });
  const cikis = new Promise((r) => {
    cocuk.on('error', (e) => r({ hata: e }));
    cocuk.on('close', (kod, sinyal) => r({ kod, sinyal }));
  });
  let zamanlayici = null;
  const sure = new Promise((_, reddet) => {
    zamanlayici = setTimeout(() => reddet(new Error(`asar akışı ${Math.round(zamanAsimiMs / 1000)} sn içinde bitmedi`)), zamanAsimiMs);
  });
  const yazilim = new Promise((_, reddet) => {
    cocuk.on('error', (e) => reddet(new Error(`${y} başlatılamadı: ${e.message}`)));
  });
  const ayristirma = asarAkisiniAyristir(cocuk.stdout, sec);
  for (const s of [sure, yazilim, ayristirma]) s.catch(() => { /* yarışı kaybeden sonradan düşebilir */ });
  try {
    const r = await Promise.race([ayristirma, sure, yazilim]);
    return { ...r, yediz: y };
  } catch (e) {
    // 7z'nin kendi hata metni (stderr) çoğu zaman akış bittikten SONRA gelir: kısa bekle.
    await Promise.race([cikis, new Promise((r) => setTimeout(r, 2000))]);
    const ek = hataMetni.trim() ? ` (${path.basename(y)}: ${hataMetni.trim().split('\n').slice(-2).join(' ')})` : '';
    throw new Error(`${e.message}${ek}`);
  } finally {
    clearTimeout(zamanlayici);
    if (cocuk.exitCode === null && cocuk.signalCode === null) {
      try { cocuk.kill('SIGTERM'); } catch (_) { /* bitti */ }
    }
    cocuk.stdout.destroy();
    await Promise.race([cikis, new Promise((r) => setTimeout(r, 5000))]);
  }
}

/** rel güvenli mi (kök dışına çıkmaz). Saf. */
function guvenliRel(rel) {
  const s = String(rel || '');
  return Boolean(s) && !s.startsWith('/') && !/^[A-Za-z]:/.test(s) && !s.split(/[\\/]/).includes('..');
}

/**
 * Seçilen dosyaları ve gereken dizinleri `hedef`e yazar. I/O.
 * @returns {{dosya:number, bayt:number}}
 */
function hedefeYaz(hedef, dosyalar, dizinler) {
  fs.mkdirSync(hedef, { recursive: true });
  let bayt = 0;
  for (const rel of dizinler || []) {
    if (guvenliRel(rel)) fs.mkdirSync(path.join(hedef, ...rel.split('/')), { recursive: true });
  }
  for (const [rel, buf] of dosyalar) {
    if (!guvenliRel(rel)) continue;
    const yol = path.join(hedef, ...rel.split('/'));
    fs.mkdirSync(path.dirname(yol), { recursive: true });
    fs.writeFileSync(yol, buf);
    bayt += buf.length;
  }
  return { dosya: dosyalar.size, bayt };
}

/**
 * YEREL: paketten ölçüm ağacını `hedef`e çıkarır.
 * @param {{paket:string, hedef:string, gerekliMi:(rel:string)=>boolean,
 *   dizinGerekliMi?:(rel:string)=>boolean, yediz?:string|null, zamanAsimiMs?:number}} p
 * @returns {Promise<{dosya:number, bayt:number, eksik:string[], okunan:number, yediz:string, yontem:string}>}
 */
async function imparkAgaciCikar(p) {
  const dizGer = p.dizinGerekliMi || (() => false);
  let dizinler = [];
  const r = await paketAsariniAyristir({
    paket: p.paket, yediz: p.yediz, zamanAsimiMs: p.zamanAsimiMs,
    sec: (liste) => {
      dizinler = liste.dizinler.filter(dizGer);
      return liste.dosyalar.map((d) => d.rel).filter(p.gerekliMi);
    },
  });
  const y = hedefeYaz(p.hedef, r.dosyalar, dizinler);
  return { ...y, eksik: r.eksik, okunan: r.okunan, yediz: r.yediz, yontem: 'yerel-akis' };
}

/** Tek tırnaklı kabuk alıntısı. Saf. */
function kabukAlinti(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** Uzak node komutu: verilen yol ya da ~/empp-serit/node/bin/node, yoksa PATH'teki node. Saf. */
function uzakNodeIfadesi(uzakNode) {
  if (uzakNode) return kabukAlinti(uzakNode);
  return '"$( [ -x "$HOME/empp-serit/node/bin/node" ] && echo "$HOME/empp-serit/node/bin/node" || echo node)"';
}

/**
 * Uzakta bu dosyayı `node -` ile koşturur (gövde stdin'den). I/O.
 * @returns {Promise<object>} uzak JSON çıktısı
 */
function uzakKos({ sshArgv, uzakNode, argumanlar, zamanAsimiMs = 10 * 60 * 1000, kaynak }) {
  const komut = `${uzakNodeIfadesi(uzakNode)} - ${argumanlar.map(kabukAlinti).join(' ')}`;
  return new Promise((coz, reddet) => {
    const [ikili, ...arg] = sshArgv;
    const c = spawn(ikili, [...arg, komut], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    const zaman = setTimeout(() => { try { c.kill('SIGTERM'); } catch (_) { /* */ } }, zamanAsimiMs);
    c.stdout.on('data', (d) => out.push(d));
    c.stderr.on('data', (d) => { if (err.length < 4000) err += d.toString(); });
    c.on('error', (e) => { clearTimeout(zaman); reddet(new Error(`${ikili} başlatılamadı: ${e.message}`)); });
    c.on('close', (kod) => {
      clearTimeout(zaman);
      const metin = Buffer.concat(out).toString('utf8').trim();
      let j = null;
      try { j = JSON.parse(metin.split('\n').pop()); } catch (_) { j = null; }
      if (kod !== 0 || !j) {
        const ayr = (j && j.hata) || err.trim().split('\n').slice(-2).join(' ') || metin.slice(-300) || 'çıktı yok';
        reddet(new Error(`uzak çıkarıcı (çıkış ${kod}): ${ayr}`));
        return;
      }
      coz(j);
    });
    c.stdin.on('error', () => { /* uzak erken kapandı: close'ta raporlanır */ });
    c.stdin.end(kaynak || fs.readFileSync(__filename));
  });
}

/**
 * UZAK: paket ProBook'ta; iki geçiş (1: yalnız başlık — akış başlıktan sonra kesilir; 2: seçilenler).
 * Seçim Mac'te yapılır (tanım tek kaynak). @param {{sshArgv:string[], uzakNode?:string, paket:string,
 * hedef:string, gerekliMi:Function, dizinGerekliMi?:Function, zamanAsimiMs?:number}} p
 */
async function uzakImparkAgaciCikar(p) {
  const kaynak = fs.readFileSync(__filename);
  const b = await uzakKos({ ...p, kaynak, argumanlar: ['baslik', p.paket] });
  if (!Array.isArray(b.dosyalar)) throw new Error('uzak başlık listesi biçim dışı');
  const istenen = b.dosyalar.filter(p.gerekliMi);
  const dizinler = (b.dizinler || []).filter(p.dizinGerekliMi || (() => false));
  const c = await uzakKos({
    ...p, kaynak, argumanlar: ['cikar', p.paket, Buffer.from(JSON.stringify(istenen)).toString('base64')],
  });
  const dosyalar = new Map(Object.entries(c.dosyalar || {}).map(([rel, b64]) => [rel, Buffer.from(b64, 'base64')]));
  const y = hedefeYaz(p.hedef, dosyalar, dizinler);
  return { ...y, eksik: c.eksik || [], okunan: c.okunan || null, yediz: c.yediz || null, yontem: 'uzak-akis' };
}

/** CLI (uzak gövde). stdout'a TEK satır JSON. */
async function calis(argv) {
  const yi = argv.indexOf('--yediz');
  const yediz = yi >= 0 ? argv[yi + 1] : null;
  const arg = argv.filter((a, i) => a !== '--yediz' && (yi < 0 || i !== yi + 1));
  const [kip, paket, secim] = arg;
  if (kip === 'baslik' && paket) {
    const r = await paketAsariniAyristir({ paket, yediz, sec: () => [] });
    return { dosyalar: r.liste.dosyalar.map((d) => d.rel), dizinler: r.liste.dizinler, yediz: r.yediz };
  }
  if (kip === 'cikar' && paket && secim) {
    const istenen = JSON.parse(Buffer.from(secim, 'base64').toString('utf8'));
    const r = await paketAsariniAyristir({ paket, yediz, sec: () => istenen });
    const dosyalar = {};
    for (const [rel, buf] of r.dosyalar) dosyalar[rel] = buf.toString('base64');
    return { dosyalar, eksik: r.eksik, okunan: r.okunan, yediz: r.yediz };
  }
  throw new Error('kullanım: impark-okuyucu-cikar.js baslik|cikar <paket> [base64-liste] [--yediz 7z]');
}

module.exports = {
  ASAR_ICYOLU,
  basliktanListe,
  asarAkisiniAyristir,
  paketAsariniAyristir,
  hedefeYaz,
  imparkAgaciCikar,
  uzakImparkAgaciCikar,
  uzakNodeIfadesi,
  kabukAlinti,
  calis,
};

if (require.main === module || __filename === '[stdin]') {
  calis(process.argv.slice(2))
    .then((j) => { process.stdout.write(`${JSON.stringify(j)}\n`); process.exit(0); })
    .catch((e) => { process.stdout.write(`${JSON.stringify({ hata: e.message })}\n`); process.exit(1); });
}
