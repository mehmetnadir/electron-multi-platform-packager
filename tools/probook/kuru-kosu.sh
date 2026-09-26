#!/bin/bash
# ProBook şeridi KURU KOŞU — runner'ın pardus yolunu CANLI ORTAMLA (serit-ortam.sh) koşar:
# kaynak arşivi/dosya → ikon → yerel derleme (kabul kilidiyle) → bütünlük → yerel kabul → temizlik.
# Sunucuya, R2'ye, pipeline DB'ye HİÇBİR ŞEY yazmaz (kira yok, yükleme yok).
# Kullanım (ProBook'ta):
#   kuru-kosu.sh derle  --kitap 73581 --baslik "Shall We 6 Set - Maarif Model" --yayinci "YDS Publishing"
#   kuru-kosu.sh kabul  --kitap 73581      # GUI ProBook ekranında açılır
#   kuru-kosu.sh temizle --kitap 73581     # iş dizini + son denetim (B.3)
# Canlı ajan koşarken çalışmaz (aynı kilit, aynı çalışma dizini).
set -u
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/serit-ortam.sh"
if systemctl --user is-active --quiet empp-serit-agent 2>/dev/null; then
  echo "canli ajan (empp-serit-agent) calisiyor — kuru kosu yapilmaz"; exit 3
fi
LOGO=""
if [ "${1:-}" = "derle" ]; then
  node "$REPO/tools/probook/logo-sunucu.js" >> "$SERIT/log/logo.log" 2>&1 &
  LOGO=$!
  sleep 1
fi
trap '[ -n "$LOGO" ] && kill "$LOGO" 2>/dev/null' EXIT
node "$REPO/tools/probook/kuru-kosu.js" "$@"
