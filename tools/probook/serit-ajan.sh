#!/bin/bash
# ProBook Pardus şeridi — systemd KULLANICI birimi empp-serit-agent.service'in ExecStart'ı.
# runner.js (DONDURULMUŞ) DEĞİŞTİRİLMEDEN, yalnız ortamla ProBook kipine alınır:
#   AGENT_CAPS=pardus · PARDUS_BUILD_SCRIPT=pardus-yerel-build.sh (docker'sız, DEB kapalı)
#   EMPP_PARDUS_KABUL=1 + PROBOOK_HOST=yerel (kabul aynı makinede, scp yok)
#   PACKAGER_API=yerel logo ucu (ikon Mac'e bağımlı değil) · TMPDIR/önbellek ~/empp-serit altında
#   PATH başında docker şimi (runner'ın ensureDockerReady'si için; bkz. bin/docker)
# Yanında iki çocuk: logo-sunucu.js (127.0.0.1:3095) ve nabiz-yaz.js (her 60 sn nabiz.json).
set -u
SERIT="${EMPP_SERIT_KOK:-$HOME/empp-serit}"
REPO="${EMPP_SERIT_REPO:-$SERIT/repo}"
export EMPP_SERIT_KOK="$SERIT"
export PATH="$REPO/tools/probook/bin:$SERIT/node/bin:/usr/local/bin:/usr/bin:/bin"
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
export TMPDIR="${TMPDIR_SERIT:-$SERIT/work}"
# Kabul boşluk beklemesi (başka kapı/uygulama) ajan zaman aşımına sayılır; zaman aşımı
# runner'da "ertelenebilir" sınıftır (failed YAZILMAZ). Derleme 2011 CPU'da uzun sürer.
export AGENT_PARDUS_KABUL_TIMEOUT_MS="${AGENT_PARDUS_KABUL_TIMEOUT_MS:-2700000}"
export KABUL_BOSLUK_TAVAN="${KABUL_BOSLUK_TAVAN:-3600}"
export AGENT_PARDUS_TIMEOUT_MS="${AGENT_PARDUS_TIMEOUT_MS:-5400000}"
export AGENT_PACKAGE_TIMEOUT_MS="${AGENT_PACKAGE_TIMEOUT_MS:-5400000}"
export ELECTRON_CACHE="${ELECTRON_CACHE:-$SERIT/cache/electron}"
export ELECTRON_BUILDER_CACHE="${ELECTRON_BUILDER_CACHE:-$SERIT/cache/electron-builder}"
mkdir -p "$SERIT/work" "$SERIT/log" "$EMPP_SOURCE_CACHE" "$EMPP_LOGO_DIZIN"

ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
echo "$(ts) serit-ajan basliyor: caps=$AGENT_CAPS host=$PROBOOK_HOST build=$PARDUS_BUILD_SCRIPT surum=$(cat "$REPO/.serit-surum" 2>/dev/null || echo ?)"

node "$REPO/tools/probook/logo-sunucu.js" >> "$SERIT/log/logo.log" 2>&1 &
LOGO=$!
node "$REPO/src/agent/runner.js" >> "$SERIT/log/agent.log" 2>&1 &
RUNNER=$!
node "$REPO/tools/probook/nabiz-yaz.js" "$RUNNER" >> "$SERIT/log/nabiz.log" 2>&1 &
NABIZ=$!
dur(){ kill -TERM "$RUNNER" 2>/dev/null; wait "$RUNNER"; kill "$LOGO" "$NABIZ" 2>/dev/null; exit 0; }
trap dur TERM INT
wait "$RUNNER"; RC=$?
kill "$LOGO" "$NABIZ" 2>/dev/null
echo "$(ts) runner cikti rc=$RC (systemd Restart=always yeniden baslatir)"
exit "$RC"
