#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Nadir'in istedigi IKI raporu Markdown olarak uretir:
   1) KABUL-RAPORU.md   — icerik dogru mu, kitaplar aciliyor mu (kapi sonucu)
   2) GUNCELLEME-RAPORU.md — paketlerde guncelleme var mi (yarin yapilacak is)"""
import json, os, subprocess
SP = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SP, "sonuc")
os.makedirs(OUT, exist_ok=True)

def oku(p, v=None):
    t = os.path.join(SP, p)
    try: return json.load(open(t, encoding="utf-8"))
    except Exception: return v

def jsonl(p):
    t = os.path.join(SP, p); o = {}
    try:
        for l in open(t, encoding="utf-8"):
            d = json.loads(l); o[d["bookId"]] = d
    except Exception: pass
    return o

def ix(v):
    o = {}
    if isinstance(v, list):
        for x in v:
            if isinstance(x, dict):
                b = str(x.get("bookId") or x.get("book_id") or "")
                if b: o[b] = x
    return o

isler = oku("isler.json", [])
kabul = jsonl("kabul/sonuclar.jsonl")
G = ix(oku("guncelleme/rapor.json", []))
T = ix(oku("teslim/rapor.json", []))
B = ix(oku("beklenen/beklenen.json", []))
S = ix(oku("statik/rapor.json", []))
GD = ix(oku("guncelleme-derin/rapor.json", []))

def tarih():
    return subprocess.run(["date", "+%Y-%m-%d %H:%M"], capture_output=True, text=True).stdout.strip()

# ── 1) KABUL RAPORU ────────────────────────────────────────────────
r = ["# Windows Paket Kabul Raporu", "",
     f"**Üretim:** {tarih()} · **Ölçüm yeri:** windows-kasa (Tailscale, ofis hattı) · **Kapsam:** Cambridge hariç 47 paket",
     "",
     "**Kapı şartı (Nadir, 2026-09-22):** paket açılır, içindeki HER kitaba bir kez tıklanır,",
     "**ilk sayfa** ve **küçük görseller (thumb)** doğru görünmelidir. Verdikt DOM ölçümünden verilir,",
     "ayrıca her kitabın ekran görüntüsü saklanır (`~/vm-kapi/sonuc/windows-kasa/<id>-kNN.png`).", ""]

olculen = [i for i in isler if i["bookId"] in kabul]
# AYNI HEDEF — sahte yesil sinifi (2026-09-22)
# Kapiya eklenen `ayniHedef` alani yalnizca DUZELTMEDEN SONRAKI kayitlarda var.
# Eski kayitlar da raporlansin diye parmak izi burada YENIDEN hesaplanir (geriye donuk).
def _parmak(k):
    return "|".join(str(k.get(a)) for a in
                    ("sayfa", "toplamSayfa", "canvasDolu", "canvasRenk",
                     "thumbOK", "thumbBoyut", "ekranBayt"))

def _ayni_gruplar(d):
    if d.get("ayniHedef"):
        return d["ayniHedef"]
    kl = d.get("kitaplar") or []
    if len(kl) < 2:
        return []
    g = {}
    for k in kl:
        g.setdefault(_parmak(k), []).append(k.get("sira"))
    return [sr for sr in g.values() if len(sr) > 1]

for _i in olculen:
    _g = _ayni_gruplar(kabul[_i["bookId"]])
    if _g:
        kabul[_i["bookId"]]["ayniHedef"] = _g
def snf(i):
    """Verdikt sinifi: GECTI / AKTIVASYON / KALDI. 'Olculemedi' ile 'kusurlu'yu
    AYIRIR — aktivasyon isteyen paket kapidan kalmadi, OLCULEMEDI (anahtar girmek
    yayinciya koltuk tuketiyor, Nadir karari)."""
    k = kabul[i["bookId"]]
    v = k.get("sonuc")
    # AYNI HEDEF: kapi "GECTI" demis olsa bile ayni kitap N kez sayilmissa Nadir'in
    # sarti ("HER kitaba bir kez tikla") karsilanmamistir — GECTI sayilmaz.
    if k.get("ayniHedef") and v == "GECTI": return "SAHTE_YESIL"
    if v == "GECTI": return "GECTI"
    if v == "AKTIVASYON_GEREKLI" or k.get("aktivasyonGerekli"): return "AKTIVASYON"
    return "KALDI"
gecti = [i for i in olculen if snf(i) == "GECTI"]
sahte = [i for i in olculen if snf(i) == "SAHTE_YESIL"]
akt   = [i for i in olculen if snf(i) == "AKTIVASYON"]
kaldi = [i for i in olculen if snf(i) == "KALDI"]
muaf  = [i for i in gecti if kabul[i["bookId"]].get("muafiyet")
         or any(x.get("muafiyet") for x in (kabul[i["bookId"]].get("kitaplar") or []))]
sekmeli = [i for i in olculen if any(x.get("sekmeUyarisi") for x in (kabul[i["bookId"]].get("kitaplar") or []))
           or kabul[i["bookId"]].get("sekmeUyarisi")]
r += [f"**Evren · Yoklanan · Atlanan: 47 · {len(olculen)} · {47-len(olculen)}**", "",
      f"- GEÇTİ: **{len(gecti)}**  (bunların {len(muaf)}'inde tek sayfalık içerik muafiyeti var)",
      f"- KALDI (gerçek kusur, bizim işimiz): **{len(kaldi)}**",
      f"- SAHTE YEŞİL (kapı GEÇTİ dedi ama aynı kitap N kez sayılmış): **{len(sahte)}**",
      f"- AKTİVASYON GEREKLİ (ölçülemedi — kapıdan kalmış SAYILMAZ): **{len(akt)}**", ""]
if akt:
    r += ["> Aktivasyon isteyen pakete gerçek anahtar girilmedi: anahtar yayıncıda",
          "> (kitapId, key, makineId) üçlüsüne kaydoluyor ve lisans koltuğu tüketiyor.",
          "> Bu paketlerin içeriği anahtarsız yoldan (dosya sayımı) ayrıca ölçüldü.", ""]
if sekmeli:
    r += [f"> **Sekmeli menü uyarısı:** {len(sekmeli)} pakette menü birden çok sekme taşıyor;",
          "> kapı yalnız açık sekmedeki kitapları tıklayabildi. Diğer sekmeler ölçülmedi.", ""]

r += ["## Yayınevi bazında", "",
      "| Yayınevi | Paket | Ölçülen | Geçti | Kaldı | Aktivasyon |", "|---|---:|---:|---:|---:|---:|"]
for y in ("YDS Publishing", "Flashy ELT", "GOLD ELT"):
    t = [i for i in isler if i["yayinevi"] == y]
    o = [i for i in t if i["bookId"] in kabul]
    g = [i for i in o if snf(i) == "GECTI"]
    a = [i for i in o if snf(i) == "AKTIVASYON"]
    r.append(f"| {y} | {len(t)} | {len(o)} | {len(g)} | {len(o)-len(g)-len(a)} | {len(a)} |")
r.append("")

r += ["## Paket paket", "",
      "| ID | Başlık | Yayınevi | Aile | Kitap (geçen/toplam) | Beklenen | İçerik (anahtarsız) | Sonuç | Sebep |",
      "|---|---|---|---|---:|---:|---|---|---|"]
for i in isler:
    b = i["bookId"]; k = kabul.get(b)
    if not k:
        r.append(f"| {b} | {i['baslik']} | {i['yayinevi']} | — | — | "
                 f"{(B.get(b) or {}).get('beklenenKitapSayisi') or '—'} | — | ÖLÇÜLMEDİ | koşu tamamlanmadı |")
        continue
    ai = (k.get("kurulum") or {}).get("aile") or "—"
    ic = k.get("icerik") or {}
    ick = ic.get("kitapKlasoru")
    icm = f"{ick} klasör" if ick is not None else "—"
    isaret = " ⟨muaf⟩" if (k.get("muafiyet") or any(x.get("muafiyet") for x in (k.get("kitaplar") or []))) else ""
    r.append(f"| {b} | {i['baslik']} | {i['yayinevi']} | {ai} | "
             f"{k.get('gecenKitap')}/{k.get('toplamKitap')} | "
             f"{(B.get(b) or {}).get('beklenenKitapSayisi') or '—'} | "
             f"{icm} | {k.get('sonuc')}{isaret} | {k.get('sebep') or '—'} |")
r.append("")

# ── MENU SAYISI ile WEB LISTESI ARASINDAKI FARK ────────────────────
# DIKKAT (otorite uyarisi): beklenen.json'daki sayi bizim WEB seti listesinden
# (KV/DB) geliyor; Windows exe'sinin icinde ne olmasi gerektiginin otoritesi O
# DEGIL, yayincinin GetPackageBooks cevabidir. Bu paketlerde yayinci sayisi 0
# dondu — yani "eksik kitap" demek icin kanit YETERSIZ. Buraya "yari sorunlu"
# olarak yaziliyor: Nadir'in sabah karar vermesi gereken liste.
eksikler = []
for i in olculen:
    b = i["bookId"]; k = kabul[b]; bb = B.get(b) or {}
    bk = bb.get("beklenenKitapSayisi"); tm = k.get("toplamKitap")
    if bk and tm is not None and tm < bk:
        eksikler.append((i, k, bb))
if eksikler:
    # Iki ayri sinif: yayinci sayimi VAR mi? Otorite exe icerigi icin yayincinin
    # GetPackageBooks cevabi; bizim web seti listemiz (KV/DB) oyun/calisma kagidi/
    # ogretmen paketi gibi exe'de olmayan kalemleri de sayabiliyor.
    kanitsiz = [(i,k,b) for (i,k,b) in eksikler if not (b.get("kaynakSayilari") or {}).get("yayinci")]
    kanitli  = [(i,k,b) for (i,k,b) in eksikler if (b.get("kaynakSayilari") or {}).get("yayinci")]

    if kanitli:
        r += ["## Menüde eksik kitap — YAYINCI SAYIMIYLA da doğrulanmış", "",
              "Bu satırlarda yayıncının kendi `GetPackageBooks` sayımı da menüde görünenden",
              "**kat kat fazla**. 18-34 kitaplı bir setin menüsünde 0-1 kalem olması içerik",
              "eksikliği ya da menü ayrıştırma hatasıdır; ikisi de kapıdan geçemez.", "",
              "| ID | Başlık | Menüde | Yayıncı sayımı | db/kv | Kapı sonucu |",
              "|---|---|---:|---:|---|---|"]
        for i, k, bb in kanitli:
            ks = bb.get("kaynakSayilari") or {}
            r.append(f"| {i['bookId']} | {i['baslik']} | {k.get('toplamKitap')} | "
                     f"{ks.get('yayinci')} | {ks.get('db','—')}/{ks.get('kv','—')} | {k.get('sonuc')} |")
        r += ["", "Bunların hepsi ikinci pasta (menü varyantı D + kapsayıcı tavanı ile) yeniden",
              "ölçülüyor; aktivasyon isteyenlerde içerik ayrıca anahtarsız dosya sayımıyla ölçüldü.", ""]

    if kanitsiz:
        r += ["## Menü sayısı web listesinden az — otorite SESSİZ (yarı sorunlu)", "",
              "**Ölçüldü (2026-09-22 05:00, doğrudan yayıncı ucundan):** üç setin üçünde de",
              "`GET /MobilService/GetPackageBooks?id=<id>` **HTTP 200** dönüyor, `KitapAdi`",
              "alanı dolu geliyor (`Flashy Grade 5 - Set`, `Flashy Grade 8 - Set`, `ShallWe6-v25`)",
              "ama `Books` dizisi **0 uzunlukta**. Yani yayıncı ucu erişilemez değil — cevap",
              "veriyor ve içinde kitap listesi taşımıyor.", "",
              "Bu yüzden exe içeriğinin otoritesi burada **sessiz**: `beklenen` bizim web seti",
              "listemizden (KV/DB) geliyor ve web seti oyun / çalışma kâğıdı / öğretmen paketi",
              "gibi exe'de bulunmayan kalemleri de sayıyor olabilir. \"Kitap eksik\" demek için",
              "kanıt YETERSİZ — kapı sonucu geçerli, fark karara bırakılıyor.", "",
              "> Bu gece öğrenilen ayrım burada da geçerli: `Books:[]` **tek başına** \"paket boş\"",
              "> kanıtı değildir (45704 emsali — katalog boş, exe 1,56 GB ve yayıncının dosyasıyla",
              "> bayt-eşit). İki sinyal birlikte gerekir: boş katalog **ve** ölçülen boş paket.", "",
              "| ID | Başlık | Menüde | db/kv/yayıncı | Kapı sonucu |", "|---|---|---:|---|---|"]
        for i, k, bb in kanitsiz:
            ks = bb.get("kaynakSayilari") or {}
            r.append(f"| {i['bookId']} | {i['baslik']} | {k.get('toplamKitap')} | "
                     f"{ks.get('db','—')}/{ks.get('kv','—')}/{ks.get('yayinci','—')} | {k.get('sonuc')} |")
        r += ["", "Karar gerekiyor (yayıncı ucu ölçüldü, cevap vermedi): farkın gerçek olup",
              "olmadığı ancak paketin İÇİ açılıp sayılarak ya da yayıncıya sorularak",
              "kesinleşir. Kapı bu üç sette gördüğü kitapların hepsini geçirdi.", ""]

ayni = [i for i in olculen if kabul[i["bookId"]].get("ayniHedef")]
etiket_uyari = [i for i in olculen if kabul[i["bookId"]].get("menuAdUyarisi")]
if ayni or etiket_uyari:
    r += ["## Aynı hedef tıklanmış paketler (sahte yeşil sınıfı)", "",
          "Nadir'in şartı **\"içindeki HER kitaba bir kez tıklayıp açmak\"**. Aşağıdaki",
          "paketlerde birden çok \"kitabın\" kanıt parmak izi BİREBİR aynı çıktı",
          "(`sayfa|toplamSayfa|canvasDolu|canvasRenk|thumbOK|thumbBoyut|ekranBayt`) —",
          "yani menüden aynı hedef N kez tıklanmış, tek kitap N kez sayılmış.", ""]
    if ayni:
        r += ["| ID | Başlık | Aynı çıkan kitap sıraları | Menü etiketi uyarısı |",
              "|---|---|---|---|"]
        for i in ayni:
            k = kabul[i["bookId"]]
            r.append(f"| {i['bookId']} | {i['baslik']} | "
                     f"{'; '.join(str(g) for g in (k.get('ayniHedef') or []))} | "
                     f"{(k.get('menuAdUyarisi') or '—')[:60]} |")
        r.append("")
    baska = [i for i in etiket_uyari if i not in ayni]
    if baska:
        r += ["Menü etiketlerinin tamamı aynı olan (hedef seçimi şüpheli) ek paketler:", "",
              "| ID | Başlık | Uyarı |", "|---|---|---|"]
        for i in baska:
            r.append(f"| {i['bookId']} | {i['baslik']} | {(kabul[i['bookId']].get('menuAdUyarisi') or '')[:70]} |")
        r.append("")
    r += ["> Bu kapı geçmiş veriye de uygulandı: çok kitaplı 13 GEÇTİ paketinin yalnız",
          "> 2'si takıldı (45695, 45704), kalan 11'de yanlış pozitif çıkmadı.", ""]

if akt:
    r += ["## Aktivasyon isteyen paketler (ölçülemedi — Nadir kararı)", "",
          "| ID | Başlık | İçerik (anahtarsız sayım) | Modal metni |", "|---|---|---|---|"]
    for i in akt:
        k = kabul[i["bookId"]]; ic = k.get("icerik") or {}
        r.append(f"| {i['bookId']} | {i['baslik']} | "
                 f"{ic.get('kitapKlasoru') if ic.get('kitapKlasoru') is not None else '—'} klasör / "
                 f"{ic.get('toplamDosya') if ic.get('toplamDosya') is not None else '—'} dosya | "
                 f"{(k.get('aktivasyonMetni') or '—')[:70]} |")
    r.append("")

if kaldi:
    r += ["## Kalanların kitap kırılımı (gerçek kusur)", ""]
    for i in kaldi:
        k = kabul[i["bookId"]]
        r.append(f"### {i['bookId']} — {i['baslik']}")
        r.append("")
        r.append("| # | Kitap | Thumb | Tuval | Sayfa | İlk sayfada | Sonuç | Ekran |")
        r.append("|---:|---|---:|---:|---|---|---|---|")
        for x in k.get("kitaplar", []):
            r.append(f"| {x.get('sira')} | {x.get('ad') or x.get('id') or '—'} | {x.get('thumbOK')} | "
                     f"{x.get('canvasDolu')} | {x.get('sayfa') or '—'} | {x.get('ilkSayfada')} | "
                     f"{x.get('sonuc')} | `{x.get('ekran') or '—'}.png` |")
        r.append("")

r += ["## Yan ölçümler", "",
      "| Ölçüm | Sonuç |", "|---|---|",
      f"| Teslim edilebilirlik (indirme) | {sum(1 for x in T.values() if (x.get('srv21') or {}).get('durum')=='TESLIM_OK')}/47 |",
      f"| Güncellik | {sum(1 for x in G.values() if x.get('durum')=='GUNCEL')} güncel · "
      f"{sum(1 for x in G.values() if x.get('durum')=='GUNCELLEME_VAR')} güncelleme var |",
      f"| Statik içerik çapraz kontrolü | {len(S)} kayıt |", ""]
open(os.path.join(OUT, "KABUL-RAPORU.md"), "w", encoding="utf-8").write("\n".join(r))

# ── 2) GUNCELLEME RAPORU ───────────────────────────────────────────
g = ["# Paket Güncelleme Raporu (yarın yapılacak iş)", "",
     f"**Üretim:** {tarih()} · **Kapsam:** Cambridge hariç 47 Windows paketi",
     "", "Otorite: yayıncı origin'indeki statik dosya (`Uploads/KitapTekExe/<id>/<KitapAdi>.exe`).",
     "Sürüm etiketi (`-vNN`) TEK BAŞINA yeterli değil — etiket aynıyken bayt boyutu değişebiliyor.", "",
     "| ID | Başlık | Bizim | Yayıncı | Durum | Not |", "|---|---|---|---|---|---|"]
for i in isler:
    b = i["bookId"]; x = G.get(b)
    if not x or x.get("durum") == "GUNCEL": continue
    d = GD.get(b) or {}
    g.append(f"| {b} | {i['baslik']} | {x.get('bizimSurum') or '—'} | {x.get('yayinciSurum') or '—'} | "
             f"{x.get('durum')} | {d.get('karar') or x.get('not') or x.get('aciklama') or '—'} |")
g += ["", f"Güncel olan paket sayısı: **{sum(1 for x in G.values() if x.get('durum')=='GUNCEL')}/47**.", "",
      "## Boyut düşüşü neden alarm değil", "",
      "Yukarıdaki satırların dördünde (45449 · 45100 · 45487 · 45448) yayıncı dosyası",
      "bizimkinden **83-89 MB KÜÇÜK** ve sürüm etiketi aynı kalmış. Bu tek başına",
      "\"yayıncı bozuk dosya koydu\" demek değildir: ZKitap paketlerinde gömülü PDF'in",
      "ayıklanması bu mertebede bir düşüş üretiyor (emsal: 84 MB → 36 MB). Dört pakette",
      "farkın 83-89 MB bandında toplanması rastlantı değil, sistematik bir yeniden",
      "dışa aktarıma işaret ediyor.", "",
      "Karar ölçütü boyut DEĞİL: indirilen yeni dosya kurulup içindeki her kitap",
      "kapıdan geçirilmeli (test sayısı + ktur + ZKitap klasörü dolu). Yarın güncelleme",
      "yapılırken sıra: indir → kur → kapı → sonra yayına al.", "",
      "**45551 — ÖLÇÜLDÜ, karar net: GÜNCELLENMEMELİ.**", "",
      "Yayıncı dosyası hem çok küçük (74.721.464 bayt / bizde 1.183.073.744) hem de",
      "TARİHÇE ESKİ (`last-modified` 18 Nis 2026 < bizim 8 Eyl 2026 indirmemiz).",
      "Tam indirme yapılmadan, `Range` istekleriyle **toplam ~7 MB** çekilerek teşhis edildi:", "",
      "- İlk 2 MB: MZ/PE32 imzası + WinRAR SFX modülü; RAR5 arşivi 386.560. baytta başlıyor.",
      "- Kısmi arşiv listesi: yalnız jenerik Electron motor dosyaları",
      "  (`chrome_100_percent.pak`, `ffmpeg.dll`, mtime 2024-02-28) — kitap modülü YOK.",
      "- Çapraz kıyas: bilinen bozuk 11845'in (74.738.888 bayt) SFX motor stub'ı ile",
      "  **CRC32 düzeyinde birebir aynı**; bilinen sağlam 45549 ise 915.296.312 bayt (12 kat).",
      "- Kesin kanıt ayrı bir ölçümden: paketin ProBook'ta TAM çıkarımı 659 dosya/31 klasör",
      "  verdi ve `assets/<id>/pages/*.png` ya da `BookContent.xml` deseninde **sıfır** kitap",
      "  modülü çıktı.", "",
      "Yani bu bir güncelleme değil, yayıncı tarafında **boş kabuk**. Mevcut hâliyle",
      "güncellemek 1,18 GB sağlam içeriği 74 MB'lık motorla ezer. Aynı sınıfta: **45550**",
      "(bizde 810 MB sağlam) ve **11845** (bizimki de zaten boş — canlıda kırık).", ""]
open(os.path.join(OUT, "GUNCELLEME-RAPORU.md"), "w", encoding="utf-8").write("\n".join(g))
print("yazildi:", os.path.join(OUT, "KABUL-RAPORU.md"), "+", os.path.join(OUT, "GUNCELLEME-RAPORU.md"))
