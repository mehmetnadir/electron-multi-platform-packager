#!/bin/bash
# Üretim Masası başsız sf425 kabuk aracını (`webz-kabuk-uret`) runner'ın bulacağı yere kurar.
# Runner adımı: src/agent/set-kabuk-tazele.js (Z2, bayrak EMPP_SET_KABUK_TAZELE=1).
#
# Kullanım:
#   tools/set-kabuk/kur-webz-kabuk-uret.sh [UM_DIZINI] [HEDEF_DIZINI]
#     UM_DIZINI   : book-update apps/uretim-masasi-mac (varsayılan: $UM_DIZINI ya da
#                   ~/01dev/_worktrees/um-156/apps/uretim-masasi-mac)
#     HEDEF_DIZINI: varsayılan ~/.empp-agent/araclar (runner varsayılanı: <hedef>/webz-kabuk-uret)
#
# Yapılanlar: swift build (UretimMasasiCore) → swiftc ile araclar/webz-kabuk-uret.swift → geçici
# dizinde duman testi (argümansız çağrı çıkış 2 + kullanım satırı) → eski ikili ve kaynak paketi
# <hedef>/_eski/<zaman>/ altına TAŞINIR (silinmez) → yenisi yerine taşınır.
# Kaynak paketi `UretimMasasi_UretimMasasiCore.bundle` ikilinin YANINDA olmalı (yoksa sf425 teması
# bulunamaz: resource_bundle_accessor Fatal error — pilot 45550 ölçümü).
set -euo pipefail

UM="${1:-${UM_DIZINI:-$HOME/01dev/_worktrees/um-156/apps/uretim-masasi-mac}}"
HEDEF="${2:-$HOME/.empp-agent/araclar}"
AD="webz-kabuk-uret"
PAKET="UretimMasasi_UretimMasasiCore.bundle"

[ -f "$UM/araclar/$AD.swift" ] || { echo "HATA: $UM/araclar/$AD.swift yok" >&2; exit 1; }
cd "$UM"
SISTEM="$(cat .build/.buildSystem_debug 2>/dev/null || echo native)"
echo "[kur] swift build ($SISTEM) — $UM"
swift build --build-system "$SISTEM" --product UretimMasasiCore >/dev/null 2>&1 \
  || swift build --build-system "$SISTEM" >/dev/null

URUN="$(swift build --build-system "$SISTEM" --show-bin-path)"
[ -f "$URUN/UretimMasasiCore.o" ] || { echo "HATA: $URUN/UretimMasasiCore.o yok" >&2; exit 1; }
[ -d "$URUN/$PAKET" ] || { echo "HATA: $URUN/$PAKET yok" >&2; exit 1; }

GECICI="$(mktemp -d "${TMPDIR:-/tmp}/webz-kabuk-kur.XXXXXX")"
echo "[kur] swiftc → $GECICI/$AD"
swiftc -O -o "$GECICI/$AD" "araclar/$AD.swift" -I "$URUN" "$URUN/UretimMasasiCore.o"
cp -R "$URUN/$PAKET" "$GECICI/$PAKET"

# Duman testi: argümansız çağrı kullanım satırı + çıkış 2 vermeli.
set +e
CIKTI="$("$GECICI/$AD" 2>&1)"; KOD=$?
set -e
if [ "$KOD" -ne 2 ] || ! printf '%s' "$CIKTI" | grep -q "kullanım: $AD"; then
  echo "HATA: duman testi geçmedi (çıkış $KOD): $CIKTI" >&2; exit 1
fi

mkdir -p "$HEDEF"
if [ -e "$HEDEF/$AD" ] || [ -e "$HEDEF/$PAKET" ]; then
  ESKI="$HEDEF/_eski/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$ESKI"
  if [ -e "$HEDEF/$AD" ]; then mv "$HEDEF/$AD" "$ESKI/"; fi
  if [ -e "$HEDEF/$PAKET" ]; then mv "$HEDEF/$PAKET" "$ESKI/"; fi
  echo "[kur] eski kurulum → $ESKI"
fi
mv "$GECICI/$PAKET" "$HEDEF/$PAKET"
mv "$GECICI/$AD" "$HEDEF/$AD"

KAYNAK="$(git -C "$UM" rev-parse --short HEAD 2>/dev/null || echo '?')"
SHA="$(shasum -a 256 "$HEDEF/$AD" | cut -c1-12)"
printf '%s\n' "kaynak=$KAYNAK sha256=$SHA kuruldu=$(date +%Y-%m-%dT%H:%M:%S)" > "$HEDEF/$AD.surum"
echo "[kur] TAMAM: $HEDEF/$AD (kaynak $KAYNAK, sha256 $SHA)"
