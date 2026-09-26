#!/bin/bash
# KAYNAK ARŞİVİ EŞLEME — Mac → ProBook (ProBook şeridi, 2026-09-26).
#
# NEDEN: runner kaynağı önce `~/.empp-agent/kaynak-arsivi/<id>/`'den (onaylı yeni arayüz build
# zip'i) alır; kayıt YOKSA İmpark exe'sine iner. ProBook'ta arşiv eksikse aynı kitap ProBook'ta
# ESKİ arayüzle üretilir (26.09 arızasının kendisi). Mac arşivi otoritedir (R2 `kaynak/` yansısı
# yok); ProBook birebir kopyasını tutar. Mac ajanının şerit denetçisi özet farkı görünce bunu
# arka planda koşturur; kur.sh da kurulumda koşturur.
#
# Sıra: kilit → özet eşitse çık → ProBook ajanını DURAKLAT (bayrak yoksa, kendi imzasıyla)
#   → rsync (zip önce, kaynak.json sonra iner: yarım zip kayıtlı görünmez) → Mac'te olmayan
#   kitap dizinleri ProBook'ta ~/Silinecekler/'e → iki özet eşit mi → duraklatmayı kaldır
#   (yalnız kendi koyduğunu). Özet eşitlenmezse bayrak KALIR (rc=1): ProBook eski arayüzü
#   üretmektense bekler, Mac alır.
# Kullanım: arsiv-esle.sh [--host etapadmin@192.168.1.55] [--kuru] [--rele-izin]
# AKTARIM YALNIZ LAN'DA (26.09 ölçüldü): evden Tailscale DERP rölesi 0,18 MB/s — kalan 5 GB 7,8 saat
# ev hattını boğardı ve 16:09'da kopup yarım kaldı. LAN değilse (192.168./10.) ProBook YİNE duraklatılır
# (eski arayüz üretmesin) ama aktarım YAPILMAZ; ofiste tekrar koşulur. Bilerek röle: --rele-izin.
# Kopan aktarım --partial ile kaldığı yerden sürer.
# MOTOR KANONİĞİ (2026-09-26, E3): aynı akış 43e23 motor kanoniğini de taşır — Mac
# `EMPP_MOTOR_KANONIK` (varsayılan ~/.empp-agent/motor/kanonik.json) → ProBook
# ~/.empp-agent/motor/{43e23…js,kanonik.json} (önce motor, sonra json: yarım aktarım doğrulanmaz).
# Eşitlik = doğrulanmış sha12 (json + dosya hash'i). Mac'te kanonik yoksa kıyas/aktarım yok.
# Aynı LAN kuralı geçerli; ProBook motor farkında da duraklatılır (motorsuz paket üretmesin).
# Test: ARSIV_ESLE_SSH ("bash -c") + ARSIV_ESLE_HEDEF (rsync hedefi) + ARSIV_ESLE_UZAK_NODE
#   (+ ARSIV_ESLE_MOTOR_HEDEF; yoksa sahte ProBook'un $HOME/.empp-agent/motor/).
set -uo pipefail
HOST="${PROBOOK_SSH:-etapadmin@100.73.161.76}"
KURU=0
RELE=0
while [ $# -gt 0 ]; do case "$1" in
  --host) HOST="$2"; shift 2 ;;
  --kuru) KURU=1; shift ;;
  --rele-izin) RELE=1; shift ;;
  *) echo "bilinmeyen: $1" >&2; exit 2 ;;
esac; done
REPO="$(cd "$(dirname "$0")/../.." && pwd -P)"
KOK="${EMPP_KAYNAK_ARSIVI:-$HOME/.empp-agent/kaynak-arsivi}"
KILIT="${ARSIV_ESLE_KILIT:-$HOME/.empp-agent/arsiv-esle.kilit.d}"
LOGF="${ARSIV_ESLE_LOG:-$HOME/.empp-agent/arsiv-esle.log}"
if [ -n "${ARSIV_ESLE_SSH:-}" ]; then
  read -r -a SSH <<< "$ARSIV_ESLE_SSH"
  HEDEF="${ARSIV_ESLE_HEDEF:?test kipinde ARSIV_ESLE_HEDEF gerekli}"
  MOTOR_HEDEF="${ARSIV_ESLE_MOTOR_HEDEF:-$HOME/.empp-agent/motor/}"
  RSH=()
else
  SSH=(ssh -o ConnectTimeout=10 -o BatchMode=yes ${PROBOOK_KEY:+-i "$PROBOOK_KEY"} "$HOST")
  HEDEF="$HOST:.empp-agent/kaynak-arsivi/"
  MOTOR_HEDEF="$HOST:.empp-agent/motor/"
  RSH=(-e "ssh -o ConnectTimeout=10 -o BatchMode=yes ${PROBOOK_KEY:+-i $PROBOOK_KEY}")
fi
UZAK_NODE="${ARSIV_ESLE_UZAK_NODE:-\$HOME/empp-serit/node/bin/node}"
UZAK_REPO="${ARSIV_ESLE_UZAK_REPO:-\$HOME/empp-serit/repo}"
DAMGA="$(date +%Y%m%d-%H%M%S)"
IMZA="arsiv-esle $$ $DAMGA"
mkdir -p "$(dirname "$LOGF")"
log(){ printf '[arsiv-esle %s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOGF"; }

# Tek kopya: mkdir kilidi; sahibi ölüyse kenara alınır.
if ! mkdir "$KILIT" 2>/dev/null; then
  ESKI=$(cat "$KILIT/pid" 2>/dev/null || echo 0)
  if kill -0 "$ESKI" 2>/dev/null; then log "baska esleme suruyor (pid $ESKI) — cikiliyor"; exit 0; fi
  mv "$KILIT" "$KILIT.kaldirildi-$DAMGA" 2>/dev/null; mkdir "$KILIT" || { log "kilit alinamadi"; exit 1; }
fi
echo $$ > "$KILIT/pid"
trap 'rm -f "$KILIT/pid"; rmdir "$KILIT" 2>/dev/null' EXIT   # kendi kilit dizinimiz

OZET_JS='const a=require(process.argv[1]+"/src/agent/kaynak-arsivi.js");const k=process.argv[2];const o=a.arsivOzeti(k||undefined);console.log(o.ozet+" "+o.adet+" "+o.kitaplar.join(","))'
MAC=$(node -e "$OZET_JS" "$REPO" "$KOK") || { log "Mac ozeti hesaplanamadi"; exit 1; }
uzak_ozet(){ "${SSH[@]}" "$UZAK_NODE -e '$OZET_JS' \"$UZAK_REPO\" \"\$HOME/.empp-agent/kaynak-arsivi\"" 2>/dev/null; }
# Motor kanoniği: `motor-surumu.js kanonikOzetEsz`in BAĞIMLILIKSIZ eşi (ProBook'taki depo eski
# olsa da koşar; eşlik testle çivili). Çıktı: doğrulanmış sha12 ya da "yok". Tek tırnak içermez
# (uzak komut); tek satır kalır, bölünmez.
MOTOR_JS='const f=require("fs"),p=require("path"),c=require("crypto");let r="yok";try{const y=process.argv[1];const k=JSON.parse(f.readFileSync(y,"utf8"));if(k&&typeof k.sha12==="string"&&k.sha12.length===12&&typeof k.surum==="string"&&/^\d+(\.\d+)*$/.test(k.surum.trim())){const b=f.readFileSync(p.join(p.dirname(y),"43e23fce2b7009474555a77.js"));if(b.length&&c.createHash("sha256").update(b).digest("hex").slice(0,12)===k.sha12)r=k.sha12}}catch(e){}console.log(r)'
MOTOR_YOL="${EMPP_MOTOR_KANONIK:-$HOME/.empp-agent/motor/kanonik.json}"
MAC_MOTOR=$(node -e "$MOTOR_JS" "$MOTOR_YOL" 2>/dev/null) || MAC_MOTOR=yok
uzak_motor(){
  "${SSH[@]}" "$UZAK_NODE -e '$MOTOR_JS' \"\$HOME/.empp-agent/motor/kanonik.json\"" 2>/dev/null
}
PB_MOTOR=$(uzak_motor) || PB_MOTOR=""
motor_esit(){ [ "$MAC_MOTOR" = "yok" ] || [ "$PB_MOTOR" = "$MAC_MOTOR" ]; }
PB=$(uzak_ozet) || PB=""
log "Mac: ${MAC%% *} (${MAC#* }) | ProBook: ${PB:-okunamadi}" \
  "| motor Mac: $MAC_MOTOR ProBook: ${PB_MOTOR:-okunamadi}"
if [ -n "$PB" ] && [ "${PB%% *}" = "${MAC%% *}" ] && motor_esit; then
  log "esit — is yok"; exit 0
fi
[ "$KURU" = "1" ] && { log "kuru kosu: esleme yapilmadi"; exit 0; }

# Duraklat (yalnız bayrak yoksa; varsa başkasınındır, dokunulmaz).
KOYDUK=$("${SSH[@]}" "mkdir -p \$HOME/.empp-agent && if [ -e \$HOME/.empp-agent/duraklat.istek ]; then echo 0; else printf '%s\n' '$IMZA' > \$HOME/.empp-agent/duraklat.istek && echo 1; fi" 2>/dev/null) || KOYDUK=""
[ -n "$KOYDUK" ] || { log "ProBook'a ulasilamadi — esleme yok"; exit 1; }
log "ProBook ajani duraklatildi (bayrak: $([ "$KOYDUK" = 1 ] && echo biz koyduk || echo zaten vardi))"

if [ -z "${ARSIV_ESLE_SSH:-}" ] && [ "$RELE" != "1" ]; then
  case "${HOST#*@}" in
    192.168.*|10.*) ;;
    *) log "LAN yok ($HOST) — aktarim yapilmadi, ProBook DURAKLATILMIS kalir; ofiste: arsiv-esle.sh --host etapadmin@192.168.1.55"
       exit 1 ;;
  esac
fi
T0=$(date +%s)
"${SSH[@]}" "mkdir -p \$HOME/.empp-agent/kaynak-arsivi" >/dev/null 2>&1
rsync -a --partial --timeout=120 ${RSH[@]+"${RSH[@]}"} --exclude '.md5-dogrulandi' --exclude '*.tmp*' "$KOK/" "$HEDEF" >>"$LOGF" 2>&1
RC=$?
log "rsync rc=$RC, $(( $(date +%s) - T0 )) sn"
if [ "$MAC_MOTOR" != "yok" ] && [ "$PB_MOTOR" != "$MAC_MOTOR" ]; then
  MOTOR_DIZIN="$(dirname "$MOTOR_YOL")"
  "${SSH[@]}" "mkdir -p \$HOME/.empp-agent/motor" >/dev/null 2>&1
  rsync -a --partial --timeout=120 ${RSH[@]+"${RSH[@]}"} \
      "$MOTOR_DIZIN/43e23fce2b7009474555a77.js" "$MOTOR_HEDEF" >>"$LOGF" 2>&1 \
    && rsync -a --timeout=120 ${RSH[@]+"${RSH[@]}"} \
      "$MOTOR_YOL" "${MOTOR_HEDEF}kanonik.json" >>"$LOGF" 2>&1
  MRC=$?
  log "motor rsync rc=$MRC ($MAC_MOTOR)"
  [ "$MRC" = "0" ] || RC=$MRC
  PB_MOTOR=$(uzak_motor) || PB_MOTOR=""
fi

# Mac'te kaydı olmayan kitap dizinleri ProBook'ta Silinecekler'e (silme yok).
MAC_LISTE="${MAC##* }"
"${SSH[@]}" "cd \$HOME/.empp-agent/kaynak-arsivi 2>/dev/null || exit 0
  for d in */; do d=\${d%/}; [ -f \"\$d/kaynak.json\" ] || continue
    case \",$MAC_LISTE,\" in *\",\$d,\"*) ;; *) mkdir -p \$HOME/Silinecekler/kaynak-arsivi-$DAMGA && mv \"\$d\" \$HOME/Silinecekler/kaynak-arsivi-$DAMGA/ && echo \"Mac'te yok, kenara: \$d\";; esac
  done" 2>&1 | while read -r l; do log "$l"; done

PB=$(uzak_ozet) || PB=""
if [ "$RC" = "0" ] && [ -n "$PB" ] && [ "${PB%% *}" = "${MAC%% *}" ] && motor_esit; then
  if [ "$KOYDUK" = "1" ]; then
    "${SSH[@]}" "grep -qF '$IMZA' \$HOME/.empp-agent/duraklat.istek 2>/dev/null && mv \$HOME/.empp-agent/duraklat.istek \$HOME/.empp-agent/duraklat.istek.kaldirildi-$DAMGA" >/dev/null 2>&1
    log "esit (${PB%% *}) — duraklatma kaldirildi"
  else
    log "esit (${PB%% *}) — bayrak baskasinin, dokunulmadi"
  fi
  exit 0
fi
log "HATA: ozet esitlenmedi (Mac ${MAC%% *} / ProBook ${PB%% *};" \
  "motor Mac $MAC_MOTOR / ProBook ${PB_MOTOR:-okunamadi}) — ProBook DURAKLATILMIS kalir"
exit 1
