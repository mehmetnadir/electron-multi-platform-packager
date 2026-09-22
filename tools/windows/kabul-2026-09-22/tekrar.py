#!/usr/bin/env python3
"""Tekrar pasi: KALDI paketleri + eski/gevsek kapiyla olculenleri NIHAI kapiyla yeniden kosar.

Neden gerek var: kapi kosu sirasinda iki kez sikilastirildi (ilkSayfada sarti) ve bir kez
genisletildi (serit dugmesi 'Onizleme' de olabiliyor). Bu yuzden ilk 10 paketin KALDI
sonuclari sahte olabilir. Exe'ler D:\\kabul'da onbellekte, tekrar ~2-4 dk/paket.

Sonuc ayni sonuclar.jsonl'e EKLENIR (rapor son kaydi okur). Onceki pas yedeklenir, SILINMEZ.
"""
import json, os, re, shutil, subprocess, sys, time

SP = os.path.dirname(os.path.abspath(__file__))
CIKTI = os.path.join(SP, "kabul", "sonuclar.jsonl")
GUNLUK = os.path.join(SP, "kabul", "tekrar.log")

# Nihai kapi ("Onizleme" duzeltmesi) 10. paketten SONRA devreye girdi.
# Bu ID'ler GECTI olsa bile gevsek kapiyla olculdu -> tekrar sart.
# 45695/45704: kapi "GECTI 4/4" ve "3/3" dedi ama dort/uc kitabin kaniti BIREBIR ayniydi
# (ekran PNG'leri md5-esit, menu etiketleri telif dipnotu) — ayni hedef N kez tiklanmis.
# Ayrik-hedef kapisi eklendikten sonra yeniden olculmeli.
ZORUNLU_TEKRAR = {"11811", "45695", "45704"}


def yaz(m: str) -> None:
    s = time.strftime("%H:%M:%S ") + m
    with open(GUNLUK, "a", encoding="utf-8") as f:
        f.write(s + "\n")
    print(s, flush=True)


def son_kayitlar() -> dict:
    """bookId -> son kayit (ayni id birden cok kez kosulmus olabilir)."""
    o: dict = {}
    if os.path.exists(CIKTI):
        for l in open(CIKTI, encoding="utf-8"):
            l = l.strip()
            if not l:
                continue
            try:
                d = json.loads(l)
            except Exception:
                continue
            o[d.get("bookId")] = d
    return o


def main() -> int:
    isler = json.load(open(os.path.join(SP, "isler.json"), encoding="utf-8"))
    kayit = son_kayitlar()

    hedef = []
    for j in isler:
        bid = j["bookId"]
        d = kayit.get(bid)
        if d is None:
            continue  # hic kosulmamis -> dongu.py'nin isi, burada karistirma
        # AKTIVASYON_GEREKLI: davranis icin tekrar ETME (anahtar olmadan asla gecemez ve
        # anahtar girmek koltuk tuketir). AMA icerik sayimi (anahtarsiz olculebilen kisim)
        # eksikse bir kez daha kosulur — olculdu: ilk dort aktivasyon paketi, icerik_say
        # yamasindan 62 saniye once basladigi icin `icerik` alani bos kaldi.
        if d.get("sonuc") == "AKTIVASYON_GEREKLI":
            ic = d.get("icerik") or {}
            if ic.get("kitapKlasoru") is not None:
                continue
            yaz(f"  {bid}: AKTIVASYON ama icerik sayimi YOK — yalniz icerik icin tekrar")
        if d.get("sonuc") != "GECTI" or bid in ZORUNLU_TEKRAR:
            hedef.append(j)

    if not hedef:
        yaz("TEKRAR GEREKMIYOR — tum paketler NIHAI kapidan GECTI")
        return 0

    yedek = os.path.join(SP, "kabul", "sonuclar-1.pas.jsonl")
    if not os.path.exists(yedek):
        shutil.copy2(CIKTI, yedek)  # SILME yok, kopya
        yaz(f"1. pas yedegi: {yedek}")

    yaz(f"TEKRAR BASLADI hedef={len(hedef)} -> {[j['bookId'] for j in hedef]}")
    for n, j in enumerate(hedef, 1):
        bid = j["bookId"]
        t0 = time.time()
        eski = kayit.get(bid, {})
        yaz(f"[{n}/{len(hedef)}] {bid} {j['baslik'][:40]} — eski={eski.get('sonuc')} "
            f"{eski.get('gecenKitap')}/{eski.get('toplamKitap')}")
        try:
            r = subprocess.run(
                ["/usr/bin/python3", os.path.join(SP, "kosu.py"), bid, "2700"],
                capture_output=True, text=True, timeout=3000)
            out = (r.stdout or "") + (r.stderr or "")
        except subprocess.TimeoutExpired:
            out = ""
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
            d["yayinevi"] = j["yayinevi"]
            d["url"] = j["url"]
            d["pas"] = 2
            d["oncekiSonuc"] = eski.get("sonuc")
            d["sureSn"] = round(time.time() - t0, 1)
            with open(CIKTI, "a", encoding="utf-8") as f:
                f.write(json.dumps(d, ensure_ascii=False) + "\n")
            yaz(f"[{n}/{len(hedef)}] {bid} -> {d.get('sonuc')} "
                f"kitap={d.get('gecenKitap')}/{d.get('toplamKitap')} "
                f"(onceki: {eski.get('sonuc')}) sebep={d.get('sebep','-')} ({d['sureSn']} sn)")
    yaz("TEKRAR BITTI")
    return 0


if __name__ == "__main__":
    sys.exit(main())
