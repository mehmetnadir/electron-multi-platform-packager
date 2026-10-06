#!/bin/bash
# ProBook (Pardus) DİSK TEMİZLİK BEKÇİSİ — "disk dolu → işi durdurma, yer aç" (Nadir 06.10).
#
# Kural: ProBook'ta disk dar diye üretim/kabul/kurulum DURMAZ. Boş alan hedefin altındaysa BİZİM
# ürettiğimiz/indirdiğimiz dosyalar EN ESKİDEN başlayarak silinir; hedefe ulaşınca durulur.
# Silme yalnız bu makinede (ve windows-kasa'da) serbesttir — Mac ve srv21'de bu betik KOŞMAZ
# (runner yardımcısı src/agent/disk-temizlik.js yalnız linux'ta çağırır; Mac'te uname ile reddeder).
#
# Kullanım:
#   disk-temizlik.sh [--kuru] [--ek <yol>]... [--hedef-gb N] [--hedef-yuzde N] [--zamanlayici-kur]
#   --kuru              yalnız listele (silme yok); günlüğe KURU satırı yazar
#   --ek <yol>          kullanıcının AÇIKÇA verdiği yol: hedefe bakılmadan silinir (koruma + kullanımda
#                       denetimi yine geçerli; $HOME altında olmalı)
#   --hedef-gb N        boş alan hedefi GB (vars. 50; runner kapının gerekli GB'sini geçer)
#   --hedef-yuzde N     boş alan hedefi % (vars. 25)
#   --zamanlayici-kur   kendini ~/empp-serit/araclar/'a kopyalar, systemd --user saatlik zamanlayıcıyı
#                       kurar/yeniler (empp-disk-temizlik.timer) ve çıkar
# Çıkış: 0 hedef sağlandı · 3 tüm adaylar bitti ama hâlâ dar · 2 kullanım hatası · 4 kilit dolu
# Son satır: SONUC bos_gb=.. bos_yuzde=.. silinen_mb=.. kalem=.. atlanan=.. hedef=tamam|dar
#
# SIRA (katman içinde en eski önce — ağacın EN YENİ mtime'ı ölçülür: "en son dokunulan"):
#   K1 test/deneme/paket artığı: ~/testler/*, ~/Silinecekler/*, *kabuk*aday*, İndirilenler/Downloads
#      paketleri, ~/DijiTap/*/* (test kurulumları), empp-serit kabul-ev/out/work artıkları, *.kaldirildi-*,
#      yedek-*, /tmp/kabul-*.impark
#   K2 önbellek/kanıt: icerik-onbellek/<id>, kabul-kanit/* (KANIT_GUN=7 günden eski)
#   K3 SON ÇARE kaynak-arsivi/<id>: Mac otoritesinin kopyası; silinince özet farkı → arsiv-esle yeniden
#      eşler (bu sırada ProBook duraklatılabilir). Bu yüzden en sona kalır.
# KORUMA (her aday için): koruma listesi (jeton, yapılandırma, repo/node/opt, windows-hazir…);
#   bir sürecin cwd/exe/açık dosyası/komut satırı yolu adayın altındaysa ATLA; ağaçta son
#   DT_KORU_DK (120) dk içinde değişen dosya varsa ATLA (--ek hariç). Belirsizse SİLME.
# Günlük: ~/empp-serit/log/disk-temizlik.log — tarih · yol · boyut · neden.
# Test: src/agent/disk-temizlik.test.js — sahte $HOME + DT_DF ("toplam_kb bos_kb") + DT_KULLANIMDA.
set -u

KURU=0
HEDEF_GB="${DT_HEDEF_GB:-50}"
HEDEF_YUZDE="${DT_HEDEF_YUZDE:-25}"
KORU_DK="${DT_KORU_DK:-120}"
KANIT_GUN="${DT_KANIT_GUN:-7}"
ZKUR=0
EKLER=(); EK_SAYI=0
while [ $# -gt 0 ]; do case "$1" in
  --kuru) KURU=1; shift ;;
  --ek) [ $# -ge 2 ] || { echo "--ek yol ister" >&2; exit 2; }; EKLER+=("$2"); EK_SAYI=$((EK_SAYI + 1)); shift 2 ;;
  --hedef-gb) [ $# -ge 2 ] || exit 2; HEDEF_GB="$2"; shift 2 ;;
  --hedef-yuzde) [ $# -ge 2 ] || exit 2; HEDEF_YUZDE="$2"; shift 2 ;;
  --zamanlayici-kur) ZKUR=1; shift ;;
  *) echo "bilinmeyen: $1" >&2; exit 2 ;;
esac; done
for s in "$HEDEF_GB" "$HEDEF_YUZDE" "$KORU_DK" "$KANIT_GUN"; do
  case "$s" in ''|*[!0-9]*) echo "sayi bekleniyor: '$s'" >&2; exit 2 ;; esac
done
# Mac'te silme YASAK (Nadir kuralı): test tohumu (DT_DF) yoksa Darwin'de koşmayı reddet.
if [ "$(uname -s)" = Darwin ] && [ -z "${DT_DF:-}" ]; then echo "Mac'te disk-temizlik KOSMAZ" >&2; exit 2; fi

H="${HOME:?HOME yok}"
H="${H%/}"
[ -n "$H" ] || { echo "HOME / olamaz" >&2; exit 2; }
SERIT="$H/empp-serit"
AJAN="$H/.empp-agent"
# İkinci korkuluk: ~/empp-serit yoksa burası ProBook şeridi değildir (srv21 vb.) → KOŞMA.
if [ ! -d "$SERIT" ] && [ -z "${DT_DF:-}" ]; then echo "$SERIT yok — ProBook seridi degil, KOSMAZ" >&2; exit 2; fi
LOGF="${DT_LOG:-$SERIT/log/disk-temizlik.log}"
mkdir -p "$(dirname "$LOGF")"

# ------------------------------------------------------------------ zamanlayıcı kurulumu
if [ "$ZKUR" = 1 ]; then
  ARAC="$SERIT/araclar"; BIRIM="$H/.config/systemd/user"
  mkdir -p "$ARAC" "$BIRIM"
  KAYNAK="$(cd "$(dirname "$0")" && pwd -P)/$(basename "$0")"
  if [ "$KAYNAK" != "$ARAC/disk-temizlik.sh" ]; then
    cp "$KAYNAK" "$ARAC/disk-temizlik.sh.yeni" && mv "$ARAC/disk-temizlik.sh.yeni" "$ARAC/disk-temizlik.sh"
  fi
  chmod +x "$ARAC/disk-temizlik.sh"
  cat > "$BIRIM/empp-disk-temizlik.service" <<'EOF'
[Unit]
Description=EMPP disk temizlik bekcisi (disk dolu -> yer ac, en eskiden)

[Service]
Type=oneshot
Nice=10
IOSchedulingClass=idle
ExecStart=/bin/bash %h/empp-serit/araclar/disk-temizlik.sh
EOF
  cat > "$BIRIM/empp-disk-temizlik.timer" <<'EOF'
[Unit]
Description=EMPP disk temizlik bekcisi - saatlik

[Timer]
OnBootSec=10min
OnUnitActiveSec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl --user daemon-reload && systemctl --user enable --now empp-disk-temizlik.timer >/dev/null 2>&1
  echo "zamanlayici: $(systemctl --user is-active empp-disk-temizlik.timer 2>/dev/null) · $ARAC/disk-temizlik.sh"
  exit 0
fi

# ------------------------------------------------------------------ kilit
KILIT="$(dirname "$LOGF")/.disk-temizlik.kilit.d"
if ! mkdir "$KILIT" 2>/dev/null; then
  ESKI="$(cat "$KILIT/pid" 2>/dev/null || true)"
  if [ -n "$ESKI" ] && kill -0 "$ESKI" 2>/dev/null; then echo "kilit dolu (pid $ESKI)"; exit 4; fi
  rm -rf "$KILIT"; mkdir "$KILIT" 2>/dev/null || { echo "kilit alinamadi"; exit 4; }
fi
echo $$ > "$KILIT/pid"
GECICI="$(mktemp -d "${TMPDIR:-/tmp}/disk-temizlik-XXXXXX")"
trap 'rm -rf "$KILIT" "$GECICI"' EXIT
SEKME="$(printf '\t')"

zaman(){ date '+%Y-%m-%dT%H:%M:%S'; }
gunluk(){ printf '%s · %s · %s · %s\n' "$(zaman)" "$1" "$2" "$3" >> "$LOGF"; }
mb(){ echo $(( ($1 + 1023) / 1024 )); }   # KB → MB

# ------------------------------------------------------------------ disk ölçümü
# TOPLAM_KB ve BOS_KB (kullanıcıya açık). DT_DF test tohumu: "toplam_kb bos_kb".
olc(){
  local s
  if [ -n "${DT_DF:-}" ]; then s="$DT_DF"; else s="$(df -Pk "$H" 2>/dev/null | awk 'NR==2{print $2, $4}')"; fi
  TOPLAM_KB="${s%% *}"; BOS_KB="${s##* }"
  case "$TOPLAM_KB$BOS_KB" in ''|*[!0-9]*) TOPLAM_KB=0; BOS_KB=0 ;; esac
}
olc
HEDEF_KB=$(( HEDEF_GB * 1048576 ))
YUZDE_KB=$(( TOPLAM_KB * HEDEF_YUZDE / 100 ))
[ "$YUZDE_KB" -gt "$HEDEF_KB" ] && HEDEF_KB=$YUZDE_KB
SILINEN_KB=0

# ------------------------------------------------------------------ koruma listeleri
# AGAC: kendisi, altı ve ATASI silinmez. KAP: kendisi silinmez (içindeki adaylar silinebilir).
KORU_AGAC="$AJAN/token.json
$AJAN/kabuk
$AJAN/motor
$AJAN/yuklemeler
$AJAN/windows-hazir
$AJAN/kaynak-yok-bildirim.json
$AJAN/imza-oncelik.txt
$AJAN/aktivasyon-test-kodu.txt
$SERIT/repo
$SERIT/node
$SERIT/opt
$SERIT/logolar
$SERIT/log
$SERIT/cache
$SERIT/araclar
$H/.ssh
$H/.config
$H/.local
$H/Belgeler
$H/Documents
$H/Masaüstü
$H/Desktop
$H/Resimler
$H/Pictures"
KORU_KAP="$H
$AJAN
$SERIT
$H/İndirilenler
$H/Downloads
$AJAN/kaynak-arsivi
$AJAN/icerik-onbellek
$AJAN/kabul-kanit
$SERIT/kabul-ev
$SERIT/out
$SERIT/work"

# Kullanımdaki yollar: süreçlerin cwd/exe/açık dosyaları + komut satırındaki mutlak yollar.
# Kendi sürecimiz ve atalarımız hariç (uzak kabuğun `--ek ~/DijiTap` satırı DijiTap'i korumasın).
KULLANIM="$GECICI/kullanim"
: > "$KULLANIM"
if [ -n "${DT_KULLANIMDA:-}" ] && [ -f "$DT_KULLANIMDA" ]; then cat "$DT_KULLANIMDA" >> "$KULLANIM"; fi
if [ -d /proc/self/fd ] && [ -z "${DT_PROC_YOK:-}" ]; then
  ATALAR=" $$ "
  p=$$
  while [ -n "$p" ] && [ "$p" != 0 ] && [ "$p" != 1 ]; do
    p="$(awk '/^PPid:/{print $2}' "/proc/$p/status" 2>/dev/null)"
    [ -n "$p" ] && ATALAR="$ATALAR$p "
  done
  for d in /proc/[0-9]*; do
    pid="${d#/proc/}"
    case "$ATALAR" in *" $pid "*) continue ;; esac
    # Atamızın çocuğu olan bu betiğin alt kabukları da hariç (ör. $(...) içindeki readlink'ler).
    pp="$(awk '/^PPid:/{print $2}' "$d/status" 2>/dev/null)"
    [ "$pp" = "$$" ] && continue
    { readlink "$d/cwd"; readlink "$d/exe"
      for f in "$d"/fd/*; do readlink "$f"; done
      tr '\0' '\n' < "$d/cmdline"; } 2>/dev/null | grep '^/' >> "$KULLANIM"
  done
fi

kullanimda(){   # $1 aday → 0 = bir süreç bu yolu ya da altını kullanıyor
  awk -v a="$1" 'BEGIN{n=length(a); f=0} $0==a || substr($0,1,n+1)==a"/" {f=1; exit} END{exit (f?0:1)}' "$KULLANIM"
}
korunuyor(){    # $1 aday → 0 + neden (stdout) = silinmez
  local a="$1" k
  case "$a" in "$H"/?*) ;; /tmp/kabul-*.impark) ;; *) echo "HOME disinda"; return 0 ;; esac
  case "/$a/" in */../*|*/./*) echo "goreli yol"; return 0 ;; esac
  while IFS= read -r k; do
    [ -n "$k" ] || continue
    case "$a" in "$k"|"$k"/*) echo "koruma: $k"; return 0 ;; esac
    case "$k" in "$a"/*) echo "koruma (alti): $k"; return 0 ;; esac
  done <<EOF
$KORU_AGAC
EOF
  while IFS= read -r k; do
    [ "$a" = "$k" ] && { echo "koruma (kap): $k"; return 0; }
  done <<EOF
$KORU_KAP
EOF
  return 1
}
yeni_mi(){      # $1 → 0 = ağaçta son KORU_DK dk içinde değişen var
  [ "$KORU_DK" -gt 0 ] || return 1
  [ -n "$(find "$1" -mmin "-$KORU_DK" -print 2>/dev/null | head -1)" ]
}
if find /dev/null -maxdepth 0 -printf '' >/dev/null 2>&1; then GNU_FIND=1; else GNU_FIND=0; fi
en_yeni_mtime(){  # ağacın en yeni mtime'ı (epoch)
  if [ "$GNU_FIND" = 1 ]; then
    find "$1" -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1
  else
    find "$1" -exec stat -f '%m' {} + 2>/dev/null | sort -n | tail -1
  fi
}
boyut_kb(){ du -sk "$1" 2>/dev/null | awk '{print $1+0}'; }

sil(){          # $1 yol → 0 silindi
  if [ -L "$1" ] || [ ! -d "$1" ]; then rm -f -- "$1" 2>/dev/null
  else rm -rf -- "$1" 2>/dev/null || { chmod -R u+rwx -- "$1" 2>/dev/null; rm -rf -- "$1" 2>/dev/null; }
  fi
  if [ -e "$1" ] || [ -L "$1" ]; then
    # Kullanıcı ağacında root sahipli kalıntı (squashfs açılışı vb.): parolasız sudo varsa yalnız $HOME altı.
    case "$1" in "$H"/?*) sudo -n rm -rf -- "$1" 2>/dev/null ;; esac
  fi
  [ ! -e "$1" ] && [ ! -L "$1" ]
}

hedefte(){ [ "$BOS_KB" -ge "$HEDEF_KB" ]; }

# İşle: $1 yol, $2 neden, $3 ek(1)=yenilik kuralı yok (kullanıcının açık yolu)
SAYAC_SIL=0; SAYAC_ATLA=0
atla(){ gunluk "$1" "-" "ATLANDI: $2"; echo "ATLANDI $1 ($2)"; SAYAC_ATLA=$((SAYAC_ATLA + 1)); }
isle(){
  local y="$1" neden="$2" ek="${3:-0}" sebep b
  [ -e "$y" ] || [ -L "$y" ] || { [ "$ek" = 1 ] && atla "$y" "yok"; return 0; }
  if sebep="$(korunuyor "$y")"; then atla "$y" "$sebep"; return 0; fi
  if kullanimda "$y"; then atla "$y" "kullanimda (calisan surec)"; return 0; fi
  if [ "$ek" != 1 ] && yeni_mi "$y"; then atla "$y" "son ${KORU_DK} dk icinde degisti"; return 0; fi
  b="$(boyut_kb "$y")"; b=${b:-0}
  if [ "$KURU" = 1 ]; then
    gunluk "$y" "$(mb "$b") MB" "KURU: $neden"; echo "KURU $(mb "$b") MB $y ($neden)"
  elif sil "$y"; then
    gunluk "$y" "$(mb "$b") MB" "$neden"; echo "SILINDI $(mb "$b") MB $y ($neden)"
  else
    gunluk "$y" "$(mb "$b") MB" "HATA: silinemedi ($neden)"; echo "HATA $y silinemedi"
    SAYAC_ATLA=$((SAYAC_ATLA + 1)); return 0
  fi
  SAYAC_SIL=$((SAYAC_SIL + 1)); SILINEN_KB=$((SILINEN_KB + b)); BOS_KB=$((BOS_KB + b))
}

# Aday listesi: "mtime<TAB>yol<TAB>neden" satırları; katman içinde en eski önce işlenir.
aday_ekle(){ local m; m="$(en_yeni_mtime "$1")"; printf '%s\t%s\t%s\n' "${m:-0}" "$1" "$2" >> "$3"; }
katman_isle(){  # $1 liste dosyası
  [ -s "$1" ] || return 0
  sort -n -t "$SEKME" -k1,1 "$1" > "$1.sirali"
  while IFS="$SEKME" read -r _m y n; do
    if hedefte; then
      # Sayaç (du toplamı) hedefi gösterdi; gerçek koşuda df de doğrulamalı (eşzamanlı üretim yazıyor).
      [ "$KURU" = 1 ] || [ -n "${DT_DF:-}" ] && return 0
      olc; hedefte && return 0
    fi
    isle "$y" "$n"
  done < "$1.sirali"
}
alt_ogeler(){ [ -d "$1" ] && find "$1" -mindepth 1 -maxdepth 1 2>/dev/null; }

KURU_ETIKET=""; [ "$KURU" = 1 ] && KURU_ETIKET=" KURU"
echo "disk-temizlik: bos $(mb "$BOS_KB") MB / toplam $(mb "$TOPLAM_KB") MB · hedef $(mb "$HEDEF_KB") MB$KURU_ETIKET"
gunluk "-" "$(mb "$BOS_KB") MB bos" "BASLA hedef $(mb "$HEDEF_KB") MB$KURU_ETIKET ek=$EK_SAYI"

# ------------------------------------------------------------------ K0: kullanıcının açık yolları
if [ "$EK_SAYI" -gt 0 ]; then
  for e in "${EKLER[@]}"; do
    case "$e" in "~/"*) e="$H/${e#\~/}" ;; esac
    e="${e%/}"
    case "$e" in /*) isle "$e" "kullanici acikca verdi (--ek)" 1 ;; *) atla "$e" "mutlak yol degil" ;; esac
  done
fi

# ------------------------------------------------------------------ K1..K3
if ! hedefte; then
  L1="$GECICI/k1"; L2="$GECICI/k2"; L3="$GECICI/k3"; : > "$L1"; : > "$L2"; : > "$L3"
  for d in "$H/testler" "$H/Silinecekler"; do
    alt_ogeler "$d" | while IFS= read -r y; do aday_ekle "$y" "test/deneme ($(basename "$d"))" "$L1"; done
  done
  find "$H" -maxdepth 3 \( -path "$AJAN" -o -path "$SERIT" -o -path "$H/.cache" -o -path "$H/.local" \
    -o -path "$H/.config" -o -path "$H/testler" -o -path "$H/Silinecekler" \) -prune \
    -o -type d -iname '*kabuk*aday*' -print 2>/dev/null \
    | while IFS= read -r y; do aday_ekle "$y" "kabuk-aday test" "$L1"; done
  for d in "$H/İndirilenler" "$H/Downloads"; do
    [ -d "$d" ] || continue
    find "$d" -mindepth 1 -maxdepth 1 -type f \( -iname '*.impark' -o -iname '*.yds' -o -iname '*.ydsdigital' \
      -o -iname '*.AppImage' -o -iname '*.deb' -o -iname '*.zip' -o -iname '*.exe' -o -iname '*.apk' \
      -o -iname '*.dmg' -o -iname '*.part' \) 2>/dev/null \
      | while IFS= read -r y; do aday_ekle "$y" "indirilen paket" "$L1"; done
  done
  if [ -d "$H/DijiTap" ]; then
    find "$H/DijiTap" -mindepth 2 -maxdepth 2 2>/dev/null \
      | while IFS= read -r y; do aday_ekle "$y" "DijiTap test kurulumu" "$L1"; done
  fi
  for d in "$SERIT/kabul-ev" "$SERIT/out"; do
    alt_ogeler "$d" | while IFS= read -r y; do aday_ekle "$y" "serit artigi ($(basename "$d"))" "$L1"; done
  done
  if [ -d "$SERIT/work" ]; then
    find "$SERIT/work" -mindepth 1 -maxdepth 1 \( -name 't-*' -o -name 'xvfb-run.*' -o -name 'unrar-*' \
      -o -name 'node-v*' \) 2>/dev/null | while IFS= read -r y; do aday_ekle "$y" "serit work artigi" "$L1"; done
  fi
  find "$SERIT" "$AJAN" -mindepth 1 -maxdepth 1 \( -name '*.kaldirildi-*' -o -name 'yedek-*' \) 2>/dev/null \
    | while IFS= read -r y; do aday_ekle "$y" "kenara alinmis eski surum/bayrak" "$L1"; done
  find /tmp -maxdepth 1 -name 'kabul-*.impark' -user "$(id -u)" 2>/dev/null \
    | while IFS= read -r y; do aday_ekle "$y" "kabul kopyasi (/tmp)" "$L1"; done

  alt_ogeler "$AJAN/icerik-onbellek" | while IFS= read -r y; do aday_ekle "$y" "icerik onbellegi" "$L2"; done
  if [ -d "$AJAN/kabul-kanit" ]; then
    find "$AJAN/kabul-kanit" -mindepth 1 -maxdepth 1 -mtime "+$KANIT_GUN" 2>/dev/null | while IFS= read -r y; do
      [ -z "$(find "$y" -mtime "-$KANIT_GUN" -print 2>/dev/null | head -1)" ] \
        && aday_ekle "$y" "kabul kaniti (>${KANIT_GUN} gun)" "$L2"
    done
  fi

  alt_ogeler "$AJAN/kaynak-arsivi" | while IFS= read -r y; do
    aday_ekle "$y" "kaynak arsivi (SON CARE; arsiv-esle yeniden esler)" "$L3"
  done

  katman_isle "$L1"; katman_isle "$L2"; katman_isle "$L3"
fi

# ------------------------------------------------------------------ sonuç
if [ "$KURU" != 1 ] && [ -z "${DT_DF:-}" ]; then olc; fi   # gerçek koşuda yeniden ölç
DURUM=tamam; hedefte || DURUM=dar
YUZDE=0; [ "$TOPLAM_KB" -gt 0 ] && YUZDE=$(( BOS_KB * 100 / TOPLAM_KB ))
gunluk "-" "$(mb "$BOS_KB") MB bos" "BITTI silinen $(mb "$SILINEN_KB") MB · $SAYAC_SIL kalem · atlanan $SAYAC_ATLA · hedef $DURUM$KURU_ETIKET"
echo "SONUC bos_gb=$(( BOS_KB / 1048576 )) bos_yuzde=$YUZDE silinen_mb=$(mb "$SILINEN_KB") kalem=$SAYAC_SIL atlanan=$SAYAC_ATLA hedef=$DURUM"
[ "$DURUM" = tamam ] && exit 0 || exit 3
