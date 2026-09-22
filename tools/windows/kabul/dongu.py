#!/usr/bin/env python3
"""47 Windows paketini sirayla kabul kapisindan gecirir. Sonuclar JSONL'e eklenir.
Zaten GECTI olan paket tekrar kosulmaz (yeniden baslatilabilir)."""
import json, os, re, subprocess, sys, time
SP = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SP)
from kosu import ciktidan_json  # TEK ayiklama noktasi (bkz. kosu.py docstring)
CIKTI = os.path.join(SP, "kabul", "sonuclar.jsonl")
GUNLUK = os.path.join(SP, "kabul", "dongu.log")

def yaz(m):
    with open(GUNLUK, "a", encoding="utf-8") as f:
        f.write(time.strftime("%H:%M:%S ") + m + "\n")
    print(time.strftime("%H:%M:%S ") + m, flush=True)

def gecmis():
    o = {}
    if os.path.exists(CIKTI):
        for l in open(CIKTI, encoding="utf-8"):
            try:
                d = json.loads(l); o[d["bookId"]] = d.get("sonuc")
            except Exception: pass
    return o

isler = json.load(open(os.path.join(SP, "isler.json")))
# once temsili iki set (varyant A ve B), sonra kalanlar
onculer = ["11811", "73768"]
sira = [i for i in isler if i["bookId"] in onculer] + [i for i in isler if i["bookId"] not in onculer]

g = gecmis()
yaz(f"BASLADI evren={len(sira)} zaten_gecti={sum(1 for v in g.values() if v=='GECTI')}")
for n, j in enumerate(sira, 1):
    bid = j["bookId"]
    if g.get(bid) == "GECTI":
        yaz(f"[{n}/{len(sira)}] {bid} ATLANDI (zaten GECTI)"); continue
    t0 = time.time()
    yaz(f"[{n}/{len(sira)}] {bid} {j['baslik'][:40]} — basliyor")
    r = subprocess.run(["/usr/bin/python3", os.path.join(SP, "kosu.py"), bid, "2700"],
                       capture_output=True, text=True, timeout=3000)
    out = (r.stdout or "") + (r.stderr or "")
    # AYIKLAMA TEK YERDE (2026-09-22): burada kendi regex'i vardi —
    # `re.search(r"JSON>>>(\{.*\})")`, DOTALL yok, yani JSON tek satirdan uzunsa
    # eslesmiyor ve SAGLAM paket sahte CIKTI_YOK yaziliyordu. kosu.ciktidan_json()
    # cok satirli ciktiyi da cozer ve asla istisna atmaz; testi kosu_test.py'de.
    d = ciktidan_json(out)
    if d is None:
        d = {"bookId": bid, "sonuc": "KALDI", "sebep": "CIKTI_YOK", "ham": out[-400:]}
    d["yayinevi"] = j["yayinevi"]; d["url"] = j["url"]
    d["sureSn"] = round(time.time() - t0, 1)
    with open(CIKTI, "a", encoding="utf-8") as f:
        f.write(json.dumps(d, ensure_ascii=False) + "\n")
    yaz(f"[{n}/{len(sira)}] {bid} -> {d.get('sonuc')} "
        f"kitap={d.get('gecenKitap')}/{d.get('toplamKitap')} sebep={d.get('sebep','-')} "
        f"({d['sureSn']} sn)")
yaz("BITTI")
