// GERİLEME: Android açılış ekranı (native splash) kurum logosundan üretilmeli.
//
// Saha kusuru (2026-09-21, BES Felsefe KTT): launcher ikonu logodan doğru
// üretiliyordu ama `res/drawable*/splash.png` Capacitor şablonundan geldiği gibi
// kalıyordu — kullanıcı açılışta yayıncı logosu yerine Capacitor'ün mavi
// varyantını görüyordu. Ayırt edici iz: splash.png baytı iki ayrı üretimde
// BİREBİR aynı kalıyordu. Bu test tam olarak onu yakalar.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('fs-extra');
const sharp = require('sharp');

const svc = require('./packagingService');  // singleton dışa vurulur

const YOGUNLUKLAR = [
  'drawable',
  'drawable-port-mdpi', 'drawable-port-hdpi', 'drawable-port-xhdpi',
  'drawable-port-xxhdpi', 'drawable-port-xxxhdpi',
  'drawable-land-mdpi', 'drawable-land-hdpi', 'drawable-land-xhdpi',
  'drawable-land-xxhdpi', 'drawable-land-xxxhdpi',
];

async function kurulum() {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-splash-'));
  const res = path.join(kok, 'android', 'app', 'src', 'main', 'res');
  await fs.ensureDir(res);
  // Şablon splash'ı taklit et: mavi kare, HER yoğunlukta aynı bayt.
  const sablon = await sharp({
    create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 120, b: 255, alpha: 1 } },
  }).png().toBuffer();
  for (const d of YOGUNLUKLAR) {
    await fs.ensureDir(path.join(res, d));
    await fs.writeFile(path.join(res, d, 'splash.png'), sablon);
  }
  // Kurum logosu: GENİŞ (300x200) — gerçek BES logosu gibi kare değil.
  const logo = path.join(kok, 'logo.png');
  await sharp({
    create: { width: 300, height: 200, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } },
  }).png().toFile(logo);
  return { kok, res, logo, sablon };
}

test('her yoğunluğa splash.png yazılır ve şablon baytı DEĞİŞİR', async () => {
  const { kok, res, logo, sablon } = await kurulum();
  try {
    await svc.setupCapacitorSplash(kok, logo);
    for (const d of YOGUNLUKLAR) {
      const p = path.join(res, d, 'splash.png');
      assert.ok(await fs.pathExists(p), `${d}/splash.png yazılmadı`);
      const yeni = await fs.readFile(p);
      assert.ok(!yeni.equals(sablon), `${d}/splash.png şablonla AYNI kaldı (kusur geri geldi)`);
    }
  } finally {
    await fs.remove(kok);
  }
});

test('yatay ve dikey yoğunluklar farklı en-boy üretir', async () => {
  const { kok, res, logo } = await kurulum();
  try {
    await svc.setupCapacitorSplash(kok, logo);
    const port = await sharp(path.join(res, 'drawable-port-xxxhdpi', 'splash.png')).metadata();
    const land = await sharp(path.join(res, 'drawable-land-xxxhdpi', 'splash.png')).metadata();
    assert.ok(port.height > port.width, 'dikey splash dikey olmalı');
    assert.ok(land.width > land.height, 'yatay splash yatay olmalı');
  } finally {
    await fs.remove(kok);
  }
});

test('logo ortalanır ve zemin beyaz kalır (köşe beyaz, merkez logo rengi)', async () => {
  const { kok, res, logo } = await kurulum();
  try {
    await svc.setupCapacitorSplash(kok, logo);
    const p = path.join(res, 'drawable-land-xxhdpi', 'splash.png');
    const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true });
    const pik = (x, y) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const [kr, kg, kb] = pik(2, 2);
    assert.deepStrictEqual([kr, kg, kb], [255, 255, 255], 'köşe beyaz olmalı');
    const [mr, mg, mb] = pik(Math.floor(info.width / 2), Math.floor(info.height / 2));
    assert.ok(mr > 150 && mg < 90 && mb < 110, `merkezde logo rengi bekleniyordu, ${[mr, mg, mb]}`);
  } finally {
    await fs.remove(kok);
  }
});

test('geniş logo BOZULMAZ — contain ile yerleştirilir (kare değil kaynakta yayılma yok)', async () => {
  const { kok, res, logo } = await kurulum();
  try {
    await svc.setupCapacitorSplash(kok, logo);
    const p = path.join(res, 'drawable-port-xhdpi', 'splash.png');
    const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true });
    const beyazMi = (x, y) => {
      const i = (y * info.width + x) * info.channels;
      return data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255;
    };
    const cx = Math.floor(info.width / 2);
    // 300x200 logo kare kutuya contain edilirse üst/alt şeritler BEYAZ kalır.
    const kutu = Math.round(Math.min(info.width, info.height) * 0.38);
    const ust = Math.floor(info.height / 2) - Math.floor(kutu / 2) + 2;
    assert.ok(beyazMi(cx, ust), 'contain şeridi beyaz olmalı — logo kareye yayılmış');
  } finally {
    await fs.remove(kok);
  }
});

test('sharp patlarsa paketleme DÜŞMEZ (splash isteğe bağlıdır)', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-splash-hata-'));
  try {
    // Var olmayan logo yolu → sharp hata verir, metod yutmalı.
    await svc.setupCapacitorSplash(kok, path.join(kok, 'yok.png'));
  } finally {
    await fs.remove(kok);
  }
});
