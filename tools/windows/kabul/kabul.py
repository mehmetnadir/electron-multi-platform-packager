# -*- coding: utf-8 -*-
# MACIP: kosu.py bu satiri HER kopyalamada calisma-ani degeriyle degistirir (bkz.
# kosu.py -> kabul_kopyala()). Sabit deger yalniz DOGRUDAN/ELLE calistirma icin
# YEDEKTIR — normal akista adres env EMPP_KOPRU_ADRES ya da `tailscale ip -4` ile
# cozulur, koda GOMULMEZ (2026-09-22 kurali).
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
import base64, glob, json, os, re, shutil, subprocess, sys, time, urllib.request
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

# YEREL KIP (2026-10-02, windows-kasa ajani): runner kasa'nin KENDISINDE kosarken kopru yoktur;
# EMPP_KABUL_YEREL_DIZIN verilirse ekranlar/rapor o dizine YAZILIR (POST yok). Bos/yoksa eski davranis.
def yerel_ad(ad):
    return ad + (".json" if ad.startswith("rapor-") else ".png")

def gonder(ad, veri):
    yerel = os.environ.get("EMPP_KABUL_YEREL_DIZIN", "").strip()
    if yerel:
        try:
            os.makedirs(yerel, exist_ok=True)
            with open(os.path.join(yerel, yerel_ad(ad)), "wb") as f: f.write(veri)
            return True
        except Exception as e:
            log("YAZMA-HATA", ad, str(e)[:80]); return False
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
    def tus(self, key, code, vk, modifiers=0, text=None):
        for t in ("keyDown", "keyUp"):
            p = dict(type=t, key=key, code=code, windowsVirtualKeyCode=vk, nativeVirtualKeyCode=vk,
                     modifiers=modifiers)
            if text and t == "keyDown": p["text"] = text
            self.cmd("Input.dispatchKeyEvent", **p)
    def yaz(self, metin): self.cmd("Input.insertText", text=metin)
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

def aile_imzadan(h):
    """SAF KARAR: baytlardan paket ailesini tespit eder (I/O yok, dogrudan test edilebilir).
    Nullsoft -> nsis, WinRAR/SFX -> sfx, ikisi de yoksa bilinmiyor. SFX'e '/S' vermek
    1 sn'de cikis 0 dondurur ve HICBIR SEY kurmaz — sahte "KURULMADI" (bkz. kur())."""
    if b"Nullsoft" in h: return "nsis"
    if b"WinRAR" in h or b"SFX" in h: return "sfx"
    return "bilinmiyor"

def aile(exe):
    try:
        with open(exe, "rb") as f: h = f.read(2_000_000)
    except Exception: return "bilinmiyor"
    return aile_imzadan(h)

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

def kaldirma_yontemi(uninstall_var):
    """SAF KARAR: Uninstall*.exe bulunduysa 'kaldirici', yoksa 'tasi' — ASLA 'rm'
    (Nadir kurali: silinemeyen kurulum D:\\kabul\\.empp-yedek-... altina TASINIR)."""
    return "kaldirici" if uninstall_var else "tasi"

def kaldir(dizin):
    u = glob.glob(os.path.join(dizin, "Uninstall*.exe"))
    if kaldirma_yontemi(bool(u)) == "tasi":
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
 let l=[...document.querySelectorAll('img.button[data-url]')].map(e=>
   Object.assign({varyant:'A',id:e.id||null,url:e.dataset.url,ad:e.id||''},kutu(e)));
 if(!l.length) l=[...document.querySelectorAll('.book-item')].map((e,i)=>
   Object.assign({varyant:'B',id:'book'+(i+1),url:null,ad:(e.innerText||'').trim().slice(0,40)},kutu(e)));
 if(!l.length) l=[...document.images].filter(i=>/images\/book\d+\.(png|jpe?g)/i.test(i.currentSrc||i.src||''))
   .map((i,n)=>{const e=i.closest('div')||i;
     return Object.assign({varyant:'C',id:'book'+(n+1),url:null,ad:(e.innerText||'').trim().slice(0,40)},kutu(e));});
 return JSON.stringify(l.filter(o=>o.w>40&&o.h>40));})()"""

def menu_varyant_sec(a_var, b_var, c_var):
    """SAF KARAR: JS_MENU'nun ayna/mirror'i (yukarida) — tarayici disi (Python) test icin.
    JS_MENU string'i DEGISMEDI; bu fonksiyon onun BELGELENEN A->B->C oncelik kuralini
    kilitler: A varsa A, yoksa B varsa B, yoksa C varsa C, hicbiri yoksa None (tek-kitap
    dalina dusulur — bkz. main()'deki 'if not kitaplar')."""
    if a_var: return "A"
    if b_var: return "B"
    if c_var: return "C"
    return None

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

def serit_etiket_mi(metin):
    """SAF KARAR: JS_SERIT'teki etiket regex'inin Python aynasi (tarayici disi test icin,
    JS bir tarayicida calisir, unittest'te calistirilamaz). JS_SERIT'teki desen DEGISTIYSE
    bu da GUNCELLENIR — biri digerinden BAGIMSIZ SURUKLENMEZ.
    Kabul: Sayfalar/Pages/Onizleme/Preview/Kucuk resim/Thumbnails (temaya gore degisir,
    kanit: 74405). RET: 'Atla'/'Skip'/'X' — saha kazasi: desen 'x' icerdigi icin kapi
    sayfa panelinin kapatma dugmesine tiklayip KENDI KANITINI KAPATMISTI (thumbOK 7->0,
    bkz. JS_ATLA'daki 'x EKLEME' uyarisi — ayni tuzak JS_SERIT icin de gecerli)."""
    d = re.compile(r'^(sayfalar|pages|[oöÖO]nizleme|preview|k[uü][cç][uü]k resim|thumbnails)$',
                    re.IGNORECASE)
    return bool(d.match((metin or "").strip()))

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
 // Thumb ETIKETLERI (altindaki sayfa numarasi): serit o anki sayfaya KAYDIRILMIS olabilir —
 // en soldaki thumb 1. sayfa DEGILDIR (olculdu 73768/book3: serit 8-12, 3 tiklama 8/136'da kaldi).
 const yapraklar=[...document.querySelectorAll('div,span,p,small,label')].filter(e=>e.children.length===0
   && /^\d{1,4}$/.test((e.innerText||e.textContent||'').trim()));
 const etiket=[];
 for(const i of en){const r=i.getBoundingClientRect();
   const y=yapraklar.find(e=>{const q=e.getBoundingClientRect();const cx=q.x+q.width/2;
     return cx>=r.x&&cx<=r.x+r.width&&q.y>=r.bottom-4&&q.y<=r.bottom+70;});
   if(y) etiket.push({n:Number((y.innerText||y.textContent).trim()),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});}
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
  thumbIlk:ilkR?{x:Math.round(ilkR.x+ilkR.width/2),y:Math.round(ilkR.y+ilkR.height/2)}:null,
  thumbEtiket:etiket});})()"""

JS_SAYFA_KUTUSU = r"""
(()=>{ // Sayfa gostergesi ("8/136") — seritten BAGIMSIZ 1. sayfaya gitmek icin. Kutuya tiklanir,
 // 1 yazilip Enter'a basilir; olmazsa kutunun solundaki 'geri' dugmesi kullanilir.
 const H=window.innerHeight,W=window.innerWidth;
 const desen=/^\s*\d+\s*\/\s*\d+\s*$/;
 let k=[...document.querySelectorAll('input')].find(e=>desen.test(e.value||''))
   ||[...document.querySelectorAll('*')].find(e=>e.children.length===0&&desen.test((e.innerText||e.textContent||'')));
 if(!k) return null;
 const r=k.getBoundingClientRect(); if(!r.width||!r.height) return null;
 const cx=r.x+r.width/2, cy=r.y+r.height/2;
 let geri=null,en=1e9;
 for(const e of document.querySelectorAll('button,a,div,span,svg,img')){
   const q=e.getBoundingClientRect();
   if(q.width<16||q.height<16||q.width>90||q.height>90) continue;
   const qx=q.x+q.width/2, qy=q.y+q.height/2, dx=cx-qx;
   if(dx<r.width/2+4||dx>r.width/2+110||Math.abs(qy-cy)>20) continue;
   if(dx<en){en=dx;geri={x:Math.round(qx),y:Math.round(qy)};}}
 return JSON.stringify({x:Math.round(cx),y:Math.round(cy),tag:k.tagName,
   input:k.tagName==='INPUT',metin:(k.value||k.innerText||'').trim(),geri});})()"""

JS_KITAPTA = "document.querySelectorAll('canvas.lower-canvas').length>0"

# ─────────────────────────── kitap kaniti ───────────────────────────
def ilk_sayfada_mi(sayfa):
    """SAF KARAR: sayfa gostergesi ("12/172" gibi) ILK SAYFAYI mi gosteriyor?
    '1/' veya '1 /' ile baslamasi yeterli — kitap 1. sayfada ACILMAZ (olculdu: 12/172
    ile aciliyor), seritteki ilk thumb'a tiklanip 1'e gidilir (bkz. kitap_kanit())."""
    sy = str(sayfa or "")
    return bool(sy.startswith("1/") or sy.startswith("1 /"))

def ilk_sayfa_plani(kanit):
    """SAF KARAR: 1. sayfaya gitme yollari, sirayla (2026-10-03, 73768 kaniti).
    Serit o anki sayfaya kaydirilmis olabilir: EN SOLDAKI thumb 1. sayfa DEGILDIR (book3: serit
    8-12'yi gosteriyordu, en soldakine 3 kez tiklandi, 8/136'da kaldi). Bu yuzden:
      - etiketi '1' olan thumb gorunuyorsa ona tikla ('etiket1');
      - etiketler var ama 1 yoksa en soldakine TIKLAMA — sayfa kutusu ('kutu'), sonra geri
        dugmesi ('geri');
      - etiket hic okunamadiysa (baska tema) eski yol ('thumbIlk') once denenir, sonra kutu/geri."""
    etiket = [e for e in (kanit.get("thumbEtiket") or []) if isinstance(e, dict)]
    if any(e.get("n") == 1 for e in etiket): return ["etiket1"]
    if etiket: return ["kutu", "geri"]
    return (["thumbIlk"] if kanit.get("thumbIlk") else []) + ["kutu", "geri"]

def geri_tiklama_sayisi(sayfa, tavan=40):
    """SAF KARAR: '8/136' -> 7 geri tiklamasi (1. sayfaya); okunamazsa/zaten 1 ise 0; tavanla sinirli."""
    m = re.match(r"^\s*(\d+)\s*/\s*\d+", str(sayfa or ""))
    if not m: return 0
    return max(0, min(int(m.group(1)) - 1, tavan))

def ilk_sayfa_tamam(kanit):
    """SAF KARAR: 1/N gosteriliyor VE tuval cizili (acilista 1/N olsa da tuval SEFFAF olabilir —
    olculen gercek 5: thumb'a tiklanmadan cizilmez; o durumda gezinme yine yapilir)."""
    return bool(ilk_sayfada_mi(kanit.get("sayfa")) and (kanit.get("canvasDolu") or 0) > 50
                and (kanit.get("canvasRenk") or 0) > 1)

def ilk_sayfaya_git(c, kanit, olc):
    """ilk_sayfa_plani() sirasiyla dener; her adimdan sonra olcer, 1/N + cizili tuvalde durur."""
    def yeni(y, yol):
        y = y or {}
        y["seritAnahtari"] = kanit.get("seritAnahtari"); y["ilkSayfaYolu"] = yol
        return y
    for yol in ilk_sayfa_plani(kanit):
        if ilk_sayfa_tamam(kanit): break
        if yol == "etiket1":
            e = next(e for e in kanit["thumbEtiket"] if e.get("n") == 1)
            c.tikla(e["x"], e["y"]); time.sleep(7); kanit = yeni(olc(), yol)
        elif yol == "thumbIlk":
            for _ in range(3):
                if not kanit.get("thumbIlk"): break
                c.tikla(kanit["thumbIlk"]["x"], kanit["thumbIlk"]["y"]); time.sleep(7)
                kanit = yeni(olc(), yol)
                if ilk_sayfa_tamam(kanit): break
        elif yol == "kutu":
            k = c.jsj(JS_SAYFA_KUTUSU)
            if not k: kanit["kutuYok"] = True; continue
            c.tikla(k["x"], k["y"]); time.sleep(1)
            c.tus("a", "KeyA", 65, modifiers=2); c.yaz("1"); c.tus("Enter", "Enter", 13, text="\r")
            time.sleep(7); kanit = yeni(olc(), yol)
        elif yol == "geri":
            k = c.jsj(JS_SAYFA_KUTUSU)
            n = geri_tiklama_sayisi(kanit.get("sayfa"))
            if not k or not k.get("geri") or not n: continue
            for _ in range(n):
                c.tikla(k["geri"]["x"], k["geri"]["y"]); time.sleep(1.2)
            time.sleep(5); kanit = yeni(olc(), yol)
    return kanit

def kanit_sonucu(thumbOK, canvasDolu, canvasRenk, toplamSayfa, ilkSayfada):
    """SAF KARAR: kanit esigi (2026-09-22, EN YENI 02:42 — tek sayfa muafiyeti ile).
    ilkSayfaVar: canvasDolu>50 VE canvasRenk>1 (bos/seffaf tuvali GECTI saymamak icin,
    SIKI karsilastirma — tam 50 GECMEZ, tek renk duz dolgu GECMEZ).
    thumbVar: thumbOK>=3.
    tekSayfa: toplamSayfa==1 -> thumb sarti MUAF (kanit: 45538/book5 ve 45540/book5,
    sayfa="1/1", canvas dolu ve renkli, thumbAday=0 — 1 sayfalik kitapcik/afis/calisma
    kagidinda serit HIC olusmaz; thumb sartini KOR sekilde uygulamak sahte KALDI uretir).
    GECTI: ilkSayfaVar VE (tekSayfa VEYA thumbVar) VE ilkSayfada. None/eksik deger 0/False
    sayilir. Donen: (sonuc, ilkSayfaVar, thumbVar, tekSayfa, muafiyet-veya-None)."""
    ilkSayfaVar = bool((canvasDolu or 0) > 50 and (canvasRenk or 0) > 1)
    thumbVar = bool((thumbOK or 0) >= 3)
    tekSayfa = bool(toplamSayfa == 1)
    thumb_sarti = True if tekSayfa else thumbVar
    sonuc = "GECTI" if (ilkSayfaVar and thumb_sarti and bool(ilkSayfada)) else "KALDI"
    muafiyet = "TEK_SAYFA_THUMB_MUAF" if (tekSayfa and sonuc == "GECTI") else None
    return sonuc, ilkSayfaVar, thumbVar, tekSayfa, muafiyet

def kitap_kanit(c, kimlik, sira):
    """Kanit: (a) sayfa seridi acik ve 3+ kucuk gorsel YUKLENMIS, (b) ILK SAYFA cizili.
    Kitap 1. sayfada acilmaz (olculdu: 12/172 ile aciliyor) — seritten 1'e gidilir."""
    def olc(): return c.jsj(JS_KANIT) or {}

    atlandi = []
    for _ in range(4):                       # tanitim balonu tiklamalari YUTUYOR, once o
        a = c.jsj(JS_ATLA)
        if not a: break
        atlandi.append(a.get("t")); time.sleep(2)

    kanit = {}
    for _ in range(8):                        # serit ZATEN acikken kucuk gorseller ~10 sn'de gelir;
        kanit = olc()                         # kapaliysa asagidaki serit mantigi zaten 2x30 sn yokluyor,
        if kanit.get("thumbOK", 0) >= 3: break  # burada 60 sn beklemek her kitapta bos yere 36 sn yiyordu
        time.sleep(3)

    # SERIT BIR ANAHTARDIR: kapali sanip tiklamak aciyi kapatir. Tikladiktan sonra
    # kucuk gorseller TEMBEL yuklenir — 6 sn yetmiyordu (olculdu: 73768'in 1. ve 3.
    # kitabinda serit acildi ama olcum erken yapildi, thumbOK 0 kaldi). 30 sn yoklanir.
    if kanit.get("thumbOK", 0) < 3:
        for deneme in (1, 2):
            y = {}
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

    # ILK SAYFA: seritten BAGIMSIZ (etiketi 1 olan thumb > sayfa kutusu > geri dugmesi);
    # en soldaki thumb'a korlemesine tiklamak kaydirilmis seritte 1. sayfaya GOTURMEZ.
    if not ilk_sayfa_tamam(kanit):
        kanit = ilk_sayfaya_git(c, kanit, olc)

    kanit["atlandi"] = atlandi
    png = c.ekran()
    ssad = f"{kimlik}-k{sira:02d}"
    gonder(ssad, png)
    kanit["ekran"] = ssad; kanit["ekranBayt"] = len(png)
    kanit["ilkSayfada"] = ilk_sayfada_mi(kanit.get("sayfa"))
    # TEK SAYFALIK ICERIK: 1 sayfalik kitapcik/afis/calisma kagidinda serit hic olmaz
    # (45538/book5 kaniti: sayfa="1/1", canvas dolu ve renkli, thumbAday=0).
    # Thumb sartini KOR sekilde uygulamak sahte KALDI uretir; muafiyeti ACIK isaretle.
    kanit["sonuc"], kanit["ilkSayfaVar"], kanit["thumbVar"], kanit["tekSayfa"], muafiyet = kanit_sonucu(
        kanit.get("thumbOK"), kanit.get("canvasDolu"), kanit.get("canvasRenk"),
        kanit.get("toplamSayfa"), kanit["ilkSayfada"])
    if muafiyet:
        kanit["muafiyet"] = muafiyet
    kanit.pop("thumbIlk", None)
    kanit.pop("thumbEtiket", None)
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

    kitaplar = c.jsj(JS_MENU) or []
    r["menuKitapSayisi"] = len(kitaplar)
    r["menuAdlar"] = [k.get("ad") or k.get("id") for k in kitaplar]
    # MENU EKRANI: "pakette var ama menude yok" sinifi ancak menuye BAKILARAK kanitlanir
    # (olculdu 2026-09-22: 60114'un paketinde 4 kitap asset'i var, menu 2 kitap gosteriyor).
    try:
        mp = c.ekran(); gonder(f"{bookId}-menu", mp); r["menuEkran"] = f"{bookId}-menu"
    except Exception as e:
        r["menuEkranHata"] = str(e)[:80]
    r["varyant"] = kitaplar[0]["varyant"] if kitaplar else "tek"
    r["kitaplar"] = []

    if not kitaplar:
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

    gecen = [k for k in r["kitaplar"] if k.get("sonuc") == "GECTI"]
    r["gecenKitap"] = len(gecen); r["toplamKitap"] = len(r["kitaplar"])
    r["sonuc"] = "GECTI" if (r["kitaplar"] and len(gecen) == len(r["kitaplar"])) else "KALDI"
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
