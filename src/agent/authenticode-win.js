'use strict';
/**
 * Windows'ta Authenticode doğrulaması — `osslsigncode verify` yerine `Get-AuthenticodeSignature`
 * (WinVerifyTrust: özet + zincir + iptal denetimi Windows'un kendisinde). Kasa ajanı (windows-kasa)
 * imzalı kopyayı bununla doğrular; Mac yolu osslsigncode'da kalır.
 *
 * Hüküm (saf, `authenticodeKarari`): Status = Valid · SignatureType = Authenticode · imzacı CN'i
 * beklenen (İm Park Bilişim) · zaman damgası (countersignature) var · imzacı zincirinde DigiCert.
 *
 * PowerShell çıktısı UTF-8 JSON'un base64'ü olarak alınır: konsol kod sayfası (cp857/cp1254)
 * "İm Park Bilişim"i bozamaz.
 *
 * Kasa ölçümü (04.10, ilk canlı imza 72378): imza Valid iken hüküm "çıktısı çözülemedi" dedi. İki kök:
 *   1) windows-serit.komutKos `detached: true` ile başlatır; Windows'ta bu, powershell'e ayrı konsol
 *      verir ve stdout boru'ya hiç düşmez (ölçüm: detached → 0 B, değil → 1188 B).
 *   2) powershell ilk kullanımda stderr'e CLIXML ilerleme kaydı yazar ("Preparing modules for first
 *      use", 616 B); komutKos stdout+stderr'i birleştirdiği için "son kelime" base64 değildi.
 * Bu yüzden: kendi ayrık-olmayan koşucusu (yalnız stdout çözülür), `$ProgressPreference` kapalı ve
 * base64 `EMPPAC:` işaretiyle aranır.
 */
const { spawn } = require('child_process');

const ISARET = 'EMPPAC:';

const PS_BETIK = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  '$s = Get-AuthenticodeSignature -LiteralPath $env:EMPP_AUTHENTICODE_YOL',
  '$zincir = @()',
  'if ($s.SignerCertificate) {',
  '  $ch = New-Object System.Security.Cryptography.X509Certificates.X509Chain',
  '  [void]$ch.Build($s.SignerCertificate)',
  '  $zincir = @($ch.ChainElements | ForEach-Object { $_.Certificate.Subject })',
  '}',
  '$o = [ordered]@{',
  '  Status = [string]$s.Status',
  '  StatusMessage = [string]$s.StatusMessage',
  '  SignatureType = [string]$s.SignatureType',
  '  Signer = $(if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { $null })',
  '  SignerIssuer = $(if ($s.SignerCertificate) { $s.SignerCertificate.Issuer } else { $null })',
  '  Thumbprint = $(if ($s.SignerCertificate) { $s.SignerCertificate.Thumbprint } else { $null })',
  '  TimeStamper = $(if ($s.TimeStamperCertificate) { $s.TimeStamperCertificate.Subject } else { $null })',
  '  Zincir = $zincir',
  '}',
  '$j = $o | ConvertTo-Json -Compress -Depth 4',
  "[Console]::Out.Write('EMPPAC:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($j)))",
].join('\n');

/** powershell argv'si (-EncodedCommand: UTF-16LE base64 — tırnak/kaçış sorunu yok). Saf. */
function authenticodeArgv(powershell = 'powershell.exe') {
  return [powershell, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(PS_BETIK, 'utf16le').toString('base64')];
}

/** Base64 çıktıyı nesneye çevirir; çözülemezse null. Saf. Önce `EMPPAC:` işareti (araya stderr
 *  karışsa da bulunur), yoksa eski biçim: son boşluksuz kelime. */
function authenticodeCozumle(cikti) {
  const ham = String(cikti || '');
  const m = new RegExp(`${ISARET}([A-Za-z0-9+/=]+)`).exec(ham);
  const s = m ? m[1] : (ham.trim().split(/\s+/).pop() || '');
  if (!/^[A-Za-z0-9+/=]+$/.test(s)) return null;
  try {
    const o = JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch (_) { return null; }
}

/** "CN=x, O=y" içinden CN. Saf. */
function cnAl(dn) {
  const m = /(?:^|,\s*)CN=("(?:[^"]|"")*"|[^,]+)/.exec(String(dn || ''));
  if (!m) return null;
  return m[1].startsWith('"') ? m[1].slice(1, -1).replace(/""/g, '"').trim() : m[1].trim();
}

/**
 * Hüküm. `r` = komutKos sonucu ({kod, cikti, hata, zamanAsimi}). Saf.
 * @returns {{gecti:boolean, sebep:string, imzaci:string|null, zamanDamgasi:string|null, ham:object|null}}
 */
function authenticodeKarari(r, beklenenImzaci) {
  const o = r && !r.hata && !r.zamanAsimi && r.kod === 0 ? authenticodeCozumle(r.cikti) : null;
  const imzaci = o ? cnAl(o.Signer) : null;
  const zamanDamgasi = o && o.TimeStamper ? cnAl(o.TimeStamper) || String(o.TimeStamper) : null;
  const sonuc = (gecti, sebep) => ({ gecti, sebep, imzaci, zamanDamgasi, ham: o });
  if (!r || r.hata) return sonuc(false, `Get-AuthenticodeSignature başlatılamadı: ${(r && r.hata) || 'sonuç yok'}`);
  if (r.zamanAsimi) return sonuc(false, 'Get-AuthenticodeSignature zaman aşımı');
  if (r.kod !== 0) return sonuc(false, `powershell çıkış ${r.kod}: ${String(r.cikti || '').trim().slice(-160)}`);
  if (!o) return sonuc(false, 'Get-AuthenticodeSignature çıktısı çözülemedi');
  if (o.Status !== 'Valid') return sonuc(false, `Status ${o.Status || '?'}: ${String(o.StatusMessage || '').slice(0, 160)}`);
  if (o.SignatureType && o.SignatureType !== 'Authenticode') return sonuc(false, `imza türü ${o.SignatureType}`);
  if (!imzaci || !imzaci.includes(beklenenImzaci)) {
    return sonuc(false, `imzacı beklenen "${beklenenImzaci}" değil: ${imzaci || 'okunamadı'}`);
  }
  if (!zamanDamgasi) return sonuc(false, 'zaman damgası (countersignature) yok');
  const zincir = Array.isArray(o.Zincir) ? o.Zincir : (o.Zincir ? [o.Zincir] : []);
  if (!zincir.slice(1).some((s) => /DigiCert/i.test(String(s)))) {
    return sonuc(false, `imzacı zincirinde DigiCert yok: ${zincir.slice(1).map(cnAl).join(' → ') || 'zincir boş'}`);
  }
  return sonuc(true, 'ok');
}

/**
 * powershell koşucusu: AYRIK DEĞİL (detached Windows'ta stdout'u boru dışına atar) ve yalnız stdout
 * çözülür; stderr ayrı tutulur, çıkış kodu ≠ 0 ise sebebe eklenir. komutKos ile aynı sonuç biçimi.
 */
function psKos(argv, { env = {}, zamanAsimiMs = 0, kosucu = spawn } = {}) {
  return new Promise((coz) => {
    let bitti = false;
    const bitir = (v) => { if (!bitti) { bitti = true; coz(v); } };
    let cocuk;
    try {
      cocuk = kosucu(argv[0], argv.slice(1), {
        env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
    } catch (e) { bitir({ kod: -1, hata: e.message, cikti: '', zamanAsimi: false }); return; }
    let out = '';
    let err = '';
    let zamanAsimi = false;
    cocuk.stdout.on('data', (d) => { out += d.toString(); });
    cocuk.stderr.on('data', (d) => { err += d.toString(); });
    const t = zamanAsimiMs > 0 ? setTimeout(() => {
      zamanAsimi = true;
      try { cocuk.kill(); } catch (_) { /* ölü */ }
    }, zamanAsimiMs) : null;
    cocuk.on('error', (e) => { if (t) clearTimeout(t); bitir({ kod: -1, hata: e.message, cikti: out, zamanAsimi }); });
    cocuk.on('close', (kod) => {
      if (t) clearTimeout(t);
      const k = kod == null ? -1 : kod;
      bitir({ kod: k, cikti: k === 0 ? out : `${out}${err}`, hataCikti: err, zamanAsimi });
    });
  });
}

/**
 * Dosyayı doğrular (yalnız win32). `komutKos` geriye uyum için kabul edilir ama KULLANILMAZ
 * (ayrık başlatır → stdout kaybolur, yukarıdaki ölçüm); `kos` test için enjekte edilebilir.
 */
// eslint-disable-next-line no-unused-vars
async function authenticodeDogrula(dosya, {
  komutKos, beklenenImzaci, powershell, zamanAsimiMs = 10 * 60000, kos = psKos,
}) {
  const r = await kos(authenticodeArgv(powershell), { env: { EMPP_AUTHENTICODE_YOL: dosya }, zamanAsimiMs });
  return authenticodeKarari(r, beklenenImzaci);
}

module.exports = {
  PS_BETIK, ISARET, authenticodeArgv, authenticodeCozumle, cnAl, authenticodeKarari, psKos, authenticodeDogrula,
};
