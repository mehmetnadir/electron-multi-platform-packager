#!/bin/bash
# ProBook (Pardus) DİSK TEMİZLİK BEKÇİSİ — "disk dolu → işi durdurma, yer aç" (Nadir 06.10).
#
# Kural: ProBook'ta disk dar diye üretim/kabul/kurulum DURMAZ. Boş alan hedefin altındaysa BİZİM
# ürettiğimiz/indirdiğimiz dosyalar EN ESKİDEN başlayarak silinir; hedefe ulaşınca durulur.
# Silme yalnız bu makinede (ve windows-kasa'da) serbesttir. Mac ve srv21'de bu betik KOŞMAZ:
#   - Darwin → çıkış 2 (yalnız test kilidiyle, sahte geçici HOME içinde koşar; aşağıda);
#   - ~/empp-serit yok ya da ~/empp-serit/disk-temizlik.izin yok → çıkış 2 (srv21 değişmezi).
#     İzin dosyasını yalnız --zamanlayici-kur (ProBook kurulumu) yazar.
#   - /opt/empp-packager varsa (srv21 negatif işareti) → çıkış 2, kurulum dahil.
#
# Kullanım:
#   disk-temizlik.sh [--kuru] [--ek <yol>]... [--koru <yol>]... [--hedef-gb N] [--hedef-yuzde N]
#                    [--sert-gb N] [--zamanlayici-kur]
#   --kuru              yalnız listele (silme yok); günlüğe KURU satırı yazar
#   --ek <yol>          kullanıcının AÇIKÇA verdiği yol: hedefe bakılmadan silinir. Gerçek yola
#                       çevrilir (sembolik bağlı üst dizin, //, ..); gerçek yol $HOME altında değilse ATLA.
#                       Koruma + kullanımda denetimi yine geçerli.
#   --koru <yol>        bu koşuda ek koruma (kendisi, altı ve atası silinmez). Runner çalışan işin
#                       kaynak arşivini ve iş dizinini böyle korur.
#   --hedef-gb N        boş alan hedefi GB. VERİLİRSE varsayılan rahatlık hedefinin (50) YERİNE geçer;
#                       windows betiğinde de aynı davranış (runner kapının gerekli GB'sini verir).
#   --hedef-yuzde N     boş alan hedefi % (vars. 25; runner 0 verir: yalnız gereken GB)
#   --sert-gb N         SERT ALT EŞİK (vars. 15 = runner pardus tabanı). K3 (kaynak arşivi) YALNIZ boş
#                       alan bunun altındayken açılır ve bu eşiğe ulaşınca durur.
#   --zamanlayici-kur   izin dosyasını yazar, kendini ~/empp-serit/araclar/'a kopyalar, systemd --user
#                       saatlik zamanlayıcıyı kurar; zamanlayıcı etkin değilse çıkış 1
# Çıkış: 0 hedef sağlandı · 3 adaylar bitti hâlâ dar · 2 kullanım/korkuluk · 4 kilit dolu · 1 kurulum hatası
# Son satır: SONUC bos_gb=.. bos_yuzde=.. silinen_mb=.. kalem=.. atlanan=.. hedef=tamam|dar tarama=tamam|bozuk
#
# SIRA (katman içinde en eski önce — ağacın EN YENİ mtime'ı ölçülür: "en son dokunulan"):
#   K1 test/deneme/paket artığı: ~/testler/*, ~/Silinecekler/*, *kabuk*aday*, İndirilenler/Downloads
#      paketleri, ~/DijiTap/*/*, empp-serit kabul-ev/out/work artıkları, *.kaldirildi-*, yedek-*,
#      /tmp/kabul-*.impark
#   K2 önbellek/kanıt: icerik-onbellek/<id>, kabul-kanit/* (KANIT_GUN=7 günden eski)
#   K3 SON ÇARE kaynak-arsivi/<id>: YALNIZ sert eşik altında. Mac otoritesinin kopyası; silinince
#      arsiv-esle yeniden eşler (bu sırada ProBook duraklatılabilir).
# KORUMA (her aday için; belirsizse SİLME):
#   - koruma listesi + --koru (düz ve gerçek yol biçimiyle karşılaştırılır);
#   - gerçek yol $HOME altında olmalı; rm --one-file-system; sudo YOK;
#   - süreç taraması: cwd/exe/açık dosya/komut satırı argümanındaki yol adayın altındaysa ATLA.
#     Kendi uid'imizin bir süreci okunamazsa tarama BOZUK sayılır → her aday "kullanımda" (fail-closed);
#   - .empp-sahip.pid sahibi canlı dizin (runner iş dizini) ATLA;
#   - ağaçta son DT_KORU_DK (120) dk içinde değişen dosya varsa ATLA (--ek hariç).
# DİSK TAM DOLUYKEN ÇALIŞIR: kilit flock (mevcut ~/empp-serit dizini), aday listeleri bellekte/boruda
#   (geçici dosya yok), günlük yazılamazsa satır stdout'a düşer, iş sürer.
# Günlük: ~/empp-serit/log/disk-temizlik.log — tarih · yol · boyut · neden.
# Test: tools/probook/disk-temizlik.test.js. Test anahtarları (DT_DF, DT_KULLANIMDA, DT_PROC_YOK, DT_KORU_DK,
#   DT_KANIT_GUN, DT_SRV21_ISARET; test kipinde /tmp yerine $HOME/tmp)
#   YALNIZ test kilidiyle okunur: DT_TEST_KILIDI="$HOME/.dt-test-kilidi" var, HOME'un adı dt-ev-* ve
#   HOME sistem geçici dizininin altında. Kilit yoksa anahtarlar yok sayılır.
set -u

KURU=0
HEDEF_GB=50
HEDEF_YUZDE=25
SERT_GB=15
KORU_DK=120
KANIT_GUN=7
ZKUR=0
EKLER=(); EK_SAYI=0
KORU_EK=""
NL='
'
while [ $# -gt 0 ]; do case "$1" in
  --kuru) KURU=1; shift ;;
  --ek) [ $# -ge 2 ] || { echo "--ek yol ister" >&2; exit 2; }; EKLER+=("$2"); EK_SAYI=$((EK_SAYI + 1)); shift 2 ;;
  --koru) [ $# -ge 2 ] || { echo "--koru yol ister" >&2; exit 2; }; KORU_EK="$KORU_EK$2$NL"; shift 2 ;;
  --hedef-gb) [ $# -ge 2 ] || exit 2; HEDEF_GB="$2"; shift 2 ;;
  --hedef-yuzde) [ $# -ge 2 ] || exit 2; HEDEF_YUZDE="$2"; shift 2 ;;
  --sert-gb) [ $# -ge 2 ] || exit 2; SERT_GB="$2"; shift 2 ;;
  --zamanlayici-kur) ZKUR=1; shift ;;
  *) echo "bilinmeyen: $1" >&2; exit 2 ;;
esac; done
for s in "$HEDEF_GB" "$HEDEF_YUZDE" "$SERT_GB" "$KORU_DK" "$KANIT_GUN"; do
  case "$s" in ''|*[!0-9]*) echo "sayi bekleniyor: '$s'" >&2; exit 2 ;; esac
done

# ------------------------------------------------------------------ yol yardımcıları
# Gerçek yol: üst dizin gerçek yola çevrilir (GNU realpath -e; yoksa cd -P), ad aynen eklenir.
# Aday sembolik bağsa yalnız bağın kendisi silinir; hedefi izlenmez. '.', '..', boş ad reddedilir.
gercek_dizin(){
  local r
  r="$(realpath -e -- "$1" 2>/dev/null)" || r="$(cd -P -- "$1" 2>/dev/null && pwd -P)" || return 1
  [ -d "$r" ] || return 1
  printf '%s' "$r"
}
gercek(){
  local p="$1" d b r
  while [ "${#p}" -gt 1 ] && [ "${p%/}" != "$p" ]; do p="${p%/}"; done
  d="$(dirname -- "$p")"; b="$(basename -- "$p")"
  case "$b" in ''|.|..|/) return 1 ;; esac
  r="$(gercek_dizin "$d")" || return 1
  printf '%s/%s' "${r%/}" "$b"
}

H0="${HOME:?HOME yok}"
H="$(gercek_dizin "$H0")" || { echo "HOME cozulemedi" >&2; exit 2; }
[ "$H" != "/" ] || { echo "HOME / olamaz" >&2; exit 2; }

# ------------------------------------------------------------------ test kilidi + korkuluklar
TEST=0
if [ -n "${DT_TEST_KILIDI:-}" ] && [ "${DT_TEST_KILIDI}" = "$H0/.dt-test-kilidi" ] && [ -f "$DT_TEST_KILIDI" ]; then
  case "$(basename -- "$H")" in dt-ev-*)
    for t in "${TMPDIR:-}" /tmp /var/tmp; do
      [ -n "$t" ] || continue
      tr_="$(gercek_dizin "$t")" || continue
      case "$H" in "$tr_"/dt-ev-*) TEST=1; break ;; esac
    done ;;
  esac
fi
if [ "$TEST" != 1 ]; then unset DT_DF DT_KULLANIMDA DT_PROC_YOK DT_SRV21_ISARET; else
  KORU_DK="${DT_KORU_DK:-120}"; KANIT_GUN="${DT_KANIT_GUN:-7}"
  case "$KORU_DK$KANIT_GUN" in *[!0-9]*) echo "sayi bekleniyor" >&2; exit 2 ;; esac
fi
# Mac'te silme YASAK: Darwin'de yalnız test kilidiyle (sahte geçici HOME) koşar.
if [ "$(uname -s)" = Darwin ] && [ "$TEST" != 1 ]; then echo "Mac'te disk-temizlik KOSMAZ" >&2; exit 2; fi

# srv21 NEGATİF İŞARETİ (inceleme K5): paketleyici kurulumu olan makine srv21'dir → KOŞMA (kurulum dahil).
SRV21_ISARET="/opt/empp-packager"
[ "$TEST" = 1 ] && [ -n "${DT_SRV21_ISARET:-}" ] && SRV21_ISARET="$DT_SRV21_ISARET"
if [ -d "$SRV21_ISARET" ]; then echo "$SRV21_ISARET var — srv21, KOSMAZ" >&2; exit 2; fi

SERIT="$H/empp-serit"
AJAN="$H/.empp-agent"
IZIN="$SERIT/disk-temizlik.izin"
# srv21 değişmezi: ~/empp-serit yoksa burası ProBook şeridi değildir → KOŞMA.
if [ ! -d "$SERIT" ]; then echo "$SERIT yok — ProBook seridi degil, KOSMAZ" >&2; exit 2; fi
LOGF="$SERIT/log/disk-temizlik.log"
mkdir -p "$SERIT/log" 2>/dev/null

zaman(){ date '+%Y-%m-%dT%H:%M:%S'; }
# Günlük yazılamazsa (disk tam dolu) satır stdout'a düşer; iş durmaz.
gunluk(){
  local s; s="$(printf '%s · %s · %s · %s' "$(zaman)" "$1" "$2" "$3")"
  { printf '%s\n' "$s" >> "$LOGF"; } 2>/dev/null || printf 'GUNLUK-YAZILAMADI %s\n' "$s"
}

# ------------------------------------------------------------------ zamanlayıcı kurulumu
if [ "$ZKUR" = 1 ]; then
  ARAC="$SERIT/araclar"; BIRIM="$H/.config/systemd/user"
  mkdir -p "$ARAC" "$BIRIM" || exit 1
  printf 'ProBook disk temizlik izni (Nadir 06.10) — %s\n' "$(zaman)" > "$IZIN" || exit 1
  KAYNAK="$(gercek "$0")" || exit 1
  if [ "$KAYNAK" != "$ARAC/disk-temizlik.sh" ]; then
    cp "$KAYNAK" "$ARAC/disk-temizlik.sh.yeni" && mv "$ARAC/disk-temizlik.sh.yeni" "$ARAC/disk-temizlik.sh" || exit 1
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
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl --user daemon-reload && systemctl --user enable --now empp-disk-temizlik.timer >/dev/null 2>&1
  D="$(systemctl --user is-active empp-disk-temizlik.timer 2>/dev/null)"
  echo "zamanlayici: ${D:-bilinmiyor} · $ARAC/disk-temizlik.sh"
  [ "$D" = active ] && exit 0 || exit 1
fi

if [ ! -f "$IZIN" ]; then echo "$IZIN yok — izinsiz makinede KOSMAZ (srv21 degismezi)" >&2; exit 2; fi

# ------------------------------------------------------------------ kilit (dosya OLUŞTURMAZ)
# flock mevcut ~/empp-serit dizininin üstünde: repo kopyası ve araclar kopyası AYNI kilidi paylaşır.
if command -v flock >/dev/null 2>&1; then
  exec 9< "$SERIT" || exit 4
  flock -n 9 || { echo "kilit dolu (flock $SERIT)"; exit 4; }
else
  # flock'suz sistem (yalnız Mac testleri): mkdir kilidi.
  KILIT="$SERIT/log/.disk-temizlik.kilit.d"
  if ! mkdir "$KILIT" 2>/dev/null; then
    ESKI="$(cat "$KILIT/pid" 2>/dev/null || true)"
    if [ -n "$ESKI" ] && kill -0 "$ESKI" 2>/dev/null; then echo "kilit dolu (pid $ESKI)"; exit 4; fi
    rm -rf "$KILIT"; mkdir "$KILIT" 2>/dev/null || { echo "kilit alinamadi"; exit 4; }
  fi
  echo $$ > "$KILIT/pid"
  trap 'rm -rf "$KILIT"' EXIT
fi

mb(){ echo $(( ($1 + 1023) / 1024 )); }   # KB → MB

# ------------------------------------------------------------------ disk ölçümü
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
SERT_KB=$(( SERT_GB * 1048576 ))
SILINEN_KB=0

# ------------------------------------------------------------------ koruma listeleri
# AGAC: kendisi, altı ve ATASI silinmez. KAP: kendisi silinmez (içindeki adaylar silinebilir).
KORU_AGAC_HAM="$AJAN/token.json
$AJAN/kabuk
$AJAN/motor
$AJAN/yuklemeler
$AJAN/windows-hazir
$AJAN/kaynak-yok-bildirim.json
$AJAN/imza-oncelik.txt
$AJAN/aktivasyon-test-kodu.txt
$AJAN/set-listeleri
$SERIT/repo
$SERIT/node
$SERIT/opt
$SERIT/logolar
$SERIT/log
$SERIT/cache
$SERIT/araclar
$SERIT/disk-temizlik.izin
$H/.ssh
$H/.config
$H/.local
$H/Belgeler
$H/Documents
$H/Masaüstü
$H/Desktop
$H/Resimler
$H/Pictures
$KORU_EK"
KORU_KAP_HAM="$H
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
# Her girdi düz VE gerçek biçimiyle tutulur (sembolik bağlı koruma kökü de yakalanır).
iki_bicim(){
  local k g
  while IFS= read -r k; do
    [ -n "$k" ] || continue
    printf '%s\n' "$k"
    g="$(gercek "$k" 2>/dev/null)" && [ "$g" != "$k" ] && printf '%s\n' "$g"
  done < <(printf '%s\n' "$1")
}
KORU_AGAC="$(iki_bicim "$KORU_AGAC_HAM")"
KORU_KAP="$(iki_bicim "$KORU_KAP_HAM")"
TMP_R="$(gercek_dizin /tmp)"
# Test kipinde gerçek /tmp'ye ASLA dokunulmaz (inceleme K1).
if [ "$TEST" = 1 ]; then mkdir -p "$H/tmp" 2>/dev/null; TMP_R="$(gercek_dizin "$H/tmp")"; fi

# ------------------------------------------------------------------ süreç taraması
# Çıktı: kullanılan yollar (satır başına bir). Tarayıcı bu betiğin kendi süreçlerini ve atalarını atlar.
# Okunamayan (zombi/çekirdek iş parçacığı olmayan) her süreç → çıkış 7 = tarama BOZUK (fail-closed:
# her aday kullanımda). Önce `sudo -n bash` ile (salt OKUMA; silme sudo'suz) taranır; sudo yoksa ya da
# başarısızsa sudosuz taramaya düşülür — başka kullanıcının süreçleri okunamaz → BOZUK. SONUC satırı
# `tarama=bozuk` taşır, runner yardımcısı bunu uyarı olarak loglar (sessiz 0 silme yok).
# Ana betiğin komut satırı (çatallanan alt kabukları aynı satırı taşır) argümanla DEĞİL /proc üzerinden
# okunur: argüman olsa sudo/bash süreçlerinin satırında --ek yolları görünür, aday kendini korurdu.
TARAYICI='
ATLA=" $1 $$ $PPID "; BOZUK=0
KENDI_CMD="$(tr "\0" "\n" < "/proc/$2/cmdline" 2>/dev/null)"
for d in /proc/[0-9]*; do
  pid="${d#/proc/}"
  case "$ATLA" in *" $pid "*) continue ;; esac
  cmd="$(tr "\0" "\n" < "$d/cmdline" 2>/dev/null)"
  [ -n "$KENDI_CMD" ] && [ "$cmd" = "$KENDI_CMD" ] && continue
  c="$(readlink "$d/cwd" 2>/dev/null)"
  if [ -z "$c" ]; then
    [ -d "$d" ] || continue
    case "$(awk "/^State:/{print \$2}" "$d/status" 2>/dev/null)" in Z|X|"") continue ;; esac  # zombi/ölü: cwd yok
    [ "$pid" = 2 ] && continue
    [ "$(awk "/^PPid:/{print \$2}" "$d/status" 2>/dev/null)" = 2 ] && continue  # çekirdek iş parçacığı
    BOZUK=7   # okunamayan süreç → hangi yolu kullandığı bilinmez → fail-closed
    continue
  fi
  printf "%s\n" "$c"
  readlink "$d/exe" 2>/dev/null
  for f in "$d"/fd/*; do readlink "$f" 2>/dev/null; done
  printf "%s\n" "$cmd" | sed -n "s|^[^/]*\(/.*\)$|\1|p"
done
exit $BOZUK'
KULLANIM=""
KULLANIM_BOZUK=0
TARAMA_NOT=""
if [ -n "${DT_KULLANIMDA:-}" ] && [ -f "$DT_KULLANIMDA" ]; then KULLANIM="$(cat "$DT_KULLANIMDA")$NL"; fi
if [ -z "${DT_PROC_YOK:-}" ]; then
  if [ ! -r /proc/self/cmdline ]; then
    KULLANIM_BOZUK=1   # süreç taraması yok → fail-closed
  else
    ATALAR="$$"
    p=$$
    while [ -n "$p" ] && [ "$p" != 0 ] && [ "$p" != 1 ]; do
      p="$(awk '/^PPid:/{print $2}' "/proc/$p/status" 2>/dev/null)"
      [ -n "$p" ] && ATALAR="$ATALAR $p"
    done
    RC=1
    if [ "$(id -u)" != 0 ]; then T="$(sudo -n bash -c "$TARAYICI" tarayici "$ATALAR" "$$" 2>/dev/null)"; RC=$?; fi
    if [ "$RC" != 0 ] && [ "$RC" != 7 ]; then   # sudo yok/başarısız → sudosuz tarama
      [ "$(id -u)" != 0 ] && TARAMA_NOT="sudo -n bash yok"
      T="$(bash -c "$TARAYICI" tarayici "$ATALAR" "$$")"; RC=$?
    fi
    [ "$RC" = 0 ] || KULLANIM_BOZUK=1
    KULLANIM="$KULLANIM$(printf "%s\n" "$T" | grep "^/")$NL"
  fi
fi

kullanimda(){   # $1 aday → 0 = bir süreç bu yolu ya da altını kullanıyor (ya da tarama bozuk)
  [ "$KULLANIM_BOZUK" = 1 ] && return 0
  printf '%s' "$KULLANIM" | A="$1" awk 'BEGIN{a=ENVIRON["A"]; n=length(a); f=0}
    $0==a || substr($0,1,n+1)==a"/" {f=1; exit} END{exit (f?0:1)}'
}
sahibi_canli(){ # $1 dizin → 0 = .empp-sahip.pid sahibi canlı (runner iş dizini)
  local p
  [ -f "$1/.empp-sahip.pid" ] || return 1
  [ -r "$1/.empp-sahip.pid" ] || return 0   # okunamıyor → belirsiz → canlı say
  [ -s "$1/.empp-sahip.pid" ] || return 1   # boş işaret (yazım yarım kaldı, runner kaldırır) → yok
  p="$(head -c 20 "$1/.empp-sahip.pid" 2>/dev/null | tr -cd '0-9')"
  [ -n "$p" ] || return 0   # sayı değil → belirsiz → canlı say
  kill -0 "$p" 2>/dev/null || [ -d "/proc/$p" ]
}
korunuyor(){    # $1 düz yol, $2 gerçek yol → 0 + neden (stdout) = silinmez
  local a k
  case "$2" in
    "$H"/?*) ;;
    "$TMP_R"/kabul-*.impark) [ "$(dirname -- "$2")" = "$TMP_R" ] || { echo "kabul kopyasi /tmp kokunde degil: $2"; return 0; } ;;
    *) echo "gercek yol HOME disinda: $2"; return 0 ;;
  esac
  for a in "$1" "$2"; do
    case "/$a/" in */../*|*/./*) echo "goreli yol"; return 0 ;; esac
    while IFS= read -r k; do
      [ -n "$k" ] || continue
      case "$a" in "$k"|"$k"/*) echo "koruma: $k"; return 0 ;; esac
      case "$k" in "$a"/*) echo "koruma (alti): $k"; return 0 ;; esac
    done < <(printf '%s\n' "$KORU_AGAC")
    while IFS= read -r k; do
      [ "$a" = "$k" ] && { echo "koruma (kap): $k"; return 0; }
    done < <(printf '%s\n' "$KORU_KAP")
  done
  return 1
}
yeni_mi(){      # $1 → 0 = ağaçta son KORU_DK dk içinde değişen var
  [ "$KORU_DK" -gt 0 ] || return 1
  [ -n "$(find "$1" -mmin "-$KORU_DK" -print 2>/dev/null | head -1)" ]
}
if find /dev/null -maxdepth 0 -printf '' >/dev/null 2>&1; then GNU_FIND=1; else GNU_FIND=0; fi
en_yeni_mtime(){
  if [ "$GNU_FIND" = 1 ]; then
    find "$1" -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1
  else
    find "$1" -exec stat -f '%m' {} + 2>/dev/null | sort -n | tail -1
  fi
}
boyut_kb(){ local b; b="$(du -sk -- "$1" 2>/dev/null | awk 'NR==1{print $1+0}')"; case "$b" in ''|*[!0-9]*) b=0 ;; esac; echo "$b"; }  # ad yeni satır içerebilir: yalnız ilk satır
if rm --one-file-system -f -- "/nonexistent-dt-$$" 2>/dev/null; then RM_TEK=(--one-file-system); else RM_TEK=(); fi

sil(){          # $1 GERÇEK yol → 0 silindi. sudo YOK.
  if [ -L "$1" ] || [ ! -d "$1" ]; then rm -f -- "$1" 2>/dev/null
  else rm -rf ${RM_TEK[@]+"${RM_TEK[@]}"} -- "$1" 2>/dev/null || { chmod -R u+rwx -- "$1" 2>/dev/null; rm -rf ${RM_TEK[@]+"${RM_TEK[@]}"} -- "$1" 2>/dev/null; }
  fi
  [ ! -e "$1" ] && [ ! -L "$1" ]
}

hedefte(){ [ "$BOS_KB" -ge "$HEDEF_KB" ]; }
sert_ustunde(){ [ "$BOS_KB" -ge "$SERT_KB" ]; }
gercek_olc(){ [ "$KURU" = 1 ] || [ -n "${DT_DF:-}" ] || olc; }

SAYAC_SIL=0; SAYAC_ATLA=0
atla(){ gunluk "$1" "-" "ATLANDI: $2"; echo "ATLANDI $1 ($2)"; SAYAC_ATLA=$((SAYAC_ATLA + 1)); }
# $1 yol, $2 neden, $3 ek(1)=yenilik kuralı yok (kullanıcının açık yolu)
isle(){
  local y="$1" neden="$2" ek="${3:-0}" g sebep b
  [ -e "$y" ] || [ -L "$y" ] || { [ "$ek" = 1 ] && atla "$y" "yok"; return 0; }
  g="$(gercek "$y")" || { atla "$y" "gercek yol cozulemedi"; return 0; }
  if sebep="$(korunuyor "$y" "$g")"; then atla "$y" "$sebep"; return 0; fi
  if kullanimda "$g" || kullanimda "$y"; then atla "$y" "kullanimda (calisan surec)"; return 0; fi
  if [ -d "$g" ] && [ ! -L "$g" ] && sahibi_canli "$g"; then atla "$y" "sahibi canli (.empp-sahip.pid)"; return 0; fi
  if [ "$ek" != 1 ] && yeni_mi "$g"; then atla "$y" "son ${KORU_DK} dk icinde degisti"; return 0; fi
  b="$(boyut_kb "$g")"; b=${b:-0}
  if [ "$KURU" = 1 ]; then
    gunluk "$g" "$(mb "$b") MB" "KURU: $neden"; echo "KURU $(mb "$b") MB $g ($neden)"
  elif sil "$g"; then
    gunluk "$g" "$(mb "$b") MB" "$neden"; echo "SILINDI $(mb "$b") MB $g ($neden)"
  else
    gunluk "$g" "$(mb "$b") MB" "HATA: silinemedi ($neden)"; echo "HATA $g silinemedi"
    SAYAC_ATLA=$((SAYAC_ATLA + 1)); return 0
  fi
  SAYAC_SIL=$((SAYAC_SIL + 1)); SILINEN_KB=$((SILINEN_KB + b)); BOS_KB=$((BOS_KB + b))
}

# ------------------------------------------------------------------ aday üretici (bellek/boru)
# Kayıt: "katman<TAB>mtime<TAB>neden<TAB>yol\0" — yol son alan (sekme/boşluk içerebilir).
aday(){ local m; m="$(en_yeni_mtime "$2")"; printf '%s\t%s\t%s\t%s\0' "$1" "${m:-0}" "$3" "$2"; }
alt0(){ [ -d "$1" ] && find "$1" -mindepth 1 -maxdepth 1 -print0 2>/dev/null; }
adaylari_uret(){
  local y d
  for d in "$H/testler" "$H/Silinecekler"; do
    while IFS= read -r -d '' y; do aday 1 "$y" "test/deneme ($(basename "$d"))"; done < <(alt0 "$d")
  done
  while IFS= read -r -d '' y; do aday 1 "$y" "kabuk-aday test"; done < <(find "$H" -maxdepth 3 \
    \( -path "$AJAN" -o -path "$SERIT" -o -path "$H/.cache" -o -path "$H/.local" -o -path "$H/.config" \
    -o -path "$H/testler" -o -path "$H/Silinecekler" \) -prune -o -type d -iname '*kabuk*aday*' -print0 2>/dev/null)
  for d in "$H/İndirilenler" "$H/Downloads"; do
    [ -d "$d" ] || continue
    while IFS= read -r -d '' y; do aday 1 "$y" "indirilen paket"; done < <(find "$d" -mindepth 1 -maxdepth 1 -type f \
      \( -iname '*.impark' -o -iname '*.yds' -o -iname '*.ydsdigital' -o -iname '*.AppImage' -o -iname '*.deb' \
      -o -iname '*.zip' -o -iname '*.exe' -o -iname '*.apk' -o -iname '*.dmg' -o -iname '*.part' \) -print0 2>/dev/null)
  done
  if [ -d "$H/DijiTap" ]; then
    while IFS= read -r -d '' y; do aday 1 "$y" "DijiTap test kurulumu"; done < <(find "$H/DijiTap" -mindepth 2 -maxdepth 2 -print0 2>/dev/null)
  fi
  for d in "$SERIT/kabul-ev" "$SERIT/out"; do
    while IFS= read -r -d '' y; do aday 1 "$y" "serit artigi ($(basename "$d"))"; done < <(alt0 "$d")
  done
  if [ -d "$SERIT/work" ]; then
    while IFS= read -r -d '' y; do aday 1 "$y" "serit work artigi"; done < <(find "$SERIT/work" -mindepth 1 -maxdepth 1 \
      \( -name 't-*' -o -name 'xvfb-run.*' -o -name 'unrar-*' -o -name 'node-v*' -o -name 'empp-agent-*' \) -print0 2>/dev/null)
  fi
  while IFS= read -r -d '' y; do aday 1 "$y" "kenara alinmis eski surum/bayrak"; done < <(find "$SERIT" "$AJAN" -mindepth 1 \
    -maxdepth 1 \( -name '*.kaldirildi-*' -o -name 'yedek-*' \) -print0 2>/dev/null)
  while IFS= read -r -d '' y; do aday 1 "$y" "kabul kopyasi (/tmp)"; done < <(find "$TMP_R" -maxdepth 1 \
    -name 'kabul-*.impark' -user "$(id -u)" -print0 2>/dev/null)

  while IFS= read -r -d '' y; do aday 2 "$y" "icerik onbellegi"; done < <(alt0 "$AJAN/icerik-onbellek")
  if [ -d "$AJAN/kabul-kanit" ]; then
    while IFS= read -r -d '' y; do
      [ -z "$(find "$y" -mtime "-$KANIT_GUN" -print 2>/dev/null | head -1)" ] && aday 2 "$y" "kabul kaniti (>${KANIT_GUN} gun)"
    done < <(find "$AJAN/kabul-kanit" -mindepth 1 -maxdepth 1 -mtime "+$KANIT_GUN" -print0 2>/dev/null)
  fi

  while IFS= read -r -d '' y; do aday 3 "$y" "kaynak arsivi (SON CARE, sert esik altinda)"; done < <(alt0 "$AJAN/kaynak-arsivi")
}

KURU_ETIKET=""; [ "$KURU" = 1 ] && KURU_ETIKET=" KURU"
echo "disk-temizlik: bos $(mb "$BOS_KB") MB / toplam $(mb "$TOPLAM_KB") MB · hedef $(mb "$HEDEF_KB") MB · sert $(mb "$SERT_KB") MB$KURU_ETIKET"
gunluk "-" "$(mb "$BOS_KB") MB bos" "BASLA hedef $(mb "$HEDEF_KB") MB sert $(mb "$SERT_KB") MB$KURU_ETIKET ek=$EK_SAYI"
[ "$KULLANIM_BOZUK" = 1 ] && gunluk "-" "-" "UYARI: surec taramasi eksik${TARAMA_NOT:+ ($TARAMA_NOT)} — her aday kullanimda sayilir (fail-closed)"

# ------------------------------------------------------------------ K0: kullanıcının açık yolları
if [ "$EK_SAYI" -gt 0 ]; then
  for e in "${EKLER[@]}"; do
    case "$e" in "~/"*) e="$H/${e#\~/}" ;; esac
    case "$e" in /*) isle "$e" "kullanici acikca verdi (--ek)" 1 ;; *) atla "$e" "mutlak yol degil" ;; esac
  done
fi

# ------------------------------------------------------------------ K1..K3 (en eski önce)
# K1+K2 rahatlık hedefine kadar; K3 yalnız sert eşiğin altında ve sert eşiğe kadar.
if ! hedefte; then
  SEKME="$(printf '\t')"
  while IFS="$SEKME" read -r -d '' katman _m neden y; do
    if [ "$katman" = 3 ]; then
      if hedefte || sert_ustunde; then gercek_olc; { hedefte || sert_ustunde; } && break; fi
    elif hedefte; then
      gercek_olc; hedefte && continue
    fi
    isle "$y" "$neden"
  done < <(adaylari_uret | sort -z -t "$SEKME" -k1,1n -k2,2n)
fi

# ------------------------------------------------------------------ sonuç
gercek_olc
DURUM=tamam; hedefte || DURUM=dar
YUZDE=0; [ "$TOPLAM_KB" -gt 0 ] && YUZDE=$(( BOS_KB * 100 / TOPLAM_KB ))
gunluk "-" "$(mb "$BOS_KB") MB bos" "BITTI silinen $(mb "$SILINEN_KB") MB · $SAYAC_SIL kalem · atlanan $SAYAC_ATLA · hedef $DURUM$KURU_ETIKET"
echo "SONUC bos_gb=$(( BOS_KB / 1048576 )) bos_yuzde=$YUZDE silinen_mb=$(mb "$SILINEN_KB") kalem=$SAYAC_SIL atlanan=$SAYAC_ATLA hedef=$DURUM tarama=$([ "$KULLANIM_BOZUK" = 1 ] && echo bozuk || echo tamam)"
[ "$DURUM" = tamam ] && exit 0 || exit 3
