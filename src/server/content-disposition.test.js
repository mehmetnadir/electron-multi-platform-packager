'use strict';
// K11 (2026-09-09, tudem-apk-batch kanıtı) — `buildContentDisposition` GERÇEK
// bir HTTP sunucusu üzerinden `res.setHeader` çağrısıyla doğrulanır (yalnız
// string üretimi değil — Node'un http header doğrulamasından GEÇTİĞİ kanıtlanır).
//
// Olay: UcanBalık60+_2023.iso'dan üretilen APK dosya adı Türkçe "ı" taşıyor
// (`UcanBalık60+ 2023-v1.0.0.apk`). `/api/download/:jobId/:platform` ham
// `filename="${fileName}"` yazınca Node `TypeError [ERR_INVALID_CHAR]: Invalid
// character in header content ["Content-Disposition"]` fırlatıyor — build
// başarılı, dosya diskte sağlam, ama indirme endpoint'i 500 veriyor.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { buildContentDisposition, toAsciiFallback } = require('./content-disposition');

// Gerçek bir HTTP sunucusu üzerinden setHeader'ın patlayıp patlamadığını ölçer
// (yalnız string eşleştirme değil — Node'un KENDİ header doğrulamasından geçer).
function trySetHeaderOverHttp(disposition) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        res.setHeader('Content-Disposition', disposition);
        res.end('ok');
      } catch (e) {
        res.statusCode = 999; // ayirt edilebilir bir isaret, gercek response asla kullanilmaz
        res.end('THREW:' + e.message);
      }
    });
    server.listen(0, () => {
      http.get({ port: server.address().port }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          server.close();
          resolve({ headerValue: res.headers['content-disposition'], threw: body.startsWith('THREW:'), body });
        });
      });
    });
  });
}

test('(a) Türkçe "ı" taşıyan dosya adı GERÇEK res.setHeader\'da artık patlamıyor', async () => {
  const disposition = buildContentDisposition('UcanBalık60+ 2023-v1.0.0.apk');
  const result = await trySetHeaderOverHttp(disposition);
  assert.strictEqual(result.threw, false, 'setHeader exception FIRLATMAMALI (kanitin gucu): ' + result.body);
  assert.ok(result.headerValue.includes('filename='));
  assert.ok(result.headerValue.includes("filename*=UTF-8''"));
});

test('(b) header hem ASCII filename= hem filename*=UTF-8\'\' icerir', () => {
  const disposition = buildContentDisposition('UcanBalık60+ 2023-v1.0.0.apk');
  assert.match(disposition, /filename="UcanBalik60\+ 2023-v1\.0\.0\.apk"/, 'ASCII fallback: ı -> i');
  assert.match(disposition, /filename\*=UTF-8''UcanBal%C4%B1k60%2B%202023-v1\.0\.0\.apk/, 'gercek ad percent-encoded');
});

test('(c) ASCII fallback: Turkce harfler dogru harf karsiliklarina donusur', () => {
  assert.strictEqual(toAsciiFallback('İstanbul Şık Çözüm Öğüt Ürün ı ğ'), 'Istanbul Sik Cozum Ogut Urun i g');
});

test('(d) diger aksanli harfler (e, a, n) de ASCII\'ye indirgenir', () => {
  const out = toAsciiFallback('café niño');
  assert.strictEqual(out, 'cafe nino');
});

test('(e) quoted-string\'i kirabilecek " ve \\\\ karakterleri temizlenir', () => {
  const out = toAsciiFallback('a"b\\c.apk');
  assert.ok(!out.includes('"'));
  assert.ok(!out.includes('\\'));
});

test('(f) REGRESYON: ASCII-only ad eski davranista kalir (filename= AYNI ad)', () => {
  const disposition = buildContentDisposition('Flashy Grade 8 Set-1.0.0.apk');
  assert.match(disposition, /filename="Flashy Grade 8 Set-1\.0\.0\.apk"/);
  assert.match(disposition, /filename\*=UTF-8''Flashy%20Grade%208%20Set-1\.0\.0\.apk/);
});

test('(g) inline disposition destegi (logoService kullanimi)', () => {
  const disposition = buildContentDisposition('logoçç.png', 'inline');
  assert.match(disposition, /^inline;/);
});

// --- Mutasyon kaniti ---
test('GERİLEME: RFC5987 satırı kaldırılırsa Türkçe adlı dosya indirme 500 verir (eski davranış geri döner)', async () => {
  // Eski (bozuk) davranisin DOGRUDAN simulasyonu: ham UTF-8 filename.
  const brokenDisposition = 'attachment; filename="UcanBalık60+ 2023-v1.0.0.apk"';
  const brokenResult = await trySetHeaderOverHttp(brokenDisposition);
  assert.strictEqual(brokenResult.threw, true, 'eski (duzeltilmemis) davranis GERCEKTEN patliyor (kanitin gucu)');

  // Gercek (duzeltilmis) fonksiyon bunun onune gecer:
  const fixedDisposition = buildContentDisposition('UcanBalık60+ 2023-v1.0.0.apk');
  const fixedResult = await trySetHeaderOverHttp(fixedDisposition);
  assert.strictEqual(fixedResult.threw, false, 'duzeltilmis fonksiyon patlamamali');
});

// --- Kaynak-sentinel ---
test('kaynak-sentinel: app.js download route buildContentDisposition kullanir (ham filename YOK)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  assert.match(src, /buildContentDisposition\(fileName\)/);
  assert.match(src, /buildContentDisposition\(zipFileName\)/);
  // Ham `filename="${...}"` deseni HİÇ olmamalı (regresyon: biri geri eklerse yakalar).
  assert.doesNotMatch(src, /Content-Disposition['"],\s*`attachment; filename="\$\{/);
});

test('kaynak-sentinel: logoService.js de buildContentDisposition kullanir', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'utils', 'logoService.js'), 'utf8');
  assert.match(src, /buildContentDisposition\(logo\.fileName/);
});
