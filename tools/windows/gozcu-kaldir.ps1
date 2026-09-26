# GOZCU GERI ALMA — kurulan her seyi kaldirir. Test makinesine kalici bir sey
# birakmak yasak; kurulumun her adiminin bir geri adimi var.
#
# KALDIRILAN: zamanlanmis gorev + yedek Baslangic kisayolu + kosan gozcu sureci
#             + gozcu durum/gunluk dosyalari (istege bagli).
# KALDIRILMAYAN: izleyici (vm-izleyici.ps1) ve belirtec dosyasi — onlar gozcunun
#                kurdugu seyler DEGIL, gozcuden onceki kurulum. Gozcu kaldirilinca
#                sistem 2026-09-21 oncesi haline doner: izleyici elle yonetilir.
#
# NOT (kodlama): yorumlar bilerek ASCII (PowerShell 5.1 + BOM'suz UTF-8 tuzagi).

param(
  [string]$GorevAdi = 'vm-gozcu',
  [string]$Kok = 'C:\vm-kapi',
  [switch]$GunlukleriDeSil   # varsayilan: gunluk KALIR (kanit), yalniz istenirse silinir
)

$ErrorActionPreference = 'Continue'

# ADIM 1 — zamanlanmis gorevi durdur ve sil.
try {
  if (Get-ScheduledTask -TaskName $GorevAdi -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $GorevAdi -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $GorevAdi -Confirm:$false
    Write-Host "gorev silindi: $GorevAdi"
  } else {
    Write-Host "gorev zaten yok: $GorevAdi"
  }
} catch { Write-Host "UYARI: gorev silinemedi -> $($_.Exception.Message)" }

# ADIM 2 — yedek Baslangic kisayolu (gorev kaydi reddedilmisse kurulmustu).
$yedekCmd = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\vm-gozcu.cmd'
if (Test-Path $yedekCmd) {
  Remove-Item -Force $yedekCmd
  Write-Host "yedek baslangic kisayolu silindi: $yedekCmd"
}

# ADIM 3 — kosan gozcu surecini kapat. Yalniz vm-gozcu.ps1 gecen powershell
# surecleri; IZLEYICIYE DOKUNULMAZ (o calismaya devam etsin).
$sayi = 0
try {
  $hepsi = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -in @('powershell.exe', 'pwsh.exe') }
  foreach ($p in $hepsi) {
    if ($p.ProcessId -eq $PID) { continue }
    if ($p.CommandLine -and $p.CommandLine -like '*vm-gozcu.ps1*') {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
      $sayi = $sayi + 1
    }
  }
} catch { }
Write-Host "kapatilan gozcu sureci: $sayi"

# ADIM 4 — gozcunun kendi durum dosyasi (mudahale gecmisi, gorulen tetik).
$durum = Join-Path $Kok 'gozcu-durum.json'
if (Test-Path $durum) { Remove-Item -Force $durum; Write-Host "durum dosyasi silindi: $durum" }

# ADIM 5 — gunluk. VARSAYILAN: KALIR. Gunluk, gozcunun ne zaman ne yaptiginin tek
# kanitidir; kaldirma sirasinda kanit silmek arizayi gorunmez yapar.
if ($GunlukleriDeSil) {
  foreach ($g in @((Join-Path $Kok 'gozcu.log'), (Join-Path $Kok 'gozcu.log.1'))) {
    if (Test-Path $g) { Remove-Item -Force $g; Write-Host "gunluk silindi: $g" }
  }
} else {
  Write-Host "gunluk KORUNDU: $Kok\gozcu.log  (silmek icin -GunlukleriDeSil)"
}

Write-Host ''
Write-Host 'GERI ALINDI. Dogrulama:'
Write-Host "  Get-ScheduledTask -TaskName $GorevAdi -ErrorAction SilentlyContinue   # bos donmeli"
Write-Host '  Get-CimInstance Win32_Process | ? { $_.CommandLine -like "*vm-gozcu.ps1*" }   # bos donmeli'
Write-Host 'Mac tarafinda gozcu kalbi artik tazelenmez:'
Write-Host '  node tools/windows/vm-kapi.js hazir --makine windows-kasa-gozcu   # yas buyumeye baslar'
