# GOZCU KURULUMU — tek seferlik, Windows makinesinde (windows-kasa) elle kosulur.
#
# NE YAPAR (ozet): vm-gozcu.ps1'i oturum acilisinda baslatan ve 5 dakikada bir
# "hala kosuyor mu" diye bakan bir ZAMANLANMIS GOREV kaydeder. SERVIS DEGILDIR —
# servis Oturum 0'da kosar, oradan ekran goruntusu SIYAH gelir ve kabul kapisinin
# "ekran kaniti" sarti coker. Gorev, oturum acmis kullanicinin MASAUSTU oturumunda
# kosar; izleyicinin Ekran-Al'i calismaya devam eder.
#
# ACILAN PORT: YOK. Kurulan servis: YOK. Degisen guvenlik duvari kurali: YOK.
# GERI ALMA: tools\windows\gozcu-kaldir.ps1  (tek komut, iz birakmaz)
#
# NOT (kodlama): yorumlar bilerek ASCII — PowerShell 5.1 BOM'suz UTF-8'de Turkce
# harfleri bozuyor, bozulan govde hic acilmaz.

param(
  # Host kopru adresi. Tailscale uzerinden: http://<mac-tailscale-ip>:8791
  [Parameter(Mandatory = $true)][string]$Adres,
  [string]$Makine = 'windows-kasa',
  [string]$Kok = 'C:\vm-kapi',
  [string]$GorevAdi = 'vm-gozcu',
  [int]$TurSn = 15
)

$ErrorActionPreference = 'Stop'

# ADIM 1 — dizin ve dosya varligi. Gozcu betigi kopruden cekilir (paylasilan
# klasor YOK; ayni yol izleyici icin de kullaniliyor). Belirtec KOMUT SATIRINDA
# GECMEZ: kopru yolu belirtec ister, bu yuzden dosyayi Nadir bir kez indirir.
if (-not (Test-Path $Kok)) { New-Item -ItemType Directory -Force -Path $Kok | Out-Null }
$gozcu = Join-Path $Kok 'vm-gozcu.ps1'
if (-not (Test-Path $gozcu)) {
  Write-Host "EKSIK: $gozcu"
  Write-Host 'Once kopruden indir (belirtec degerini sen yazacaksin, bu betik gormeyecek):'
  Write-Host "  curl.exe -o $gozcu $Adres/<belirtec>/dosya/vm-gozcu.ps1"
  exit 2
}

# ADIM 2 — belirtec dosyasi. DEGERI BU BETIK ISTEMEZ, GORMEZ, YAZMAZ.
# Gozcu izleyiciyi yeniden baslatirken belirteci buradan okur.
$belirtecDosyasi = Join-Path $Kok 'belirtec.txt'
if (-not (Test-Path $belirtecDosyasi)) {
  Write-Host "EKSIK: $belirtecDosyasi"
  Write-Host 'Bir kez olustur (degeri Mac''teki ~/vm-kapi/durum/belirtec.txt icinde):'
  Write-Host "  Set-Content -Path $belirtecDosyasi -Value '<belirtec>' -NoNewline -Encoding ascii"
  exit 2
}

# ADIM 3 — belirtec dosyasini yalniz bu kullaniciya kapat (devralmayi kaldir).
# Deger paylasilan bir makinede baskasinin eline gecmesin.
try {
  & icacls.exe $belirtecDosyasi /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null
  Write-Host "izinler daraltildi: $belirtecDosyasi -> yalniz $env:USERNAME (okuma)"
} catch { Write-Host 'UYARI: icacls calismadi, izinler degismedi' }

# ADIM 4 — gorev eylemi: gozcuyu GIZLI pencerede baslat. Gizli olan GOZCUDUR;
# gozcunun baslattigi IZLEYICI normal pencerede acilir, yani Nadir'in Ctrl+C ile
# elle mudahale yolu aynen durur.
$argumanlar = @(
  '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
  '-File', "`"$gozcu`"", '-Adres', $Adres, '-Makine', $Makine, '-TurSn', $TurSn
) -join ' '
$eylem = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argumanlar

# ADIM 5 — tetikleyiciler: (a) oturum acilinca, (b) her 5 dakikada bir "kosuyor mu".
# (b) gozcunun KENDISI olurse onu geri getirir — bekciyi bekleyen yoksa bekci yoktur.
$t1 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5)

# ADIM 6 — ayarlar. IgnoreNew: gorev zaten kosuyorsa IKINCI KOPYA ACILMAZ
# (iki gozcu ayni izleyiciyi oldurmeye kalkarsa yaris olur).
# ExecutionTimeLimit 0 = sinirsiz; gozcu bilerek surekli kosar.
$ayar = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)

# ADIM 7 — kaydet. Interactive: MASAUSTU oturumunda kosar (Oturum 0 degil).
# Yonetici hakki GEREKMEZ; gerekirse asagidaki yedek yol devreye girer.
$kayitOldu = $false
try {
  $sorumlu = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
  Register-ScheduledTask -TaskName $GorevAdi -Action $eylem -Trigger @($t1, $t2) `
    -Settings $ayar -Principal $sorumlu -Force | Out-Null
  $kayitOldu = $true
  Write-Host "zamanlanmis gorev kaydedildi: $GorevAdi"
} catch {
  Write-Host "UYARI: gorev kaydedilemedi ($($_.Exception.Message))"
}

# ADIM 8 — YEDEK YOL (gorev kaydi reddedilirse): Baslangic klasorune kisayol.
# Oturum acilisinda baslar; 5 dakikalik "kosuyor mu" denetimi OLMAZ — bu yuzden
# yedek yoldayken gozcunun kendisi olurse elle baslatmak gerekir.
$baslangic = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$yedekCmd = Join-Path $baslangic 'vm-gozcu.cmd'
if (-not $kayitOldu) {
  $satir = "start `"vm-gozcu`" /min powershell.exe $argumanlar"
  Set-Content -Path $yedekCmd -Value $satir -Encoding ascii
  Write-Host "YEDEK YOL kuruldu: $yedekCmd (5 dk denetimi YOK)"
}

# ADIM 9 — hemen baslat ki ilk kanit bu oturumda alinsin.
if ($kayitOldu) { Start-ScheduledTask -TaskName $GorevAdi }
else { Start-Process -FilePath 'powershell.exe' -ArgumentList $argumanlar -WindowStyle Hidden }

Write-Host ''
Write-Host 'KURULDU. Dogrulama (bu makinede):'
Write-Host "  Get-Content $Kok\gozcu.log -Tail 20"
Write-Host 'Dogrulama (Mac''te):'
Write-Host "  node tools/windows/vm-kapi.js hazir --makine $Makine-gozcu"
Write-Host 'Geri alma:'
Write-Host "  powershell -ExecutionPolicy Bypass -File $Kok\gozcu-kaldir.ps1"
