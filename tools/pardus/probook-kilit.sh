#!/usr/bin/env bash
# ProBook kabul kapısı ORTAK KİLİDİ — uzak (Mac/Tudem ajanları, ssh) ve yerel (ProBook şeridi)
# kapılar AYNI dosyayı kullanır: ~/.kabul.lock (O_EXCL: `set -o noclobber`).
# ProBook'ta `bash -s <al|birak> <DAMGA> <KAYNAK> <PID>` ile koşar.
#
# NEDEN (2026-09-24, iki ölçülmüş olay): kapı betikleri /tmp'de SABİT adlar kullanıyor
# (kabul-baslatan.pid, kabul-calisma.log) ve her kapı ~/DijiTap altındaki kurulumları gizliyor.
# Yerel kapı biterken başka ajanın uzak kapısı başladı; 18:06'da eşzamanlı bir koşunun
# oluşturduğu `.yedek-` dizini kapı temizliğince silindi. Tek seferde tek kapı.
#
# Bayat kilit: dosya YAS_DK dakikadan eski (çökmüş/SIGKILL yemiş kapı) ya da kilidi alan
# ProBook'taki süreç ölü (KAYNAK = bu makinenin hostname'i ve pid yaşamıyor).
# Bayat kilit silinmez, `.kaldirildi-<ts>` olarak kenara alınır.
# Çıkış: al → 0 KILIT_ALINDI | 3 KILIT_MESGUL <içerik> ; birak → 0 (yalnız kendi damgası).
set -u
IS="${1:?al|birak}"; DAMGA="${2:?damga}"; KAYNAK="${3:-?}"; PID="${4:-0}"
L="${KABUL_KILIT:-$HOME/.kabul.lock}"
YAS_DK="${KABUL_KILIT_YAS_DK:-60}"
case "$IS" in
  al)
    if [ -e "$L" ]; then
      bayat=""
      [ -z "$(find "$L" -mmin -"$YAS_DK" 2>/dev/null)" ] && bayat="${YAS_DK} dk'dan eski"
      if [ -z "$bayat" ]; then
        k=$(sed -n 's/.*kaynak=\([^ ]*\).*/\1/p' "$L" 2>/dev/null)
        p=$(sed -n 's/.*pid=\([0-9]*\).*/\1/p' "$L" 2>/dev/null)
        if [ "$k" = "$(hostname)" ] && [ -n "$p" ] && ! kill -0 "$p" 2>/dev/null; then bayat="sahibi pid $p olu"; fi
      fi
      if [ -n "$bayat" ]; then
        mv -f "$L" "$L.kaldirildi-$(date +%s)" 2>/dev/null && echo "BAYAT KILIT kenara alindi ($bayat)"
      fi
    fi
    if ( set -o noclobber; printf 'pid=%s damga=%s kaynak=%s zaman=%s\n' "$PID" "$DAMGA" "$KAYNAK" "$(date +%s)" > "$L" ) 2>/dev/null; then
      echo "KILIT_ALINDI"; exit 0
    fi
    echo "KILIT_MESGUL $(head -1 "$L" 2>/dev/null)"; exit 3 ;;
  birak)
    if grep -q "damga=$DAMGA " "$L" 2>/dev/null; then rm -f "$L" && echo "KILIT_BIRAKILDI"; fi
    exit 0 ;;
  *) echo "bilinmeyen: $IS" >&2; exit 2 ;;
esac
