#!/bin/bash
# ProBook KABUL KAPISI — üretilen .impark gerçek Pardus makinesinde kurulup AÇILMADAN
# yüklenmez (Nadir kuralı, 2026-09-17: "her yaptığını pardus'ta aç, doğrulayıp öyle yükle").
#
# NEDEN: 2026-09-17'de 14 SET paketi aylardır beyaz ekran açıyordu; zenity/bütünlük/asar
# denetimleri HEPSİ geçiyordu çünkü hiçbiri uygulamayı AÇMIYORDU. Yalnız gerçek makinede
# açmak bu sınıfı yakalar.
#
# Kullanim: probook-kabul.sh <paket.impark | uzak:/ProBook/yolu.impark> [kanit-dizini]
#   Cikis 0 = kabul (kurulum + acilis + kok sayfa temiz), !=0 = RED (paket yuklenmemeli)
# Ortam: PROBOOK_HOST (etapadmin@192.168.1.55), PROBOOK_KEY (~/.ssh/id_ed25519),
#        PROBOOK_BEKLE (acilis icin ust sinir sn, varsayilan 300),
#        PROBOOK_PENCERE (surec gorulduikten sonra cizim payi sn, varsayilan 25)
#
# Kurulum onbellegi tuzagi: AppRun `.empp-version` isaretine bakar; ayni surum zaten
# kuruluysa paketi ACMAZ, ESKI kurulumu calistirir -> kapi bayat paketi onaylar.
# Bu yuzden test oncesi mevcut kurulumlar GECICI olarak yeniden adlandirilir (silinmez),
# test sonunda yeni kurulum silinir ve eskiler geri konur.
set -uo pipefail
# Temizlik govdesi bu betigin yanindadir (symlink ile cagrilsa da dogru cozulsun).
BETIK_DIZIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIRDI="${1:?impark yolu (veya uzak:/yol)}"; KANIT="${2:-}"
HOST="${PROBOOK_HOST:-etapadmin@192.168.1.55}"
KEY="${PROBOOK_KEY:-$HOME/.ssh/id_ed25519}"
BEKLE="${PROBOOK_BEKLE:-300}"
PENCERE="${PROBOOK_PENCERE:-25}"
# AKTIVASYON KODLU SERILER (Nadir kurali 2026-09-18): Privilege · Marvel · Impact ·
# Influence · Power ve YKS-DIL dergileri acilista AKTIVASYON KODU ister; bu ekran
# arizanin degil, motorun CALISTIGININ kanitidir (motor yuklendi, anahtar deposunu
# okudu, kullaniciya sordu). Defterdeki isaret: pipeline_book_summaries.notes
# icinde [aktivasyon-kodlu] (12 kitap). Diger kitaplarda ayni ekran ARIZADIR.
# Bu kitaplarda RENK esigi (>=500) aranmaz — diyalog az renk icerir; sapma ve koyu
# piksel sartlari AYNEN gecerlidir, yani bos/beyaz ekran yine reddedilir.
AKTIVASYON="${EMPP_AKTIVASYON_BEKLENIR:-0}"
SSH=(ssh -o ConnectTimeout=10 -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY" "$HOST")
say(){ printf '[kabul] %s\n' "$*"; }
red(){ say "RED: $*"; temizle; exit 1; }

DAMGA=$(date +%s)
if [[ "$GIRDI" == uzak:* ]]; then
  UZAK="${GIRDI#uzak:}"; AD=$(basename "$UZAK"); KOPYALA=0
  [ -n "$KANIT" ] || KANIT="${TMPDIR:-/tmp}/probook-kabul-$DAMGA"
else
  [ -f "$GIRDI" ] || { say "RED: paket bulunamadi: $GIRDI"; exit 1; }
  AD=$(basename "$GIRDI"); UZAK="/tmp/kabul-$DAMGA.impark"; KOPYALA=1
  [ -n "$KANIT" ] || KANIT="$(dirname "$GIRDI")/probook-kabul"
fi
mkdir -p "$KANIT"

# TEMIZLIK (2026-09-19, Nadir sorusu + olcumle duzeltildi)
#
# Iki kusur vardi:
#  1) Dongu YALNIZ `.kabulgizli-$DAMGA` olarak GIZLENMIS dizinleri geziyordu.
#     Test edilen kitabin ONCEDEN KURULUMU YOKSA hicbir sey gizlenmez, dongu
#     hic donmez ve TAZE KURULUM ProBook'ta KALIR. Ilk kez test edilen her
#     kitap diski yiyordu.
#  2) `trap` yoktu: betik anormal biterse (ssh kopmasi, kill, zaman asimi)
#     temizlik HIC kosmuyordu. Kanit: /tmp/kabul-1789656459.impark (1029 MB,
#     17 Eylul) iki gun boyunca durdu.
#
# Cozum: testten ONCE mevcut dizin listesi kaydedilir; temizlikte listede
# OLMAYAN her dizin (yani testin kurdugu) silinir. Ayrica trap ile her cikis
# yolunda kosar. Idempotent: iki kez cagrilmasi zararsiz.
# GOVDE AYRI DOSYADA: tools/pardus/probook-temizlik.sh — sebebi test
# edilebilirlik (src/agent/probook-temizlik.test.js onu gercekten kosturur).
TEMIZLENDI=0
temizle(){
  [ "$TEMIZLENDI" = "1" ] && return 0
  TEMIZLENDI=1
  "${SSH[@]}" "bash -s '$DAMGA' '$KOPYALA' '$UZAK'" \
    >>"$KANIT/temizlik.log" 2>&1 <"$BETIK_DIZIN/probook-temizlik.sh"
}
trap 'temizle' EXIT

command -v ssh >/dev/null || { say "RED: ssh yok"; exit 1; }
"${SSH[@]}" 'echo hazir' >/dev/null 2>&1 || { say "RED: ProBook'a baglanilamadi ($HOST)"; exit 1; }

if [ "$KOPYALA" = "1" ]; then
  BOYUT=$(stat -f%z "$GIRDI" 2>/dev/null || stat -c%s "$GIRDI")
  # ProBook disk kapisi: paket /tmp'e kopyalanir VE ~/DijiTap altina acilir
  # (yaklasik 2.5 kat) — yer yoksa kurulum yarim kalir ve kapi "pencere acilmadi"
  # gibi YANILTICI bir red uretir. Once olc, net sebeple dus.
  GEREKLI_MB=$(( BOYUT / 1000000 * 25 / 10 + 2000 ))
  BOS_MB=$("${SSH[@]}" "df -Pk \$HOME | awk 'NR==2{print int(\$4/1024)}'" 2>/dev/null)
  if [ -n "$BOS_MB" ] && [ "$BOS_MB" -lt "$GEREKLI_MB" ]; then
    say "RED: ProBook diskinde yer yok (${BOS_MB} MB bos < ${GEREKLI_MB} MB gerekli)"
    exit 1
  fi
  say "ProBook disk: ${BOS_MB:-?} MB bos (gerekli ~${GEREKLI_MB} MB)"
  # Acilis suresi paket BOYUTUYLA olceklenir: AppRun paketi ~/DijiTap altina ACAR,
  # 1,5 GB'lik SET bu makinede 7 dakikaya sigmadi (olcum 2026-09-17, kitap 45695:
  # "Ilk kurulum basliyor..." sonrasi 420 sn dolunca surec oldurulup RED verildi).
  # Kural: taban 300 sn + her 100 MB icin ~50 sn.
  BOYUT_MB=$((BOYUT/1000000))
  OLCEKLI=$(( 300 + BOYUT_MB / 2 ))
  if [ "$OLCEKLI" -gt "$BEKLE" ]; then
    say "acilis ust siniri buyutuldu: ${BEKLE} -> ${OLCEKLI} sn (paket ${BOYUT_MB} MB)"
    BEKLE="$OLCEKLI"
  fi
  say "kopyalaniyor: $AD ($((BOYUT/1000000)) MB)"
  scp -q -o ConnectTimeout=10 -o BatchMode=yes -i "$KEY" "$GIRDI" "$HOST:$UZAK" \
    || { say "RED: kopyalanamadi"; exit 1; }
fi

say "eski kurulumlar gizleniyor + paket baslatiliyor"
# GIZLEME GOVDESI AYRI DOSYADA (2026-09-19): iki kurulum kokunu de gezer ve
# envanteri /tmp/kabul-onceki-<damga>.txt'ye yazar; temizlik ayni dosyayi okur.
# Gerekcesi ve kanitlari: tools/pardus/probook-gizle.sh basligi.
"${SSH[@]}" "bash -s '$DAMGA'" > "$KANIT/baslat.log" 2>&1 <"$BETIK_DIZIN/probook-gizle.sh" \
  || { say "RED: gizleme adimi basarisiz"; exit 1; }

"${SSH[@]}" "bash -s" >> "$KANIT/baslat.log" 2>&1 <<UZAKBETIK
set -u
UZAK="$UZAK"
[ -f "\$UZAK" ] || { echo "HATA: uzak paket yok: \$UZAK"; exit 3; }
chmod +x "\$UZAK"
: > /tmp/kabul-calisma.log
setsid env DISPLAY=:0 XAUTHORITY=\$HOME/.Xauthority "\$UZAK" > /tmp/kabul-calisma.log 2>&1 < /dev/null &
echo \$! > /tmp/kabul-baslatan.pid
echo "baslatildi: \$UZAK (baslatan pid=\$(cat /tmp/kabul-baslatan.pid))"
UZAKBETIK
grep -q '^baslatildi' "$KANIT/baslat.log" || red "paket ProBook'ta baslatilamadi ($(tail -2 "$KANIT/baslat.log" | tr '\n' ' '))"

say "acilis bekleniyor (ust sinir ${BEKLE} sn)"
# YANLIS KABUL TUZAGI (2026-09-17 olculdu): `pgrep -f DijiTap/DijiTap` AppRun'in KURULUM
# cocuklarini da yakalar (cp/rsync komut satirinda ayni yol gecer) — surec sayisi 6 iken
# ekranda Chrome vardi, uygulama hic acilmamisti. Bu yuzden olcut SUREC degil PENCERE:
# /proc/<pid>/exe kurulum dizinine isaret eden gercek uygulama sureci + ona ait gorunur X
# penceresi. Beyaz ekran ayrica piksel sapmasiyla olculur.
"${SSH[@]}" "bash -s" > "$KANIT/bekle.log" 2>&1 <<UZAKBEKLE
set -u
export DISPLAY=:0 XAUTHORITY=\$HOME/.Xauthority
# IKI KURULUM KOKU (2026-09-19 olculdu): SET paketleri ~/DijiTap/DijiTap/<Set>,
# tekil kitap paketleri ~/DijiTap/<alan-adi>/<Kitap> altina kurulur. Eski kalip
# yalniz birincisini tutuyordu; Lingo-Land-Grade-3 kosusunda gercek uygulama
# surecinin yolu hic eslesmedi.
TABAN="\$HOME/DijiTap"
gecen=0
while [ \$gecen -lt $BEKLE ]; do
  sleep 10; gecen=\$((gecen+10))
  APPPID=""
  # YABANCI PENCERE TUZAGI (2026-09-18 olculdu): 45487 ve 45472 BIREBIR ayni sayilarla
  # (sapma=0.148006 koyu=0.906142 renk=384) reddedildi — iki farkli paketin ayni sayiyi
  # vermesi imkansiz. Sebep: Nadir o sirada ProBook'ta elle bir kitap acmisti; kapinin
  # pgrep'i ONUN surecini secti. Iki ek sart: (1) exe gizlenmis eski kurulumda OLMAYACAK
  # (bizim paket disindaki her dizin .kabulgizli-* olarak yeniden adlandirildi),
  # (2) surec kapi baslatildiktan SONRA dogmus olacak (yas <= gecen+60 sn).
  for pid in \$(pgrep -f "\$TABAN/" 2>/dev/null); do
    exe=\$(readlink -f /proc/\$pid/exe 2>/dev/null) || continue
    case "\$exe" in
      *.kabulgizli-*) continue;;
      "\$TABAN"/*) ;;
      *) continue;;
    esac
    yas=\$(ps -o etimes= -p \$pid 2>/dev/null | tr -d ' ')
    [ -n "\$yas" ] && [ "\$yas" -gt \$((gecen + 60)) ] && continue
    # SOYAGACI SARTI (2026-09-18, ikinci kusur): pkill yabanci uygulamayi oldurunce
    # onun .impark'i KENDINI YENIDEN KURUYOR -> taze surec + gizlenmemis dizin, iki
    # filtreyi de asiyor (45487 iki kez Nadir'in Lingoland 2 penceresini olctu,
    # wid=14680067). Tek kesin olcut: surec BIZIM baslattigimiz AppImage'in torunu mu?
    BASLATAN=\$(cat /tmp/kabul-baslatan.pid 2>/dev/null || echo 0)
    ata=\$pid; bizim=0
    for _ in 1 2 3 4 5 6 7 8; do
      [ "\$ata" = "\$BASLATAN" ] && { bizim=1; break; }
      [ "\$ata" = "1" ] || [ -z "\$ata" ] && break
      ata=\$(awk '/^PPid:/{print \$2}' /proc/\$ata/status 2>/dev/null)
      [ -z "\$ata" ] && break
    done
    [ "\$bizim" = "1" ] || continue
    APPPID=\$pid; break
  done
  if [ -z "\$APPPID" ]; then
    [ \$((gecen % 60)) -eq 0 ] && echo "bekle: \$gecen sn — hala kuruluyor (uygulama sureci yok)"
    continue
  fi
  WID=""
  for w in \$(xdotool search --onlyvisible --pid \$APPPID 2>/dev/null); do
    ad=\$(xdotool getwindowname \$w 2>/dev/null)
    gen=\$(xdotool getwindowgeometry \$w 2>/dev/null | awk '/Geometry/{split(\$2,a,"x"); print a[1]}')
    [ -n "\$ad" ] && [ "\${gen:-0}" -gt 300 ] && { WID=\$w; break; }
  done
  if [ -n "\$WID" ]; then
    echo "APPPID=\$APPPID"; echo "WID=\$WID"; echo "SURE=\$gecen"
    echo "PENCERE_ADI=\$(xdotool getwindowname \$WID)"
    exit 0
  fi
  [ \$((gecen % 60)) -eq 0 ] && echo "bekle: \$gecen sn — surec var, pencere yok"
done
echo "APPPID=\${APPPID:-}"; echo "WID="; echo "SURE=\$gecen"
exit 4
UZAKBEKLE
WID=$(grep '^WID=' "$KANIT/bekle.log" | cut -d= -f2 | tail -1)
APPPID=$(grep '^APPPID=' "$KANIT/bekle.log" | cut -d= -f2 | tail -1)
PADI=$(grep '^PENCERE_ADI=' "$KANIT/bekle.log" | cut -d= -f2- | tail -1)
SURE=$(grep '^SURE=' "$KANIT/bekle.log" | cut -d= -f2 | tail -1)
[ -n "${WID:-}" ] || red "uygulama penceresi ${BEKLE} sn icinde acilmadi ($(tail -2 "$KANIT/bekle.log" | tr '\n' ' '))"
say "pencere acildi (${SURE} sn): '$PADI' (wid=$WID) — cizim icin ${PENCERE} sn"

# ICERIK OLCUMU — konsol ise yaramaz (motor hatalari renderer devtools'una gider,
# stdout'a DEGIL: 2026-09-17 kirik pakette calisma.log 103 bayt, tek satir libva uyarisi).
# Olculen ayirt edici (ayni makine, ayni pencere boyutu):
#   kirik (yukleniyor "..." ekrani): sapma 0.020 · koyu piksel 0.00047 · renk sayisi 10
#   saglam (kitap 1/88)            : sapma 0.198 · koyu piksel 0.51    · renk sayisi 93750
# Yavas acilan paketi haksiz yere REDDETMEMEK icin olcum DENEME sayisinca tekrarlanir.
DENEME="${PROBOOK_DENEME:-4}"
GECERLI=0
for i in $(seq 1 "$DENEME"); do
  "${SSH[@]}" "bash -s" > "$KANIT/durum.txt" 2>&1 <<UZAKBETIK2
set -u
export DISPLAY=:0 XAUTHORITY=\$HOME/.Xauthority
xdotool windowactivate --sync $WID 2>/dev/null
sleep $PENCERE
# SUREC ARTIK KALIP SAYMAZ (2026-09-19 olculdu): `pgrep -c -f '[D]ijiTap/DijiTap'`
# olcum aninda 6 donuyordu ama o 6 surec AppRun'in kurulum/baslatma surecleriydi;
# gercek uygulama (~/DijiTap/<alan-adi>/<Kitap>/zkitap.bin) hic sayilmiyordu. Kapi
# bitince sayac 0'a dustu, uygulama ayaktaydi. Yanlis "surec yok" RED'i buradan
# geliyor. Dogru olcut: pencereyi acan SURECIN kendisi hala yasiyor mu?
echo "SUREC=\$(kill -0 $APPPID 2>/dev/null && echo 1 || echo 0)"
echo "PENCERE_ADI=\$(xdotool getwindowname $WID 2>/dev/null)"
echo "GEOMETRI=\$(xdotool getwindowgeometry $WID 2>/dev/null | awk '/Geometry/{print \$2}')"
import -window $WID /tmp/kabul-ekran.png 2>/dev/null && echo "EKRAN=var"
import -window root /tmp/kabul-masaustu.png 2>/dev/null
echo "SAPMA=\$(convert /tmp/kabul-ekran.png -colorspace Gray -format '%[fx:standard_deviation]' info: 2>/dev/null)"
echo "KOYU=\$(convert /tmp/kabul-ekran.png -colorspace Gray -threshold 85% -format '%[fx:1-mean]' info: 2>/dev/null)"
echo "RENK=\$(identify -format '%k' /tmp/kabul-ekran.png 2>/dev/null)"
echo "--- KONSOL"
grep -i "CONSOLE\|ERROR\|not found\|okunamad" /tmp/kabul-calisma.log 2>/dev/null | tail -10
UZAKBETIK2
  SUREC=$(grep -o 'SUREC=[0-9]*' "$KANIT/durum.txt" | cut -d= -f2 | head -1)
  SAPMA=$(grep '^SAPMA=' "$KANIT/durum.txt" | cut -d= -f2 | head -1)
  KOYU=$(grep '^KOYU=' "$KANIT/durum.txt" | cut -d= -f2 | head -1)
  RENK=$(grep '^RENK=' "$KANIT/durum.txt" | cut -d= -f2 | head -1 | tr -d ' ')
  GEO=$(grep '^GEOMETRI=' "$KANIT/durum.txt" | cut -d= -f2 | head -1)
  PADI=$(grep '^PENCERE_ADI=' "$KANIT/durum.txt" | cut -d= -f2- | head -1)
  say "olcum $i/$DENEME: surec=${SUREC:-0} pencere=${GEO:-?} sapma=${SAPMA:-?} koyu=${KOYU:-?} renk=${RENK:-?} baslik='${PADI:-}'"
  [ "${SUREC:-0}" -ge 1 ] || red "uygulama olcum aninda kapanmisti (surec yok)"
  RENK_ESIGI=500
  [ "$AKTIVASYON" = "1" ] && RENK_ESIGI=0
  GECERLI=$(awk -v s="${SAPMA:-0}" -v k="${KOYU:-0}" -v r="${RENK:-0}" -v re="$RENK_ESIGI" \
    'BEGIN{print (s+0 >= 0.05 && k+0 >= 0.005 && r+0 >= re) ? 1 : 0}')
  [ "$GECERLI" = "1" ] && break
  [ "$i" -lt "$DENEME" ] && say "  icerik henuz yok — yeniden olculecek"
done

scp -q -o ConnectTimeout=10 -o BatchMode=yes -i "$KEY" "$HOST:/tmp/kabul-ekran.png" "$KANIT/ekran.png" 2>/dev/null
scp -q -o ConnectTimeout=10 -o BatchMode=yes -i "$KEY" "$HOST:/tmp/kabul-masaustu.png" "$KANIT/masaustu.png" 2>/dev/null
scp -q -o ConnectTimeout=10 -o BatchMode=yes -i "$KEY" "$HOST:/tmp/kabul-calisma.log" "$KANIT/calisma.log" 2>/dev/null

# Beyaz ekran imzalari — K17 sinifinin konsol kaniti (nadiren stdout'a duser, yine de bak)
if grep -qi "ImWin32.dll dosyası okunamadı\|assets not found in" "$KANIT/durum.txt" "$KANIT/calisma.log" 2>/dev/null; then
  red "kok sayfa motor kopyasi gibi davraniyor (assets/ImWin32 hatasi) — SET menusu yok"
fi

if [ "$GECERLI" != "1" ]; then
  red "pencere acildi ama ICERIK YOK (sapma=${SAPMA:-?} koyu=${KOYU:-?} renk=${RENK:-?}) — beyaz/yukleniyor ekrani, kanit: $KANIT/ekran.png"
fi
[ -s "$KANIT/ekran.png" ] || say "UYARI: ekran goruntusu alinamadi (kanit eksik)"

temizle
if [ "$AKTIVASYON" = "1" ] && [ "${RENK:-0}" -lt 500 ] 2>/dev/null; then
  say "KABUL (aktivasyon ekrani): $AD — motor acildi ve kod istedi; ICERIK dogrulanmadi"
else
  say "KABUL: $AD"
fi
exit 0
