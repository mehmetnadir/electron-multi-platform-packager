#!/bin/bash
# <swiftbar.title>Paket üretimi</swiftbar.title>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideLastUpdated>true</swiftbar.hideLastUpdated>
# <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>
# <swiftbar.hideSwiftBar>true</swiftbar.hideSwiftBar>
#
# MENÜ ÇUBUĞU (13.10, Nadir): sıradaki işleri gör, ara ver / devam ettir, "ben çalışırken de üret".
# Veri: ~/.empp-agent/durum.json (runner nabızda yazar). Bayraklar: duraklat.istek (yeni iş alma),
# mesgulken-uret.istek (boşta kapısını aç). Bayrak kaldırma = yeniden adlandırma (silme yok).
# Eylem: `empp.30s.sh eylem <duraklat|devam|mesgulken-ac|mesgulken-kapat|gunluk>`.

EV="$HOME/.empp-agent"
DURUM="$EV/durum.json"
BU="$0"

bayrak_kaldir() {
  [ -e "$EV/$1" ] && mv "$EV/$1" "$EV/$1.kaldirildi-$(date +%Y%m%d-%H%M%S)"
  return 0
}

if [ "$1" = "eylem" ]; then
  case "$2" in
    duraklat) : > "$EV/duraklat.istek" ;;
    devam) bayrak_kaldir duraklat.istek ;;
    mesgulken-ac) : > "$EV/mesgulken-uret.istek" ;;
    mesgulken-kapat) bayrak_kaldir mesgulken-uret.istek ;;
    gunluk) open -a Console "$EV/agent.log" ;;
  esac
  exit 0
fi

/usr/bin/python3 -I - "$DURUM" "$BU" "$EV" <<'PY'
import json, os, sys, time
from datetime import datetime, timezone
durum_yolu, bu, ev = sys.argv[1], sys.argv[2], sys.argv[3]

def eylem(etiket, ad):
    return f'{etiket} | bash="{bu}" param1=eylem param2={ad} terminal=false refresh=true'

try:
    d = json.load(open(durum_yolu, encoding='utf-8'))
    yas = time.time() - os.path.getmtime(durum_yolu)
except Exception:
    print('📦 ? | sfimage=shippingbox')
    print('---')
    print('Ajan durumu okunamadı (durum.json yok)')
    sys.exit(0)

duraklatildi = bool(d.get('duraklatildi'))
mesgulken = os.path.exists(os.path.join(ev, 'mesgulken-uret.istek'))
bosta = (d.get('bosta') or {})
suren = d.get('suren')
sira = d.get('sira') or []
ad = lambda b: (b.get('baslik') or '').strip()[:38]

if yas > 180:
    baslik, simge = 'ajan sessiz', 'exclamationmark.triangle'
elif duraklatildi:
    baslik, simge = f'ara · {len(sira)}', 'pause.circle'
elif suren:
    baslik, simge = f'{suren.get("bookId")} {suren.get("platform")}', 'gearshape.2'
elif bosta.get('durum') == 'mesgul':
    baslik, simge = f'bekliyor · {len(sira)}', 'moon.zzz'
else:
    baslik, simge = f'{len(sira)}', 'shippingbox'
print(f'{baslik} | sfimage={simge} size=12')
print('---')

if yas > 180:
    print(f'Ajan {int(yas // 60)} dk önce yazdı — çalışıyor mu? | color=#d33')
if suren:
    print(f'Üretiliyor: {suren.get("bookId")} · {suren.get("platform")}')
elif duraklatildi:
    print('Ara verildi — yeni iş alınmıyor')
elif bosta.get('durum') == 'mesgul':
    print('Siz çalışıyorsunuz — mac/android ertelendi')
    print('10 dk ara verince üretim kendiliğinden başlar | size=11')
else:
    print('Hazır — sıradaki iş alınır')
if bosta.get('sebep'):
    print(f'{bosta["sebep"]} | size=11 color=gray')
print(f'Konum: {"ofis" if d.get("ofiste") else "ofis dışı (mac noteri ofiste yapılır)"} | size=11 color=gray')

print('---')
print(f'Sıradaki işler ({len(sira)})')
for b in sira[:12]:
    print(f'--{b.get("bookId")} · {b.get("platform")} · {ad(b)} | size=12')
if len(sira) > 12:
    print(f'--… {len(sira) - 12} iş daha | size=11 color=gray')
if not sira:
    print('--Sıra boş | color=gray')

print('---')
print(eylem('Devam ettir', 'devam') if duraklatildi else eylem('Ara ver (süren iş biter, yeni iş alınmaz)', 'duraklat'))
if mesgulken:
    print(eylem('✓ Ben çalışırken de üret (kapat)', 'mesgulken-kapat'))
else:
    print(eylem('Ben çalışırken de üret', 'mesgulken-ac'))
print(eylem('Günlüğü aç', 'gunluk'))
PY
