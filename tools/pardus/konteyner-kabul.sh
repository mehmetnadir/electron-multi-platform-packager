#!/bin/bash
# PARDUS KONTEYNER YEDEK KABUL SARMALAYICISI (2026-09-27, Nadir: "ProBook elektrik
# kesintisiyle kapandi, yarina kadar bu Mac'teki docker uzerinden fallback'i devreye al").
#
# ProBook'un YERINE GECMEZ — ProBook erisilemezken SURELI koprudur (bkz. runner.js
# pardusYedekKabul() + CONFIG.pardusYedekKabulFlag, bayrak: ~/.empp-agent/pardus-konteyner-kabul.istek).
# Asil olcum konteyner-kapi.sh'tadir (imaj pardus-kapi:3, ProBook ile BIREBIR ayni esikler);
# bu betik yalnizca docker'i saglik + calistirma sarmalayicisidir.
#
# Kullanim: konteyner-kabul.sh <impark-yolu> <kanit-dizini>
# Cikis kodlari (konteyner-kapi.sh ile AYNI + kendi kapi kusuru):
#   0 GECTI          — yukle
#   1 RED            — paket kusuru (`failed` yazilir)
#   2 OLCULEMEDI     — kapi kusuru: docker yok/kapali, imaj yok, ya da docker run
#                      beklenmeyen bir kodla dustu (125/126/127, sinyal) — paket
#                      kusuru DEGIL, is ertelenmeli.
set -uo pipefail

IMPARK="${1:?impark yolu}"
KANIT="${2:?kanit dizini}"
IMAJ="${PARDUS_KAPI_IMAJ:-pardus-kapi:3}"
TOOLS="$(cd "$(dirname "$0")" && pwd -P)"

say(){ echo "[kkabul] $*"; }

if ! docker info >/dev/null 2>&1; then
  say "OLCULEMEDI: docker erisilemiyor (docker info basarisiz — daemon kapali olabilir)"
  exit 2
fi

if ! docker image inspect "$IMAJ" >/dev/null 2>&1; then
  say "OLCULEMEDI: imaj yok: $IMAJ (Dockerfile.pardus-kapi ile kurulmali)"
  exit 2
fi

mkdir -p "$KANIT"

# konteyner-kapi.sh'i imajdakinin YERINE bind-mount ile geciriyoruz: imaj bayat kalsa bile
# repo'daki guncel betik kosar (Nadir'in elle denemesiyle birebir ayni komut satiri).
docker run --rm --platform linux/amd64 --shm-size=1g \
  -v "$IMPARK:/paket.impark:ro" \
  -v "$KANIT:/kanit" \
  -v "$TOOLS/konteyner-kapi.sh:/usr/local/bin/konteyner-kapi:ro" \
  -e KAPI_AKTIVASYON \
  -e KAPI_BEKLE \
  "$IMAJ" /paket.impark /kanit
RC=$?

case "$RC" in
  0|1|2) exit "$RC" ;;
  *)
    say "OLCULEMEDI: docker run beklenmeyen kodla dustu (rc=$RC) — paket suclanamaz"
    exit 2
    ;;
esac
