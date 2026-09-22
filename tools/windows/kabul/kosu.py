#!/usr/bin/env python3
# kosu.py <bookId> — tek paket icin kabul kapisini windows-kasa'da kostur
import json, os, re, subprocess, sys
SP = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.expanduser("~")
KOK = os.path.join(HOME, "vm-kapi")
PKG = "/Users/nadir/01dev/electron-multi-platform-packager"

def macip():
    return subprocess.run(["tailscale", "ip", "-4"], capture_output=True, text=True).stdout.strip().split()[0]

def kopru_adresi():
    """Kopru (bu Mac'in) adresini cozer: once EMPP_KOPRU_ADRES ortam degiskeni, yoksa
    `tailscale ip -4`. Sabit IP koda GOMULMEZ (2026-09-22 kurali) — windows-kasa'nin
    geri-bildirim yapacagi adres her kosuda burada belirlenir."""
    return os.environ.get("EMPP_KOPRU_ADRES") or macip()

def kabul_kopyala(ip):
    """kabul.py'yi KOK'a kopyalarken MACIP satirini calisma-ani adresle degistirir
    (kabul.py disk uzerinde sabit IP TASIMAZ, sadece dokumantasyon amacli yedek deger)."""
    kaynak = open(os.path.join(SP, "kabul.py"), encoding="utf-8").read()
    kaynak, n = re.subn(r'^MACIP = "[^"]*"', 'MACIP = "%s"' % ip, kaynak, count=1, flags=re.M)
    if n == 0:
        raise RuntimeError("kabul.py'de MACIP satiri bulunamadi — dosya bozulmus olabilir")
    os.makedirs(KOK, exist_ok=True)
    open(os.path.join(KOK, "kabul.py"), "w", encoding="utf-8").write(kaynak)

def ciktidan_json(out):
    """Kopru ciktisindan kapi JSON'unu ayiklar. Ayiklanamazsa None (asla istisna atmaz).

    KIRPMA TUZAGI (olculdu 2026-09-22 — bu fonksiyonun VAROLUS SEBEBI):
    Eskiden bu ayiklama yoktu ve `kos()` ciktinin yalniz SON 3000 karakterini basiyordu.
    Yedi kitaplik bir paketin JSON'u 3000 karakteri asinca `JSON>>>` isareti ve acilis
    suslu parantezi bastan kirpiliyor, cagiran (dongu.py / tekrar.py) ayiklayamiyor ve
    KAPIDAN GECMIS paket sahte "CIKTI_YOK / KALDI" olarak kaydediliyordu.
    Kanit: 72379 (kayitta 7/7 GECTI), 72380 (7/7 GECTI), 59834 (5/5 GECTI) — ucu de
    saglamdi, uc sahte basarisizlik uretildi. Yanlilik KITAP SAYISIYLA ARTAR: paket ne
    kadar buyukse sahte KALDI olasiligi o kadar yuksek, yani kapi en cok da en degerli
    paketlerde yaniliyordu. Duzeltme once cagirandaki regex'e yapilmisti (YANLIS KATMAN)
    ve ise yaramadi — 59834 o duzeltmeden SONRA da CIKTI_YOK aldi.
    Kural: kirpma ayiklamadan ONCE yapilmaz; ayiklama tek yerde, burada.
    """
    i = out.rfind("JSON>>>")
    if i < 0:
        return None
    k = out[i + len("JSON>>>"):]
    b = k.find("{")
    s = k.rfind("}")
    if b < 0 or s <= b:
        return None
    try:
        return json.loads(k[b:s + 1])
    except Exception:
        return None


def kos(bid, tavan=2400):
    isler = json.load(open(os.path.join(SP, "isler.json")))
    j = next((i for i in isler if i["bookId"] == bid), None)
    if not j:
        print("is bulunamadi:", bid); return 2
    ip = kopru_adresi()
    kabul_kopyala(ip)
    wad = f"wrap-{bid}.ps1"
    ps = (
        "$ErrorActionPreference='SilentlyContinue'\r\n"
        "$b=(Get-Content C:\\vm-kapi\\belirtec.txt -Raw).Trim()\r\n"
        f"curl.exe -s -o C:\\vm-kapi\\kabul.py http://{ip}:8791/$b/dosya/kabul.py\r\n"
        "& \"$env:LOCALAPPDATA\\Programs\\Python\\Python313\\python.exe\" C:\\vm-kapi\\kabul.py "
        f"'{bid}' '{j['url']}' '{j['baslik'].replace(chr(39), chr(39)*2)}'\r\n"
    )
    open(os.path.join(KOK, wad), "w", encoding="utf-8").write(ps)
    cmd = (
        "powershell -NoProfile -ExecutionPolicy Bypass -Command "
        "\"$b=(Get-Content C:\\vm-kapi\\belirtec.txt -Raw).Trim(); "
        f"curl.exe -s -o C:\\vm-kapi\\{wad} http://{ip}:8791/$b/dosya/{wad}; "
        f"powershell -NoProfile -ExecutionPolicy Bypass -File C:\\vm-kapi\\{wad}\""
    )
    r = subprocess.run(["node", "tools/windows/vm-kapi.js", "calistir", cmd,
                        "--makine", "windows-kasa", "--zaman-asimi", str(tavan)],
                       cwd=PKG, capture_output=True, text=True)
    out = (r.stdout or "") + (r.stderr or "")
    # Isaretten oncesi kirpilabilir, SONRASI ASLA (bkz. ciktidan_json docstring).
    _i = out.rfind("JSON>>>")
    print(out[max(0, _i - 1500):] if _i >= 0 else out[-3000:])
    return r.returncode

if __name__ == "__main__":
    sys.exit(kos(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 2400))
