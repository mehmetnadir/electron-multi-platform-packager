'use strict';
/**
 * BAĞIMLILIKSIZ CDP İSTEMCİSİ — Chrome DevTools Protocol, yalnız Node çekirdeği (http + crypto).
 *
 * NEDEN: ProBook kabul kapısı (tools/pardus/probook-kabul.sh, E6/E7) paketi gerçek Pardus
 * makinesinde açıyor; kitabı açmak ve motorun güncelleme sorusunu dinlemek için uygulamanın
 * `--remote-debugging-port` ucuna bağlanmak gerekiyor. Kapı iki yerde koşar: Mac ajanı (node 24,
 * depoda node_modules var) ve ProBook şeridi (~/empp-serit/node, node 22, node_modules'e
 * güvenilmez). Tek kod yolu olsun diye `ws` paketi ya da Node'un küresel WebSocket'i
 * KULLANILMAZ — RFC 6455'in istemci tarafı burada (metin çerçevesi, maske, 16/64 bit uzunluk,
 * parçalı mesaj, ping→pong, kapanış).
 *
 * Origin başlığı GÖNDERİLMEZ: Chromium 111+ `--remote-allow-origins` denetimini yalnız Origin
 * taşıyan el sıkışmada yapar; başlıksız yerel istemci kabul edilir.
 *
 * BOZARSAN: tools/pardus/cdp-kitap-ac.test.js (sahte WebSocket sunucusu) kırılır.
 */
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** RFC 6455 §4.2.2: Sec-WebSocket-Accept = base64(sha1(anahtar + GUID)). Saf. */
function kabulAnahtari(anahtar) {
  return crypto.createHash('sha1').update(anahtar + WS_GUID).digest('base64');
}

/**
 * Tek çerçeve kodlar. İstemci çerçeveleri MASKELİ olmak zorunda (RFC 6455 §5.3); sunucu
 * (test) maskesiz gönderir. Saf (maske verilirse deterministik).
 * @param {number} opcode 1 metin · 2 ikili · 8 kapanış · 9 ping · 10 pong
 * @param {Buffer} yuk
 * @param {{maske?: Buffer|null, fin?: boolean}} [s]
 */
function cerceveKodla(opcode, yuk, s = {}) {
  const maske = s.maske === undefined ? crypto.randomBytes(4) : s.maske;
  const fin = s.fin === false ? 0 : 0x80;
  const n = yuk.length;
  let bas;
  if (n < 126) {
    bas = Buffer.alloc(2);
    bas[1] = n;
  } else if (n < 65536) {
    bas = Buffer.alloc(4);
    bas[1] = 126;
    bas.writeUInt16BE(n, 2);
  } else {
    bas = Buffer.alloc(10);
    bas[1] = 127;
    bas.writeBigUInt64BE(BigInt(n), 2);
  }
  bas[0] = fin | (opcode & 0x0f);
  if (!maske) return Buffer.concat([bas, yuk]);
  bas[1] |= 0x80;
  const maskeli = Buffer.alloc(n);
  for (let i = 0; i < n; i += 1) maskeli[i] = yuk[i] ^ maske[i & 3];
  return Buffer.concat([bas, maske, maskeli]);
}

/**
 * Tampondan tam çerçeveleri ayıklar. Eksik çerçeve tamponda kalır. Saf.
 * @returns {{cerceveler: Array<{fin:boolean, opcode:number, yuk:Buffer}>, kalan: Buffer}}
 */
function cerceveCoz(tampon) {
  const cerceveler = [];
  let o = 0;
  while (tampon.length - o >= 2) {
    const b0 = tampon[o];
    const b1 = tampon[o + 1];
    let n = b1 & 0x7f;
    let p = o + 2;
    if (n === 126) {
      if (tampon.length - p < 2) break;
      n = tampon.readUInt16BE(p);
      p += 2;
    } else if (n === 127) {
      if (tampon.length - p < 8) break;
      n = Number(tampon.readBigUInt64BE(p));
      p += 8;
    }
    const maskeli = (b1 & 0x80) !== 0;
    if (maskeli && tampon.length - p < 4) break;
    const maske = maskeli ? tampon.subarray(p, p + 4) : null;
    if (maskeli) p += 4;
    if (tampon.length - p < n) break;
    let yuk = tampon.subarray(p, p + n);
    if (maske) {
      const acik = Buffer.alloc(n);
      for (let i = 0; i < n; i += 1) acik[i] = yuk[i] ^ maske[i & 3];
      yuk = acik;
    } else {
      yuk = Buffer.from(yuk);
    }
    cerceveler.push({ fin: (b0 & 0x80) !== 0, opcode: b0 & 0x0f, yuk });
    o = p + n;
  }
  return { cerceveler, kalan: tampon.subarray(o) };
}

/** HTTP GET → JSON (CDP `/json/list`). Zaman aşımında reddeder. */
function jsonGetir(url, zamanAsimiMs = 3000) {
  return new Promise((coz, reddet) => {
    const istek = http.get(url, { timeout: zamanAsimiMs }, (yanit) => {
      let govde = '';
      yanit.setEncoding('utf8');
      yanit.on('data', (d) => { govde += d; });
      yanit.on('end', () => {
        try { coz(JSON.parse(govde)); } catch (e) { reddet(new Error(`JSON değil (${url}): ${govde.slice(0, 120)}`)); }
      });
    });
    istek.on('timeout', () => istek.destroy(new Error(`zaman aşımı: ${url}`)));
    istek.on('error', reddet);
  });
}

/**
 * WebSocket bağlantısı (yalnız istemci). Olaylar: 'mesaj' (metin), 'kapandi'.
 */
class WsBaglanti extends EventEmitter {
  constructor(soket, bastaKalan) {
    super();
    this.soket = soket;
    this.tampon = Buffer.alloc(0);
    this.parcalar = [];
    this.parcaOpcode = 0;
    this.kapali = false;
    soket.on('data', (d) => this.veri(d));
    soket.on('close', () => this.kapat('soket kapandı'));
    soket.on('error', (e) => this.kapat(`soket hatası: ${e.message}`));
    // El sıkışmayla aynı pakette gelen ilk çerçeve(ler) dinleyici kurulduktan SONRA işlenir.
    if (bastaKalan && bastaKalan.length) {
      const ilk = Buffer.from(bastaKalan);
      setImmediate(() => this.veri(ilk));
    }
  }

  veri(d) {
    if (this.kapali) return;
    this.tampon = Buffer.concat([this.tampon, d]);
    const { cerceveler, kalan } = cerceveCoz(this.tampon);
    this.tampon = Buffer.from(kalan);
    for (const c of cerceveler) {
      if (c.opcode === 9) { this.yaz(10, c.yuk); continue; }
      if (c.opcode === 10) continue;
      if (c.opcode === 8) { this.kapat('karşı taraf kapattı'); return; }
      if (c.opcode === 1 || c.opcode === 2) {
        this.parcalar = [c.yuk];
        this.parcaOpcode = c.opcode;
      } else if (c.opcode === 0) {
        this.parcalar.push(c.yuk);
      }
      if (c.fin && this.parcalar.length) {
        const tum = Buffer.concat(this.parcalar);
        this.parcalar = [];
        if (this.parcaOpcode === 1) this.emit('mesaj', tum.toString('utf8'));
      }
    }
  }

  yaz(opcode, yuk) {
    if (this.kapali) return;
    try { this.soket.write(cerceveKodla(opcode, yuk)); } catch (_) { /* kapanıyor */ }
  }

  gonder(metin) { this.yaz(1, Buffer.from(metin, 'utf8')); }

  kapat(sebep = 'istemci kapattı') {
    if (this.kapali) return;
    try { this.soket.write(cerceveKodla(8, Buffer.alloc(0))); } catch (_) { /* yok */ }
    this.kapali = true;
    try { this.soket.end(); this.soket.destroy(); } catch (_) { /* yok */ }
    this.emit('kapandi', sebep);
  }
}

/** ws://host:port/yol adresine el sıkışır. */
function wsBaglan(wsUrl, zamanAsimiMs = 5000) {
  return new Promise((coz, reddet) => {
    const u = new URL(wsUrl);
    const anahtar = crypto.randomBytes(16).toString('base64');
    const istek = http.request({
      host: u.hostname,
      port: u.port || 80,
      path: `${u.pathname}${u.search}`,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': anahtar,
      },
      timeout: zamanAsimiMs,
    });
    istek.on('upgrade', (yanit, soket, bas) => {
      if (yanit.headers['sec-websocket-accept'] !== kabulAnahtari(anahtar)) {
        soket.destroy();
        reddet(new Error('WebSocket el sıkışması doğrulanamadı (Sec-WebSocket-Accept)'));
        return;
      }
      soket.setTimeout(0);
      soket.setNoDelay(true);
      coz(new WsBaglanti(soket, bas));
    });
    istek.on('response', (yanit) => {
      reddet(new Error(`WebSocket yükseltmesi reddedildi: HTTP ${yanit.statusCode}`));
      yanit.resume();
    });
    istek.on('timeout', () => istek.destroy(new Error(`WebSocket zaman aşımı: ${wsUrl}`)));
    istek.on('error', reddet);
    istek.end();
  });
}

/**
 * CDP oturumu: `gonder(method, params)` → Promise(result); olaylar method adıyla yayılır.
 */
class CdpOturum extends EventEmitter {
  constructor(ws) {
    super();
    this.ws = ws;
    this.sira = 0;
    this.bekleyen = new Map();
    this.kapali = false;
    ws.on('mesaj', (m) => this.mesaj(m));
    ws.on('kapandi', (sebep) => {
      this.kapali = true;
      for (const [, b] of this.bekleyen) { clearTimeout(b.t); b.reddet(new Error(`CDP kapandı: ${sebep}`)); }
      this.bekleyen.clear();
      this.emit('kapandi', sebep);
    });
  }

  mesaj(m) {
    let j;
    try { j = JSON.parse(m); } catch (_) { return; }
    if (j.id !== undefined && this.bekleyen.has(j.id)) {
      const b = this.bekleyen.get(j.id);
      this.bekleyen.delete(j.id);
      clearTimeout(b.t);
      if (j.error) b.reddet(new Error(`${b.method}: ${j.error.message || JSON.stringify(j.error)}`));
      else b.coz(j.result || {});
      return;
    }
    if (j.method) this.emit(j.method, j.params || {});
  }

  gonder(method, params = {}, zamanAsimiMs = 15000) {
    if (this.kapali) return Promise.reject(new Error(`CDP kapalı (${method})`));
    this.sira += 1;
    const id = this.sira;
    return new Promise((coz, reddet) => {
      const t = setTimeout(() => {
        this.bekleyen.delete(id);
        reddet(new Error(`${method}: ${zamanAsimiMs} ms içinde cevap yok`));
      }, zamanAsimiMs);
      this.bekleyen.set(id, { coz, reddet, t, method });
      this.ws.gonder(JSON.stringify({ id, method, params }));
    });
  }

  /** Sayfada ifade değerlendirir, değeri döndürür (sayfa istisnası → hata). */
  async degerlendir(ifade, zamanAsimiMs = 15000) {
    const r = await this.gonder('Runtime.evaluate', {
      expression: ifade, returnByValue: true, awaitPromise: true,
    }, zamanAsimiMs);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`sayfa istisnası: ${(d.exception && d.exception.description) || d.text || 'bilinmiyor'}`.slice(0, 300));
    }
    return r.result ? r.result.value : undefined;
  }

  kapat() { this.ws.kapat(); }
}

/**
 * Hedef listesinden ölçülecek sayfayı seçer. Saf.
 * Windows kabulünün ölçülen dersi (tools/windows/kabul/kabul.py, 3. madde): uygulama birden çok
 * 'page' hedefi açabilir, ilki boş belge olabilir. Tercih: kurulum kökündeki file: sayfası;
 * yoksa herhangi bir file: sayfası (eslesti=false kanıta yazılır); hiçbiri yoksa null.
 * @param {Array<{type:string,url:string,webSocketDebuggerUrl?:string}>} hedefler
 * @param {string} [kurulumKoku] ProBook'taki kurulum kökü (ör. /home/x/empp-serit/kabul-ev/ev-1/DijiTap)
 * @returns {{hedef:object, eslesti:boolean|null}|null}
 */
function hedefSec(hedefler, kurulumKoku = '') {
  const sayfalar = (Array.isArray(hedefler) ? hedefler : [])
    .filter((h) => h && h.type === 'page' && h.webSocketDebuggerUrl && /^file:/i.test(String(h.url || '')));
  if (!sayfalar.length) return null;
  const yolu = (u) => { try { return decodeURIComponent(new URL(u).pathname); } catch (_) { return ''; } };
  const kok = String(kurulumKoku || '').replace(/\/+$/, '');
  if (kok) {
    const e = sayfalar.find((h) => yolu(h.url).startsWith(`${kok}/`));
    if (e) return { hedef: e, eslesti: true };
  }
  return { hedef: sayfalar[0], eslesti: kok ? false : null };
}

/**
 * Hedefin WS adresini bağlandığımız host:port'a çevirir (ssh -L tünelinde uzak port farklıdır).
 * Saf.
 */
function wsAdresiniCevir(wsUrl, host, port) {
  const u = new URL(wsUrl);
  u.hostname = host;
  u.port = String(port);
  return u.toString();
}

module.exports = {
  WS_GUID, kabulAnahtari, cerceveKodla, cerceveCoz, jsonGetir, wsBaglan, WsBaglanti, CdpOturum,
  hedefSec, wsAdresiniCevir,
};
