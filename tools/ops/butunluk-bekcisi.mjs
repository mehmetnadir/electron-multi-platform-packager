#!/usr/bin/env node
// R2 BÜTÜNLÜK BEKÇİSİ — saat başı koşar, yayınlanan her paketin R2'deki karşılığını
// defterle karşılaştırır. Kararı saf modül verir: butunluk-karar.js (17 test, 11 mutant).
//
// Doğuş (2026-09-19): 59834 Windows satırı "uploaded" derken R2'deki nesne 3 saat
// eskiydi; Nadir eski yapıyı indirdi. `integrity_status` kolonu vardı ama üretimde
// ona yalnız 'unknown' yazılıyordu ve saatlik koşu yoktu.
//
// SIR YAZILMAZ: JWT_SECRET ve token hiçbir yere basılmaz.
// Kullanım (srv21): node --env-file=.env.production butunluk-bekcisi.mjs [--yaz]
//   --yaz  : bulguyu ntfy ile bildirir. Yoksa yalnız rapor basar (sessiz tur).

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const BURASI = path.dirname(fileURLToPath(import.meta.url));
const { butunlukKarari, ALARMLI } = require(path.join(BURASI, 'butunluk-karar.js'));

const API = process.env.BUTUNLUK_API || 'https://akillitahta.ndr.ist/api/v1';
const DURUM_YOLU = process.env.BUTUNLUK_DURUM || path.join(BURASI, 'butunluk-durum.json');
const BILDIR = process.argv.includes('--yaz');

function tokenUret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) { console.error('JWT_SECRET yok — .env-file ile koş'); process.exit(1); }
  const jwt = require('jsonwebtoken');
  return jwt.sign({ id: 'ops-butunluk', email: 'ops@yds.local', role: 'publisher_admin' },
    secret, { expiresIn: '30m' });
}

async function getir(yol, token) {
  const r = await fetch(`${API}${yol}`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`GET ${yol} -> HTTP ${r.status}`);
  return r.json();
}

/** R2 nesnesinin başlıkları. Ağ hatası ALARM değildir -> null döner. */
async function head(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow',
      headers: { 'user-agent': 'yds-butunluk-bekcisi/1' },
      signal: AbortSignal.timeout(45000) });
    const lm = r.headers.get('last-modified');
    return {
      status: r.status,
      contentLength: Number(r.headers.get('content-length') || 0),
      etag: r.headers.get('etag') || null,
      lastModified: lm ? Date.parse(lm) : NaN,
    };
  } catch { return null; }
}

function durumOku() {
  if (!existsSync(DURUM_YOLU)) return {};
  try { return JSON.parse(readFileSync(DURUM_YOLU, 'utf8')); } catch { return {}; }
}

function bildirGonder(kanal, mesaj, baslik) {
  try {
    execFileSync('bildir', [kanal, mesaj, '-b', baslik, '-p', 'yuksek'], { timeout: 20000 });
    return true;
  } catch { return false; }
}

const token = tokenUret();
const konfigler = await getir('/r2-configs', token);
const publicUrl = new Map();
for (const c of (Array.isArray(konfigler) ? konfigler : konfigler.items || [])) {
  if (c.publicUrl) publicUrl.set(c.id, String(c.publicUrl).replace(/\/+$/, ''));
}

const ozet = await getir('/jobs/summary', token);
const kitaplar = Array.isArray(ozet) ? ozet : (ozet.items || ozet.summaries || []);
const onceki = durumOku();
const yeniDurum = {};
const sayac = {};
const alarmlar = [];

for (const kitap of kitaplar) {
  for (const p of (kitap.platforms || [])) {
    if (String(p.status) !== 'completed' || !p.r2ObjectKey) continue;
    const taban = publicUrl.get(p.r2ConfigId);
    if (!taban) { sayac.tabansiz = (sayac.tabansiz || 0) + 1; continue; }
    const url = `${taban}/${p.r2ObjectKey.split('/').map(encodeURIComponent).join('/')}`;
    const anahtar = `${kitap.bookId}:${p.platform}`;
    const h = await head(url);
    const k = butunlukKarari({ satir: p, head: h, onceki: onceki[anahtar] || null });
    sayac[k.durum] = (sayac[k.durum] || 0) + 1;
    yeniDurum[anahtar] = {
      etag: h?.etag ?? onceki[anahtar]?.etag ?? null,
      lastRunAt: p.lastRunAt ?? null,
      durum: k.durum, sebep: k.sebep, olcum: new Date().toISOString(),
    };
    if (ALARMLI.has(k.durum)) {
      alarmlar.push(`${k.durum.toUpperCase()} ${kitap.bookId} ${p.platform} — ${(kitap.bookTitle||'').slice(0,40)} — ${k.sebep}`);
    }
  }
}

writeFileSync(DURUM_YOLU, JSON.stringify(yeniDurum, null, 1));
console.log(new Date().toISOString(), 'ozet:', JSON.stringify(sayac));
for (const a of alarmlar) console.log('  ' + a);

if (alarmlar.length && BILDIR) {
  const govde = alarmlar.slice(0, 12).join('\n')
    + (alarmlar.length > 12 ? `\n… +${alarmlar.length - 12} satir daha` : '');
  const gitti = bildirGonder('bekci', govde, `R2 butunluk: ${alarmlar.length} sapma`);
  console.log(gitti ? 'bildirim gonderildi' : 'BILDIRIM GONDERILEMEDI');
}
process.exit(alarmlar.length ? 3 : 0);
