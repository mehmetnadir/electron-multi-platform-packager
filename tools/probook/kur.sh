#!/bin/bash
# ProBook Pardus şeridi KURULUMU — idempotent (plan C1+C2, 2026-09-24).
#
# Mac'te koşturulur:  tools/probook/kur.sh [--host etapadmin@100.73.161.76]
#   1) depo çalışma ağacını rsync'ler (node_modules/.git/.env/çıktılar HARİÇ) + .serit-surum
#   2) appimagetool'u ve electron/electron-builder önbelleğini Mac'in pardus docker imajı/
#      volume'ünden aktarır (Mac şeridiyle BİREBİR aynı ikililer; ProBook'ta indirme yok)
#   3) kayıtlı logoları (Mac paketleyici /api/logos) ~/empp-serit/logolar'a eşler
#   4) kendini ProBook'ta `probook` kipinde koşturur (aşağıda)
# ProBook kipi (ssh ile):
#   disk kapısı · ~/empp-serit ağacı · Node 22 x64 resmi tarball (sha256 doğrulamalı, SİSTEME
#   KURULMAZ) · npm ci (lock değiştiyse) · /usr/local/bin/appimagetool sarmalayıcısı (tek dosya;
#   packagingService bu yolu sabit arar, yoksa GitHub'dan yönlendirmesiz indirip bozuk
#   dosyayla SESSİZCE standart AppImage'a düşer) · systemd kullanıcı birimi + linger.
# Sistem paketi KURMAZ, sır TAŞIMAZ (kayıt ayrı: tools/probook/kaydol.js, sır stdin'den).
# Silme yok: eski sürüm dizinleri `.kaldirildi-<damga>` olarak kenara alınır.
set -euo pipefail
NODE_SURUM="${NODE_SURUM:-v22.23.2}"   # Mac pardus konteyneriyle aynı (packager-entry log'u)
SERIT_ADI="empp-serit"
DAMGA="$(date +%Y%m%d-%H%M%S)"
log(){ printf '[kur %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die(){ log "HATA: $*"; exit 1; }

# ------------------------------------------------------------------ ProBook kipi
probook_kur(){
  local S="$HOME/$SERIT_ADI"
  mkdir -p "$S"/{repo,cache,work,out,log,kanit,opt,logolar}
  # Disk kapısı (plan B.3 tabanı): kurulum + ilk iş için ≥ 30 GB boş ve doluluk ≤ %85.
  local BOS DOL
  BOS=$(df -Pk "$S" | awk 'NR==2{print int($4/1048576)}')
  DOL=$(df -Pk "$S" | awk 'NR==2{gsub("%","",$5); print $5}')
  [ "$BOS" -ge 30 ] || die "disk kapisi: ${BOS} GB bos < 30 GB"
  [ "$DOL" -le 85 ] || die "disk kapisi: doluluk %${DOL} > %85"
  log "disk: ${BOS} GB bos, doluluk %${DOL}"

  # Node 22 x64 — ~/empp-serit/node altına, sha256 doğrulamalı.
  if [ "$("$S/node/bin/node" -v 2>/dev/null || true)" = "$NODE_SURUM" ]; then
    log "node $NODE_SURUM zaten kurulu"
  else
    local T AD
    T="$(mktemp -d "$S/work/node-XXXXXX")"
    AD="node-$NODE_SURUM-linux-x64.tar.xz"
    log "node $NODE_SURUM indiriliyor"
    curl -fsSL -o "$T/$AD" "https://nodejs.org/dist/$NODE_SURUM/$AD" || die "node indirilemedi"
    curl -fsSL -o "$T/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_SURUM/SHASUMS256.txt" || die "SHASUMS indirilemedi"
    ( cd "$T" && grep " $AD\$" SHASUMS256.txt | sha256sum -c - ) || die "node sha256 TUTMADI"
    mkdir -p "$T/acik" && tar -xJf "$T/$AD" -C "$T/acik" --strip-components=1
    [ "$("$T/acik/bin/node" -v)" = "$NODE_SURUM" ] || die "acilan node surumu beklenmedik"
    [ -e "$S/node" ] && { rmdir "$S/node" 2>/dev/null || mv "$S/node" "$S/node.kaldirildi-$DAMGA"; }
    mv "$T/acik" "$S/node"
    rm -rf "$T"   # kendi mktemp dizinimiz
    log "node kuruldu: $("$S/node/bin/node" -v) (sha256 dogrulandi)"
  fi
  export PATH="$S/node/bin:$PATH"

  # npm ci — lock özeti değiştiyse (docker packager-entry.sh ile aynı kural).
  [ -f "$S/repo/package-lock.json" ] || die "repo yok: Mac tarafi rsync kosmadi"
  local LOCK
  LOCK=$(sha256sum "$S/repo/package-lock.json" | cut -c1-16)
  if [ "$(cat "$S/repo/node_modules/.lock-hash" 2>/dev/null || true)" = "$LOCK" ]; then
    log "node_modules guncel (lock $LOCK)"
  else
    log "npm ci basliyor (lock $LOCK)"
    ( cd "$S/repo" && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm_config_cache="$S/cache/npm" \
        npm ci --no-audit --no-fund --loglevel=error 2>&1 | tail -5 ) || die "npm ci basarisiz"
    echo "$LOCK" > "$S/repo/node_modules/.lock-hash"
    log "npm ci bitti"
  fi
  "$S/repo/node_modules/.bin/electron-builder" --version >/dev/null 2>&1 || die "electron-builder calismiyor"

  # appimagetool (Mac tarafı ~/empp-serit/opt/appimagetool'u aktardı).
  [ -x "$S/opt/appimagetool/AppRun" ] || die "appimagetool aktarilmamis ($S/opt/appimagetool)"
  local SARMAL="#!/bin/sh
exec $S/opt/appimagetool/AppRun \"\$@\""
  if [ "$(cat /usr/local/bin/appimagetool 2>/dev/null || true)" != "$SARMAL" ]; then
    [ -e /usr/local/bin/appimagetool ] && sudo -n mv /usr/local/bin/appimagetool "/usr/local/bin/appimagetool.kaldirildi-$DAMGA"
    printf '%s\n' "$SARMAL" | sudo -n tee /usr/local/bin/appimagetool >/dev/null || die "sudo -n ile yazilamadi"
    sudo -n chmod 755 /usr/local/bin/appimagetool
    log "appimagetool sarmalayicisi kuruldu: /usr/local/bin/appimagetool"
  fi
  /usr/local/bin/appimagetool --version 2>&1 | head -1 | sed 's/^/  /'
  for arac in zenity mksquashfs unsquashfs 7z zip unzip xdotool import convert python3 file flock; do
    command -v "$arac" >/dev/null || die "arac yok: $arac"
  done
  log "araclar tamam (zenity/mksquashfs/7z/xdotool/imagemagick/flock)"

  # systemd kullanıcı birimi + linger (X oturumu kapansa da ajan ayakta).
  mkdir -p "$HOME/.config/systemd/user"
  local BIRIM="$HOME/.config/systemd/user/empp-serit-agent.service"
  if ! cmp -s "$S/repo/tools/probook/empp-serit-agent.service" "$BIRIM"; then
    [ -f "$BIRIM" ] && mv "$BIRIM" "$BIRIM.kaldirildi-$DAMGA"
    cp "$S/repo/tools/probook/empp-serit-agent.service" "$BIRIM"
    log "birim yazildi: $BIRIM"
  fi
  systemctl --user daemon-reload
  systemctl --user enable empp-serit-agent.service >/dev/null 2>&1 || true
  if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
    sudo -n loginctl enable-linger "$USER" && log "linger acildi: $USER"
  fi
  if [ -f "$HOME/.empp-agent/token.json" ]; then
    systemctl --user restart empp-serit-agent.service
    log "ajan (yeniden) baslatildi: $(systemctl --user is-active empp-serit-agent.service)"
  else
    log "JETON YOK — ajan baslatilmadi. Kayit (sir stdin'den, diske yazilmaz):"
    log "  read -rs S && printf %s \"\$S\" | $S/node/bin/node $S/repo/tools/probook/kaydol.js; unset S"
    log "  sonra: systemctl --user start empp-serit-agent"
  fi
  log "ProBook kurulumu tamam: repo $(cat "$S/repo/.serit-surum" 2>/dev/null || echo ?)"
}

# ------------------------------------------------------------------ Mac kipi
mac_kur(){
  local HOST="${PROBOOK_SSH:-etapadmin@100.73.161.76}"
  while [ $# -gt 0 ]; do case "$1" in --host) HOST="$2"; shift 2;; *) die "bilinmeyen: $1";; esac; done
  local SSH=(ssh -o ConnectTimeout=10 -o BatchMode=yes "$HOST")
  local REPO; REPO="$(cd "$(dirname "$0")/../.." && pwd -P)"
  bash -n "$0" || die "betik sozdizimi hatali"
  "${SSH[@]}" "mkdir -p ~/$SERIT_ADI/repo ~/$SERIT_ADI/opt ~/$SERIT_ADI/cache ~/$SERIT_ADI/logolar" || die "ProBook'a baglanilamadi ($HOST)"

  log "depo aktariliyor: $REPO -> $HOST:~/$SERIT_ADI/repo"
  rsync -a --delete --stats \
    --exclude node_modules --exclude .git --exclude '.env' --exclude '.env.*' --exclude '*.key' --exclude '*.pem' \
    --exclude .npm-cache --exclude .npm-global --exclude scratchpad --exclude uploads --exclude temp \
    --exclude logos --exclude chunks --exclude _graveyard --exclude .claude --exclude .pytest_cache \
    --exclude '*.log' --exclude .serit-surum \
    "$REPO/" "$HOST:$SERIT_ADI/repo/" | tail -3
  local SURUM
  SURUM="$(cd "$REPO" && git rev-parse --short HEAD 2>/dev/null || echo '?')"
  [ -n "$(cd "$REPO" && git status --porcelain 2>/dev/null | head -1)" ] && SURUM="$SURUM+calisma-agaci-$DAMGA"
  "${SSH[@]}" "printf '%s\n' '$SURUM' > ~/$SERIT_ADI/repo/.serit-surum"
  log "surum: $SURUM"

  if ! "${SSH[@]}" "test -x ~/$SERIT_ADI/opt/appimagetool/AppRun"; then
    log "appimagetool Mac pardus imajindan aktariliyor (packager-linux:2)"
    docker run --rm --platform linux/amd64 --entrypoint tar packager-linux:2 -C /opt -cf - appimagetool \
      | "${SSH[@]}" "tar -C ~/$SERIT_ADI/opt -xf -" || die "appimagetool aktarilamadi"
  fi
  if ! "${SSH[@]}" "ls ~/$SERIT_ADI/cache/electron/electron-v*-linux-x64.zip >/dev/null 2>&1"; then
    log "electron/electron-builder onbellegi Mac volume'unden aktariliyor"
    docker run --rm -v packager-linux-cache:/c:ro debian:12-slim tar -C /c -cf - electron electron-builder/appimage \
      | "${SSH[@]}" "tar -C ~/$SERIT_ADI/cache -xf -" || die "onbellek aktarilamadi"
  fi

  # Logolar: Mac paketleyicisi kapalıysa eski eşleme korunur (uyarı).
  local LT; LT="$(mktemp -d)"
  if curl -fsS -m 10 -o "$LT/logos.json" http://127.0.0.1:3001/api/logos; then
    local ID
    for ID in $(node -e 'for (const l of require(process.argv[1])) if (/^[0-9a-f-]+$/i.test(l.id)) console.log(l.id)' "$LT/logos.json"); do
      curl -fsS -m 20 -o "$LT/$ID.png" "http://127.0.0.1:3001/api/logos/$ID/file" || log "UYARI: logo alinamadi: $ID"
    done
    rsync -a "$LT/" "$HOST:$SERIT_ADI/logolar/"
    log "logolar eslendi: $(ls "$LT"/*.png 2>/dev/null | wc -l | tr -d ' ') dosya"
  else
    log "UYARI: Mac paketleyicisi (3001) cevap vermedi — logolar ESLENMEDI (mevcut eslem korunur)"
  fi
  rm -rf "$LT"   # kendi mktemp dizinimiz

  log "ProBook kipi baslatiliyor"
  "${SSH[@]}" "bash -s -- probook" < "$0"
}

if [ "${1:-}" = "probook" ]; then
  probook_kur
elif [ "$(uname -s)" = "Darwin" ]; then
  mac_kur "$@"
else
  die "Linux'ta dogrudan: bash kur.sh probook (Mac'ten: tools/probook/kur.sh)"
fi
