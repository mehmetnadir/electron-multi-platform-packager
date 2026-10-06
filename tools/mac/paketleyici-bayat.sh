#!/bin/bash
# Paketleyici (3001) diskteki koddan bayat kaldıysa, runner başlamadan ÖNCE onu yeniden açar.
# run-agent.sh bu dosyayı `source` eder ve `paketleyici_bayat_yeniden` çağırır. Silme yok.
# Ortam: EMPP_PAKETLEYICI_BAYAT_YENIDEN=0 kapatır · PB_REPO · PB_LOGDIR · PB_URL · PB_BEKLE_ARALIK (sn)
# `paketleyici_baslat` fonksiyonunu çağıran tanımlar (paketleyiciyi arka planda açar).

_pb_log() {
  local satir
  satir="$(date '+%Y-%m-%dT%H:%M:%S') paketleyici-bayat: $*"
  echo "$satir"
  [ -n "${PB_LOGDIR:-}" ] && echo "$satir" >> "$PB_LOGDIR/paketleyici-bayat.log" 2>/dev/null
  return 0
}

_pb_alan() { # $1 = json, $2 = metin alan adı
  printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" | head -1
}

_pb_saglik_var() { curl -sf -m 5 "${PB_URL:-http://127.0.0.1:3001}/api/health" >/dev/null 2>&1; }

_pb_kapanmayi_bekle() { # 20 deneme
  local i
  for i in $(seq 1 20); do
    _pb_saglik_var || return 0
    sleep "${PB_BEKLE_ARALIK:-1}"
  done
  return 1
}

paketleyici_bayat_yeniden() {
  local url="${PB_URL:-http://127.0.0.1:3001}" repo="${PB_REPO:-$HOME/01dev/electron-multi-platform-packager}"
  if [ "${EMPP_PAKETLEYICI_BAYAT_YENIDEN:-1}" = "0" ]; then
    _pb_log "kapalı (EMPP_PAKETLEYICI_BAYAT_YENIDEN=0)"; return 0
  fi
  local saglik
  saglik=$(curl -sf -m 5 "$url/api/health" 2>/dev/null) || { _pb_log "paketleyici kapalı; normal başlatma devam eder"; return 0; }
  local canli yerel bayat pid
  canli=$(_pb_alan "$saglik" commit)
  pid=$(printf '%s' "$saglik" | sed -n 's/.*"pid":\([0-9][0-9]*\).*/\1/p' | head -1)
  printf '%s' "$saglik" | grep -q '"bayatMi":true' && bayat=1 || bayat=0
  yerel=$(git -C "$repo" rev-parse --short HEAD 2>/dev/null)
  [ -z "$yerel" ] && [ -f "$repo/.surum" ] && yerel=$(tr -d '[:space:]' < "$repo/.surum")
  if [ -z "$yerel" ]; then _pb_log "disk sürümü okunamadı (git/.surum yok); dokunulmadı"; return 0; fi
  if [ "$canli" = "$yerel" ] && [ "$bayat" = 0 ]; then
    _pb_log "güncel (commit=$canli); dokunulmadı"; return 0
  fi
  _pb_log "BAYAT: canlı=$canli disk=$yerel bayatMi=$bayat pid=$pid"
  local kuyruk
  kuyruk=$(curl -sf -m 5 "$url/api/queue-status" 2>/dev/null) || { _pb_log "kuyruk okunamadı; dokunulmadı"; return 0; }
  # Meşgul sayılan: yalnız BİTMEMİŞ işler. Biten (completed/failed/error/cancelled) iş meşgul DEĞİL:
  # kasada 3 completed kayıt süresiz kalıp yeniden açmayı engelledi (06.10, paketleyici 65db3fa'da takıldı).
  # Bilinmeyen durum adı = meşgul (temkinli). packagingJobs ile activePackagingJobs aynı işleri taşır:
  # id/jobId ile tekilleştirilir. zipJobs ayrı sayılır. Okunamazsa -1 → dokunma.
  local mesgul
  mesgul=$(printf '%s' "$kuyruk" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const q=JSON.parse(s);
const bit=new Set(["completed","failed","error","cancelled","canceled"]);const L=(l)=>Array.isArray(l)?l:[];
const acik=(j)=>!bit.has(j&&j.status);const z=L(q.zipJobs).filter(acik).length;
const k=new Set();let n=0;for(const j of L(q.packagingJobs).concat(L(q.activePackagingJobs))){if(!acik(j))continue;
const id=j&&(j.jobId||j.id);if(id===undefined||id===null){n++;continue}k.add(String(id))}
console.log(z+n+k.size)}catch(e){console.log(-1)}})' 2>/dev/null)
  if [ "$mesgul" != "0" ]; then
    _pb_log "kuyruk DOLU/okunamadı (mesgul=$mesgul); dokunulmadı (sonraki runner çıkışında yeniden denenir)"; return 0
  fi
  # Eski sürüm health'inde pid yok → komut satırından bul (lsof YASAK: macOS'ta asılır). Tek eşleşme şart.
  if [ -z "$pid" ]; then
    local adaylar
    adaylar=$(pgrep -f 'node src/server/app\.js' 2>/dev/null)
    [ "$(echo "$adaylar" | wc -w | tr -d ' ')" = "1" ] && pid=$adaylar
  fi
  case "$pid" in ''|*[!0-9]*) _pb_log "health pid yok; dokunulmadı"; return 0;; esac
  if ! ps -o command= -p "$pid" 2>/dev/null | grep -q 'app\.js'; then
    _pb_log "pid=$pid app.js değil; dokunulmadı"; return 0
  fi
  local cocuk c
  cocuk=$(pgrep -P "$pid" 2>/dev/null)
  _pb_log "kuyruk boş; kapatılıyor (pid=$pid çocuk=$(echo $cocuk))"
  for c in $cocuk; do kill -TERM "$c" 2>/dev/null; done
  kill -TERM "$pid" 2>/dev/null
  if ! _pb_kapanmayi_bekle; then
    _pb_log "TERM yetmedi; KILL"
    for c in $cocuk; do kill -KILL "$c" 2>/dev/null; done
    kill -KILL "$pid" 2>/dev/null
    _pb_kapanmayi_bekle || { _pb_log "HATA: 3001 kapanmadı"; return 1; }
  fi
  _pb_log "3001 kapandı; yeniden açılıyor"
  paketleyici_baslat
  local i yeni=""
  for i in $(seq 1 20); do
    saglik=$(curl -sf -m 5 "$url/api/health" 2>/dev/null) && { yeni=$(_pb_alan "$saglik" commit); break; }
    sleep "${PB_BEKLE_ARALIK:-1}"
  done
  if [ "$yeni" = "$yerel" ]; then _pb_log "TAMAM: yeni commit=$yeni = disk"; return 0; fi
  _pb_log "UYARI: yeniden açıldı ama commit=$yeni disk=$yerel"
  return 1
}
