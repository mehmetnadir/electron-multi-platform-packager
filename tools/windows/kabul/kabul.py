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

# Kok dizinler ortamdan (04.10: D: diski olurken uretim C:'ye tasindi; varsayilan eski yerlesim).
KOK = os.environ.get("KABUL_KOK") or r"D:\kabul"
YEDEK = KOK + r"\.empp-yedek-20260922"     # silmek YASAK (Nadir kurali) — kullanilan kurulum TASINIR
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
    def cmd(self, m, _zaman_asimi=None, **p):
        """_zaman_asimi (sn): verilirse bu komut icin kisa sinir (varsayilan 120 sn). Gecikmis yanit
        sonraki cmd'de id uyusmazligiyla yutulur. Asimda TimeoutError (WebSocketTimeout dahil) firlar."""
        self.i += 1
        self.ws.send(json.dumps({"id": self.i, "method": m, "params": p}))
        sinir = _zaman_asimi or 120
        son = time.time() + sinir
        if _zaman_asimi: self.ws.settimeout(_zaman_asimi)
        try:
            while time.time() < son:
                r = json.loads(self.ws.recv())
                if r.get("id") == self.i:
                    if "error" in r: raise RuntimeError(str(r["error"])[:200])
                    return r.get("result", {})
        except websocket.WebSocketTimeoutException as e:
            raise TimeoutError(m) from e
        finally:
            if _zaman_asimi:
                try: self.ws.settimeout(120)
                except Exception: pass
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
                         "+document.querySelectorAll('img.button[data-url],.book-item').length*10"
                         # Varyant C (45792 MP11, 06.10): <a href="bookN/index.html"><img class="button-book">
                         "+document.querySelectorAll('img.button-book,a[href*=\"index.html\"] img').length*10")
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

def exe_ozet(kok, derin=1):
    """kok altindaki <derin> seviye dizinlerin icindeki *.exe'lerin (mtime, boyut) ozeti.
    Ust dizin mtime'i yeniden kurulumda degismeyebilir; exe/uninstaller degisimi daha guvenilir."""
    o = {}
    kalip = os.path.join(kok, *(["*"] * derin), "*.exe")
    for f in glob.glob(kalip):
        try: st = os.stat(f); o[f] = (st.st_mtime, st.st_size)
        except Exception: pass
    return o

def exe_degisti_mi(onceki, simdi, dizin):
    """SAF KARAR: dizin icindeki bir exe baslangictan sonra yeni mi / mtime'i (>1 sn) ya da boyutu
    degisti mi. onceki/simdi: {yol: (mtime, boyut)}."""
    on = dizin.rstrip("\\/").replace("/", "\\").lower() + "\\"
    for f, (m, b) in simdi.items():
        if not f.replace("/", "\\").lower().startswith(on): continue
        if f not in onceki: return True
        om, ob = onceki[f]
        if m > om + 1 or b != ob: return True
    return False

def kurucu_durum(cikis, gecen_sn, durduruldu=None):
    """SAF KARAR: kurucu surecinin durumu. cikis=p.poll() (None = hala suruyor)."""
    if cikis is None:
        d = {"bitti": False, "durum": "surüyor", "sure_sn": round(gecen_sn)}
    else:
        d = {"bitti": True, "cikis": cikis, "sure_sn": round(gecen_sn)}
    if durduruldu is not None: d["durduruldu"] = durduruldu
    return d

def kurulu_say(kurucu_cikis, hedef, exe_var):
    """SAF KARAR: kurucu 0 ile bittiyse ve hedefte beklenen exe varsa KURULDU; hedef yoksa KURULMADI."""
    if not hedef: return False
    return bool(exe_var) and kurucu_cikis in (0, None)

def kurucu_durdur(p):
    """Zaman asiminda kurucuyu ve cocuklarini durdurur (Windows'ta agac birlikte olmez: taskkill /T /F).
    Donen: durdurma notu (kaynak/deger icermez)."""
    if p.poll() is not None: return "zaten-bitmis"
    try:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)], capture_output=True, timeout=30)
        try: p.wait(timeout=10)
        except Exception: pass
        return "durduruldu" if p.poll() is not None else "durdurulamadi"
    except Exception as e:
        return "durdurma-hata:" + type(e).__name__

def kur(exe, tavan=1200):
    # NOT: kabul oncesi eski kurulumun kaldirilmasi burada YOK; main() her kabul sonunda kaldir()
    # cagirir (kaldirici ya da D:\\kabul\\.empp-yedek altina TASI, silme yok). Artik dizin varsa
    # exe_degisti_mi() ile yeniden kurulum yine algilanir.
    a = aile(exe)
    t0 = time.time()
    if a == "sfx":
        onceki = dizinler(DIJITAP, 2); onceki_exe = exe_ozet(DIJITAP, 2)
        p = subprocess.Popen([exe])
        kok, derin, sart = DIJITAP, 2, lambda d: os.path.exists(os.path.join(d, "ZKitap.exe"))
    else:
        onceki = dizinler(PROGRAMS, 1); onceki_exe = exe_ozet(PROGRAMS, 1)
        p = subprocess.Popen([exe, "/S"])
        kok, derin, sart = PROGRAMS, 1, lambda d: os.path.basename(d).lower() not in KORUNAN
    son = t0 + tavan
    hedef = None
    while time.time() < son:
        time.sleep(5)
        simdi = dizinler(kok, derin); simdi_exe = exe_ozet(kok, derin)
        aday = [d for d, m in simdi.items()
                if (d not in onceki or m > onceki[d] + 1 or exe_degisti_mi(onceki_exe, simdi_exe, d))
                and sart(d)]
        if aday:
            d = sorted(aday, key=lambda x: simdi[x])[-1]
            x = klasor_boyut(d); time.sleep(15); y = klasor_boyut(d)
            if x == y and y > 5_000_000:
                hedef = d; break
    try: p.wait(timeout=10)
    except Exception: pass
    cikis = p.poll()
    durduruldu = None
    if not hedef and cikis is None:
        durduruldu = kurucu_durdur(p)
        cikis = p.poll()
    kd = kurucu_durum(cikis, time.time() - t0, durduruldu)
    if not hedef:
        return {"durum": "KURULMADI", "aile": a, "kurucu": kd}
    if a == "sfx":
        ana = os.path.join(hedef, "ZKitap.exe")
    else:
        ex = [f for f in glob.glob(os.path.join(hedef, "*.exe"))
              if not os.path.basename(f).lower().startswith("uninstall")]
        if not ex: return {"durum": "EXE_YOK", "aile": a, "dizin": hedef, "kurucu": kd}
        ana = ex[0]
    return {"durum": "KURULDU", "aile": a, "dizin": hedef, "exe": ana, "kurucu": kd,
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
   const ic=e.querySelector('.book-cover-image, .book-cover, img')||e;
   const ri=ic.getBoundingClientRect();
   const cx=ri.width>10?ri.x+ri.width/2:r.x+r.width/2;
   const cy=ri.height>10?ri.y+ri.height/2:r.y+r.height/2;
   return {x:Math.round(cx),y:Math.round(cy),w:Math.round(r.width),h:Math.round(r.height)};};
 let l=[...document.querySelectorAll('img.button[data-url]')].map((e,i)=>
   Object.assign({varyant:'A',indis:i,id:e.id||null,url:e.dataset.url,ad:e.id||'',seri:false},kutu(e)));
 if(!l.length) l=[...document.querySelectorAll('.book-item')].filter(e=>!e.classList.contains('book-group-back')).map((e,i)=>
   Object.assign({varyant:'B',indis:i,id:'book'+(i+1),url:null,ad:(e.innerText||'').trim().slice(0,40),seri:e.classList.contains('book-group')},kutu(e)));
 if(!l.length) l=[...document.images].filter(i=>/images\/book\d+\.(png|jpe?g)/i.test(i.currentSrc||i.src||''))
   .map((i,n)=>{const e=i.closest('a, div')||i;
     return Object.assign({varyant:'C',indis:n,id:'book'+(n+1),url:null,ad:(e.innerText||'').trim().slice(0,40),seri:false},kutu(e));});
 return JSON.stringify(l.filter(o=>o.w>40&&o.h>40));})()"""

# Menude kitap OLMAYAN ogeler: config/settings.json'da contentType/type "link" (45551 "Worksheets" ->
# https://download.ydspublishing.com/...; tiklayinca tuval acilmaz). Olculdu 03.10: kabul bunu kitap
# sayip "book5 ACILMADI" ile paketi KALDI yapti. Ayar okunamazsa null -> eski davranis (hepsi kitap).
JS_BAGLANTILAR = r"""
(async()=>{try{const y=await fetch(new URL('config/settings.json',location.href).href);
 if(!y.ok) return null; const j=await y.json(); const bag=[],kit=[];
 const gez=(o,d)=>{if(!o||typeof o!=='object'||d>6) return;
   const tur=String(o.contentType||o.type||'').toLowerCase();
   if(typeof o.title==='string'&&tur==='link') bag.push({ad:o.title.trim(),url:String(o.url||'')});
   else if(typeof o.title==='string'&&tur==='book') kit.push(o.title.trim());
   for(const v of Object.values(o)) gez(v,d+1);};
 gez(j,0); return JSON.stringify({baglanti:bag,kitap:kit});}catch(e){return null;}})()"""

def baglanti_ayir(kitaplar, ayar):
    """SAF KARAR: menu ogelerinden settings.json'daki "link" ogelerini ayirir (adin ilk satiri, harf
    buyuklugu yok sayilarak). Ayni ad bir kitapta da varsa AYRILMAZ (kitap kaniti atlanmasin).
    Donen: (kitaplar, baglantilar[{ad,url,id}])."""
    if not ayar or not isinstance(ayar, dict): return list(kitaplar), []
    kitap_ad = {str(a).strip().casefold() for a in (ayar.get("kitap") or [])}
    bag = {}
    for b in ayar.get("baglanti") or []:
        ad = str((b or {}).get("ad") or "").strip().casefold()
        if ad and ad not in kitap_ad: bag[ad] = b.get("url") or ""
    kalan, ayrilan = [], []
    for k in kitaplar:
        ad = str(k.get("ad") or "").split("\n\n")[0].strip().casefold()
        if ad in bag: ayrilan.append({"ad": k.get("ad"), "url": bag[ad], "id": k.get("id")})
        else: kalan.append(k)
    return kalan, ayrilan

def menu_varyant_sec(a_var, b_var, c_var):
    """SAF KARAR: JS_MENU'nun ayna/mirror'i (yukarida) — tarayici disi (Python) test icin.
    JS_MENU string'i DEGISMEDI; bu fonksiyon onun BELGELENEN A->B->C oncelik kuralini
    kilitler: A varsa A, yoksa B varsa B, yoksa C varsa C, hicbiri yoksa None (tek-kitap
    dalina dusulur — bkz. main()'deki 'if not kitaplar')."""
    if a_var: return "A"
    if b_var: return "B"
    if c_var: return "C"
    return None

def js_kutu_guncelle(varyant, ad, indis):
    """SAF KARAR: scrollIntoView cagrili kordinat guncelleme JS'ini (CDP icin) uretir.
    Ekran disi (3. satir vb) kartlara tiklamadan once cagirilir."""
    ad_json = json.dumps(ad)
    return f"""
    (()=>{{
      let v="{varyant}", ad={ad_json}, indis={indis}, e=null;
      if(v==='A') {{
         let els=[...document.querySelectorAll('img.button[data-url]')];
         e = els.find(x=>(x.id||'')===ad) || els[indis];
      }} else if(v==='B') {{
         let els=[...document.querySelectorAll('.book-item')].filter(x=>!x.classList.contains('book-group-back'));
         e = els.find(x=>(x.innerText||'').trim().slice(0,40)===ad) || els[indis];
      }} else {{
         let imgs=[...document.images].filter(i=>/images\\/book\\d+\\.(png|jpe?g)/i.test(i.currentSrc||i.src||''));
         let els=imgs.map(i=>i.closest('a, div')||i);
         e = (ad ? els.find(x=>(x.innerText||'').trim().slice(0,40)===ad) : null) || els[indis];
      }}
      if(!e) return null;
      e.scrollIntoView({{block: 'center', inline: 'center'}});
      const r=e.getBoundingClientRect();
      const ic=e.querySelector('.book-cover-image, .book-cover, img')||e;
      const ri=ic.getBoundingClientRect();
      const cx=ri.width>10?ri.x+ri.width/2:r.x+r.width/2;
      const cy=ri.height>10?ri.y+ri.height/2:r.y+r.height/2;
      return JSON.stringify({{x:Math.round(cx),y:Math.round(cy),w:Math.round(r.width),h:Math.round(r.height)}});
    }})()"""

def kitaplari_genislet(kitaplar, js_cagirici):
    """SAF KARAR: Ana menudeki kitaplarin icindeki serileri acar ve duz listeye genisletir.
    js_cagirici(islem, arg) -> e.g. js_cagirici('kutu_guncelle', kit) -> scroll+measure"""
    genisletilmis = []
    for kit in kitaplar:
        if kit.get("seri"):
            js_cagirici("kutu_guncelle", kit)
            js_cagirici("tikla", kit)
            js_cagirici("bekle", 2)
            ic_kitaplar = js_cagirici("menu_al", None) or []
            for ic in ic_kitaplar:
                ic_kopya = dict(ic)
                ic_kopya["seri_ana"] = kit
                ic_kopya["ad"] = f"{kit.get('ad')} / {ic_kopya.get('ad')}"
                genisletilmis.append(ic_kopya)
            js_cagirici("ana_menu", None)
            js_cagirici("bekle", 1)
        else:
            genisletilmis.append(kit)
    return genisletilmis


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

# ── SAYFALAR KARTI (73768, 04.10 olcumu) ──────────────────────────────────────
# Tanitim turu 'previewCard' adiminda Sayfalar kartini ACIK birakir; JS_SERIT'e tiklamak onu
# KAPATIR (anahtar). Kart icindeki thumb <img>'leri IntersectionObserver ile TEMBEL uretilir:
# olculen: kart acikken img=0 (gorunur 1536x794), kapat-ac sonrasi gercek thumbs/13.jpg+14.jpg
# (yalniz 2, esik 3). Gercek kullanici ne yaparsa o: kapat-ac, seridi kaydir (scrollBy,
# tekerlek, seridin kendi '>' dugmesi), karti tetikle (resize). ESIK GEVSEMEZ: >=3 gercek thumb.
JS_KART = r"""
(()=>{const pc=document.querySelector('[data-tour=previewCard]');if(!pc)return JSON.stringify({var:false});
 const r=pc.getBoundingClientRect();const tf=pc.style.transform||'';
 const im=[...pc.querySelectorAll('img')];
 return JSON.stringify({var:true,acik:!/scaleY\(0\)/.test(tf)&&pc.style.opacity!=='0'&&r.height>0,
   h:Math.round(r.height),img:im.length,imgOK:im.filter(i=>i.naturalWidth>0).length,
   thumbKaynak:im.filter(i=>i.naturalWidth>0&&/thumb/i.test(i.getAttribute('src')||'')).length});})()"""

JS_KART_KAPAT = r"""
(()=>{const pc=document.querySelector('[data-tour=previewCard]');if(!pc)return null;
 const b=[...pc.querySelectorAll('button')].find(x=>(x.textContent||'').trim().toLowerCase()==='x');
 if(!b)return null;b.click();return 'x';})()"""

JS_SERIT_KAYDIR = r"""
(()=>{const s=document.querySelector('.im-preview-tabs-scroller');if(!s)return null;
 const once=s.scrollLeft;s.scrollBy({left:Math.max(240,Math.round(s.clientWidth*0.5))});
 s.dispatchEvent(new Event('scroll'));const r=s.getBoundingClientRect();
 return JSON.stringify({once:Math.round(once),sonra:Math.round(s.scrollLeft),
   x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()"""

JS_SERIT_OK = r"""
(()=>{const pc=document.querySelector('[data-tour=previewCard]');if(!pc)return null;
 const ok=[...pc.querySelectorAll('[class*=MuiTabScrollButton],[class*=MuiTabs-scrollButtons]')]
   .filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;});
 if(!ok.length)return null;const b=ok[ok.length-1];const r=b.getBoundingClientRect();b.click();
 return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()"""

JS_YENIDEN_BOYUT = r"""(()=>{window.dispatchEvent(new Event('resize'));return 'resize';})()"""

CDP_TEKERLEK_SN = 15

def serit_eylem_plani(kart, tur):
    """SAF KARAR: Sayfalar karti icin bu turda yapilacak gercek-kullanici eylemleri.
    tur 0: kart aciksa KAPAT-AC (acik karta JS_SERIT tiklamak onu kapatir), kapaliysa AC.
    Sonraki turlar: kaydir -> tekerlek -> seridin '>' dugmesi, sirayla. Kart acik ama img uretmemis
    ve basik (h<100) ise once 'boyut' (resize: kartin genislemesini tetikler)."""
    if not kart or not kart.get("var"):
        return []
    if tur == 0:
        return ["kapat", "ac"] if kart.get("acik") else ["ac"]
    if not kart.get("acik"):
        return ["ac"]
    eylem = []
    if kart.get("img", 0) == 0 and kart.get("h", 0) < 100:
        eylem.append("boyut")
    eylem.append(("kaydir", "tekerlek", "ok")[(tur - 1) % 3])
    return eylem

def kart_eylemi(c, eylem):
    """Tek eylemi uygular; ne yapildigini (kanit icin) dondurur."""
    if eylem == "kapat":
        return "kapat" if c.js(JS_KART_KAPAT) == "x" else "kapat-yok"
    if eylem == "ac":
        sp = c.jsj(JS_SERIT)
        return f"ac-{sp.get('yol')}" if sp else "ac-yok"
    if eylem == "boyut":
        c.js(JS_YENIDEN_BOYUT)
        return "boyut"
    if eylem == "kaydir":
        k = c.jsj(JS_SERIT_KAYDIR)
        return f"kaydir-{k.get('once')}>{k.get('sonra')}" if k else "kaydir-yok"
    if eylem == "tekerlek":
        k = c.jsj(JS_SERIT_KAYDIR)   # konum icin (ayni zamanda bir adim kaydirir)
        if not k:
            return "tekerlek-yok"
        # Pencere kare uretmiyorsa dispatchMouseEvent yanit vermez → 72380'in ilk kabulu WebSocket zaman
        # asimiyla "olculemedi" dustu. Kisa sinir; asimda adim ATLANIR, olcum (thumb sayimi) surer.
        try:
            c.cmd("Input.dispatchMouseEvent", _zaman_asimi=CDP_TEKERLEK_SN, type="mouseWheel",
                  x=k["x"], y=k["y"], deltaX=240, deltaY=0)
        except (websocket.WebSocketConnectionClosedException, ConnectionError):
            raise   # baglanti KOPTU: olcume devam edilemez — sessizce yutulmaz, ust katman "olculemedi" der
        except (TimeoutError, OSError, websocket.WebSocketException) as e:
            log("KAYDIRMA-ATLANDI", "tekerlek", type(e).__name__)
            return "tekerlek-zamanasimi"
        return "tekerlek"
    if eylem == "ok":
        return "ok" if c.jsj(JS_SERIT_OK) else "ok-yok"
    return f"bilinmeyen-{eylem}"

def kart_ile_thumb_yukle(c, olc, kanit, tur_sayisi=7, bekle_adim=3):
    """Sayfalar karti VARSA gercek kullanici gibi kapat-ac + kaydir; >=3 gercek thumb arar.
    Kart yoksa kanit aynen doner (eski serit mantigi devreye girer)."""
    kart = c.jsj(JS_KART) or {}
    if not kart.get("var"):
        return kanit, False
    yapilan = []
    for tur in range(tur_sayisi):
        tanitimi_kapat(c, tur=2)
        for e in serit_eylem_plani(kart, tur):
            yapilan.append(kart_eylemi(c, e))
            time.sleep(1.5)
        for _ in range(bekle_adim):
            time.sleep(3)
            y = olc()
            if y.get("thumbOK", 0) > kanit.get("thumbOK", 0) or not kanit:
                kanit = y
            if y.get("thumbOK", 0) >= 3:
                kanit = y
                break
        kart = c.jsj(JS_KART) or kart
        if kanit.get("thumbOK", 0) >= 3:
            break
    kanit["kartEylem"] = yapilan
    kanit["kart"] = {k: kart.get(k) for k in ("acik", "h", "img", "imgOK", "thumbKaynak")}
    return kanit, True

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

JS_SAYFA_TUSLARI = r"""
(()=>{ // Sayfa kutusu (BUTTON '12/172') tiklaninca ekran tus takimli 'Sayfa numarasi' acilir; klavye
 // girdisi alanı DOLDURMAZ (olculdu 03.10, 73768 probe: '1'+Enter sonrasi 12/172'de kaldi).
 // Gorunur kisa-metinli dugmeler dokulur; hangisine tiklanacagina Python karar verir (tus_takimi_sec).
 const o=[];
 for(const e of document.querySelectorAll('button,[role=button],div,span')){
   const r=e.getBoundingClientRect(); if(r.width<20||r.height<20||r.width>200||r.height>120) continue;
   const t=(e.innerText||e.textContent||'').trim(); if(t.length>1) continue;
   if(e.tagName!=='BUTTON'&&e.getAttribute('role')!=='button'&&e.children.length>1) continue;
   o.push({t:t,x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),b:e.tagName==='BUTTON'});}
 return JSON.stringify(o);})()"""

def tus_takimi_sec(dugmeler):
    """SAF KARAR: ekran tus takimindan {'bir':(x,y), 'tamam':(x,y)}; tus takimi yoksa None.
    Tus takimi = 0..9 rakamlarinin hepsi gorunur. 'tamam' (✓, metinsiz) = '0' ile ayni satirda,
    '0'in sagindaki en sagdaki metinsiz dugme (73768 probe ekrani: [⌫] [0] [✓])."""
    d = [x for x in (dugmeler or []) if isinstance(x, dict) and "x" in x and "y" in x]
    rakam = {}
    for x in d:
        t = str(x.get("t") or "")
        if t.isdigit() and len(t) == 1 and (t not in rakam or x.get("b")): rakam[t] = x
    if len(rakam) < 10: return None
    sifir = rakam["0"]
    sag = [x for x in d if not str(x.get("t") or "").strip() and abs(x["y"] - sifir["y"]) <= 12
           and x["x"] > sifir["x"] + 10]
    if not sag: return None
    tamam = max(sag, key=lambda x: (x["x"], bool(x.get("b"))))
    return {"bir": (rakam["1"]["x"], rakam["1"]["y"]), "tamam": (tamam["x"], tamam["y"])}

def tanitimi_kapat(c, tur=4):
    """42 adimlik tanitim balonu kitap acildiktan SONRA (sn'ler icinde) gelir ve tiklamalari yutar
    (73768 probe 03.10: 'Sayfalar' tiklamasi seridi acmadi, balonu 2/42'ye ilerletti). Her gezinme
    adimindan once cagrilir; kapatilan balon metinleri doner."""
    kapanan = []
    for _ in range(tur):
        a = c.jsj(JS_ATLA)
        if not a: break
        kapanan.append(a.get("t")); time.sleep(2)
    return kapanan

def ilk_sayfa_plani(kanit):
    """SAF KARAR: 1. sayfaya gitme yollari, sirayla (2026-10-03, 73768 kaniti).
    Serit o anki sayfaya kaydirilmis olabilir: EN SOLDAKI thumb 1. sayfa DEGILDIR (book3: serit
    8-12'yi gosteriyordu, en soldakine 3 kez tiklandi, 8/136'da kaldi). Bu yuzden:
      - etiketi '1' olan thumb gorunuyorsa ona tikla ('etiket1');
      - etiketler var ama 1 yoksa en soldakine TIKLAMA — sayfa kutusu ('kutu'), sonra geri
        dugmesi ('geri');
      - etiket hic okunamadiysa (baska tema) eski yol ('thumbIlk') once denenir, sonra kutu/geri.
    etiket1 tutmazsa kutu/geri YEDEK kalir (73768 book1, 05.10 17:24: etiket 1'e tiklandi, gosterge
    12/172'de kaldi, plan bittigi icin KALDI; onceki kosularda ayni kitap kutu ile 1/172'ye gitmisti)."""
    etiket = [e for e in (kanit.get("thumbEtiket") or []) if isinstance(e, dict)]
    if any(e.get("n") == 1 for e in etiket): return ["etiket1", "kutu", "geri"]
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

THUMB_ALANLARI = ("thumbAday", "thumbOK", "thumbBoyut", "kartEylem", "kart", "seritYolu")

def ilk_sayfaya_git(c, kanit, olc):
    """ilk_sayfa_plani() sirasiyla dener; her adimdan sonra olcer, 1/N + cizili tuvalde durur.
    THUMB KANITI KORUNUR (73768, 05.10): kutu/geri yolu sayfa tus takimini acar, sayfalar
    karti kapanir, son olcum thumbOK=0 olur. Seritteki gercek yukleme kaniti (gezinmeden ONCEKI
    olcum) bu yuzden dusuyordu: son 80 kosuda kutu-tuslar 7/7, geri 4/4 sahte KALDI; etiket1 38/38
    GECTI. Onceki olcum sonrakinden yuksekse thumb alanlari geri yazilir (thumbOnceki=True);
    esik (>=3) ve sayfa/tuval olcumu degismez."""
    onceki = {k: kanit[k] for k in THUMB_ALANLARI if k in kanit}
    kanit = _ilk_sayfaya_git(c, kanit, olc)
    if (onceki.get("thumbOK") or 0) > (kanit.get("thumbOK") or 0):
        kanit.update(onceki); kanit["thumbOnceki"] = True
    return kanit

def _ilk_sayfaya_git(c, kanit, olc):
    def yeni(y, yol):
        y = y or {}
        y["seritAnahtari"] = kanit.get("seritAnahtari"); y["ilkSayfaYolu"] = yol
        return y
    for yol in ilk_sayfa_plani(kanit):
        if ilk_sayfa_tamam(kanit): break
        tanitimi_kapat(c)
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
            c.tikla(k["x"], k["y"]); time.sleep(1.5)
            tk = tus_takimi_sec(c.jsj(JS_SAYFA_TUSLARI))
            if tk:
                c.tikla(*tk["bir"]); time.sleep(0.6); c.tikla(*tk["tamam"]); yol = "kutu-tuslar"
            else:
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

    atlandi = tanitimi_kapat(c)               # tanitim balonu tiklamalari YUTUYOR, once o

    kanit = {}
    for _ in range(8):                        # serit ZATEN acikken kucuk gorseller ~10 sn'de gelir;
        atlandi += tanitimi_kapat(c, tur=2)   # balon acilistan sn'ler SONRA gelir (73768) — her turda
        kanit = olc()                         # kapaliysa asagidaki serit mantigi zaten 2x30 sn yokluyor,
        if kanit.get("thumbOK", 0) >= 3: break  # burada 60 sn beklemek her kitapta bos yere 36 sn yiyordu
        time.sleep(3)

    # SAYFALAR KARTI (73768, 04.10): kart varsa gercek kullanici gibi kapat-ac + kaydir.
    kartli = False
    if kanit.get("thumbOK", 0) < 3:
        kanit, kartli = kart_ile_thumb_yukle(c, olc, kanit)

    # SERIT BIR ANAHTARDIR: kapali sanip tiklamak aciyi kapatir. Tikladiktan sonra
    # kucuk gorseller TEMBEL yuklenir — 6 sn yetmiyordu (olculdu: 73768'in 1. ve 3.
    # kitabinda serit acildi ama olcum erken yapildi, thumbOK 0 kaldi). 30 sn yoklanir.
    # Sayfalar karti olan temada bu kor anahtar KOSMAZ (karti kapatip birakirdi).
    if kanit.get("thumbOK", 0) < 3 and not kartli:
        for deneme in (1, 2):
            y = {}
            atlandi += tanitimi_kapat(c)
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

# ─────────────────────────── aktivasyon senaryosu ───────────────────────────
# Nadir 03.10: "Windows'ta aktivasyonun nasil calistigini gormek istiyorum." Kapi aktivasyonlu
# seride (EMPP_KABUL_AKTIVASYON=1) INTERNETSIZ (uygulama exe'sine giden cikis guvenlik duvarinda
# kesik; okuyucu window.isOnline=false gorur -> imKeys.dll ile cevrimdisi dogrulama, koltuk
# tuketilmez) ve TEMIZ profille (--user-data-dir, olculur) bes adim olcer, her biri ekran goruntusuyle:
#   a) anahtarli kitap -> kod istenir   b) gecersiz kod -> "Aktivasyon kodu hatali!"
#   c) gecerli kod -> kitap acilir      d) menu -> baska kitap -> kod ISTENMEZ
#   e) uygulama kapatilip acilir -> kitap kodsuz acilir
# Okuyucu diyalogu (45550 book1 main.js): MUI Dialog "Aktivasyon", input type=password (ekranda
# MASKELI), Enter gonderir; hata snackbar'i 1,5 sn'de kaybolur. GECERLI KOD dosyadan okunur ve
# HICBIR log/rapor/dosya adina yazilmaz.
AKT_KOD_DOSYASI = os.environ.get("KABUL_AKT_KOD_DOSYASI") or r"D:\empp-ajan\kabul\aktivasyon-test-kodu.txt"
AKT_GECERSIZ_KOD = "KABULGECERSIZ0"
AKT_ADIMLAR = ("a", "b", "c", "d", "e")

JS_AKT = r"""
(()=>{ const t=document.body?(document.body.innerText||''):'';
 const d=[...document.querySelectorAll('[role=dialog],.MuiDialog-root,.MuiDialog-container')]
   .some(e=>/aktivasyon/i.test(e.innerText||''));
 const inp=[...document.querySelectorAll('input[type=password]')].find(e=>{const q=e.getBoundingClientRect();return q.width>0&&q.height>0;});
 let g=null; if(inp){const q=inp.getBoundingClientRect(); g={x:Math.round(q.x+q.width/2),y:Math.round(q.y+q.height/2)};}
 const H=window.innerHeight, W=window.innerWidth;
 // Raf kapagi IKI bicimde: <img> YA DA background-image tasiyan DIV (45449 tek-motor raf, olculdu
 // 03.10: kapaklar div.style-212 'url(.../assets/<id>/<guid>.png)', document.images bos -> raf=0,
 // aktivasyon gercekten basariliyken c KALDI). Boyut: kapak olcusu, sayfa arka plani degil.
 const kapakMi=q=>q.width>=120&&q.height>=150&&q.width<=W*0.5&&q.height<=H*0.8&&q.y>=0&&q.y<H;
 const merkez=q=>({id:'kapak',x:Math.round(q.x+q.width/2),y:Math.round(q.y+q.height/2)});
 const raf=[...document.images].filter(i=>i.naturalWidth>0&&kapakMi(i.getBoundingClientRect()))
   .map(i=>merkez(i.getBoundingClientRect()))
   .concat([...document.querySelectorAll('div,a,span,button')].filter(e=>{
     const b=getComputedStyle(e).backgroundImage; return b&&b.indexOf('url(')>=0&&kapakMi(e.getBoundingClientRect());})
     .map(e=>merkez(e.getBoundingClientRect())));
 const sn=[...document.querySelectorAll('[role=alert],[role=status],.MuiSnackbarContent-message,.MuiAlert-message,.notistack-Snackbar,[class*=nackbar]')]
   .map(e=>(e.innerText||'').trim()).filter(Boolean).join(' | ').slice(0,120);
 return JSON.stringify({diyalog:d||(!!inp&&/aktivasyon/i.test(t)),girdi:g,hata:/aktivasyon kodu hatal/i.test(t),
   girdiDolu:inp?(inp.value||'').length>0:null,
   kitapta:document.querySelectorAll('canvas.lower-canvas').length>0,raf:raf.slice(0,10),snack:sn||null,
   online:(typeof window.isOnline==='boolean')?window.isOnline:null,gorunur:document.visibilityState});})()"""

# Hata latch'i (04.10 45469 imzali kabul b KALDI dersi): snackbar 1,5 sn yasar; 0,15 sn'lik CDP yoklamasi
# kacirabilir. Kod girilmeden ONCE sayfaya MutationObserver kurulur; ilk gorulen hata metni + zaman
# window.__emppAktHata'da KALIR (yoklama hizindan bagimsiz). Metin tek-motor (MUI Snackbar) ve
# okuyucu (45550 MUI Alert) icin: gorunen herhangi bir dugum metni /aktivasyon kodu hatal/i.
JS_AKT_LATCH_KUR = r"""
(()=>{ if(window.__emppAktObs) return 'var';
 const re=/aktivasyon kodu hatal/i;
 const bak=t=>{ if(window.__emppAktHata) return; const m=((t&&t.textContent)||'');
   if(re.test(m)) window.__emppAktHata={metin:m.trim().slice(0,80),t:Date.now()}; };
 window.__emppAktObs=new MutationObserver(ms=>{ for(const m of ms){ bak(m.target);
   m.addedNodes.forEach(n=>bak(n)); } });
 window.__emppAktObs.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
 bak(document.body); return 'kuruldu';})()"""
JS_AKT_LATCH_OKU = "JSON.stringify({hata:window.__emppAktHata||null,kurulu:!!window.__emppAktObs})"

def akt_latch_hata(l):
    """SAF: latch okumasindan ilk hata metni (str) | None. Gecersiz/eksik giris -> None."""
    h = (l or {}).get("hata") if isinstance(l, dict) else None
    if isinstance(h, dict): h = h.get("metin")
    return h if isinstance(h, str) and h else None

def akt_b_hata_goruldu(olcum, latch):
    """SAF: b'nin hata kaniti — latch (yoklamadan bagimsiz) YA DA anlik olcumdeki hata/snack metni."""
    o = olcum or {}
    if akt_latch_hata(latch): return True
    return bool(o.get("hata")) or bool(o.get("snack") and re.search(r"aktivasyon kodu hatal", str(o["snack"]), re.I))

def akt_giris_yeniden_mi(olcum, latch, gecen_sn, bekle_sn=3.0):
    """SAF KARAR: kod girisi hic ulasmadi mi (yeniden denenmeli)? Sart: bekle_sn gecti, hata kaniti yok,
    girdi BOS (girdiDolu is False; None = olculemedi -> yeniden deneme yok). Dolu girdi = giris
    ulasti, hata beklenir (yeniden girmek ayni kodu iki kez gondermesin)."""
    if gecen_sn < bekle_sn or akt_b_hata_goruldu(olcum, latch): return False
    return (olcum or {}).get("girdiDolu") is False

# Cevrimdisi kara delik: Symantec Endpoint Protection kasada Windows Guvenlik Duvari kurallarini
# UYGULATMIYOR (olculdu 03.10: curl'e blok kurali kondu, baglanti yine 302 dondu; profil
# "LocalFirewallRules N/A (GPO-store only)"). Asil yontem: Chromium'a olu proxy — renderer'in
# fetch'i (okuyucunun isOnline probu + aktivasyon istegi) agaa CIKAMAZ; CDP/file:// etkilenmez.
AKT_PROXY_ARGV = ["--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>"]
AKT_OLU_PROXY = "http://127.0.0.1:9"
AKT_INSPECT_PORT = 9334    # ana surec (Node) olcumu icin; renderer CDP portu ayri (PORT)
AKT_DIS_ADRES = "https://akillitahta.ydspublishing.com/"

def akt_ortami(taban, profil):
    """SAF: uygulama ortami — temiz APPDATA + ana surec icin olu proxy (HTTP(S)_PROXY, NO_PROXY bos).
    Not: Electron 27'nin Node'u HTTPS_PROXY'yi kendiliginden UYGULAMAZ; ana surecin gercekten
    kapali olup olmadigi ana_surec_ag_olc() ile OLCULUR, varsayilmaz."""
    env = dict(taban); env["APPDATA"] = profil
    for k in ("HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "ALL_PROXY"):
        env[k] = AKT_OLU_PROXY
    env["NO_PROXY"] = ""; env["no_proxy"] = ""
    return env

def akt_argv(ana, profil):
    """SAF: aktivasyon kipinde uygulama argv'si. --user-data-dir ZORUNLU: Windows'ta Electron userData'yi
    APPDATA ortamindan DEGIL Known Folder API'sinden alir (olculdu 03.10: APPDATA=temiz profil verildi,
    okuyucu yine %USERPROFILE%\\AppData\\Roaming\\<slug>\\work'e yazdi; kuru kosu 1'in cevrimici
    aktivasyonu kuru kosu 2'ye tasindi, diyalog hic cikmadi -> a KALDI). Yalitim ayrica OLCULUR."""
    return [ana, f"--remote-debugging-port={PORT}", "--remote-allow-origins=*",
            f"--inspect=127.0.0.1:{AKT_INSPECT_PORT}", f"--user-data-dir={profil}"] + AKT_PROXY_ARGV

def ana_surec_degerlendir(ifade, port=AKT_INSPECT_PORT):
    """Ana surecte (Node, --inspect) ifade degerlendirir. Deger | None (baglanilamadi)."""
    try:
        d = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5))
        ws = d[0]["webSocketDebuggerUrl"]
    except Exception:
        return None
    m = None
    try:
        m = CDP(ws)
        return m.js(ifade)
    except Exception:
        return None
    finally:
        if m: m.kapat()

def ana_surec_ag_olc(port=AKT_INSPECT_PORT, hedef=AKT_DIS_ADRES):
    """Ana surecten (Node https) dis adrese HEAD dener. 'kapali:<kod>' | 'acik:<http>' | None (olculemedi)."""
    ifade = ("new Promise(r=>{try{const req=(process.mainModule||module).require('https')"
             ".request(" + json.dumps(hedef) + ",{method:'HEAD',timeout:5000},s=>{r('acik:'+s.statusCode);s.resume();});"
             "req.on('timeout',()=>{req.destroy();r('kapali:zamanasimi');});"
             "req.on('error',e=>r('kapali:'+(e.code||e.message)));req.end();}catch(e){r('olculemedi:'+e.message);}})")
    v = ana_surec_degerlendir(ifade, port)
    return v if isinstance(v, str) and not v.startswith("olculemedi") else None

JS_ANA_PROFIL = ("(()=>{try{const e=(process.mainModule||module).require('electron');"
                 "return JSON.stringify({userData:e.app.getPath('userData'),work:process.env.EMPP_WORK_DIR||null});"
                 "}catch(x){return null;}})()")

def ana_surec_profil_olc(port=AKT_INSPECT_PORT):
    """Ana surecin GERCEK userData'si ve fs-shim WORK dizini (aktivasyon kaydi ImWin32.dll buraya
    yazilir). {'userData':..., 'work':...} | None (olculemedi)."""
    v = ana_surec_degerlendir(JS_ANA_PROFIL, port)
    try:
        o = json.loads(v) if isinstance(v, str) else None
    except ValueError:
        return None
    return o if isinstance(o, dict) and o.get("userData") else None

JS_ANA_PENCERE = ("(()=>{try{const {BrowserWindow}=(process.mainModule||module).require('electron');"
                  "const w=BrowserWindow.getAllWindows();"
                  "const once=w.map(x=>({gorunur:x.isVisible(),kucuk:x.isMinimized(),odak:x.isFocused()}));"
                  "w.forEach(x=>{if(x.isMinimized())x.restore();if(!x.isVisible())x.show();});"
                  "return JSON.stringify({pencere:w.length,once:once});}catch(e){return null;}})()")

def ana_surec_pencere_goster(port=AKT_INSPECT_PORT):
    """Kuru kosu 3 (03.10): uc ekran goruntusu de 120 sn'de dondu (Page.captureScreenshot cevapsiz),
    gecerli koddan sonra diyalog kapanmadi (MUI cikis gecisi rAF ister) -> c KALDI; kod imKeys'te
    VARDI (28/28 kabul). Kare uretmeyen pencere belirtisi: ana surecten gizli/kucuk pencere geri
    getirilir ve onceki durum rapora yazilir. {'pencere':n,'once':[...]} | None."""
    v = ana_surec_degerlendir(JS_ANA_PENCERE, port)
    try:
        return json.loads(v) if isinstance(v, str) else None
    except ValueError:
        return None

def pencere_sorunlu_mu(durum):
    """SAF: once-durumunda gizli ya da kucultulmus pencere var mi (None -> olculemedi = False)."""
    return any((not w.get("gorunur")) or w.get("kucuk") for w in ((durum or {}).get("once") or []))

def profil_yalitik_mi(olcum, profil):
    """SAF KARAR: userData (ve varsa WORK) temiz profilin ICINDE mi. Olculemezse False -> kod girilmez
    (onceki kosunun aktivasyon kaydi diyalogu gizler; olcum anlamsizlasir)."""
    if not olcum or not olcum.get("userData"): return False
    kok = os.path.normcase(os.path.abspath(profil)).rstrip("\\/")
    def icinde(yol):
        q = os.path.normcase(os.path.abspath(yol))
        return q == kok or q.startswith(kok + os.sep)
    return icinde(olcum["userData"]) and (not olcum.get("work") or icinde(olcum["work"]))

def aktivasyon_kod_oku(yol):
    """Gecerli test kodunu okur (tek satir, bosluksuz). Yoksa/bossa None. DEGERI HIC YAZDIRMA."""
    try:
        with open(yol, "r", encoding="utf-8-sig") as f:
            satirlar = [x.strip() for x in f.read().splitlines() if x.strip()]
    except OSError:
        return None
    if len(satirlar) != 1 or any(ch.isspace() for ch in satirlar[0]): return None
    return satirlar[0]

# ── KITAP BAZLI KOD KAYNAGI (05.10) ──────────────────────────────────────────────────────────
# Aktivasyon kodlari SET bazlidir (paketin imKeys.dll'i). Tek genel dosya yalniz 45449'un kodunu
# tasiyordu -> 45448/45469/45477/45478/45480 "aktivasyon-c KALDI" (gecerli diye girilen kod o setin
# degildi). Sira: a) <kod dizini>\<setKimligi>.txt  b) KURULU paketin imKeys.dll'i  c) genel dosya.
# Rapora yalniz kaynak adi yazilir; KOD DEGERI hicbir log/rapor/dosya adina girmez.
AKT_KAYNAK_KITAP = "kitap-dosyasi"
AKT_KAYNAK_PAKET = "paket-imkeys"
AKT_KAYNAK_GENEL = "genel-dosya"
IMKEYS_ADI = "imkeys.dll"                      # karsilastirma kucuk harfle (Windows buyuk/kucuk duyarsiz)
IMKEYS_KOD_DESENI = re.compile(r"^[A-Z0-9-]{3,64}$")   # src/agent/imkeys.js KOD_DESENI ile ayni
IMKEYS_ATLANAN = {"node_modules", "locales", "swiftshader", "pages", "pages2x", "thumbs"}

def akt_kod_dizini_varsayilan(genel_dosya: str) -> str:
    """SAF: kitap kod dizininin varsayilani = genel kod dosyasinin dizini + 'aktivasyon-kodlari'.
    Windows yolu (ters bolu) Mac testinde de dogru bolunsun diye ntpath secilir."""
    import ntpath
    yol = ntpath if "\\" in str(genel_dosya) else os.path
    return yol.join(yol.dirname(str(genel_dosya)), "aktivasyon-kodlari")

def set_kimligi(bookId: object) -> "str | None":
    """SAF: bookId etiketinden set kimligi ('45448-imzasiz-20261005032127' -> '45448'). Yoksa None."""
    m = re.match(r"^\s*([1-9]\d*)", str(bookId if bookId is not None else ""))
    return m.group(1) if m else None

def imkeys_kodlari_coz(veri: "bytes | None") -> "list[str]":
    """SAF: imKeys.dll baytlari -> kodlar. Bicim src/agent/imkeys.js imKeysBicimle/imKeysCoz'dan:
    her bayt (256 - b) mod 256, sonuc UTF-8 JSON dizisi, ogeler DUZ buyuk harfli kod. Okunamayan/
    bozuk/dizi olmayan -> [] (okuyucu da bos sayar). Gecersiz desenli oge atilir."""
    if not veri: return []
    try:
        d = json.loads(bytes((256 - b) & 0xFF for b in veri).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return []
    if not isinstance(d, list): return []
    kodlar: "list[str]" = []
    for e in d:
        if not isinstance(e, str): continue
        t = e.strip().upper()
        if IMKEYS_KOD_DESENI.match(t) and t not in kodlar: kodlar.append(t)
    return kodlar

def kurulu_imkeys_bul(dizin: str, derinlik: int = 6) -> "list[str]":
    """Kurulum dizininde imKeys.dll yollari (sirali). imkeys.js yazim yolu = menu koku + xmlSource'un
    'data/BookContent.xml' yerine 'imKeys.dll': NSIS'te resources\\app\\assets\\<id>\\, bookN setlerde
    resources\\app\\bookN\\assets\\<id>\\, sarmalayici klasorde bir kat daha derin. Derinlik sinirli
    gezinti (sayfa/thumb klasorleri atlanir); yol varsayilmaz, bulunur."""
    bulunan: "list[str]" = []
    if not dizin or not os.path.isdir(dizin): return bulunan
    kok_derin = os.path.abspath(dizin).rstrip("\\/").count(os.sep)
    for kok, alt, dosyalar in os.walk(dizin):
        if os.path.abspath(kok).count(os.sep) - kok_derin >= derinlik:
            alt[:] = []
        else:
            alt[:] = sorted(a for a in alt if a.lower() not in IMKEYS_ATLANAN)
        for f in dosyalar:
            if f.lower() == IMKEYS_ADI: bulunan.append(os.path.join(kok, f))
    return sorted(bulunan)

def paket_imkeys_kodu(dizin: str) -> "str | None":
    """Kurulu paketin imKeys.dll'lerinden cozulen ILK gecerli kod. Hangisinin secildigi YAZILMAZ."""
    for yol in kurulu_imkeys_bul(dizin):
        try:
            with open(yol, "rb") as f: kodlar = imkeys_kodlari_coz(f.read())
        except OSError:
            continue
        if kodlar: return kodlar[0]
    return None

def akt_kod_sec(bookId: object, kod_dizini: "str | None", kurulum_dizini: "str | None",
                genel_dosya: "str | None") -> "tuple[str | None, str | None]":
    """Kod kaynagi sirasi: kitap-dosyasi > paket-imkeys > genel-dosya. Donus (kod, kaynak);
    hicbiri yoksa (None, None). Kod DEGERI cagirana doner, hicbir yere yazilmaz."""
    sid = set_kimligi(bookId)
    if sid and kod_dizini:
        kod = aktivasyon_kod_oku(os.path.join(kod_dizini, sid + ".txt"))
        if kod: return kod, AKT_KAYNAK_KITAP
    if kurulum_dizini:
        kod = paket_imkeys_kodu(kurulum_dizini)
        if kod: return kod, AKT_KAYNAK_PAKET
    if genel_dosya:
        kod = aktivasyon_kod_oku(genel_dosya)
        if kod: return kod, AKT_KAYNAK_GENEL
    return None, None

def gd_kural_adi(anahtar):
    """SAF: guvenlik duvari kural adi — yalniz [A-Za-z0-9-] (netsh argumanina enjeksiyon yok)."""
    return "empp-kabul-akt-" + re.sub(r"[^A-Za-z0-9-]", "-", str(anahtar))[:60]

def gd_kural_komutlari(ad, exe):
    """SAF: (ekle, kaldir) netsh argv'leri — yalniz bu exe'nin CIKIS trafigini keser."""
    return (["netsh", "advfirewall", "firewall", "add", "rule", "name=" + ad, "dir=out", "action=block",
             "program=" + exe, "enable=yes", "profile=any"],
            ["netsh", "advfirewall", "firewall", "delete", "rule", "name=" + ad])

def akt_karar(adim, olcum, tek_kitap=False):
    """SAF KARAR: bir aktivasyon adiminin sonucu. olcum = JS_AKT ozeti (+ 'hataGoruldu').
    Icerik = okuyucu tuvali (kitapta) YA DA tek-motor raf kapaklari (45449: set duzeyinde diyalog
    acilista, menu yok; gecerli koddan sonra raf gorunur)."""
    o = olcum or {}
    icerik = bool(o.get("kitapta") or o.get("raf"))
    if adim == "a": return "GECTI" if (o.get("diyalog") and o.get("girdi")) else "KALDI"
    if adim == "b": return "GECTI" if (o.get("hataGoruldu") and o.get("diyalog")) else "KALDI"
    if adim == "c": return "GECTI" if (not o.get("diyalog") and not o.get("hata") and icerik) else "KALDI"
    if adim == "d" and tek_kitap: return "ATLANDI"
    if adim == "d": return "GECTI" if (not o.get("diyalog") and o.get("kitapta")) else "KALDI"
    if adim == "e": return "GECTI" if (not o.get("diyalog") and icerik) else "KALDI"
    return "KALDI"

def olcum_ozeti(o):
    """SAF: adimin teshis ozeti (rapora) — kod icermez; raf yalniz sayi."""
    o = o or {}
    r = {k: o.get(k) for k in ("diyalog", "hata", "kitapta", "online", "snack", "gorunur", "hataGoruldu", "girdiDolu")
         if o.get(k) is not None}
    r["raf"] = len(o.get("raf") or [])
    return r

def cevrimdisi_mi(olcum):
    """SAF KARAR: kod girmeden ONCE zorunlu — yalniz window.isOnline === False ise kod girilir.
    True ya da olculemedi (None) -> kod GIRILMEZ (gercek koltuk tuketilmesin)."""
    return (olcum or {}).get("online") is False

def aktivasyon_ozeti(adimlar):
    """SAF KARAR: a..e'den biri KALDI ya da eksikse KALDI (ATLANDI yalniz d/tek kitapta kabul)."""
    for a in AKT_ADIMLAR:
        s = (adimlar.get(a) or {}).get("sonuc")
        if s == "GECTI" or (a == "d" and s == "ATLANDI"): continue
        return "KALDI", f"aktivasyon-{a} {s or 'olculmedi'}"
    return "GECTI", None

def akt_yaprak_sec(onceki_adlar, simdiki):
    """SAF KARAR: seri/grup karti tiklaninca acilan ic gorunumde ilk YAPRAK kitabi secer.
    onceki_adlar = tiklamadan onceki menu adlari; simdiki = tiklamadan sonraki JS_MENU listesi.
    Grup acilmadiysa (liste ayni, bos ya da hepsi seri) None doner: ikinci tiklama yapilmaz."""
    ad = lambda k: str(k.get("ad") or "")
    if not simdiki or [ad(k) for k in simdiki] == list(onceki_adlar or []): return None
    for k in simdiki:
        if not k.get("seri"): return k
    return None

def akt_durum_bekle(c, tavan=60, sakin=15, raf_yeter=False, raf_sakin=3):
    """Diyalog gorunene ya da kitap diyalogsuz `sakin` sn acik kalana kadar yoklar.
    raf_yeter=True (c adimi, tek-motor): diyalogsuz raf `raf_sakin` sn kararli kalinca da doner
    (eskiden raf hic erken donus saymiyordu; 45 sn tavana kadar bekleyip son olcumu donuyordu)."""
    son = time.time() + tavan; kitap_ilk = None; raf_ilk = None; o = {}
    while time.time() < son:
        o = c.jsj(JS_AKT) or {}
        if o.get("diyalog"): return o
        if o.get("kitapta"):
            kitap_ilk = kitap_ilk or time.time()
            if time.time() - kitap_ilk >= sakin: return o
        if raf_yeter and o.get("raf"):
            raf_ilk = raf_ilk or time.time()
            if time.time() - raf_ilk >= raf_sakin: return o
        else:
            raf_ilk = None
        time.sleep(1)
    return o

def akt_kod_gir(c, girdi, kod):
    c.tikla(girdi["x"], girdi["y"]); time.sleep(0.5)
    c.tus("a", "KeyA", 65, modifiers=2); c.yaz(kod)
    c.tus("Enter", "Enter", 13, text="\r")

def akt_ekran(c, kimlik, adim, kayit):
    p = ana_surec_pencere_goster()
    if p is None or pencere_sorunlu_mu(p):
        kayit["pencere"] = p if p is not None else "olculemedi"
        if p is not None: time.sleep(1)
    try:
        ad = f"{kimlik}-akt-{adim}"; png = c.ekran(); gonder(ad, png); kayit["ekran"] = ad
    except Exception as e:
        kayit["ekranHata"] = str(e)[:80]

def uygulama_ac(ana, dizin, profil):
    """Uygulamayi TEMIZ profille (--user-data-dir + APPDATA), olu proxy ile (cevrimdisi) CDP portuyla acar."""
    env = akt_ortami(os.environ, profil)
    os.makedirs(profil, exist_ok=True)
    subprocess.Popen(akt_argv(ana, profil), env=env)
    return hedef_sec(dizin)

def akt_baglanti_bekle(c, tavan=20):
    """window.isOnline belirlenene kadar (okuyucunun probu 5 sn) yoklar."""
    son = time.time() + tavan; o = {}
    while time.time() < son:
        o = c.jsj(JS_AKT) or {}
        if o.get("online") is not None: return o
        time.sleep(1)
    return o

def aktivasyon_senaryosu(r, kimlik, ana, dizin, kod, profil):
    """a..e adimlari. Donen: (c, menuUrl, kitaplar) — normal kitap kaniti ayni oturumda surer."""
    A = {}; r["aktivasyon"] = {**(r.get("aktivasyon") or {}), "adimlar": A, "profil": os.path.basename(profil)}
    c, t, puan = uygulama_ac(ana, dizin, profil)
    if not c: A["a"] = {"sonuc": "KALDI", "sebep": "CDP_ACILMADI"}; return None, None, []
    c.cmd("Page.enable"); time.sleep(10)
    menuUrl = c.js("location.href"); menuUrl = menuUrl if isinstance(menuUrl, str) else None
    ilk = akt_baglanti_bekle(c)
    kitaplar, _ = baglanti_ayir(c.jsj(JS_MENU) or [], c.jsj(JS_BAGLANTILAR))
    r["aktivasyon"]["online"] = ilk.get("online")
    r["aktivasyon"]["anaSurecAg"] = ana_surec_ag_olc()
    log("AKTIVASYON", kimlik, "ana-surec", str(r["aktivasyon"]["anaSurecAg"]))
    r["aktivasyon"]["duzen"] = "menu" if kitaplar else "tek-motor"
    log("AKTIVASYON", kimlik, "baglanti", "online=" + str(ilk.get("online")), "kitap=" + str(len(kitaplar)))
    # TEMIZ PROFIL OLCULUR (varsayilmaz): userData/WORK profil disindaysa onceki kosunun aktivasyon
    # kaydi diyalogu gizler -> hicbir kod girilmez, sonuc OLCULEMEDI.
    pr = ana_surec_profil_olc()
    r["aktivasyon"]["profilYalitik"] = profil_yalitik_mi(pr, profil)
    r["aktivasyon"]["userData"] = (pr or {}).get("userData")
    log("AKTIVASYON", kimlik, "profil", "yalitik=" + str(r["aktivasyon"]["profilYalitik"]),
        str(r["aktivasyon"]["userData"]))
    if not r["aktivasyon"]["profilYalitik"]:
        r["aktivasyon"]["kodGirilmedi"] = "temiz profil saglanamadi (userData/work profil disinda ya da olculemedi)"
        return c, menuUrl, kitaplar

    def gir(kit, acilis=False):
        # acilis=True (a, e): diyalog acilista gorunduyse tiklamadan olc (set duzeyi)
        if (acilis and ilk.get("diyalog")) or not kit: return c.jsj(JS_AKT) or {}
        onceki = [str(k.get("ad") or "") for k in (c.jsj(JS_MENU) or [])]
        c.tikla(kit["x"], kit["y"])
        # SERI KARTI (45100/45472, 06.10): kart tiklaninca kitap degil "Tum Kitaplar" grup gorunumu
        # acilir; aktivasyon kitaba girince cikar -> ic listeden ilk YAPRAK kitap da tiklanir.
        time.sleep(2)
        o = c.jsj(JS_AKT) or {}
        if o.get("diyalog") or o.get("kitapta"): return akt_durum_bekle(c)
        ic = akt_yaprak_sec(onceki, c.jsj(JS_MENU) or [])
        if ic: c.tikla(ic["x"], ic["y"])
        return akt_durum_bekle(c)

    # a) kod istenir (set duzeyinde acilista da sorulabilir — o da GECTI, yer not edilir)
    o = gir(kitaplar[0] if kitaplar else None, acilis=True)
    A["a"] = {"sonuc": akt_karar("a", o), "yer": "acilis" if ilk.get("diyalog") else "kitap",
              "olcum": olcum_ozeti(o)}
    akt_ekran(c, kimlik, "a", A["a"])
    if A["a"]["sonuc"] != "GECTI": return c, menuUrl, kitaplar
    # KOD GIRMEDEN ONCE: cevrimdisi olmali. Degilse hicbir kod (gecersiz bile) GIRILMEZ.
    if not cevrimdisi_mi(dict(ilk, **{k: v for k, v in o.items() if k == "online" and v is not None})):
        r["aktivasyon"]["kodGirilmedi"] = "uygulama cevrimdisi degil (window.isOnline != false)"
        return c, menuUrl, kitaplar
    # b) gecersiz kod -> red mesaji. Latch (MutationObserver) kod girisinden ONCE kurulur: karar
    # snackbar'in 1,5 sn omrunden/yoklama hizindan bagimsiz. Giris ulasmadiysa (girdi bos) 1 kez tekrar.
    c.js(JS_AKT_LATCH_KUR)
    akt_kod_gir(c, o["girdi"], AKT_GECERSIZ_KOD)
    b = {}; latch = None; t0 = time.time(); son = t0 + 10; yeniden = False
    while time.time() < son:
        b = c.jsj(JS_AKT) or {}
        latch = c.jsj(JS_AKT_LATCH_OKU)
        if akt_b_hata_goruldu(b, latch):
            b["hataGoruldu"] = True; akt_ekran(c, kimlik, "b", A.setdefault("b", {})); break
        if b.get("snack"): A.setdefault("b", {})["mesaj"] = b["snack"]
        if not yeniden and akt_giris_yeniden_mi(b, latch, time.time() - t0):
            yeniden = True; ana_surec_pencere_goster()
            g2 = (c.jsj(JS_AKT) or {}).get("girdi") or o["girdi"]
            akt_kod_gir(c, g2, AKT_GECERSIZ_KOD)
        time.sleep(0.15)
    A.setdefault("b", {})["sonuc"] = akt_karar("b", dict(b, diyalog=(c.jsj(JS_AKT) or {}).get("diyalog")))
    if akt_latch_hata(latch): A["b"]["mesaj"] = akt_latch_hata(latch)
    if yeniden: A["b"]["girisYenidenDenendi"] = True
    A["b"]["olcum"] = olcum_ozeti(b)
    if "ekran" not in A["b"]: akt_ekran(c, kimlik, "b", A["b"])
    # c) gecerli kod (girdi maskeli; ekran diyalog kapandiktan SONRA alinir)
    g = (c.jsj(JS_AKT) or {}).get("girdi") or o["girdi"]
    akt_kod_gir(c, g, kod); kod = None
    time.sleep(3)
    o = akt_durum_bekle(c, tavan=45, raf_yeter=True)
    A["c"] = {"sonuc": akt_karar("c", o), "olcum": olcum_ozeti(o)}
    akt_ekran(c, kimlik, "c", A["c"])
    if A["c"]["sonuc"] != "GECTI": return c, menuUrl, kitaplar
    # d) menuye don, baska kitap -> kod istenmez
    raf = (c.jsj(JS_AKT) or {}).get("raf") or []
    if not kitaplar and len(raf) >= 1:
        o = gir(raf[1] if len(raf) >= 2 else raf[0]); A["d"] = {"sonuc": akt_karar("d", o), "kitap": "raf-kapak"}
    elif len(kitaplar) >= 2 and menuUrl and menuye_don(c, menuUrl):
        o = gir(kitaplar[1]); A["d"] = {"sonuc": akt_karar("d", o), "kitap": kitaplar[1].get("id")}
    else:
        A["d"] = {"sonuc": akt_karar("d", {}, tek_kitap=len(kitaplar) < 2) if len(kitaplar) < 2 else "KALDI",
                  "sebep": "tek kitap" if len(kitaplar) < 2 else "menuye donulemedi"}
    akt_ekran(c, kimlik, "d", A["d"])
    # e) kapat-ac -> kodsuz
    c.kapat(); oldur(dizin); time.sleep(3)
    c, t, puan = uygulama_ac(ana, dizin, profil)
    if not c: A["e"] = {"sonuc": "KALDI", "sebep": "yeniden acilista CDP_ACILMADI"}; return None, menuUrl, kitaplar
    c.cmd("Page.enable"); time.sleep(10)
    if not profil_yalitik_mi(ana_surec_profil_olc(), profil):
        A["e"] = {"sonuc": "KALDI", "sebep": "yeniden acilista temiz profil olculemedi"}
        akt_ekran(c, kimlik, "e", A["e"]); return c, menuUrl, kitaplar
    ilk = akt_baglanti_bekle(c)
    kitaplar = baglanti_ayir(c.jsj(JS_MENU) or [], c.jsj(JS_BAGLANTILAR))[0] or kitaplar
    o = gir(kitaplar[0] if kitaplar else None, acilis=True)
    A["e"] = {"sonuc": akt_karar("e", o), "olcum": olcum_ozeti(o)}
    akt_ekran(c, kimlik, "e", A["e"])
    return c, menuUrl, kitaplar

def menuye_don(c, menuUrl):
    c.js("location.href=" + json.dumps(menuUrl))
    for _ in range(25):
        time.sleep(2)
        if c.jsj(JS_MENU): return True
    return False

# ─────────────────────────── ana akis ───────────────────────────
def normal_argv(ana, bookId, env, simdi=None):
    """SAF: normal kabulde uygulama argv'si. Varsayilan TAZE PROFIL (--user-data-dir): kasada gercek
    Roaming profili onceki kosularin okuyucu durumunu (son sayfa, serit acik/kapali, aktivasyon)
    tasiyor — 73768 (03.10) book1/book3 serit kapali + 2/N'de acildi, book2 seridi acik geldi;
    kabul yeni bir kullanicinin ilk acilisini olcmeli. EMPP_KABUL_TAZE_PROFIL=0 eski davranis."""
    argv = [ana, f"--remote-debugging-port={PORT}", "--remote-allow-origins=*"]
    if str(env.get("EMPP_KABUL_TAZE_PROFIL", "1")).strip() != "0":
        damga = simdi or time.strftime("%Y%m%d%H%M%S")
        guvenli = re.sub(r"[^A-Za-z0-9-]", "-", str(bookId))[:60]
        argv.append("--user-data-dir=" + os.path.join(KOK, f"kabul-profil-{guvenli}-{damga}"))
    return argv

# --- OTURUM BEKCISI (kabulden once) -------------------------------------------------------
# Kopuk (Disc) RDP oturumunda Chromium/Electron cizmez: Page.captureScreenshot hata verir, tuval
# bos kalir -> paket saglam oldugu halde "ACILMADI" diye YANLIS RED (04.10: 13 YDS exe'si).
# RDP'de AKTIF oturum (rdp-tcp#N) da yetmez: RDP penceresi kucultulunce/baglanti duraklayinca
# cizim durur. Bu yuzden oturum her durumda fiziksel konsola (tscon /dest:console) baglanir.
# RDP baglantisi dusar — kabul edilebilir: kasa sunucu gibi calisir, kimse RDP'de beklenmez.
def oturum_durumu_coz(query_user_metni, kullanici):
    """`query user` ciktisindan kullanicinin oturumunu cozer. SAF.
    Sutunlar: USERNAME SESSIONNAME ID STATE IDLE TIME LOGON TIME. SESSIONNAME kopukta bos olur;
    aktif satir '>' ile baslayabilir; basliklar/durum Turkce olabilir -> ID sayisal sutundan,
    durum ID'den sonrasindan okunur. Donus: {id, oturum, durum: aktif|kopuk|bilinmiyor, konsol}."""
    hedef = (kullanici or "").strip().casefold()
    for satir in (query_user_metni or "").splitlines():
        t = satir.lstrip(" >").split()
        if len(t) < 3 or t[0].casefold() != hedef: continue
        if t[1].isdigit(): oturum, i = None, 1
        elif len(t) > 3 and t[2].isdigit(): oturum, i = t[1], 2
        else: continue                                  # baslik satiri vb.
        sid = int(t[i]); metin = " ".join(t[i + 1:]).casefold()
        if metin.startswith(("disc", "down", "bağlantı", "baglanti")): durum = "kopuk"
        elif metin.startswith(("active", "etkin", "aktif")): durum = "aktif"
        else: durum = "bilinmiyor"
        return {"id": sid, "oturum": oturum, "durum": durum,
                "konsol": (oturum or "").casefold() == "console"}
    return None

def konsol_gorev_komutu(oturum_id):
    """SYSTEM yetkili 'empp-konsola-bagla' gorevini kurup baslatan komut dizisi. SAF.
    oturum_id yalniz int (bool haric) — enjeksiyon reddedilir."""
    if not isinstance(oturum_id, int) or isinstance(oturum_id, bool) or oturum_id < 0:
        raise ValueError("oturum_id sayi olmali")
    ps = ("$a=New-ScheduledTaskAction -Execute 'C:\\Windows\\System32\\tscon.exe' "
          "-Argument '%d /dest:console'; "
          "$p=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest; "
          "Register-ScheduledTask -TaskName 'empp-konsola-bagla' -Action $a -Principal $p -Force | Out-Null; "
          "Start-ScheduledTask -TaskName 'empp-konsola-bagla'" % oturum_id)
    return ["powershell", "-NoProfile", "-Command", ps]

def oturum_olc(kullanici=None, calistir=None):
    calistir = calistir or (lambda a: subprocess.run(a, capture_output=True, text=True).stdout)
    kullanici = kullanici or os.environ.get("USERNAME", "")
    try: return oturum_durumu_coz(calistir(["query", "user"]), kullanici)
    except Exception: return None

def konsola_bagla(oturum_id, calistir=None, bekle=6):
    """Gorevi kurar+baslatir, bekler; yeniden olcumu cagiran yapar."""
    calistir = calistir or (lambda a: subprocess.run(a, capture_output=True, text=True))
    try: calistir(konsol_gorev_komutu(oturum_id))
    except Exception: return False
    time.sleep(bekle)
    return True

def oturum_bekcisi(r, kullanici=None, olc=None, bagla=None):
    """True: kabul surebilir. False: masaustu aktif degil -> r OLCULEMEDI olarak doldurulur.
    Windows disinda (olc enjekte edilmedikce) atlanir."""
    if olc is None and os.name != "nt": return True
    olc = olc or (lambda: oturum_olc(kullanici)); bagla = bagla or konsola_bagla
    once = olc()
    if once is None:                                    # oturum bulunamadi: olcum yapilamaz, engelleme
        r["oturum"] = {"once": None, "sonra": None, "baglandi": False}; return True
    ok = once["durum"] == "aktif" and once["konsol"]
    sonra, baglandi = once, False
    if not ok:
        baglandi = bool(bagla(once["id"]))
        sonra = olc() or once
        ok = sonra["durum"] == "aktif" and sonra["konsol"]
    r["oturum"] = {"once": once, "sonra": sonra, "baglandi": baglandi}
    log("OTURUM", r.get("bookId"), json.dumps(r["oturum"]))
    if ok: return True
    r["sonuc"] = "OLCULEMEDI"
    r["sebep"] = "masaustu oturumu aktif degil (%s)" % sonra["durum"]
    return False

def main():
    bookId, url, baslik = sys.argv[1], sys.argv[2], sys.argv[3]
    r = {"bookId": bookId, "baslik": baslik, "basladi": time.strftime("%Y-%m-%dT%H:%M:%S")}
    exe = os.path.join(KOK, bookId + ".exe")

    if not oturum_bekcisi(r): return bitir(r)

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
    if os.environ.get("EMPP_KABUL_AKTIVASYON") == "1":
        return aktivasyonlu_kabul(r, bookId, baslik, dizin, ana)
    subprocess.Popen(normal_argv(ana, bookId, os.environ))
    c, t, puan = hedef_sec(dizin)
    if not c:
        r["sonuc"] = "KALDI"; r["sebep"] = "CDP_ACILMADI"
        oldur(dizin); r["kaldirma"] = kaldir(dizin); return bitir(r)
    r["hedefPuan"] = puan
    c.cmd("Page.enable")
    time.sleep(10)
    menuUrl = c.js("location.href")
    r["menuUrl"] = menuUrl if isinstance(menuUrl, str) else None
    return kitaplari_olc(r, c, bookId, baslik, dizin, menuUrl, c.jsj(JS_MENU) or [])

def kitaplari_olc(r, c, bookId, baslik, dizin, menuUrl, kitaplar):
    kitaplar, baglantilar = baglanti_ayir(kitaplar, c.jsj(JS_BAGLANTILAR))
    if baglantilar:
        r["menuBaglantilar"] = baglantilar
        for b in baglantilar: log("BAGLANTI", bookId, str(b.get("ad")).split("\n")[0], b.get("url"))
        
    def cagirici(islem, arg):
        if islem == "kutu_guncelle":
            try:
                yeni = c.jsj(js_kutu_guncelle(arg.get("varyant"), arg.get("ad"), arg.get("indis", 0)))
                if yeni: arg.update(yeni)
            except: pass
        elif islem == "tikla":
            c.tikla(arg["x"], arg["y"])
        elif islem == "bekle":
            time.sleep(arg)
        elif islem == "menu_al":
            return c.jsj(JS_MENU)
        elif islem == "ana_menu":
            menuye_don(c, menuUrl)

    kitaplar = kitaplari_genislet(kitaplar, cagirici)

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
            if kit.get("seri_ana"):
                ana = kit["seri_ana"]
                cagirici("kutu_guncelle", ana)
                cagirici("tikla", ana)
                cagirici("bekle", 2)
                
            cagirici("kutu_guncelle", kit)
            cagirici("tikla", kit)
            
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

def aktivasyonlu_kabul(r, bookId, baslik, dizin, ana):
    """Aktivasyon kipi: internetsiz + temiz profil; a..e, sonra ayni oturumda normal kitap kaniti."""
    genel = os.environ.get("EMPP_KABUL_AKTIVASYON_KOD_DOSYASI") or AKT_KOD_DOSYASI
    kod_dizini = os.environ.get("KABUL_AKT_KOD_DIZINI") or akt_kod_dizini_varsayilan(genel)
    kod, kaynak = akt_kod_sec(bookId, kod_dizini, dizin, genel)
    if not kod:
        r["sonuc"] = "OLCULEMEDI"; r["sebep"] = "aktivasyon test kodu dosyasi yok/bos"
        r["kaldirma"] = kaldir(dizin); return bitir(r)
    r["aktivasyon"] = {"kodKaynagi": kaynak}            # yalniz kaynak adi; DEGER ASLA
    log("AKTIVASYON", bookId, "kod-kaynagi", kaynak)
    kural = gd_kural_adi(bookId)
    ekle, kaldir_k = gd_kural_komutlari(kural, ana)
    subprocess.run(kaldir_k, capture_output=True)                 # onceki yarim kosudan kalmissa
    gd = subprocess.run(ekle, capture_output=True)
    r["internetsiz"] = {"kural": kural, "eklendi": gd.returncode == 0}
    c = None
    try:
        # Kural ek emniyettir (SEP'li kasada uygulanmiyor); asil cevrimdisi yontem AKT_PROXY_ARGV
        # ve kod girmeden once window.isOnline === false olcumu (cevrimdisi_mi).
        r["internetsiz"]["yontem"] = "olu-proxy + gd-kurali; kod oncesi isOnline=false sarti"
        profil = os.path.join(KOK, f"akt-profil-{bookId}-{time.strftime('%Y%m%d%H%M%S')}")
        c, menuUrl, kitaplar = aktivasyon_senaryosu(r, bookId, ana, dizin, kod, profil)
        kod = None
        A = r["aktivasyon"]["adimlar"]
        for a in AKT_ADIMLAR:
            log("AKTIVASYON", bookId, a, (A.get(a) or {}).get("sonuc", "OLCULMEDI"))
        sonuc, sebep = aktivasyon_ozeti(A)
        r["aktivasyon"]["sonuc"] = sonuc
        if r["aktivasyon"].get("kodGirilmedi"):
            # cevrimdisi saglanamadi: paket kusuru DEGIL, olcum olmadi -> ertelenir
            r["aktivasyon"]["sonuc"] = "OLCULEMEDI"
            r["sonuc"] = "OLCULEMEDI"; r["sebep"] = r["aktivasyon"]["kodGirilmedi"]
            if c: c.kapat()
            oldur(dizin); r["kaldirma"] = kaldir(dizin); return None
        if sonuc != "GECTI" or not c:
            r["sonuc"] = "KALDI"; r["sebep"] = sebep or "aktivasyon oturumu acilamadi"
            if c: c.kapat()
            oldur(dizin); r["kaldirma"] = kaldir(dizin); return None
        if not (c.jsj(JS_MENU) or kitaplar):   # tek-motor: raf kanitini kitap kaniti yerine yaz
            r["kitaplar"] = [{"sira": 1, "id": "raf", "ad": baslik, "sonuc": "GECTI", "kaynak": "tek-motor-raf",
                              "not": "aktivasyon a..e raf+okuyucu ile olculdu"}]
            r["gecenKitap"] = 1; r["toplamKitap"] = 1; r["sonuc"] = "GECTI"
            c.kapat(); oldur(dizin); r["kaldirma"] = kaldir(dizin); return None
        if menuUrl: menuye_don(c, menuUrl)
        r["_kitapOlc"] = (c, menuUrl, c.jsj(JS_MENU) or kitaplar)
        return None
    finally:
        k = subprocess.run(kaldir_k, capture_output=True)
        r.setdefault("internetsiz", {})["kaldirildi"] = k.returncode == 0
        if "_kitapOlc" in r:
            c2, mu, kt = r.pop("_kitapOlc")
            kitaplari_olc(r, c2, bookId, baslik, dizin, mu, kt)
        else:
            bitir(r)

def bitir(r):
    r["bitti"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    gonder("rapor-" + r["bookId"], json.dumps(r, ensure_ascii=False).encode("utf-8"))
    log("RAPOR", r["bookId"], r.get("sonuc"), r.get("gecenKitap"), r.get("toplamKitap"))
    print("JSON>>>" + json.dumps(r, ensure_ascii=True), flush=True)

if __name__ == "__main__":
    main()
