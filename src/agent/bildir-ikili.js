'use strict';
/**
 * `bildir` ikilisini çağırma komutu (Windows'ta .cmd/.ps1 doğrudan spawn edilemez: Node ≥18.20 EINVAL).
 * ikiliKomutu(ikili, args) → [komut, args]. .ps1 → powershell -File; .cmd/.bat → doğrudan .ps1 kardeşi
 * varsa onu (cmd.exe argüman kaçışı Türkçe/özel karakter bozmasın), yoksa cmd /c. Diğerleri aynen.
 */
const fs = require('fs');
const path = require('path');

const PS = ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'];

function ikiliKomutu(ikili, args = [], { varMi = fs.existsSync } = {}) {
  const ext = path.extname(String(ikili)).toLowerCase();
  if (ext === '.ps1') return ['powershell', [...PS.slice(1), ikili, ...args]];
  if (ext === '.cmd' || ext === '.bat') {
    const kardes = ikili.slice(0, -ext.length) + '.ps1';
    if (varMi(kardes)) return ['powershell', [...PS.slice(1), kardes, ...args]];
    return ['cmd', ['/c', ikili, ...args]];
  }
  return [ikili, args];
}

module.exports = { ikiliKomutu };
