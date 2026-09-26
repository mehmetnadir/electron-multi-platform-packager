'use strict';
/**
 * mac DMG imza / noter katmanı. Üç komutun ham sonucu rapora girer:
 *   codesign --verify --deep --strict --verbose=2 <App.app>
 *   xcrun stapler validate <paket.dmg>
 *   spctl -a -t open --context context:primary-signature -v <paket.dmg>
 * Noter bileti zımbalanmamışsa (staple yok) ya da Gatekeeper "Notarized Developer ID"
 * demiyorsa paket RED: okulda internetsiz açılan bir DMG'yi Gatekeeper engeller.
 * Komutların hiçbiri pencere açmaz, odak çalmaz.
 */
const { spawnSync } = require('child_process');

function kos(komut, argumanlar) {
  const r = spawnSync(komut, argumanlar, { encoding: 'utf8', timeout: 120000 });
  return {
    komut: [komut, ...argumanlar].join(' '),
    rc: r.status === null ? -1 : r.status,
    cikti: `${r.stdout || ''}${r.stderr || ''}`.trim().slice(0, 2000),
  };
}

/** Ham denetim (I/O). */
function macImzaDenetle({ dmg, appYolu }) {
  return {
    codesign: kos('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appYolu]),
    stapler: kos('xcrun', ['stapler', 'validate', dmg]),
    spctl: kos('spctl', ['-a', '-t', 'open', '--context', 'context:primary-signature', '-v', dmg]),
    spctlUygulama: kos('spctl', ['-a', '-t', 'exec', '-vv', appYolu]),
  };
}

/**
 * Saf karar. `spctlUygulama` yalnız bilgidir (bağlama noktasından exec değerlendirmesi
 * bazı sürümlerde tutarsız); karar üç zorunlu komuttan çıkar.
 * @returns {{durum:'GECTI'|'RED'|'OLCULEMEDI', sebepler:string[]}}
 */
function imzaKarari(s) {
  if (!s || !s.codesign || !s.stapler || !s.spctl) {
    return { durum: 'OLCULEMEDI', sebepler: ['imza denetimi koşmadı'] };
  }
  const sebepler = [];
  if (s.codesign.rc !== 0) sebepler.push(`codesign doğrulaması düştü (rc=${s.codesign.rc}): ${s.codesign.cikti.split('\n').slice(-1)[0]}`);
  if (s.stapler.rc !== 0 || !/worked/i.test(s.stapler.cikti)) {
    sebepler.push(`noter bileti zımbalı DEĞİL (stapler rc=${s.stapler.rc}): ${s.stapler.cikti.split('\n').slice(-1)[0]}`);
  }
  if (s.spctl.rc !== 0 || !/accepted/i.test(s.spctl.cikti) || !/Notarized/i.test(s.spctl.cikti)) {
    sebepler.push(`Gatekeeper noterli DMG olarak kabul etmedi (spctl rc=${s.spctl.rc}): ${s.spctl.cikti.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  return { durum: sebepler.length ? 'RED' : 'GECTI', sebepler };
}

module.exports = { macImzaDenetle, imzaKarari };
