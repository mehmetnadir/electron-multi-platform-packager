#!/usr/bin/env node
'use strict';
/**
 * VM KÖPRÜ SUNUCUSU (host, Mac) — paylaşılan klasör YOKKEN kullanılan taşıma katmanı.
 *
 * NEDEN: VMware Fusion 13'te **Apple Silicon host + Windows 11 ARM misafir** için
 * paylaşılan klasör DESTEKLENMİYOR (Broadcom belgesi; Fusion'ın Ayarlar penceresinde
 * "Sharing" paneli hiç görünmüyor — eksik yapılandırma değil, olmayan özellik).
 * Ölçüldü: Fusion 13.6.4, host arm64, vmx'te tek bir hgfs/sharedFolder satırı yok.
 *
 * ÇÖZÜM: aynı dosya protokolünü ağ üzerinden taşı. Misafir, Mac'e VMware ağından
 * ulaşıyor (ölçüldü: bridge100 = 192.168.11.1 / NAT, bridge101 = 192.168.225.1 /
 * yalnız-host). Bu sunucu SADECE o arayüzlere bağlanır — dış ağa açılmaz.
 *
 * KARAR VE SÜRÜCÜ KATMANLARI DEĞİŞMEZ: sunucu `~/vm-kapi/{gorev,sonuc,durum}`
 * dizinlerini HTTP'ye açar; `vm-kapi.js` ve `vm-kapi-karar.js` aynen çalışır.
 *
 * Kimlik: rastgele bir belirteç yol önekidir. Parola yok, hiçbir yerde sır taşınmaz.
 *
 * Uçlar (hepsi `/<belirtec>/` altında):
 *   GET  gorev              → sıradaki görev JSON'u (yoksa 204)
 *   POST kalp               → kalp atışı
 *   POST sonuc/<kimlik>     → sonuç JSON'u (atomik yazılır)
 *   POST ekran/<kimlik>     → PNG baytları
 *   GET  dosya/<ad>         → kurulum dosyasını indir
 */
// İşletim günlüğü STDOUT'a DEĞİL STDERR'e yazılır. Sebep ölçüldü (2026-09-20):
// `node --test` çocuk süreçle V8-serileştirilmiş mesajları FD 1 üzerinden konuşur;
// eşzamanlı bir HTTP işleyicisinden gelen `console.log` o akışın ortasına girip
// "Unable to deserialize cloned data" ile TÜM dosyayı düşürüyordu (3/3 koşuda).
// Operatör çıktısı terminalde aynen görünür; kanal temiz kalır.
function kayit(...p) { console.error(...p); }

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const KOK = process.env.EMPP_VM_KOK || path.join(os.homedir(), 'vm-kapi');
const PORT = Number(process.env.EMPP_VM_PORT || 8791);   // 3000 YASAK
const D = {
  gorev: path.join(KOK, 'gorev'),
  sonuc: path.join(KOK, 'sonuc'),
  durum: path.join(KOK, 'durum'),
};

/** VMware'in host tarafı adresleri — yalnız bunlara bağlanılır, 0.0.0.0'a ASLA. */
function vmAdresleri() {
  const bulunan = [];
  for (const [ad, liste] of Object.entries(os.networkInterfaces())) {
    if (!/^bridge\d+/.test(ad)) continue;
    for (const a of liste || []) {
      if (a.family === 'IPv4' && !a.internal) bulunan.push({ ad, adres: a.address });
    }
  }
  return bulunan;
}

function belirtecAl() {
  fs.mkdirSync(D.durum, { recursive: true });
  const yol = path.join(D.durum, 'belirtec.txt');
  try {
    const v = fs.readFileSync(yol, 'utf8').trim();
    if (/^[a-f0-9]{16,}$/.test(v)) return v;
  } catch { /* yok — üret */ }
  const yeni = crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(yol, yeni, { mode: 0o600 });
  return yeni;
}

/** Sıradaki görevi al ve dizinden KALDIR (ikinci kez dağıtılmasın). */
function siradakiGorev() {
  let adlar = [];
  try { adlar = fs.readdirSync(D.gorev).filter((f) => f.endsWith('.json')).sort(); } catch { return null; }
  if (!adlar.length) return null;
  const tam = path.join(D.gorev, adlar[0]);
  let govde;
  try { govde = JSON.parse(fs.readFileSync(tam, 'utf8')); } catch { fs.unlinkSync(tam); return null; }
  govde.kimlik = path.basename(adlar[0], '.json');
  fs.unlinkSync(tam);
  return govde;
}

function govdeTopla(istek, sinirBayt = 40 * 1024 * 1024) {
  return new Promise((coz, red) => {
    const parcalar = [];
    let boyut = 0;
    istek.on('data', (p) => {
      boyut += p.length;
      if (boyut > sinirBayt) { red(new Error('gövde çok büyük')); istek.destroy(); return; }
      parcalar.push(p);
    });
    istek.on('end', () => coz(Buffer.concat(parcalar)));
    istek.on('error', red);
  });
}

function atomikYaz(hedef, veri) {
  const gecici = `${hedef}.tmp`;
  fs.writeFileSync(gecici, veri);
  fs.renameSync(gecici, hedef);
}

function sunucuKur(belirtec) {
  return http.createServer(async (istek, yanit) => {
    try {
      const u = new URL(istek.url, 'http://yerel');
      const parca = u.pathname.split('/').filter(Boolean);
      if (parca[0] !== belirtec) { yanit.writeHead(404).end(); return; }
      const eylem = parca[1];
      for (const d of Object.values(D)) fs.mkdirSync(d, { recursive: true });

      if (istek.method === 'GET' && eylem === 'gorev') {
        const g = siradakiGorev();
        if (!g) { yanit.writeHead(204).end(); return; }
        yanit.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(g));
        kayit(`→ görev verildi: ${g.kimlik} (${g.tur})`);
        return;
      }
      if (istek.method === 'POST' && eylem === 'kalp') {
        atomikYaz(path.join(D.durum, 'kalp.txt'), new Date().toISOString());
        yanit.writeHead(204).end();
        return;
      }
      if (istek.method === 'POST' && eylem === 'sonuc' && parca[2]) {
        const govde = await govdeTopla(istek);
        atomikYaz(path.join(D.sonuc, `${path.basename(parca[2])}.json`), govde);
        yanit.writeHead(204).end();
        kayit(`← sonuç alındı: ${parca[2]}`);
        return;
      }
      if (istek.method === 'POST' && eylem === 'ekran' && parca[2]) {
        const govde = await govdeTopla(istek);
        atomikYaz(path.join(D.sonuc, `${path.basename(parca[2])}.png`), govde);
        yanit.writeHead(204).end();
        kayit(`← ekran alındı: ${parca[2]} (${(govde.length / 1024).toFixed(0)} KB)`);
        return;
      }
      if (istek.method === 'GET' && eylem === 'dosya' && parca[2]) {
        const ad = path.basename(decodeURIComponent(parca[2]));
        const tam = path.join(KOK, ad);
        if (!fs.existsSync(tam)) { yanit.writeHead(404).end(); return; }
        yanit.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': fs.statSync(tam).size,
        });
        fs.createReadStream(tam).pipe(yanit);
        kayit(`→ dosya veriliyor: ${ad}`);
        return;
      }
      yanit.writeHead(404).end();
    } catch (e) {
      try { yanit.writeHead(500).end(String(e.message)); } catch { /* yanıt kapandı */ }
    }
  });
}

async function ana() {
  const belirtec = belirtecAl();
  const adresler = vmAdresleri();
  if (!adresler.length) {
    kayit('VMware host arayüzü bulunamadı (bridge*). VM çalışıyor mu?');
    process.exit(3);
  }
  for (const { ad, adres } of adresler) {
    const s = sunucuKur(belirtec);
    await new Promise((coz) => s.listen(PORT, adres, coz));
    kayit(`dinleniyor: http://${adres}:${PORT}/  (${ad})`);
  }
  kayit('\nVM içinde çalıştır (tek satır, yönetici GEREKMEZ):');
  kayit(`powershell -ExecutionPolicy Bypass -File C:\\vm-kapi\\vm-izleyici.ps1 -Adres http://${adresler[0].adres}:${PORT} -Belirtec ${belirtec}\n`);
}

if (require.main === module) ana().catch((e) => { kayit('HATA:', e.message); process.exit(1); });
module.exports = { sunucuKur, belirtecAl, siradakiGorev, vmAdresleri, KOK, D, PORT };
