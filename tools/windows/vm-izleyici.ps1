# VM İZLEYİCİ — Windows guest tarafı. VM'de BİR KEZ elle başlatılır.
#
# İKİ TAŞIMA MODU:
#   HTTP  (-Adres + -Belirtec)  → Apple Silicon + Windows 11 ARM'da ZORUNLU:
#         VMware Fusion 13'te bu birleşim için PAYLAŞILAN KLASÖR DESTEKLENMİYOR
#         (Fusion Ayarlar penceresinde "Sharing" paneli hiç yok — eksik ayar değil,
#         olmayan özellik). Misafir, Mac'e VMware ağından ulaşır (ölçüldü: 192.168.11.1).
#   KLASÖR (-Kok)               → paylaşılan klasör çalışan kurulumlarda (x64 misafir).
#
# NEDEN vmrun DEĞİL: vmrun'un guest işlemleri guest parolasını ister ve yalnız komut
# satırı argümanı olarak alır — parola `ps` çıktısına düşer. Bu köprüde parola YOK.
#
# KULLANIM (normal kullanıcı, YÖNETİCİ GEREKMEZ):
#   powershell -ExecutionPolicy Bypass -File C:\vm-kapi\vm-izleyici.ps1 `
#       -Adres http://192.168.11.1:8791 -Belirtec <belirtec>
# Pencereyi açık bırak. Kapatırsan host "izleyici ölü" der, sessizce yanlış sonuç vermez.

param(
  [string]$Adres,
  [string]$Belirtec,
  [string]$Kok,
  # MAKİNE ADI: artık birden çok makine aynı köprüye bağlanıyor (VM + gerçek
  # Windows + ileride Pardus). Her makinenin kendi kuyruğu ve kalbi olmalı;
  # yoksa görevi rastgele biri kapar ve hangi makinenin ne yaptığı belirsizleşir.
  # Varsayılan "vm" — eski kurulum hiç değişmeden çalışsın diye.
  [string]$Makine = 'vm'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest ilerleme çubuğu büyük indirmede çok yavaşlatıyor

$HttpModu = -not [string]::IsNullOrWhiteSpace($Adres)
$Taban = "$Adres/$Belirtec/$Makine"
if (-not $HttpModu -and [string]::IsNullOrWhiteSpace($Kok)) {
  $Kok = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$Calisma = Join-Path $env:LOCALAPPDATA 'vm-kapi'
New-Item -ItemType Directory -Force -Path $Calisma | Out-Null

if (-not $HttpModu) {
  $Gorev = Join-Path $Kok 'gorev'; $Sonuc = Join-Path $Kok 'sonuc'; $Durum = Join-Path $Kok 'durum'
  foreach ($d in @($Gorev, $Sonuc, $Durum)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

function Ekran-Al([string]$yol) {
  # Görsel kanıt: çıkış kodu kanıt değildir (host tarafı karar modülü bunu zorunlu tutar).
  $sinir = ([System.Windows.Forms.Screen]::AllScreens)[0].Bounds
  $bmp = New-Object System.Drawing.Bitmap $sinir.Width, $sinir.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($sinir.X, $sinir.Y, 0, 0, $bmp.Size)
  $bmp.Save($yol, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

function Surec-Say([string]$ad) {
  if ([string]::IsNullOrWhiteSpace($ad)) { return 0 }
  try { @(Get-Process -Name $ad -ErrorAction SilentlyContinue).Count } catch { 0 }
}

# KALP ATIŞI AYRI İŞTE ÇALIŞIR — SAHA ARIZASI (2026-09-20, ölçüldü):
# kalp atışı ana döngüdeydi; izleyici 1,3 GB'lık kurulum dosyasını indirirken
# (tek blok, dakikalarca) hiç atış göndermedi, host 31. saniyede "izleyici ölü"
# deyip görevi BOZUK saydı — oysa iş sapasağlam sürüyordu. Kalp "süreç yaşıyor mu"
# sorusunun cevabıdır; uzun işin ARKASINDA durmamalı.
function Kalp-Isini-Baslat {
  if ($HttpModu) {
    Start-Job -Name 'vm-kalp' -ScriptBlock {
      param($a, $b)
      while ($true) {
        try { Invoke-RestMethod -Method Post -Uri "$a/kalp" -TimeoutSec 10 | Out-Null } catch { }
        Start-Sleep -Seconds 5
      }
    } -ArgumentList $Taban, $Belirtec | Out-Null
  } else {
    Start-Job -Name 'vm-kalp' -ScriptBlock {
      param($d)
      while ($true) {
        try { (Get-Date).ToUniversalTime().ToString('o') | Set-Content -Path (Join-Path $d 'kalp.txt') -Encoding UTF8 } catch { }
        Start-Sleep -Seconds 5
      }
    } -ArgumentList $Durum | Out-Null
  }
}

function Kalp-Isini-Durdur {
  Get-Job -Name 'vm-kalp' -ErrorAction SilentlyContinue | Stop-Job -PassThru -ErrorAction SilentlyContinue | Remove-Job -Force -ErrorAction SilentlyContinue
}

function Gorev-Al {
  if ($HttpModu) {
    try {
      $y = Invoke-WebRequest -Method Get -Uri "$Taban/gorev" -TimeoutSec 20 -UseBasicParsing
      if ($y.StatusCode -eq 204 -or -not $y.Content) { return $null }
      return ($y.Content | ConvertFrom-Json)
    } catch { return $null }
  }
  $ilk = @(Get-ChildItem -Path $Gorev -Filter '*.json' -ErrorAction SilentlyContinue | Sort-Object Name)[0]
  if (-not $ilk) { return $null }
  try {
    $g = Get-Content -Raw -Path $ilk.FullName | ConvertFrom-Json
    Remove-Item -Force $ilk.FullName
    $g | Add-Member -NotePropertyName kimlik -NotePropertyValue ([IO.Path]::GetFileNameWithoutExtension($ilk.Name)) -Force
    return $g
  } catch { Remove-Item -Force $ilk.FullName -ErrorAction SilentlyContinue; return $null }
}

function Dosya-Getir([string]$ad, [string]$dogrudanUrl) {
  # NADİR KURALI (2026-09-20): "ofisteki makinelerin interneti benden hızlı, buraya
  # uğramadan orada yapılabilecekleri değerlendir." Kurulum dosyası R2/panel gibi
  # bir adresten geliyorsa Mac'in yükleme hattını hiç kullanmayız: misafir dosyayı
  # DOĞRUDAN kaynaktan çeker. dogrudanUrl yoksa eski yol (köprüden) işler.
  if ($dogrudanUrl) {
    $hedef = Join-Path $Calisma $ad
    $curl = (Get-Command curl.exe -ErrorAction SilentlyContinue)
    if ($curl) {
      & $curl.Source -sS -L --fail --retry 5 --retry-delay 3 -o $hedef $dogrudanUrl
      if ($LASTEXITCODE -ne 0) { throw "dogrudan indirme basarisiz (curl rc=$LASTEXITCODE)" }
    } else {
      Invoke-WebRequest -Uri $dogrudanUrl -OutFile $hedef -TimeoutSec 7200 -UseBasicParsing
    }
    if (-not (Test-Path $hedef)) { throw "indirilen dosya yok: $hedef" }
    return $hedef
  }
  # HTTP modunda kurulum dosyası host'tan indirilir; klasör modunda zaten yanımızda.
  if (-not $HttpModu) { return (Join-Path $Kok $ad) }
  $hedef = Join-Path $Calisma $ad
  $kaynak = "$Taban/dosya/$([uri]::EscapeDataString($ad))"
  # curl.exe Windows 10 1803+ ile geliyor ve büyük dosyada Invoke-WebRequest'ten
  # belirgin hızlı (IWR yanıtı belleğe tamponluyor). Yoksa IWR'ye düşülür.
  $curl = (Get-Command curl.exe -ErrorAction SilentlyContinue)
  if ($curl) {
    & $curl.Source -sS -L --fail --retry 3 --retry-delay 2 -o $hedef $kaynak
    if ($LASTEXITCODE -ne 0) { throw "indirme basarisiz (curl rc=$LASTEXITCODE): $ad" }
  } else {
    Invoke-WebRequest -Uri $kaynak -OutFile $hedef -TimeoutSec 3600 -UseBasicParsing
  }
  if (-not (Test-Path $hedef)) { throw "indirilen dosya yok: $hedef" }
  return $hedef
}

function Sonuc-Gonder($kimlik, $nesne, $ekranYolu) {
  if ($HttpModu) {
    if ($ekranYolu -and (Test-Path $ekranYolu)) {
      Invoke-WebRequest -Method Post -Uri "$Taban/ekran/$kimlik" `
        -InFile $ekranYolu -ContentType 'image/png' -TimeoutSec 120 -UseBasicParsing | Out-Null
    }
    Invoke-WebRequest -Method Post -Uri "$Taban/sonuc/$kimlik" `
      -Body ($nesne | ConvertTo-Json -Depth 4) -ContentType 'application/json' -TimeoutSec 60 -UseBasicParsing | Out-Null
    return
  }
  if ($ekranYolu -and (Test-Path $ekranYolu)) { Copy-Item -Force $ekranYolu (Join-Path $Sonuc "$kimlik.png") }
  # Atomik: önce .tmp, sonra rename — host yarım JSON okumasın.
  $gecici = Join-Path $Sonuc "$kimlik.tmp"
  $nesne | ConvertTo-Json -Depth 4 | Set-Content -Path $gecici -Encoding UTF8
  Move-Item -Force $gecici (Join-Path $Sonuc "$kimlik.json")
}

Write-Host ("VM izleyici calisiyor - makine: $Makine - mod: " + $(if ($HttpModu) { "HTTP ($Adres)" } else { "KLASOR ($Kok)" }))
Write-Host "Kapatmak icin Ctrl+C. Kalp atisi AYRI iste, her 5 sn (uzun is sirasinda da surer)."
Kalp-Isini-Durdur      # onceki calistirmadan kalan is varsa
Kalp-Isini-Baslat

try {
while ($true) {
  $g = Gorev-Al
  if ($g) {
    $kimlik = $g.kimlik
    $cikis = 1; $cikti = ''; $ekranAdi = $null; $ekranYolu = $null; $surecSayisi = 0; $beklenenKanit = $true
    try {
      switch ($g.tur) {
        'kur' {
          $exe = Dosya-Getir $g.dosya $g.dosyaUrl
          if (-not (Test-Path $exe)) { throw "kurulum dosyasi yok: $exe" }
          # NSIS oneClick per-user: /S sessiz kurar, UAC istemez.
          $p = Start-Process -FilePath $exe -ArgumentList '/S' -PassThru -Wait
          $cikis = $p.ExitCode
          Start-Sleep -Seconds $(if ($g.bekleSn) { [int]$g.bekleSn } else { 25 })
          $surecSayisi = Surec-Say $g.surecAdi
          $ekranAdi = "$kimlik.png"; $ekranYolu = Join-Path $Calisma $ekranAdi; Ekran-Al $ekranYolu
          $cikti = "kurulum bitti, surec=$surecSayisi"
        }
        'ac' {
          Start-Process -FilePath $g.yol | Out-Null
          Start-Sleep -Seconds $(if ($g.bekleSn) { [int]$g.bekleSn } else { 25 })
          $surecSayisi = Surec-Say $g.surecAdi
          $ekranAdi = "$kimlik.png"; $ekranYolu = Join-Path $Calisma $ekranAdi; Ekran-Al $ekranYolu
          $cikis = 0; $cikti = "acildi, surec=$surecSayisi"
        }
        'ekran' {
          $ekranAdi = "$kimlik.png"; $ekranYolu = Join-Path $Calisma $ekranAdi; Ekran-Al $ekranYolu
          $surecSayisi = $(if ($g.surecAdi) { Surec-Say $g.surecAdi } else { 1 })
          $cikis = 0; $cikti = 'ekran alindi'
        }
        'kapat' {
          Get-Process -Name $g.surecAdi -ErrorAction SilentlyContinue | Stop-Process -Force
          Start-Sleep -Seconds 3
          $cikis = 0; $beklenenKanit = $false; $cikti = "kapatildi, kalan=$(Surec-Say $g.surecAdi)"
        }
        'komut' {
          $r = & cmd /c $g.komut 2>&1
          $cikis = $LASTEXITCODE
          $cikti = ($r | Select-Object -Last 40) -join "`n"
          $beklenenKanit = $false
        }
        default { throw "bilinmeyen gorev turu: $($g.tur)" }
      }
    } catch {
      $cikis = 99; $cikti = $_.Exception.Message
    }

    $sonucNesne = [ordered]@{
      kimlik = $kimlik; cikis = $cikis; cikti = $cikti; ekran = $ekranAdi
      surecSayisi = $surecSayisi; beklenenKanit = $beklenenKanit
      bitis = (Get-Date).ToUniversalTime().ToString('o')
    }
    try { Sonuc-Gonder $kimlik $sonucNesne $ekranYolu } catch { Write-Host "sonuc gonderilemedi: $($_.Exception.Message)" }
    Write-Host "gorev $kimlik bitti (cikis=$cikis)"
  }
  Start-Sleep -Seconds 5
}
} finally {
  Kalp-Isini-Durdur
}
