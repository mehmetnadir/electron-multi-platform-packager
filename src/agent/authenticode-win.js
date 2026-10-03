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
 */

const PS_BETIK = [
  "$ErrorActionPreference = 'Stop'",
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
  '[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($j)))',
].join('\n');

/** powershell argv'si (-EncodedCommand: UTF-16LE base64 — tırnak/kaçış sorunu yok). Saf. */
function authenticodeArgv(powershell = 'powershell.exe') {
  return [powershell, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(PS_BETIK, 'utf16le').toString('base64')];
}

/** Base64 çıktıyı nesneye çevirir; çözülemezse null. Saf. */
function authenticodeCozumle(cikti) {
  const s = String(cikti || '').trim().split(/\s+/).pop() || '';
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

/** Dosyayı doğrular (yalnız win32). komutKos: windows-serit.komutKos imzası. */
async function authenticodeDogrula(dosya, { komutKos, beklenenImzaci, powershell, zamanAsimiMs = 10 * 60000 }) {
  const r = await komutKos(authenticodeArgv(powershell), { env: { EMPP_AUTHENTICODE_YOL: dosya }, zamanAsimiMs });
  return authenticodeKarari(r, beklenenImzaci);
}

module.exports = { PS_BETIK, authenticodeArgv, authenticodeCozumle, cnAl, authenticodeKarari, authenticodeDogrula };
