# windows-kasa — İmpark OpenVPN kurulumu (Nadir onayı 03.10, şef iletti). SIR YOK: parola bu betikte,
# argümanda ya da logda geçmez. Kimlik dosyasını ŞEF yazar (Mac Anahtar Zinciri → stdin → dosya).
#
# Kullanım (yönetici):
#   powershell -ExecutionPolicy Bypass -File impark-vpn-kur.ps1 -Msi D:\empp-ajan\vpn\OpenVPN-<sürüm>-I001-amd64.msi
#   powershell -ExecutionPolicy Bypass -File impark-vpn-kur.ps1 -Dogrula      (yalnız ölç)
#
# Yerleşim (D:\empp-ajan\vpn, ACL: SYSTEM + Administrators + Administrator, kalıtım kapalı):
#   impark-taban.ovpn  Mac ~/.impark/impark.ovpn'in içeriğine bakılmadan kopyası (satır içi istemci anahtarı taşır)
#   impark-kimlik.txt  ŞEF yazar: 1. satır kullanıcı (nadir.arslan), 2. satır parola; BOM YOK
#   openvpn-msi.log    msiexec günlüğü
# <OpenVPN>\config-auto\impark-kasa.ovpn — sarmalayıcı: tabanı çağırır, kimlik yolunu verir ve
# sunucunun ittiği rotalardan YALNIZ 172.17.0.0/16 + 10.255.255.0/24'ü kabul eder (varsayılan rota,
# DNS ve IPv6 itmeleri yok sayılır → kasanın internet trafiği tünele girmez).
# OpenVPNService (otomatik başlar) config-auto'daki her .ovpn'i oturum açılmadan koşturur.
param([string]$Msi = '', [switch]$Dogrula)
$ErrorActionPreference = 'Stop'
$Kok = 'D:\empp-ajan\vpn'
$Taban = "$Kok\impark-taban.ovpn"
$Kimlik = "$Kok\impark-kimlik.txt"
$Sarmal = 'impark-kasa.ovpn'

function OvpnKok {
  $k = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\OpenVPN' -ErrorAction SilentlyContinue).'(default)'
  if (-not $k) { $k = 'C:\Program Files\OpenVPN' }
  return $k.TrimEnd('\')
}

function Olc {
  $o = [ordered]@{}
  $svc = Get-Service OpenVPNService -ErrorAction SilentlyContinue
  $o.servis = if ($svc) { "$($svc.Status)/$($svc.StartType)" } else { 'yok' }
  $o.kimlikDosyasi = Test-Path $Kimlik
  $o.ping_172_17_2_21 = Test-Connection -ComputerName 172.17.2.21 -Count 1 -Quiet
  $o.smb445_172_17_2_23 = (Test-NetConnection -ComputerName 172.17.2.23 -Port 445 -WarningAction SilentlyContinue).TcpTestSucceeded
  $rotalar = Get-NetRoute -AddressFamily IPv4 | Where-Object { $_.DestinationPrefix -like '172.17.*' -or $_.DestinationPrefix -like '10.255.255.*' -or $_.DestinationPrefix -eq '0.0.0.0/0' }
  $o.rotalar = @($rotalar | ForEach-Object { "$($_.DestinationPrefix) via $($_.NextHop) if$($_.InterfaceIndex) ($((Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue).InterfaceDescription))" })
  $o | ConvertTo-Json -Depth 3
}

if ($Dogrula) { Olc; exit 0 }

if (-not (Test-Path $Taban)) { throw "taban profil yok: $Taban (Mac'ten içeriğine bakmadan scp ile taşınır)" }
if (-not $Msi -or -not (Test-Path $Msi)) { throw "MSI yok: '$Msi' (resmî OpenVPN MSI, swupdate.openvpn.net)" }

# 1) MSI resmî mi? Authenticode Valid + imzacı OpenVPN Inc.
$s = Get-AuthenticodeSignature -LiteralPath $Msi
if ($s.Status -ne 'Valid' -or "$($s.SignerCertificate.Subject)" -notmatch 'OpenVPN') {
  throw "MSI imzası geçersiz ya da OpenVPN değil: $($s.Status) · $($s.SignerCertificate.Subject)"
}
"MSI imzası: $($s.Status) · $($s.SignerCertificate.Subject)"

# 2) Kurulum: GUI YOK (odak çalan pencere/tepsi simgesi istemiyoruz) — çekirdek + servis + sürücüler.
# Özellik adları sürüme göre değişir (2.7.7'de Drivers.Wintun YOK → 2711/1603, ölçüldü 03.10):
# istenen listeden yalnız MSI'nin Feature tablosunda olanlar verilir.
$wi = New-Object -ComObject WindowsInstaller.Installer
$db = $wi.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $wi, @($Msi, 0))
$gor = $db.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $db, @('SELECT Feature FROM Feature'))
$gor.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $gor, $null) | Out-Null
$mevcut = @()
while ($kayit = $gor.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $gor, $null)) {
  $mevcut += $kayit.GetType().InvokeMember('StringData', 'GetProperty', $null, $kayit, 1)
}
$gor.GetType().InvokeMember('Close', 'InvokeMethod', $null, $gor, $null) | Out-Null
$istenen = @('OpenVPN', 'OpenVPN.Service', 'Drivers', 'Drivers.OvpnDco', 'Drivers.Wintun', 'Drivers.TAPWindows6')
$ozellik = @($istenen | Where-Object { $mevcut -contains $_ })
if (-not ($ozellik -contains 'OpenVPN.Service')) { throw "MSI'de OpenVPN.Service özelliği yok (mevcut: $($mevcut -join ','))" }
"MSI özellikleri: $($mevcut -join ',') → kurulacak: $($ozellik -join ',')"
$log = "$Kok\openvpn-msi.log"
$argv = @('/i', "`"$Msi`"", "ADDLOCAL=$($ozellik -join ',')",
  '/qn', '/norestart', '/l*v', "`"$log`"")
$p = Start-Process -FilePath msiexec.exe -ArgumentList $argv -Wait -PassThru
if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw "msiexec çıkış $($p.ExitCode) — günlük: $log" }
"msiexec çıkış $($p.ExitCode)"

# 3) Sarmalayıcı (BOM'suz; OpenVPN yapılandırmasında ters bölü kaçış karakteridir → çift yazılır).
$ok = OvpnKok
$auto = "$ok\config-auto"
New-Item -ItemType Directory -Force $auto | Out-Null
$c = @(
  '# windows-kasa İmpark sarmalayıcısı — tools/windows/kasa-ajan/impark-vpn-kur.ps1 üretir. Sır YOK.',
  ('config "' + ($Taban -replace '\\', '\\') + '"'),
  ('auth-user-pass "' + ($Kimlik -replace '\\', '\\') + '"'),
  'auth-nocache',
  'auth-retry nointeract',
  'pull-filter accept "route 172.17."',
  'pull-filter accept "route 10.255.255."',
  'pull-filter ignore "route "',
  'pull-filter ignore "route-ipv6"',
  'pull-filter ignore "ifconfig-ipv6"',
  'pull-filter ignore "redirect-gateway"',
  'pull-filter ignore "dhcp-option"',
  'pull-filter ignore "block-outside-dns"',
  'verb 3'
) -join "`n"
[IO.File]::WriteAllText("$auto\$Sarmal", $c + "`n", (New-Object Text.UTF8Encoding $false))
# OpenVPN 2.7 servisi sanal hesapla koşar (NT SERVICE\OpenVPNService, ölçüldü 03.10): okuma izni olmadan
# "Error opening configuration file" verir. Okuma YALNIZ bu hesaba ve yöneticilere.
$svcHesap = 'NT SERVICE\OpenVPNService'
icacls "$auto\$Sarmal" /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' "${svcHesap}:R" | Out-Null
icacls $Kok /grant "${svcHesap}:RX" | Out-Null
foreach ($f in @($Taban, $Kimlik)) { if (Test-Path $f) { icacls $f /grant "${svcHesap}:R" | Out-Null } }
"sarmalayıcı: $auto\$Sarmal (okuma: $svcHesap)"

# 4) Servis: otomatik başlasın; kimlik dosyası yoksa BAŞLATMA (parolasız deneme sunucuda kilitlenme sayacını artırır).
Set-Service -Name OpenVPNService -StartupType Automatic
if (Test-Path $Kimlik) {
  Restart-Service -Name OpenVPNService
  Start-Sleep -Seconds 20
  Olc
} else {
  "kimlik dosyası yok ($Kimlik) — servis BAŞLATILMADI; şef dosyayı yazınca: Restart-Service OpenVPNService"
}
