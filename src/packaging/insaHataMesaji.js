/**
 * Electron Builder hata mesajını detaylı ve filtrelenmiş olarak inşa eder.
 *
 * @param {string} platform - Hedef platform (mac, win, linux vs.)
 * @param {number|string} code - Çıkış kodu (exit code)
 * @param {string} [errorOutput] - Stderr / hata çıktısı
 * @param {string} [output] - Stdout / genel çıktı
 * @returns {string} İnşa edilmiş hata mesajı
 */
function insaHataMesaji(platform, code, errorOutput, output) {
  const baseMessage = `Electron Builder ${platform} build failed (exit code ${code})`;

  const rawOutput = errorOutput || output || '';
  if (!rawOutput) {
    return baseMessage;
  }

  // 1. ANSI renk kodlarını temizle
  const cleanAnsi = String(rawOutput).replace(/\x1b\[[0-9;]*m/g, '');

  // 2. Satırları kırp ve boş satırları at
  const rawLines = cleanAnsi.split(/\r?\n/);
  const lines = rawLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return baseMessage;
  }

  // 3. Sır sızmasın: secret kelimeleri içeren satırlarda = veya : sonrası değeri *** yap
  const secretKeywords = [
    'password',
    'apple_id_password',
    'apple_app_specific_password',
    'csc_key_password',
    'token',
    'secret'
  ];
  const secretRegex = new RegExp(secretKeywords.join('|'), 'i');

  const maskedLines = lines.map((line) => {
    if (secretRegex.test(line)) {
      const keyMatch = line.match(new RegExp(`((?:${secretKeywords.join('|')})[^=:]*[:=]\\s*).*`, 'i'));
      if (keyMatch) {
        return line.replace(new RegExp(`((?:${secretKeywords.join('|')})[^=:]*[:=]\\s*).*`, 'i'), '$1***');
      }
      if (/[=:]/.test(line)) {
        return line.replace(/([=:]\s*).*/, '$1***');
      }
    }
    return line;
  });

  // 4. Satırları birleştir ve son 800 karakteri al
  const combined = maskedLines.join('\n');
  const detay = combined.length > 800 ? combined.slice(-800) : combined;

  if (!detay) {
    return baseMessage;
  }

  return `${baseMessage} — ${detay}`;
}

module.exports = { insaHataMesaji };
