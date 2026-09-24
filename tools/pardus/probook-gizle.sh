#!/usr/bin/env bash
# ProBook kabul kapısı — TESTTEN ÖNCE: gizleme + MANİFEST (eşi: probook-temizlik.sh).
# Uzak makinede `bash -s <DAMGA> <PAKET> [HEDEF]` ile koşar; probook-kabul.sh stdin'e verir.
# Testi: src/agent/probook-temizlik.test.js
#
# İKİ KURULUM KÖKÜ VAR (2026-09-19): ~/DijiTap/DijiTap/<Set> ve ~/DijiTap/<alan-adi>/<Kitap>.
#
# MANİFEST (2026-09-24 olayı sonrası): temizlik artık "envanterde yok → test kurulumu → SİL"
# yapmıyor. O yöntem 18:06'da başka bir sürecin oluşturduğu `Privilege Grade 11.yedek-…`
# dizinini sildi. Temizlik YALNIZ bu dosyanın ~/.kabul-<damga>.manifest'e yazdığı yolları işler:
#   GIZLI <kok>/<ad>    bu koşunun `.kabulgizli-<damga>` yaptığı kurulum (geri konur)
#   KURULUM <kok>/<ad>  paketin AppRun'ından okunan kurulum hedefi — gizlemeden SONRA boştu,
#                       yani oraya gelen bu koşunun kurulumudur (silinir)
#   KOK <kok>           bu koşudan önce OLMAYAN alan adı kökü (boşsa kaldırılır)
#   ONCEKI <kok>/<ad>   gizlemeden sonra da yerinde kalan dizin (dokunulmaz; KURULUM sayılamaz)
# Başkasının `.kabulgizli-*`, `.yedek-*`, `.kaldirildi-*` dizinleri gizlenmez, listelenmez.
set -u

DAMGA="${1:?damga gerekli}"
PAKET="${2:-}"
HEDEF="${3:-}"
TABAN="$HOME/DijiTap"
M="$HOME/.kabul-$DAMGA.manifest"

korunan(){ case "$1" in *.kabulgizli-*|*.yedek-*|*.kaldirildi-*) return 0 ;; esac; return 1; }
gecerli_yol(){ case "$1" in ""|/*|*/*/*|*..*|*/) return 1 ;; */*) return 0 ;; esac; return 1; }

# Paketin kurulum hedefi: AppRun'daki PUBLISHER_NAME/APP_NAME (basepath=~/DijiTap/$PUBLISHER_NAME).
# Paket ÇALIŞTIRILMAZ — squashfs ofseti ELF başlığından hesaplanıp yalnız AppRun okunur.
hedef_bul(){
  local p="$1" off t pub app
  [ -f "$p" ] || return 0
  command -v unsquashfs >/dev/null && [ -x /usr/bin/python3 ] || return 0
  off=$(/usr/bin/python3 -c 'import struct,sys
h=open(sys.argv[1],"rb").read(64)
if h[:4]!=b"\x7fELF": sys.exit(1)
a,=struct.unpack("<Q",h[0x28:0x30]);b,=struct.unpack("<H",h[0x3A:0x3C]);c,=struct.unpack("<H",h[0x3C:0x3E]);print(a+b*c)' "$p" 2>/dev/null) || return 0
  t=$(mktemp -d)
  unsquashfs -q -n -d "$t/x" -o "$off" "$p" AppRun >/dev/null 2>&1
  pub=$(sed -n 's/^PUBLISHER_NAME="\(.*\)"$/\1/p' "$t/x/AppRun" 2>/dev/null | head -1)
  app=$(sed -n 's/^APP_NAME="\(.*\)"$/\1/p' "$t/x/AppRun" 2>/dev/null | head -1)
  rm -rf "$t"   # kendi mktemp dizinimiz
  [ -n "$pub" ] && [ -n "$app" ] && printf '%s/%s' "$pub" "$app"
}

# Gizlemeden önce çalışan kurulumu kapat (her iki kök).
pkill -f "$HOME/[D]ijiTap/" 2>/dev/null
sleep 2

mkdir -p "$TABAN"
: > "$M"

[ -n "$HEDEF" ] || HEDEF=$(hedef_bul "$PAKET")
if [ -n "$HEDEF" ] && gecerli_yol "$HEDEF"; then
  echo "hedef: $HEDEF"
  [ -d "$TABAN/${HEDEF%%/*}" ] || echo "KOK ${HEDEF%%/*}" >> "$M"
else
  echo "hedef: BILINMIYOR (AppRun okunamadi) — acilan surecin yolundan belirlenecek"
  HEDEF=""
fi

for kok in "$TABAN"/*/; do
  [ -d "$kok" ] || continue
  kokad="$(basename "${kok%/}")"
  korunan "$kokad" && continue
  for d in "$kok"*/; do
    [ -d "$d" ] || continue
    ad="$(basename "${d%/}")"
    korunan "$ad" && continue
    if mv "${d%/}" "${d%/}.kabulgizli-$DAMGA"; then
      echo "GIZLI $kokad/$ad" >> "$M"; echo "gizlendi: $kokad/$ad"
    else
      echo "ONCEKI $kokad/$ad" >> "$M"
    fi
  done
done

# Hedef gizlemeden sonra BOŞ olmalı; değilse (gizlenemedi/eşzamanlı doğdu) bizim değildir.
if [ -n "$HEDEF" ]; then
  if [ -e "$TABAN/$HEDEF" ]; then
    echo "ONCEKI $HEDEF" >> "$M"; echo "UYARI: hedef gizlemeden sonra da var — silinmeyecek: $HEDEF"
  else
    echo "KURULUM $HEDEF" >> "$M"
  fi
fi
exit 0
