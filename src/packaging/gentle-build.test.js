'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Kaynak-sentinel: NAZİK BUILD GENEL KURALI (2026-09-07, Nadir talebi).
 * srv21 paylaşılan üretim sunucusu — canlı siteler (yayıncı panelleri, API'ler) orada koşuyor.
 * 2 paralel electron-builder/mksquashfs build'i sunucuyu ittirdi, siteler yavaşladı.
 * Kural: Linux'ta HER electron-builder çağrısı `nice -n 19 ionice -c 3` altında koşar;
 * nice/ionice çocuklara (mksquashfs/fpm/dpkg-deb) miras kalır → ağır I/O canlı trafiği aç bırakmaz.
 * macOS/win dev makinesinde sarma yok. Acil kapatma: EMPP_GENTLE=0.
 */
const SRC = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');

test('Linux build nice -n 19 + ionice -c 3 ile sarılır', () => {
  assert.match(SRC, /process\.platform === 'linux' && process\.env\.EMPP_GENTLE !== '0'/);
  assert.match(SRC, /command:\s*'nice',\s*args:\s*\['-n',\s*'19',\s*'ionice',\s*'-c',\s*'3'/);
});

test('sarma yalnız Linux — mac/win taban binary döner', () => {
  // base değişkeni her platformda kurulur, sarma sadece linux dalında
  assert.match(SRC, /let base;/);
  assert.match(SRC, /return base;/);
});

test('acil kaçış kapısı var (EMPP_GENTLE=0)', () => {
  assert.match(SRC, /EMPP_GENTLE/);
});
