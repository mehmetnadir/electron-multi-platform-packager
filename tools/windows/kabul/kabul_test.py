#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""kabul.py'nin SAF karar fonksiyonlari icin testler (stdlib unittest, agy'siz kosar).
Windows/CDP/websocket/dosya-sistemi bagimliligi olan fonksiyonlara DOKUNULMAZ — yalniz
kabul.py'deki 6 saf karar test edilir (senkron: 2026-09-22, EN YENI 02:42 kapiyla):
  1. aile_imzadan()     — imza tespiti (Nullsoft/WinRAR/SFX/bilinmiyor)
  2. ilk_sayfada_mi()    — sayfa gostergesi ("12/172") ILK SAYFAYI mi gosteriyor
  3. kanit_sonucu()      — kanit esigi (GECTI/KALDI) + tek sayfa muafiyeti
  4. menu_varyant_sec()  — JS_MENU'nun A/B/C oncelik sirasinin Python aynasi (JS bir
                            tarayicida calisir, unittest'te calistirilamaz; bu fonksiyon
                            JS_MENU'nun docstring'te belgelenen kuralini ayrica kilitler)
  5. serit_etiket_mi()   — JS_SERIT'teki etiket regex'inin Python aynasi (Sayfalar/Pages/
                            Onizleme/Preview/Kucuk resim/Thumbnails eslesir, Atla/Skip/X eslesMEZ)
  6. kaldirma_yontemi()  — Uninstall*.exe var/yok -> kaldirici/tasi (ASLA 'rm')

Kosum: /usr/bin/python3 tools/windows/kabul/kabul_test.py -v
"""
import os, sys, unittest

# kabul.py import edilirken modul seviyesinde PROGRAMS = os.environ["LOCALAPPDATA"]
# okunur (Windows'a ozel degisken). Mac'te test icin sahte deger yeterli — hicbir
# testte KULLANILMIYOR, sadece import patlamasin.
os.environ.setdefault("LOCALAPPDATA", "C:\\Users\\test\\AppData\\Local")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kabul


class AileTespitiTest(unittest.TestCase):
    """aile() dosya okur; aile_imzadan() ayni karari saf baytlardan verir."""

    def test_nullsoft_nsis(self):
        self.assertEqual(kabul.aile_imzadan(b"...bir yerde Nullsoft Install System var..."), "nsis")

    def test_winrar_sfx(self):
        self.assertEqual(kabul.aile_imzadan(b"...WinRAR SFX modulu..."), "sfx")

    def test_yalniz_sfx_kelimesi_de_sfx_sayar(self):
        self.assertEqual(kabul.aile_imzadan(b"...icinde SFX imzasi..."), "sfx")

    def test_ikisi_de_yoksa_bilinmiyor(self):
        self.assertEqual(kabul.aile_imzadan(b"tamamen rastgele veri, imza yok"), "bilinmiyor")

    def test_bos_bayt_bilinmiyor(self):
        self.assertEqual(kabul.aile_imzadan(b""), "bilinmiyor")

    def test_nullsoft_sfx_kelimesinden_once_kontrol_edilir(self):
        # Ikisi de gecse Nullsoft (nsis) once test edilir — gercek dosyalarda bu
        # ayrim yasanmiyor ama oncelik sirasi acik sekilde nsis>sfx.
        self.assertEqual(kabul.aile_imzadan(b"Nullsoft ... WinRAR SFX"), "nsis")

    def test_sfx_paket_ailesi_argumansiz_calisir_nsis_ile_karistirilmamali(self):
        # SFX'e '/S' vermek 1 sn'de cikis 0 dondurur ve HICBIR SEY kurmaz (kur()'daki
        # sahte "KURULMADI" tuzagi) — aile tespiti WinRAR/SFX'i nsis'ten AYIRABILMELI,
        # yoksa kur() yanlis komut satirini (['/S']) SFX'e verir.
        self.assertEqual(kabul.aile_imzadan(b"...WinRAR Self-Extracting Archive (SFX)..."), "sfx")
        self.assertNotEqual(kabul.aile_imzadan(b"...WinRAR Self-Extracting Archive (SFX)..."), "nsis")


class IlkSayfadaTest(unittest.TestCase):
    """Sayfa gostergesi ("12/172" gibi) '1/' veya '1 /' ile basliyor mu?
    Kitap 1. sayfada ACILMAZ (olculdu: 12/172 ile aciliyor) — seritten 1'e gidilir."""

    def test_oniki_bolu_172_ilk_sayfa_degil(self):
        self.assertFalse(kabul.ilk_sayfada_mi("12/172"))

    def test_bir_bolu_196_ilk_sayfa(self):
        self.assertTrue(kabul.ilk_sayfada_mi("1/196"))

    def test_bosluklu_bir_bolu_80_ilk_sayfa(self):
        self.assertTrue(kabul.ilk_sayfada_mi("1 / 80"))

    def test_none_ilk_sayfa_degil(self):
        self.assertFalse(kabul.ilk_sayfada_mi(None))

    def test_bos_metin_ilk_sayfa_degil(self):
        self.assertFalse(kabul.ilk_sayfada_mi(""))

    def test_onbir_bolu_x_ilk_sayfa_degil_onekle_karisan_ondalikli_deger(self):
        # "1" ile baslayip '/' hemen gelmeyen deger (10, 11, 100... /N) ilk sayfa SAYILMAZ —
        # startswith('1/') tam sayi biriminden sonra '/' bekler.
        self.assertFalse(kabul.ilk_sayfada_mi("11/196"))


class KanitEsigiTest(unittest.TestCase):
    """canvasDolu>50 VE canvasRenk>1 VE (toplamSayfa==1 VEYA thumbOK>=3) VE ilkSayfada
    -> GECTI; biri eksikse KALDI. toplamSayfa==1 VE GECTI -> muafiyet ACIK isaretlenir."""

    def test_gecti_esik_tam(self):
        sonuc, ilk, thumb, tek, muafiyet = kabul.kanit_sonucu(
            thumbOK=3, canvasDolu=51, canvasRenk=2, toplamSayfa=196, ilkSayfada=True)
        self.assertEqual(sonuc, "GECTI")
        self.assertTrue(ilk); self.assertTrue(thumb); self.assertFalse(tek)
        self.assertIsNone(muafiyet)

    def test_gecti_esigin_cok_ustunde(self):
        sonuc, *_ = kabul.kanit_sonucu(
            thumbOK=8, canvasDolu=2143, canvasRenk=40, toplamSayfa=40, ilkSayfada=True)
        self.assertEqual(sonuc, "GECTI")

    def test_kaldi_thumb_yetersiz_ve_cok_sayfali(self):
        sonuc, ilk, thumb, tek, muafiyet = kabul.kanit_sonucu(
            thumbOK=2, canvasDolu=100, canvasRenk=5, toplamSayfa=80, ilkSayfada=True)
        self.assertEqual(sonuc, "KALDI")
        self.assertTrue(ilk); self.assertFalse(thumb); self.assertFalse(tek)
        self.assertIsNone(muafiyet)

    def test_kaldi_tuval_esit_yeterli_degil(self):
        # canvasDolu>50 SIKI karsilastirma — tam 50 GECMEZ
        sonuc, ilk, *_ = kabul.kanit_sonucu(
            thumbOK=5, canvasDolu=50, canvasRenk=5, toplamSayfa=5, ilkSayfada=True)
        self.assertEqual(sonuc, "KALDI")
        self.assertFalse(ilk)

    def test_kaldi_renk_tek_ise_duz_dolgu_sayilir(self):
        # canvasRenk>1 SIKI karsilastirma — tek renk (dolu ama duz alan) GECMEZ
        sonuc, ilk, *_ = kabul.kanit_sonucu(
            thumbOK=5, canvasDolu=100, canvasRenk=1, toplamSayfa=5, ilkSayfada=True)
        self.assertEqual(sonuc, "KALDI")
        self.assertFalse(ilk)

    def test_kaldi_ilk_sayfada_degilse_thumb_ve_tuval_tam_olsa_da(self):
        # ilkSayfada=False -> kitap 1. sayfaya hic gidilememis, digerleri tam olsa da KALDI.
        sonuc, *_ = kabul.kanit_sonucu(
            thumbOK=8, canvasDolu=2143, canvasRenk=40, toplamSayfa=40, ilkSayfada=False)
        self.assertEqual(sonuc, "KALDI")

    def test_none_degerler_0_sayilir_kaldi(self):
        sonuc, ilk, thumb, tek, muafiyet = kabul.kanit_sonucu(
            thumbOK=None, canvasDolu=None, canvasRenk=None, toplamSayfa=None, ilkSayfada=False)
        self.assertEqual(sonuc, "KALDI")
        self.assertFalse(ilk); self.assertFalse(thumb); self.assertFalse(tek)
        self.assertIsNone(muafiyet)

    def test_tek_sayfa_muafiyeti_thumb_sifir_olsa_da_gecti(self):
        # 45538/book5 kaniti: sayfa="1/1", canvas dolu ve renkli, thumbAday=0 — 1 sayfalik
        # kitapcik/afiste serit hic olusmaz, thumb sarti KOR sekilde uygulanirsa sahte KALDI.
        sonuc, ilk, thumb, tek, muafiyet = kabul.kanit_sonucu(
            thumbOK=0, canvasDolu=100, canvasRenk=5, toplamSayfa=1, ilkSayfada=True)
        self.assertEqual(sonuc, "GECTI")
        self.assertTrue(tek)
        self.assertEqual(muafiyet, "TEK_SAYFA_THUMB_MUAF")

    def test_tek_sayfa_muafiyeti_sizmaz_iki_sayfalik_kitapta_thumb_sifirsa_kaldi(self):
        # toplamSayfa=2 (tek sayfa DEGIL) + thumbOK=0 -> muafiyet UYGULANMAZ, KALDI kalir.
        # Bu, muafiyetin baska paketlere SIZMADIGININ kaniti.
        sonuc, ilk, thumb, tek, muafiyet = kabul.kanit_sonucu(
            thumbOK=0, canvasDolu=100, canvasRenk=5, toplamSayfa=2, ilkSayfada=True)
        self.assertEqual(sonuc, "KALDI")
        self.assertFalse(tek)
        self.assertIsNone(muafiyet)

    def test_tek_sayfa_ama_ilk_sayfa_bos_ise_muafiyet_kurtarmaz(self):
        # toplamSayfa=1 fakat canvas bos (ilkSayfaVar=False) -> muafiyet thumb sartini
        # kaldirir ama ILK SAYFA CIZILI OLMA sartini kaldirmaz.
        sonuc, ilk, thumb, tek, muafiyet = kabul.kanit_sonucu(
            thumbOK=0, canvasDolu=0, canvasRenk=0, toplamSayfa=1, ilkSayfada=True)
        self.assertEqual(sonuc, "KALDI")
        self.assertTrue(tek)
        self.assertIsNone(muafiyet)


class SeritEtiketiTest(unittest.TestCase):
    """JS_SERIT'teki etiket regex'inin Python aynasi. Etiket TEMAYA GORE DEGISIR
    (kanit: 74405); 'Atla'/'Skip'/'X' regex'e SIZMAMALI (saha kazasi: desen 'x'
    icerdigi icin kapi sayfa panelinin kapatma dugmesine tiklayip kendi kanitini
    kapatmisti, thumbOK 7->0)."""

    def test_sayfalar_eslesir(self):
        self.assertTrue(kabul.serit_etiket_mi("Sayfalar"))

    def test_pages_eslesir(self):
        self.assertTrue(kabul.serit_etiket_mi("Pages"))

    def test_onizleme_eslesir(self):
        self.assertTrue(kabul.serit_etiket_mi("Önizleme"))

    def test_onizleme_ascii_varyanti_da_eslesir(self):
        self.assertTrue(kabul.serit_etiket_mi("Onizleme"))

    def test_preview_eslesir(self):
        self.assertTrue(kabul.serit_etiket_mi("Preview"))

    def test_kucuk_resim_eslesir(self):
        self.assertTrue(kabul.serit_etiket_mi("Küçük resim"))

    def test_kucuk_resim_ascii_varyanti_da_eslesir(self):
        self.assertTrue(kabul.serit_etiket_mi("kucuk resim"))

    def test_thumbnails_eslesir(self):
        self.assertTrue(kabul.serit_etiket_mi("Thumbnails"))

    def test_bastan_bosluklu_etiket_de_eslesir(self):
        self.assertTrue(kabul.serit_etiket_mi("  Sayfalar  "))

    def test_atla_eslesmemeli(self):
        self.assertFalse(kabul.serit_etiket_mi("Atla"))

    def test_skip_eslesmemeli(self):
        self.assertFalse(kabul.serit_etiket_mi("Skip"))

    def test_x_eslesmemeli(self):
        # Saha kazasi: sayfa panelinin kapatma dugmesi 'X' — desene 'x' EKLEME.
        self.assertFalse(kabul.serit_etiket_mi("X"))

    def test_bos_metin_eslesmemeli(self):
        self.assertFalse(kabul.serit_etiket_mi(""))

    def test_none_eslesmemeli(self):
        self.assertFalse(kabul.serit_etiket_mi(None))


class MenuVaryantTest(unittest.TestCase):
    """JS_MENU oncelik sirasi: A varsa A, yoksa B, yoksa C, hicbiri yoksa None (tek-kitap)."""

    def test_a_varsa_a_oncelikli(self):
        self.assertEqual(kabul.menu_varyant_sec(True, True, True), "A")

    def test_a_yoksa_b_secilir(self):
        self.assertEqual(kabul.menu_varyant_sec(False, True, True), "B")

    def test_a_ve_b_yoksa_c_secilir(self):
        self.assertEqual(kabul.menu_varyant_sec(False, False, True), "C")

    def test_hicbiri_yoksa_none_tek_kitap(self):
        self.assertIsNone(kabul.menu_varyant_sec(False, False, False))


class KaldirmaYontemiTest(unittest.TestCase):
    """Uninstall*.exe varsa kaldirici yolu, yoksa TASI — asla 'rm' degeri uretilmez."""

    def test_uninstall_var_kaldirici(self):
        self.assertEqual(kabul.kaldirma_yontemi(True), "kaldirici")

    def test_uninstall_yok_tasi(self):
        self.assertEqual(kabul.kaldirma_yontemi(False), "tasi")

    def test_donen_deger_asla_rm_olamaz(self):
        for v in (True, False):
            self.assertIn(kabul.kaldirma_yontemi(v), ("kaldirici", "tasi"))
            self.assertNotEqual(kabul.kaldirma_yontemi(v), "rm")


class YerelKipTest(unittest.TestCase):
    """EMPP_KABUL_YEREL_DIZIN: runner kasa'nin kendisinde — ekran/rapor dizine yazilir, POST yok."""

    def setUp(self):
        import tempfile
        self.dizin = tempfile.mkdtemp(prefix="kabul-yerel-")
        self.eski = os.environ.get("EMPP_KABUL_YEREL_DIZIN")
        os.environ["EMPP_KABUL_YEREL_DIZIN"] = self.dizin

    def tearDown(self):
        if self.eski is None:
            os.environ.pop("EMPP_KABUL_YEREL_DIZIN", None)
        else:
            os.environ["EMPP_KABUL_YEREL_DIZIN"] = self.eski

    def test_ekran_png_rapor_json(self):
        self.assertEqual(kabul.yerel_ad("45538-k01"), "45538-k01.png")
        self.assertEqual(kabul.yerel_ad("rapor-45538-a"), "rapor-45538-a.json")

    def test_gonder_dosyaya_yazar_ag_yok(self):
        import urllib.request
        eski_ac = urllib.request.urlopen
        urllib.request.urlopen = lambda *a, **k: (_ for _ in ()).throw(AssertionError("ag cagrildi"))
        try:
            self.assertTrue(kabul.gonder("rapor-x", b'{"sonuc":"GECTI"}'))
            self.assertTrue(kabul.gonder("x-menu", b"\x89PNG"))
        finally:
            urllib.request.urlopen = eski_ac
        with open(os.path.join(self.dizin, "rapor-x.json"), "rb") as f:
            self.assertEqual(f.read(), b'{"sonuc":"GECTI"}')
        self.assertTrue(os.path.exists(os.path.join(self.dizin, "x-menu.png")))


class IlkSayfayaGitTest(unittest.TestCase):
    """73768 kaniti (03.10, windows-kasa): serit 8-12'ye kaydirilmisti; en soldaki thumb'a 3 kez
    tiklandi ve gosterge 8/136'da kaldi (book3), book1 12/172. 1. sayfaya seritten BAGIMSIZ gidilir."""

    def setUp(self):
        self._uyku = kabul.time.sleep
        kabul.time.sleep = lambda *_: None

    def tearDown(self):
        kabul.time.sleep = self._uyku

    class SahteOkuyucu:
        """Kaydirilmis serit: gorunen thumb'lar [ilk..ilk+4]; kutu: (900,955), geri: (880,955)."""
        def __init__(self, sayfa, toplam=136, serit_ilk=None, kutu_calisir=True, etiket=True):
            self.sayfa, self.toplam, self.kutu_calisir, self.etiket = sayfa, toplam, kutu_calisir, etiket
            self.serit_ilk = serit_ilk or sayfa
            self.odak = False; self.yazilan = ""; self.tiklar = []
        def thumblar(self):
            return [{"n": self.serit_ilk + i, "x": 300 + 330 * i, "y": 720} for i in range(5)]
        def olc(self):
            t = self.thumblar()
            k = {"sayfa": f"{self.sayfa}/{self.toplam}", "toplamSayfa": self.toplam, "thumbOK": 5,
                 "canvasDolu": 3274, "canvasRenk": 170, "thumbIlk": {"x": t[0]["x"], "y": t[0]["y"]}}
            if self.etiket: k["thumbEtiket"] = t
            return k
        # CDP yuzeyi
        def tikla(self, x, y):
            self.tiklar.append((x, y))
            for t in self.thumblar():
                if (x, y) == (t["x"], t["y"]): self.sayfa = t["n"]; return
            if (x, y) == (900, 955): self.odak = True; return
            if (x, y) == (880, 955) and self.sayfa > 1: self.sayfa -= 1
        def tus(self, key, code, vk, modifiers=0, text=None):
            if key == "a" and modifiers == 2: self.yazilan = ""
            if key == "Enter" and self.odak and self.kutu_calisir and self.yazilan.isdigit():
                self.sayfa = int(self.yazilan); self.serit_ilk = self.sayfa
        def yaz(self, m): self.yazilan += m
        def jsj(self, js):
            if js is kabul.JS_SAYFA_KUTUSU:
                return {"x": 900, "y": 955, "input": True, "geri": {"x": 880, "y": 955}}
            return None

    def test_plan_etiket_1_gorunuyorsa_dogrudan_ona(self):
        k = self.SahteOkuyucu(sayfa=3, serit_ilk=1).olc()
        self.assertEqual(kabul.ilk_sayfa_plani(k), ["etiket1"])

    def test_plan_kaydirilmis_seritte_en_soldakine_tiklamaz(self):
        k = self.SahteOkuyucu(sayfa=8).olc()
        self.assertEqual(kabul.ilk_sayfa_plani(k), ["kutu", "geri"])

    def test_plan_etiket_okunamazsa_eski_yol_once(self):
        k = self.SahteOkuyucu(sayfa=8, etiket=False).olc()
        self.assertEqual(kabul.ilk_sayfa_plani(k), ["thumbIlk", "kutu", "geri"])

    def test_book3_kaniti_kutu_ile_1_136(self):
        o = self.SahteOkuyucu(sayfa=8)
        k = kabul.ilk_sayfaya_git(o, o.olc(), o.olc)
        self.assertEqual(k["sayfa"], "1/136")
        self.assertEqual(k["ilkSayfaYolu"], "kutu")
        self.assertNotIn((300, 720), o.tiklar, "en soldaki (8) thumb'a korlemesine tiklanmadi")

    def test_kutu_tutmazsa_geri_dugmesi(self):
        o = self.SahteOkuyucu(sayfa=12, toplam=172, kutu_calisir=False)
        k = kabul.ilk_sayfaya_git(o, o.olc(), o.olc)
        self.assertEqual(k["sayfa"], "1/172")
        self.assertEqual(k["ilkSayfaYolu"], "geri")

    def test_eski_davranis_regresyonu_en_soldaki_thumb_8de_kalir(self):
        # Eski kod: en soldakine 3 kez tikla. Kaydirilmis seritte 8/136'da kalir — kanitin aynisi.
        o = self.SahteOkuyucu(sayfa=8)
        for _ in range(3):
            t = o.olc()["thumbIlk"]; o.tikla(t["x"], t["y"])
        self.assertEqual(o.olc()["sayfa"], "8/136")

    def test_acilista_1_sayfada_ama_tuval_seffafsa_yine_tiklanir(self):
        o = self.SahteOkuyucu(sayfa=1, serit_ilk=1)
        bos = dict(o.olc(), canvasDolu=0, canvasRenk=0)
        self.assertFalse(kabul.ilk_sayfa_tamam(bos))
        k = kabul.ilk_sayfaya_git(o, bos, o.olc)
        self.assertEqual(k["ilkSayfaYolu"], "etiket1")
        self.assertTrue(kabul.ilk_sayfa_tamam(k))

    def test_geri_tiklama_sayisi(self):
        self.assertEqual(kabul.geri_tiklama_sayisi("8/136"), 7)
        self.assertEqual(kabul.geri_tiklama_sayisi("1/136"), 0)
        self.assertEqual(kabul.geri_tiklama_sayisi("120/172"), 40)
        self.assertEqual(kabul.geri_tiklama_sayisi(None), 0)


class AktivasyonTest(unittest.TestCase):
    """Aktivasyon senaryosu (Nadir 03.10): internetsiz + temiz profil, a..e, kod HICBIR ciktiya yazilmaz."""
    KOD = "ZX9Q1"

    def setUp(self):
        import tempfile
        self.d = tempfile.mkdtemp()
        self._yedek = {k: getattr(kabul, k) for k in ("uygulama_ac", "oldur", "gonder", "log", "ana_surec_ag_olc",
                                                    "ana_surec_profil_olc")}
        kabul.ana_surec_ag_olc = lambda *a, **k: "kapali:ECONNREFUSED"
        self.userdata = {"userData": self.d, "work": os.path.join(self.d, "work")}
        kabul.ana_surec_profil_olc = lambda *a, **k: self.userdata
        self._uyku, self._saat = kabul.time.sleep, kabul.time.time
        self.t = [1000.0]
        kabul.time.time = lambda: self.t[0]
        kabul.time.sleep = lambda sn=0: self.t.__setitem__(0, self.t[0] + max(float(sn), 0.01))
        self.ekranlar = []; self.loglar = []
        kabul.gonder = lambda ad, veri: self.ekranlar.append(ad) or True
        kabul.log = lambda *p: self.loglar.append("|".join(str(x) for x in p))
        kabul.oldur = lambda dizin: None

    def tearDown(self):
        for k, v in self._yedek.items(): setattr(kabul, k, v)
        kabul.time.sleep, kabul.time.time = self._uyku, self._saat

    class Profil:
        def __init__(self): self.aktif = False

    class SahteUygulama:
        KITAPLAR = [{"id": "book1", "x": 100, "y": 100, "varyant": "B", "ad": "B1"},
                    {"id": "book2", "x": 300, "y": 100, "varyant": "B", "ad": "B2"}]
        RAF = [{"id": "kapak", "x": 400, "y": 400}, {"id": "kapak", "x": 700, "y": 400}]
        def __init__(self, profil, kod, online=False, gecerliyi_reddet=False, tek_motor=False):
            self.p, self.kod, self.online, self.red, self.tek = profil, kod, online, gecerliyi_reddet, tek_motor
            self.sayfa = "raf" if tek_motor else "menu"; self.hata = 0; self.yazilan = ""
            self.diyalog = tek_motor and not profil.aktif; self.girilen = []
        def cmd(self, *a, **k): return {}
        def ekran(self): return b"png"
        def kapat(self): pass
        def js(self, e):
            if e.startswith("location.href="): self.sayfa = "menu"; self.diyalog = False; return None
            if e == "location.href": return "file:///menu/index.html"
            return None
        def jsj(self, e):
            if e is kabul.JS_MENU: return self.KITAPLAR if (self.sayfa == "menu" and not self.tek) else None
            if e is kabul.JS_AKT:
                h = self.hata > 0
                if self.hata: self.hata -= 1
                return {"diyalog": self.diyalog, "girdi": {"x": 5, "y": 5} if self.diyalog else None,
                        "hata": h, "kitapta": self.sayfa == "kitap", "online": self.online,
                        "raf": self.RAF if (self.sayfa == "raf" and not self.diyalog) else []}
            return None
        def tikla(self, x, y):
            if self.sayfa == "menu" and any((k["x"], k["y"]) == (x, y) for k in self.KITAPLAR):
                self.sayfa = "kitap"; self.diyalog = not self.p.aktif
            if self.sayfa == "raf" and not self.diyalog and any((k["x"], k["y"]) == (x, y) for k in self.RAF):
                self.sayfa = "kitap"
        def tus(self, key, code, vk, modifiers=0, text=None):
            if key == "a" and modifiers == 2: self.yazilan = ""
            if key == "Enter" and self.diyalog:
                self.girilen.append(self.yazilan)
                if self.yazilan == self.kod and not self.red: self.p.aktif = True; self.diyalog = False
                else: self.hata = 2
        def yaz(self, m): self.yazilan += m

    def kos(self, **kw):
        profil = self.Profil(); self.uygulamalar = []
        def ac(ana, dizin, prof):
            u = self.SahteUygulama(profil, self.KOD, **kw); self.uygulamalar.append(u); return (u, {}, 9)
        kabul.uygulama_ac = ac
        r = {}
        c, menuUrl, kitaplar = kabul.aktivasyon_senaryosu(r, "45449-imzasiz-x", "app.exe", "dizin", self.KOD, self.d)
        return r, c

    def test_tam_akis_a_e_gecti_ve_ekranlar(self):
        r, c = self.kos()
        A = r["aktivasyon"]["adimlar"]
        self.assertEqual({k: A[k]["sonuc"] for k in "abcde"}, dict.fromkeys("abcde", "GECTI"))
        self.assertEqual(kabul.aktivasyon_ozeti(A), ("GECTI", None))
        self.assertEqual(self.ekranlar, [f"45449-imzasiz-x-akt-{a}" for a in "abcde"])
        self.assertIs(r["aktivasyon"]["online"], False)

    def test_kod_hicbir_ciktiya_yazilmaz(self):
        r, c = self.kos()
        import json as _j
        metin = _j.dumps(r) + "\n".join(self.loglar) + "\n".join(self.ekranlar)
        self.assertNotIn(self.KOD, metin)

    def test_gecerli_kod_reddedilirse_c_kaldi_ve_kabul_kaldi(self):
        r, c = self.kos(gecerliyi_reddet=True)
        A = r["aktivasyon"]["adimlar"]
        self.assertEqual(A["c"]["sonuc"], "KALDI")
        self.assertEqual(kabul.aktivasyon_ozeti(A), ("KALDI", "aktivasyon-c KALDI"))

    def test_karar_tablosu(self):
        k = kabul.akt_karar
        self.assertEqual(k("a", {"diyalog": True, "girdi": {"x": 1, "y": 1}}), "GECTI")
        self.assertEqual(k("a", {"diyalog": False, "kitapta": True}), "KALDI")
        self.assertEqual(k("b", {"hataGoruldu": True, "diyalog": True}), "GECTI")
        self.assertEqual(k("b", {"hataGoruldu": False, "diyalog": True}), "KALDI")
        self.assertEqual(k("c", {"diyalog": False, "kitapta": True}), "GECTI")
        self.assertEqual(k("d", {"diyalog": True, "kitapta": True}), "KALDI")
        self.assertEqual(k("d", {}, tek_kitap=True), "ATLANDI")
        self.assertEqual(k("e", {"diyalog": False, "kitapta": False}), "KALDI")
        self.assertEqual(kabul.aktivasyon_ozeti({"a": {"sonuc": "GECTI"}}), ("KALDI", "aktivasyon-b olculmedi"))
        tam = {a: {"sonuc": "GECTI"} for a in "abce"}; tam["d"] = {"sonuc": "ATLANDI"}
        self.assertEqual(kabul.aktivasyon_ozeti(tam), ("GECTI", None))

    def test_kod_dosyasi_ve_guvenlik_duvari_komutlari(self):
        yol = os.path.join(self.d, "kod.txt")
        self.assertIsNone(kabul.aktivasyon_kod_oku(os.path.join(self.d, "yok.txt")))
        with open(yol, "w", encoding="utf-8") as f: f.write("\ufeffAB12C\r\n")
        self.assertEqual(kabul.aktivasyon_kod_oku(yol), "AB12C")
        with open(yol, "w", encoding="utf-8") as f: f.write("A B\n")
        self.assertIsNone(kabul.aktivasyon_kod_oku(yol))
        with open(yol, "w", encoding="utf-8") as f: f.write("A\nB\n")
        self.assertIsNone(kabul.aktivasyon_kod_oku(yol))
        ad = kabul.gd_kural_adi('45449-imzasiz-x" & del')
        self.assertRegex(ad, r"^empp-kabul-akt-[A-Za-z0-9-]+$")
        ekle, kaldir = kabul.gd_kural_komutlari(ad, r"C:\P\Impact 12\Impact.exe")
        self.assertIn("dir=out", ekle); self.assertIn("action=block", ekle)
        self.assertIn(r"program=C:\P\Impact 12\Impact.exe", ekle)
        self.assertEqual(kaldir[-1], "name=" + ad)


    def test_cevrimici_ise_hicbir_kod_girilmez(self):
        r, c = self.kos(online=True)
        self.assertEqual(r["aktivasyon"]["adimlar"]["a"]["sonuc"], "GECTI")
        self.assertIn("kodGirilmedi", r["aktivasyon"])
        self.assertEqual([g for u in self.uygulamalar for g in u.girilen], [], "cevrimiciyken kod (gecersiz bile) girilmez")
        self.assertNotIn("b", r["aktivasyon"]["adimlar"])

    def test_online_olculemezse_de_kod_girilmez(self):
        r, c = self.kos(online=None)
        self.assertIn("kodGirilmedi", r["aktivasyon"])
        self.assertFalse(kabul.cevrimdisi_mi({"online": None}))
        self.assertTrue(kabul.cevrimdisi_mi({"online": False}))

    def test_tek_motor_duzen_diyalog_acilista_raf_sonra_a_e_gecti(self):
        r, c = self.kos(tek_motor=True)
        A = r["aktivasyon"]["adimlar"]
        self.assertEqual(r["aktivasyon"]["duzen"], "tek-motor")
        self.assertEqual(A["a"]["yer"], "acilis")
        self.assertEqual({k: A[k]["sonuc"] for k in "abcde"}, dict.fromkeys("abcde", "GECTI"))
        self.assertEqual(A["d"]["kitap"], "raf-kapak")

    def test_uygulama_olu_proxy_ile_acilir(self):
        self.assertIn("--proxy-server=http://127.0.0.1:9", kabul.AKT_PROXY_ARGV)
        env = kabul.akt_ortami({"PATH": "x", "NO_PROXY": "*"}, r"D:\kabul\p")
        self.assertEqual(env["APPDATA"], r"D:\kabul\p")
        self.assertEqual(env["HTTPS_PROXY"], "http://127.0.0.1:9")
        self.assertEqual(env["HTTP_PROXY"], "http://127.0.0.1:9")
        self.assertEqual(env["NO_PROXY"], "")
        self.assertEqual(env["PATH"], "x")


    def test_profil_disi_userdata_kod_girilmez_kuru_kosu_2_regresyonu(self):
        # 03.10 kuru kosu 2: APPDATA verildi ama Electron Roaming'e yazdi; kuru kosu 1'in aktivasyonu
        # tasindi, diyalog cikmadi. Artik userData profil disindaysa hicbir kod girilmez.
        self.userdata = {"userData": r"C:\Users\Administrator\AppData\Roaming\impact-grade-12",
                         "work": r"C:\Users\Administrator\AppData\Roaming\impact-grade-12\work"}
        r, c = self.kos(tek_motor=True)
        self.assertIs(r["aktivasyon"]["profilYalitik"], False)
        self.assertIn("kodGirilmedi", r["aktivasyon"])
        self.assertEqual(r["aktivasyon"]["adimlar"], {})
        self.assertEqual([g for u in self.uygulamalar for g in u.girilen], [])

    def test_profil_olculemezse_kod_girilmez(self):
        self.userdata = None
        r, c = self.kos()
        self.assertIn("kodGirilmedi", r["aktivasyon"])
        self.assertEqual([g for u in self.uygulamalar for g in u.girilen], [])

    def test_profil_yalitik_mi_karar_tablosu(self):
        k, p = kabul.profil_yalitik_mi, os.path.join(self.d, "akt-profil-1")
        self.assertTrue(k({"userData": p}, p))
        self.assertTrue(k({"userData": p, "work": os.path.join(p, "work")}, p))
        self.assertFalse(k({"userData": p + "0"}, p), "kardes dizin onek benzerligiyle gecmez")
        self.assertFalse(k({"userData": p, "work": os.path.join(self.d, "baska", "work")}, p))
        self.assertFalse(k(None, p)); self.assertFalse(k({"userData": None}, p))

    def test_argv_user_data_dir_ve_olu_proxy_tasir(self):
        argv = kabul.akt_argv(r"C:\P\app.exe", r"D:\kabul\p")
        self.assertEqual(argv[0], r"C:\P\app.exe")
        self.assertIn(r"--user-data-dir=D:\kabul\p", argv)
        self.assertIn("--proxy-server=http://127.0.0.1:9", argv)
        self.assertIn(f"--inspect=127.0.0.1:{kabul.AKT_INSPECT_PORT}", argv)


class BaglantiAyirTest(unittest.TestCase):
    """45551 (03.10): settings.json "link" ogesi (Worksheets -> URL) kitap sayilip book5 ACILMADI -> KALDI."""
    MENU = [{"id": "book%d" % i, "ad": a, "x": i, "y": 1, "varyant": "B"} for i, a in enumerate(
        ["Student's Book\nÜniteye Git", "Workbook\nÜniteye Git", "Key Words\nÜniteye Git",
         "Test Book\nÜniteye Git", "Worksheets"], 1)]
    AYAR = {"baglanti": [{"ad": "Worksheets", "url": "https://download.ydspublishing.com/worksheets/x/"}],
            "kitap": ["Student's Book", "Workbook", "Key Words", "Test Book"]}

    def test_45551_link_ogesi_ayrilir_dort_kitap_kalir(self):
        kalan, bag = kabul.baglanti_ayir(self.MENU, self.AYAR)
        self.assertEqual([k["id"] for k in kalan], ["book1", "book2", "book3", "book4"])
        self.assertEqual(bag, [{"ad": "Worksheets", "url": "https://download.ydspublishing.com/worksheets/x/",
                                "id": "book5"}])

    def test_ayar_okunamazsa_eski_davranis(self):
        self.assertEqual(kabul.baglanti_ayir(self.MENU, None), (self.MENU, []))
        self.assertEqual(kabul.baglanti_ayir(self.MENU, {"__hata": "x"})[0], self.MENU)

    def test_kitapla_ayni_adli_link_ayrilmaz(self):
        ayar = {"baglanti": [{"ad": "Workbook", "url": "u"}], "kitap": ["Workbook"]}
        self.assertEqual(kabul.baglanti_ayir(self.MENU, ayar), (self.MENU, []))

    def test_kitaplari_olc_linki_olcmez_ve_raporlar(self):
        yedek = {k: getattr(kabul, k) for k in ("kitap_kanit", "menuye_don", "oldur", "kaldir", "bitir",
                                                 "gonder", "log", "time")}
        tiklanan = []; loglar = []
        class C:
            def ekran(s): return b"p"
            def kapat(s): pass
            def tikla(s, x, y): tiklanan.append(x)
            def js(s, e): return True
            def jsj(s, e): return BaglantiAyirTest.AYAR if e is kabul.JS_BAGLANTILAR else None
        class Saat:
            @staticmethod
            def sleep(_): pass
            @staticmethod
            def time(): return 0.0
        try:
            kabul.kitap_kanit = lambda c, b, i: {"sonuc": "GECTI"}
            kabul.menuye_don = lambda c, u: True
            kabul.oldur = lambda d: None; kabul.kaldir = lambda d: "KALDIRILDI"
            kabul.bitir = lambda r: r; kabul.gonder = lambda a, v: True
            kabul.log = lambda *p: loglar.append("|".join(map(str, p))); kabul.time = Saat
            r = kabul.kitaplari_olc({}, C(), "45551", "Shall We", "d", "file:///m", list(self.MENU))
        finally:
            for k, v in yedek.items(): setattr(kabul, k, v)
        self.assertEqual(r["sonuc"], "GECTI")
        self.assertEqual((r["gecenKitap"], r["toplamKitap"]), (4, 4))
        self.assertNotIn(5, tiklanan, "link ogesine tiklanmaz")
        self.assertEqual(r["menuBaglantilar"][0]["ad"], "Worksheets")
        self.assertTrue(any(l.startswith("BAGLANTI|45551|Worksheets|https://") for l in loglar))


if __name__ == "__main__":
    unittest.main()
