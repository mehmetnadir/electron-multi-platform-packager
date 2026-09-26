#!/bin/bash
# ProBook Pardus şeridi — systemd KULLANICI birimi empp-serit-agent.service'in ExecStart'ı.
# Ortam: serit-ortam.sh (kuru-kosu.sh ile ortak). Yanında iki çocuk: logo-sunucu.js
# (127.0.0.1:3095) ve nabiz-yaz.js (her 60 sn nabiz.json).
set -u
# shellcheck source=serit-ortam.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/serit-ortam.sh"

ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
echo "$(ts) serit-ajan basliyor: caps=$AGENT_CAPS host=$PROBOOK_HOST build=$PARDUS_BUILD_SCRIPT surum=$(cat "$REPO/.serit-surum" 2>/dev/null || echo ?)"
# Açılış onarımı (plan B.3): yetim kabul gizlemesi + yetim iş dizini — iş almadan ÖNCE.
[ -f "$REPO/tools/probook/yetim-onar.sh" ] && bash "$REPO/tools/probook/yetim-onar.sh" 2>&1 | sed "s/^/$(ts) /"

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
