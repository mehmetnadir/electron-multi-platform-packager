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

# ——— ZAMAN AŞIMI TAVANLARI ————————————————————————————————————————————
# SAHA ARIZASI (2026-09-21, ölçüldü): `komut` dalindaki `& cmd /c $g.komut`
# cagrisinda ZAMAN ASIMI YOKTU. Bir ajan `Get-PSDrive -PSProvider FileSystem`
# gonderdi, erisilemeyen bir ag surucusunde asildi; ana dongu 16+ dakika bloke
# kaldi. Alinan gorev (20260921-102107) sonuc yazamadi, siradaki gorev
# (20260921-102341) hic alinmadi. Kalp AYRI iste attigi icin host "ayakta" dedi.
#
# TAVAN NEDEN GOREV BASINA GECILIR: sabit kisa bir tavan uretimi bozar — 1,3 GB'lik
# kurulum dosyasi dakikalarca inip kuruluyor. Host her gorevle birlikte kendi
# tavanindan PAY kadar kisa bir `zamanAsimiSn` gonderir (bkz. karar modulu:
# guestZamanAsimiSn) ki guest seridi host pes etmeden ONCE acsin ve sonuc dosyasina
# gercek sebebi yazsin. Asagidakiler yalnizca ALAN GELMEDIGINDE (eski host) gecerli.
$VARSAYILAN_KOMUT_TAVANI_SN = 600     # host `calistir` varsayilani da 600 sn
$VARSAYILAN_KUR_TAVANI_SN   = 1800    # host `kur` varsayilani da 1800 sn
$KOMUT_ONEK = 160                     # sonuca yazilacak komut on eki (sir sizmasin diye kirpik)

# ——— SERIT DAMGASI: KALP YALAN SOYLEMESIN ——————————————————————————————
# Kalp atisi AYRI iste kosuyor (asagidaki Kalp-Isini-Baslat). Bu, uzun is sirasinda
# yanlis alarmi onledi ama YENI bir korluk yaratti: ana dongu kilitliyken de kalp
# atmaya devam ediyor, host "ayakta, yas 2 sn" goruyor. DURUM BILDIRIMI CANLILIK
# DEGILDIR. Cozum: ana dongu her ilerlemesinde bir damga dosyasi yazar; kalp isi o
# damgayi kalp govdesinde host'a TASIR. Host boylece "ayakta ama serit N sn'dir
# ilerlemiyor" diyebilir (src/windows/vm-kapi-karar.js -> seritDurumu).
$DonguDosyasi = Join-Path $Calisma 'dongu.json'

function Dongu-Damgala([string]$durum, $gorev, $zamanAsimiSn) {
  try {
    $n = [ordered]@{
      sonDonguDamgasi   = (Get-Date).ToUniversalTime().ToString('o')
      donguDurumu       = $durum          # 'bos' | 'calisiyor'
      donguGorevi       = $gorev
      donguZamanAsimiSn = $zamanAsimiSn
    }
    $gecici = "$DonguDosyasi.tmp"
    $n | ConvertTo-Json -Compress | Set-Content -Path $gecici -Encoding UTF8
    Move-Item -Force $gecici $DonguDosyasi     # atomik: kalp isi yarim JSON okumasin
  } catch { }
}

# ——— COCUK SUREC: USTU OLDURMEK YETMEZ ————————————————————————————————
# `cmd /c <komut>` HER ZAMAN en az bir alt surec dogurur (komutun kendisi). Yalniz
# cmd.exe'yi oldurmek torunu CALISIR birakir: dosya kilidi, ag tutamagi ve CPU
# onunla kalir; bugunku arizada asilan sey zaten cmd'nin cocugu olan ag erisimiydi.
# `taskkill /T /F` agacin tamamini keser. taskkill bulunamazsa CIM ile ebeveyn-cocuk
# agaci yinelemeli dolasilir (Win32_Process.ParentProcessId) — once cocuklar, sonra
# ust; ters sirada oldurmek torunlari OKSUZ birakip kacirir.
function Surec-Agaci-Oldur([int]$sid) {
  if ($sid -le 0) { return }
  $kesildi = $false
  try {
    $tk = Get-Command taskkill.exe -ErrorAction SilentlyContinue
    if ($tk) { & $tk.Source /PID $sid /T /F 2>&1 | Out-Null; $kesildi = $true }
  } catch { }
  if (-not $kesildi) {
    try {
      foreach ($c in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$sid" -ErrorAction SilentlyContinue)) {
        Surec-Agaci-Oldur ([int]$c.ProcessId)
      }
    } catch { }
    try { Stop-Process -Id $sid -Force -ErrorAction SilentlyContinue } catch { }
  }
}

function Kuyruk-Oku([string]$yol, [int]$satir = 40) {
  try {
    if (-not (Test-Path $yol)) { return '' }
    return ((Get-Content -Path $yol -ErrorAction SilentlyContinue | Select-Object -Last $satir) -join "`n")
  } catch { return '' }
}

function Komut-OnEki([string]$komut) {
  if ([string]::IsNullOrEmpty($komut)) { return '' }
  if ($komut.Length -le $KOMUT_ONEK) { return $komut }
  return $komut.Substring(0, $KOMUT_ONEK) + '...'
}

# ZAMAN ASIMLI KOMUT. Ciktilar dosyaya yonlendirilir: `Start-Process -NoNewWindow`
# ile bellek icinde okumak, surec olduruldugunde okuma is parcaciginin kendisinin
# asili kalmasi riskini tasir — dosya ise oldurmeden SONRA sakince okunur.
function Komut-Calistir([string]$komut, [int]$tavanSn) {
  $ad = [guid]::NewGuid().ToString('N').Substring(0, 8)
  $oYol = Join-Path $Calisma "komut-$ad.out"
  $eYol = Join-Path $Calisma "komut-$ad.err"
  $bas = Get-Date
  try {
    $p = Start-Process -FilePath $env:ComSpec -ArgumentList "/c $komut" -PassThru -NoNewWindow `
           -RedirectStandardOutput $oYol -RedirectStandardError $eYol
    $bitti = $p.WaitForExit($tavanSn * 1000)
    $gecenSn = [int]((Get-Date) - $bas).TotalSeconds
    if (-not $bitti) {
      Surec-Agaci-Oldur $p.Id
      Start-Sleep -Milliseconds 500
      if (-not $p.HasExited) { try { $p.Kill() } catch { } }
      $kuyruk = (Kuyruk-Oku $oYol) + "`n" + (Kuyruk-Oku $eYol)
      return [pscustomobject]@{
        cikis = 124                      # GNU `timeout` ile ayni: "zaman asimiyla kesildi"
        zamanAsimi = $true
        gecenSn = $gecenSn
        komutOnEk = (Komut-OnEki $komut)
        cikti = "ZAMAN ASIMI: komut $gecenSn sn'de bitmedi (tavan $tavanSn sn); surec agaci oldurudu.`nkomut: $(Komut-OnEki $komut)`n--- son cikti ---`n$($kuyruk.Trim())"
      }
    }
    $kod = 0
    try { $kod = $p.ExitCode } catch { $kod = 99 }
    $kuyruk = (Kuyruk-Oku $oYol) + "`n" + (Kuyruk-Oku $eYol)
    return [pscustomobject]@{
      cikis = $kod; zamanAsimi = $false; gecenSn = $gecenSn
      komutOnEk = (Komut-OnEki $komut); cikti = $kuyruk.Trim()
    }
  } finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $oYol, $eYol
  }
}

# Gorevin kendi tavani: sonuc/serit raporunda kullanilir.
function Gorev-Tavani($g) {
  if ($g.zamanAsimiSn) { return [int]$g.zamanAsimiSn }
  switch ($g.tur) {
    'kur'   { return $VARSAYILAN_KUR_TAVANI_SN }
    'komut' { return $VARSAYILAN_KOMUT_TAVANI_SN }
    default { return 300 }
  }
}

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
# KALP TEK BASINA YALAN SOYLER (2026-09-21): ayri iste attigi icin ana dongu
# kilitliyken de tazedir. Bu yuzden her atisin govdesinde ANA DONGUNUN SON ILERLEME
# DAMGASI gider ($DonguDosyasi). Damga dosyasi yoksa (ilk saniyeler) atis eskisi gibi
# govdesiz gider ve kopru cıplak ISO yazar — eski davranis korunur.
function Kalp-Isini-Baslat {
  if ($HttpModu) {
    Start-Job -Name 'vm-kalp' -ScriptBlock {
      param($a, $donguDosyasi)
      while ($true) {
        $govde = $null
        try { if (Test-Path $donguDosyasi) { $govde = (Get-Content -Raw -Path $donguDosyasi -ErrorAction SilentlyContinue) } } catch { }
        try {
          if ($govde) {
            Invoke-RestMethod -Method Post -Uri "$a/kalp" -Body $govde -ContentType 'application/json' -TimeoutSec 10 | Out-Null
          } else {
            Invoke-RestMethod -Method Post -Uri "$a/kalp" -TimeoutSec 10 | Out-Null
          }
        } catch { }
        Start-Sleep -Seconds 5
      }
    } -ArgumentList $Taban, $DonguDosyasi | Out-Null
  } else {
    Start-Job -Name 'vm-kalp' -ScriptBlock {
      param($d, $donguDosyasi)
      while ($true) {
        try {
          $ek = $null
          if (Test-Path $donguDosyasi) {
            try { $ek = (Get-Content -Raw -Path $donguDosyasi -ErrorAction SilentlyContinue) | ConvertFrom-Json } catch { $ek = $null }
          }
          $icerik = (Get-Date).ToUniversalTime().ToString('o')
          if ($ek -and $ek.sonDonguDamgasi) {
            $icerik = ([ordered]@{
              kalp              = (Get-Date).ToUniversalTime().ToString('o')
              sonDonguDamgasi   = $ek.sonDonguDamgasi
              donguDurumu       = $ek.donguDurumu
              donguGorevi       = $ek.donguGorevi
              donguZamanAsimiSn = $ek.donguZamanAsimiSn
            } | ConvertTo-Json -Compress)
          }
          $icerik | Set-Content -Path (Join-Path $d 'kalp.txt') -Encoding UTF8
        } catch { }
        Start-Sleep -Seconds 5
      }
    } -ArgumentList $Durum, $DonguDosyasi | Out-Null
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
      # --speed-time/--speed-limit: TOPLAM sureyi kisitlamaz (1,3 GB yavas hatta
      # saatlerce inebilir) ama 120 sn boyunca 1 KB/s altina duserse baglantiyi
      # keser. Asili indirme de serit kilitler; "yavas" ile "olmus" ayrimi budur.
      & $curl.Source -sS -L --fail --retry 5 --retry-delay 3 --speed-time 120 --speed-limit 1024 -o $hedef $dogrudanUrl
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
    & $curl.Source -sS -L --fail --retry 3 --retry-delay 2 --speed-time 120 --speed-limit 1024 -o $hedef $kaynak
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
Dongu-Damgala 'bos' $null $null
while ($true) {
  Dongu-Damgala 'bos' $null $null      # her tur: "dongu yasiyor ve BOSTA" (serit olcusu)
  $g = Gorev-Al
  if ($g) {
    $kimlik = $g.kimlik
    $gorevTavani = Gorev-Tavani $g
    # Gorev ALINDIGI anda damga 'calisiyor'a doner ve gorevin KENDI tavanini tasir.
    # Host bunu okur: tavan+pay da asilmissa zaman asimi DA tutmamis demektir.
    Dongu-Damgala 'calisiyor' $kimlik $gorevTavani
    $cikis = 1; $cikti = ''; $ekranAdi = $null; $ekranYolu = $null; $surecSayisi = 0; $beklenenKanit = $true
    $durumEtiketi = 'bitti'; $gecenSn = $null; $komutOnEk = $null
    $gorevBaslangici = Get-Date
    try {
      switch ($g.tur) {
        'kur' {
          $exe = Dosya-Getir $g.dosya $g.dosyaUrl
          if (-not (Test-Path $exe)) { throw "kurulum dosyasi yok: $exe" }
          # NSIS oneClick per-user: /S sessiz kurar, UAC istemez.
          # ZAMAN ASIMI (2026-09-21): eski kod `-Wait` ile SINIRSIZ bekliyordu. Bir
          # kurulum UAC/onay penceresinde takilirsa serit yine kilitlenirdi.
          $p = Start-Process -FilePath $exe -ArgumentList '/S' -PassThru
          if (-not $p.WaitForExit($gorevTavani * 1000)) {
            Surec-Agaci-Oldur $p.Id
            Start-Sleep -Milliseconds 500
            if (-not $p.HasExited) { try { $p.Kill() } catch { } }
            $durumEtiketi = 'zaman-asimi'
            $gecenSn = [int]((Get-Date) - $gorevBaslangici).TotalSeconds
            $komutOnEk = (Komut-OnEki "$exe /S")
            $cikis = 124
            $cikti = "ZAMAN ASIMI: kurulum $gecenSn sn'de bitmedi (tavan $gorevTavani sn); surec agaci oldurudu."
            $ekranAdi = "$kimlik.png"; $ekranYolu = Join-Path $Calisma $ekranAdi; Ekran-Al $ekranYolu
            break
          }
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
          # ESKI HALI: `$r = & cmd /c $g.komut` — ZAMAN ASIMI YOKTU. 2026-09-21'de
          # `Get-PSDrive -PSProvider FileSystem` erisilemeyen bir ag surucusunde
          # asildi ve TUM seridi 16+ dakika kilitledi (kalp atmaya devam ettigi icin
          # host goremedi). Artik tavan var, cocuk surecler dahil agac oldurulur ve
          # sonuc dosyasina durum:'zaman-asimi' yazilir — gorev SESSIZCE kaybolmaz.
          $r = Komut-Calistir $g.komut $gorevTavani
          $cikis = $r.cikis
          $cikti = $r.cikti
          $beklenenKanit = $false
          if ($r.zamanAsimi) {
            $durumEtiketi = 'zaman-asimi'; $gecenSn = $r.gecenSn; $komutOnEk = $r.komutOnEk
          }
        }
        default { throw "bilinmeyen gorev turu: $($g.tur)" }
      }
    } catch {
      $cikis = 99; $cikti = $_.Exception.Message; $durumEtiketi = 'hata'
    }

    if ($null -eq $gecenSn) { $gecenSn = [int]((Get-Date) - $gorevBaslangici).TotalSeconds }
    $sonucNesne = [ordered]@{
      kimlik = $kimlik; cikis = $cikis; cikti = $cikti; ekran = $ekranAdi
      surecSayisi = $surecSayisi; beklenenKanit = $beklenenKanit
      durum = $durumEtiketi                # 'bitti' | 'zaman-asimi' | 'hata'
      gecenSn = $gecenSn
      komutOnEk = $komutOnEk               # zaman asiminda komutun ilk $KOMUT_ONEK karakteri
      tavanSn = $gorevTavani
      bitis = (Get-Date).ToUniversalTime().ToString('o')
    }
    try { Sonuc-Gonder $kimlik $sonucNesne $ekranYolu } catch { Write-Host "sonuc gonderilemedi: $($_.Exception.Message)" }
    Write-Host "gorev $kimlik bitti (cikis=$cikis, durum=$durumEtiketi, $gecenSn sn)"
    # SERIT ACILDI: dongu bir sonraki goreve gecebilir. Damgayi HEMEN bosa cek ki
    # host "hala o gorevin icinde" sanmasin.
    Dongu-Damgala 'bos' $null $null
  }
  Start-Sleep -Seconds 5
}
} finally {
  Kalp-Isini-Durdur
}
