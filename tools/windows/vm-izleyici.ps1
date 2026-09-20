# VM İZLEYİCİ — Windows guest tarafı. Nadir bunu VM'de BİR KEZ elle başlatır.
#
# NEDEN: vmrun'un guest işlemleri (kurulum, ekran görüntüsü, dosya okuma) guest
# kullanıcı adı + PAROLA ister ve parolayı yalnız komut satırı argümanı olarak alır —
# yani `ps` çıktısına düşer. Nadir'in parolası ne sohbete girer ne süreç listesine.
# Köprü bu yüzden paylaşılan klasör: host görev dosyası yazar, bu betik işi yapar,
# sonucu geri bırakır. Parola hiçbir yerde geçmez.
#
# KULLANIM (VM içinde, normal kullanıcı — yönetici GEREKMEZ):
#   powershell -ExecutionPolicy Bypass -File "\\vmware-host\Shared Folders\vm-kapi\vm-izleyici.ps1"
# Pencereyi açık bırak. Kapatırsan host "izleyici ölü" der, sessizce yanlış sonuç vermez.

$ErrorActionPreference = 'Stop'
$Kok = Split-Path -Parent $MyInvocation.MyCommand.Path
$Gorev  = Join-Path $Kok 'gorev'
$Sonuc  = Join-Path $Kok 'sonuc'
$Durum  = Join-Path $Kok 'durum'
foreach ($d in @($Gorev, $Sonuc, $Durum)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

function Ekran-Al([string]$yol) {
  # Görsel kanıt: çıkış kodu kanıt değildir (bkz. host tarafı karar modülü).
  $ekranlar = [System.Windows.Forms.Screen]::AllScreens
  $sinir = $ekranlar[0].Bounds
  $bmp = New-Object System.Drawing.Bitmap $sinir.Width, $sinir.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($sinir.X, $sinir.Y, 0, 0, $bmp.Size)
  $bmp.Save($yol, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

function Surec-Say([string]$ad) {
  try { @(Get-Process -Name $ad -ErrorAction SilentlyContinue).Count } catch { 0 }
}

Write-Host "VM izleyici calisiyor. Kok: $Kok"
Write-Host "Kapatmak icin Ctrl+C. Her 5 sn kalp atisi yaziliyor."

while ($true) {
  # Kalp atışı — host bununla "izleyici ayakta mı" kararını verir.
  try { (Get-Date).ToUniversalTime().ToString('o') | Set-Content -Path (Join-Path $Durum 'kalp.txt') -Encoding UTF8 } catch {}

  $isler = @(Get-ChildItem -Path $Gorev -Filter '*.json' -ErrorAction SilentlyContinue | Sort-Object Name)
  foreach ($is in $isler) {
    $kimlik = [IO.Path]::GetFileNameWithoutExtension($is.Name)
    $cikti = ''
    $cikis = 1
    $ekranAdi = $null
    $surecSayisi = 0
    $beklenenKanit = $true
    try {
      $g = Get-Content -Raw -Path $is.FullName | ConvertFrom-Json
      # Görevi ALDIK: dosyayı hemen sil ki ikinci turda tekrar koşmasın.
      Remove-Item -Force $is.FullName

      switch ($g.tur) {
        'kur' {
          # NSIS oneClick per-user: /S sessiz kurar, UAC istemez.
          $exe = Join-Path $Kok $g.dosya
          if (-not (Test-Path $exe)) { throw "kurulum dosyasi yok: $exe" }
          $p = Start-Process -FilePath $exe -ArgumentList '/S' -PassThru -Wait
          $cikis = $p.ExitCode
          Start-Sleep -Seconds ([int](if ($g.bekleSn) { $g.bekleSn } else { 20 }))
          $surecSayisi = Surec-Say $g.surecAdi
          $ekranAdi = "$kimlik.png"; Ekran-Al (Join-Path $Sonuc $ekranAdi)
          $cikti = "kurulum bitti, surec=$surecSayisi"
        }
        'ac' {
          Start-Process -FilePath $g.yol | Out-Null
          Start-Sleep -Seconds ([int](if ($g.bekleSn) { $g.bekleSn } else { 25 }))
          $surecSayisi = Surec-Say $g.surecAdi
          $ekranAdi = "$kimlik.png"; Ekran-Al (Join-Path $Sonuc $ekranAdi)
          $cikis = 0
          $cikti = "acildi, surec=$surecSayisi"
        }
        'ekran' {
          $ekranAdi = "$kimlik.png"; Ekran-Al (Join-Path $Sonuc $ekranAdi)
          $surecSayisi = if ($g.surecAdi) { Surec-Say $g.surecAdi } else { 1 }
          $cikis = 0; $cikti = 'ekran alindi'
        }
        'kapat' {
          Get-Process -Name $g.surecAdi -ErrorAction SilentlyContinue | Stop-Process -Force
          Start-Sleep -Seconds 3
          $cikis = 0; $beklenenKanit = $false
          $cikti = "kapatildi, kalan=$(Surec-Say $g.surecAdi)"
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
      $cikis = 99
      $cikti = $_.Exception.Message
    }

    $sonucNesne = [ordered]@{
      kimlik        = $kimlik
      cikis         = $cikis
      cikti         = $cikti
      ekran         = $ekranAdi
      surecSayisi   = $surecSayisi
      beklenenKanit = $beklenenKanit
      bitis         = (Get-Date).ToUniversalTime().ToString('o')
    }
    # Atomik yazım: önce .tmp, sonra rename — host yarım JSON okumasın.
    $gecici = Join-Path $Sonuc "$kimlik.tmp"
    $nihai  = Join-Path $Sonuc "$kimlik.json"
    $sonucNesne | ConvertTo-Json -Depth 4 | Set-Content -Path $gecici -Encoding UTF8
    Move-Item -Force $gecici $nihai
    Write-Host "gorev $kimlik bitti (cikis=$cikis)"
  }
  Start-Sleep -Seconds 5
}
