#!/bin/bash
# Uretilen .impark'i REFERANSLA kiyaslar — kanit uretir, hukum vermez.
# Kullanim: impark-dogrula.sh <cikti.impark> <referans-asar-root.txt> <rapor-dizini>
# Konteynerde (packager-linux imaji: unsquashfs + node) kosturulmak uzere yazildi.
set -uo pipefail
IMP="${1:?impark}"; REFROOT="${2:?referans asar kok listesi}"; OUT="${3:-/out/dogrula}"
mkdir -p "$OUT"; cd "$OUT"
say(){ printf '%s\n' "$*" | tee -a rapor.txt; }
: > rapor.txt

say "file: $(file -b "$IMP" | cut -c1-80)"
OFF=$(python3 - "$IMP" <<'PY'
import struct,sys
h=open(sys.argv[1],"rb").read(64)
a,=struct.unpack("<Q",h[0x28:0x30]); b,=struct.unpack("<H",h[0x3A:0x3C]); c,=struct.unpack("<H",h[0x3C:0x3E]); print(a+b*c)
PY
)
say "elf-offset: $OFF"
MAGIC=$(dd if="$IMP" bs=1 skip="$OFF" count=4 2>/dev/null)
say "magic@offset: $MAGIC"
unsquashfs -s -o "$OFF" "$IMP" 2>&1 | grep -E "valid SQUASHFS|Compression|Filesystem size" | sed 's/^/squashfs: /' | tee -a rapor.txt

rm -rf appdir; unsquashfs -q -f -d appdir -o "$OFF" "$IMP" >/dev/null 2>&1 || say "unsquashfs FAIL"
say "appdir-root: $(ls -A appdir | tr '\n' ' ')"
say "DirIcon -> $(readlink appdir/.DirIcon 2>/dev/null || echo YOK)"
say "desktop: $(ls appdir/*.desktop 2>/dev/null | xargs -n1 basename)"
grep -E "^(Name|Exec|Icon)=" appdir/*.desktop | sed 's/^/desktop: /' | tee -a rapor.txt
say "AppRun resolve_executable: $(grep -c 'resolve_executable' appdir/AppRun 2>/dev/null || echo 0) eslesme"
say "AppRun PUBLISHER: $(grep -E '^PUBLISHER_NAME=' appdir/AppRun)"
say "usr/bin: $(ls appdir/usr/bin 2>/dev/null | tr '\n' ' ')"
say "app.asar: $(stat -c %s appdir/resources/app.asar 2>/dev/null) bayt"

# asar kok listesi
python3 - appdir/resources/app.asar > asar-root.txt <<'PY'
import struct,json,sys
# asar basligi: [u32 4][u32 header_size][u32 payload][u32 json_len][json+pad]; veri = 8+header_size
f=open(sys.argv[1],"rb"); f.read(4); hdr,=struct.unpack("<I",f.read(4)); f.read(4); sl,=struct.unpack("<I",f.read(4)); js=json.loads(f.read(sl).rstrip(b"\0").decode())
files=js["files"]
for k,v in sorted(files.items()): print(("D " if "files" in v else "F ")+k)
base=8+hdr
for n in ("package.json","build-info.json"):
    m=files.get(n)
    if m and "offset" in m:
        f.seek(base+int(m["offset"])); open("asar-"+n,"wb").write(f.read(m["size"]))
PY
say "asar-root count: $(wc -l < asar-root.txt) (referans: $(wc -l < "$REFROOT"))"
for n in main.js empp-fs-shim.js .app-hashes.json build-info.json package.json index.html; do
  grep -qx "F $n" asar-root.txt && say "asar has $n: EVET" || say "asar has $n: HAYIR"
done
for n in build node_modules; do grep -qE "^(D|F) $n$" asar-root.txt && say "asar has $n: VAR (KOTU)" || say "asar has $n: yok (iyi)"; done
say "package.json: $(python3 -c "import json;d=json.load(open('asar-package.json'));print('name=',d.get('name'),'main=',d.get('main'),'version=',d.get('version'))" 2>/dev/null)"
say "build-info.json: $(head -c 300 asar-build-info.json 2>/dev/null | tr '\n' ' ')"
# kume farki: referansta olup bizde olmayan / bizde olup referansta olmayan (icerik dosyalari haric yapisal olanlara bak)
say "--- kok kume farki (yalniz-referans | yalniz-cikti) ---"
comm -23 <(sort "$REFROOT") <(sort asar-root.txt) | sed 's/^/  yalniz-referans: /' | tee -a rapor.txt | head -30
comm -13 <(sort "$REFROOT") <(sort asar-root.txt) | sed 's/^/  yalniz-cikti:    /' | tee -a rapor.txt | head -30
rm -rf appdir
