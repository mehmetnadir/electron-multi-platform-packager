#!/usr/bin/env bash
# ProBook kabul kapısı — TESTTEN SONRA: temizlik (eşi: probook-gizle.sh).
# Uzak makinede `bash -s <DAMGA> <KOPYALA> <UZAK>` ile koşar.
# Testi: src/agent/probook-temizlik.test.js — sahte bir $HOME altında gerçekten koşar.
#
# YALNIZ MANİFEST (2026-09-24 olayı): eski gövde "başlangıç envanterinde olmayan her dizini"
# test kurulumu sayıp siliyordu. 18:06'da eşzamanlı bir sürecin oluşturduğu
# `~/DijiTap/DijiTap/Privilege Grade 11.yedek-20260924-180613` böyle silindi.
# Artık yalnız ~/.kabul-<damga>.manifest'te bu koşunun yazdığı yollar işlenir; manifestte
# olmayan hiçbir dizin silinmez. Manifest yoksa hiçbir şey silinmez, uygulama da kapatılmaz.
# Önceki kusurlar (2026-09-19) hâlâ kapalı: taze kurulum hedefi manifestte (KURULUM) olduğu
# için ÖNCEDEN kurulumu olmayan kitapta da silinir; trap ile her çıkışta koşar; iki kök.
set -u

DAMGA="${1:?damga gerekli}"
KOPYALA="${2:-0}"
UZAK="${3:-}"
TABAN="$HOME/DijiTap"
M="$HOME/.kabul-$DAMGA.manifest"

gecerli_yol(){ case "$1" in ""|/*|*/*/*|*..*|*/) return 1 ;; */*) return 0 ;; esac; return 1; }
listede(){ grep -Fxq "$1 $2" "$M" 2>/dev/null; }

if [ -f "$M" ]; then
  pkill -f "$HOME/[D]ijiTap/" 2>/dev/null
  sleep 2
  pkill -9 -f "$HOME/[D]ijiTap/" 2>/dev/null

  # (a) Bu koşunun kurduğu kurulum.
  while read -r tur yol; do
    [ "$tur" = "KURULUM" ] || continue
    gecerli_yol "$yol" || { echo "atlandi (gecersiz yol): $yol"; continue; }
    listede ONCEKI "$yol" && { echo "atlandi (onceden vardi): $yol"; continue; }
    hedef="$TABAN/$yol"
    [ -L "$hedef" ] && { echo "atlandi (symlink): $yol"; continue; }
    [ -d "$hedef" ] && { rm -rf "$hedef"; echo "silindi (test kurulumu): $yol"; }
  done < "$M"

  # (b) Bu koşunun gizlediklerini geri koy. Yerinde başka bir şey varsa EZME.
  while read -r tur yol; do
    [ "$tur" = "GIZLI" ] || continue
    gecerli_yol "$yol" || continue
    g="$TABAN/$yol.kabulgizli-$DAMGA"; a="$TABAN/$yol"
    [ -e "$g" ] || continue
    if [ -e "$a" ]; then
      echo "CAKISMA: $yol yerinde bir dizin var — gizli kopya birakildi: $(basename "$g")"
    else
      mv "$g" "$a" && echo "geri konuldu: $yol"
    fi
  done < "$M"

  # (c) Bu koşunun açtığı alan adı kökü, boş kaldıysa.
  while read -r tur yol; do
    [ "$tur" = "KOK" ] || continue
    case "$yol" in ""|*/*|*..*) continue ;; esac
    rmdir "$TABAN/$yol" 2>/dev/null && echo "silindi (bos kok): $yol"
  done < "$M"

  rm -f "$M"   # kendi manifestimiz
else
  echo "manifest yok ($M) — hicbir sey silinmedi/kapatilmadi"
fi

# (d) Bu koşunun kendi artıkları.
rm -f "/tmp/kabul-onceki-$DAMGA.txt" /tmp/kabul-baslatan.pid /tmp/kabul-calisma.log \
      /tmp/kabul-ekran.png /tmp/kabul-masaustu.png \
      /tmp/kabul-ekran-kitap.png /tmp/kabul-masaustu-kitap.png   # E6 kitap ekrani olcumu
[ "$KOPYALA" = "1" ] && [ -n "$UZAK" ] && rm -f "$UZAK"

# (e) ESKİ koşulardan kalan artıklar (1 günden yaşlı, yalnız kendi ad kalıbımız).
find /tmp -maxdepth 1 -name 'kabul-*.impark' -mtime +0 -delete 2>/dev/null
find /tmp -maxdepth 1 -name 'kabul-onceki-*.txt' -mtime +0 -delete 2>/dev/null

exit 0
