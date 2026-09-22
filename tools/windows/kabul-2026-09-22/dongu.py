#!/usr/bin/env python3
"""47 Windows paketini sirayla kabul kapisindan gecirir. Sonuclar JSONL'e eklenir.
Zaten GECTI olan paket tekrar kosulmaz (yeniden baslatilabilir)."""
import json, os, re, subprocess, sys, time
SP = os.path.dirname(os.path.abspath(__file__))
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
    # ILK PAS = GENISLIK. Bir kez olculen paket bu pasta TEKRAR EDILMEZ; duzeltme gerektiren
    # (KALDI / CIKTI_YOK / AKTIVASYON) satirlari ikinci pasta `tekrar.py` yeniden olcer.
    # Boylece 47 paketin tamami once EN AZ BIR KEZ gorulur (Nadir'in istedigi kapsam).
    if bid in g:
        yaz(f"[{n}/{len(sira)}] {bid} ATLANDI (bu pasta olculdu: {g.get(bid)})"); continue
    t0 = time.time()
    yaz(f"[{n}/{len(sira)}] {bid} {j['baslik'][:40]} — basliyor")
    r = subprocess.run(["/usr/bin/python3", os.path.join(SP, "kosu.py"), bid, "2700"],
                       capture_output=True, text=True, timeout=3000)
    out = (r.stdout or "") + (r.stderr or "")
    # SAGLAM AYIKLAMA (olculdu 2026-09-22): 72379 gercekte 7/7 GECTI idi ama tek satirlik
    # greedy regex eslesmedi ve paket sahte "CIKTI_YOK/KALDI" olarak kaydedildi. Konuk
    # tarafta log satirlari stdout'a karisabiliyor. Cozum: SON "JSON>>>" isaretinden sonrasini
    # al, satir sonlarini yok sayarak (DOTALL) en dis suslu parantez ciftini coz.
    m = None
    idx = out.rfind("JSON>>>")
    if idx >= 0:
        kuyruk = out[idx + len("JSON>>>"):]
        b = kuyruk.find("{")
        s_ = kuyruk.rfind("}")
        if b >= 0 and s_ > b:
            m = re.match(r"(?s)(.*)", kuyruk[b:s_ + 1])
    if m:
        try:
            d = json.loads(m.group(1))
        except Exception:
            d = {"bookId": bid, "sonuc": "KALDI", "sebep": "JSON_COZULEMEDI"}
    else:
        d = {"bookId": bid, "sonuc": "KALDI", "sebep": "CIKTI_YOK", "ham": out[-400:]}
    d["yayinevi"] = j["yayinevi"]; d["url"] = j["url"]
    d["sureSn"] = round(time.time() - t0, 1)
    with open(CIKTI, "a", encoding="utf-8") as f:
        f.write(json.dumps(d, ensure_ascii=False) + "\n")
    yaz(f"[{n}/{len(sira)}] {bid} -> {d.get('sonuc')} "
        f"kitap={d.get('gecenKitap')}/{d.get('toplamKitap')} sebep={d.get('sebep','-')} "
        f"({d['sureSn']} sn)")
yaz("BITTI")
