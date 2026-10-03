'use strict';
/**
 * E6/E7 CDP istemcisi — SAHTE TARAYICI ile uçtan uca (gerçek TCP, gerçek WebSocket çerçeveleri).
 *
 * Sahte sunucu RFC 6455'in sunucu tarafını BU DOSYADA bağımsız uygular (istemcinin kodlayıcısını
 * kullanmaz): el sıkışmayı doğrular, istemci çerçevesinin MASKELİ geldiğini denetler, cevapları
 * maskesiz / parçalı (FIN=0 + devam) / 64 bit uzunluklu gönderir, açılışta ping atıp pong bekler.
 * CLI (cdp-kitap-ac.js) ayrı süreçte koşar; kararı `ANAHTAR=değer` satırlarından okunur.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CLI = path.join(__dirname, 'cdp-kitap-ac.js');
const C = require('./cdp-kitap-ac.js');
const I = require('../kabul/cdp-istemci.js');

const KOK = '/home/etapadmin/empp-serit/kabul-ev/ev-1/DijiTap';
const KOK_URL = `file://${KOK}/YDS/Kitap%20Adi/resources/app.asar/index.html`;
const KITAP_URL = `file://${KOK}/YDS/Kitap%20Adi/resources/app.asar/book1/index.html`;
const GURL = 'https://akillitahta.ydspublishing.com/TestlerMobil/GetKitapGuncellemeBilgi?id=44187&setMi=0&versiyon=33';
const DOLU = JSON.stringify({ Success: true, Data: 'https://cdn.x/ZKitapZipH/44187-36.zip', Vs: 36 });
const BOS = JSON.stringify({ Success: true, Data: '', Vs: 33 });

// --- Bağımsız sunucu tarafı çerçeveleme -------------------------------------------------------
function sunucuCercevesi(opcode, yuk, fin = true) {
  const n = yuk.length;
  let bas;
  if (n < 126) {
    bas = Buffer.from([0, n]);
  } else if (n < 65536) {
    bas = Buffer.alloc(4);
    bas[1] = 126;
    bas.writeUInt16BE(n, 2);
  } else {
    bas = Buffer.alloc(10);
    bas[1] = 127;
    bas.writeBigUInt64BE(BigInt(n), 2);
  }
  bas[0] = (fin ? 0x80 : 0) | opcode;
  return Buffer.concat([bas, yuk]);
}

function istemciCerceveleri(tampon, ihlal) {
  const cik = [];
  let o = 0;
  while (tampon.length - o >= 2) {
    const b0 = tampon[o];
    const b1 = tampon[o + 1];
    if (!(b1 & 0x80)) ihlal.push('istemci çerçevesi MASKESİZ');
    let n = b1 & 0x7f;
    let p = o + 2;
    if (n === 126) { if (tampon.length - p < 2) break; n = tampon.readUInt16BE(p); p += 2; }
    else if (n === 127) { if (tampon.length - p < 8) break; n = Number(tampon.readBigUInt64BE(p)); p += 8; }
    if (tampon.length - p < 4 + n) break;
    const m = tampon.subarray(p, p + 4);
    const yuk = Buffer.alloc(n);
    for (let i = 0; i < n; i += 1) yuk[i] = tampon[p + 4 + i] ^ m[i % 4];
    cik.push({ opcode: b0 & 0x0f, yuk });
    o = p + 4 + n;
  }
  return { cik, kalan: tampon.subarray(o) };
}

/**
 * Sahte tarayıcı. `o` senaryo seçenekleri:
 *   baslangic: 'set' | 'kok' | 'bilinmeyen'      tiklamaGezinir / fareGezinir: bool
 *   kitap: 'okuyucu' | 'yukleniyor'              guncelleme: 'acilista' | 'yenilemede' | null
 *   govde: string, base64: bool                  konsol: string (kitap açılınca konsola düşer)
 */
async function sahteTarayici(o = {}) {
  const k = {
    url: KOK_URL, asama: o.baslangic || 'set', alinan: [], ihlal: [], pong: 0, origin: null,
    tiklama: 0, fare: 0, yenileme: 0, soketler: new Set(),
  };
  const ekran = crypto.randomBytes(90000).toString('base64'); // > 65535 → 64 bit uzunluk
  const yoklama = () => {
    const bos = { url: k.url, baslik: 'x', kartlar: [], kapaklar: [], yukleniyor: [], sayfaGorseli: 0, tuval: 0, arkaPlanSayfa: 0 };
    if (k.asama === 'set') {
      return { ...bos, kartSayisi: 2, kartlar: [
        { anahtar: 'yol:book1', tip: 'yol', kitap: 'book1', metin: 'Kitap 1', x: 120, y: 200 },
        { anahtar: 'yol:book2', tip: 'yol', kitap: 'book2', metin: 'Kitap 2', x: 320, y: 200 },
      ] };
    }
    if (k.asama === 'kok' || k.asama === 'okuyucu') return { ...bos, baslik: 'Akıllı Tahta Uygulaması', sayfaGorseli: 2, tuval: 1 };
    if (k.asama === 'yukleniyor') return { ...bos, yukleniyor: ['seçici:.lds-ellipsis'] };
    return bos;
  };
  let gonder = () => {};
  const agOlaylari = () => {
    setTimeout(() => {
      gonder({ method: 'Network.requestWillBeSent', params: { requestId: 'pf', type: 'Preflight', request: { url: GURL, method: 'OPTIONS' } } });
      gonder({ method: 'Network.requestWillBeSent', params: { requestId: 'r1', type: 'Fetch', request: { url: GURL, method: 'GET' } } });
      gonder({ method: 'Network.responseReceived', params: { requestId: 'r1', type: 'Fetch', response: { url: GURL, status: 200 } } });
      gonder({ method: 'Network.loadingFinished', params: { requestId: 'r1' } });
    }, 20);
  };
  const kitabaGec = () => {
    k.url = KITAP_URL;
    k.asama = o.kitap || 'okuyucu';
    if (o.guncelleme === 'acilista') agOlaylari();
    if (o.konsol) {
      setTimeout(() => gonder({ method: 'Runtime.consoleAPICalled', params: { type: 'error', args: [{ type: 'string', value: o.konsol }] } }), 10);
    }
  };
  const cevap = (m) => {
    const p = m.params || {};
    switch (m.method) {
      case 'Runtime.evaluate': {
        const e = String(p.expression || '');
        if (e.includes('function domYokla')) return { result: { type: 'object', value: yoklama() } };
        if (e === 'location.href') return { result: { type: 'string', value: k.url } };
        if (e.includes('outerHTML')) return { result: { type: 'string', value: '<html><body>sahte</body></html>' } };
        if (e.includes('#unitModal')) {
          if (!k.modal) return { result: { type: 'boolean', value: false } };
          k.uniteTiklama = (k.uniteTiklama || 0) + 1;
          kitabaGec();
          return { result: { type: 'boolean', value: true } };
        }
        if (e.includes('el.click()')) {
          k.tiklama += 1;
          if (o.uniteModali && e.includes('book1')) { k.modal = true; return { result: { type: 'boolean', value: true } }; }
          if (e.includes('book1') && o.tiklamaGezinir !== false) kitabaGec();
          return { result: { type: 'boolean', value: true } };
        }
        return { result: { type: 'undefined' } };
      }
      case 'Input.dispatchMouseEvent':
        if (p.type === 'mouseReleased') { k.fare += 1; if (o.fareGezinir) kitabaGec(); }
        return {};
      case 'Page.reload':
        k.yenileme += 1;
        if (o.guncelleme === 'yenilemede') agOlaylari();
        return {};
      case 'Network.getResponseBody':
        if (p.requestId !== 'r1') return { __hata: 'No resource with given identifier found' };
        return o.base64
          ? { body: Buffer.from(o.govde || BOS).toString('base64'), base64Encoded: true }
          : { body: o.govde || BOS, base64Encoded: false };
      case 'Runtime.enable':
        if (o.acilisKonsol) {
          o.acilisKonsol.forEach((v, i) => setTimeout(() => gonder({ method: 'Runtime.consoleAPICalled',
            params: { type: 'error', args: [{ type: 'string', value: v }] } }), 5 + i));
        }
        return {};
      case 'Page.captureScreenshot':
        return { data: ekran };
      default:
        return {};
    }
  };

  const sunucu = http.createServer((istek, yanit) => {
    if (istek.url === '/json/list') {
      const port = sunucu.address().port;
      const ws = `ws://127.0.0.1:${port}/devtools/page/`;
      yanit.setHeader('Content-Type', 'application/json');
      yanit.end(JSON.stringify([
        { type: 'page', url: 'about:blank', webSocketDebuggerUrl: `${ws}bos` },
        { type: 'page', url: 'file:///tmp/baska-uygulama/index.html', webSocketDebuggerUrl: `${ws}baska` },
        { type: 'page', url: k.url, webSocketDebuggerUrl: `${ws}hedef` },
        { type: 'service_worker', url: 'file:///x/sw.js', webSocketDebuggerUrl: `${ws}sw` },
      ]));
      return;
    }
    yanit.statusCode = 404;
    yanit.end();
  });
  sunucu.on('upgrade', (istek, soket) => {
    k.soketler.add(soket);
    soket.on('close', () => k.soketler.delete(soket));
    k.origin = istek.headers.origin || null;
    k.yol = istek.url;
    const kabul = crypto.createHash('sha1')
      .update(`${istek.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    // 101 + ilk ping AYNI yazımda: istemci el sıkışmayla gelen baş tamponu işlemeli.
    soket.write(Buffer.concat([
      Buffer.from(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${kabul}\r\n\r\n`),
      sunucuCercevesi(9, Buffer.from('nabiz')),
    ]));
    gonder = (nesne) => {
      const yuk = Buffer.from(JSON.stringify(nesne));
      if (yuk.length > 400 && yuk.length < 60000) {
        // Parçalı mesaj: FIN=0 metin + FIN=1 devam, ayrı TCP yazımlarında.
        const yari = Math.floor(yuk.length / 2);
        soket.write(sunucuCercevesi(1, yuk.subarray(0, yari), false));
        setImmediate(() => { if (!soket.destroyed) soket.write(sunucuCercevesi(0, yuk.subarray(yari), true)); });
      } else if (!soket.destroyed) {
        soket.write(sunucuCercevesi(1, yuk));
      }
    };
    let tampon = Buffer.alloc(0);
    soket.on('data', (d) => {
      tampon = Buffer.concat([tampon, d]);
      const { cik, kalan } = istemciCerceveleri(tampon, k.ihlal);
      tampon = Buffer.from(kalan);
      for (const c of cik) {
        if (c.opcode === 10) { k.pong += 1; continue; }
        if (c.opcode === 8) { soket.end(); continue; }
        if (c.opcode !== 1) continue;
        const m = JSON.parse(c.yuk.toString('utf8'));
        k.alinan.push(m.method);
        const r = cevap(m);
        if (r && r.__hata) gonder({ id: m.id, error: { code: -32000, message: r.__hata } });
        else gonder({ id: m.id, result: r });
      }
    });
  });
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  k.port = sunucu.address().port;
  k.kapat = () => new Promise((r) => { for (const s of k.soketler) s.destroy(); sunucu.close(() => r()); });
  return k;
}

function satirlar(cikti) {
  const v = {};
  for (const s of String(cikti).split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(s);
    if (m) v[m[1]] = m[2];
  }
  return v;
}

function kos(port, ek = []) {
  const kanit = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-kanit-'));
  return new Promise((coz) => {
    const p = spawn(process.execPath, [CLI, '--port', String(port), '--kanit', kanit, '--kurulum-koku', KOK,
      '--aralik-ms', '40', '--baglan-sn', '2', '--menu-sn', '2', '--gezinme-sn', '1', '--kitap-sn', '2',
      '--e7-sn', '1', '--toplam-sn', '25', ...ek], { stdio: ['ignore', 'pipe', 'pipe'] });
    let cikti = '';
    p.stdout.on('data', (d) => { cikti += d; });
    p.stderr.on('data', (d) => { cikti += d; });
    p.on('exit', (kod) => coz({ kod, cikti, v: satirlar(cikti), kanit }));
  });
}

// --- Uçtan uca (sahte tarayıcı) -----------------------------------------------------------------

test('SET: ilk karta DOM tiklamasi → book1 okuyucu; E7 Data DOLU yakalanir (Preflight sayilmaz)', async () => {
  const t = await sahteTarayici({ baslangic: 'set', guncelleme: 'acilista', govde: DOLU });
  try {
    const r = await kos(t.port);
    assert.equal(r.kod, 0, r.cikti);
    assert.equal(r.v.E6, 'GECTI', r.cikti);
    assert.equal(r.v.E6_TUR, 'set');
    assert.match(r.v.E6_URL, /\/book1\/index\.html$/);
    assert.equal(r.v.E7, 'DOLU', r.cikti);
    assert.match(r.v.E7_AYRINTI, /44187 v33 < İmpark v36 \(Data=https:\/\/cdn\.x\/ZKitapZipH\/44187-36\.zip\)/);
    assert.match(r.v.E7_ONERI, /ZKitapZipH\/44187-36\.zip/);
    assert.match(r.v.E7_ONERI, /yeniden kuyruğa al/);
    // Hedef seçimi: about:blank ve kurulum kökü dışındaki sayfa değil, kurulumdaki sayfa.
    assert.equal(r.v.CDP_HEDEF_ESLESTI, '1');
    assert.equal(t.yol, '/devtools/page/hedef');
    // Protokol: Origin yok, istemci maskeli, ping'e pong, gerekli alanlar açıldı.
    assert.equal(t.origin, null, 'Origin başlığı gönderilmemeli (--remote-allow-origins gerektirmesin)');
    assert.deepEqual(t.ihlal, []);
    assert.ok(t.pong >= 1, 'sunucu ping\'ine pong dönülmeli (el sıkışmayla gelen baş tamponu)');
    for (const m of ['Network.enable', 'Runtime.enable', 'Network.getResponseBody', 'Page.captureScreenshot']) {
      assert.ok(t.alinan.includes(m), `${m} çağrılmadı: ${t.alinan.join(',')}`);
    }
    assert.equal(t.yenileme, 0, 'SET menüsünde sayfa yeniden yüklenmemeli');
    assert.equal(t.fare, 0, 'DOM tıklaması yetince fare olayı gönderilmemeli');
    const j = JSON.parse(fs.readFileSync(path.join(r.kanit, 'cdp-sonuc.json'), 'utf8'));
    assert.equal(j.e7.cevaplar.length, 1, 'OPTIONS/Preflight sayılmamalı');
    assert.equal(fs.statSync(path.join(r.kanit, 'kitap-cdp.png')).size, 90000, '64 bit uzunluklu ekran görüntüsü tam gelmeli');
  } finally { await t.kapat(); }
});

test('SET: Data bos → E7=BOS (base64 govde de cozulur)', async () => {
  const t = await sahteTarayici({ baslangic: 'set', guncelleme: 'acilista', govde: BOS, base64: true });
  try {
    const r = await kos(t.port);
    assert.equal(r.v.E6, 'GECTI', r.cikti);
    assert.equal(r.v.E7, 'BOS', r.cikti);
    assert.match(r.v.E7_AYRINTI, /44187 v33 güncel \(Vs=33\)/);
    assert.equal(r.v.E7_ONERI, '');
  } finally { await t.kapat(); }
});

test('SET: guncelleme istegi hic yok → E7=YOK, karar E4 (statik) — E6 yine GECTI', async () => {
  const t = await sahteTarayici({ baslangic: 'set', guncelleme: null });
  try {
    const r = await kos(t.port);
    assert.equal(r.kod, 0, r.cikti);
    assert.equal(r.v.E7, 'YOK');
    assert.match(r.v.E7_AYRINTI, /karar E4/);
  } finally { await t.kapat(); }
});

test('SET: tiklama gezinmiyor → CDP fare yedegi denenir, yine gezinmezse E6=RED (cikis 1) + DOM kaniti', async () => {
  const t = await sahteTarayici({ baslangic: 'set', tiklamaGezinir: false, fareGezinir: false });
  try {
    const r = await kos(t.port);
    assert.equal(r.kod, 1, r.cikti);
    assert.equal(r.v.E6, 'RED');
    assert.match(r.v.E6_SEBEP, /okuyucu açılmadı — URL bookN\/ altına geçmedi/);
    assert.match(r.v.E6_SEBEP, /dom\+cdp-fare/);
    assert.ok(t.fare >= 1, 'fare yedeği denenmeli');
    assert.ok(fs.existsSync(path.join(r.kanit, 'kitap-cdp.dom.html')));
  } finally { await t.kapat(); }
});

test('SET: DOM tiklamasi yutulur, CDP fare olayi gezinir → E6 GECTI', async () => {
  const t = await sahteTarayici({ baslangic: 'set', tiklamaGezinir: false, fareGezinir: true });
  try {
    const r = await kos(t.port);
    assert.equal(r.v.E6, 'GECTI', r.cikti);
    assert.equal(t.fare, 1);
  } finally { await t.kapat(); }
});

test('okuyucu surekli yukleniyor → E6=RED "hala yukleniyor"', async () => {
  const t = await sahteTarayici({ baslangic: 'set', kitap: 'yukleniyor' });
  try {
    const r = await kos(t.port);
    assert.equal(r.kod, 1, r.cikti);
    assert.match(r.v.E6_SEBEP, /hâlâ yükleniyor göstergesi: seçici:\.lds-ellipsis/);
  } finally { await t.kapat(); }
});

test('konsolda kusur imzasi (assets not found) → okuyucu cizse de E6=RED', async () => {
  const t = await sahteTarayici({ baslangic: 'set', konsol: 'assets not found in /x/app.asar' });
  try {
    const r = await kos(t.port);
    assert.equal(r.v.E6, 'RED', r.cikti);
    assert.match(r.v.E6_SEBEP, /konsolda kusur imzası: kök sayfa motor kopyası gibi davranıyor \(assets bulunamadı\)/);
  } finally { await t.kapat(); }
});

test('tek kitap kok okuyucu: guncelleme sorusu kacirilmasin diye BIR KEZ yeniden yuklenir, E7 yakalanir', async () => {
  const t = await sahteTarayici({ baslangic: 'kok', guncelleme: 'yenilemede', govde: DOLU });
  try {
    const r = await kos(t.port);
    assert.equal(t.yenileme, 1);
    assert.equal(r.v.E6, 'GECTI', r.cikti);
    assert.equal(r.v.E6_TUR, 'kok-okuyucu');
    assert.equal(r.v.E7, 'DOLU');
    const r2 = await kos(t.port, ['--yeniden-yukle', '0']);
    assert.equal(t.yenileme, 1, '--yeniden-yukle 0 ile yeniden yüklenmemeli');
    assert.equal(r2.v.E7, 'YOK');
  } finally { await t.kapat(); }
});

test('taninmayan menu (kart/kapak/sayfa izi yok) → E6=OLCULEMEDI (cikis 4), RED DEGIL', async () => {
  const t = await sahteTarayici({ baslangic: 'bilinmeyen' });
  try {
    const r = await kos(t.port, ['--yeniden-yukle', '0']);
    assert.equal(r.kod, 4, r.cikti);
    assert.equal(r.v.E6, 'OLCULEMEDI');
    assert.match(r.v.E6_SEBEP, /kitap listesi\/okuyucu tanınmadı/);
  } finally { await t.kapat(); }
});

test('taninmayan menu + konsolda pakette olmayan betik/stil + ReferenceError → E6=RED (59480 Flashy, ertelenmez)', async () => {
  const APP = 'file:///home/e/ev/DijiTap/Flashy%20Set/resources/app.asar';
  const t = await sahteTarayici({ baslangic: 'bilinmeyen', acilisKonsol: [
    `ReferenceError: FlashyUI is not defined\n    at applyConfig (${APP}/theme.js?v=2:70:3)`,
    `Failed to load resource: net::ERR_FILE_NOT_FOUND ${APP}/_design/components.js?v=2`,
  ] });
  try {
    const r = await kos(t.port, ['--yeniden-yukle', '0']);
    assert.equal(r.kod, 1, r.cikti);
    assert.equal(r.v.E6, 'RED');
    assert.match(r.v.E6_SEBEP, /paket kusuru.*_design\/components\.js.*FlashyUI is not defined/);
  } finally { await t.kapat(); }
});

test('ünite seçicili tema (Flashy): kart tıklaması modal açar, kabul ilk üniteye tıklar → E6=GECTI (59480)', async () => {
  const t = await sahteTarayici({ baslangic: 'set', uniteModali: true });
  try {
    const r = await kos(t.port, ['--gezinme-sn', '1']);
    assert.equal(r.v.E6, 'GECTI', r.cikti);
    assert.match(r.v.E6_SEBEP || '', /okuyucu açıldı/);
  } finally { await t.kapat(); }
});

test('kart tıklaması hiçbir şey açmıyorsa (modal da yok) RED kalır: ünite yolu sahte yeşil üretmez', async () => {
  const t = await sahteTarayici({ baslangic: 'set', tiklamaGezinir: false, fareGezinir: false });
  try {
    const r = await kos(t.port, ['--gezinme-sn', '1']);
    assert.equal(r.v.E6, 'RED', r.cikti);
    assert.match(r.v.E6_SEBEP, /okuyucu açılmadı/);
  } finally { await t.kapat(); }
});

test('CDP portu kapali → E6=OLCULEMEDI (cikis 4), E7=OLCULEMEDI', async () => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  const r = await kos(port);
  assert.equal(r.kod, 4, r.cikti);
  assert.equal(r.v.E6, 'OLCULEMEDI');
  assert.match(r.v.E6_SEBEP, /CDP bağlanamadı \(2 sn, port \d+\)/);
  assert.equal(r.v.E7, 'OLCULEMEDI');
});

test('port verilmezse OLCULEMEDI', async () => {
  const yaz = [];
  const kod = await C.ana([], (s) => yaz.push(s));
  assert.equal(kod, 4);
  assert.ok(yaz.includes('E6=OLCULEMEDI'));
});

// --- Saf fonksiyonlar ---------------------------------------------------------------------------

test('guncellemeCevabiCoz: DOLU / BOS / Success=false / HTML / govde yok / geri alinmis surum', () => {
  const d = C.guncellemeCevabiCoz({ url: GURL, govde: DOLU });
  assert.equal(d.durum, 'DOLU');
  assert.equal(d.id, '44187');
  assert.equal(d.versiyon, '33');
  assert.equal(d.vs, '36');
  assert.equal(C.guncellemeCevabiCoz({ url: GURL, govde: JSON.stringify({ Success: true, Data: null, Vs: 33 }) }).durum, 'BOS');
  assert.equal(C.guncellemeCevabiCoz({ url: GURL, govde: JSON.stringify({ Success: false }) }).durum, 'OLCULEMEDI');
  const html = C.guncellemeCevabiCoz({ url: GURL, govde: '<html>500</html>', http: 500 });
  assert.equal(html.durum, 'OLCULEMEDI');
  assert.match(html.sebep, /JSON değil \(HTTP 500\)/);
  assert.match(C.guncellemeCevabiCoz({ url: GURL, durum: 'basarisiz', hata: 'net::ERR_NAME_NOT_RESOLVED' }).sebep, /istek başarısız/);
  const geri = C.guncellemeCevabiCoz({ url: GURL.replace('versiyon=33', 'versiyon=9'), govde: JSON.stringify({ Success: true, Data: '', Vs: 8 }) });
  assert.equal(geri.durum, 'BOS');
  assert.match(geri.uyari, /İmpark v8 < paket v9/);
});

test('e7Ozetle: DOLU her seyi ezer; olculemeyen varsa BOS denmez; tekrarlar tekillenir', () => {
  const bos = C.guncellemeCevabiCoz({ url: GURL, govde: BOS });
  const dolu = C.guncellemeCevabiCoz({ url: GURL, govde: DOLU });
  const olc = C.guncellemeCevabiCoz({ url: GURL, govde: 'x' });
  assert.equal(C.e7Ozetle([]).durum, 'YOK');
  assert.equal(C.e7Ozetle([bos, bos]).durum, 'BOS');
  assert.equal(C.e7Ozetle([bos, bos]).ayrinti.split(';').length, 1);
  assert.equal(C.e7Ozetle([bos, olc]).durum, 'OLCULEMEDI');
  assert.equal(C.e7Ozetle([bos, olc, dolu, dolu]).durum, 'DOLU');
});

test('sayfaTuru / kartSec / tiklamaIfadesi — dom-yoklama bicimleri', () => {
  assert.equal(C.sayfaTuru({ kartlar: [{}] }), 'set');
  assert.equal(C.sayfaTuru({ kartlar: [], sayfaGorseli: 1 }), 'kok-okuyucu');
  assert.equal(C.sayfaTuru({ kartlar: [], kapaklar: [{}] }), 'kitaplik');
  assert.equal(C.sayfaTuru({ kartlar: [] }), null);
  assert.equal(C.sayfaTuru({ yoklamaHatasi: 'x' }), null);
  const grup = { tip: 'webz-grup', anahtar: 'grup:0' };
  const kitap = { tip: 'webz', anahtar: 'webz:9', secici: '.book-item[data-book-id="9"]' };
  assert.equal(C.kartSec([grup, kitap]), kitap);
  assert.equal(C.kartSec([grup]), grup);
  assert.match(C.tiklamaIfadesi(kitap), /\.book-item\[data-book-id=\\"9\\"\] \.book-cover/);
  assert.match(C.tiklamaIfadesi({ tip: 'yol', kitap: 'book12' }), /book12\\\\\//);
  assert.equal(C.tiklamaIfadesi({ tip: 'yol', kitap: 'book1"); alert(1); ("' }), 'false', 'kitap adı enjekte edilemez');
});

test('hedefSec: kurulum kokundeki file: sayfasi; yoksa ilk file: sayfasi eslesti=false; hic yoksa null', () => {
  const h = [
    { type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://a/1' },
    { type: 'page', url: 'file:///tmp/x/index.html', webSocketDebuggerUrl: 'ws://a/2' },
    { type: 'page', url: KOK_URL, webSocketDebuggerUrl: 'ws://a/3' },
  ];
  assert.deepEqual(I.hedefSec(h, KOK), { hedef: h[2], eslesti: true });
  assert.deepEqual(I.hedefSec(h, '/baska/kok'), { hedef: h[1], eslesti: false });
  assert.deepEqual(I.hedefSec(h, ''), { hedef: h[1], eslesti: null });
  assert.equal(I.hedefSec([h[0]], KOK), null);
  assert.equal(I.wsAdresiniCevir('ws://127.0.0.1:9337/devtools/page/X', '127.0.0.1', 9437), 'ws://127.0.0.1:9437/devtools/page/X');
});

test('cerceve kodla/coz: 0/125/126/65535/65536 bayt, maskeli ve maskesiz, parcali tampon', () => {
  for (const n of [0, 125, 126, 65535, 65536, 70001]) {
    const yuk = crypto.randomBytes(n);
    for (const maske of [null, Buffer.from([1, 2, 3, 4])]) {
      const c = I.cerceveKodla(1, yuk, { maske });
      const tam = I.cerceveCoz(c);
      assert.equal(tam.cerceveler.length, 1, `n=${n}`);
      assert.ok(tam.cerceveler[0].yuk.equals(yuk), `n=${n} maske=${Boolean(maske)}`);
      assert.equal(tam.kalan.length, 0);
      const yarim = I.cerceveCoz(c.subarray(0, Math.max(1, c.length - 1)));
      assert.equal(yarim.cerceveler.length, 0, 'eksik çerçeve tamponda kalmalı');
    }
  }
  assert.equal(I.kabulAnahtari('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=', 'RFC 6455 örneği');
});
