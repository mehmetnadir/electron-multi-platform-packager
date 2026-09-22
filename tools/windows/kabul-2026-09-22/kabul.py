# -*- coding: utf-8 -*-
MACIP = "100.87.144.56"
"""
WINDOWS KABUL KAPISI — paket basina tam akis (windows-kasa uzerinde kosar).
  indir -> kur -> ac -> HER kitaba TIKLA -> ilk sayfa + thumb KANITI -> ekran goruntusu -> kaldir

Nadir kurali (2026-09-22): "dogrulama kapisindan gecme sarti paketleri acip icindeki her
kitaba 1 kez tiklayip acmak, mutlaka ilk sayfayi ve thumb'lari dogru sekilde gormeliyiz."

OLCULEN GERCEKLER (2026-09-22, windows-kasa) — hepsi yanlis alarm uretmisti, tekrar etme:
 1. IKI PAKET AILESI: nsis (bizim Electron kurulumumuz, /S ile %LOCALAPPDATA%\\Programs) ve
    sfx (yayincinin WinRAR-SFX'i, argumansiz calisir, C:\\DijiTap\\<alan>\\<Paket>\\ZKitap.exe).
    SFX'e '/S' vermek 1 sn'de cikis 0 dondurur ve HICBIR SEY kurmaz -> sahte "KURULMADI".
 2. IKI MENU VARYANTI: A) img.button[data-url]  B) div.book-item + img.book-cover-image
    (React, onclick yok). Yalniz A'yi arayan kapi, B tipi seti "tek kitap" sanir.
 3. CDP HEDEFI: uygulama birden cok 'page' hedefi acar; ilki bos belge olabilir. Hedef,
    BEKLENEN kurulum dizinine ait ve icerigi olan hedeftir.
 4. ESKI SUREC PORTU TUTAR: onceki oturumdan kalan uygulama 9333'u tutuyorsa kapi YANLIS
    uygulamayi olcer (olculdu: SM3-v10-Maarif). Acilistan once TUM uygulama surecleri oldurulur.
 5. ILK SAYFA acilista CIZILMEZ: sayfa seridindeki ilk thumb'a tiklanmadan tuval seffaftir.
    Bu kusur degil, acilis durumu. (tiklama oncesi dolu=0, sonrasi dolu=2143.)
 6. THUMB KAYNAGI DEGISKEN: bizde blob:, yayincida file:. Yalniz blob: arayan dedektor
    saglam paketi "thumb yok" diye kaldiriyordu. Olcut: yuklenmis + benzer boyutlu 3+ resim.
 7. 'Atla' desenine 'x' EKLEME: sayfa panelinin kapatma dugmesi de 'X' — kapi kendi kanitini kapatir.
 8. GUEST STDOUT cp1254: tek bir '\u2715' UnicodeEncodeError ile betigi dusurur -> stdout UTF-8.
 9. GDI ekran yakalama RDP oturumu kopukken "Isleyici gecersiz" verir; goruntu CDP
    Page.captureScreenshot ile alinir (oturumdan bagimsiz calisir).
"""
import base64, glob, json, os, shutil, subprocess, sys, time, urllib.request
import websocket

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

KOK = r"D:\kabul"
YEDEK = r"D:\kabul\.empp-yedek-20260922"     # silmek YASAK (Nadir kurali) — kullanilan kurulum TASINIR
DIJITAP = r"C:\DijiTap"
PROGRAMS = os.path.join(os.environ["LOCALAPPDATA"], "Programs")
PORT = 9333
KORUNAN = {"common", "ollama", "opera", "python", "waypoint9-shell"}   # makinenin kendi programlari

def log(*p): print("|".join(str(x) for x in p), flush=True)

def belirtec(): return open(r"C:\vm-kapi\belirtec.txt").read().strip()

def gonder(ad, veri):
    try:
        urllib.request.urlopen(urllib.request.Request(
            f"http://{MACIP}:8791/{belirtec()}/windows-kasa/ekran/{ad}",
            data=veri, method="POST", headers={"Content-Type": "application/octet-stream"}), timeout=180)
        return True
    except Exception as e:
        log("POST-HATA", ad, str(e)[:80]); return False

# ─────────────────────────── CDP ───────────────────────────
class CDP:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, timeout=120, suppress_origin=True,
                                              max_size=100 * 1024 * 1024)
        self.i = 0
    def cmd(self, m, **p):
        self.i += 1
        self.ws.send(json.dumps({"id": self.i, "method": m, "params": p}))
        son = time.time() + 120
        while time.time() < son:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.i:
                if "error" in r: raise RuntimeError(str(r["error"])[:200])
                return r.get("result", {})
        raise TimeoutError(m)
    def js(self, e):
        r = self.cmd("Runtime.evaluate", expression=e, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in r: return {"__hata": str(r["exceptionDetails"])[:200]}
        return r.get("result", {}).get("value")
    def jsj(self, e):
        v = self.js(e)
        if isinstance(v, str):
            try: return json.loads(v)
            except Exception: return None
        return None
    def tikla(self, x, y):
        for t in ("mousePressed", "mouseReleased"):
            self.cmd("Input.dispatchMouseEvent", type=t, x=x, y=y, button="left", clickCount=1)
    def ekran(self): return base64.b64decode(self.cmd("Page.captureScreenshot", format="png")["data"])
    def kapat(self):
        try: self.ws.close()
        except Exception: pass

def hedef_sec(dizin, tavan=180):
    """BEKLENEN kurulum dizinine ait, icerigi OLAN page hedefini secer."""
    isaret = dizin.replace("\\", "/").lower()
    son = time.time() + tavan
    yedek = None
    while time.time() < son:
        try:
            d = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=8))
        except Exception:
            time.sleep(3); continue
        for t in [x for x in d if x.get("type") == "page" and x.get("webSocketDebuggerUrl")]:
            u = (t.get("url") or "").replace("\\", "/").lower()
            if isaret not in u:
                continue
            try:
                c = CDP(t["webSocketDebuggerUrl"]); c.cmd("Runtime.enable")
                n = c.js("document.querySelectorAll('canvas').length*10+document.images.length"
                         "+document.querySelectorAll('img.button[data-url],.book-item').length*10")
                n = n if isinstance(n, int) else 0
                if n >= 3: return c, t, n
                if yedek: yedek[0].kapat()
                yedek = (c, t, n)
            except Exception:
                pass
        time.sleep(4)
    return yedek if yedek else (None, None, 0)

# ─────────────────── indir / kur / oldur / kaldir ───────────────────
def indir(url, hedef):
    os.makedirs(KOK, exist_ok=True)
    if os.path.exists(hedef) and os.path.getsize(hedef) > 1_000_000:
        with open(hedef, "rb") as f:
            if f.read(2) == b"MZ":
                return {"durum": "ONBELLEK", "bayt": os.path.getsize(hedef)}
    # WAF: cdn.yayincilik.net duz istege VE gercek tarayici UA'sina 403 doner; bizim
    # tanitici basligimiz gecirir. cdn.ydspublishing.com aciktir, zarar vermez.
    UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/140.0 Safari/537.36 BookStreamWorker/1.0")
    t0 = time.time()
    r = subprocess.run(["curl.exe", "-sS", "-L", "--fail", "--retry", "3", "--retry-delay", "3",
                        "-H", "X-Book-Proxy: book-update-worker", "-A", UA, "-o", hedef, url],
                       capture_output=True, text=True, timeout=5400)
    if r.returncode != 0:
        return {"durum": "INDIRILEMEDI", "cikis": r.returncode, "hata": (r.stderr or "")[:200]}
    b = os.path.getsize(hedef)
    with open(hedef, "rb") as f: sihir = f.read(2)
    if sihir != b"MZ":
        return {"durum": "PE_DEGIL", "bayt": b, "ilk2": sihir.hex()}
    sn = max(time.time() - t0, 0.1)
    return {"durum": "INDI", "bayt": b, "sn": round(sn, 1), "MBs": round(b / 1e6 / sn, 1)}

def klasor_boyut(d):
    t = 0
    for kk, _, ff in os.walk(d):
        for f in ff:
            try: t += os.path.getsize(os.path.join(kk, f))
            except Exception: pass
    return t

def aile(exe):
    try:
        with open(exe, "rb") as f: h = f.read(2_000_000)
    except Exception: return "bilinmiyor"
    if b"Nullsoft" in h: return "nsis"
    if b"WinRAR" in h or b"SFX" in h: return "sfx"
    return "bilinmiyor"

def dizinler(kok, derin=1):
    o = {}
    kalip = os.path.join(kok, *(["*"] * derin))
    for d in glob.glob(kalip):
        if os.path.isdir(d):
            try: o[d] = os.path.getmtime(d)
            except Exception: pass
    return o

def tum_uygulamalari_oldur():
    """Onceki oturumdan kalan uygulama 9333'u tutuyorsa kapi YANLIS uygulamayi olcer."""
    subprocess.run(["powershell", "-NoProfile", "-Command",
        "Get-Process | ? { $_.Path -and ($_.Path -like 'C:\\DijiTap\\*' -or "
        "$_.Path -like \"$env:LOCALAPPDATA\\Programs\\*\") -and $_.Path -notlike '*\\Python*' "
        "-and $_.Path -notlike '*\\Ollama*' -and $_.Path -notlike '*\\Opera*' } | Stop-Process -Force"],
        capture_output=True)
    time.sleep(5)

def oldur(dizin):
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    f"Get-Process | ? {{ $_.Path -like '{dizin}\\*' }} | Stop-Process -Force"],
                   capture_output=True)
    time.sleep(4)

def kur(exe, tavan=1200):
    a = aile(exe)
    if a == "sfx":
        onceki = dizinler(DIJITAP, 2)
        p = subprocess.Popen([exe])
        kok, derin, sart = DIJITAP, 2, lambda d: os.path.exists(os.path.join(d, "ZKitap.exe"))
    else:
        onceki = dizinler(PROGRAMS, 1)
        p = subprocess.Popen([exe, "/S"])
        kok, derin, sart = PROGRAMS, 1, lambda d: os.path.basename(d).lower() not in KORUNAN
    son = time.time() + tavan
    hedef = None
    while time.time() < son:
        time.sleep(5)
        simdi = dizinler(kok, derin)
        aday = [d for d, m in simdi.items() if (d not in onceki or m > onceki[d] + 1) and sart(d)]
        if aday:
            d = sorted(aday, key=lambda x: simdi[x])[-1]
            x = klasor_boyut(d); time.sleep(15); y = klasor_boyut(d)
            if x == y and y > 5_000_000:
                hedef = d; break
    try: p.wait(timeout=10)
    except Exception: pass
    if not hedef:
        return {"durum": "KURULMADI", "aile": a}
    if a == "sfx":
        ana = os.path.join(hedef, "ZKitap.exe")
    else:
        ex = [f for f in glob.glob(os.path.join(hedef, "*.exe"))
              if not os.path.basename(f).lower().startswith("uninstall")]
        if not ex: return {"durum": "EXE_YOK", "aile": a, "dizin": hedef}
        ana = ex[0]
    return {"durum": "KURULDU", "aile": a, "dizin": hedef, "exe": ana,
            "MB": round(klasor_boyut(hedef) / 1e6, 1)}

def icerik_say(dizin):
    """Anahtarsiz ICERIK OLCUMU — kurulu dizinde kac kitap varligi var?

    Aktivasyon korumali paketlerde kapi kitabi ACAMAZ (anahtar koltuk tuketir), ama
    Nadir'in sorusunun yarisi olan "icerikler dogru mu" yine de yanitlanabilir:
    kurulum dizinindeki kitap varlik klasorleri sayilir. 11845 dersi: 74,7 MB'lik paket
    658 dosya iceriyordu ama 0 kitap varligi vardi — BOYUT icerigin vekili DEGILDIR.
    Desenler bu depoda olculdu: assets/<id>, bookN, set bilesenleri (b1,b2,g1,v1).
    """
    import re as _re
    sonuc = {"kitapKlasoru": 0, "ornekler": [], "taranan": 0, "hata": None}
    try:
        adaylar, gorulen = [], set()
        for kok, dizinler, _dosyalar in os.walk(dizin):
            sonuc["taranan"] += 1
            if sonuc["taranan"] > 4000:
                break
            # `b1/g1/v1` gibi set bilesenleri YALNIZ grup halinde anlamlidir: tek basina
            # bir "v3" klasoru (or. .wrangler/state/v3) kitap DEGILDIR. Ayni ebeveynde
            # en az 2 kardes sart — olculdu: gevsek desen kendi scratchpad'imde 723
            # yanlis pozitif verdi.
            kardes = [d for d in dizinler if _re.match(r"^[bgv]\d+$", d.lower())]
            grup_gecerli = len(kardes) >= 2
            for d in dizinler:
                tam = os.path.join(kok, d).lower()
                dl = d.lower()
                uygun = (_re.search(r"[\\/]assets[\\/][a-z0-9_-]{2,}$", tam)
                         or _re.match(r"^book\d+$", dl)
                         or (grup_gecerli and _re.match(r"^[bgv]\d+$", dl)))
                if uygun:
                    ad = os.path.relpath(os.path.join(kok, d), dizin)
                    if ad not in gorulen:
                        gorulen.add(ad); adaylar.append(ad)
        sonuc["kitapKlasoru"] = len(adaylar)
        sonuc["ornekler"] = adaylar[:8]
    except Exception as e:
        sonuc["hata"] = str(e)[:120]
    return sonuc

def kaldir(dizin):
    u = glob.glob(os.path.join(dizin, "Uninstall*.exe"))
    if not u:
        try:
            os.makedirs(YEDEK, exist_ok=True)
            yeni = os.path.join(YEDEK, os.path.basename(dizin) + "-" + time.strftime("%H%M%S"))
            shutil.move(dizin, yeni)          # C: -> D: surucu degisimi os.rename'i reddeder
            return "TASINDI"
        except Exception as e:
            return "TASINAMADI:" + str(e)[:60]
    try: subprocess.Popen([u[0], "/S", "/currentuser"])
    except Exception as e: return "KALDIRMA_HATA:" + str(e)[:60]
    son = time.time() + 300
    while time.time() < son:
        time.sleep(10)
        if not os.path.exists(dizin): return "KALDIRILDI"
    return "KALDIRILAMADI(kalanMB=%s)" % round(klasor_boyut(dizin) / 1e6, 1)

# ─────────────────────────── JS olcumleri ───────────────────────────
JS_MENU = r"""
(()=>{ // IKI VARYANT: A) img.button[data-url]  B) .book-item (React, onclick yok)
 const kutu=e=>{const r=e.getBoundingClientRect();
   return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),h:Math.round(r.height)};};
 // KAPSAYICI TAVANI (olculdu 2026-09-22, 45792 "Marathon Plus 11"): varyant C, kucuk
 // dugme ikonlarindan `closest('div')` ile SAYFA BOYU bir sarmalayiciya cikti; merkez
 // tiklamasi arka plana dustu, iki "kitap" da ACILMADI ve etiket telif metni oldu
 // ("© N GRUP: YDS PUBLISHING"). Kapsayici ekranin %70'inden genis/yuksekse GUVENILMEZ:
 // o zaman gorselin kendi kutusu hedeftir.
 const makul=e=>{const r=e.getBoundingClientRect();
   return r.width<=innerWidth*0.7 && r.height<=innerHeight*0.7 && r.width>20 && r.height>20;};
 const hedefKutu=(e,img)=>makul(e)?kutu(e):kutu(img);
 let l=[...document.querySelectorAll('img.button[data-url]')].map(e=>
   Object.assign({varyant:'A',id:e.id||null,url:e.dataset.url,ad:e.id||''},kutu(e)));
 if(!l.length) l=[...document.querySelectorAll('.book-item')].map((e,i)=>
   Object.assign({varyant:'B',id:'book'+(i+1),url:null,ad:(e.innerText||'').trim().slice(0,40)},kutu(e)));
 if(!l.length) l=[...document.images].filter(i=>/images\/book\d+\.(png|jpe?g)/i.test(i.currentSrc||i.src||''))
   .map((i,n)=>{const e=i.closest('div')||i;
     return Object.assign({varyant:'C',id:'book'+(n+1),url:null,
       ad:(e.innerText||'').trim().replace(/\s+/g,' ').slice(0,40)},hedefKutu(e,i));});
 // VARYANT D (olculdu 2026-09-22, 45100 "Influence Grade 12 - YDS Academy"): kart izgarasi —
 // BOOKS/WORKSHEETS/TESTS sekmeleri + her kartta kapak <img> ve altinda baslik metni.
 // A/B/C'nin hicbiri eslesmiyordu -> menuKitapSayisi=0 -> SAHTE "KALDI 0/1".
 // Yontem: kapak gorsellerini BOYUT KUMESINE gore bul (kaynak-bagimsiz; logo/suslemeyi eler),
 // en kalabalik kumeyi al, her gorselin tiklanabilir ATA kutusunu hedef yap.
 if(!l.length){
   const gor=[...document.images].filter(i=>{const r=i.getBoundingClientRect();
     return r.width>=60&&r.height>=80&&r.height>=r.width*0.9;});
   const kume={};
   for(const i of gor){const r=i.getBoundingClientRect();
     const a=Math.round(r.width/10)*10+'x'+Math.round(r.height/10)*10;
     (kume[a]=kume[a]||[]).push(i);}
   let en=[];for(const a in kume) if(kume[a].length>en.length) en=kume[a];
   if(en.length>=2) l=en.map((i,n)=>{
     let e=i.parentElement,d=0;
     while(e&&d<4&&(e.innerText||'').trim().length<3){e=e.parentElement;d++;}
     e=e||i;
     // Etiket: once gorselin alt/title'i (en guvenilir), sonra kapsayicinin metni.
     // Cogunlugu RAKAM olan metin (sayfa serit numaralari) etiket DEGILDIR — reddet.
     const temiz=t=>{t=(t||'').trim().replace(/\s+/g,' ');
       const h=(t.match(/[0-9]/g)||[]).length;
       return (t.length>=3 && h/t.length<0.5)?t.slice(0,40):'';};
     const ad=temiz(i.getAttribute('alt'))||temiz(i.getAttribute('title'))
       ||temiz(e.innerText)||('book'+(n+1));
     return Object.assign({varyant:'D',id:'book'+(n+1),url:null,ad},hedefKutu(e,i));});
 }
 return JSON.stringify(l.filter(o=>o.w>40&&o.h>40));})()"""

JS_AKTIVASYON = r"""
(()=>{ // AKTIVASYON KAPISI: paket acilirken "aktivasyon kodunu giriniz" modali cikiyorsa
 // kitap ANAHTARSIZ acilamaz. Bu bir KUSUR DEGIL, tasarim. Kapi anahtari ASLA girmez:
 // gercek anahtar yayinciya (kitapId,key,makineId) uclusuyle KAYITLANIR ve KOLTUK TUKETIR.
 // Olculdu 2026-09-22: 45478 ve 45449 menusu bos gorunuyordu, ekran goruntusu modali gosterdi.
 const g=/aktivasyon|activation|aktive et|lisans kodu|kod(u|unu)\s+giriniz/i;
 for(const e of document.querySelectorAll('div,section,form,dialog')){
   const st=getComputedStyle(e); const r=e.getBoundingClientRect();
   if(st.display==='none'||st.visibility==='hidden') continue;
   if(r.width<200||r.height<100) continue;
   const t=(e.innerText||'').trim();
   if(t && g.test(t) && (e.querySelector('input')||/aktive et/i.test(t)))
     return JSON.stringify({aktivasyon:true, metin:t.slice(0,180)});
 }
 return JSON.stringify({aktivasyon:false});})()"""

JS_MENU_TANI = r"""
(()=>{ // MENU BULUNAMADIGINDA TANI: neyin oldugunu RAPORA yaz, sessiz "tek" varyanta DUSME.
 const say=s=>document.querySelectorAll(s).length;
 const gor=[...document.images].map(i=>{const r=i.getBoundingClientRect();
   return {w:Math.round(r.width),h:Math.round(r.height),src:(i.currentSrc||i.src||'').slice(-60)};})
   .filter(o=>o.w>20&&o.h>20);
 let cerceve=[];
 try{ for(let n=0;n<window.frames.length;n++){
   try{ const d=window.frames[n].document;
        cerceve.push({n, img:d.images.length, govde:(d.body?d.body.innerText:'').trim().slice(0,60)});}
   catch(e){ cerceve.push({n, hata:'capraz-kaynak'}); } } }catch(e){}
 return JSON.stringify({
   url:location.href.slice(0,120), hazir:document.readyState,
   imgToplam:document.images.length, gorunurImg:gor.length, ilkImg:gor.slice(0,6),
   bookItem:say('.book-item'), imgButton:say('img.button[data-url]'),
   canvas:say('canvas'), iframe:say('iframe'), cerceve,
   govde:(document.body?document.body.innerText:'').trim().replace(/\s+/g,' ').slice(0,200)});})()"""

JS_SEKME = r"""
(()=>{ // SEKME TESPITI (45100 kaniti): bazi menulerde kitaplar BOOKS/WORKSHEETS/TESTS
 // sekmelerine bolunmus. Kapi yalnizca ACIK sekmeyi olcer — kapsami RAPORA yazmak icin
 // sekme adlarini topla. Sessiz eksik olcum YASAK.
 const ad=e=>(e.innerText||e.textContent||'').trim().replace(/\s+/g,' ');
 const c=[...document.querySelectorAll('[role="tab"],.tab,.nav-link,md-tab-item,button')]
   .map(e=>({ad:ad(e),aktif:/(^|\s)(active|selected|md-active)(\s|$)/i.test(e.className||'')||e.getAttribute('aria-selected')==='true'}))
   .filter(o=>o.ad && o.ad.length<=24);
 const g=[],gor=new Set();
 for(const o of c){const k=o.ad.toLowerCase(); if(!gor.has(k)){gor.add(k);g.push(o);}}
 return JSON.stringify(g.slice(0,10));})()"""

JS_ATLA = r"""
(()=>{ // 42 adimlik tanitim balonu hem sayfayi ortuyor hem TIKLAMALARI YUTUYOR (olculdu:
 // balon acikken 'Sayfalar' tiklamasi hicbir sey yapmadi). Once o kapatilir.
 // DESENE 'x' EKLEME — sayfa panelinin kapatma dugmesi de 'X'; kapi kendi kanitini kapatir.
 const hedef=[...document.querySelectorAll('button,a,div,span,p')].filter(e=>
   e.children.length===0 && /^(atla|skip|kapat)$/i.test((e.innerText||e.textContent||'').trim()));
 if(!hedef.length) return null;
 const e=hedef[0], r=e.getBoundingClientRect();
 e.click();                       // ortu tiklamayi yuttugu icin DOM tiklamasi
 return JSON.stringify({t:(e.innerText||'').trim(),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()"""

JS_SERIT = r"""
(()=>{ // Sayfa seridini acar. IKI OLCULEN GERCEK (2026-09-22):
 // 1) Etiket TEMAYA GORE DEGISIR: bazi kitaplarda 'Sayfalar', bazilarinda 'Onizleme'
 //    (kanit: 74405 k01 ekran goruntusu). Yalniz 'sayfalar' arayan desen o kitaplarda
 //    serit'i hic acamadi ve saglam kitap 'thumb yok' diye kaldi.
 // 2) Etiket COCUKSUZ DEGIL
 // (ikon + metin sarmalayici) — children.length===0 suzgeci HIC eslesmedi ve serit
 // hic acilmadi; 74427/74430 saglamken 'thumb yok' diye kaldi. Olcut: <=1 cocuk.
 // Yedek yol: etiket bulunamazsa alt ortadaki katlanmis serit tutamacina tiklanir.
 const ad=[...document.querySelectorAll('*')].filter(e=>e.children.length<=1
   && /^(sayfalar|pages|[o\u00f6\u00d6O]nizleme|preview|k[u\u00fc]{1}[c\u00e7]{1}[u\u00fc]{1}k resim|thumbnails)$/i.test((e.innerText||e.textContent||'').trim()));
 if(ad.length){
   const e=ad[ad.length-1];
   const t=e.closest('button,a,li,div')||e;
   const r=t.getBoundingClientRect();
   t.click();
   return JSON.stringify({yol:'etiket',x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});
 }
 const H=window.innerHeight, W=window.innerWidth;
 const tut=[...document.querySelectorAll('div,button,span,svg')].filter(e=>{
   const r=e.getBoundingClientRect();
   return r.height>15 && r.height<70 && r.width>60 && r.width<260
       && r.y>H*0.85 && Math.abs((r.x+r.width/2)-W/2)<W*0.12;});
 if(!tut.length) return null;
 const t=tut[0], r=t.getBoundingClientRect();
 t.click();
 return JSON.stringify({yol:'tutamac',x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()"""

JS_SERIT_TANI = r"""
(()=>{ // Serit acilamadiginda alt bolgedeki ADAYLARI dokumle — bir sonraki kusur
 // neye bakacagimi soylesin, tahmin yurutmeyeyim (DEBUG_ESCALATION).
 const H=window.innerHeight,W=window.innerWidth,o=[];
 for(const e of document.querySelectorAll('*')){
   const r=e.getBoundingClientRect();
   if(r.y<H*0.80||r.height<8||r.height>90||r.width<20||r.width>420) continue;
   o.push(e.tagName+'|'+(typeof e.className==='string'?e.className:'').slice(0,20)
     +'|'+Math.round(r.x)+','+Math.round(r.y)+'|'+Math.round(r.width)+'x'+Math.round(r.height)
     +'|c'+e.children.length+'|'+((e.innerText||e.textContent||'').trim().slice(0,14)));
   if(o.length>=26) break;}
 return JSON.stringify(o);})()"""

JS_KANIT = r"""
(()=>{
 const ad=[...document.images].filter(i=>{const r=i.getBoundingClientRect();
   return i.naturalWidth>0 && r.width>=80 && r.width<=420 && r.height>=80 && r.height<=560;});
 const kume={};
 for(const i of ad){const r=i.getBoundingClientRect();
   const k=Math.round(r.width/20)+'x'+Math.round(r.height/20);(kume[k]=kume[k]||[]).push(i);}
 let en=[]; for(const k in kume) if(kume[k].length>en.length) en=kume[k];
 en.sort((a,b)=>a.getBoundingClientRect().x-b.getBoundingClientRect().x);
 const ilkR=en.length?en[0].getBoundingClientRect():null;
 const cvs=[...document.querySelectorAll('canvas.lower-canvas')];
 let enDolu=0,enRenk=0,cw=0,ch=0;
 for(const cv of cvs){try{const g=cv.getContext('2d');const w=cv.width,h=cv.height;
  if(!w||!h)continue;
  const d=g.getImageData(Math.floor(w*0.25),Math.floor(h*0.25),Math.floor(w*0.5),Math.floor(h*0.5)).data;
  let dolu=0;const renk=new Set();
  for(let i=0;i<d.length;i+=400){if(d[i+3]>10){dolu++;renk.add((d[i]>>4)+','+(d[i+1]>>4)+','+(d[i+2]>>4));}}
  if(dolu>enDolu){enDolu=dolu;enRenk=renk.size;cw=w;ch=h;}
 }catch(e){}}
 const m=(document.body.innerText||'').match(/(\d+)\s*\/\s*(\d+)/);
 let modal=null;
 for(const e of document.querySelectorAll('div,section')){
   const st=getComputedStyle(e);const r=e.getBoundingClientRect();
   if((st.position==='fixed'||st.position==='absolute')&&r.width>300&&r.height>150&&r.width<1400&&st.display!=='none'){
     const t=(e.innerText||'').trim();
     if(t && /key|anahtar|lisans|aktiv|sifre|hata|error|gecersiz/i.test(t)){modal=t.slice(0,160);break;}}}
 return JSON.stringify({thumbAday:ad.length,thumbOK:en.length,
  thumbBoyut:ilkR?Math.round(ilkR.width)+'x'+Math.round(ilkR.height):null,
  canvasSayi:cvs.length,canvasDolu:enDolu,canvasRenk:enRenk,canvasW:cw,canvasH:ch,
  sayfa:m?m[0]:null,toplamSayfa:m?Number(m[2]):null,modal,
  thumbIlk:ilkR?{x:Math.round(ilkR.x+ilkR.width/2),y:Math.round(ilkR.y+ilkR.height/2)}:null});})()"""

JS_KITAPTA = "document.querySelectorAll('canvas.lower-canvas').length>0"

# ─────────────────────────── kitap kaniti ───────────────────────────
def kitap_kanit(c, kimlik, sira):
    """Kanit: (a) sayfa seridi acik ve 3+ kucuk gorsel YUKLENMIS, (b) ILK SAYFA cizili.
    Kitap 1. sayfada acilmaz (olculdu: 12/172 ile aciliyor) — seritten 1'e gidilir."""
    def olc(): return c.jsj(JS_KANIT) or {}

    atlandi = []

    def atla_dene(etiket=""):
        """Tanitim balonunu kapat. TEK SEFER YETMIYOR (olculdu 2026-09-22):
        42 adimlik 'Akilli Tahtamiz ile daha iyi bir deneyim...' turu kitap
        YUKLENDIKTEN SONRA aciliyor; acilis basinda yapilan 4 deneme onu hic
        gormuyor ve sonraki her tiklama ortuye gidiyor. Kanit: 74404-k02 ekran
        goruntusunde modal ortada duruyor, kayitta `atlandi = []`, thumbAday 0,
        kitap 125,8 sn'de sahte KALDI aldi. Ayni pakette modali gormeyen 1. kitap
        24,7 sn'de 7/7 thumb ile GECTI. Bu yuzden serit denemelerinin HER turunda
        yeniden yoklanir."""
        n = 0
        for _ in range(4):
            a = c.jsj(JS_ATLA)
            if not a: break
            atlandi.append((etiket + ":" if etiket else "") + str(a.get("t")))
            n += 1
            time.sleep(2)
        return n

    atla_dene()

    kanit = {}
    for _ in range(8):                        # serit ZATEN acikken kucuk gorseller ~10 sn'de gelir;
        kanit = olc()                         # kapaliysa asagidaki serit mantigi zaten 2x30 sn yokluyor,
        if kanit.get("thumbOK", 0) >= 3: break  # burada 60 sn beklemek her kitapta bos yere 36 sn yiyordu
        time.sleep(3)

    # SERIT BIR ANAHTARDIR: kapali sanip tiklamak aciyi kapatir. Tikladiktan sonra
    # kucuk gorseller TEMBEL yuklenir — 6 sn yetmiyordu (olculdu: 73768'in 1. ve 3.
    # kitabinda serit acildi ama olcum erken yapildi, thumbOK 0 kaldi). 30 sn yoklanir.
    if kanit.get("thumbOK", 0) < 3:
        # Serit acilmiyorsa ILK SUPHE ortu: tanitim turu tiklamalari yutar.
        if atla_dene("serit-oncesi"):
            for _ in range(4):
                kanit = olc()
                if kanit.get("thumbOK", 0) >= 3: break
                time.sleep(3)
    if kanit.get("thumbOK", 0) < 3:
        for deneme in (1, 2):
            y = {}
            atla_dene(f"serit{deneme}")
            sp = c.jsj(JS_SERIT)
            if not sp:
                kanit["seritTani"] = c.js(JS_SERIT_TANI)
                break
            for _ in range(10):
                time.sleep(3)
                y = olc()
                if y.get("thumbOK", 0) >= 3:
                    y["seritAnahtari"] = deneme; y["seritYolu"] = sp.get("yol"); kanit = y; break
            if kanit.get("thumbOK", 0) >= 3: break
            if y: kanit = y

    # ILK SAYFA: seritteki 1. kucuk gorsele tikla, sayfa gostergesi 1/N olana kadar dene
    if kanit.get("thumbIlk"):
        for _ in range(3):
            c.tikla(kanit["thumbIlk"]["x"], kanit["thumbIlk"]["y"])
            time.sleep(7)
            y = olc()
            if y:
                y["seritAnahtari"] = kanit.get("seritAnahtari"); kanit = y
            sy = str(kanit.get("sayfa") or "")
            if sy.startswith("1/") or sy.startswith("1 /"): break
            if not kanit.get("thumbIlk"): break

    kanit["atlandi"] = atlandi
    png = c.ekran()
    ssad = f"{kimlik}-k{sira:02d}"
    gonder(ssad, png)
    kanit["ekran"] = ssad; kanit["ekranBayt"] = len(png)
    sy = str(kanit.get("sayfa") or "")
    kanit["ilkSayfada"] = bool(sy.startswith("1/") or sy.startswith("1 /"))
    kanit["ilkSayfaVar"] = bool(kanit.get("canvasDolu", 0) > 50 and kanit.get("canvasRenk", 0) > 1)
    kanit["thumbVar"] = bool(kanit.get("thumbOK", 0) >= 3)
    # TEK SAYFALIK ICERIK: 1 sayfalik kitapcik/afis/calisma kagidinda serit hic olmaz
    # (45538/book5 kaniti: sayfa="1/1", canvas dolu ve renkli, thumbAday=0).
    # Thumb sartini KOR sekilde uygulamak sahte KALDI uretir; muafiyeti ACIK isaretle.
    tp = kanit.get("toplamSayfa")
    kanit["tekSayfa"] = bool(tp == 1)
    thumb_sarti = True if kanit["tekSayfa"] else kanit["thumbVar"]
    kanit["sonuc"] = "GECTI" if (kanit["ilkSayfaVar"] and thumb_sarti and kanit["ilkSayfada"]) else "KALDI"
    if kanit["tekSayfa"] and kanit["sonuc"] == "GECTI":
        kanit["muafiyet"] = "TEK_SAYFA_THUMB_MUAF"
    kanit.pop("thumbIlk", None)
    return kanit

def menuye_don(c, menuUrl):
    c.js("location.href=" + json.dumps(menuUrl))
    for _ in range(25):
        time.sleep(2)
        if c.jsj(JS_MENU): return True
    return False

# ─────────────────────────── ana akis ───────────────────────────
def main():
    bookId, url, baslik = sys.argv[1], sys.argv[2], sys.argv[3]
    r = {"bookId": bookId, "baslik": baslik, "basladi": time.strftime("%Y-%m-%dT%H:%M:%S")}
    exe = os.path.join(KOK, bookId + ".exe")

    r["indirme"] = indir(url, exe)
    log("INDIRME", bookId, json.dumps(r["indirme"]))
    if r["indirme"]["durum"] not in ("INDI", "ONBELLEK"):
        r["sonuc"] = "KALDI"; r["sebep"] = r["indirme"]["durum"]; return bitir(r)

    tum_uygulamalari_oldur()
    r["kurulum"] = kur(exe)
    log("KURULUM", bookId, json.dumps(r["kurulum"]))
    if r["kurulum"]["durum"] != "KURULDU":
        r["sonuc"] = "KALDI"; r["sebep"] = r["kurulum"]["durum"]; return bitir(r)

    dizin, ana = r["kurulum"]["dizin"], r["kurulum"]["exe"]
    tum_uygulamalari_oldur()
    subprocess.Popen([ana, f"--remote-debugging-port={PORT}", "--remote-allow-origins=*"])
    c, t, puan = hedef_sec(dizin)
    if not c:
        r["sonuc"] = "KALDI"; r["sebep"] = "CDP_ACILMADI"
        oldur(dizin); r["kaldirma"] = kaldir(dizin); return bitir(r)
    r["hedefPuan"] = puan
    c.cmd("Page.enable")
    time.sleep(10)
    menuUrl = c.js("location.href")
    r["menuUrl"] = menuUrl if isinstance(menuUrl, str) else None

    # MENU GEC RENDER EDILEBILIYOR (olculdu 2026-09-22, 60014/60015/60016 "Sonic Monic
    # Readers"): tek sefer 10 sn bekleyip olcmek bos liste veriyor, kapi "tek" varyanta
    # dusup acilmayan tek kitabi olcuyor ve paket sahte KALDI aliyor. Ekran goruntusu
    # (60016-menu.png) ayni anda 5 kart gosteriyor — yani menu VARDI, olcum ERKENDI.
    # 60 sn'ye kadar yoklanir; bulunamazsa SESSIZ dusulmez, tani raporlanir.
    kitaplar = []
    for _ in range(12):
        kitaplar = c.jsj(JS_MENU) or []
        if kitaplar: break
        time.sleep(5)
    if not kitaplar:
        r["menuTani"] = c.jsj(JS_MENU_TANI)
    r["menuKitapSayisi"] = len(kitaplar)
    r["menuAdlar"] = [k.get("ad") or k.get("id") for k in kitaplar]
    sek = c.jsj(JS_SEKME)
    if isinstance(sek, list) and len(sek) > 1:
        r["sekmeler"] = sek
        r["sekmeUyarisi"] = ("menu sekmelere bolunmus; kapi yalnizca ACIK sekmeyi olctu "
                             "— diger sekmelerdeki kitaplar KAPSAM DISI")
    # MENU EKRANI: "pakette var ama menude yok" sinifi ancak menuye BAKILARAK kanitlanir
    # (olculdu 2026-09-22: 60114'un paketinde 4 kitap asset'i var, menu 2 kitap gosteriyor).
    try:
        mp = c.ekran(); gonder(f"{bookId}-menu", mp); r["menuEkran"] = f"{bookId}-menu"
    except Exception as e:
        r["menuEkranHata"] = str(e)[:80]
    r["varyant"] = kitaplar[0]["varyant"] if kitaplar else "tek"
    r["kitaplar"] = []

    if not kitaplar:
        # Menu bos: once ANAHTAR KAPISI mi diye bak. Aktivasyon istiyorsa bu bir KUSUR DEGIL —
        # kapi anahtar giremez (koltuk tuketir), verdikt ayri sinif olur.
        # DIKKAT: jsj() ZATEN json.loads yapip dict dondurur. Cevresine bir json.loads daha
        # sarmak TypeError firlatir ve sessiz catch tespiti komple kapatir (olculdu 2026-09-22:
        # 45469 bu yuzden sahte KALDI aldi). Sessiz yutma YOK — hata alanini rapora yaz.
        akt = c.jsj(JS_AKTIVASYON)
        if not isinstance(akt, dict):
            r["aktivasyonSondaHatasi"] = repr(akt)[:120]
            akt = {}
        if akt.get("aktivasyon"):
            r["aktivasyonGerekli"] = True
            r["aktivasyonMetni"] = akt.get("metin")
            r["kitaplar"] = []
            r["gecenKitap"] = 0; r["toplamKitap"] = 0
            r["sonuc"] = "AKTIVASYON_GEREKLI"
            # Davranis olculemiyor ama ICERIK olculebilir — kaldirmadan ONCE say.
            r["icerik"] = icerik_say(dizin)
            log("AKTIVASYON", bookId, "icerikKlasoru=" + str(r["icerik"].get("kitapKlasoru")),
                (akt.get("metin") or "")[:40])
            c.kapat(); oldur(dizin)
            r["kaldirma"] = kaldir(dizin)
            return bitir(r)
        k = kitap_kanit(c, bookId, 1); k.update({"sira": 1, "ad": baslik, "kaynak": "tek-kitap"})
        r["kitaplar"].append(k)
    else:
        for i, kit in enumerate(kitaplar, 1):
            t0 = time.time()
            c.tikla(kit["x"], kit["y"])
            gecis = False
            for _ in range(30):
                time.sleep(2)
                if c.js(JS_KITAPTA) is True: gecis = True; break
            if not gecis:
                r["kitaplar"].append({"sira": i, "id": kit.get("id"), "ad": kit.get("ad"),
                                      "sonuc": "KALDI", "sebep": "ACILMADI"})
                menuye_don(c, menuUrl); continue
            k = kitap_kanit(c, bookId, i)
            k.update({"sira": i, "id": kit.get("id"), "ad": kit.get("ad"), "sn": round(time.time() - t0, 1)})
            r["kitaplar"].append(k)
            log("KITAP", bookId, i, k.get("sonuc"), "thumb=" + str(k.get("thumbOK")),
                "tuval=" + str(k.get("canvasDolu")), str(k.get("sayfa")))
            if i < len(kitaplar) and not menuye_don(c, menuUrl):
                r["menuDonusHatasi"] = i; break

    # AYRIK HEDEF KAPISI (olculdu 2026-09-22, 45695 "Classmate A1-A2 Set" ve 45704):
    # dort/uc "kitabin" TUM kanit alanlari birebir ayni cikti (sayfa 1/66, canvasDolu 4399,
    # canvasRenk 471, thumbOK 7, thumbBoyut 180x225, ekran PNG'leri md5-esit) ve menu
    # etiketlerinin hepsi telif dipnotuydu ("© N GRUP: YDS PUBLISHING"). Yani menuden ayni
    # hedef N kez tiklandi; kapi tek kitabi N kez sayip pakete "GECTI 4/4" verdi — Nadir'in
    # sarti "HER kitaba bir kez tiklayip acmak" oldugu icin bu SAHTE YESIL.
    # Olcut: iki kitabin kanit parmak izi ayniysa o kitaplar AYRI ACILMAMISTIR.
    def parmak(k):
        return "|".join(str(k.get(a)) for a in
                        ("sayfa", "toplamSayfa", "canvasDolu", "canvasRenk",
                         "thumbOK", "thumbBoyut", "ekranBayt"))
    if len(r["kitaplar"]) > 1:
        gor = {}
        for k in r["kitaplar"]:
            gor.setdefault(parmak(k), []).append(k.get("sira"))
        cakisan = {pz: sr for pz, sr in gor.items() if len(sr) > 1}
        if cakisan:
            r["ayniHedef"] = [sr for sr in cakisan.values()]
            for k in r["kitaplar"]:
                if any(k.get("sira") in sr for sr in cakisan.values()):
                    k["sonuc"] = "KALDI"; k["ayniHedef"] = True
    # Menu etiketlerinin HEPSI ayniysa hedef secimi supheli — rapora yaz (sessiz gecme).
    ad_kume = {str(a) for a in (r.get("menuAdlar") or [])}
    if len(r.get("menuAdlar") or []) > 1 and len(ad_kume) == 1:
        r["menuAdUyarisi"] = "tum menu etiketleri ayni: " + list(ad_kume)[0][:60]

    gecen = [k for k in r["kitaplar"] if k.get("sonuc") == "GECTI"]
    r["gecenKitap"] = len(gecen); r["toplamKitap"] = len(r["kitaplar"])
    r["sonuc"] = "GECTI" if (r["kitaplar"] and len(gecen) == len(r["kitaplar"])) else "KALDI"
    if r.get("ayniHedef") and r["sonuc"] != "GECTI" and not r.get("sebep"):
        r["sebep"] = "AYNI_HEDEF"
    c.kapat(); oldur(dizin)
    r["kaldirma"] = kaldir(dizin)
    return bitir(r)

def bitir(r):
    r["bitti"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    gonder("rapor-" + r["bookId"], json.dumps(r, ensure_ascii=False).encode("utf-8"))
    log("RAPOR", r["bookId"], r.get("sonuc"), r.get("gecenKitap"), r.get("toplamKitap"))
    print("JSON>>>" + json.dumps(r, ensure_ascii=True), flush=True)

if __name__ == "__main__":
    main()
