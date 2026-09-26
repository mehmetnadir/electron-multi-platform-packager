#!/bin/bash
# ProBook Pardus şeridi ORTAMI — serit-ajan.sh (canlı ajan) ve kuru-kosu.sh (yüklemesiz deneme)
# AYNI dosyayı `source` eder: kuru koşu canlıyla birebir aynı bayraklarla derler/kabul eder.
# runner.js yalnız ortamla ProBook kipine alınır:
#   AGENT_CAPS=pardus · PARDUS_BUILD_SCRIPT=pardus-yerel-build.sh (docker'sız, DEB kapalı)
#   EMPP_PARDUS_KABUL=1 + PROBOOK_HOST=yerel (kabul aynı makinede, scp yok)
#   PACKAGER_API=yerel logo ucu (ikon Mac'e bağımlı değil) · TMPDIR/önbellek ~/empp-serit altında
#   PATH başında docker şimi (runner'ın ensureDockerReady'si için; bkz. bin/docker)
SERIT="${EMPP_SERIT_KOK:-$HOME/empp-serit}"
REPO="${EMPP_SERIT_REPO:-$SERIT/repo}"
export EMPP_SERIT_KOK="$SERIT"
# $SERIT/opt/bin: kullanıcı düzeyi unrar (kur.sh unrar_kur) — WinRAR SFX kaynağını 7z AÇAMIYOR.
export PATH="$REPO/tools/probook/bin:$SERIT/opt/bin:$SERIT/node/bin:/usr/local/bin:/usr/bin:/bin"
export AGENT_CAPS="${AGENT_CAPS:-pardus}"
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

