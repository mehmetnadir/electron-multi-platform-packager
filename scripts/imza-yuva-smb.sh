#!/usr/bin/env bash
# imza-yuva-smb.sh — 66902 imza yuvasını SMB üzerinden besleyen gözcü (Mac, İmpark VPN açık).
# Kullanım:
#   imza-yuva-smb.sh hazirla <yerel.exe> [--kuru]
#   imza-yuva-smb.sh bekle-ve-tak <yerel.exe> [--tavan-dk 20] [--hizli] [--kuru]
#   imza-yuva-smb.sh hizli-kontrol <smb-yol> [<yerel-orijinal.exe>]  (İNDİRMEDEN, salt okuma)
#   imza-yuva-smb.sh toplu <liste.txt> [--tavan-dk 20] [--kuru]  (satır başına bir yerel exe)
# Çıkış: 0 tamam · 2 kullanım/ön koşul · 3 tavan ya da imzasız · 4 takas/imza kimliği HATA
# Ayrıntı: scripts/OKU-imza-yuva-smb.md · yöntem: ~/.claude/skills/exe-imzalama/SKILL.md
set -u

YUVA_ID=66902 # SABİT: başka kitabın yuvası bu betikle asla hedeflenmez
CANLI_KOK="$HOME/Impark/Storage7/vhosts/akillitahta.ydspublishing.com/httpdocs/Uploads"
CANLI_KOK="$CANLI_KOK/KitapTekExe"
ARALIK_SN="${ARALIK_SN:-2}"; SMB_SHA="${SMB_SHA:-1}" # SMB_SHA=0: takasta yalnız boyut
PY=/usr/bin/python3 # sistem python'u (TCC kimliği kararlı)
log() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"; }
hata() { log "HATA: $2" >&2; exit "$1"; }
ms() { perl -MTime::HiRes=time -e 'printf("%d\n", time() * 1000)'; }
boyut() { stat -f %z "$1" 2>/dev/null; }
smb_mi() { case "$1" in ''|"$HOME"/Impark*|/Volumes/*) return 0 ;; esac; return 1; }
ayni_mi() { # $1 bizim exe mi? boyut + (SMB_SHA=1 ise) F_NOCACHE ile tam sha256 geri okuma
  [ "$(boyut "$1")" = "$YEREL_BOYUT" ] || return 1
  [ "$SMB_SHA" = 0 ] || [ "$(py sha "$1")" = "$YEREL_SHA" ]; }
iz() { stat -f '%z/%m' "$1" 2>/dev/null || echo yok; } # boyut/mtime izi
hiz() { awk -v b="$1" -v m="$2" 'BEGIN { if (m < 1) m = 1
  printf "%.2f sn, %.1f MB/s", m / 1000, b / 1048576 / (m / 1000) }'; }
py() { # py sha|imzali <f> · py govde <yerel> <imzali> · py hizli <smb> [<orijinal>]
  "$PY" - "$@" <<'PYEOF'
import sys, os, hashlib, fcntl, re, time, random, subprocess, tempfile
def ac(p):  # F_NOCACHE: SMB'de sayfa önbelleği değil sunucunun kendisi okunur
    f = open(p, "rb")
    try: fcntl.fcntl(f.fileno(), fcntl.F_NOCACHE, 1)
    except (OSError, AttributeError): pass
    return f
def ofsb(h):  # başlık tamponundan (PE checksum, sertifika dizini girdisi) konumları
    if h[:2] != b"MZ": return None
    e = int.from_bytes(h[0x3C:0x40], "little")
    if h[e:e + 4] != b"PE\0\0": return None
    dd = {0x10B: 96, 0x20B: 112}.get(int.from_bytes(h[e + 24:e + 26], "little"))
    return None if dd is None else (e + 88, e + 24 + dd + 32)
def dizin(h, o):  # data directory[4] = (dosya ofseti, boyut)
    u = lambda i: int.from_bytes(h[i:i + 4], "little")
    return u(o[1]), u(o[1] + 4)
def maske(h, o):  # imzalamada değişen iki başlık alanı sıfırlanır
    h = bytearray(h)
    for p, l in ((o[0], 4), (o[1], 8)): h[p:p + l] = bytes(l)
    return bytes(h)
k, a = sys.argv[1], sys.argv[2]
if k == "sha":
    h = hashlib.sha256()
    with ac(a) as f:
        for b in iter(lambda: f.read(8 << 20), b""): h.update(b)
    print(h.hexdigest())
elif k == "imzali":  # yayincilikadm r2_publish.pe_is_signed ile aynı ölçüt (VA ve boyut dolu)
    with open(a, "rb") as f: h = f.read(4096)
    o = ofsb(h); print("evet" if o and all(dizin(h, o)) else "hayir")
elif k == "govde":  # imzalı dosya bizim exe'mizin imzalanmış hâli mi? (bayt bayt, tam okuma)
    b = sys.argv[3]; n = os.path.getsize(a)
    with ac(a) as fa, ac(b) as fb:
        ha, hb = fa.read(4096), fb.read(4096); o = ofsb(ha); m = len(ha)
        ok = bool(o) and ofsb(hb) == o and os.path.getsize(b) > n
        ok = ok and maske(ha, o) == maske(hb[:m], o); fb.seek(m)
        while ok and fa.tell() < n:
            x = fa.read(8 << 20); ok = x == fb.read(len(x))
    print("evet" if ok else "hayir")
elif k == "hizli":  # İNDİRMEDEN: başlık + WIN_CERTIFICATE + (orijinal varsa) <2 MB örnek
    t0 = time.monotonic(); n = os.path.getsize(a); orj = sys.argv[3] if len(sys.argv) > 3 else ""
    f = ac(a); oku = [0]
    def at(p, c):
        f.seek(p); d = f.read(c); oku[0] += len(d); return d
    def son(rc, m):
        print(f"hızlı: {m}")
        print(f"hızlı: SMB'den okunan {oku[0]} B / {n} B, {time.monotonic() - t0:.2f} sn")
        sys.exit(rc)
    h = at(0, 4096); o = ofsb(h)
    if not o: son(3, "PE değil")
    va, sz = dizin(h, o)
    print(f"hızlı: sertifika dizini ofset {va} boyut {sz} · dosya {n} B")
    if not (va and sz): son(3, "İMZASIZ (sertifika dizini boş)")
    if va + sz != n: son(3, f"İMZASIZ ya da yarım: ofset+boyut {va + sz} ≠ dosya {n}")
    w = at(va, sz); L = int.from_bytes(w[:4], "little")
    if not 8 < L <= sz or w[6:8] != b"\x02\x00": son(3, "WIN_CERTIFICATE PKCS#7 değil")
    with tempfile.NamedTemporaryFile(suffix=".der") as t:
        t.write(w[8:L]); t.flush()
        r = subprocess.run(["openssl", "pkcs7", "-inform", "DER", "-in", t.name, "-print_certs",
                            "-text", "-noout"], capture_output=True, text=True, errors="replace")
    def cn(bl):
        m = re.search(r"Subject:.*?CN ?= ?([^,\n]+)", bl); s = m.group(1).strip() if m else "?"
        return re.sub(r"(?:\\x[0-9A-Fa-f]{2})+", lambda x: bytes.fromhex(
            x.group(0).replace("\\x", "")).decode("utf-8", "replace"), s)
    bl = r.stdout.split("\nCertificate:"); kod = [b for b in bl if "Code Signing" in b]
    imzaci = cn(([b for b in kod if "CA:TRUE" not in b] or kod or bl)[0])
    z = re.search(rb"\x18[\x0f-\x17](\d{14})", w) or \
        re.search(rb"\x2a\x86\x48\x86\xf7\x0d\x01\x09\x05\x31.\x17\x0d(\d{12})Z", w, re.S)
    s = z.group(1).decode() if z else ""; s = "20" + s if len(s) == 12 else s
    ts = f"{s[:4]}-{s[4:6]}-{s[6:8]} {s[8:10]}:{s[10:12]}:{s[12:]} UTC" if s else "YOK"
    print(f"hızlı: imzacı {imzaci} · zaman damgası {ts}")
    bek = os.environ.get("IMZA_BEKLENEN_CN") or "İm Park Bilişim"
    if bek not in imzaci: son(4, f"imzalı ama imzacı beklenen '{bek}' değil")
    if orj:  # imzalama dosyayı 8 bayta hizalar (ölçüldü: 142.249 → ofset 142.256)
        m = os.path.getsize(orj); g = open(orj, "rb"); q = 256 << 10
        if not m <= va < m + 8 or ofsb(g.read(4096)) != o:
            son(4, f"imzalı ama bizim değil: ofset {va}, orijinal {m} B (≤7 B hizalama beklenir)")
        if at(m, va - m).strip(b"\0"): son(4, "imzalı ama bizim değil: hizalama baytları dolu")
        ar = [(0, min(1 << 20, m))]
        if m > (1 << 20) + q:
            ar += sorted((random.SystemRandom().randrange(1 << 20, m - q), q) for _ in range(3))
        for p, c in ar:
            g.seek(p); x, y = g.read(c), at(p, c)
            if p == 0: x, y = maske(x, o), maske(y, o)
            if x != y: son(4, f"imzalı ama bizim değil: {p}+{c} aralığı farklı")
        print("hızlı: gövde örneği eşit — " + ", ".join(f"{p}+{c}" for p, c in ar))
    son(0, "İMZALI" + (" ve BİZİM" if orj else "") + f" ({imzaci})")
PYEOF
}

# --- argümanlar ve kip ---
KOMUT="${1:-}"
if [ "$KOMUT" = hizli-kontrol ]; then # salt okuma: kip, hazırlık, tetik YOK
  [ -f "${2:-}" ] || hata 2 "dosya yok: ${2:-}"
  [ -z "${3:-}" ] || [ -f "$3" ] || hata 2 "orijinal yok: $3"
  py hizli "$2" ${3:+"$3"}; exit
fi
YEREL="${2:-}"; [ $# -ge 2 ] && shift 2 || set --
KURU="${KURU:-0}"; TAVAN_DK=20; HIZLI=0; TOPLU=0; SURE_DOSYA=""
while [ $# -gt 0 ]; do
  case "$1" in --kuru) KURU=1 ;; --hizli) HIZLI=1 ;; --tavan-dk) TAVAN_DK="${2:-}"; shift ;;
    *) hata 2 "bilinmeyen seçenek: $1" ;; esac; shift
done
case "$KOMUT" in hazirla|bekle-ve-tak|toplu) ;; *) sed -n '3,7p' "$0" >&2; exit 2 ;; esac
[ -f "$YEREL" ] || hata 2 "dosya yok: $YEREL"
case "$TAVAN_DK" in ''|*[!0-9]*) hata 2 "--tavan-dk tamsayı olmalı" ;; esac
TAVAN_SN="${TAVAN_SN:-$((TAVAN_DK * 60))}"
if [ "$KURU" = 1 ]; then # yalnız yerel mkdtemp; SMB yolu reddedilir; tetik yalnız sahte
  smb_mi "${KURU_DIZIN:-}" && hata 2 "KURU: yerel KURU_DIZIN şart (SMB değil)"
  [ -d "$KURU_DIZIN" ] || hata 2 "KURU_DIZIN yok: $KURU_DIZIN"
  smb_mi "$(cd "$KURU_DIZIN" && pwd -P)" && hata 2 "KURU_DIZIN SMB'ye çıkıyor"
  KOK="$KURU_DIZIN"; HAZIR_DIZIN="$KOK/_hazir"; IMZALI_DIZIN="$KOK/imzali"
  TETIK_KOMUTU="${TETIK_KOMUTU:-}"
  log "KURU KİP — sahte kök: $KOK"
else
  KOK="$CANLI_KOK"; HAZIR_DIZIN="${HAZIR_DIZIN:-$KOK/_hazir}"
  IMZALI_DIZIN="${IMZALI_DIZIN:-$(cd "$(dirname "$YEREL")" && pwd)/imzali}"
  unset IMZA_CAFILE IMZA_BEKLENEN_CN KURU_TAKAS_BOZ KURU_BOZ_DOSYA # test ayarları CANLIda yok
  TETIK_KOMUTU="yayincilikadm book exe-create $YUVA_ID --wait 0" # SABİT
  log "CANLI KİP — yuva: $KOK/$YUVA_ID/windows.exe"
  sleep 5
fi
case "$HAZIR_DIZIN/" in *"/$YUVA_ID/"*) hata 2 "hazırlık dizini yuva klasöründe olamaz" ;; esac
YUVA="$KOK/$YUVA_ID/windows.exe"; TETIK_LOG="${TMPDIR:-/tmp}/imza-yuva-tetik-$$.log"

hedef() { # işlenecek exe'yi seçer
  YEREL="$1"; AD="$(basename "$1")"; HAZIR="$HAZIR_DIZIN/$AD"
  YEREL_BOYUT=$(boyut "$1"); YEREL_SHA=$(py sha "$1"); }

hazirla() { # yerel → aynı paylaşımda _hazir/<ad>; geri okuyup boyut+sha256 doğrular
  local t0 t1 t2 b s
  mkdir -p "$HAZIR_DIZIN" || hata 2 "hazırlık dizini açılamadı: $HAZIR_DIZIN"
  log "hazırla: $AD ($YEREL_BOYUT B, sha256 ${YEREL_SHA:0:16}…) → $HAZIR"
  t0=$(ms); cp "$YEREL" "$HAZIR.kopyalaniyor" || hata 4 "kopyalama başarısız"
  mv -f "$HAZIR.kopyalaniyor" "$HAZIR" || hata 4 "adlandırma başarısız"
  t1=$(ms); b=$(boyut "$HAZIR"); s=$(py sha "$HAZIR"); t2=$(ms)
  log "kopya: $(hiz "$YEREL_BOYUT" $((t1 - t0))) · geri okuma+sha256: $(hiz "$b" $((t2 - t1)))"
  [ "$b" = "$YEREL_BOYUT" ] && [ "$s" = "$YEREL_SHA" ] \
    || hata 4 "geri okuma tutmadı (boyut ${b:-yok}, sha256 ${s:0:16}…)"
  log "HAZIR — boyut+sha256 DOĞRULANDI: $HAZIR"
}

takas() { # hazırlığı yuvaya taşır (sil+adlandır, atomik DEĞİL), geri okur; 3 deneme
  local d t0 b k="boyut"; [ "$SMB_SHA" = 0 ] || k="boyut+sha256"
  for d in 1 2 3; do
    [ "$d" -gt 1 ] && sleep "$ARALIK_SN"
    if [ ! -f "$HAZIR" ]; then
      log "takas $d/3: hazırlık dosyası yok, yerelden yeniden kopyalanıyor"
      { cp "$YEREL" "$HAZIR.kopyalaniyor" && mv -f "$HAZIR.kopyalaniyor" "$HAZIR"; } \
        || { log "takas $d/3: yeniden kopya başarısız"; continue; }
    fi
    t0=$(ms)
    mv -f "$HAZIR" "$YUVA" || { log "takas $d/3: mv başarısız"; continue; }
    log "takas $d/3: mv $(( $(ms) - t0 )) ms"
    [ "$KURU" = 1 ] && [ "${KURU_TAKAS_BOZ:-0}" -ge "$d" ] && { [ -n "${KURU_BOZ_DOSYA:-}" ] \
      && cp "$KURU_BOZ_DOSYA" "$YUVA" || printf 'bozuk' >> "$YUVA"; } # test kancası
    ayni_mi "$YUVA" && { log "takas $d/3: yuva geri okundu, $k EŞİT (+$(( $(ms) - t0 )) ms)"
      return 0; }
    b=$(boyut "$YUVA") # imza erken geldiyse imzalı dosyanın üzerine yeniden YAZILMAZ
    [ "${b:-0}" -gt "$YEREL_BOYUT" ] && [ "$(py imzali "$YUVA")" = evet ] \
      && { log "takas $d/3: yuvada imzalı dosya — imza erken geldi, takas tekrarlanmaz"; return 0; }
    log "takas $d/3: geri okuma TUTMADI (boyut ${b:-yok})"
  done
  return 1
}

imza_dogrula() { # $1 yerel kopya → 0 geçti · 3 henüz imzalı değil · 4 imzalı ama bizim değil
  local cikti cn="${IMZA_BEKLENEN_CN:-İm Park Bilişim}" arg
  [ "$(py imzali "$1")" = evet ] || { log "imza: sertifika dizini boş (pe_is_signed)"; return 3; }
  [ "$(py govde "$YEREL" "$1")" = evet ] || { log "imza: imzalı ama bizim exe DEĞİL"; return 4; }
  command -v osslsigncode >/dev/null \
    || { log "imza: osslsigncode yok — yalnız pe_is_signed + gövde ölçütü"; return 0; }
  arg=(verify -in "$1")
  [ "$KURU" = 1 ] && arg+=(-CAfile "${IMZA_CAFILE:-/dev/null}" -ignore-crl)
  cikti=$(osslsigncode "${arg[@]}" 2>&1) \
    || { log "imza: verify RED: $(grep -i -m1 -E 'error|fail' <<<"$cikti")"; return 3; }
  grep -q -F "CN=$cn" <<<"$cikti" || { log "imza: imzacı '$cn' değil"; return 4; }
  log "imza: osslsigncode verify ok · imzacı: $cn"
}

tetik() { # toplu kip, taban alındıktan sonra: TETIK=1 ise ayrı süreçte çalıştır, yoksa yazdır
  if [ "${TETIK:-0}" = 1 ]; then
    log "TETİK çalıştırılıyor (ayrı süreç, günlük $TETIK_LOG): $TETIK_KOMUTU"
    ( eval "$TETIK_KOMUTU" >> "$TETIK_LOG" 2>&1 & )
  else log "TETİK — AYRI terminalde ŞİMDİ çalıştır: $TETIK_KOMUTU"; fi
}

bekle_ve_tak() { # --hizli: imzalı dosya İNDİRİLMEZ, yuvada hızlı kontrolle kabul edilir
  local bas gecen asama=pencere taban onceki simdi red="" b yk rc t_p="" t_t=""
  L() { log "[$asama +${gecen}s] $*"; }
  ayni_mi "$HAZIR" || hata 2 "hazırlık yok ya da yerelle aynı değil: $HAZIR (önce: hazirla)"
  bas=$(date +%s); taban=$(iz "$YUVA"); onceki="$taban"
  log "başlangıç: yuva izi $taban · tavan $TAVAN_SN sn · aralık $ARALIK_SN sn"
  if ayni_mi "$YUVA"; then log "yuvada zaten bizim dosya — imza aşamasına geçiliyor"; asama=imza
  else log "PENCERE BEKLENİYOR — exe-create tetiği şimdi çekilebilir"; [ "$TOPLU" = 0 ] || tetik
  fi
  while :; do
    gecen=$(( $(date +%s) - bas ))
    [ "$gecen" -le "$TAVAN_SN" ] \
      || hata 3 "tavan aşıldı ($TAVAN_SN sn), aşama: $asama, yuva: $(iz "$YUVA")"
    simdi=$(iz "$YUVA")
    if [ "$asama" = pencere ]; then
      if [ "$simdi" = "$taban" ]; then L "yuva $simdi — değişim yok"
      elif [ "$simdi" = yok ]; then L "yuva boş (exe-create boşalttı?)"
      elif [ "$simdi" != "$onceki" ]; then L "yuva değişti: $simdi — kararlılık bekleniyor"
      else
        t_p=$gecen; L "PENCERE: İmpark dosyası yuvada ($simdi) — takas"
        takas || hata 4 "takas 3 denemede doğrulanamadı — yuvayı elle kontrol et: $YUVA"
        t_t=$(( $(date +%s) - bas )); asama=imza; simdi=$(iz "$YUVA")
        log "takas tamam (+${t_t}s) — imza bekleniyor"
      fi
    else
      b="${simdi%%/*}"
      if [ "$simdi" = yok ]; then L "yuva boş"
      elif [ "$b" -le "$YEREL_BOYUT" ]; then L "yuva $simdi — imza bekleniyor"
      elif [ "$simdi" != "$onceki" ]; then L "boyut büyüdü: $simdi — kararlılık bekleniyor"
      elif [ "$simdi" = "$red" ]; then L "yuva $simdi — reddedildi, değişim bekleniyor"
      else
        if [ "$HIZLI" = 1 ]; then
          L "imzalı aday (+$((b - YEREL_BOYUT)) B) — indirmeden hızlı kontrol"; yk="$YUVA"
          py hizli "$YUVA" "$YEREL"; rc=$?
        else
          L "imzalı aday (+$((b - YEREL_BOYUT)) B) — yerele kopyalanıyor"
          mkdir -p "$IMZALI_DIZIN"; yk="$IMZALI_DIZIN/${AD%.*}-imzali.exe"
          cp "$YUVA" "$yk.part" || hata 4 "imzalı dosya yerele kopyalanamadı"
          rc=5; [ "$(iz "$YUVA")" = "$simdi" ] && { imza_dogrula "$yk.part"; rc=$?; }
          [ "$rc" = 0 ] && mv -f "$yk.part" "$yk" && log "sha256 $(py sha "$yk")"
        fi
        case "$rc" in
          0) log "İMZALI: $yk"; log "  boyut $YEREL_BOYUT → $b B (+$((b - YEREL_BOYUT)) B)"
            log "  süre (gözcü başından): pencere +${t_p:-?}s · takas +${t_t:-?}s · imza +${gecen}s"
            [ -z "$SURE_DOSYA" ] || echo "${t_p:-?} $((gecen - ${t_t:-0}))" > "$SURE_DOSYA"
            return 0 ;;
          4) hata 4 "yuvadaki imzalı dosya bizim exe'miz değil / imzacı yanlış (pencere kaçtı?)" ;;
          5) L "kopya sırasında yuva değişti — yeniden" ;;
          *) red="$simdi" ;;
        esac
      fi
    fi
    onceki="$simdi"; sleep "$ARALIK_SN"
  done
}

toplu() { # önce HEPSİ hazırlanır; sonra sırayla: tetik → takas → imza → hızlı kontrol → _imzali
  local f i=0 n rc=0 tp ti ozet="" liste=()
  while IFS= read -r f || [ -n "$f" ]; do
    case "$f" in ''|\#*) continue ;; esac
    [ -f "$f" ] || hata 2 "listedeki exe yok: $f"; liste+=("$f")
  done < "$YEREL"
  n=${#liste[@]}; [ "$n" -gt 0 ] || hata 2 "liste boş: $YEREL"
  [ -z "$(for f in "${liste[@]}"; do basename "$f"; done | sort | uniq -d)" ] \
    || hata 2 "listede aynı adlı iki exe var (_imzali/<ad> çakışır)"
  [ "${TETIK:-0}" = 1 ] && [ -z "$TETIK_KOMUTU" ] \
    && hata 2 "KURU'da TETIK=1 sahte TETIK_KOMUTU ister (canlı tetik YOK)"
  log "TOPLU: $n paket — önce hepsi hazırlanıyor"
  for f in "${liste[@]}"; do hedef "$f"; hazirla; done
  SURE_DOSYA=$(mktemp "${TMPDIR:-/tmp}/imza-toplu.XXXXXX"); TOPLU=1; HIZLI=1
  for f in "${liste[@]}"; do
    i=$((i + 1)); hedef "$f"; : > "$SURE_DOSYA"; log "TOPLU $i/$n: $AD"
    ( bekle_ve_tak ); rc=$?
    read -r tp ti < "$SURE_DOSYA" || { tp="?"; ti="?"; }
    [ "$rc" = 0 ] && { log "TOPLU $i/$n: son hızlı kontrol"; py hizli "$YUVA" "$YEREL"; rc=$?; }
    [ "$rc" = 0 ] && { mkdir -p "$KOK/_imzali" && mv -f "$YUVA" "$KOK/_imzali/$AD" || rc=4; }
    ozet="$ozet$(printf '\n  %s · pencere +%ss · imza +%ss · %s' "$AD" "$tp" "$ti" \
      "$([ "$rc" = 0 ] && echo "İMZALI → _imzali/$AD" || echo "DÜŞTÜ (çıkış $rc)")")"
    [ "$rc" = 0 ] || break
  done
  rm -f "$SURE_DOSYA"; log "TOPLU ÖZET ($i/$n işlendi):$ozet"
  [ "$rc" = 0 ] || hata "$rc" "$AD düştü — sonraki paketlere geçilmedi"
  log "TOPLU TAMAM: $n/$n imzalı → $KOK/_imzali/"
}

[ "$KOMUT" = toplu ] || hedef "$YEREL"
case "$KOMUT" in hazirla) hazirla ;; bekle-ve-tak) bekle_ve_tak ;; toplu) toplu ;; esac
