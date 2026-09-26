#!/bin/bash
# Pardus .impark uretimi — DOCKER'SIZ, yerli Linux x64 (ProBook seridi, plan C4, 2026-09-24).
# pardus-packager-build.sh + packager-entry.sh adimlarinin ayni sozlesmeyle yerel hali:
# ayni packagingService.packageLinux, ayni bayraklar, ayni dogrulama + zenity kapisi.
# Fark: konteyner/Rosetta/binfmt YOK; repo kopyalanmaz (is dizinine symlink).
#
# Kullanim: pardus-yerel-build.sh <build.zip|build-dizini> <urun-adi> <cikti-dizini> [surum]
#   (runner.js PARDUS_BUILD_SCRIPT ile ayni arguman sirasi — runner'a dokunmadan takilir)
# Ortam:
#   EMPP_SERIT_KOK   (~/empp-serit)  is/onbellek koku; kilit: $EMPP_SERIT_KOK/.kilit
#   EMPP_NODE_BIN    ($EMPP_SERIT_KOK/node/bin) — Node 22 x64 (kur.sh indirir)
#   PACKAGER_REPO    (betigin iki ust dizini) — src/ + node_modules/ burada
#   EMPP_LINUX_DEB   (0) DEB uretimi KAPALI (plan karari; yalniz .impark teslim ediliyor)
#   EMPP_SET_MENU (1) / EMPP_SAYFA_WEBP (0) / EMPP_OLU_TEMIZLIK (1) — Mac seridiyle ayni varsayilan
#   PARDUS_DISK_KAT (5) / PARDUS_DISK_TABAN_GB (15) / PARDUS_MIN_FREE_GB (acik override)
#   PARDUS_DOGRULA   (impark-dogrula.sh) — test icin degistirilebilir
#   PARDUS_ICERIK_GUNCELLEME (linux) — K kanali, Mac docker seridiyle ayni
#   EMPP_DERLEME_KABUL_KILIDI (0) — 1: derleme boyunca ~/.kabul.lock tutulur (serit-ajan.sh acar)
#   EMPP_MOTOR_KANONIK (~/.empp-agent/motor/kanonik.json) — 43e23 motor kanonigi; Mac'ten LAN ile
#     eslenir (tools/probook/arsiv-esle.sh). Yoksa derleme DURMAZ, `UYARI motor:` satiri (D-1).
# Cikti: <cikti>/<ad>.impark, <cikti>/dogrula/rapor.txt, <cikti>/raw/packager.log,
#        <cikti>/pardus-packager-build.log (her asama `ASAMA <ad> <sn>` satiriyla damgali).
set -euo pipefail
TOOLS="$(cd "$(dirname "$0")" && pwd -P)"
REPO="${PACKAGER_REPO:-$(cd "$TOOLS/../.." && pwd -P)}"
SERIT="${EMPP_SERIT_KOK:-$HOME/empp-serit}"
NODE_BIN="${EMPP_NODE_BIN:-$SERIT/node/bin}"
[ -d "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
DOGRULA="${PARDUS_DOGRULA:-$TOOLS/impark-dogrula.sh}"
DISK_KAT="${PARDUS_DISK_KAT:-5}"
DISK_TABAN_GB="${PARDUS_DISK_TABAN_GB:-15}"
MIN_FREE_GB="${PARDUS_MIN_FREE_GB:-}"

IN="${1:?build.zip veya build dizini}"; APP_NAME="${2:?urun adi}"; OUT="${3:?cikti dizini}"; VER="${4:-1.0.0}"
mkdir -p "$OUT" "$SERIT/work"; LOGF="$OUT/pardus-packager-build.log"; : > "$LOGF"
log(){ printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOGF"; }
die(){ log "HATA: $*"; exit 1; }
T0=$(date +%s); TA=$T0
asama(){ local s; s=$(date +%s); log "ASAMA $1 $((s - TA))"; TA=$s; }
log "basladi (yerel): in=$IN app='$APP_NAME' ver=$VER out=$OUT node=$(node -v 2>/dev/null || echo YOK)"
command -v node >/dev/null || die "node yok ($NODE_BIN) — tools/probook/kur.sh kosulmali"
[ -x "$REPO/node_modules/.bin/electron-builder" ] || die "electron-builder yok: $REPO/node_modules (npm ci?)"

# --- kilit: ProBook'ta es zamanlilik = 1 (plan B.4). flock yoksa (test/mac) mkdir kilidi. ---
if command -v flock >/dev/null; then
  exec 9>"$SERIT/.kilit"
  flock -n 9 || die "baska bir yerel build calisiyor ($SERIT/.kilit)"
else
  KILIT_D="$SERIT/.kilit.d"
  if ! mkdir "$KILIT_D" 2>/dev/null; then
    ESKI=$(cat "$KILIT_D/pid" 2>/dev/null || echo 0)
    kill -0 "$ESKI" 2>/dev/null && die "baska bir yerel build calisiyor (pid $ESKI)"
    rm -rf "$KILIT_D"; mkdir "$KILIT_D" || die "kilit alinamadi"
  fi
  echo $$ > "$KILIT_D/pid"
fi

# --- KABUL KILIDI derleme boyunca (plan B.2, 2026-09-26): ProBook'ta derleme ile kabul ASLA
# cakismaz. 4 is parcacigi derlemede doluyken baska ajanin UZAK kabulu (Mac yedek seridi) acilis
# penceresini kacirip yanlis RED yazar; tersine, suren bir kabulun ortasinda derleme baslarsa ayni
# sey olur. Ortak ~/.kabul.lock (probook-kilit.sh) alinir, EXIT'te birakilir. Bos kalmazsa
# ERTELENEBILIR isaretiyle cikilir (runner 'failed' YAZMAZ, kira dolunca is kuyruga doner).
KABUL_KILIDI_ALINDI=0
KABUL_DAMGA="derleme-$$-$(date +%s)"
kabul_kilidi_birak(){
  [ "$KABUL_KILIDI_ALINDI" = "1" ] && bash "$TOOLS/probook-kilit.sh" birak "$KABUL_DAMGA" >/dev/null 2>&1
  KABUL_KILIDI_ALINDI=0
  return 0
}
if [ "${EMPP_DERLEME_KABUL_KILIDI:-0}" = "1" ]; then
  KK_TAVAN="${KABUL_BOSLUK_TAVAN:-1800}"; KK_ARALIK="${KABUL_BOSLUK_ARALIK:-15}"; KK_BEKLENEN=0
  until KK_C=$(bash "$TOOLS/probook-kilit.sh" al "$KABUL_DAMGA" "$(hostname)" "$$" 2>&1); do
    if [ "$KK_BEKLENEN" -ge "$KK_TAVAN" ]; then
      die "[ertelenebilir-probook-erisimi] kabul kilidi ${KK_TAVAN} sn bosalmadi (${KK_C##*KILIT_MESGUL }) — derleme baslatilmadi"
    fi
    [ $((KK_BEKLENEN % 60)) -eq 0 ] && log "kabul suruyor, derleme bekliyor: ${KK_C##*KILIT_MESGUL }"
    sleep "$KK_ARALIK"; KK_BEKLENEN=$((KK_BEKLENEN + KK_ARALIK))
  done
  KABUL_KILIDI_ALINDI=1
  trap kabul_kilidi_birak EXIT
  log "kabul kilidi alindi (derleme boyunca; ${KK_BEKLENEN} sn beklendi)"
fi

# --- girdi + disk kapisi (pardus-packager-build.sh ile ayni formul) ---
[ -e "$IN" ] || die "girdi yok: $IN"
IN_KB=$(du -sk "$IN" 2>/dev/null | awk '{print $1}')
if [ -n "$MIN_FREE_GB" ]; then
  NEED_GB="$MIN_FREE_GB"
else
  NEED_GB=$(awk -v kb="${IN_KB:-0}" -v k="$DISK_KAT" -v t="$DISK_TABAN_GB" \
    'BEGIN{n=int((kb/1048576)*k)+1; if(n<t)n=t; print n}')
fi
FREE_GB=$(df -Pk "$SERIT/work" | awk 'NR==2{print int($4/1048576)}')
[ "$FREE_GB" -ge "$NEED_GB" ] || die "disk kapisi: ${FREE_GB} GB bos < ${NEED_GB} GB gerekli"
log "disk: ${FREE_GB} GB bos >= ${NEED_GB} GB gerekli (kaynak $(( ${IN_KB:-0} / 1024 )) MB)"

# --- is dizini (kendi mktemp'imiz — is bitince tamami silinir) ---
JOB="j$(date +%y%m%d-%H%M%S)"
SID="s-$JOB"
WORKAPP="$(mktemp -d "$SERIT/work/app-XXXXXX")"
temizle(){
  rm -rf "$WORKAPP"
  [ -n "${KILIT_D:-}" ] && rm -rf "$KILIT_D"
  kabul_kilidi_birak
  return 0
}
trap temizle EXIT
ln -s "$REPO/src" "$WORKAPP/src"
ln -s "$REPO/node_modules" "$WORKAPP/node_modules"
cp "$REPO/package.json" "$WORKAPP/package.json"
mkdir -p "$WORKAPP/uploads/$SID" "$WORKAPP/temp" "$OUT/raw"
if [ -f "$IN" ]; then
  unzip -o -q "$IN" -d "$WORKAPP/uploads/$SID" || die "zip acilamadi: $IN"
else
  # Kopya (sert bag DEGIL): paketleyici girdi dosyalarini YERINDE degistirir
  # (setBook enjeksiyonu vb.) — sert bag onbellekteki kaynagi bozardi.
  cp -a "$IN"/. "$WORKAPP/uploads/$SID/"
fi
ZSIZE=$( [ -f "$IN" ] && (stat -c %s "$IN" 2>/dev/null || stat -f %z "$IN") || echo 0)
( cd "$WORKAPP" && node -e '
const [sid,name,ver,size,up]=process.argv.slice(1);
const bi={sessionId:sid,appName:name||"Interactive Software",appVersion:ver||"1.0.0",description:"",uploadedAt:new Date().toISOString(),
 files:[{originalName:"build.zip",filename:"zip_processing",path:up,size:Number(size),type:"zip_queued",status:"ZIP kuyruğa eklendi, açılıyor..."}]};
require("fs").writeFileSync(up+"/build-info.json",JSON.stringify(bi));' "$SID" "$APP_NAME" "$VER" "$ZSIZE" "uploads/$SID" ) \
  || die "build-info.json yazilamadi"
log "girdi hazir: $(find "$WORKAPP/uploads/$SID" -type f | wc -l | tr -d ' ') dosya, $(du -sh "$WORKAPP/uploads/$SID" | cut -f1)"
asama girdi

# --- paketleyici (packageLinux) ---
export ELECTRON_CACHE="${ELECTRON_CACHE:-$SERIT/cache/electron}"
export electron_config_cache="${electron_config_cache:-$ELECTRON_CACHE}"
export ELECTRON_BUILDER_CACHE="${ELECTRON_BUILDER_CACHE:-$SERIT/cache/electron-builder}"
export NODE_PATH="$REPO/node_modules"
export EMPP_SET_MENU="${EMPP_SET_MENU:-1}" EMPP_SAYFA_WEBP="${EMPP_SAYFA_WEBP:-0}"
export EMPP_OLU_TEMIZLIK="${EMPP_OLU_TEMIZLIK:-1}" EMPP_LINUX_DEB="${EMPP_LINUX_DEB:-0}"
# Kapı sızıntısı (26.09): bu iki bayrak geçirilmezse paketleyici varsayılanı AÇIK okur ve Pardus
# paketine taslak içerik/SET güncelleme modülleri girer. Varsayılan KAPALI; kapsam `windows` gibi
# platform listesiyse linux işinde zaten kapalı kalır (src/packaging/platform-kapisi.js).
export EMPP_SET_GUNCELLEME="${EMPP_SET_GUNCELLEME:-0}"
# İçerik güncellemesi (K) Pardus paketinde AÇIK — Mac docker şeridiyle BİREBİR (a0cc28d, Nadir 26.09:
# "impark güncellemelerini alıyorlar"). Ortamdaki EMPP_ICERIK_GUNCELLEME (Mac'te 'windows') OKUNMAZ;
# kapatmak: PARDUS_ICERIK_GUNCELLEME=0. Parite testi: pardus-yerel-build.test.js.
export EMPP_ICERIK_GUNCELLEME="${PARDUS_ICERIK_GUNCELLEME:-linux}"
# 43e23 motor kanonigi (2026-09-26, E3 / D-1) — Mac docker seridiyle AYNI degisken ve denetci.
# Paketleyici (motorDegistir) EMPP_MOTOR_KANONIK'i okur; ProBook'ta kanonik yoksa motor degismez,
# bu artik sessiz degil: once/sonra satirlari ajan log'una duser.
export EMPP_MOTOR_KANONIK="${EMPP_MOTOR_KANONIK:-$HOME/.empp-agent/motor/kanonik.json}"
export EMPP_MOTOR_SURUMU="${EMPP_MOTOR_SURUMU:-1}"   # 0 = motor kapisi kapali (T6), docker ile ayni
MOTOR_SATIR=$(node "$TOOLS/motor-kanonik.js" on "$EMPP_MOTOR_KANONIK" 2>&1) || true
log "$MOTOR_SATIR"
log "paketleyici basliyor (job $JOB, DEB=$EMPP_LINUX_DEB) — log: $OUT/raw/packager.log"
set +e
( cd "$WORKAPP" && node "$TOOLS/packager-run-yerel.js" "$REPO" "$SID" "$APP_NAME" "$VER" "$JOB" ) \
  > "$OUT/raw/packager.log" 2>&1
RC=$?
set -e
asama paketleyici
[ $RC -eq 0 ] || die "paketleyici rc=$RC (son satirlar: $(tail -3 "$OUT/raw/packager.log" | tr '\n' ' '))"
while IFS= read -r l; do log "$l"; done \
  < <(node "$TOOLS/motor-kanonik.js" son "$OUT/raw/packager.log" 2>&1)

LINUX_OUT="$WORKAPP/temp/$JOB/linux"
IMPARK=$(ls "$LINUX_OUT"/*.impark 2>/dev/null | head -1 || true)
[ -n "$IMPARK" ] || die ".impark uretilmedi (log: $OUT/raw/packager.log)"
mkdir -p "$OUT/raw/linux"
find "$LINUX_OUT" -maxdepth 1 -type f \( -name '*.desktop' -o -name '*.yml' -o -name '*.json' \) \
  -exec cp -f {} "$OUT/raw/linux/" \; 2>/dev/null || true
mv -f "$IMPARK" "$OUT/"; IMPARK="$OUT/$(basename "$IMPARK")"
log "impark: $IMPARK ($(du -h "$IMPARK" | cut -f1))"

# --- dogrulama (kanit) + ZENITY KAPISI (Mac seridiyle birebir) ---
"$DOGRULA" "$IMPARK" "$TOOLS/ref-bloktest-asar-root.txt" "$OUT/dogrula" >> "$LOGF" 2>&1 || log "dogrulama betigi hata verdi"
grep -E "^(file|elf-offset|magic|squashfs|appdir-root|desktop|AppRun|zenity|usr/bin|asar has|package.json)" \
  "$OUT/dogrula/rapor.txt" 2>/dev/null | sed 's/^/  /' | tee -a "$LOGF"
asama dogrulama
if ! grep -q "^zenity: VAR" "$OUT/dogrula/rapor.txt" 2>/dev/null; then
  rm -f "$IMPARK"
  die "ZENITY YOK — .impark reddedildi ve silindi (usr/bin/zenity gomulu degil)"
fi
log "zenity kapisi: GECTI (usr/bin/zenity gomulu)"
log "bitti: $(( $(date +%s) - T0 )) sn"
