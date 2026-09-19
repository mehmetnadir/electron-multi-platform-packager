#!/bin/bash
# Pardus .impark uretimi — srv21 paketleyicisinin (electron-multi-platform-packager,
# packageLinux) BIREBIR kopyasini bu Mac'te Linux konteynerinde kosturur.
#
# Kullanim: pardus-packager-build.sh <build.zip|build-dizini> <urun-adi> <cikti-dizini> [surum]
#   build.zip     : yayinci exe'sinden cikarilan web build (ajan cache: ~/.empp-agent/cache/<kitap>/*/build.zip)
#   urun-adi      : productName (ASCII; ajan asciiAppName ile ayni kural)
#   cikti-dizini  : .impark/.deb/.desktop/log buraya
#   surum         : varsayilan 1.0.0 (ajan da 1.0.0 gonderir)
#
# K17 (2026-09-17): SET kok menusu kapisi bu yolda VARSAYILAN ACIK
#   (EMPP_SET_MENU=1) — yayincinin otomatik exe'sinden cikan SET build'inin kokunde
#   menu YOK ve paket Pardus'ta beyaz ekranda kaliyordu (sf425/59835 ProBook kaniti).
#   Kapatmak icin: EMPP_SET_MENU=0 pardus-packager-build.sh ...
# Ozellikler: idempotent (imaj/volume varsa yeniden kurmaz), disk kapisi (BOYUT ORANTILI), tek build
# (kilit), her adimda log, nice ile dusuk oncelik, Rosetta+AppImage binfmt kaydi.
set -euo pipefail
TOOLS="${PARDUS_TOOLS:-$(cd "$(dirname "$0")" && pwd)}"
REPO="${PACKAGER_REPO:-$(cd "$TOOLS/../.." && pwd)}"
IMG="packager-linux:2"   # :2 = zenity gomulu (2026-09-15)
LOCK="/tmp/f1-pardus/.pardus-packager.lock"
DISK_KAT="${PARDUS_DISK_KAT:-5}"          # olculen tepe/kaynak orani (2026-09-19)
DISK_TABAN_GB="${PARDUS_DISK_TABAN_GB:-15}" # es zamanli isler icin ayrilan taban
MIN_FREE_GB="${PARDUS_MIN_FREE_GB:-}"     # ACIK override; bostaysa boyut-orantili hesap konusur
log(){ printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "${LOGF:-/dev/null}"; }
die(){ log "HATA: $*"; exit 1; }

IN="${1:?build.zip veya build dizini}"; APP_NAME="${2:?urun adi}"; OUT="${3:?cikti dizini}"; VER="${4:-1.0.0}"
mkdir -p "$OUT" /tmp/f1-pardus; LOGF="$OUT/pardus-packager-build.log"; : > "$LOGF"
T0=$(date +%s)
log "basladi: in=$IN app='$APP_NAME' ver=$VER out=$OUT"

# --- kilit: paralel build YASAK (nazik build kurali) ---
# macOS'ta flock yok: atomik mkdir kilidi; sahibi olmeyen (stale) kilit temizlenir.
# PARDUS_PARALEL=1 (Nadir, 2026-09-17 — acil SET yeniden uretimi): kilit ve "calisan
# konteyner" kapisi atlanir, her is kendi cikti dizininde kosar. Varsayilan DEGISMEDI:
# bayrak yoksa tek build kurali (nazik build) aynen gecerlidir.
if [ "${PARDUS_PARALEL:-0}" = "1" ]; then
  log "PARALEL MOD: kilit atlandi (cagiran es zamanlilik ve diski yonetir)"
elif ! mkdir "$LOCK" 2>/dev/null; then
  OLDPID=$(cat "$LOCK/pid" 2>/dev/null || echo 0)
  kill -0 "$OLDPID" 2>/dev/null && die "baska bir build calisiyor (pid $OLDPID, $LOCK)"
  rm -rf "$LOCK"; mkdir "$LOCK" || die "kilit alinamadi"
fi
echo $$ > "$LOCK/pid"; trap 'rm -rf "$LOCK"' EXIT
[ "${PARDUS_PARALEL:-0}" = "1" ] || { docker ps --format '{{.Names}}' | grep -q '^pardus-pack-' && die "calisan pardus-pack-* konteyneri var"; }

# --- girdi ---
[ -e "$IN" ] || die "girdi yok: $IN"

# --- disk kapisi (BOYUT ORANTILI, 2026-09-19 olcumu) ---
# Eski kapi duz bir sabitti (45/20 GB) ve paketin boyutuna HIC bakmiyordu.
# Olculdu (acmadan, zip dizininden): 59834 zip 931 MB -> acilmis 1085 MB (1,17x);
# 73581 zip 713 MB -> 857 MB (1,20x). Es zamanli tepe zinciri:
#   zip + acilmis build + app.asar (asar sikistirmaz) + Electron runtime (~250 MB)
#   + .impark cikti  ~=  kaynak x 5
# 931 MB'lik kaynak icin ~4,4 GB gerekiyor; sabit kapi 45 GB istiyordu (10 kati).
# Taban 15 GB: 2026-09-17'de 20 GB kapisini kil payi gecen derleme SESSIZCE bozuk
# paket uretti (59834, V8 snapshot FATAL) — sebep esik degil, kapinin TEK ANLIK
# olmasi: 4 paralel is ayni diski ~35 dk boyunca yiyor. Taban o pay icindir.
IN_KB=$(du -sk "$IN" 2>/dev/null | awk '{print $1}')
if [ -n "${MIN_FREE_GB:-}" ]; then
  NEED_GB="$MIN_FREE_GB"
  log "disk kapisi: ACIK override PARDUS_MIN_FREE_GB=${NEED_GB} GB"
elif [ -n "${IN_KB:-}" ] && [ "$IN_KB" -gt 0 ]; then
  NEED_GB=$(awk -v kb="$IN_KB" -v k="$DISK_KAT" -v t="$DISK_TABAN_GB" \
    'BEGIN{n=int((kb/1048576)*k)+1; if(n<t)n=t; print n}')
  log "disk kapisi: kaynak $((IN_KB/1024)) MB x ${DISK_KAT} -> ${NEED_GB} GB gerekli (taban ${DISK_TABAN_GB})"
else
  NEED_GB="$DISK_TABAN_GB"
  log "disk kapisi: kaynak boyutu olculemedi, taban ${NEED_GB} GB"
fi
FREE_GB=$(df -g / | awk 'NR==2{print $4}')
[ "$FREE_GB" -ge "$NEED_GB" ] || die "disk kapisi: ${FREE_GB} GB bos < ${NEED_GB} GB gerekli"
log "disk: ${FREE_GB} GB bos >= ${NEED_GB} GB gerekli"
if [ -f "$IN" ]; then IN_DIR="$(cd "$(dirname "$IN")" && pwd)"; IN_FILE="$(basename "$IN")"
  [ "$IN_FILE" = "build.zip" ] || { TMPIN="/tmp/f1-pardus/in-$$"; mkdir -p "$TMPIN"; ln -sf "$(cd "$(dirname "$IN")" && pwd)/$IN_FILE" "$TMPIN/build.zip"; IN_DIR="$TMPIN"; }
  IN_MOUNT="$IN_DIR"; log "girdi: zip $(du -h "$IN" | cut -f1)"
else TMPIN="/tmp/f1-pardus/in-$$"; mkdir -p "$TMPIN"; ln -sfn "$(cd "$IN" && pwd)" "$TMPIN/build"; IN_MOUNT="$TMPIN"; log "girdi: dizin"; fi

# --- Docker ---
docker info >/dev/null 2>&1 || die "docker calismiyor"
if ! docker image inspect "$IMG" >/dev/null 2>&1; then
  log "imaj yok, kuruluyor: $IMG"
  nice -n 10 docker build --platform linux/amd64 -f "$TOOLS/Dockerfile.packager-linux" -t "$IMG" "$TOOLS" >> "$LOGF" 2>&1 || die "imaj kurulamadi (log: $LOGF)"
fi
log "imaj hazir: $IMG"

# --- Rosetta + AppImage binfmt (Docker Desktop VM; yeniden baslatmada sifirlanir, idempotent) ---
# Rosetta'nin binfmt maskesi ELF basligindaki AppImage sihrini ("AI\x02", bayt 8-10) reddediyor;
# customizeAppImage `<AppImage> --appimage-extract` CALISTIRIR -> bu kayit olmadan .impark uretilmez.
docker run --rm --privileged --pid=host --platform linux/arm64 debian:12-slim bash -c '
S=":rosetta-appimage:M::\\x7f\\x45\\x4c\\x46\\x02\\x01\\x01\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x02\\x00\\x3e\\x00:\\xff\\xff\\xff\\xff\\xff\\xff\\xfe\\xfe\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\xfe\\xff\\xff\\xff:/run/rosetta/rosetta:POCF"
printf "%s" "$S" | nsenter -t 1 -m -u -n -i sh -c "[ -e /proc/sys/fs/binfmt_misc/rosetta-appimage ] || cat > /proc/sys/fs/binfmt_misc/register; grep -q enabled /proc/sys/fs/binfmt_misc/rosetta-appimage && echo binfmt-ok"' 2>&1 | grep -q binfmt-ok || die "rosetta-appimage binfmt kaydi basarisiz"
log "binfmt: rosetta-appimage aktif"

# --- build ---
JOB="j$(date +%y%m%d-%H%M%S)"
mkdir -p "$OUT/raw"
log "konteyner basliyor (job $JOB) — log: $OUT/raw/packager.log"
set +e
nice -n 10 docker run --rm --platform linux/amd64 --name "pardus-pack-$JOB" \
  -v "$REPO":/src:ro \
  -v packager-linux-nm:/app/node_modules -v packager-linux-cache:/cache \
  -e electron_config_cache=/cache/electron \
  -e EMPP_SET_MENU="${EMPP_SET_MENU:-1}" \
  -v "$IN_MOUNT":/in:ro -v "$OUT/raw":/out -v "$TOOLS":/tools:ro \
  "$IMG" "$APP_NAME" "$VER" "$JOB" >> "$LOGF" 2>&1
RC=$?
set -e
[ -n "${TMPIN:-}" ] && rm -rf "$TMPIN"
[ $RC -eq 0 ] || die "paketleyici rc=$RC (log: $LOGF)"

IMPARK=$(ls "$OUT"/raw/linux/*.impark 2>/dev/null | head -1)
[ -n "$IMPARK" ] || die ".impark uretilmedi (log: $LOGF)"
mv -f "$IMPARK" "$OUT/"; IMPARK="$OUT/$(basename "$IMPARK")"
log "impark: $IMPARK ($(du -h "$IMPARK" | cut -f1))"

# --- dogrulama (kanit) ---
docker run --rm --platform linux/amd64 --entrypoint /tools/impark-dogrula.sh \
  -v "$OUT":/o -v "$TOOLS":/tools:ro "$IMG" "/o/$(basename "$IMPARK")" /tools/ref-bloktest-asar-root.txt /o/dogrula >> "$LOGF" 2>&1 || log "dogrulama betigi hata verdi"
grep -E "^(file|elf-offset|magic|squashfs|appdir-root|desktop|AppRun|zenity|usr/bin|asar has|package.json)" "$OUT/dogrula/rapor.txt" 2>/dev/null | sed 's/^/  /' | tee -a "$LOGF"

# ZENITY KAPISI (Nadir, 2026-09-15): gomulu zenity yoksa paket REDDEDILIR — cikti silinir, rc=1.
if ! grep -q "^zenity: VAR" "$OUT/dogrula/rapor.txt" 2>/dev/null; then
  rm -f "$IMPARK"
  die "ZENITY YOK — .impark reddedildi ve silindi (usr/bin/zenity gomulu degil). Imaj packager-linux:2 ve customizeAppImage zenityGom sart."
fi
log "zenity kapisi: GECTI (usr/bin/zenity gomulu)"
log "bitti: $(( $(date +%s) - T0 )) sn"
