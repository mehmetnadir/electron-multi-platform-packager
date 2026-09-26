#!/bin/bash
# ProBook KABUL KAPISI — üretilen .impark gerçek Pardus makinesinde kurulup AÇILMADAN
# yüklenmez (Nadir kuralı, 2026-09-17: "her yaptığını pardus'ta aç, doğrulayıp öyle yükle").
#
# NEDEN: 2026-09-17'de 14 SET paketi aylardır beyaz ekran açıyordu; zenity/bütünlük/asar
# denetimleri HEPSİ geçiyordu çünkü hiçbiri uygulamayı AÇMIYORDU. Yalnız gerçek makinede
# açmak bu sınıfı yakalar.
#
# Kullanim: probook-kabul.sh <paket.impark | uzak:/ProBook/yolu.impark> [kanit-dizini]
#   Cikis 0 = GECTI (kurulum + acilis + kok sayfa temiz [+ E6 kitap acildi])
#         1 = RED-KUSUR (paket yuklenmemeli)
#         3 = RED-GUNCEL-DEGIL (stdout "GUNCEL-DEGIL: ..." + "yeniden kuyruk onerisi: ..."; yuklenmez)
#         4 = OLCULEMEDI (stdout "OLCULEMEDI: ..."; paket kusuru DEGIL, runner failed YAZMAZ)
# Ortam: PROBOOK_HOST (varsayilan etapadmin@100.73.161.76 — Tailscale), PROBOOK_KEY (~/.ssh/id_ed25519),
#        PROBOOK_AKTARIM (bos = eski tek scp; scp|srv21|oto → probook-aktarim.sh, sha256 iki uc),
#        PROBOOK_BEKLE (acilis icin ust sinir sn, varsayilan 300),
#        PROBOOK_PENCERE (surec gorulduikten sonra cizim payi sn, varsayilan 25)
#
# CANLI YARI (2026-09-26, rapor ~/.empp-agent/arastirma/e2e-kanit-pardus-kabul-20260926.md §B;
# Nadir: "kabul kapisi yalniz aciliyor mu diye bakmamali"). UC BAYRAK, HEPSI VARSAYILAN KAPALI —
# ProBook'ta olculmemis iki varsayim var (Electron 27 paketinde --remote-debugging-port aciliyor mu;
# ayri HOME'da ETAP cizimi ayni mi). Kapaliyken davranis birebir eskisi.
#   KABUL_CDP=1   E6 + E7: uygulama `--remote-debugging-port=<bos port, 3000 degil>` ile acilir;
#                 menu pikseli gecince cdp-kitap-ac.js ilk kitaba girer (DOM tiklamasi, xdotool YOK),
#                 okuyucu sayfa izi + kitap ekrani pikseli (ayni esikler) olculur (E6); motorun
#                 GetKitapGuncellemeBilgi cevabi yakalanir, Data doluysa cikis 3 (E7).
#                 Uzak kipte CDP ucuna ssh -L tuneliyle baglanilir. KABUL_NODE (varsayilan node),
#                 KABUL_CDP_PORT_TABAN (ProBook, 9337), KABUL_TUNEL_PORT_TABAN (Mac, 9437),
#                 KABUL_KITAP_SN (60), KABUL_E7_SN (20).
#   KABUL_AYRI_EV=1  E8: uygulama AYRI ev diziniyle kosar (HOME + XDG_CONFIG/CACHE/DATA_HOME).
#                 KABUL_CDP=1 iken VARSAYILAN ACIK: E7 yalniz ayri evde guvenilir (canli olcum 26.09,
#                 45482: gercek HOME'da K ortusu motora versiyon=36 sordurdu → yanlis GECTI; ayri evde
#                 versiyon=33 → GUNCEL-DEGIL). KABUL_CDP=1 + acikca KABUL_AYRI_EV=0 → karar OLCULEMEDI
#                 (cikis 4), ASLA GECTI.
#                 ~/.config/<ad>/work 17.09'dan kalici — eski K indirmesi ya da aktivasyon anahtari
#                 yanlis GECTI uretebilir. Ev: KABUL_EV (ProBook'ta tam yol) ya da
#                 <KABUL_EV_KOK, varsayilan ~/empp-serit/kabul-ev>/ev-<damga>; baslangicta BOS olmali.
#                 Ogretmen kurulumlari GIZLENMEZ (gizle/temizlik ev dizininde kosar). Ev dizini
#                 kanita (ortam.txt) ve stdout'a yazilir; bitiste kurulum temizlenir, kabulde
#                 indirilen K icerigi (userData/work/*) TUTULMAZ — yalniz liste + boyut + md5
#                 (work-liste.txt); geri kalan (K gunlugu, aktivasyon izi) KABUL_EV_GUN (1) gun tutulur.
#   KABUL_AKTIVASYON_OLCULEMEDI=1  aktivasyon ekraninda "ICERIK dogrulanmadi" ile GECTI yerine
#                 cikis 4 (OLCULEMEDI). Kapaliyken bugunku kural.
#
# Kurulum onbellegi tuzagi: AppRun `.empp-version` isaretine bakar; ayni surum zaten
# kuruluysa paketi ACMAZ, ESKI kurulumu calistirir -> kapi bayat paketi onaylar.
# Bu yuzden test oncesi mevcut kurulumlar GECICI olarak yeniden adlandirilir (silinmez),
# test sonunda yeni kurulum silinir ve eskiler geri konur.
set -uo pipefail
# Temizlik govdesi bu betigin yanindadir (symlink ile cagrilsa da dogru cozulsun).
BETIK_DIZIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIRDI="${1:?impark yolu (veya uzak:/yol)}"; KANIT="${2:-}"
# ADRES: varsayilan TAILSCALE (100.73.161.76), LAN (192.168.1.55) DEGIL.
# Gerekce (olculdu 2026-09-21): LAN adresi yalniz ofisten calisir. Nadir ofis disindayken
# ya da paketleyici baska agdayken kapi "ProBook'a baglanilamadi" verip isi bekletiyordu —
# 6 pardus paketi bu yuzden kuyrukta kaldi (45481/45482/45487/45541/45549/73581), oysa
# paketlerin hepsi bit duzeyinde TAM. Tailscale adresi her iki durumda da calisir:
# ayni makine, `ip -4 addr` ciktisi 192.168.1.55 + 192.168.1.241 + 100.73.161.76.
# LAN'a donmek gerekirse: PROBOOK_HOST=etapadmin@192.168.1.55 probook-kabul.sh ...
HOST="${PROBOOK_HOST:-etapadmin@100.73.161.76}"
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
# YEREL KIP (2026-09-24, ProBook şeridi plan C6): ajan ProBook'un KENDİSİNDE koşarken
# PROBOOK_HOST=yerel verilir -> ssh yerine `bash -c`, scp yok, paket yerinde açılır
# (kopyalanmaz, temizlikte SİLİNMEZ — yükleme adımı ona hâlâ muhtaç). Uzak davranış AYNEN.
YEREL=0
if [ "$HOST" = "yerel" ]; then
  YEREL=1
  SSH=(bash -c)
else
  SSH=(ssh -o ConnectTimeout=10 -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY" "$HOST")
fi
# Uzak dosyayi (ya da yerel kipte yerel dosyayi) kanit dizinine alir.
kanit_al(){
  if [ "$YEREL" = "1" ]; then cp -f "$1" "$2" 2>/dev/null
  else scp -q -o BatchMode=yes -o ConnectTimeout=10 -i "$KEY" "$HOST:$1" "$2" 2>/dev/null; fi
}
say(){ printf '[kabul] %s\n' "$*"; }
red(){ say "RED: $*"; temizle; exit 1; }
olculemedi(){ say "OLCULEMEDI: $*"; temizle; exit 4; }
# shellcheck source=kabul-karar.sh
. "$BETIK_DIZIN/kabul-karar.sh"

DAMGA=$(date +%s)
CDP="${KABUL_CDP:-0}"
# E7 YALNIZ AYRI EVDE GUVENILIR (Sef karari 26.09, canli olcum 45482): CDP acikken ayri ev varsayilan.
if [ -n "${KABUL_AYRI_EV:-}" ]; then AYRI_EV="$KABUL_AYRI_EV"; else AYRI_EV="$CDP"; fi
AKT_OLC="${KABUL_AKTIVASYON_OLCULEMEDI:-0}"
CDP_TABAN="${KABUL_CDP_PORT_TABAN:-9337}"
TUNEL_TABAN="${KABUL_TUNEL_PORT_TABAN:-9437}"
EV_GUN="${KABUL_EV_GUN:-1}"
TUNEL_PID=""
EV_HAZIR=0
EV_BUDA=0
# EV_IFADE uzak (ya da yerel) kabukta ACILIR: '$HOME' metni ProBook'un kendi ev dizinidir.
# E8 kapaliyken '$HOME' → tum yollar eskisiyle ayni (TABAN=$HOME/DijiTap, manifest $HOME/.kabul-*).
# shellcheck disable=SC2016
EV_IFADE='$HOME'
EV_ONEK=""
if [ "$AYRI_EV" = "1" ]; then
  if [ -n "${KABUL_EV:-}" ]; then
    EV_IFADE="$KABUL_EV"
  else
    EV_KOK="${KABUL_EV_KOK:-empp-serit/kabul-ev}"
    case "$EV_KOK" in /*) EV_IFADE="$EV_KOK/ev-$DAMGA-$$" ;; *) EV_IFADE="\$HOME/$EV_KOK/ev-$DAMGA-$$" ;; esac
    EV_BUDA=1
  fi
  case "$EV_IFADE" in
    *[\'\"\`\;\&\|\<\>]*|*'$('*) say "OLCULEMEDI: gecersiz kabul evi yolu: $EV_IFADE"; exit 4 ;;
  esac
  EV_ONEK="HOME=\"$EV_IFADE\" "
fi
if [ "$YEREL" = "1" ]; then
  YOL="${GIRDI#uzak:}"
  [ -f "$YOL" ] || { say "RED: paket bulunamadi: $YOL"; exit 1; }
  UZAK="$(cd "$(dirname "$YOL")" && pwd)/$(basename "$YOL")"; AD=$(basename "$UZAK"); KOPYALA=0
  [ -n "$KANIT" ] || KANIT="$(dirname "$UZAK")/probook-kabul"
elif [[ "$GIRDI" == uzak:* ]]; then
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
# Cozum (2026-09-24 surumu): gizleme, paketin kurulum hedefini (AppRun PUBLISHER/APP)
# ve kendi gizledigi dizinleri ~/.kabul-<damga>.manifest'e yazar; temizlik YALNIZ
# manifestteki yollari isler. Eski "envanterde olmayan her dizini sil" yontemi, eszamanli
# bir surecin yarattigi `Privilege Grade 11.yedek-…` dizinini sildigi icin KALDIRILDI.
# trap ile her cikis yolunda kosar. Idempotent: iki kez cagrilmasi zararsiz.
# GOVDE AYRI DOSYADA: tools/pardus/probook-temizlik.sh — sebebi test
# edilebilirlik (src/agent/probook-temizlik.test.js onu gercekten kosturur).
# 2026-09-24: temizlik YALNIZ gizlemenin yazdigi ~/.kabul-<damga>.manifest'i isler (envanter
# farki yontemi kaldirildi — eszamanli surecin .yedek- dizinini silmisti). Kilit birakma da burada.
TEMIZLENDI=0
BASLADI=0
KILIT=0
KAYNAK_AD="$(hostname 2>/dev/null || echo '?')"
kilit(){ # $1 = al|birak ; stdout: probook-kilit.sh ciktisi
  "${SSH[@]}" "bash -s '$1' '$DAMGA' '$KAYNAK_AD' '$$'" <"$BETIK_DIZIN/probook-kilit.sh" 2>&1
}
temizle(){
  [ "$TEMIZLENDI" = "1" ] && return 0
  TEMIZLENDI=1
  [ -n "$TUNEL_PID" ] && kill "$TUNEL_PID" 2>/dev/null
  # Gizlemeden ONCE cikista (mesgul/disk/kilit RED) govde kosmaz: hicbir sey degismedi.
  # E8: govde AYRI EVDE kosar (manifest, kurulum ve pkill deseni ev dizinine bagli).
  if [ "$BASLADI" = "1" ]; then
    "${SSH[@]}" "${EV_ONEK}bash -s '$DAMGA' '$KOPYALA' '$UZAK'" \
      >>"$KANIT/temizlik.log" 2>&1 <"$BETIK_DIZIN/probook-temizlik.sh"
  elif [ "$KOPYALA" = "1" ] && [ "$KILIT" = "1" ]; then
    "${SSH[@]}" "rm -f '$UZAK'" >/dev/null 2>&1
  fi
  [ "$EV_HAZIR" = "1" ] && ev_bitir
  [ "$KILIT" = "1" ] && kilit birak >>"$KANIT/temizlik.log"
  kanit_sakla
  return 0
}
# E8 BITIS: gercek ~/DijiTap + ~/.config envanteri oncesiyle ayni mi (yalitim kaniti, T3);
# kabul evi kanit olarak kalir (userData: K gunlugu, aktivasyon izi), KABUL_EV_GUN'den eski
# ev-* dizinleri budanir (yalniz turetilmis kokte; elle verilen KABUL_EV'in ustune DOKUNULMAZ).
# KABULDE INDIRILEN K ICERIGI TUTULMAZ (26.09 canli: eski paketi acan motor 290 MB indirdi):
# <ev>/.config/*/work altindaki *.log disi her dosya once WORK <md5> <bayt> <yol> olarak
# listelenir (kanit: work-liste.txt), sonra kaldirilir. Yalniz bu kosunun kendi evinde
# (EV_HAZIR, KEV != gercek HOME).
ev_bitir(){
  "${SSH[@]}" "bash -s" >"$KANIT/ev-bitis.log" 2>&1 <<UZAKEVSON
KEV="$EV_IFADE"
echo "ENVANTER_SONRA=\$( { ls -1A "\$HOME/DijiTap" "\$HOME"/DijiTap/*/ "\$HOME/.config"; } 2>/dev/null | cksum | awk '{print \$1"-"\$2}')"
if [ -n "\$KEV" ] && [ "\$KEV" != "\$HOME" ] && [ -d "\$KEV/.config" ]; then
  for w in "\$KEV"/.config/*/work; do
    [ -d "\$w" ] || continue
    find "\$w" -mindepth 1 -type f ! -name '*.log' | while IFS= read -r f; do
      s=\$(wc -c < "\$f" | tr -d ' ')
      m=\$( (md5sum "\$f" 2>/dev/null || md5 -q "\$f" 2>/dev/null) | cut -d' ' -f1)
      echo "WORK \$m \$s \${f#\$KEV/}"
    done
    find "\$w" -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} + 2>/dev/null
    find "\$w" -mindepth 1 -maxdepth 1 -type f ! -name '*.log' -exec rm -f {} + 2>/dev/null
  done
fi
echo "KABUL_EV_KB=\$(du -sk "\$KEV" 2>/dev/null | cut -f1)"
if [ "$EV_BUDA" = "1" ]; then
  find "\$(dirname "\$KEV")" -mindepth 1 -maxdepth 1 -type d -name 'ev-*' -mmin +$((EV_GUN * 1440)) -exec rm -rf {} + 2>/dev/null
fi
exit 0
UZAKEVSON
  local sonra
  sonra=$(sed -n 's/^ENVANTER_SONRA=//p' "$KANIT/ev-bitis.log" | tail -1)
  if [ -n "$sonra" ] && [ "$sonra" = "${ENVANTER_ONCE:-}" ]; then
    echo "E8_ENVANTER=ayni ($sonra)" >> "$KANIT/ortam.txt"
    say "E8: gercek ~/DijiTap + ~/.config envanteri degismedi"
  else
    echo "E8_ENVANTER=DEGISTI (once=${ENVANTER_ONCE:-?} sonra=${sonra:-?})" >> "$KANIT/ortam.txt"
    say "UYARI: E8 gercek ~/DijiTap + ~/.config envanteri degisti (once=${ENVANTER_ONCE:-?} sonra=${sonra:-?})"
  fi
  echo "KABUL_EV_KB=$(sed -n 's/^KABUL_EV_KB=//p' "$KANIT/ev-bitis.log" | tail -1)" >> "$KANIT/ortam.txt"
  local n b
  sed -n 's/^WORK //p' "$KANIT/ev-bitis.log" > "$KANIT/work-liste.txt"
  grep -v '^WORK ' "$KANIT/ev-bitis.log" > "$KANIT/ev-bitis.tmp" && mv -f "$KANIT/ev-bitis.tmp" "$KANIT/ev-bitis.log"
  n=$(wc -l < "$KANIT/work-liste.txt" | tr -d ' ')
  b=$(awk '{t += $2} END {print t + 0}' "$KANIT/work-liste.txt")
  echo "WORK_INDIRILEN=$n dosya, $b B (icerik tutulmadi; liste+boyut+md5: work-liste.txt)" >> "$KANIT/ortam.txt"
  [ "${n:-0}" -gt 0 ] && say "E8: kabulde indirilen K icerigi $n dosya / $((b / 1048576)) MB — tutulmadi (liste+boyut+md5: work-liste.txt)"
  return 0
}
# KANIT ARŞİVİ (plan B.1, 2026-09-26): runner iş sonunda çalışma dizinini — kanıt dahil — siler.
# EMPP_KANIT_ARSIV verilirse (ProBook şeridi: ~/empp-serit/kanit) kanıt oraya kopyalanır ve
# 14 günden eski kanıt dizinleri kaldırılır. Verilmezse davranış eskisi gibi.
kanit_sakla(){
  [ -n "${EMPP_KANIT_ARSIV:-}" ] || return 0
  local h="$EMPP_KANIT_ARSIV/kabul-$(date +%Y%m%d-%H%M%S)-$DAMGA"
  mkdir -p "$h" && cp -a "$KANIT"/. "$h"/ 2>/dev/null
  printf 'paket=%s\nboyut=%s\n' "$GIRDI" "${BOYUT:-?}" > "$h/paket.txt"
  find "$EMPP_KANIT_ARSIV" -mindepth 1 -maxdepth 1 -type d -name 'kabul-*' -mtime +"${EMPP_KANIT_GUN:-14}" \
    -exec rm -rf {} + 2>/dev/null
  return 0
}
trap 'temizle' EXIT

# ORTAK KILIT (uzak + yerel kapi ayni ~/.kabul.lock; bkz. probook-kilit.sh). Bekleme tavani
# ajanin kapi zaman asimindan (Mac 8 dk) uzun: once ajan zaman asimi olur → "ertelenebilir".
BOSLUK_TAVAN="${KABUL_BOSLUK_TAVAN:-1800}"
BOSLUK_ARALIK="${KABUL_BOSLUK_ARALIK:-15}"

if [ "$YEREL" = "1" ]; then
  # BOŞLUK BEKLE (yerel kip): ProBook'u başka kapılar da kullanıyor (Mac/Tudem ajanlarının
  # UZAK kabulü, elle açılmış DijiTap uygulaması). Kapı betikleri /tmp'de SABİT adlar
  # kullanıyor (kabul-baslatan.pid, kabul-calisma.log) — iki kapı aynı anda koşarsa
  # birbirinin sürecini/ekranını ölçer. Uzak kabulün ProBook'taki izi: gizle ile temizlik
  # arasında yaşayan /tmp/kabul-onceki-<damga>.txt. Kendi süreç grubumuz sayılmaz.
  ISARET_DIZIN="${KABUL_ISARET_DIZIN:-/tmp}"
  KENDI_GRUP=$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')
  mesgul_sebep(){
    local f p g
    for f in "$ISARET_DIZIN"/kabul-onceki-*.txt; do
      [ -e "$f" ] || continue
      # 60 dk'dan eski işaret yetim sayılır (çökmüş kapı) — sonsuz bekleme yok.
      [ -n "$(find "$f" -mmin -60 2>/dev/null)" ] && { echo "baska kabul suruyor ($(basename "$f"))"; return 0; }
    done
    # UZAK kabulün ilk izi scp ile gelen /tmp/kabul-<damga>.impark (gizle ondan SONRA koşar;
    # 2026-09-24 ölçüldü: yerel kabul biterken başka ajanın 1,9 GB kopyası iniyordu).
    for f in "$ISARET_DIZIN"/kabul-*.impark; do
      [ -e "$f" ] || continue
      [ -n "$(find "$f" -mmin -60 2>/dev/null)" ] && { echo "uzak kabul paketi aktariliyor/test ediliyor ($(basename "$f"))"; return 0; }
    done
    for p in $(pgrep -f "${KABUL_SUREC_DESENI:-[p]robook-kabul[.]sh}" 2>/dev/null); do
      g=$(ps -o pgid= -p "$p" 2>/dev/null | tr -d ' ')
      [ -n "$g" ] && [ "$g" != "$KENDI_GRUP" ] && { echo "baska probook-kabul sureci (pid $p)"; return 0; }
    done
    p=$(pgrep -f "$HOME/[D]ijiTap/" 2>/dev/null | head -1)
    [ -n "$p" ] && { echo "DijiTap uygulamasi acik (pid $p)"; return 0; }
    return 1
  }
  # Once KILIT, sonra kilit disi izler (eski surum kapi isaretleri, elle acik uygulama).
  kilit_ve_bosluk(){
    local c
    c=$(kilit al) || { echo "kabul kilidi: ${c##*KILIT_MESGUL }"; return 0; }
    KILIT=1
    if SEBEP2=$(mesgul_sebep); then kilit birak >/dev/null; KILIT=0; echo "$SEBEP2"; return 0; fi
    return 1
  }
  BEKLENEN=0
  while SEBEP=$(kilit_ve_bosluk); do
    [ "$BEKLENEN" -ge "$BOSLUK_TAVAN" ] && { say "RED: ProBook mesgul, ${BOSLUK_TAVAN} sn bosalmadi: $SEBEP"; exit 1; }
    [ $((BEKLENEN % 60)) -eq 0 ] && say "ProBook mesgul, bekleniyor: $SEBEP"
    sleep "$BOSLUK_ARALIK"; BEKLENEN=$((BEKLENEN + BOSLUK_ARALIK))
  done
  KILIT=1  # donguden SEBEP'siz cikis = kilit alindi (alt kabukta set edildigi icin burada da)
  [ "$BEKLENEN" -gt 0 ] && say "ProBook bosaldi (${BEKLENEN} sn beklendi)"
  # Disk kapisi: kopya YOK, yalniz ~/DijiTap altina acilis (~1,5 kat) + 2 GB pay.
  BOYUT=$(stat -c%s "$UZAK" 2>/dev/null || stat -f%z "$UZAK")
  GEREKLI_MB=$(( BOYUT / 1000000 * 15 / 10 + 2000 ))
  BOS_MB=$(df -Pk "$HOME" | awk 'NR==2{print int($4/1024)}')
  if [ -n "$BOS_MB" ] && [ "$BOS_MB" -lt "$GEREKLI_MB" ]; then
    say "RED: ProBook diskinde yer yok (${BOS_MB} MB bos < ${GEREKLI_MB} MB gerekli)"
    exit 1
  fi
  say "yerel kip: $AD ($((BOYUT/1000000)) MB), disk ${BOS_MB:-?} MB bos (gerekli ~${GEREKLI_MB} MB)"
  OLCEKLI=$(( ${PROBOOK_BEKLE_TABAN:-300} + BOYUT / 1000000 / 2 ))
  [ "$OLCEKLI" -gt "$BEKLE" ] && { say "acilis ust siniri buyutuldu: ${BEKLE} -> ${OLCEKLI} sn"; BEKLE="$OLCEKLI"; }
else
  command -v ssh >/dev/null || { say "RED: ssh yok"; exit 1; }
  "${SSH[@]}" 'echo hazir' >/dev/null 2>&1 || { say "RED: ProBook'a baglanilamadi ($HOST)"; exit 1; }
  BEKLENEN=0
  until C=$(kilit al); do
    [ "$BEKLENEN" -ge "$BOSLUK_TAVAN" ] && { say "RED: ProBook mesgul, ${BOSLUK_TAVAN} sn bosalmadi: kabul kilidi ${C##*KILIT_MESGUL }"; exit 1; }
    [ $((BEKLENEN % 60)) -eq 0 ] && say "ProBook mesgul (kabul kilidi: ${C##*KILIT_MESGUL }), bekleniyor"
    sleep "$BOSLUK_ARALIK"; BEKLENEN=$((BEKLENEN + BOSLUK_ARALIK))
  done
  KILIT=1
  [ "$BEKLENEN" -gt 0 ] && say "ProBook bosaldi (${BEKLENEN} sn beklendi)"
fi

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
  if [ -n "${PROBOOK_AKTARIM:-}" ]; then
    # AKTARIM YOLU (2026-09-26, olcumle; varsayilan KAPALI): evden Tailscale rolesi ~240 kB/s,
    # srv21 atlamasi ~1400 kB/s. Govde + olcum tablosu: tools/pardus/probook-aktarim.sh.
    # Hangi yol secilirse secilsin sha256 Mac + ProBook'ta alinir; eslesmezse RED (test edilen
    # bayt = yayinlanacak bayt). Kanit: $KANIT/aktarim.txt.
    # shellcheck source=probook-aktarim.sh
    . "$BETIK_DIZIN/probook-aktarim.sh"
    probook_aktar "$GIRDI" "$UZAK" "$KANIT"; AKT_RC=$?
    [ "$AKT_RC" = 2 ] && { say "RED: aktarim dogrulanamadi (sha256 Mac != ProBook)"; exit 1; }
    [ "$AKT_RC" = 0 ] || { say "RED: kopyalanamadi"; exit 1; }
  else
    scp -q -o ConnectTimeout=10 -o BatchMode=yes -i "$KEY" "$GIRDI" "$HOST:$UZAK" \
      || { say "RED: kopyalanamadi"; exit 1; }
  fi
fi

{
  echo "CDP=$CDP"
  echo "KABUL_AYRI_EV=$AYRI_EV"
  echo "AKTIVASYON=$AKTIVASYON KABUL_AKTIVASYON_OLCULEMEDI=$AKT_OLC"
} > "$KANIT/ortam.txt"
# E8 HAZIRLIK: ayri ev dizini BOS olmali (eski K indirmesi / aktivasyon anahtari tasimasin).
# Gercek ~/DijiTap + ~/.config envanterinin parmak izi alinir; bitiste (ev_bitir) kiyaslanir.
if [ "$AYRI_EV" = "1" ]; then
  "${SSH[@]}" "bash -s" > "$KANIT/ev.log" 2>&1 <<UZAKEV
set -u
KEV="$EV_IFADE"
if [ -e "\$KEV" ] && [ -n "\$(ls -A "\$KEV" 2>/dev/null)" ]; then echo "EV_DOLU=\$KEV"; exit 5; fi
mkdir -p "\$KEV/.config" "\$KEV/.cache" "\$KEV/.local/share" || { echo "EV_KURULAMADI=\$KEV"; exit 6; }
echo "KABUL_EV=\$KEV"
echo "ENVANTER_ONCE=\$( { ls -1A "\$HOME/DijiTap" "\$HOME"/DijiTap/*/ "\$HOME/.config"; } 2>/dev/null | cksum | awk '{print \$1"-"\$2}')"
UZAKEV
  KEV_GERCEK=$(sed -n 's/^KABUL_EV=//p' "$KANIT/ev.log" | tail -1)
  ENVANTER_ONCE=$(sed -n 's/^ENVANTER_ONCE=//p' "$KANIT/ev.log" | tail -1)
  if grep -q '^EV_DOLU=' "$KANIT/ev.log"; then
    olculemedi "E8 kabul evi bos degil: $(sed -n 's/^EV_DOLU=//p' "$KANIT/ev.log" | tail -1) — eski veri yanlis GECTI uretebilir"
  fi
  [ -n "$KEV_GERCEK" ] || olculemedi "E8 kabul evi kurulamadi ($(tail -1 "$KANIT/ev.log"))"
  EV_HAZIR=1
  {
    echo "KABUL_EV=$KEV_GERCEK"
    echo "XDG_CONFIG_HOME=$KEV_GERCEK/.config"
    echo "XDG_CACHE_HOME=$KEV_GERCEK/.cache"
    echo "XDG_DATA_HOME=$KEV_GERCEK/.local/share"
    echo "ENVANTER_ONCE=$ENVANTER_ONCE"
  } >> "$KANIT/ortam.txt"
  say "E8: ayri ev dizini: $KEV_GERCEK (ogretmen kurulumlari gizlenmez)"
  say "paket ayri evde baslatiliyor"
else
  echo "KABUL_EV=yok (gercek HOME; E8 kapali)" >> "$KANIT/ortam.txt"
  [ "$CDP" = "1" ] && say "UYARI: KABUL_AYRI_EV=0 — uygulama GERCEK HOME ile acilacak; E7 guvenilmez, karar OLCULEMEDI olur"
  say "eski kurulumlar gizleniyor + paket baslatiliyor"
fi
BASLADI=1
# GIZLEME GOVDESI AYRI DOSYADA (2026-09-19): iki kurulum kokunu de gezer ve
# envanteri /tmp/kabul-onceki-<damga>.txt'ye yazar; temizlik ayni dosyayi okur.
# Gerekcesi ve kanitlari: tools/pardus/probook-gizle.sh basligi.
# E8: ayni govde AYRI EVDE kosar → gizlenecek bir sey yok, yalniz manifest + KURULUM hedefi.
"${SSH[@]}" "${EV_ONEK}bash -s '$DAMGA' '$UZAK' '${KABUL_HEDEF:-}'" > "$KANIT/baslat.log" 2>&1 <"$BETIK_DIZIN/probook-gizle.sh" \
  || { say "RED: gizleme adimi basarisiz"; exit 1; }

# CDP PORTU (E6/E7): ProBook'ta bos ilk port (3000 YASAK). Bulunamazsa uygulama bayraksiz acilir,
# E6 OLCULEMEDI olur. Eski surec portu tutuyorsa (Windows kabulu dersi 4) o port atlanir.
"${SSH[@]}" "bash -s" >> "$KANIT/baslat.log" 2>&1 <<UZAKBETIK
set -u
UZAK="$UZAK"
KEV="$EV_IFADE"
[ -f "\$UZAK" ] || { echo "HATA: uzak paket yok: \$UZAK"; exit 3; }
chmod +x "\$UZAK"
CDP_PORT=""
if [ "$CDP" = "1" ]; then
  for p in \$(seq $CDP_TABAN $((CDP_TABAN + 40))); do
    [ "\$p" = 3000 ] && continue
    (exec 3<>"/dev/tcp/127.0.0.1/\$p") 2>/dev/null && continue
    CDP_PORT=\$p; break
  done
  echo "CDP_PORT=\$CDP_PORT"
fi
: > /tmp/kabul-calisma.log
if [ "$AYRI_EV" = "1" ]; then
  setsid env DISPLAY=:0 XAUTHORITY=\$HOME/.Xauthority HOME="\$KEV" XDG_CONFIG_HOME="\$KEV/.config" \
    XDG_CACHE_HOME="\$KEV/.cache" XDG_DATA_HOME="\$KEV/.local/share" \
    "\$UZAK" \${CDP_PORT:+--remote-debugging-port=\$CDP_PORT} > /tmp/kabul-calisma.log 2>&1 < /dev/null &
else
  setsid env DISPLAY=:0 XAUTHORITY=\$HOME/.Xauthority "\$UZAK" \${CDP_PORT:+--remote-debugging-port=\$CDP_PORT} > /tmp/kabul-calisma.log 2>&1 < /dev/null &
fi
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
# E8: kok AYRI EVDEDIR (KEV); E8 kapaliyken KEV=\$HOME, yol eskisiyle ayni.
KEV="$EV_IFADE"
TABAN="\$KEV/DijiTap"
echo "TABAN=\$TABAN"
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
    APPPID=\$pid
    # Hedef AppRun'dan okunamadiysa (manifestte KURULUM yok): BIZIM baslattigimiz surecin
    # kurulum dizini bu kosunundur — ONCEKI listesindeyse degildir, yazilmaz.
    MAN="\$KEV/.kabul-$DAMGA.manifest"
    if [ -f "\$MAN" ] && ! grep -q '^KURULUM ' "\$MAN"; then
      rel=\${exe#\$TABAN/}; kok=\${rel%%/*}; r2=\${rel#*/}; ad=\${r2%%/*}
      if [ -n "\$kok" ] && [ -n "\$ad" ] && [ "\$kok" != "\$rel" ] && ! grep -Fxq "ONCEKI \$kok/\$ad" "\$MAN"; then
        echo "KURULUM \$kok/\$ad" >> "\$MAN"; echo "manifest: KURULUM \$kok/\$ad (surecin yolundan)"
      fi
    fi
    break
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
EV_KULLANILAN=$(sed -n 's/^TABAN=//p' "$KANIT/bekle.log" | tail -1)
EV_KULLANILAN="${EV_KULLANILAN%/DijiTap}"
echo "EV_KULLANILAN=${EV_KULLANILAN:-?} ($([ "$AYRI_EV" = "1" ] && echo ayri || echo 'GERCEK HOME'))" >> "$KANIT/ortam.txt"
[ -n "${WID:-}" ] || red "uygulama penceresi ${BEKLE} sn icinde acilmadi ($(tail -2 "$KANIT/bekle.log" | tr '\n' ' '))"
say "pencere acildi (${SURE} sn): '$PADI' (wid=$WID) — cizim icin ${PENCERE} sn"

# ICERIK OLCUMU — konsol ise yaramaz (motor hatalari renderer devtools'una gider,
# stdout'a DEGIL: 2026-09-17 kirik pakette calisma.log 103 bayt, tek satir libva uyarisi).
# Olculen ayirt edici (ayni makine, ayni pencere boyutu):
#   kirik (yukleniyor "..." ekrani): sapma 0.020 · koyu piksel 0.00047 · renk sayisi 10
#   saglam (kitap 1/88)            : sapma 0.198 · koyu piksel 0.51    · renk sayisi 93750
# Yavas acilan paketi haksiz yere REDDETMEMEK icin olcum DENEME sayisinca tekrarlanir.
# PENCERE OLCUMU (menu ve — E6 — kitap ekrani AYNI olcut). $1 = dosya eki ("" | "-kitap"),
# $2 = cizim payi sn. Cikti: $KANIT/durum$1.txt + SUREC/SAPMA/KOYU/RENK/GEO/PADI degiskenleri.
pencere_olc(){
  local ek="$1" sn="$2"
  "${SSH[@]}" "bash -s" > "$KANIT/durum$ek.txt" 2>&1 <<UZAKBETIK2
set -u
export DISPLAY=:0 XAUTHORITY=\$HOME/.Xauthority
xdotool windowactivate --sync $WID 2>/dev/null
sleep $sn
# SUREC ARTIK KALIP SAYMAZ (2026-09-19 olculdu): `pgrep -c -f '[D]ijiTap/DijiTap'`
# olcum aninda 6 donuyordu ama o 6 surec AppRun'in kurulum/baslatma surecleriydi;
# gercek uygulama (~/DijiTap/<alan-adi>/<Kitap>/zkitap.bin) hic sayilmiyordu. Kapi
# bitince sayac 0'a dustu, uygulama ayaktaydi. Yanlis "surec yok" RED'i buradan
# geliyor. Dogru olcut: pencereyi acan SURECIN kendisi hala yasiyor mu?
echo "SUREC=\$(kill -0 $APPPID 2>/dev/null && echo 1 || echo 0)"
echo "PENCERE_ADI=\$(xdotool getwindowname $WID 2>/dev/null)"
echo "GEOMETRI=\$(xdotool getwindowgeometry $WID 2>/dev/null | awk '/Geometry/{print \$2}')"
import -window $WID /tmp/kabul-ekran$ek.png 2>/dev/null && echo "EKRAN=var"
import -window root /tmp/kabul-masaustu$ek.png 2>/dev/null
echo "SAPMA=\$(convert /tmp/kabul-ekran$ek.png -colorspace Gray -format '%[fx:standard_deviation]' info: 2>/dev/null)"
echo "KOYU=\$(convert /tmp/kabul-ekran$ek.png -colorspace Gray -threshold 85% -format '%[fx:1-mean]' info: 2>/dev/null)"
echo "RENK=\$(identify -format '%k' /tmp/kabul-ekran$ek.png 2>/dev/null)"
echo "--- KONSOL"
grep -i "CONSOLE\|ERROR\|not found\|okunamad" /tmp/kabul-calisma.log 2>/dev/null | tail -10
UZAKBETIK2
  SUREC=$(grep -o 'SUREC=[0-9]*' "$KANIT/durum$ek.txt" | cut -d= -f2 | head -1)
  SAPMA=$(grep '^SAPMA=' "$KANIT/durum$ek.txt" | cut -d= -f2 | head -1)
  KOYU=$(grep '^KOYU=' "$KANIT/durum$ek.txt" | cut -d= -f2 | head -1)
  RENK=$(grep '^RENK=' "$KANIT/durum$ek.txt" | cut -d= -f2 | head -1 | tr -d ' ')
  GEO=$(grep '^GEOMETRI=' "$KANIT/durum$ek.txt" | cut -d= -f2 | head -1)
  PADI=$(grep '^PENCERE_ADI=' "$KANIT/durum$ek.txt" | cut -d= -f2- | head -1)
}
# Esikler probook ile olcutler.js'te AYNI: sapma >= 0.05, koyu >= 0.005, renk >= 500 (aktivasyonda 0).
piksel_gecerli(){
  local RENK_ESIGI=500
  [ "$AKTIVASYON" = "1" ] && RENK_ESIGI=0
  awk -v s="${SAPMA:-0}" -v k="${KOYU:-0}" -v r="${RENK:-0}" -v re="$RENK_ESIGI" \
    'BEGIN{print (s+0 >= 0.05 && k+0 >= 0.005 && r+0 >= re) ? 1 : 0}'
}

DENEME="${PROBOOK_DENEME:-4}"
GECERLI=0
for i in $(seq 1 "$DENEME"); do
  pencere_olc "" "$PENCERE"
  say "olcum $i/$DENEME: surec=${SUREC:-0} pencere=${GEO:-?} sapma=${SAPMA:-?} koyu=${KOYU:-?} renk=${RENK:-?} baslik='${PADI:-}'"
  [ "${SUREC:-0}" -ge 1 ] || red "uygulama olcum aninda kapanmisti (surec yok)"
  GECERLI=$(piksel_gecerli)
  [ "$GECERLI" = "1" ] && break
  [ "$i" -lt "$DENEME" ] && say "  icerik henuz yok — yeniden olculecek"
done

kanit_al /tmp/kabul-ekran.png "$KANIT/ekran.png"
kanit_al /tmp/kabul-masaustu.png "$KANIT/masaustu.png"
kanit_al /tmp/kabul-calisma.log "$KANIT/calisma.log"

# Beyaz ekran imzalari — K17 sinifinin konsol kaniti (nadiren stdout'a duser, yine de bak)
if grep -qi "ImWin32.dll dosyası okunamadı\|assets not found in" "$KANIT/durum.txt" "$KANIT/calisma.log" 2>/dev/null; then
  red "kok sayfa motor kopyasi gibi davraniyor (assets/ImWin32 hatasi) — SET menusu yok"
fi

if [ "$GECERLI" != "1" ]; then
  red "pencere acildi ama ICERIK YOK (sapma=${SAPMA:-?} koyu=${KOYU:-?} renk=${RENK:-?}) — beyaz/yukleniyor ekrani, kanit: $KANIT/ekran.png"
fi
[ -s "$KANIT/ekran.png" ] || say "UYARI: ekran goruntusu alinamadi (kanit eksik)"

# ---------------------------------------------------------------------------------------------
# E6/E7 (KABUL_CDP=1): ilk kitaba gir, motorun guncelleme sorusunu yakala. Aktivasyon ekraninda
# kitap acilamaz (diyalog) — atlanir, karar kabul_karar'da (KABUL_AKTIVASYON_OLCULEMEDI).
# ---------------------------------------------------------------------------------------------
AKT_SERI="$AKTIVASYON"
AKT_EKRAN=0
if [ "$AKTIVASYON" = "1" ] && [ "${RENK:-0}" -lt 500 ] 2>/dev/null; then AKT_EKRAN=1; fi
M_RENK="${RENK:-0}"
E6=ATLANDI; E6_SEBEP=""; E6_URL=""; E7=ATLANDI; E7_AYRINTI=""; E7_ONERI=""

# Uzak kipte ProBook'taki CDP portuna ssh -L; yerel kipte dogrudan. Istemci BU makinede kosar
# (Mac'te depo + node var; ProBook seridinde ~/empp-serit/repo + node 22).
cdp_olc(){
  local yp="" koku p
  CDP_PORT=$(sed -n 's/^CDP_PORT=//p' "$KANIT/baslat.log" | tail -1)
  koku=$(sed -n 's/^TABAN=//p' "$KANIT/bekle.log" | tail -1)
  echo "CDP_PORT=${CDP_PORT:-yok}" >> "$KANIT/ortam.txt"
  if [ -z "$CDP_PORT" ]; then
    E6=OLCULEMEDI; E6_SEBEP="ProBook'ta bos CDP portu bulunamadi (taban $CDP_TABAN)"; E7=OLCULEMEDI
    return 0
  fi
  if [ "$YEREL" = "1" ]; then
    yp="$CDP_PORT"
  else
    for p in $(seq "$TUNEL_TABAN" $((TUNEL_TABAN + 40))); do
      [ "$p" = 3000 ] && continue
      (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null && continue
      ssh -N -o ExitOnForwardFailure=yes -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -i "$KEY" \
        -L "127.0.0.1:$p:127.0.0.1:$CDP_PORT" "$HOST" >>"$KANIT/cdp.log" 2>&1 &
      TUNEL_PID=$!
      sleep 2
      if kill -0 "$TUNEL_PID" 2>/dev/null; then yp="$p"; break; fi
      TUNEL_PID=""
    done
    if [ -z "$yp" ]; then
      E6=OLCULEMEDI; E6_SEBEP="CDP tuneli kurulamadi (ssh -L, taban $TUNEL_TABAN)"; E7=OLCULEMEDI
      return 0
    fi
  fi
  say "E6/E7: CDP ProBook:$CDP_PORT (baglanti 127.0.0.1:$yp) — ilk kitaba giriliyor"
  "${KABUL_NODE:-node}" "$BETIK_DIZIN/cdp-kitap-ac.js" --port "$yp" --kanit "$KANIT" --kurulum-koku "$koku" \
    --kitap-sn "${KABUL_KITAP_SN:-60}" --e7-sn "${KABUL_E7_SN:-20}" > "$KANIT/cdp.txt" 2>>"$KANIT/cdp.log"
  E6=$(sed -n 's/^E6=//p' "$KANIT/cdp.txt" | tail -1)
  E6_SEBEP=$(sed -n 's/^E6_SEBEP=//p' "$KANIT/cdp.txt" | tail -1)
  E6_URL=$(sed -n 's/^E6_URL=//p' "$KANIT/cdp.txt" | tail -1)
  E7=$(sed -n 's/^E7=//p' "$KANIT/cdp.txt" | tail -1)
  E7_AYRINTI=$(sed -n 's/^E7_AYRINTI=//p' "$KANIT/cdp.txt" | tail -1)
  E7_ONERI=$(sed -n 's/^E7_ONERI=//p' "$KANIT/cdp.txt" | tail -1)
  if [ -z "$E6" ]; then
    E6=OLCULEMEDI; E6_SEBEP="CDP istemcisi sonuc vermedi ($(tail -1 "$KANIT/cdp.log" 2>/dev/null))"
  fi
  [ -n "$E7" ] || E7=OLCULEMEDI
  [ "$(sed -n 's/^CDP_HEDEF_ESLESTI=//p' "$KANIT/cdp.txt" | tail -1)" = "0" ] \
    && say "UYARI: CDP hedefi kurulum kokunde degil ($(sed -n 's/^CDP_HEDEF=//p' "$KANIT/cdp.txt" | tail -1))"
  if [ -n "$TUNEL_PID" ]; then kill "$TUNEL_PID" 2>/dev/null; TUNEL_PID=""; fi
  return 0
}

if [ "$CDP" = "1" ] && [ "$AKT_EKRAN" = "0" ]; then
  cdp_olc
  say "E6: $E6 — ${E6_SEBEP:-}${E6_URL:+ (url=$E6_URL)}"
  if [ "$E6" = "GECTI" ]; then
    # Kitap ekrani AYNI piksel olcutuyle (ImageMagick, ayni esikler): CDP ek kanittir.
    KGECERLI=0
    for i in 1 2; do
      pencere_olc "-kitap" "${KABUL_KITAP_CIZIM:-3}"
      say "E6 kitap olcumu $i/2: surec=${SUREC:-0} sapma=${SAPMA:-?} koyu=${KOYU:-?} renk=${RENK:-?}"
      if [ "${SUREC:-0}" -lt 1 ]; then E6=RED; E6_SEBEP="uygulama kitap acildiktan sonra kapandi (surec yok)"; break; fi
      KGECERLI=$(piksel_gecerli)
      [ "$KGECERLI" = "1" ] && break
    done
    kanit_al /tmp/kabul-ekran-kitap.png "$KANIT/kitap.png"
    if [ "$E6" = "GECTI" ] && [ "$KGECERLI" != "1" ]; then
      E6=RED; E6_SEBEP="kitap acildi (${E6_URL:-?}) ama ekranda ICERIK YOK (sapma=${SAPMA:-?} koyu=${KOYU:-?} renk=${RENK:-?})"
    fi
  fi
  say "E7: $E7 — ${E7_AYRINTI:-}"
  kanit_al /tmp/kabul-calisma.log "$KANIT/calisma.log"
elif [ "$CDP" = "1" ]; then
  say "E6/E7: aktivasyon ekrani (renk=$M_RENK) — kitap acilamaz, atlandi"
fi
# K uzlasmasi kor mu (73581 dersi): paketin kendi guncelleme uzlasmasi calismiyor → UYARI, karar degil.
if grep -q "menü çözülemedi" "$KANIT/calisma.log" 2>/dev/null; then
  say "UYARI: K bu pakette kor (empp-icerik: menu cozulemedi — kitap guncelleme uzlasmasi calismiyor)"
fi

kabul_karar
{
  echo "E6=$E6"; echo "E6_SEBEP=$E6_SEBEP"; echo "E7=$E7"; echo "E7_AYRINTI=$E7_AYRINTI"
  echo "KARAR=$KARAR ($KARAR_KOD)"; echo "KARAR_SEBEP=$KARAR_SEBEP"
} >> "$KANIT/ortam.txt"
temizle
[ -n "$KARAR_NOT" ] && say "not: $KARAR_NOT"
say "kullanilan ev: ${EV_KULLANILAN:-?} ($([ "$AYRI_EV" = "1" ] && echo ayri || echo 'GERCEK HOME'))"
case "$KARAR_KOD" in
  0)
    if [ "$AKT_EKRAN" = "1" ]; then
      say "KABUL (aktivasyon ekrani): $AD — motor acildi ve kod istedi; ICERIK dogrulanmadi"
    else
      [ "$CDP" = "1" ] && say "kabul dayanagi: $KARAR_SEBEP"
      say "KABUL: $AD"
    fi
    exit 0 ;;
  3)
    say "GUNCEL-DEGIL: $KARAR_SEBEP"
    say "yeniden kuyruk onerisi: ${E7_ONERI:-kaynak yenilenince yeniden kuyruga al}"
    exit 3 ;;
  4)
    say "OLCULEMEDI: $KARAR_SEBEP"
    exit 4 ;;
  *)
    say "RED: $KARAR_SEBEP"
    exit 1 ;;
esac
