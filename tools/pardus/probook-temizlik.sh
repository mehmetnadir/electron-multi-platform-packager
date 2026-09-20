#!/usr/bin/env bash
# ProBook kabul kapısı — TESTTEN SONRA: temizlik (eşi: probook-gizle.sh).
# Uzak makinede `bash -s <DAMGA> <KOPYALA> <UZAK>` ile koşar.
# Testi: src/agent/probook-temizlik.test.js — sahte bir $HOME altında gerçekten koşar.
#
# Neden gerekti (2026-09-19, üç ölçülmüş kusur):
#  1) Eski döngü YALNIZ `.kabulgizli-<damga>` diye gizlenmiş dizinleri geziyordu.
#     Kitabın ÖNCEDEN KURULUMU YOKSA gizlenecek bir şey olmuyor, döngü hiç dönmüyor,
#     TAZE KURULUM ProBook'ta KALIYORDU. Kanıt: 16:47 koşusu "YDT Power 12 Set".
#  2) `trap` yoktu; anormal çıkışta temizlik hiç koşmuyordu. Kanıt:
#     /tmp/kabul-1789656459.impark (1029 MB) iki gün durdu.
#  3) Tek kök biliniyordu (~/DijiTap/DijiTap). Tekil kitap paketleri
#     ~/DijiTap/<alan-adi>/<Kitap> altına kuruluyor; oradaki 514 MB'lık
#     Lingo-Land-Grade-3 kurulumu ve ÇALIŞAN uygulaması geride kalıyordu
#     (pkill kalıbı da o yolu tutmuyordu).
set -u

DAMGA="${1:?damga gerekli}"
KOPYALA="${2:-0}"
UZAK="${3:-}"

TABAN="$HOME/DijiTap"
ONCEKI="/tmp/kabul-onceki-$DAMGA.txt"

# Her iki kökteki uygulamayı da kapat (eski kalıp yalnız DijiTap/DijiTap'i tutuyordu).
pkill -f "$HOME/[D]ijiTap/" 2>/dev/null
sleep 2
pkill -9 -f "$HOME/[D]ijiTap/" 2>/dev/null

# (a) Testin KURDUĞU kurulumları sil — kitabın önceden kurulumu olsun olmasın.
if [ -f "$ONCEKI" ] && [ -d "$TABAN" ]; then
  for kok in "$TABAN"/*/; do
    [ -d "$kok" ] || continue
    kokad="$(basename "${kok%/}")"
    case "$kokad" in *.kabulgizli-*) continue ;; esac
    for d in "$kok"*/; do
      [ -d "$d" ] || continue
      ad="$(basename "${d%/}")"
      case "$ad" in *.kabulgizli-*) continue ;; esac
      grep -Fxq "$kokad/$ad" "$ONCEKI" || { rm -rf "${d%/}"; echo "silindi (test kurulumu): $kokad/$ad"; }
    done
  done
fi

# (b) Gizlenen ESKİ kurulumları geri koy.
for kok in "$TABAN"/*/; do
  [ -d "$kok" ] || continue
  for d in "$kok"*.kabulgizli-"$DAMGA"; do
    [ -e "$d" ] || continue
    asil="${d%.kabulgizli-$DAMGA}"
    rm -rf "$asil"
    mv "$d" "$asil"
    echo "geri konuldu: $(basename "$(dirname "$asil")")/$(basename "$asil")"
  done
done

# (c) Testin açtığı BOŞ alan adı dizinleri (kitap kökü testte doğmuş olabilir).
for kok in "$TABAN"/*/; do
  [ -d "$kok" ] || continue
  rmdir "${kok%/}" 2>/dev/null && echo "silindi (bos kok): $(basename "${kok%/}")"
done

# (d) Bu koşunun kendi artıkları.
rm -f "$ONCEKI" /tmp/kabul-baslatan.pid /tmp/kabul-calisma.log \
      /tmp/kabul-ekran.png /tmp/kabul-masaustu.png
[ "$KOPYALA" = "1" ] && [ -n "$UZAK" ] && rm -f "$UZAK"

# (e) ESKİ koşulardan kalan artıklar (1 günden yaşlı, yalnız kendi ad kalıbımız).
find /tmp -maxdepth 1 -name 'kabul-*.impark' -mtime +0 -delete 2>/dev/null
find /tmp -maxdepth 1 -name 'kabul-onceki-*.txt' -mtime +0 -delete 2>/dev/null

exit 0
