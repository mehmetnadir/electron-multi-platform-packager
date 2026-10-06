#!/usr/bin/env bash
# gun-sonu-tablo.sh — 36 YDS setinin 4 platformdaki anlık durumu (SALT OKUMA).
#
# Kullanım:
#   gun-sonu-tablo.sh                      # platform özeti + failed satırlar
#   gun-sonu-tablo.sh --matris             # ayrıca set × platform matrisi
#   gun-sonu-tablo.sh --setler "11845 45551"   # set listesini ez
#   gun-sonu-tablo.sh --kabuk 1.13.14      # kanonik kabuk sürümü
#   gun-sonu-tablo.sh --izle 5             # 5 dakikada bir yenile (Ctrl-C ile çık)
#
# Matris işaretleri: ✓ güncel bugün · ○ kuyruk · ▶ koşuyor · ✗ fail · · eski · - kayıt yok
# Veri: tek ssh + tek SELECT (pipeline-sql). Çıkış kodu: 0 tamam, 2 ssh/SQL hatası.
# Yalnız bash + awk + ssh.

SETLER="11811 11845 11859 45100 45448 45449 45469 45472 45477 45478 45479 45480 45481 45482 45485 45487 45496 45504 45538 45540 45541 45549 45550 45551 45695 45792 59834 59835 60014 60015 60016 72378 72379 72380 73581 73768"
KABUK="1.13.14"
MATRIS=0
IZLE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --setler) SETLER="$2"; shift 2 ;;
    --kabuk) KABUK="$2"; shift 2 ;;
    --matris) MATRIS=1; shift ;;
    --izle) IZLE="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "bilinmeyen argüman: $1" >&2; exit 2 ;;
  esac
done

LISTE=$(printf '%s' "$SETLER" | tr -s ' ,' ',,' | awk '{sub(/^,/,""); sub(/,$/,""); print}')
case "$LISTE" in
  ''|*[!0-9,]*) echo "geçersiz set listesi: $SETLER" >&2; exit 2 ;;
esac

tablo_bir_kez() {
  local sql ham rc
  sql="SELECT CURDATE(), book_id, platform, status, kabuk_surum, kabuk_durum, last_run_at, last_queued_at, LEFT(IFNULL(last_result,''),100) FROM pipeline_platform_summaries WHERE book_id IN ($LISTE) ORDER BY book_id, platform"
  ham=$(ssh -p 2222 -o ControlPath=none -o ConnectTimeout=15 root@100.117.187.26 "pipeline-sql \"$sql\"" 2>&1)
  rc=$?
  if [ "$rc" -eq 255 ]; then
    echo "HATA: ssh bağlanamadı (çıkış 255): $ham" >&2
    return 2
  fi
  case "$ham" in
    ERROR*|*$'\n'ERROR*) echo "HATA: SQL hatası: $ham" >&2; return 2 ;;
  esac
  # rc=1 + boş çıktı = 0 satır (normal); diğer sıfır olmayan kod + çıktı yok = hata
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 1 ]; then
    echo "HATA: ssh çıkış kodu $rc: $ham" >&2
    return 2
  fi

  printf '%s\n' "$ham" | awk -F'\t' -v kabuk="$KABUK" -v setler="$LISTE" -v matris="$MATRIS" '
    BEGIN {
      np = split("windows pardus mac android", P, " ")
      ns = split(setler, S, ",")
      for (i = 1; i <= np; i++) { gun[i]=0; eski[i]=0; kuy[i]=0; kos[i]=0; fl[i]=0; yok[i]=0; pidx[P[i]]=i }
      nf = 0
    }
    NR == 1 && $2 == "book_id" { next }
    NF < 8 { next }
    {
      bugun=$1; b=$2; pl=$3; st=$4; ks=$5; kd=$6; run=$7; res=$9
      for (j = 10; j <= NF; j++) res = res "\t" $j
      if (!(pl in pidx)) next
      i = pidx[pl]
      if (st == "running" || st == "processing") { m = "▶"; kos[i]++ }
      else if (st == "queued" || st == "pending") { m = "○"; kuy[i]++ }
      else if (st == "failed" || st == "error") {
        m = "✗"; fl[i]++
        nf++; FS_[nf] = b; FP[nf] = pl; FH[nf] = substr(run, 12, 5); FR[nf] = res
      }
      else if (st == "completed") {
        if (ks == kabuk && kd == "guncel" && substr(run, 1, 10) == bugun) { m = "✓"; gun[i]++ }
        else { m = "·"; eski[i]++ }
      }
      else { m = "·"; eski[i]++ }
      M[b, i] = m
    }
    END {
      print "== Platform özeti (kanonik kabuk " kabuk ") =="
      printf "%-9s %12s %10s %7s %8s %5s %5s\n", "platform", "bitti_guncel", "bitti_eski", "kuyruk", "kosuyor", "fail", "yok"
      for (i = 1; i <= np; i++) {
        y = 0
        for (k = 1; k <= ns; k++) if (!((S[k], i) in M)) y++
        printf "%-9s %12d %10d %7d %8d %5d %5d\n", P[i], gun[i], eski[i], kuy[i], kos[i], fl[i], y
      }
      print ""
      print "== Failed satırlar =="
      if (nf == 0) print "(yok)"
      else for (k = 1; k <= nf; k++) printf "%s\t%s\t%s\t%s\n", FS_[k], FP[k], FH[k], FR[k]
      if (matris) {
        print ""
        print "== Matris (✓ güncel bugün · ○ kuyruk · ▶ koşuyor · ✗ fail · · eski · - yok) =="
        printf "%-7s %-3s %-3s %-3s %-3s\n", "set", "win", "par", "mac", "and"
        for (k = 1; k <= ns; k++) {
          line = sprintf("%-7s", S[k])
          for (i = 1; i <= np; i++) { x = ((S[k], i) in M) ? M[S[k], i] : "-"; line = line " " x "  " }
          print line
        }
      }
    }'
}

if [ "$IZLE" -gt 0 ] 2>/dev/null; then
  while true; do
    echo "### $(date '+%d.%m.%Y %H:%M:%S')"
    tablo_bir_kez
    echo
    sleep $((IZLE * 60))
  done
else
  tablo_bir_kez
  exit $?
fi
