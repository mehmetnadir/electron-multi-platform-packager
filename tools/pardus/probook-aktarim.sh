#!/bin/bash
# ProBook AKTARIM YOLU — buyuk .impark'in Mac'ten ProBook'a hangi yoldan gidecegi
# (2026-09-26, olcumle). probook-kabul.sh YALNIZ PROBOOK_AKTARIM doluysa bu dosyayi kullanir;
# bosken kopya adimi eskisiyle birebir aynidir (tek scp, sha256 yok).
#
# NEDEN (olcum 26.09 21:57, Nadir evde, gw 192.168.2.1, Turkcell cikisi):
# Tailscale Mac<->ProBook ve Mac<->srv21 DOGRUDAN kurulamiyor, ikisi de DERP rolesinden
# ("nue") geciyor. Ayni anda (uretim scp'si surerken, test basina <=20 MB):
#   Mac->ProBook Tailscale scp (uretim, 1220 MB)    ~238 kB/s  role   -> 1,2 GB ~87 dk
#   Mac->srv21 Tailscale (5 MB)                        64 kB/s  role (uretim scp'siyle paylasimli)
#   Mac->internet, Cloudflare yukleme (20 MB)        1551 kB/s  ev hatti
#   Mac->srv21 OpenVPN 10.0.0.21:2222 (20 MB)        1534 kB/s  dogrudan
#   Mac->ProBook ssh atlama srv21 -> 192.168.1.55    1392 kB/s  OpenVPN + IPsec LAN -> 1,2 GB ~15 dk
#   srv21->ProBook 192.168.1.55 (20 MB)              4948 kB/s  LAN (srv21 Tailscale'de de dogrudan)
#   ProBook kendi hatti, Cloudflare indirme         53000 kB/s
# Darbogaz ev hatti DEGIL, Tailscale rolesi (role uzerinden ping 430-1220 ms, taban 78 ms).
# srv21 atlamasi (ProxyCommand ssh -W) akisi roleden cikarir: bayt srv21 diskine YAZILMAZ,
# ssh sifrelemesi Mac<->ProBook uctan uca kalir (srv21 yalniz TCP tasir).
#
# GUVENLIK (kabul kapisinin anlami degismez): hangi yol secilirse secilsin ProBook'un test
# edecegi bayt = Mac'teki bayt. sha256 iki uctan alinir — Mac: shasum, ProBook: sha256sum
# KONTROL baglantisindan (PROBOOK_HOST; aktarim yolundan bagimsiz). Eslesmezse donus 2 -> RED.
# Atlama hedefi (LAN adresi) kontrol hedefiyle ayni makine degilse (/etc/machine-id)
# srv21 yolu KULLANILMAZ (DHCP adresi baska makineye gecmis olabilir).
#
# Ortam:
#   PROBOOK_AKTARIM   scp | srv21 | oto
#       scp   eski yol (PROBOOK_HOST'a dogrudan scp) + sha256 dogrulamasi
#       srv21 atlama yolu; atlama erisilemezse / farkli makineyse / aktarim duserse scp'ye duser
#       oto   varsayilan ag gecidi ofisinki (PROBOOK_OFIS_GW) ise scp (ofiste LAN dogrudan),
#             degilse srv21 atlamasi hazirsa srv21, degilse scp
#   PROBOOK_SRV21_ATLAMA (root@10.0.0.21 — OpenVPN; Tailscale adresi de role oldugu icin kazanc yok)
#   PROBOOK_SRV21_PORT (2222)  PROBOOK_LAN_HEDEF (etapadmin@192.168.1.55 — srv21'den gorulen adres)
#   PROBOOK_OFIS_GW (192.168.1.254)  PROBOOK_AKTARIM_HIZ_KBIT (bos = sinirsiz; scp -l, Kbit/s —
#   ev hattini tamamen doldurmamak icin)
# Kullanim:
#   kutuphane: HOST, KEY ve SSH dizisi tanimliyken `. probook-aktarim.sh; probook_aktar <yerel> <uzak> [kanit]`
#     donus 0 = aktarildi + sha256 eslesti · 1 = kopyalanamadi · 2 = sha256 uyusmadi/dogrulanamadi
#   CLI (deneme/olcum): probook-aktarim.sh <yerel> <uzak-yol> [kanit-dizini]   (PROBOOK_AKTARIM varsayilan oto)

AKT_ATLAMA="${PROBOOK_SRV21_ATLAMA:-root@10.0.0.21}"
AKT_PORT="${PROBOOK_SRV21_PORT:-2222}"
AKT_LAN="${PROBOOK_LAN_HEDEF:-etapadmin@192.168.1.55}"
AKT_OFIS_GW="${PROBOOK_OFIS_GW:-192.168.1.254}"
AKT_YOL=scp
AKT_SEBEP=""

aktarim_say(){ if declare -F say >/dev/null; then say "$@"; else printf '[aktarim] %s\n' "$*"; fi; }

aktarim_ag_gecidi(){
  local g=""
  g=$(route -n get default 2>/dev/null | awk '/gateway:/{print $2; exit}')
  [ -n "$g" ] || g=$(ip route show default 2>/dev/null | awk '{print $3; exit}')
  printf '%s' "$g"
}

# srv21 uzerinden ProBook LAN adresine TCP tuneli (ssh -W). Bayt srv21'de diske inmez.
aktarim_proxy(){
  printf 'ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -p %s -i %s -W %%h:%%p %s' \
    "$AKT_PORT" "$KEY" "$AKT_ATLAMA"
}

aktarim_atlama_ssh(){
  ssh -o ConnectTimeout=10 -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    -o "ProxyCommand=$(aktarim_proxy)" -i "$KEY" "$AKT_LAN" "$@"
}

# AKT_YOL (scp|srv21) + AKT_SEBEP yazar. Alt kabukta cagrilmaz (global degisken).
aktarim_yolu_sec(){
  local istek="${PROBOOK_AKTARIM:-scp}" gw="" mid_k="" mid_l=""
  AKT_YOL=scp; AKT_SEBEP=""
  case "$istek" in
    scp) AKT_SEBEP="PROBOOK_AKTARIM=scp"; return 0 ;;
    srv21|oto) ;;
    *) AKT_SEBEP="bilinmeyen PROBOOK_AKTARIM=$istek — scp"; return 0 ;;
  esac
  if [ "$istek" = oto ]; then
    gw=$(aktarim_ag_gecidi)
    if [ -n "$gw" ] && [ "$gw" = "$AKT_OFIS_GW" ]; then
      AKT_SEBEP="oto: ofis agi (gw $gw) — dogrudan scp"; return 0
    fi
  fi
  mid_l=$(aktarim_atlama_ssh 'cat /etc/machine-id' 2>/dev/null | tr -dc '0-9a-f')
  if [ -z "$mid_l" ]; then
    AKT_SEBEP="$istek: srv21 atlamasi ulasilamadi ($AKT_ATLAMA:$AKT_PORT -> $AKT_LAN) — scp"; return 0
  fi
  mid_k=$("${SSH[@]}" 'cat /etc/machine-id' 2>/dev/null | tr -dc '0-9a-f')
  if [ "$mid_l" != "$mid_k" ]; then
    AKT_SEBEP="$istek: atlama hedefi $AKT_LAN kontrol hedefiyle ($HOST) ayni makine degil — scp"; return 0
  fi
  AKT_YOL=srv21
  AKT_SEBEP="$istek: ${gw:+gw $gw, }srv21 atlamasi hazir ($AKT_ATLAMA:$AKT_PORT -> $AKT_LAN, ayni machine-id)"
}

aktarim_sha_yerel(){ { shasum -a 256 "$1" 2>/dev/null || sha256sum "$1" 2>/dev/null; } | awk '{print $1; exit}'; }
# Uzak sha KONTROL baglantisindan (PROBOOK_HOST) — aktarimin gittigi yoldan bagimsiz tanik.
aktarim_sha_uzak(){ "${SSH[@]}" "sha256sum '$1'" 2>/dev/null | awk '{print $1; exit}'; }

# $1 yol (scp|srv21)  $2 yerel  $3 uzak yol
aktarim_kopyala(){
  local lim=()
  [ -n "${PROBOOK_AKTARIM_HIZ_KBIT:-}" ] && lim=(-l "$PROBOOK_AKTARIM_HIZ_KBIT")
  if [ "$1" = srv21 ]; then
    scp -q -o ConnectTimeout=10 -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
      -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o "ProxyCommand=$(aktarim_proxy)" \
      -i "$KEY" ${lim[@]+"${lim[@]}"} "$2" "$AKT_LAN:$3"
  else
    scp -q -o ConnectTimeout=10 -o BatchMode=yes -i "$KEY" ${lim[@]+"${lim[@]}"} "$2" "$HOST:$3"
  fi
}

probook_aktar(){
  local yerel="$1" uzak="$2" kanit="${3:-}" boyut=0 t0=0 sure=1 hiz=0 sha_y="" sha_u="" yol="" rc=0 sonuc=""
  aktarim_yolu_sec
  aktarim_say "aktarim yolu: $AKT_YOL ($AKT_SEBEP)"
  sha_y=$(aktarim_sha_yerel "$yerel")
  if [ -z "$sha_y" ]; then aktarim_say "aktarim: Mac tarafi sha256 alinamadi: $yerel"; return 1; fi
  boyut=$(wc -c < "$yerel" | tr -d ' ')
  t0=$(date +%s)
  yol="$AKT_YOL"
  aktarim_kopyala "$yol" "$yerel" "$uzak"; rc=$?
  if [ "$rc" != 0 ] && [ "$yol" = srv21 ]; then
    aktarim_say "aktarim: srv21 yolu dustu (rc=$rc) — scp yedek yoluna geciliyor"
    yol=scp
    aktarim_kopyala scp "$yerel" "$uzak"; rc=$?
  fi
  sure=$(( $(date +%s) - t0 )); [ "$sure" -gt 0 ] || sure=1
  hiz=$(( boyut / 1000 / sure ))
  if [ "$rc" = 0 ]; then
    sha_u=$(aktarim_sha_uzak "$uzak")
    if [ -n "$sha_u" ] && [ "$sha_u" = "$sha_y" ]; then sonuc=ESLESTI; else sonuc=UYUSMADI; fi
  else
    sonuc=KOPYALANAMADI
  fi
  if [ -n "$kanit" ] && mkdir -p "$kanit" 2>/dev/null; then
    {
      echo "AKTARIM_YOL=$yol"
      echo "AKTARIM_SEBEP=$AKT_SEBEP"
      echo "AKTARIM_BAYT=$boyut"
      echo "AKTARIM_SN=$sure"
      echo "AKTARIM_KBS=$hiz"
      echo "SHA256_MAC=$sha_y"
      echo "SHA256_PROBOOK=${sha_u:-yok}"
      echo "AKTARIM_SONUC=$sonuc"
    } > "$kanit/aktarim.txt"
  fi
  case "$sonuc" in
    ESLESTI)
      aktarim_say "aktarim: $((boyut / 1000000)) MB ${sure} sn (~${hiz} kB/s, yol=$yol), sha256 eslesti ${sha_y:0:16}"
      return 0 ;;
    KOPYALANAMADI)
      aktarim_say "aktarim: kopyalanamadi (yol=$yol rc=$rc)"
      return 1 ;;
    *)
      aktarim_say "aktarim: sha256 UYUSMADI — Mac ${sha_y:0:16} / ProBook ${sha_u:-yok} (test edilecek bayt yayinlanacak bayt degil)"
      return 2 ;;
  esac
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -uo pipefail
  [ $# -ge 2 ] || { echo "kullanim: $0 <yerel> <uzak-yol> [kanit-dizini]" >&2; exit 64; }
  HOST="${PROBOOK_HOST:-etapadmin@100.73.161.76}"
  KEY="${PROBOOK_KEY:-$HOME/.ssh/id_ed25519}"
  SSH=(ssh -o ConnectTimeout=10 -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY" "$HOST")
  PROBOOK_AKTARIM="${PROBOOK_AKTARIM:-oto}"
  probook_aktar "$1" "$2" "${3:-}"
  exit $?
fi
