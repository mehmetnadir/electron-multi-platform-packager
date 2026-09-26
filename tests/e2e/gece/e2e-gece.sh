#!/bin/bash
# e2e-gece.sh [aksam|sabah] — uçtan uca sağlık gece koşusu sarmalayıcısı (launchd çağırır).
# Sözleşme: .claude/docs/uctan-uca-saglik-sozlesmesi.md "Koşu düzeni".
#   aksam (22:00): T1-T5 · sabah (07:30): T5 doğrulaması. Kip verilmezse saatten seçilir (<12 sabah).
#   Koşu ~/.empp-agent/agir.sh semaforundan geçer; sonuç özeti `bildir e2e "<özet>"` ile gider,
#   koşu çıkış kodu ≠0 ise öncelik yuksek. bildir gönderilemezse çıkış 2 (sessiz alarm yok).
# Ortam (hepsi isteğe bağlı): E2E_KITAP (74390) · E2E_KURU (1: yalnız YAZAN/TETİKLEYEN adım koşmaz —
#   salt-okuma ölçümler kuruda da koşar; onaylar gelince 0)
#   E2E_URL / E2E_PAKET (boşlukla ayrılmış girdiler; boşsa koşucu pipeline satırlarından CDN URL'lerini
#   kendisi bulur) · E2E_INDIR (1: CDN paketleri tam indirilip içi ölçülür — salt okuma; 0: HEAD+Range)
#   E2E_TESTLER_AKSAM / E2E_TESTLER_SABAH
#   E2E_BILDIRME=0 (ilk elle doğrulama: bildirim atmaz, özeti basar) · E2E_GECE_AGIR=0 (semaforsuz)
#   E2E_BILDIR / E2E_NODE / E2E_KOSUCU / E2E_AGIR_BETIK (araç yolları; testler sahtesini verir)
set -u
BURASI="$(cd "$(dirname "$0")" && pwd)"
DEPO="${E2E_DEPO:-$(cd "$BURASI/../../.." && pwd)}"
KIP="${1:-}"
if [ -z "$KIP" ]; then
  if [ "$(date +%H)" -lt 12 ]; then KIP=sabah; else KIP=aksam; fi
fi
case "$KIP" in
  aksam) TESTLER="${E2E_TESTLER_AKSAM:-T1,T2,T3,T4,T5}" ;;
  sabah) TESTLER="${E2E_TESTLER_SABAH:-T5}" ;;
  *) echo "kullanım: e2e-gece.sh [aksam|sabah]" >&2; exit 2 ;;
esac
KITAP="${E2E_KITAP:-74390}"
NODE="${E2E_NODE:-$(command -v node || true)}"
[ -n "$NODE" ] || NODE="$HOME/.nvm/versions/node/v24.16.0/bin/node"
KOSUCU="${E2E_KOSUCU:-$DEPO/tests/e2e/uctan-uca.js}"
AGIR="${E2E_AGIR_BETIK:-$HOME/.empp-agent/agir.sh}"
BILDIR="${E2E_BILDIR:-$(command -v bildir || true)}"
[ -n "$BILDIR" ] || BILDIR="$HOME/.local/bin/bildir"

ARG=(kos --test "$TESTLER" --kitap "$KITAP")
[ "${E2E_KURU:-1}" = 1 ] && ARG+=(--kuru)
[ "${E2E_INDIR:-1}" = 1 ] && ARG+=(--indir)
for u in ${E2E_URL:-}; do ARG+=(--url "$u"); done
for p in ${E2E_PAKET:-}; do ARG+=(--paket "$p"); done

BAS=$(date +%s)
if [ "${E2E_GECE_AGIR:-1}" = 1 ] && [ -x "$AGIR" ]; then
  # Dış semafor slotu tutulurken iç paket denetimi ikinci slot istemesin (EMPP_E2E_AGIR=0).
  CIKTI=$(EMPP_E2E_AGIR=0 "$AGIR" "e2e-gece-$KIP" "$NODE" "$KOSUCU" "${ARG[@]}" 2>&1)
else
  CIKTI=$("$NODE" "$KOSUCU" "${ARG[@]}" 2>&1)
fi
RC=$?
SURE=$(( $(date +%s) - BAS ))
printf '%s\n' "$CIKTI"

# Özet: "GENEL <hüküm> — <md>" + test başına hüküm satırları ("T1  KALDI")
GENEL=$(printf '%s\n' "$CIKTI" | sed -n 's/^GENEL \([A-Z]*\) — \(.*\)$/\1|\2/p' | tail -1)
TESTOZET=$(printf '%s\n' "$CIKTI" | awk '/^T[1-5] +[A-Z]+$/ {printf "%s%s %s", s, $1, $2; s=", "}')
if [ -n "$GENEL" ]; then
  OZET="e2e $KIP ${GENEL%%|*} (rc=$RC, ${SURE} sn): ${TESTOZET:-test satırı yok} — ${GENEL#*|}"
else
  SON=$(printf '%s\n' "$CIKTI" | grep -v '^AGIR-EXIT' | tail -1 | cut -c1-160)
  OZET="e2e $KIP ÇÖKTÜ (rc=$RC, ${SURE} sn): ${SON:-çıktı yok}"
  [ "$RC" -eq 0 ] && RC=3
fi
echo "ÖZET: $OZET"

if [ "${E2E_BILDIRME:-1}" = 0 ]; then
  echo "bildirim atlandı (E2E_BILDIRME=0)"
  exit "$RC"
fi
ONCELIK=normal
[ "$RC" -ne 0 ] && ONCELIK=yuksek
"$BILDIR" e2e "$OZET" -p "$ONCELIK"
BRC=$?
if [ "$BRC" -ne 0 ]; then
  echo "bildir gönderilemedi (rc=$BRC) — alarm düşmedi" >&2
  exit 2
fi
exit "$RC"
