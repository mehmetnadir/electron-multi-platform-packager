'use strict';
/**
 * Paket bayt okuyucuları — aynı denetim kodu yerel dosyada da CDN nesnesinde de koşsun diye.
 *   yerelOkuyucu(yol)        → fs.readSync
 *   uzakOkuyucu(url)         → HEAD (boyut/etag) + HTTP Range; TAM İNDİRME YAPMAZ.
 *                              Sunucu Range'i yok sayarsa (200) yalnız baştan okuma kabul edilir ve
 *                              gereken bayt gelince bağlantı kesilir; ortadan okuma reddedilir.
 *   indir(url, hedef)        → akışla diske + md5 (yalnız `--indir` ile).
 * `indirilen` sayacı raporda "tam indirme yapılmadı" kanıtıdır.
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const UA = 'empp-e2e-saglik/1 (+electron-multi-platform-packager)';

function yerelOkuyucu(yol) {
  const boyut = fs.statSync(yol).size;
  return {
    tur: 'yerel',
    kaynak: yol,
    boyut,
    indirilen: 0,
    async oku(bas, uzunluk) {
      const n = Math.max(0, Math.min(uzunluk, boyut - bas));
      const t = Buffer.alloc(n);
      if (!n) return t;
      const fd = fs.openSync(yol, 'r');
      try {
        fs.readSync(fd, t, 0, n, bas);
      } finally {
        fs.closeSync(fd);
      }
      return t;
    },
  };
}

/**
 * Tek HTTP isteği. `azami` bayttan fazla gövde gelirse bağlantı kesilir (tam indirme koruması).
 * @returns {Promise<{status:number, headers:Object, govde:Buffer, kesildi:boolean, url:string}>}
 */
function istek(
  url,
  { method = 'GET', headers = {}, azami = 0, zamanAsimiMs = 30000, yonlendirme = 3 } = {},
) {
  return new Promise((coz, reddet) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      reddet(new Error(`geçersiz URL: ${url}`));
      return;
    }
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, { method, headers: { 'User-Agent': UA, ...headers } }, (res) => {
      const st = res.statusCode;
      if ([301, 302, 303, 307, 308].includes(st) && res.headers.location && yonlendirme > 0) {
        res.resume();
        const sonraki = new URL(res.headers.location, u).toString();
        istek(sonraki, { method, headers, azami, zamanAsimiMs, yonlendirme: yonlendirme - 1 }).then(
          coz,
          reddet,
        );
        return;
      }
      const parcalar = [];
      let toplam = 0;
      let kesildi = false;
      res.on('data', (p) => {
        if (kesildi) return;
        parcalar.push(p);
        toplam += p.length;
        if (azami && toplam >= azami) {
          kesildi = true;
          res.destroy();
          req.destroy();
          coz({
            status: st,
            headers: res.headers,
            govde: Buffer.concat(parcalar).subarray(0, azami),
            kesildi,
            url,
          });
        }
      });
      res.on('end', () => {
        if (!kesildi)
          coz({ status: st, headers: res.headers, govde: Buffer.concat(parcalar), kesildi, url });
      });
      res.on('error', (e) => {
        if (!kesildi) reddet(e);
      });
    });
    req.setTimeout(zamanAsimiMs, () => req.destroy(new Error(`zaman aşımı ${zamanAsimiMs} ms`)));
    req.on('error', (e) => reddet(e));
    req.end();
  });
}

/** CDN nesnesi için HEAD + Range okuyucu. */
async function uzakOkuyucu(url, { zamanAsimiMs = 30000 } = {}) {
  const h = await istek(url, { method: 'HEAD', zamanAsimiMs });
  const bas = {
    status: h.status,
    boyut: h.headers['content-length'] != null ? Number(h.headers['content-length']) : null,
    etag: h.headers.etag || null,
    son_degisiklik: h.headers['last-modified'] || null,
    icerik_turu: h.headers['content-type'] || null,
    range: h.headers['accept-ranges'] || null,
    cf_mitigated: h.headers['cf-mitigated'] || null,
    url: h.url,
  };
  const okuyucu = {
    tur: 'uzak',
    kaynak: url,
    boyut: bas.boyut,
    bas,
    indirilen: 0,
    istekSayisi: 1,
    async oku(ilk, uzunluk) {
      if (!Number.isFinite(okuyucu.boyut))
        throw new Error('boyut bilinmiyor (HEAD content-length yok)');
      const n = Math.max(0, Math.min(uzunluk, okuyucu.boyut - ilk));
      if (!n) return Buffer.alloc(0);
      const r = await istek(url, {
        headers: { Range: `bytes=${ilk}-${ilk + n - 1}` },
        azami: n,
        zamanAsimiMs,
      });
      okuyucu.istekSayisi += 1;
      okuyucu.indirilen += r.govde.length;
      if (r.status === 206) return r.govde;
      if (r.status === 200 && ilk === 0) return r.govde.subarray(0, n); // Range yok sayıldı, erken kesildi
      if (r.status === 200)
        throw new Error('sunucu Range desteklemiyor — ortadan okuma için tam indirme gerekir');
      throw new Error(`Range isteği HTTP ${r.status}`);
    },
  };
  return okuyucu;
}

/** Tam indirme (yalnız --indir): akışla diske, md5 ile. */
function indir(url, hedef, { zamanAsimiMs = 60000 } = {}) {
  return new Promise((coz, reddet) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.get(u, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reddet(new Error(`indirme HTTP ${res.statusCode}`));
        return;
      }
      const h = crypto.createHash('md5');
      let boyut = 0;
      const yaz = fs.createWriteStream(hedef);
      res.on('data', (p) => {
        h.update(p);
        boyut += p.length;
      });
      res.pipe(yaz);
      yaz.on('finish', () => coz({ md5: h.digest('hex'), boyut, yol: hedef }));
      yaz.on('error', reddet);
      res.on('error', reddet);
    });
    req.setTimeout(zamanAsimiMs, () => req.destroy(new Error(`zaman aşımı ${zamanAsimiMs} ms`)));
    req.on('error', reddet);
  });
}

module.exports = { yerelOkuyucu, uzakOkuyucu, istek, indir, UA };
