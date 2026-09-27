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
# DUSUS TANISI (2026-09-27, 45477 pardus): srv21 yolu iki kosuda da aktarim ORTASINDA dustu
# (04:50:05Z→04:56:16Z ve 06:05:37Z→06:19:56Z, ProBook sshd). Mac->srv21 tasiyicisi (OpenVPN)
# SAGLAMDI: ControlMaster oturumu ControlPersist'le 10 dk sonra temiz kapandi; ProBook duzenli
# kapanis gordu. ssh'in kendi cikis sebebi YOKTU: `scp -q` ssh'i de susturur (LogLevel QUIET),
# kabul stderr'i runner gunlugune dusmez. Bu yuzden -q YOK; her denemenin stderr'i
# $KANIT/aktarim-<yol>.err'e, son satirlari aktarim.txt'ye ve stdout'a (agent.log) yazilir,
# srv21 dususunde ProBook'taki yarim dosyanin boyu + UTC saat de kaydedilir.
# YENIDEN DENEME YOK (olcumle): srv21 dususu anlik kopma degil, 6-14 dk sonra ve 2/2 kosuda;
# yeniden deneme 1,28 GB'i sifirdan baslatir. O gunun aglarinda (gw 192.168.2.1 / 192.168.0.1)
# srv21 yolu hizli da degildi (8 MB deneme ~374 kB/s; scp yedegi Tailscale 415-477 kB/s).
# Iki yol da duserse (45477: Mac kapak kapali pilde uyudu, yedek scp 600/1277 MB'ta kaldi)
# donus 1 → kabul "ProBook'a aktarim dustu" der → runner ERTELER (failed yazmaz).
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
#     donus 0 = aktarildi + sha256 eslesti
#           1 = kopyalanamadi (scp basarisiz) VEYA ProBook sha256'si KONTROL baglantisindan
#               hic ALINAMADI (bir deneme daha sonra da bos) — OLCUM basarisizligidir, bayt
#               bozulmasinin KANITI DEGIL; altyapi sinifi (runner probookErisilemezHatasi
#               bunu ertelenebilir sayar) — 2026-09-27, 45479: bos sha "UYUSMADI" sayilip
#               RED-paket-kusuru gibi failed yazdiriyordu, oysa kontrol ssh'i o an
#               ulasamamisti (aktarim'in kendisi 760 MB tam gitmisti).
#           2 = sha256 GERCEK uyusmazlik — iki taraf da dolu ve FARKLI (bayt bozuldu,
#               test edilecek != yayinlanacak) — GERCEK RED, ertelenebilir DEGIL.
#   CLI (deneme/olcum): probook-aktarim.sh <yerel> <uzak-yol> [kanit-dizini]   (PROBOOK_AKTARIM varsayilan oto)
#   PROBOOK_AKTARIM_SHA_BEKLE (sn, varsayilan 5): sha_u ilk denemede bosken retry oncesi bekleme;
#     testlerde 0'a cekilir.

AKT_ATLAMA="${PROBOOK_SRV21_ATLAMA:-root@10.0.0.21}"
AKT_PORT="${PROBOOK_SRV21_PORT:-2222}"
AKT_LAN="${PROBOOK_LAN_HEDEF:-etapadmin@192.168.1.55}"
AKT_OFIS_GW="${PROBOOK_OFIS_GW:-192.168.1.254}"
AKT_SHA_BEKLE="${PROBOOK_AKTARIM_SHA_BEKLE:-5}"
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
# -q YOK: scp -q ssh'i LogLevel QUIET'e indirir, "Timeout, server not responding" gibi
# tek dusus kaniti da kaybolur (45477). Ilerleme cubugu yalniz stdout tty iken basilir.
aktarim_kopyala(){
  local lim=()
  [ -n "${PROBOOK_AKTARIM_HIZ_KBIT:-}" ] && lim=(-l "$PROBOOK_AKTARIM_HIZ_KBIT")
  if [ "$1" = srv21 ]; then
    scp -o ConnectTimeout=10 -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
      -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o "ProxyCommand=$(aktarim_proxy)" \
      -i "$KEY" ${lim[@]+"${lim[@]}"} "$2" "$AKT_LAN:$3"
  else
    scp -o ConnectTimeout=10 -o BatchMode=yes -i "$KEY" ${lim[@]+"${lim[@]}"} "$2" "$HOST:$3"
  fi
}

aktarim_utc(){ date -u +%Y-%m-%dT%H:%M:%SZ; }
# stderr dosyasinin son 3 satiri tek satirda (" | " ile), bos ise bos.
aktarim_son_hata(){
  [ -s "${1:-}" ] || return 0
  tail -n 3 "$1" | tr -d '\r' | awk 'NF{printf "%s%s", (n++ ? " | " : ""), $0}'
}
# Uzak dosyanin boyu KONTROL baglantisindan (yarim kalan aktarimin nereye vardigi); olcemezse bos.
aktarim_boyut_uzak(){
  "${SSH[@]}" "stat -c %s '$1' 2>/dev/null || wc -c < '$1'" 2>/dev/null | tr -dc '0-9'
}

probook_aktar(){
  local yerel="$1" uzak="$2" kanit="${3:-}" boyut=0 t0=0 sure=1 hiz=0 sha_y="" sha_u="" yol="" rc=0 sonuc=""
  local err_dir="" hata="" basla="" s21_rc="" s21_sn="" s21_utc="" s21_bayt="" s21_hata="" pb_bayt=""
  aktarim_yolu_sec
  aktarim_say "aktarim yolu: $AKT_YOL ($AKT_SEBEP)"
  sha_y=$(aktarim_sha_yerel "$yerel")
  if [ -z "$sha_y" ]; then aktarim_say "aktarim: Mac tarafi sha256 alinamadi: $yerel"; return 1; fi
  boyut=$(wc -c < "$yerel" | tr -d ' ')
  # TANI: her denemenin ssh/scp stderr'i kanitta (kanit yoksa eskisi gibi stderr'e akar).
  [ -n "$kanit" ] && mkdir -p "$kanit" 2>/dev/null && err_dir="$kanit"
  basla=$(aktarim_utc)
  t0=$(date +%s)
  yol="$AKT_YOL"
  if [ -n "$err_dir" ]; then aktarim_kopyala "$yol" "$yerel" "$uzak" 2>"$err_dir/aktarim-$yol.err"; rc=$?
  else aktarim_kopyala "$yol" "$yerel" "$uzak"; rc=$?; fi
  if [ "$rc" != 0 ] && [ "$yol" = srv21 ]; then
    s21_rc=$rc; s21_sn=$(( $(date +%s) - t0 )); s21_utc=$(aktarim_utc)
    s21_bayt=$(aktarim_boyut_uzak "$uzak")
    [ -n "$err_dir" ] && s21_hata=$(aktarim_son_hata "$err_dir/aktarim-srv21.err")
    aktarim_say "aktarim: srv21 yolu dustu (rc=$rc, ${s21_sn} sn, ProBook'ta ${s21_bayt:-?} B, $s21_utc)" \
      "— scp yedek yoluna geciliyor${s21_hata:+; ssh: $s21_hata}"
    yol=scp
    if [ -n "$err_dir" ]; then aktarim_kopyala scp "$yerel" "$uzak" 2>"$err_dir/aktarim-scp.err"; rc=$?
    else aktarim_kopyala scp "$yerel" "$uzak"; rc=$?; fi
  fi
  [ "$rc" != 0 ] && [ -n "$err_dir" ] && hata=$(aktarim_son_hata "$err_dir/aktarim-$yol.err")
  sure=$(( $(date +%s) - t0 )); [ "$sure" -gt 0 ] || sure=1
  hiz=$(( boyut / 1000 / sure ))
  if [ "$rc" = 0 ]; then
    sha_u=$(aktarim_sha_uzak "$uzak")
    # BOS sha_u = OLCUM basarisizligi (kontrol ssh'i o an ProBook'a ulasamadi), bayt
    # bozulmasinin KANITI DEGIL (2026-09-27, 45479). Bir kez daha dene, hala bossa
    # DOGRULANAMADI say — GERCEK uyusmazlikla (iki taraf dolu ve FARKLI) KARISTIRMA.
    if [ -z "$sha_u" ]; then
      [ "$AKT_SHA_BEKLE" -gt 0 ] 2>/dev/null && sleep "$AKT_SHA_BEKLE"
      sha_u=$(aktarim_sha_uzak "$uzak")
    fi
    if [ -n "$sha_u" ] && [ "$sha_u" = "$sha_y" ]; then
      sonuc=ESLESTI
    elif [ -z "$sha_u" ]; then
      sonuc=DOGRULANAMADI
      pb_bayt=$(aktarim_boyut_uzak "$uzak")
    else
      sonuc=UYUSMADI
    fi
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
      echo "AKTARIM_BASLA_UTC=$basla"
      echo "AKTARIM_BITIS_UTC=$(aktarim_utc)"
      echo "AKTARIM_RC=$rc"
      echo "AKTARIM_HATA=$hata"
      if [ -n "$s21_rc" ]; then
        echo "AKTARIM_SRV21_RC=$s21_rc"
        echo "AKTARIM_SRV21_SN=$s21_sn"
        echo "AKTARIM_SRV21_DUSUS_UTC=$s21_utc"
        echo "AKTARIM_SRV21_PROBOOK_BAYT=${s21_bayt:-?}"
        echo "AKTARIM_SRV21_HATA=$s21_hata"
      fi
      [ "$sonuc" = DOGRULANAMADI ] && echo "PROBOOK_BAYT=${pb_bayt:-?}"
    } > "$kanit/aktarim.txt"
  fi
  case "$sonuc" in
    ESLESTI)
      aktarim_say "aktarim: $((boyut / 1000000)) MB ${sure} sn (~${hiz} kB/s, yol=$yol), sha256 eslesti ${sha_y:0:16}"
      return 0 ;;
    KOPYALANAMADI)
      aktarim_say "aktarim: kopyalanamadi (yol=$yol rc=$rc, ${sure} sn, $(aktarim_utc))${hata:+; ssh: $hata}"
      return 1 ;;
    DOGRULANAMADI)
      aktarim_say "aktarim: ProBook sha256 alinamadi (kontrol baglantisi; ProBook'ta ${pb_bayt:-?} B) — altyapi, paket kusuru degil"
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
