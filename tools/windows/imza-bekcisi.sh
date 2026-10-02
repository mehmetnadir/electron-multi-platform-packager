#!/bin/bash
# İMZA BEKÇİSİ — launchd sarmalayıcısı (her 30 dk; şablon launchd/com.empp.imza-bekcisi.plist).
# Ortam runner'la AYNI kaynaktan: ~/.empp-agent/run-agent.sh içindeki PATH / BOOKUPDATE_API /
# NODE_OPTIONS / KABUL_* / EMPP_BASLIKSIZ_KABUL_PLATFORMLAR / EMPP_SET_* satırları okunur (yalnız bu
# adlar; jeton ve sırlar okunmaz — bekçi jetonu runner'ın token.json'undan alır). Yükleme hızı
# run-agent.sh ile aynı kural: ofiste (gw 192.168.1.254) 25M, değilse 4M.
# Günlük: ~/.empp-agent/logs/imza-bekcisi.log  ·  Kuru tur: imza-bekcisi.sh --kuru
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
RA="$HOME/.empp-agent/run-agent.sh"
if [ -f "$RA" ]; then
  eval "$(grep -E '^export (PATH|BOOKUPDATE_API|NODE_OPTIONS|EMPP_BASLIKSIZ_KABUL_PLATFORMLAR|EMPP_SET_[A-Z_]+|KABUL_[A-Z_]+)=' "$RA")"
fi
if [ -z "${AGENT_UPLOAD_RATE:-}" ]; then
  _GW=$(route -n get default 2>/dev/null | awk '/gateway:/{print $2; exit}')
  if [ "$_GW" = "192.168.1.254" ]; then export AGENT_UPLOAD_RATE=25M; else export AGENT_UPLOAD_RATE=4M; fi
fi
mkdir -p "$HOME/.empp-agent/logs"
exec node tools/windows/imza-bekcisi.js "$@" >>"$HOME/.empp-agent/logs/imza-bekcisi.log" 2>&1
