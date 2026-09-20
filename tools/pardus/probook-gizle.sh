#!/usr/bin/env bash
# ProBook kabul kapısı — TESTTEN ÖNCE: envanter + gizleme.
# Uzak makinede `bash -s <DAMGA>` ile koşar; probook-kabul.sh stdin'e verir.
# Eşi: probook-temizlik.sh (geri alma). Testi: src/agent/probook-temizlik.test.js
#
# İKİ KURULUM KÖKÜ VAR (2026-09-19 ölçüldü, kapı yalnız birincisini biliyordu):
#   ~/DijiTap/DijiTap/<Set Adi>          — SET paketleri
#   ~/DijiTap/<alan-adi>/<Kitap>         — tekil kitap (passthrough)
# Kanıt: Lingo-Land-Grade-3 koşusundan sonra
# ~/DijiTap/akillitahta.ydspublishing.com/Lingo-Land-Grade-3 = 514 MB geride kaldı.
# İkinci kök gizlenmediği için AppRun'in `.empp-version` önbelleği de devrede
# kalıyordu: kapı bayat kurulumu açıp paketi onaylayabilirdi.
#
# Envanter biçimi (satır başına bir kurulum, $HOME/DijiTap'a göreli):
#   DijiTap/Super Monsters 3 Set
#   akillitahta.ydspublishing.com/Lingo-Land-Grade-3
set -u

DAMGA="${1:?damga gerekli}"
TABAN="$HOME/DijiTap"
ONCEKI="/tmp/kabul-onceki-$DAMGA.txt"

# Gizlemeden once calisan kurulumu kapat — eski kalip yalniz DijiTap/DijiTap'i
# tutuyordu, tekil kitap paketleri (~/DijiTap/<alan-adi>/<Kitap>) ayakta kaliyordu.
pkill -f "$HOME/[D]ijiTap/" 2>/dev/null
sleep 2

mkdir -p "$TABAN"
: > "$ONCEKI"

for kok in "$TABAN"/*/; do
  [ -d "$kok" ] || continue
  kokad="$(basename "${kok%/}")"
  case "$kokad" in *.kabulgizli-*) continue ;; esac
  for d in "$kok"*/; do
    [ -d "$d" ] || continue
    ad="$(basename "${d%/}")"
    case "$ad" in *.kabulgizli-*) continue ;; esac
    echo "$kokad/$ad" >> "$ONCEKI"
    mv "${d%/}" "${d%/}.kabulgizli-$DAMGA" && echo "gizlendi: $kokad/$ad"
  done
done
exit 0
