# windows-kasa ajan ortamı (ajan-baslat.ps1 ve duman testleri dot-source eder). Sır YOK.
# EMPP_WIN_IMZA_HEP_HAZIR=1 (kasada elle açılır, buraya EKLENMEZ): satır içi imza denenmez, paket hep hazır kuyruğa; imza bekçisi imzalar.
# EMPP_WIN_KABUL_KUYRUK=1 (kasada elle açılır, buraya EKLENMEZ; önce kabul-iscisi-gorev-kur.ps1): runner imzasız kabulü
#   çağırmaz, paket kabul-bekliyor kaydıyla bekler, kabulü "empp-kabul-iscisi" görevi koşar. İlgili:
#   EMPP_WIN_KABUL_DERINLIK (vars. 1: işçide sıra bekleyen kayıt sayısı bu değere ulaşınca claim yok),
#   EMPP_WIN_URET_MIN_BOS_GB (vars. 15: C: boş alanı altındaysa claim yok).
$ErrorActionPreference = 'Continue'
$K = 'C:\empp-ajan'   # 04.10: D: (HDD) ölüyor, üretim C: (SSD); D: yalnız arşiv
$R = "$K\paketleyici"
$L = "$K\log"
$env:PATH = "$K\araclar\node;$K\araclar\git\cmd;$K\araclar\7zip;" + $env:PATH + ";$K\araclar\git\usr\bin"
foreach ($d in "$K\veri\tmp", "$K\veri\kaynak-arsivi", "$K\veri\cache", $L) { New-Item -ItemType Directory -Force $d | Out-Null }
$env:TEMP = "$K\veri\tmp"; $env:TMP = "$K\veri\tmp"
$env:BOOKUPDATE_API = 'https://akillitahta.ndr.ist/api/v1'
$env:PACKAGER_API = 'http://127.0.0.1:3001'
$env:AGENT_CAPS = 'windows,kaynak-r2'
$env:AGENT_NAME = 'windows-kasa'
$env:EMPP_SET_MENU = '1'
$env:EMPP_SET_UYELIK_EK = '1'
$env:EMPP_SET_GUNCELLEME = 'windows,macos,linux,android'
$env:EMPP_GUNCELLEME_ACIK_ANAHTAR = 'MCowBQYDK2VwAyEAkPKHFRPDIeuQqAa8kWELMl2+14Ga/WHrjfVHDeTR4H4='
$env:EMPP_ICERIK_GUNCELLEME = 'windows,macos'
$env:EMPP_SAYFA_WEBP = 'windows'
$env:EMPP_ARSIV_MERDIVEN = '1'
$env:KABUL_CDP = '1'; $env:KABUL_K4 = '1'; $env:KABUL_SET_TUM = '1'
$env:EMPP_RUNNER_WINDOWS = '1'
$env:EMPP_WIN_KASA_YEREL = '1'
$env:EMPP_BASLIKSIZ_KABUL = '1'
$env:EMPP_BASLIKSIZ_KABUL_PLATFORMLAR = 'macos,android'
$env:EMPP_KAYNAK_ARSIVI = "$K\veri\kaynak-arsivi"
$env:EMPP_SOURCE_CACHE = "$K\veri\cache"
$env:AGENT_UPLOAD_RATE = '25M'
$env:EMPP_KAYNAK_KUR = '0'  # kaynak-kur (r2-kur, 1-3 GB) Windows'ta ÖLÇÜLMEDİ: imkeys srv21 ssh ister, merdiven/üreteç denenmedi
$env:AGENT_OFISTE = '1'   # windows-kasa ofiste sabit (runner Windows'ta route ile konum ölçmez)
$env:AGENT_PACKAGE_TIMEOUT_MS = '3600000'
$env:NODE_OPTIONS = '--dns-result-order=ipv4first --no-network-family-autoselection'
Set-Location $R
$env:EMPP_IMZA_YUVA_KOKU = '\\172.17.2.23\Storage7\vhosts\akillitahta.ydspublishing.com\httpdocs\Uploads\KitapTekExe'   # 04.10 imza kapısı AÇIK: kasa tek imzacı (şef: AÇ)
$env:KABUL_KOK = 'C:\kabul'   # kabul.py exe önbelleği + profiller (04.10 C: taşıması)
$env:KABUL_AKT_KOD_DOSYASI = "$K\kabul\aktivasyon-test-kodu.txt"
