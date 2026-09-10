#!/bin/bash
# Konteyner girisi. Beklenen mount'lar:
#   /src   : paketleyici deposu (salt-okuma; host node_modules KULLANILMAZ)
#   /app/node_modules : named volume (Linux x64 npm ci buraya)
#   /cache : named volume (electron / electron-builder / npm indirmeleri)
#   /in    : build.zip veya build dizini (salt-okuma)
#   /out   : ciktilar
# Argumanlar: <app-adi> <surum> [job-id]
set -euo pipefail
log(){ printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
APP_NAME="${1:?app adi}"; APP_VERSION="${2:-1.0.0}"; JOB_ID="${3:-job-$(date +%s)}"
T0=$(date +%s)

log "arch=$(uname -m) node=$(node -v) npm=$(npm -v)"

# 1) Depo kodunu /app'e kopyala (node_modules/temp/uploads haric)
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude .npm-cache --exclude .npm-global \
  --exclude scratchpad --exclude uploads --exclude temp --exclude '*.log' \
  /src/ /app/
log "kaynak kopyalandi: $(cd /src && git rev-parse --short HEAD 2>/dev/null || echo '?') (calisma agaci, commit edilmemis degisiklikler dahil)"

# 2) Bagimliliklar (lock hash degistiyse yeniden)
LOCK_HASH=$(sha256sum /app/package-lock.json | cut -c1-16)
if [ ! -f /app/node_modules/.lock-hash ] || [ "$(cat /app/node_modules/.lock-hash)" != "$LOCK_HASH" ]; then
  log "npm ci basliyor (lock $LOCK_HASH)"
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund --loglevel=error 2>&1 | tail -5
  echo "$LOCK_HASH" > /app/node_modules/.lock-hash
  log "npm ci bitti"
else
  log "node_modules guncel (lock $LOCK_HASH)"
fi
ls /app/node_modules/.bin/electron-builder >/dev/null
log "electron-builder: $(/app/node_modules/.bin/electron-builder --version 2>/dev/null | head -1)"

# 3) Girdi -> uploads/<sessionId>  (sunucuda /api/upload-build: `unzip -o -q` ile ayni)
SID="s-$JOB_ID"
mkdir -p "/app/uploads/$SID" /app/temp
if [ -f /in/build.zip ]; then
  log "build.zip aciliyor"
  unzip -o -q /in/build.zip -d "/app/uploads/$SID"
elif [ -d /in/build ]; then
  log "build dizini kopyalaniyor"
  cp -a /in/build/. "/app/uploads/$SID/"
else
  echo "girdi yok: /in/build.zip veya /in/build bekleniyor" >&2; exit 2
fi
# /api/upload-build sunucuda build-info.json yazar (app.js:358-368) -> asar kokune girer; ayni sekil
ZSIZE=$(stat -c %s /in/build.zip 2>/dev/null || echo 0)
node -e '
const [sid,name,ver,size,up]=process.argv.slice(1);
const bi={sessionId:sid,appName:name||"Interactive Software",appVersion:ver||"1.0.0",description:"",uploadedAt:new Date().toISOString(),
 files:[{originalName:"build.zip",filename:"zip_processing",path:up,size:Number(size),type:"zip_queued",status:"ZIP kuyruğa eklendi, açılıyor..."}]};
require("fs").writeFileSync(up+"/build-info.json",JSON.stringify(bi));' "$SID" "$APP_NAME" "$APP_VERSION" "$ZSIZE" "uploads/$SID"
log "girdi hazir: $(find "/app/uploads/$SID" -type f | wc -l) dosya, $(du -sh "/app/uploads/$SID" | cut -f1)"

# 4) Paketleyiciyi modul olarak kos
T1=$(date +%s)
node /tools/packager-run-linux.js "$SID" "$APP_NAME" "$APP_VERSION" "$JOB_ID" 2>&1 | tee /out/packager.log | grep -v "Electron Builder:   • \|NPM:"
RC=${PIPESTATUS[0]}
T2=$(date +%s)
log "paketleyici rc=$RC sure=$((T2-T1))s"

# 5) Ciktilari disari al
OUTDIR="/app/temp/$JOB_ID/linux"
if [ -d "$OUTDIR" ]; then
  mkdir -p /out/linux
  find "$OUTDIR" -maxdepth 1 -type f \( -name '*.impark' -o -name '*.AppImage' -o -name '*.deb' -o -name '*.desktop' -o -name '*.yml' -o -name '*.sh' -o -name '*.md' -o -name '*.zip' \) -exec cp -f {} /out/linux/ \;
  cp -f "/app/temp/$JOB_ID/electron-builder-linux.json" /out/linux/ 2>/dev/null || true
  ls -la /out/linux
fi
log "toplam sure $(( $(date +%s) - T0 ))s"
exit $RC
