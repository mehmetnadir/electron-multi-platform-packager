#!/bin/bash
# ProBook Pardus şeridi ORTAMI — serit-ajan.sh (canlı ajan) ve kuru-kosu.sh (yüklemesiz deneme)
# AYNI dosyayı `source` eder: kuru koşu canlıyla birebir aynı bayraklarla derler/kabul eder.
# runner.js yalnız ortamla ProBook kipine alınır:
#   AGENT_CAPS=pardus,kaynak-r2,kaynak-kur (06.10: sf425 kabuğu Mac'in kabuk ekinden)
#   PARDUS_BUILD_SCRIPT=pardus-yerel-build.sh (docker'sız, DEB kapalı)
#   EMPP_PARDUS_KABUL=1 + PROBOOK_HOST=yerel (kabul aynı makinede, scp yok)
#   PACKAGER_API=yerel logo ucu (ikon Mac'e bağımlı değil) · TMPDIR/önbellek ~/empp-serit altında
#   PATH başında docker şimi (runner'ın ensureDockerReady'si için; bkz. bin/docker)
SERIT="${EMPP_SERIT_KOK:-$HOME/empp-serit}"
REPO="${EMPP_SERIT_REPO:-$SERIT/repo}"
export EMPP_SERIT_KOK="$SERIT"
# $SERIT/opt/bin: kullanıcı düzeyi unrar (kur.sh unrar_kur) — WinRAR SFX kaynağını 7z AÇAMIYOR.
export PATH="$REPO/tools/probook/bin:$SERIT/opt/bin:$SERIT/node/bin:/usr/local/bin:/usr/bin:/bin"
# 02.10 (sözleşme §2c): ProBook ofis makinesi → build kurulumu (kaynak-kur, 1–3 GB R2 yüklemesi) da
# burada koşar. runner iki rolü heartbeat'te yeniden hesaplar: kaynak-r2 her zaman, kaynak-kur yalnız
# ofis geçidinde (ip route default via 192.168.1.254) ya da ~/.empp-agent/kaynak-kur-serbest.istek ile.
# kaynak-kur GERİ (06.10, kabuk-eki-tasarim.md §4): 17de4c8 bu yeteneği kaldırmıştı. Sebep: sf425
# kabuğunu üreten Swift ikilisi Linux'ta yok; ProBook r2-kur alınca kabuk ESKİ kalıp yeni build.zip
# geçerli oluyordu (45551 2.51.3). Artık Mac kabuğu üretip CDN'e "kabuk eki" olarak koyar
# (tools/set-kabuk/ek-uret.js). ProBook aynı JS ile girdi parmak izini hesaplar, eki uygular; bütün
# kapılar aynen koşar. Ek yok/bayat/bozuk ya da kapı RED → iş ERTELENİR (eski kabukla kaynak çıkmaz).
# Acil geri dönüş: EMPP_SET_KABUK_KAYNAGI= (boş) ya da EMPP_KAYNAK_KUR=0.
export AGENT_CAPS="${AGENT_CAPS:-pardus,kaynak-r2,kaynak-kur}"
export EMPP_SET_KABUK_TAZELE="${EMPP_SET_KABUK_TAZELE:-1}"
export EMPP_SET_KABUK_KAYNAGI="${EMPP_SET_KABUK_KAYNAGI-ek}"
export AGENT_NAME="${AGENT_NAME:-probook-serit}"
export PARDUS_BUILD_SCRIPT="${PARDUS_BUILD_SCRIPT:-$REPO/tools/pardus/pardus-yerel-build.sh}"
export PARDUS_KABUL_SCRIPT="${PARDUS_KABUL_SCRIPT:-$REPO/tools/pardus/probook-kabul.sh}"
export EMPP_PARDUS_KABUL="${EMPP_PARDUS_KABUL:-1}"
export PROBOOK_HOST="${PROBOOK_HOST:-yerel}"
export EMPP_LINUX_DEB="${EMPP_LINUX_DEB:-0}"
export EMPP_LOGO_PORT="${EMPP_LOGO_PORT:-3095}"
export EMPP_LOGO_DIZIN="${EMPP_LOGO_DIZIN:-$SERIT/logolar}"
export PACKAGER_API="${PACKAGER_API:-http://127.0.0.1:$EMPP_LOGO_PORT}"
export EMPP_SOURCE_CACHE="${EMPP_SOURCE_CACHE:-$SERIT/cache/kaynak}"
# 43e23 motor kanonigi (2026-09-26, E3): Mac docker seridiyle AYNI degisken. Kanonik Mac'ten LAN ile
# eslenir (arsiv-esle.sh); nabiz-yaz.js sha12'sini nabza yazar, Mac esit degilse pardus'u kendi alir.
export EMPP_MOTOR_KANONIK="${EMPP_MOTOR_KANONIK:-$HOME/.empp-agent/motor/kanonik.json}"
export TMPDIR="${TMPDIR_SERIT:-$SERIT/work}"
# MAC PARİTESİ (02.10, ilk canlı koşu): Mac run-agent.sh'taki pardus'u etkileyen bayraklar burada yoktu →
# 74430 paketi G (SET güncelleme) kanalı OLMADAN üretiliyordu ("G açık anahtarı yok"). Mac ile aynı değerler:
#   G kanalı: ÜRETİM ed25519 AÇIK anahtarı (SPKI sha256 31b8663b…2cf6; özel anahtar Anahtar Zinciri + srv21'de,
#   burada YOK). Kapsam listesi Mac'teki ile birebir; linux işinde yalnız `linux` öğesi etkilidir.
export EMPP_SET_GUNCELLEME="${EMPP_SET_GUNCELLEME:-windows,macos,linux,android}"
export EMPP_GUNCELLEME_ACIK_ANAHTAR="${EMPP_GUNCELLEME_ACIK_ANAHTAR:-MCowBQYDK2VwAyEAkPKHFRPDIeuQqAa8kWELMl2+14Ga/WHrjfVHDeTR4H4=}"
#   Set üyeliği eki (panelde sete eklenen kitap pakete bookN) + arşiv içerik merdiveni S0/S1.
export EMPP_SET_UYELIK_EK="${EMPP_SET_UYELIK_EK:-1}"
export EMPP_SET_LISTESI_DIZINI="${EMPP_SET_LISTESI_DIZINI:-$HOME/.empp-agent/set-listesi}"
export EMPP_ARSIV_MERDIVEN="${EMPP_ARSIV_MERDIVEN:-1}"
#   Kabul E6/E7 (CDP, ayrı ev) + SET'te tüm alt kitapların güncelliği + K4 — Mac'in ProBook kabulüyle aynı.
export KABUL_CDP="${KABUL_CDP:-1}" KABUL_SET_TUM="${KABUL_SET_TUM:-1}" KABUL_K4="${KABUL_K4:-1}"
#   Ad karşılaştırması (02.10, run-agent.sh ↔ bu dosya): K17 set menüsü Mac'te açıkça 1 — burada da açık yazılır
#   (pardus-yerel-build.sh varsayılanı zaten 1). Açılış bekleme TABANI Mac'le aynı 420 sn; yerel kip boyutla büyütür.
#   Bilerek ALINMAYANLAR: EMPP_BASLIKSIZ_KABUL(_PLATFORMLAR) (yalnız macos/android), EMPP_RUNNER_WINDOWS,
#   EMPP_PARDUS_HAZIR_DIR (srv21 hazır şeridi; ProBook kendisi üretir), PROBOOK_AKTARIM (uzak kip aktarımı),
#   EMPP_ICERIK_GUNCELLEME (pardus-yerel-build.sh OKUMAZ, PARDUS_ICERIK_GUNCELLEME=linux), EMPP_SAYFA_WEBP (linux'ta 0).
export EMPP_SET_MENU="${EMPP_SET_MENU:-1}"
export PROBOOK_BEKLE="${PROBOOK_BEKLE:-420}"
# Kabul boşluk beklemesi (başka kapı/uygulama) ajan zaman aşımına sayılır; zaman aşımı
# runner'da "ertelenebilir" sınıftır (failed YAZILMAZ). Derleme 2011 CPU'da uzun sürer.
export AGENT_PARDUS_KABUL_TIMEOUT_MS="${AGENT_PARDUS_KABUL_TIMEOUT_MS:-2700000}"
export KABUL_BOSLUK_TAVAN="${KABUL_BOSLUK_TAVAN:-3600}"
export AGENT_PARDUS_TIMEOUT_MS="${AGENT_PARDUS_TIMEOUT_MS:-5400000}"
export AGENT_PACKAGE_TIMEOUT_MS="${AGENT_PACKAGE_TIMEOUT_MS:-5400000}"
export ELECTRON_CACHE="${ELECTRON_CACHE:-$SERIT/cache/electron}"
export ELECTRON_BUILDER_CACHE="${ELECTRON_BUILDER_CACHE:-$SERIT/cache/electron-builder}"
# Derleme boyunca kabul kilidi (plan B.2): başka ajanın uzak kabulü derlemeyle çakışmaz.
export EMPP_DERLEME_KABUL_KILIDI="${EMPP_DERLEME_KABUL_KILIDI:-1}"
# Kabul kanıtı 14 gün (plan B.1): runner çalışma dizinini silse de ekran/ölçüm ~/empp-serit/kanit/kabul-*.
export EMPP_KANIT_ARSIV="${EMPP_KANIT_ARSIV:-$SERIT/kanit}"
# Mac run-agent.sh ile aynı: Happy Eyeballs yarışında boş mesajlı AggregateError (%52 heartbeat hatası).
export NODE_OPTIONS="${NODE_OPTIONS:---dns-result-order=ipv4first --no-network-family-autoselection}"
# Yükleme hızı Mac kuralıyla aynı: ofiste (gw 192.168.1.254) 25 MB/s, başka hatta 4 MB/s.
_GW=$(ip route show default 2>/dev/null | awk '/^default/{print $3; exit}')
if [ -z "${AGENT_UPLOAD_RATE:-}" ]; then
  if [ "$_GW" = "192.168.1.254" ]; then export AGENT_UPLOAD_RATE=25M; else export AGENT_UPLOAD_RATE=4M; fi
fi
# Kaynak indirme: runner varsayılanı 2 MB/s (srv21 geçidinin büyük aktarım sıfırlaması için konmuş,
# ProBook o geçidin arkasında DEĞİL). Ölçüm 26.09: ProBook Cloudflare'den 849 MB'ı 21 sn'de indirdi
# (40 MB/s). Ofiste 25 MB/s (hattın yarısından az), başka hatta runner varsayılanı.
if [ -z "${AGENT_DOWNLOAD_RATE:-}" ] && [ "$_GW" = "192.168.1.254" ]; then export AGENT_DOWNLOAD_RATE=25M; fi
mkdir -p "$SERIT/work" "$SERIT/log" "$EMPP_SOURCE_CACHE" "$EMPP_LOGO_DIZIN"

