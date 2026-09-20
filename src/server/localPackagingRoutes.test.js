'use strict';
// K11b (2026-09-09) — `localPackagingRoutes.js`'in `/download/:jobId/:platform`
// route'u (K11 taramasında bulunan ikinci `res.download` çağrısı, item-3
// denetimi) artık K11'in `buildContentDisposition` yardımcısını kullanıyor.
// Bu router `app.js`'in kendi (daha ÖNCE tanımlı) `/api/download/:jobId/:platform`
// route'u tarafından GÖLGELENİR (Express aynı path'te İLK eşleşen katmanı
// çalıştırır) — bu yüzden test burada router'ı TEK BAŞINA, app.js'i (ve onun
// server.listen yan etkisini) hiç require ETMEDEN, izole bir Express app'e
// mount ederek gerçek bir HTTP isteğiyle doğrular.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const express = require('express');
const fsExtra = require('fs-extra');

function startIsolatedApp(router, cwd) {
  return new Promise((resolve) => {
    const app = express();
    app.use('/api', router);
    const server = app.listen(0, '127.0.0.1', () => resolve({ app, server, port: server.address().port }));
  });
}

test('GERİLEME (K11b): /api/download Türkçe dosya adında 500 vermez (ERR_INVALID_CHAR yok)', async (t) => {
  const prevCwd = process.cwd();
  const tmpRoot = fsExtra.mkdtempSync(path.join(os.tmpdir(), 'local-pkg-route-test-'));
  const jobId = 'job1';
  const platform = 'windows';
  const platformDir = path.join(tmpRoot, 'temp', jobId, platform);
  await fsExtra.ensureDir(platformDir);
  const trFileName = 'UcanBalık60+ 2023-v1.0.0.exe'; // ı — Latin-1 dışı (K11 vakası)
  await fsExtra.writeFile(path.join(platformDir, trFileName), 'sahte-exe-icerik');

  process.chdir(tmpRoot); // route 'temp/<job>/<platform>' göreli yol kullanıyor
  const router = require('./localPackagingRoutes');
  const { server, port } = await startIsolatedApp(router, tmpRoot);
  t.after(() => { server.close(); process.chdir(prevCwd); fsExtra.removeSync(tmpRoot); });

  const result = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: `/api/download/${jobId}/${platform}` }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, header: res.headers['content-disposition'], body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });

  assert.strictEqual(result.status, 200, `500 DEĞİL 200 beklenir (alınan body: ${result.body.slice(0, 200)})`);
  assert.ok(result.header, 'Content-Disposition header seti olmalı');
  assert.doesNotMatch(result.header, /ı|İ|ğ|Ğ|ş|Ş/, 'ASCII fallback bölümü Latin-1 dışı Türkçe harf İÇERMEMELİ');
  assert.match(result.header, /filename\*=UTF-8''/, "RFC 5987 filename*=UTF-8'' parçası olmalı (K11 yardımcısı kullanılmış kanıtı)");
});

test('kaynak-sentinel: localPackagingRoutes /download route buildContentDisposition kullanır, ham res.download DEĞİL', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(__dirname, 'localPackagingRoutes.js'), 'utf8');
  assert.match(src, /require\(['"]\.\/content-disposition['"]\)/);
  const routeStart = src.indexOf("router.get('/download/:jobId/:platform'");
  const routeEnd = src.indexOf('module.exports', routeStart);
  const routeBody = src.slice(routeStart, routeEnd === -1 ? routeStart + 2000 : routeEnd);
  assert.match(routeBody, /buildContentDisposition\(/);
  assert.doesNotMatch(routeBody, /res\.download\(/, 'ham res.download kalmamalı — K11 yardımcısına bağlanmış olmalı');
});
