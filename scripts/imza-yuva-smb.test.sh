#!/usr/bin/env bash
# imza-yuva-smb.test.sh — imza-yuva-smb.sh KURU kip testi. Gerçek yuvaya ve SMB'ye DOKUNMAZ:
# her senaryo kendi mkdtemp kökünde sahte yuva (<kök>/66902/windows.exe) ile koşar; İmpark
# (exe-create boşaltma + SFX) ve imza kuyruğu arka planda taklit edilir.
# Gerekenler: osslsigncode + openssl (tek kullanımlık test CA'sı), imzasız bir PE (varsayılan:
# electron-builder önbelleğindeki elevate.exe; başka dosya için TEST_PE=<exe>).
# Çalıştır: bash scripts/imza-yuva-smb.test.sh   (≈1 dk)
set -u
BETIK="$(cd "$(dirname "$0")" && pwd)/imza-yuva-smb.sh"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/imza-yuva-test.XXXXXX") || exit 1
trap 'kill $(jobs -p) 2>/dev/null; rm -rf "$TMP"' EXIT
PASS=0; FAIL=0; SON_LOG=/dev/null
sha() { shasum -a 256 "$1" 2>/dev/null | cut -c1-64; }
icerir() { grep -q -F "$2" "$1"; }
icermez() { ! grep -q -F "$2" "$1"; }
kontrol() { # kontrol <ad> <komut...>
  local ad="$1"; shift
  if "$@"; then PASS=$((PASS + 1)); echo "PASS  $ad"
  else
    FAIL=$((FAIL + 1)); echo "FAIL  $ad"; tail -4 "$SON_LOG" 2>/dev/null | sed 's/^/      | /'
  fi
}

# --- fikstür: imzasız PE, test CA'sı, bizim exe'nin imzalı hâli, bizim OLMAYAN imzalı exe ---
F="$TMP/fikstur"; mkdir -p "$F"; PE=""
for f in "${TEST_PE:-}" "$HOME"/Library/Caches/electron-builder/nsis/nsis-*/elevate.exe \
  "$HOME"/Library/Caches/electron-builder/nsis-*/*/elevate.exe; do
  [ -f "$f" ] && { PE="$f"; break; }
done
[ -n "$PE" ] || { echo "FAIL  fikstür: imzasız PE yok (TEST_PE=<exe> ver)"; exit 1; }
command -v osslsigncode >/dev/null && command -v openssl >/dev/null \
  || { echo "FAIL  fikstür: osslsigncode/openssl yok"; exit 1; }
osslsigncode remove-signature -in "$PE" -out "$F/kitap.exe" >/dev/null 2>&1 \
  || cp "$PE" "$F/kitap.exe"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$F/test.anahtar" -out "$F/test-ca.crt" -days 2 \
  -subj "/CN=Kuru Test Imzaci" -addext extendedKeyUsage=codeSigning \
  -addext keyUsage=digitalSignature >/dev/null 2>&1
imzala() { osslsigncode sign -certs "$F/test-ca.crt" -key "$F/test.anahtar" -in "$1" -out "$2" \
  >/dev/null 2>&1; }
imzala "$F/kitap.exe" "$F/kitap-imzali.exe"
cp "$F/kitap.exe" "$F/baska.exe" # tek baytı farklı: imzalanınca "bizim olmayan imzalı exe"
printf 'Z' | dd of="$F/baska.exe" bs=1 seek=4100 conv=notrunc 2>/dev/null
imzala "$F/baska.exe" "$F/baska-imzali.exe"
YEREL_SHA=$(sha "$F/kitap.exe")
[ -s "$F/kitap-imzali.exe" ] && [ -s "$F/baska-imzali.exe" ] \
  || { echo "FAIL  fikstür: test imzası üretilemedi"; exit 1; }
echo "fikstür: $(basename "$PE") $(stat -f %z "$F/kitap.exe") B" \
  "→ imzalı $(stat -f %z "$F/kitap-imzali.exe") B"

yeni_kok() { # yeni sahte kök; yuvada "eski" 152.704 B'lık dosya
  K=$(mktemp -d "$TMP/kok.XXXXXX"); mkdir -p "$K/66902"
  head -c 152704 /dev/urandom > "$K/66902/windows.exe"
}
kos() { # kos <log> <argümanlar...> — KURU kip, 0,5 sn aralık; CA/CN/TAVAN/TAVAN2/BOZ/SMB ortamdan
  SON_LOG="$1"; shift
  KURU=1 KURU_DIZIN="$K" ARALIK_SN=0.5 IMZA_CAFILE="${CA:-$F/test-ca.crt}" \
    IMZA_BEKLENEN_CN="${CN:-Kuru Test Imzaci}" TAVAN_SN="${TAVAN:-60}" TAVAN2_SN="${TAVAN2:-8}" \
    SMB_SHA="${SMB:-1}" KURU_TAKAS_BOZ="${BOZ:-0}" KURU_BOZ_DOSYA="${BOZ_DOSYA:-}" \
    TETIK="${TETIK:-0}" TETIK_KOMUTU="${TETIK_KOMUTU:-}" \
    EXE_REMOVE_KOMUTU="${EXE_REMOVE_KOMUTU:-}" BILDIR_KOMUTU="${BILDIR_KOMUTU:-}" \
    bash "$BETIK" "$@" > "$SON_LOG" 2>&1
}
sim() { # sim <imza aşamasında yazılacak dosya | +10k> <pencere 1|0> — İmpark + imza kuyruğu
  local y="$K/66902/windows.exe" i
  if [ "$2" = 1 ]; then
    sleep 1.5; rm -f "$y"                                             # exe-create boşaltır
    sleep 1; head -c 300000 /dev/urandom > "$y.tmp"; mv "$y.tmp" "$y" # İmpark SFX'i = pencere
  fi
  for i in $(seq 1 120); do [ "$(sha "$y")" = "$YEREL_SHA" ] && break; sleep 0.5; done
  [ "$(sha "$y")" = "$YEREL_SHA" ] || return 0 # takas hiç tutmadı: imza da gelmez
  sleep 1.5
  if [ "$1" = +10k ]; then { cat "$y"; head -c 10240 /dev/zero; } > "$y.tmp" # sahte "imza"
  else cp "$1" "$y.tmp"; fi
  mv "$y.tmp" "$y"
}
senaryo() { # senaryo <imza dosyası|+10k> <pencere 1|0> — hazirla + gözcü; rc → RC
  kos "$L.hazirla" hazirla "$F/kitap.exe" || { RC=99; return; }
  [ "$2" = 0 ] && cp "$F/kitap.exe" "$K/66902/windows.exe" # yuvada zaten bizim dosya
  sim "$1" "$2" & local s=$!
  kos "$L" bekle-ve-tak "$F/kitap.exe" ${HZ:+--hizli}; RC=$?
  kill "$s" 2>/dev/null; wait "$s" 2>/dev/null
}

# 1-3: kullanım ve kip kapıları (hiçbir yere yazmadan çıkmalı)
bash "$BETIK" >/dev/null 2>&1; kontrol "argümansız çağrı → çıkış 2" [ $? = 2 ]
SON_LOG="$TMP/l3"; KURU=1 bash "$BETIK" hazirla "$F/kitap.exe" > "$SON_LOG" 2>&1
kontrol "KURU_DIZIN'siz KURU → çıkış 2" [ $? = 2 ]
KURU=1 KURU_DIZIN="$HOME/Impark/kuru-test-yok" bash "$BETIK" hazirla "$F/kitap.exe" \
  > "$SON_LOG" 2>&1
kontrol "SMB yolunda KURU_DIZIN reddedilir" icerir "$SON_LOG" "SMB değil"

# 4: hazirla — kopya + geri okuma sha256
yeni_kok; L="$TMP/l4"; kos "$L" hazirla "$F/kitap.exe"; RC=$?
kontrol "hazirla → çıkış 0" [ $RC = 0 ]
kontrol "hazirla → _hazir kopyası sha256 eşit" [ "$(sha "$K/_hazir/kitap.exe")" = "$YEREL_SHA" ]
kontrol "hazirla → DOĞRULANDI satırı" icerir "$L" "DOĞRULANDI"

# 5: hazırlık yokken bekle-ve-tak reddedilir
yeni_kok; L="$TMP/l5"; kos "$L" bekle-ve-tak "$F/kitap.exe"; RC=$?
kontrol "hazırlıksız bekle-ve-tak → çıkış 2" [ $RC = 2 ]

# 6: mutlu yol — pencere → takas → imza → imzalı kopya
yeni_kok; L="$TMP/l6"; senaryo "$F/kitap-imzali.exe" 1
kontrol "mutlu yol → çıkış 0" [ $RC = 0 ]
kontrol "mutlu yol → pencere görüldü" icerir "$L" "PENCERE:"
kontrol "mutlu yol → takas geri okuma EŞİT" icerir "$L" "EŞİT"
kontrol "mutlu yol → imzalı kopya = imzalanan dosya" \
  [ "$(sha "$K/imzali/kitap-imzali.exe")" = "$(sha "$F/kitap-imzali.exe")" ]
kontrol "mutlu yol → boyut farkı yazıldı" icerir "$L" "B (+"
kontrol "mutlu yol → hazırlık dosyası yuvaya taşındı" [ ! -f "$K/_hazir/kitap.exe" ]

# 7: takas ilk denemede bozulur → yerelden yeniden kopya, 2. deneme tutar
yeni_kok; L="$TMP/l7"; BOZ=1 senaryo "$F/kitap-imzali.exe" 1
kontrol "takas 1 kez bozuk → çıkış 0" [ $RC = 0 ]
kontrol "takas 1 kez bozuk → 2. denemede EŞİT" icerir "$L" "takas 2/3: yuva geri okundu"

# 8: takas 3 denemede de bozulur → HATA 4
yeni_kok; L="$TMP/l8"; BOZ=3 senaryo "$F/kitap-imzali.exe" 1
kontrol "takas 3 kez bozuk → çıkış 4" [ $RC = 4 ]
kontrol "takas 3 kez bozuk → açık hata" icerir "$L" "3 denemede"

# 9: sahte imza (+10 KB) kabul edilmez, tavanda açık hata (TAVAN2=1: yeniden deneme testi değil, hızlı kalsın)
yeni_kok; L="$TMP/l9"; TAVAN=8 TAVAN2=1 senaryo +10k 0
kontrol "sahte +10 KB → tavan, çıkış 3" [ $RC = 3 ]
kontrol "sahte +10 KB → pe_is_signed reddi" icerir "$L" "sertifika dizini boş"
kontrol "sahte +10 KB → imzalı kopya YOK" [ ! -f "$K/imzali/kitap-imzali.exe" ]

# 10: imzalı ama bizim exe değil (pencere kaçtı) → HATA 4
yeni_kok; L="$TMP/l10"; senaryo "$F/baska-imzali.exe" 1
kontrol "başka exe imzalandı → çıkış 4" [ $RC = 4 ]
kontrol "başka exe imzalandı → gövde reddi" icerir "$L" "bizim exe DEĞİL"

# 11: güvenilmeyen zincir (CA yok) → osslsigncode verify reddi, tavan (TAVAN2=1: yeniden deneme testi değil)
yeni_kok; L="$TMP/l11"; CA=/dev/null TAVAN=8 TAVAN2=1 senaryo "$F/kitap-imzali.exe" 0
kontrol "CA'sız zincir → çıkış 3" [ $RC = 3 ]
kontrol "CA'sız zincir → verify RED" icerir "$L" "verify RED"

# 12: beklenmeyen imzacı → HATA 4
yeni_kok; L="$TMP/l12"; CN="Baska Firma" senaryo "$F/kitap-imzali.exe" 0
kontrol "yanlış imzacı → çıkış 4" [ $RC = 4 ]
kontrol "yanlış imzacı → imzacı reddi" icerir "$L" "imzacı 'Baska Firma' değil"

# 13: SMB_SHA=0 — takasta yalnız boyut (yavaş hat kipi); kimlik imza aşamasında gövdeyle
yeni_kok; L="$TMP/l13"; SMB=0 senaryo "$F/kitap-imzali.exe" 1
kontrol "SMB_SHA=0 → çıkış 0" [ $RC = 0 ]
kontrol "SMB_SHA=0 → takas yalnız boyutla" icerir "$L" "yuva geri okundu, boyut EŞİT"
kontrol "SMB_SHA=0 → imzalı kopya = imzalanan dosya" \
  [ "$(sha "$K/imzali/kitap-imzali.exe")" = "$(sha "$F/kitap-imzali.exe")" ]

# 14: imza takasın geri okumasından önce geldi → imzalının üzerine yeniden YAZILMAZ
yeni_kok; L="$TMP/l14"; BOZ=1 BOZ_DOSYA="$F/kitap-imzali.exe" senaryo "$F/kitap-imzali.exe" 1
kontrol "imza erken → çıkış 0" [ $RC = 0 ]
kontrol "imza erken → takas tekrarlanmadı" icerir "$L" "takas tekrarlanmaz"
kontrol "imza erken → 2. takas denemesi YOK" icermez "$L" "takas 2/3"

# --- hızlı kontrol (İNDİRMEDEN) — fikstürler ---
hk() { # hk <log> <dosya> [<orijinal>] — IMZA_BEKLENEN_CN ortamdan (CN), rc → RC
  SON_LOG="$1"; shift
  IMZA_BEKLENEN_CN="${CN-Kuru Test Imzaci}" bash "$BETIK" hizli-kontrol "$@" > "$SON_LOG" 2>&1
  RC=$?
}
okunan() { grep -o "SMB'den okunan [0-9]*" "$1" | grep -o '[0-9]*$'; }
{ cat "$F/kitap.exe"; head -c 3145728 /dev/urandom; } > "$F/buyuk.exe" # 3 MB kaplama (overlay)
imzala "$F/buyuk.exe" "$F/buyuk-imzali.exe"
cp "$F/buyuk.exe" "$F/buyuk-bozuk.exe"
printf 'Q' | dd of="$F/buyuk-bozuk.exe" bs=1 seek=500000 conv=notrunc 2>/dev/null
{ cat "$F/kitap.exe"; head -c 10240 /dev/zero; } > "$F/sahte10k.exe"
{ cat "$F/kitap-imzali.exe"; printf 'yarim'; } > "$F/fazla.exe"

L="$TMP/h1"; hk "$L" "$F/kitap-imzali.exe" "$F/kitap.exe"
kontrol "hızlı: imzalı + orijinal → çıkış 0" [ $RC = 0 ]
kontrol "hızlı: 'İMZALI ve BİZİM'" icerir "$L" "İMZALI ve BİZİM"
L="$TMP/h2"; hk "$L" "$F/kitap-imzali.exe" "$F/baska.exe"
kontrol "hızlı: başka orijinal → çıkış 4" [ $RC = 4 ]
L="$TMP/h3"; hk "$L" "$F/kitap.exe"
kontrol "hızlı: imzasız → çıkış 3" [ $RC = 3 ]
L="$TMP/h4"; hk "$L" "$F/sahte10k.exe"
kontrol "hızlı: sahte +10 KB → çıkış 3" [ $RC = 3 ]
L="$TMP/h5"; hk "$L" "$F/fazla.exe"
kontrol "hızlı: ofset+boyut ≠ dosya → çıkış 3" [ $RC = 3 ]
kontrol "hızlı: ofset+boyut ≠ dosya → 'yarım'" icerir "$L" "yarım"
L="$TMP/h6"; CN="" hk "$L" "$F/kitap-imzali.exe"
kontrol "hızlı: imzacı İm Park değil → çıkış 4" [ $RC = 4 ]
L="$TMP/h7"; hk "$L" "$F/buyuk-imzali.exe" "$F/buyuk.exe"
kontrol "hızlı: 3 MB, ilk 1 MB + 3×256 KB → çıkış 0" [ $RC = 0 ]
kontrol "hızlı: 3 MB → 4 aralık karşılaştırıldı" \
  [ "$(grep 'gövde örneği' "$L" | tr ',' '\n' | grep -c '+')" = 4 ]
kontrol "hızlı: 3 MB → okunan < 2 MB ($(okunan "$L") B)" [ "$(okunan "$L")" -lt 2097152 ]
L="$TMP/h8"; hk "$L" "$F/buyuk-imzali.exe" "$F/buyuk-bozuk.exe"
kontrol "hızlı: ilk 1 MB'ta tek bayt farkı → çıkış 4" [ $RC = 4 ]

DC="${TEST_DIGICERT_EXE:-$HOME/.cache/imza-yuva-smb/66902-imzali-20260918.exe}"
if [ -f "$DC" ]; then # 18.09 İm Park/DigiCert imzalı test exe'sinin YEREL kopyası
  osslsigncode remove-signature -in "$DC" -out "$F/dc-imzasiz.exe" >/dev/null 2>&1
  head -c 142249 "$F/dc-imzasiz.exe" > "$F/dc-orj.exe" # 18.09 özgün boyut (hizalama 7 B)
  L="$TMP/d1"; CN="" hk "$L" "$DC"
  kontrol "DigiCert: çıkış 0" [ $RC = 0 ]
  kontrol "DigiCert: ofset 142256 boyut 10448" icerir "$L" "ofset 142256 boyut 10448"
  kontrol "DigiCert: imzacı İm Park" icerir "$L" "imzacı İm Park Bilişim Elektronik"
  kontrol "DigiCert: zaman damgası 2026-09-18 14:39:41" icerir "$L" "2026-09-18 14:39:41 UTC"
  L="$TMP/d2"; CN="" hk "$L" "$DC" "$F/dc-orj.exe"
  kontrol "DigiCert: 142.249 B orijinal → İMZALI ve BİZİM" icerir "$L" "İMZALI ve BİZİM"
  L="$TMP/d3"; CN="" hk "$L" "$DC" "$F/kitap.exe"
  kontrol "DigiCert: yanlış orijinal → çıkış 4" [ $RC = 4 ]
else echo "ATLA  DigiCert fikstürü yok: $DC"; fi
NS=$(ls "$HOME"/Downloads/Windows/SM2-WIN-NSIS-20260925/*.exe 2>/dev/null | head -1)
if [ -n "$NS" ]; then # imzasız gerçek NSIS kurulumu (yüzlerce MB) — yalnız başlık okunur
  L="$TMP/n1"; CN="" hk "$L" "$NS"
  kontrol "NSIS imzasız → çıkış 3" [ $RC = 3 ]
  kontrol "NSIS → yalnız başlık okundu ($(okunan "$L") B)" [ "$(okunan "$L")" -le 4096 ]
else echo "ATLA  imzasız NSIS örneği yok"; fi

# --- bekle-ve-tak --hizli: imzalı dosya İNDİRİLMEZ ---
yeni_kok; L="$TMP/l15"; HZ=1 senaryo "$F/kitap-imzali.exe" 1
kontrol "--hizli mutlu yol → çıkış 0" [ $RC = 0 ]
kontrol "--hizli → indirmeden kabul" icerir "$L" "İMZALI ve BİZİM"
kontrol "--hizli → yerel imzali/ kopyası YOK" [ ! -e "$K/imzali" ]
yeni_kok; L="$TMP/l16"; HZ=1 senaryo "$F/baska-imzali.exe" 1
kontrol "--hizli başka exe → çıkış 4" [ $RC = 4 ]

# --- toplu: önce hepsi hazırlanır, sonra sırayla tetik → takas → imza → _imzali ---
mkdir -p "$F/toplu"; : > "$F/liste.txt"
for i in 1 2 3; do
  cp "$F/kitap.exe" "$F/toplu/p$i.exe"
  printf "$i" | dd of="$F/toplu/p$i.exe" bs=1 seek=$((4100 + i)) conv=notrunc 2>/dev/null
  imzala "$F/toplu/p$i.exe" "$F/toplu/p$i-imzali"; echo "$F/toplu/p$i.exe" >> "$F/liste.txt"
done
sim_toplu() { # sim_toplu <tetik|log> <imzalı...> — her tur: işaret → boşalt+SFX → imzalı
  local y="$K/66902/windows.exe" mod="$1" i=0 d s b; shift
  for d in "$@"; do
    i=$((i + 1))
    for s in $(seq 1 240); do
      if [ "$mod" = tetik ]; then b=$(cat "$K/tetik.say" 2>/dev/null | wc -l | tr -d ' ')
      else b=$(grep -c 'PENCERE BEKLENİYOR' "$L" 2>/dev/null); fi
      [ "${b:-0}" -ge "$i" ] && break; sleep 0.25
    done
    sleep 1; rm -f "$y"; sleep 0.5; head -c 300000 /dev/urandom > "$y.tmp"; mv "$y.tmp" "$y"
    for s in $(seq 1 240); do # bizim dosya yuvaya gelsin
      b=$(stat -f %z "$y" 2>/dev/null || echo 0); [ "$b" != 300000 ] && [ "$b" != 0 ] && break
      sleep 0.25
    done
    sleep 1; cp "$d" "$y.tmp"; mv "$y.tmp" "$y"
  done
}
yeni_kok; L="$TMP/t1"; T="$F/toplu"
sim_toplu tetik "$T/p1-imzali" "$T/p2-imzali" "$T/p3-imzali" & SIM=$!
TETIK=1 TETIK_KOMUTU="echo tetik >> $K/tetik.say" kos "$L" toplu "$F/liste.txt"; RC=$?
kill "$SIM" 2>/dev/null; wait "$SIM" 2>/dev/null
kontrol "toplu 3 paket (TETIK=1 sahte) → çıkış 0" [ $RC = 0 ]
kontrol "toplu → tetik 3 kez çalıştı" [ "$(wc -l < "$K/tetik.say" | tr -d ' ')" = 3 ]
son_hazir=$(grep -n 'HAZIR —' "$L" | tail -1 | cut -d: -f1)
ilk_tur=$(grep -n -m1 'TOPLU 1/3' "$L" | cut -d: -f1)
hepsi_once() { [ "$(grep -c 'HAZIR —' "$L")" = 3 ] && [ "${son_hazir:-99}" -lt "${ilk_tur:-0}" ]; }
kontrol "toplu → önce hepsi hazırlandı (3 HAZIR, sonra 1. tur)" hepsi_once
kontrol "toplu → _imzali/p1..p3 = imzalanan dosyalar" [ \
  "$(sha "$K/_imzali/p1.exe")$(sha "$K/_imzali/p2.exe")$(sha "$K/_imzali/p3.exe")" = \
  "$(sha "$T/p1-imzali")$(sha "$T/p2-imzali")$(sha "$T/p3-imzali")" ]
kontrol "toplu → özet satırı ×3 (pencere/imza süresi)" \
  [ "$(grep -c 'pencere +[0-9]*s · imza +[0-9]*s · İMZALI' "$L")" = 3 ]
kontrol "toplu → TOPLU TAMAM" icerir "$L" "TOPLU TAMAM: 3/3"

yeni_kok; L="$TMP/t2"
sim_toplu log "$T/p1-imzali" "$F/baska-imzali.exe" "$T/p3-imzali" & SIM=$!
kos "$L" toplu "$F/liste.txt"; RC=$?; kill "$SIM" 2>/dev/null; wait "$SIM" 2>/dev/null
kontrol "toplu 2. paket düşer → çıkış 4" [ $RC = 4 ]
kontrol "toplu düşüş → tetik yalnız yazdırıldı" icerir "$L" "TETİK — AYRI terminalde"
yalniz_p1() { [ -f "$K/_imzali/p1.exe" ] && [ ! -e "$K/_imzali/p2.exe" ] \
  && [ ! -e "$K/_imzali/p3.exe" ]; }
kontrol "toplu düşüş → yalnız p1 _imzali'de" yalniz_p1
kontrol "toplu düşüş → özet DÜŞTÜ" icerir "$L" "p2.exe · pencere"
kontrol "toplu düşüş → 3. pakete geçilmedi" icermez "$L" "TOPLU 3/3"

yeni_kok; L="$TMP/t3"; TETIK=1 kos "$L" toplu "$F/liste.txt"; RC=$?
kontrol "KURU TETIK=1 sahte komutsuz → çıkış 2 (canlı tetik YOK)" [ $RC = 2 ]
kontrol "KURU TETIK=1 sahte komutsuz → hiçbir şey hazırlanmadı" [ ! -e "$K/_hazir" ]
printf '%s\n%s\n' "$F/toplu/p1.exe" "$F/toplu/p1.exe" > "$F/cift.txt"
yeni_kok; L="$TMP/t4"; kos "$L" toplu "$F/cift.txt"; RC=$?
kontrol "toplu aynı adlı iki exe → çıkış 2" [ $RC = 2 ]

# --- imza bekleme kuralı: tavan dolunca yuva temizlenir, BİR KEZ yeniden denenir (2. tavan) ---
# exe-remove ve bildir CANLI'de gerçek yayincilikadm/bildir'e SABİT bağlıdır (koda gömülü);
# burada yalnız KURU test kancaları (EXE_REMOVE_KOMUTU/BILDIR_KOMUTU) kullanılır.
bildir_fake_kur() { # $1 dizin — sahte `bildir`: her çağrıyı $1/bildir.say'e ekler
  cat > "$1/bildir" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$(dirname "$0")/bildir.say"
EOF
  chmod +x "$1/bildir"
}
er_fake() { printf "rm -f '%s/66902/windows.exe'; echo x >> '%s/exeremove.say'" "$K" "$K"; }
sim_retry() { # sim_retry <imzali dosya> — EXE_REMOVE_KOMUTU çağrılana (marker) kadar hiç yazmaz,
              # sonra normal sim() akışını (pencere → [script takas eder] → imza) uygular
  local i
  for i in $(seq 1 480); do [ -s "$K/exeremove.say" ] && break; sleep 0.25; done
  sim "$1" 1
}

# (i) 1. denemede imza gelmez, 2. denemede gelir: başarı, exe-remove 1 kez, _imzali dolu, bildirim YOK
yeni_kok; L="$TMP/ri1"; printf '%s\n' "$F/kitap.exe" > "$TMP/ri1-liste.txt"; bildir_fake_kur "$K"
sim_retry "$F/kitap-imzali.exe" & SIM=$!
TAVAN=3 TAVAN2=15 EXE_REMOVE_KOMUTU="$(er_fake)" BILDIR_KOMUTU="$K/bildir" \
  kos "$L" toplu "$TMP/ri1-liste.txt"; RC=$?
kill "$SIM" 2>/dev/null; wait "$SIM" 2>/dev/null
kontrol "(i) 1. deneme tavanı dolar, 2. denemede gelir → çıkış 0" [ $RC = 0 ]
kontrol "(i) exe-remove tam 1 kez çağrıldı" [ "$(wc -l < "$K/exeremove.say" | tr -d ' ')" = 1 ]
kontrol "(i) _imzali/kitap.exe dolu" [ -f "$K/_imzali/kitap.exe" ]
kontrol "(i) bildirim YOK" [ ! -s "$K/bildir.say" ]
kontrol "(i) log → YENİDEN DENEME görüldü" icerir "$L" "YENİDEN DENEME"

# (ii) iki denemede de gelmez: çıkış 3, bildirim 1 kez, _imzali boş, exe-remove çağrılmış
yeni_kok; L="$TMP/ri2"; printf '%s\n' "$F/kitap.exe" > "$TMP/ri2-liste.txt"; bildir_fake_kur "$K"
TAVAN=3 TAVAN2=3 EXE_REMOVE_KOMUTU="$(er_fake)" BILDIR_KOMUTU="$K/bildir" \
  kos "$L" toplu "$TMP/ri2-liste.txt"; RC=$?
kontrol "(ii) iki denemede de gelmez → çıkış 3" [ $RC = 3 ]
kontrol "(ii) bildirim tam 1 kez" [ "$(wc -l < "$K/bildir.say" | tr -d ' ')" = 1 ]
kontrol "(ii) bildirim mesajı ad + yuva id + süre" \
  icerir "$K/bildir.say" "kitap.exe: 66902 imza kuyruğu 2 denemede imzalamadı (180+60 dk)"
kontrol "(ii) exe-remove tam 1 kez (2. denemeden sonra tekrar YOK)" \
  [ "$(wc -l < "$K/exeremove.say" | tr -d ' ')" = 1 ]
kontrol "(ii) _imzali boş" [ ! -e "$K/_imzali/kitap.exe" ]

# (iii) 1. denemede gelir: yeniden deneme ve bildirim yok
yeni_kok; L="$TMP/ri3"; printf '%s\n' "$F/kitap.exe" > "$TMP/ri3-liste.txt"; bildir_fake_kur "$K"
sim "$F/kitap-imzali.exe" 1 & SIM=$!
EXE_REMOVE_KOMUTU="$(er_fake)" BILDIR_KOMUTU="$K/bildir" kos "$L" toplu "$TMP/ri3-liste.txt"; RC=$?
kill "$SIM" 2>/dev/null; wait "$SIM" 2>/dev/null
kontrol "(iii) 1. denemede gelir → çıkış 0" [ $RC = 0 ]
kontrol "(iii) yeniden deneme YOK" icermez "$L" "YENİDEN DENEME"
kontrol "(iii) bildirim YOK" [ ! -e "$K/bildir.say" ]
kontrol "(iii) exe-remove ÇAĞRILMADI" [ ! -e "$K/exeremove.say" ]

# (iv) toplu kipte 2 paket: 1.'si (i) senaryosu (retry'li başarı), 2.'si (iii) senaryosu (düz başarı)
yeni_kok; L="$TMP/ri4"; printf '%s\n%s\n' "$T/p1.exe" "$T/p2.exe" > "$TMP/ri4-liste.txt"
bildir_fake_kur "$K"
( y="$K/66902/windows.exe"
  for i in $(seq 1 480); do [ -s "$K/exeremove.say" ] && break; sleep 0.25; done
  sleep 0.3; rm -f "$y"; sleep 0.5; head -c 300000 /dev/urandom > "$y.tmp"; mv "$y.tmp" "$y"
  for i in $(seq 1 240); do # takas: bizim (p1) dosya yuvaya girsin (300000 de 0 da değil)
    b=$(stat -f %z "$y" 2>/dev/null || echo 0); [ "$b" != 300000 ] && [ "$b" != 0 ] && break
    sleep 0.25
  done
  sleep 1; cp "$T/p1-imzali" "$y.tmp"; mv "$y.tmp" "$y"          # paket1 imzalandı
  for i in $(seq 1 240); do [ ! -e "$y" ] && break; sleep 0.25; done # paket1 _imzali'ye taşınana kadar
  sleep 1; rm -f "$y"; sleep 0.5; head -c 300000 /dev/urandom > "$y.tmp"; mv "$y.tmp" "$y" # paket2 penceresi
  for i in $(seq 1 240); do
    b=$(stat -f %z "$y" 2>/dev/null || echo 0); [ "$b" != 300000 ] && [ "$b" != 0 ] && break
    sleep 0.25
  done
  sleep 1; cp "$T/p2-imzali" "$y.tmp"; mv "$y.tmp" "$y"          # paket2 imzalandı
) & SIM=$!
TAVAN=6 TAVAN2=15 EXE_REMOVE_KOMUTU="$(er_fake)" BILDIR_KOMUTU="$K/bildir" \
  kos "$L" toplu "$TMP/ri4-liste.txt"; RC=$?
kill "$SIM" 2>/dev/null; wait "$SIM" 2>/dev/null
kontrol "(iv) toplu 2 paket (1. retry'li, 2. düz) → çıkış 0" [ $RC = 0 ]
kontrol "(iv) exe-remove tam 1 kez (yalnız paket1)" [ "$(wc -l < "$K/exeremove.say" | tr -d ' ')" = 1 ]
kontrol "(iv) bildirim YOK" [ ! -e "$K/bildir.say" ]
kontrol "(iv) _imzali/p1+p2 = imzalanan dosyalar" [ \
  "$(sha "$K/_imzali/p1.exe")$(sha "$K/_imzali/p2.exe")" = \
  "$(sha "$T/p1-imzali")$(sha "$T/p2-imzali")" ]
kontrol "(iv) TOPLU TAMAM: 2/2" icerir "$L" "TOPLU TAMAM: 2/2"

# (v) tavan argümanları: --tavan-dk / --tavan2-dk (TAVAN_SN/TAVAN2_SN env verilmezse dakikadan hesaplanır)
yeni_kok; L="$TMP/ri5a"
KURU=1 KURU_DIZIN="$K" ARALIK_SN=0.3 IMZA_CAFILE="$F/test-ca.crt" IMZA_BEKLENEN_CN="Kuru Test Imzaci" \
  bash "$BETIK" hazirla "$F/kitap.exe" >/dev/null 2>&1
( KURU=1 KURU_DIZIN="$K" ARALIK_SN=0.3 IMZA_CAFILE="$F/test-ca.crt" IMZA_BEKLENEN_CN="Kuru Test Imzaci" \
  bash "$BETIK" bekle-ve-tak "$F/kitap.exe" --tavan-dk 1 --tavan2-dk 3 > "$L" 2>&1 ) & PID=$!
sleep 1; kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null
kontrol "(v) --tavan-dk 1 (TAVAN_SN env yok) → 1. deneme tavanı 60 sn" \
  icerir "$L" "tavan 60 sn (bu deneme)"

yeni_kok; L="$TMP/ri5b"
KURU=1 KURU_DIZIN="$K" ARALIK_SN=0.3 IMZA_CAFILE="$F/test-ca.crt" IMZA_BEKLENEN_CN="Kuru Test Imzaci" \
  bash "$BETIK" hazirla "$F/kitap.exe" >/dev/null 2>&1
( KURU=1 KURU_DIZIN="$K" ARALIK_SN=0.3 IMZA_CAFILE="$F/test-ca.crt" IMZA_BEKLENEN_CN="Kuru Test Imzaci" \
  TAVAN_SN=1 EXE_REMOVE_KOMUTU="$(er_fake)" \
  bash "$BETIK" bekle-ve-tak "$F/kitap.exe" --tavan-dk 1 --tavan2-dk 2 > "$L" 2>&1 ) & PID=$!
sleep 3; kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null
kontrol "(v) --tavan2-dk 2 (TAVAN2_SN env yok) → 2. deneme tavanı 120 sn" \
  icerir "$L" "tavan 120 sn (bu deneme)"
kontrol "(v) --tavan-dk/--tavan2-dk yanlış değer → çıkış 2" bash -c \
  'KURU=1 bash "$0" bekle-ve-tak "$1" --tavan2-dk abc >/dev/null 2>&1; [ $? = 2 ]' "$BETIK" "$F/kitap.exe"

echo "SONUÇ: $PASS PASS / $FAIL FAIL"
[ "$FAIL" = 0 ]
