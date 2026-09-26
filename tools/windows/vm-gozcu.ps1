# VM GOZCU — izleyicinin ikinci, ASLA ASILMAYAN bekcisi. Windows tarafinda kosar.
#
# NOT (kodlama): bu dosyanin YORUMLARI bilerek ASCII'dir. Windows PowerShell 5.1
# BOM'suz UTF-8 dosyalarda Turkce harfleri bozuyor; script govdesi bozulursa gozcu
# hic acilmaz. Kullaniciya gosterilen TR metin .md ve .js tarafindadir.
#
# NEDEN VAR (olculdu, 2026-09-21):
#   windows-kasa izleyicisinin ana dongusu `komut` dalinda asildi. Kalp atisi AYRI
#   iste kostugu icin host "ayakta, yas 4 sn" gordu ve `hazir` cikis kodu 0 (YESIL)
#   dondu. Oysa 10:21'de alinan gorev sonuc yazmadi; 10:23:41'de kuyruga yazilan
#   gorev 11:01'de HALA alinmamisti — serit 40 dakikadir kilitliydi. Kurtarmanin
#   tek yolu makineye fiziksel gidip Ctrl+C basmakti: SSH(22) ve WinRM(5985/5986)
#   KAPALI, RDP odak caliyor, SMB yalniz dosya tasiyor.
#
# KOPRU PULL MODELIDIR: guest host'a gider, host guest'e GIDEMEZ. Bu yuzden
# kurtarici da makinenin ICINDE yasar ve kendisi yoklar. Gozcu DISARIYA HICBIR PORT
# ACMAZ — yeni saldiri yuzeyi yoktur.
#
# GOZCU NEDEN ASILMAZ (yapisal):
#   - KEYFI KOMUT CALISTIRMAZ. Invoke-Expression, cmd /c, & $degisken YOKTUR.
#     Izleyiciyi kilitleyen sinif (erisilemeyen ag surucusu) buraya giremez.
#   - Her ag cagrisi -TimeoutSec ile sinirli, her cagri try/catch icinde.
#   - Yaptigi is: yerel dosya oku, surec say, surec agaci oldur, surec baslat.
#
# KARAR MANTIGI src/windows/izleyici-kurtarma.js icinde TEST EDILIR (18 test).
# Buradaki transkripsiyon ile oradaki esikler tools/windows/vm-gozcu.test.js
# tarafindan kiyaslanir — sapma testi kirar.
#
# KURULUM: tools/windows/gozcu-kur.ps1   ·   GERI ALMA: tools/windows/gozcu-kaldir.ps1
# RECETE : tools/windows/YUKSELTME.md -> "Izleyici kilitlenirse"

param(
  # Host kopru adresi, ornek: http://100.87.144.56:8791 (Tailscale) veya
  # http://192.168.11.1:8791 (VMware). IP kullan — DNS beklemesi olmasin.
  [Parameter(Mandatory = $true)][string]$Adres,
  # Hangi makine kuyrugu: izleyiciye verilen -Makine ile AYNI olmali.
  [string]$Makine = 'windows-kasa',
  [string]$Izleyici = 'C:\vm-kapi\vm-izleyici.ps1',
  # BELIRTEC DEGERI HICBIR DOSYADA/GUNLUKTE GECMEZ; yalnizca bu yoldan OKUNUR.
  [string]$BelirtecDosyasi = 'C:\vm-kapi\belirtec.txt',
  [string]$DurumDosyasi = 'C:\vm-kapi\gozcu-durum.json',
  [string]$Gunluk = 'C:\vm-kapi\gozcu.log',
  # Damga dosyasi izleyiciyle AYNI kullanicinin profilinde olmali. Gozcu baska bir
  # kullaniciyla (ya da SYSTEM ile) kosarsa bu yol tutmaz ve gozcu KOR kalir —
  # acilista cozulen yol gunluge yazilir ki bu hata sessiz kalmasin.
  [string]$DamgaDosyasi = (Join-Path $env:LOCALAPPDATA 'vm-kapi\dongu.json'),
  [int]$TurSn = 15,
  [switch]$KalpKapali,     # varsayilan: kalp atar (gozcunun kendisi de izlenebilsin)
  [switch]$KuruProva       # yalniz karar uretir, hicbir sey oldurmez/baslatmaz
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# ——— ESIKLER: src/windows/izleyici-kurtarma.js ile BIREBIR AYNI ————————————
# Sapma olursa host "tikali" derken gozcu susar (ya da tersi). vm-gozcu.test.js
# bu dort satiri okuyup JS modulunun sabitleriyle kiyaslar.
$BOS_AZAMI_SN = 60
$TAVAN_PAYI_SN = 60
$VARSAYILAN_TAVAN_SN = 900
$SOGUMA_SN = 120
$SAATLIK_TAVAN = 3
$PENCERE_SN = 3600

$GUNLUK_AZAMI_BAYT = 1MB

function Yaz-Gunluk([string]$seviye, [string]$mesaj) {
  $satir = '{0} [{1}] {2}' -f (Get-Date).ToUniversalTime().ToString('o'), $seviye, $mesaj
  Write-Host $satir
  try {
    if ((Test-Path $Gunluk) -and ((Get-Item $Gunluk).Length -gt $GUNLUK_AZAMI_BAYT)) {
      Move-Item -Force $Gunluk "$Gunluk.1"
    }
    Add-Content -Path $Gunluk -Value $satir -Encoding UTF8
  } catch { }
}

function Belirtec-Oku {
  try {
    $v = (Get-Content -Raw -Path $BelirtecDosyasi -ErrorAction Stop).Trim()
    if ($v -match '^[a-f0-9]{16,}$') { return $v }
    Yaz-Gunluk 'HATA' 'belirtec dosyasi bicimsiz (24 hex bekleniyor)'
    return $null
  } catch {
    Yaz-Gunluk 'HATA' "belirtec dosyasi okunamadi: $BelirtecDosyasi"
    return $null
  }
}

# Gunluge/ekrana giden her metinden belirteci temizle. Gozcu belirteci ASLA basmaz.
function Gizle-Belirtec([string]$metin, [string]$belirtec) {
  if ([string]::IsNullOrEmpty($metin) -or [string]::IsNullOrEmpty($belirtec)) { return $metin }
  return $metin.Replace($belirtec, '<belirtec>')
}

function Durum-Oku {
  $bos = [ordered]@{ gorulenTetik = $null; mudahaleGecmisi = @() }
  try {
    if (-not (Test-Path $DurumDosyasi)) { return $bos }
    $o = (Get-Content -Raw -Path $DurumDosyasi -ErrorAction Stop) | ConvertFrom-Json
    $g = @()
    if ($o.mudahaleGecmisi) { $g = @($o.mudahaleGecmisi | Where-Object { $_ -is [long] -or $_ -is [int] -or $_ -is [double] }) }
    return [ordered]@{ gorulenTetik = $o.gorulenTetik; mudahaleGecmisi = $g }
  } catch { return $bos }
}

function Durum-Yaz($durum) {
  try {
    $gecici = "$DurumDosyasi.tmp"
    $durum | ConvertTo-Json -Compress | Set-Content -Path $gecici -Encoding UTF8
    Move-Item -Force $gecici $DurumDosyasi
  } catch { Yaz-Gunluk 'HATA' 'gozcu durum dosyasi yazilamadi' }
}

function Damga-Oku {
  # Donen: @{ damgaMs; durum; gorev; zamanAsimiSn }  — okunamazsa damgaMs $null.
  $y = [ordered]@{ damgaMs = $null; durum = 'bos'; gorev = $null; zamanAsimiSn = $null }
  try {
    if (-not (Test-Path $DamgaDosyasi)) { return $y }
    $o = (Get-Content -Raw -Path $DamgaDosyasi -ErrorAction Stop) | ConvertFrom-Json
    if ($o.sonDonguDamgasi) {
      $t = [datetime]::Parse($o.sonDonguDamgasi, [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)
      $y.damgaMs = [int64]([datetimeoffset]$t).ToUnixTimeMilliseconds()
    }
    if ($o.donguDurumu -eq 'calisiyor') { $y.durum = 'calisiyor' }
    $y.gorev = $o.donguGorevi
    if ($o.donguZamanAsimiSn) { $y.zamanAsimiSn = [int]$o.donguZamanAsimiSn }
  } catch { }
  return $y
}

# Izleyici surecleri: KENDI PID'imiz haric, komut satirinda vm-izleyici.ps1 gecen
# powershell/pwsh surecleri. Izleyici bir PID dosyasi YAZMIYOR ve o dosyaya
# dokunmak bu gorevin kapsami disinda — bu yuzden kimlik komut satirindan okunur.
function Izleyici-Surecleri {
  $bulunan = @()
  try {
    $hepsi = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -in @('powershell.exe', 'pwsh.exe') }
    foreach ($p in $hepsi) {
      if ($p.ProcessId -eq $PID) { continue }
      if ($p.CommandLine -and $p.CommandLine -like '*vm-izleyici.ps1*') { $bulunan += $p }
    }
  } catch { Yaz-Gunluk 'HATA' 'surec taramasi basarisiz (CIM)' }
  return $bulunan
}

# Ustu oldurmek yetmez: `cmd /c` torunlari dosya kilidi ve ag tutamagiyla kalir.
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

# UZAKTAN TETIK — host'ta ~/vm-kapi/yeniden-baslat-<makine>.txt dosyasi degisince
# gozcu izleyiciyi yeniden baslatir. SUNUCUDA TEK SATIR DEGISIKLIK GEREKMEZ: var
# olan `GET /<belirtec>/dosya/<ad>` ucu kullanilir (path.basename ile kok dizine
# kilitli, yol gezinmesi yok). Windows tarafinda ACIK PORT YOKTUR — cekme yonu.
function Uzak-Tetik-Oku([string]$belirtec) {
  if (-not $belirtec) { return $null }
  $u = "$Adres/$belirtec/dosya/yeniden-baslat-$Makine.txt"
  try {
    $y = Invoke-WebRequest -Method Get -Uri $u -TimeoutSec 10 -UseBasicParsing
    if ($y.StatusCode -ne 200) { return $null }
    $m = ([string]$y.Content).Trim()
    if ([string]::IsNullOrWhiteSpace($m)) { return $null }
    if ($m.Length -gt 64) { $m = $m.Substring(0, 64) }
    return $m
  } catch { return $null }   # 404 = tetik hic yazilmamis; normal hal
}

# Gozcunun KENDISI de izlenebilir olmali (Bekci Guven Gate). Ayri bir makine adi
# altinda kalp atar: host `vm-kapi.js hazir --makine <makine>-gozcu` ile gorur.
function Kalp-Gonder([string]$belirtec, [int]$mudahaleSayisi, [string]$sonKarar) {
  if ($KalpKapali) { return }
  if (-not $belirtec) { return }
  try {
    $govde = [ordered]@{
      sonDonguDamgasi = (Get-Date).ToUniversalTime().ToString('o')
      donguDurumu     = 'bos'
      donguGorevi     = "gozcu mudahale=$mudahaleSayisi karar=$sonKarar"
    } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri "$Adres/$belirtec/$($Makine)-gozcu/kalp" `
      -Body $govde -ContentType 'application/json' -TimeoutSec 10 | Out-Null
  } catch { }
}

# Kesilen gorev SESSIZCE kaybolmasin: host'a sebebini yaz. Var olan sonuc ucu
# kullanilir; karar katmani (vm-kapi-karar.js gorevKarari) durum:'zaman-asimi'
# alanini okuyup "guest komutu kesti" der — cikis kodu 0'dan farkli, alarmli.
function Sonuc-Kesildi-Yaz([string]$belirtec, [string]$kimlik, [string]$sebep) {
  if (-not $belirtec -or [string]::IsNullOrWhiteSpace($kimlik)) { return }
  try {
    $n = [ordered]@{
      kimlik = $kimlik; cikis = 125; durum = 'zaman-asimi'
      cikti = "GOZCU KESTI: $sebep"
      ekran = $null; surecSayisi = 0; beklenenKanit = $false
      bitis = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json -Compress
    Invoke-WebRequest -Method Post -Uri "$Adres/$belirtec/$Makine/sonuc/$kimlik" `
      -Body $n -ContentType 'application/json' -TimeoutSec 20 -UseBasicParsing | Out-Null
    Yaz-Gunluk 'BILGI' "kesilen gorev host'a bildirildi: $kimlik"
  } catch { Yaz-Gunluk 'HATA' "kesilen gorev bildirilemedi: $kimlik" }
}

function Izleyici-Baslat([string]$belirtec) {
  if (-not (Test-Path $Izleyici)) {
    Yaz-Gunluk 'HATA' "izleyici betigi yok: $Izleyici"
    return $false
  }
  if (-not $belirtec) { Yaz-Gunluk 'HATA' 'belirtec yok, izleyici baslatilamaz'; return $false }
  try {
    # Belirtec komut satirinda gider — bu BUGUN de boyle (Nadir elle ayni satiri
    # yaziyor). Gozcu bunu DEGISTIRMIYOR; degeri repoda ve gunlukte gecmiyor.
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
      '-ExecutionPolicy', 'Bypass', '-File', $Izleyici,
      '-Adres', $Adres, '-Belirtec', $belirtec, '-Makine', $Makine
    ) | Out-Null
    Yaz-Gunluk 'BILGI' 'izleyici baslatildi'
    return $true
  } catch {
    Yaz-Gunluk 'HATA' (Gizle-Belirtec $_.Exception.Message $belirtec)
    return $false
  }
}

# ——— KARAR (src/windows/izleyici-kurtarma.js transkripsiyonu) ———————————————
# Sira ONEMLI: uzak tetik > saatlik tavan > soguma > surec yok > damga yok >
# gorev tavani > bos serit > bekle.
function Karar-Ver($olcum) {
  $simdi = [int64]$olcum.simdiMs
  $gecmis = @($olcum.mudahaleGecmisi)
  $sinir = $simdi - ($PENCERE_SN * 1000)
  $penceredeki = @($gecmis | Where-Object { $_ -gt $sinir }).Count
  $sonMudahale = $null
  if ($gecmis.Count -gt 0) { $sonMudahale = ($gecmis | Measure-Object -Maximum).Maximum }

  $uzak = $olcum.uzakTetik
  $gorulen = $olcum.gorulenTetik
  if ($uzak -and $uzak -ne $gorulen) {
    if ($olcum.ilkTur) {
      return [ordered]@{ karar = 'bekle'; sebep = 'ilk tur: uzak tetik tohumlandi'; yeniTetik = $uzak }
    }
    return [ordered]@{ karar = 'yeniden-baslat'; tetik = 'uzak'
      sebep = 'host uzaktan yeniden baslatma istedi'; yeniTetik = $uzak }
  }

  if ($penceredeki -ge $SAATLIK_TAVAN) {
    return [ordered]@{ karar = 'elle'
      sebep = "son 1 saatte $penceredeki mudahale (tavan $SAATLIK_TAVAN) — gozcu durdu, insan bakmali" }
  }

  if ($null -ne $sonMudahale -and ($simdi - $sonMudahale) -lt ($SOGUMA_SN * 1000)) {
    $kalan = [math]::Ceiling((($SOGUMA_SN * 1000) - ($simdi - $sonMudahale)) / 1000)
    return [ordered]@{ karar = 'bekle'; sebep = "soguma: $kalan sn daha beklenecek" }
  }

  if (-not $olcum.izleyiciVar) {
    return [ordered]@{ karar = 'basla'; sebep = 'izleyici sureci bulunamadi' }
  }

  if ($null -eq $olcum.damgaMs) {
    return [ordered]@{ karar = 'elle'
      sebep = 'ilerleme damgasi yok — izleyici ESKI surum, gozcu kor (bkz. YUKSELTME.md)' }
  }

  $yasSn = [math]::Max(0, [math]::Floor(($simdi - $olcum.damgaMs) / 1000))
  if ($olcum.durum -eq 'calisiyor') {
    $tavan = $VARSAYILAN_TAVAN_SN
    if ($olcum.zamanAsimiSn -and $olcum.zamanAsimiSn -gt 0) { $tavan = [int]$olcum.zamanAsimiSn }
    $tavan = $tavan + $TAVAN_PAYI_SN
    if ($yasSn -gt $tavan) {
      return [ordered]@{ karar = 'yeniden-baslat'; tetik = 'gorev-tavani'; yasSn = $yasSn
        sebep = "gorev $($olcum.gorev) $yasSn sn'dir ilerlemiyor (tavan+pay $tavan sn)" }
    }
    return [ordered]@{ karar = 'bekle'; sebep = "gorev suruyor ($yasSn sn)"; yasSn = $yasSn }
  }

  if ($yasSn -gt $BOS_AZAMI_SN) {
    return [ordered]@{ karar = 'yeniden-baslat'; tetik = 'bos-serit'; yasSn = $yasSn
      sebep = "dongu bosta ama $yasSn sn'dir damga basmiyor (esik $BOS_AZAMI_SN sn)" }
  }
  return [ordered]@{ karar = 'bekle'; sebep = "serit akiyor ($yasSn sn)"; yasSn = $yasSn }
}

# ——— ANA DONGU ————————————————————————————————————————————————————————————
Yaz-Gunluk 'BILGI' "gozcu acildi - makine: $Makine - tur: $TurSn sn - kuru prova: $($KuruProva.IsPresent)"
Yaz-Gunluk 'BILGI' "damga yolu: $DamgaDosyasi"   # izleyiciyle AYNI kullanici mi? gorunsun
if (-not (Test-Path $DamgaDosyasi)) {
  Yaz-Gunluk 'UYARI' 'damga dosyasi HENUZ yok — izleyici eski surum olabilir ya da hic baslamamistir'
}

$durum = Durum-Oku
$ilkTur = $true
$sonKarar = 'acilis'

while ($true) {
  $belirtec = Belirtec-Oku
  $surecler = Izleyici-Surecleri
  $damga = Damga-Oku
  $olcum = [ordered]@{
    simdiMs         = [int64]([datetimeoffset]::UtcNow.ToUnixTimeMilliseconds())
    izleyiciVar     = ($surecler.Count -gt 0)
    damgaMs         = $damga.damgaMs
    durum           = $damga.durum
    gorev           = $damga.gorev
    zamanAsimiSn    = $damga.zamanAsimiSn
    uzakTetik       = (Uzak-Tetik-Oku $belirtec)
    gorulenTetik    = $durum.gorulenTetik
    mudahaleGecmisi = @($durum.mudahaleGecmisi)
    ilkTur          = $ilkTur
  }

  $k = Karar-Ver $olcum
  $sonKarar = $k.karar
  if ($k.yeniTetik) { $durum.gorulenTetik = $k.yeniTetik; Durum-Yaz $durum }

  if ($k.karar -eq 'yeniden-baslat' -or $k.karar -eq 'basla') {
    Yaz-Gunluk 'MUDAHALE' "$($k.karar): $($k.sebep)"
    if ($KuruProva) {
      Yaz-Gunluk 'BILGI' 'kuru prova — hicbir sey yapilmadi'
    } else {
      if ($k.karar -eq 'yeniden-baslat') {
        if ($damga.gorev -and $damga.durum -eq 'calisiyor') {
          Sonuc-Kesildi-Yaz $belirtec ([string]$damga.gorev) $k.sebep
        }
        foreach ($p in $surecler) { Surec-Agaci-Oldur ([int]$p.ProcessId) }
        Start-Sleep -Seconds 2
      }
      if (Izleyici-Baslat $belirtec) {
        $durum.mudahaleGecmisi = @($durum.mudahaleGecmisi) + @($olcum.simdiMs)
        Durum-Yaz $durum
      }
    }
  } elseif ($k.karar -eq 'elle') {
    Yaz-Gunluk 'ELLE' $k.sebep
  } else {
    Yaz-Gunluk 'IZ' $k.sebep
  }

  Kalp-Gonder $belirtec (@($durum.mudahaleGecmisi).Count) $sonKarar
  $ilkTur = $false
  Start-Sleep -Seconds $TurSn
}
