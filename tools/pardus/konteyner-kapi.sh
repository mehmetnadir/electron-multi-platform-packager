#!/bin/bash
# PARDUS KONTEYNER KABUL KAPISI (tier-1) — paketi Xvfb altında açar, ÖLÇER.
# Ölçütler ProBook kapısıyla BİREBİR aynı (probook-kabul.sh):
#   sapma >= 0.05 · koyu >= 0.005 · renk >= 500   (aktivasyon kodlu seride renk aranmaz)
# Çıkış 0 = geçti, 1 = RED, 2 = ölçülemedi (kapı kusuru, paket kusuru DEĞİL).
set -uo pipefail
PAKET="${1:?impark yolu}"
KANIT="${2:-/kanit}"
BEKLE="${KAPI_BEKLE:-240}"
PENCERE="${KAPI_PENCERE:-20}"
DENEME="${KAPI_DENEME:-4}"
AKTIVASYON="${KAPI_AKTIVASYON:-0}"

mkdir -p "$KANIT"
say(){ echo "[kkapi] $*"; }
# KANIT HER YOLDA KALIR (2026-09-20 dersi): ilk surumde pencere acilmayinca
# red() dogrudan cikiyordu ve calisma gunlugu KANIT dizinine hic kopyalanmiyordu;
# teshis icin konteyneri bastan kosturmak gerekti.
kanitiSakla(){
  cp /tmp/calisma.log "$KANIT/calisma.log" 2>/dev/null
  import -window root "$KANIT/masaustu.png" 2>/dev/null
}
red(){ kanitiSakla; say "RED: $*"; echo "RED: $*" > "$KANIT/sonuc.txt"; exit 1; }
olcumsuz(){ kanitiSakla; say "OLCULEMEDI: $*"; echo "OLCULEMEDI: $*" > "$KANIT/sonuc.txt"; exit 2; }

[ -f "$PAKET" ] || olcumsuz "paket yok: $PAKET"
cp "$PAKET" /tmp/kapi.impark || olcumsuz "paket kopyalanamadi"
chmod +x /tmp/kapi.impark

# BUTUNLUK (2026-09-10 dersi): "FUSE setup" hatasi yalan soyler, dosya yarimdir.
# squashfs superblock offset 193728, bytes_used superblock+40 (8 bayt LE).
/usr/bin/python3 - /tmp/kapi.impark <<'PY' || olcumsuz "paket kesik"
import sys, struct
p = sys.argv[1]
with open(p, 'rb') as f:
    f.seek(193728 + 40)
    used = struct.unpack('<Q', f.read(8))[0]
import os
boyut = os.path.getsize(p)
gerekli = 193728 + used
print(f"[kkapi] butunluk: {boyut} bayt, gerekli >= {gerekli}")
sys.exit(0 if boyut >= gerekli else 1)
PY

export DISPLAY=:99
Xvfb :99 -screen 0 1366x768x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
XPID=$!
for i in $(seq 1 30); do xdpyinfo >/dev/null 2>&1 && break; sleep 1; done
xdpyinfo >/dev/null 2>&1 || olcumsuz "Xvfb acilmadi ($(tail -3 /tmp/xvfb.log | tr '\n' ' '))"
say "Xvfb hazir (1366x768)"

# FUSE konteynerde cogu zaman yok; AppImage'i cikartarak calistirmak ayni ikiliyi
# calistirir, sadece mount katmanini atlar.
: > /tmp/calisma.log
setsid /tmp/kapi.impark --appimage-extract-and-run > /tmp/calisma.log 2>&1 < /dev/null &
BASLATAN=$!
say "baslatildi (pid=$BASLATAN)"

TABAN="$HOME/DijiTap"
APPPID=""; WID=""; gecen=0
while [ $gecen -lt "$BEKLE" ]; do
  sleep 5; gecen=$((gecen+5))
  for pid in $(pgrep -f "$TABAN/" 2>/dev/null); do
    exe=$(readlink -f /proc/$pid/exe 2>/dev/null) || continue
    case "$exe" in "$TABAN"/*) ;; *) continue;; esac
    APPPID=$pid; break
  done
  [ -n "$APPPID" ] || { [ $((gecen % 60)) -eq 0 ] && say "bekle ${gecen}s — hala kuruluyor"; continue; }
  for w in $(xdotool search --onlyvisible --pid "$APPPID" 2>/dev/null); do
    ad=$(xdotool getwindowname "$w" 2>/dev/null)
    gen=$(xdotool getwindowgeometry "$w" 2>/dev/null | awk '/Geometry/{split($2,a,"x"); print a[1]}')
    [ -n "$ad" ] && [ "${gen:-0}" -gt 300 ] && { WID=$w; break; }
  done
  [ -n "$WID" ] && break
  [ $((gecen % 60)) -eq 0 ] && say "bekle ${gecen}s — surec var, pencere yok"
done
if [ -z "$WID" ]; then
  # KAPI KUSURU mu PAKET KUSURU mu? (2026-09-20 olculdu: imajda `unzip` yoktu,
  # AppRun kurulumu yapamadi ve kapi paketi RED etti — YANLIS TESHIS. Eksik
  # sistem araci konteynerin kusurudur; paketi suclamak 2026-09-10'daki
  # "FUSE setup hatasi yalan soyler" dersinin aynisidir.)
  if grep -qiE "command not found|not found in PATH|No such file or directory: /usr" /tmp/calisma.log 2>/dev/null; then
    cp /tmp/calisma.log "$KANIT/calisma.log" 2>/dev/null
    olcumsuz "konteynerde sistem araci eksik — paket suclanamaz ($(grep -iE 'command not found' /tmp/calisma.log | head -2 | tr '\n' ' '))"
  fi
  red "uygulama penceresi ${BEKLE} sn icinde acilmadi ($(tail -3 /tmp/calisma.log | tr '\n' ' '))"
fi
say "pencere acildi (${gecen}s): '$(xdotool getwindowname "$WID")' wid=$WID"

GECERLI=0
for i in $(seq 1 "$DENEME"); do
  xdotool windowactivate --sync "$WID" 2>/dev/null
  sleep "$PENCERE"
  SUREC=$(kill -0 "$APPPID" 2>/dev/null && echo 1 || echo 0)
  import -window "$WID" "$KANIT/ekran.png" 2>/dev/null || olcumsuz "ekran goruntusu alinamadi"
  SAPMA=$(convert "$KANIT/ekran.png" -colorspace Gray -format '%[fx:standard_deviation]' info: 2>/dev/null)
  KOYU=$(convert "$KANIT/ekran.png" -colorspace Gray -threshold 85% -format '%[fx:1-mean]' info: 2>/dev/null)
  RENK=$(identify -format '%k' "$KANIT/ekran.png" 2>/dev/null | tr -d ' ')
  GEO=$(xdotool getwindowgeometry "$WID" 2>/dev/null | awk '/Geometry/{print $2}')
  PADI=$(xdotool getwindowname "$WID" 2>/dev/null)
  say "olcum $i/$DENEME: surec=$SUREC pencere=${GEO:-?} sapma=${SAPMA:-?} koyu=${KOYU:-?} renk=${RENK:-?} baslik='${PADI:-}'"
  [ "$SUREC" = "1" ] || red "uygulama olcum aninda kapanmisti (surec yok)"
  RENK_ESIGI=500; [ "$AKTIVASYON" = "1" ] && RENK_ESIGI=0
  GECERLI=$(awk -v s="${SAPMA:-0}" -v k="${KOYU:-0}" -v r="${RENK:-0}" -v re="$RENK_ESIGI" \
    'BEGIN{print (s+0 >= 0.05 && k+0 >= 0.005 && r+0 >= re) ? 1 : 0}')
  { echo "SUREC=$SUREC"; echo "PENCERE_ADI=$PADI"; echo "GEOMETRI=$GEO";
    echo "SAPMA=$SAPMA"; echo "KOYU=$KOYU"; echo "RENK=$RENK"; } > "$KANIT/durum.txt"
  [ "$GECERLI" = "1" ] && break
  say "  icerik henuz yok — yeniden olculecek"
done
cp /tmp/calisma.log "$KANIT/calisma.log" 2>/dev/null
import -window root "$KANIT/masaustu.png" 2>/dev/null
kill "$XPID" 2>/dev/null
[ "$GECERLI" = "1" ] || red "pencere acildi ama ICERIK YOK (sapma=${SAPMA:-?} koyu=${KOYU:-?} renk=${RENK:-?})"
say "GECTI: icerik var (sapma=$SAPMA koyu=$KOYU renk=$RENK)"
echo "GECTI sapma=$SAPMA koyu=$KOYU renk=$RENK" > "$KANIT/sonuc.txt"
exit 0
