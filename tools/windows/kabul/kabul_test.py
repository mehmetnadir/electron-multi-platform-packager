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
                                                    "ana_surec_profil_olc", "ana_surec_pencere_goster")}
        kabul.ana_surec_pencere_goster = lambda *a, **k: {"pencere": 1, "once": [{"gorunur": True, "kucuk": False}]}
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

    def test_adim_olcum_ozeti_rapora_yazilir_raf_sayi(self):
        r, c = self.kos(tek_motor=True)
        A = r["aktivasyon"]["adimlar"]
        self.assertTrue(A["a"]["olcum"]["diyalog"])
        self.assertEqual(A["c"]["olcum"]["raf"], 2)
        self.assertIs(A["c"]["olcum"]["online"], False)
        self.assertEqual(kabul.olcum_ozeti({"raf": [{"x": 1}], "hata": False}), {"hata": False, "raf": 1})

    def test_gizli_pencere_ekran_oncesi_geri_getirilir_ve_raporlanir(self):
        kabul.ana_surec_pencere_goster = lambda *a, **k: {"pencere": 1, "once": [{"gorunur": False, "kucuk": False}]}
        r, c = self.kos()
        self.assertEqual(r["aktivasyon"]["adimlar"]["a"]["pencere"]["once"][0]["gorunur"], False)
        self.assertTrue(kabul.pencere_sorunlu_mu({"once": [{"gorunur": True, "kucuk": True}]}))
        self.assertFalse(kabul.pencere_sorunlu_mu({"once": [{"gorunur": True, "kucuk": False}]}))
        self.assertFalse(kabul.pencere_sorunlu_mu(None))

    def test_pencere_normalse_rapora_pencere_yazilmaz(self):
        r, c = self.kos()
        self.assertNotIn("pencere", r["aktivasyon"]["adimlar"]["a"])

    def test_raf_dedektoru_background_image_kapaklari_tanir(self):
        # 45449 kuru kosu 4 (03.10): kapaklar background-image DIV; document.images bos -> raf=0, c KALDI
        self.assertIn("backgroundImage", kabul.JS_AKT)
        self.assertIn("url(", kabul.JS_AKT)
        self.assertIn("document.images", kabul.JS_AKT, "img kapaklar da tanınmaya devam eder")

    def test_c_adimi_raf_gorunce_erken_doner(self):
        class C:
            n = 0
            def jsj(s, e):
                s.n += 1
                return {"diyalog": False, "kitapta": False, "raf": [{"x": 1, "y": 1}] if s.n >= 3 else []}
        c = C(); t0 = self.t[0]
        o = kabul.akt_durum_bekle(c, tavan=45, raf_yeter=True)
        self.assertTrue(o["raf"])
        self.assertLess(self.t[0] - t0, 10, "raf kararlıysa 45 sn tavan beklenmez")
        c2 = C(); t1 = self.t[0]
        kabul.akt_durum_bekle(c2, tavan=45)
        self.assertGreaterEqual(self.t[0] - t1, 45, "raf_yeter yoksa (d adımı) raf erken dönüş sayılmaz")

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


class NormalArgvTest(unittest.TestCase):
    """73768 (03.10): Roaming profilindeki eski okuyucu durumu kabulu belirsizlestiriyordu."""
    def test_varsayilan_taze_profil(self):
        argv = kabul.normal_argv("app.exe", '73768-imzasiz-x" &', {}, simdi="20261003")
        self.assertEqual(argv[:3], ["app.exe", f"--remote-debugging-port={kabul.PORT}", "--remote-allow-origins=*"])
        self.assertEqual(argv[3], "--user-data-dir=" + os.path.join(kabul.KOK, "kabul-profil-73768-imzasiz-x----20261003"))

    def test_bayrak_sifirsa_eski_davranis(self):
        self.assertEqual(kabul.normal_argv("app.exe", "1", {"EMPP_KABUL_TAZE_PROFIL": "0"}),
                         ["app.exe", f"--remote-debugging-port={kabul.PORT}", "--remote-allow-origins=*"])


class SayfaTusTakimiTest(unittest.TestCase):
    """73768 probe (03.10): sayfa kutusu ekran tuş takımı açar; klavye girdisi alanı doldurmaz."""
    TUSLAR = ([{"t": str(n), "x": 860 + 105 * ((n - 1) % 3), "y": 720 + 55 * ((n - 1) // 3), "b": True} for n in range(1, 10)]
              + [{"t": "", "x": 860, "y": 886, "b": True}, {"t": "0", "x": 965, "y": 886, "b": True},
                 {"t": "", "x": 1070, "y": 886, "b": True}, {"t": "", "x": 880, "y": 955, "b": True}])

    def test_bir_ve_tamam_secilir(self):
        self.assertEqual(kabul.tus_takimi_sec(self.TUSLAR), {"bir": (860, 720), "tamam": (1070, 886)})

    def test_tus_takimi_yoksa_none(self):
        self.assertIsNone(kabul.tus_takimi_sec([{"t": "1", "x": 1, "y": 1}]))
        self.assertIsNone(kabul.tus_takimi_sec(None))
        eksik = [x for x in self.TUSLAR if not (x["t"] == "" and x["x"] == 1070)]
        self.assertIsNone(kabul.tus_takimi_sec(eksik), "✓ yoksa kör tıklama yok")

    def test_ilk_sayfaya_git_kutu_tus_takimiyla_ve_balon_kapatilarak(self):
        yedek = {k: getattr(kabul, k) for k in ("time",)}
        tik = []; olcum = [{"sayfa": "12/172", "canvasDolu": 3000, "canvasRenk": 99}]
        T = self.TUSLAR
        class Saat:
            @staticmethod
            def sleep(_): pass
        class C:
            atla = 1
            def jsj(s, e):
                if e is kabul.JS_ATLA:
                    if s.atla: s.atla -= 1; return {"t": "Atla"}
                    return None
                if e is kabul.JS_SAYFA_KUTUSU: return {"x": 773, "y": 763, "geri": {"x": 705, "y": 763}}
                if e is kabul.JS_SAYFA_TUSLARI: return T
                return None
            def tikla(s, x, y):
                tik.append((x, y))
                if (x, y) == (1070, 886): olcum[0] = {"sayfa": "1/172", "canvasDolu": 3000, "canvasRenk": 99}
            def tus(s, *a, **k): raise AssertionError("tuş takımı varken klavye kullanılmaz")
            def yaz(s, m): raise AssertionError("tuş takımı varken klavye kullanılmaz")
        try:
            kabul.time = Saat
            k = kabul.ilk_sayfaya_git(C(), {"sayfa": "12/172", "thumbEtiket": [{"n": 12, "x": 1, "y": 1}]},
                                      lambda: dict(olcum[0]))
        finally:
            for a, v in yedek.items(): setattr(kabul, a, v)
        self.assertEqual(k["sayfa"], "1/172")
        self.assertEqual(k["ilkSayfaYolu"], "kutu-tuslar")
        self.assertEqual(tik, [(773, 763), (860, 720), (1070, 886)])



class SayfalarKartiTest(unittest.TestCase):
    """73768 (04.10): tur Sayfalar kartini acik birakir; thumb'lar IO ile tembel uretilir."""
    def test_plan_kart_yoksa_bos(self):
        self.assertEqual(kabul.serit_eylem_plani(None, 0), [])
        self.assertEqual(kabul.serit_eylem_plani({"var": False}, 0), [])

    def test_plan_ilk_tur_acik_kart_once_kapatilir(self):
        self.assertEqual(kabul.serit_eylem_plani({"var": True, "acik": True, "h": 269, "img": 2}, 0), ["kapat", "ac"])
        self.assertEqual(kabul.serit_eylem_plani({"var": True, "acik": False}, 0), ["ac"])

    def test_plan_sonraki_turlar_kaydir_tekerlek_ok_ve_basik_kart_boyut(self):
        dolu = {"var": True, "acik": True, "h": 269, "img": 2}
        self.assertEqual([kabul.serit_eylem_plani(dolu, t) for t in (1, 2, 3, 4)],
                         [["kaydir"], ["tekerlek"], ["ok"], ["kaydir"]])
        basik = {"var": True, "acik": True, "h": 48, "img": 0}
        self.assertEqual(kabul.serit_eylem_plani(basik, 1), ["boyut", "kaydir"])
        self.assertEqual(kabul.serit_eylem_plani({"var": True, "acik": False}, 2), ["ac"])

    def _sahte(self, thumb_akisi):
        """Kart durumu: acik, kapat->kapali, ac->acik; her eylem thumb sayisini akistan ilerletir."""
        olay = []; durum = {"acik": True, "thumb": 0, "i": 0}
        akis = list(thumb_akisi)
        def ilerle():
            if durum["i"] < len(akis): durum["thumb"] = akis[durum["i"]]; durum["i"] += 1
        class C:
            def js(s, e):
                if e is kabul.JS_KART_KAPAT: olay.append("kapat"); durum["acik"] = False; return "x"
                if e is kabul.JS_YENIDEN_BOYUT: olay.append("boyut"); return "resize"
                return None
            def jsj(s, e):
                if e is kabul.JS_KART:
                    return {"var": True, "acik": durum["acik"], "h": 269 if durum["thumb"] else 48,
                            "img": durum["thumb"], "imgOK": durum["thumb"], "thumbKaynak": durum["thumb"]}
                if e is kabul.JS_SERIT:
                    if durum["acik"]: raise AssertionError("acik karta JS_SERIT tiklanmaz (kapatir)")
                    olay.append("ac"); durum["acik"] = True; ilerle(); return {"yol": "etiket"}
                if e is kabul.JS_SERIT_KAYDIR: olay.append("kaydir"); ilerle(); return {"once": 0, "sonra": 240, "x": 700, "y": 790}
                if e is kabul.JS_SERIT_OK: olay.append("ok"); ilerle(); return {"x": 1, "y": 1}
                if e is kabul.JS_ATLA: return None
                return None
            def cmd(s, m, **k): olay.append("tekerlek"); ilerle()
            def tikla(s, x, y): pass
        olc = lambda: {"thumbOK": durum["thumb"], "canvasDolu": 5000, "canvasRenk": 300}
        return C(), olc, olay

    def _kos(self, c, olc):
        yedek = kabul.time
        class Saat:
            @staticmethod
            def sleep(_): pass
        try:
            kabul.time = Saat
            return kabul.kart_ile_thumb_yukle(c, olc, {"thumbOK": 0})
        finally:
            kabul.time = yedek

    def test_kapat_ac_sonra_kaydirma_ile_uc_gercek_thumb(self):
        c, olc, olay = self._sahte([2, 3])
        k, kartli = self._kos(c, olc)
        self.assertTrue(kartli)
        self.assertEqual(k["thumbOK"], 3)
        self.assertEqual(olay[:3], ["kapat", "ac", "kaydir"])
        self.assertEqual(k["kartEylem"][:2], ["kapat", "ac-etiket"])
        self.assertEqual(k["kart"]["thumbKaynak"], 3)

    def test_esik_gevsemez_iki_thumb_ile_kaldi(self):
        c, olc, olay = self._sahte([2])
        k, _ = self._kos(c, olc)
        self.assertEqual(k["thumbOK"], 2)
        self.assertIn("tekerlek", olay); self.assertIn("ok", olay)
        self.assertEqual(kabul.kanit_sonucu(k["thumbOK"], 5000, 300, 172, True)[0], "KALDI")

    def test_kitap_kanit_kartli_temada_kor_serit_anahtari_kosmaz(self):
        c, olc, olay = self._sahte([2])
        c.ekran = lambda: b"png"
        yedek = {k: getattr(kabul, k) for k in ("time", "ilk_sayfaya_git", "gonder")}
        class Saat:
            @staticmethod
            def sleep(_): pass
        try:
            kabul.time = Saat
            kabul.ilk_sayfaya_git = lambda c_, k, o: k
            kabul.gonder = lambda a, v: True
            orj = c.jsj
            c.jsj = lambda e: ({"thumbOK": 0, "canvasDolu": 5000, "canvasRenk": 300, "sayfa": "1/172",
                                "toplamSayfa": 172} if e is kabul.JS_KANIT else orj(e))
            k = kabul.kitap_kanit(c, "73768", 1)
        finally:
            for a, v in yedek.items(): setattr(kabul, a, v)
        self.assertEqual(olay.count("ac"), 1, "kart yolu sonrasi eski anahtar karti kapatip acmamali")
        self.assertIn("kartEylem", k)

    def test_tekerlek_yanit_vermezse_adim_atlanir_olcum_ve_esik_ayni_kalir(self):
        """CDP mouseWheel yanit vermezse (kare yok) kabul dusmez; adim atlanir, esik gevsemez."""
        c, olc, olay = self._sahte([2])
        def cmd(m, **k):
            olay.append("tekerlek-asim")
            self.assertEqual(k.get("_zaman_asimi"), kabul.CDP_TEKERLEK_SN)
            raise TimeoutError(m)
        c.cmd = cmd
        k, kartli = self._kos(c, olc)
        self.assertTrue(kartli)
        self.assertIn("tekerlek-asim", olay)
        self.assertIn("tekerlek-zamanasimi", k["kartEylem"])
        self.assertEqual(k["thumbOK"], 2)
        self.assertEqual(kabul.kanit_sonucu(k["thumbOK"], 5000, 300, 172, True)[0], "KALDI")

    def test_cdp_cmd_kisa_sinirda_websocket_zaman_asimi_TimeoutError_olur_ve_sinir_geri_alinir(self):
        import websocket
        class WS:
            def __init__(s): s.t = []
            def send(s, x): pass
            def settimeout(s, v): s.t.append(v)
            def recv(s): raise websocket.WebSocketTimeoutException("x")
        c = kabul.CDP.__new__(kabul.CDP); c.ws = WS(); c.i = 0
        with self.assertRaises(TimeoutError):
            c.cmd("Input.dispatchMouseEvent", _zaman_asimi=1, type="mouseWheel")
        self.assertEqual(c.ws.t, [1, 120])

    def test_tekerlek_baglanti_koparsa_yutulmaz_yeniden_firlar(self):
        import websocket
        c, olc, olay = self._sahte([2])
        def cmd(m, **k):
            raise websocket.WebSocketConnectionClosedException("kapandi")
        c.cmd = cmd
        with self.assertRaises(websocket.WebSocketConnectionClosedException):
            self._kos(c, olc)

    def test_kart_yoksa_dokunulmaz(self):
        class C:
            def jsj(s, e): return {"var": False} if e is kabul.JS_KART else None
            def js(s, e): raise AssertionError("kart yokken eylem yok")
        k, kartli = kabul.kart_ile_thumb_yukle(C(), lambda: {}, {"thumbOK": 1})
        self.assertFalse(kartli)
        self.assertEqual(k, {"thumbOK": 1})


class KokDizinOrtamTest(unittest.TestCase):
    """KOK/YEDEK/AKT_KOD_DOSYASI ortamdan gelir (04.10 C: tasimasi); yoksa eski D: yerlesimi."""

    def _yukle(self, ortam):
        import importlib
        eski = {k: os.environ.get(k) for k in ("KABUL_KOK", "KABUL_AKT_KOD_DOSYASI")}
        try:
            for k in eski:
                os.environ.pop(k, None)
            os.environ.update(ortam)
            return importlib.reload(kabul)
        finally:
            for k, v in eski.items():
                if v is None: os.environ.pop(k, None)
                else: os.environ[k] = v

    def tearDown(self):
        import importlib
        importlib.reload(kabul)

    def test_varsayilan_d_yerlesimi(self):
        m = self._yukle({})
        self.assertEqual(m.KOK, r"D:\kabul")
        self.assertEqual(m.YEDEK, r"D:\kabul\.empp-yedek-20260922")
        self.assertEqual(m.AKT_KOD_DOSYASI, r"D:\empp-ajan\kabul\aktivasyon-test-kodu.txt")

    def test_ortamdan_c_yerlesimi(self):
        m = self._yukle({"KABUL_KOK": r"C:\kabul",
                         "KABUL_AKT_KOD_DOSYASI": r"C:\empp-ajan\kabul\aktivasyon-test-kodu.txt"})
        self.assertEqual(m.KOK, r"C:\kabul")
        self.assertEqual(m.YEDEK, r"C:\kabul\.empp-yedek-20260922")
        self.assertEqual(m.AKT_KOD_DOSYASI, r"C:\empp-ajan\kabul\aktivasyon-test-kodu.txt")


class KitapKodKaynagiTest(unittest.TestCase):
    """05.10: aktivasyon kodu SET bazli. Sira kitap-dosyasi > paket-imkeys > genel-dosya; rapora
    yalniz kaynak adi. SAHTE kodlar (gercek kod YOK)."""
    # Node ile uretildi: require('src/agent/imkeys').imKeysBicimle(['testkod123','ZZZ-999','x y'])
    # -> base64. imKeysCoz ayni baytlardan ["TESTKOD123","ZZZ-999"] dondurur ('x y' desen disi atilir).
    IMKEYS_FIKSTUR = "pd6su62stbG8z87N3tTepqam08fHx96j"
    SAHTE = "TESTKOD123"

    def setUp(self):
        import base64, tempfile
        self.d = tempfile.mkdtemp(prefix="kabul-kod-")
        self.veri = base64.b64decode(self.IMKEYS_FIKSTUR)
        self.kurulum = os.path.join(self.d, "Programs", "SahteSet")
        self.kod_dizini = os.path.join(self.d, "aktivasyon-kodlari")
        self.genel = os.path.join(self.d, "aktivasyon-test-kodu.txt")
        os.makedirs(os.path.join(self.kurulum, "resources", "app"))
        os.makedirs(self.kod_dizini)

    def _imkeys(self, *parca, veri=None):
        yol = os.path.join(self.kurulum, "resources", "app", *parca, "imKeys.dll")
        os.makedirs(os.path.dirname(yol), exist_ok=True)
        with open(yol, "wb") as f: f.write(self.veri if veri is None else veri)
        return yol

    def _yaz(self, yol, metin):
        with open(yol, "w", encoding="utf-8") as f: f.write(metin)

    def test_imkeys_cozucu_node_kodlayicisiyla_uyumlu(self):
        self.assertEqual(kabul.imkeys_kodlari_coz(self.veri), ["TESTKOD123", "ZZZ-999"])

    def test_imkeys_cozucu_bozuk_bos_dizi_olmayan(self):
        self.assertEqual(kabul.imkeys_kodlari_coz(b""), [])
        self.assertEqual(kabul.imkeys_kodlari_coz(None), [])
        self.assertEqual(kabul.imkeys_kodlari_coz(b"\x00\x01duz-metin"), [])
        nesne = bytes((256 - b) & 0xFF for b in b'{"a":"TESTKOD123"}')
        self.assertEqual(kabul.imkeys_kodlari_coz(nesne), [])
        bos = bytes((256 - b) & 0xFF for b in b"[]")
        self.assertEqual(kabul.imkeys_kodlari_coz(bos), [])

    def test_set_kimligi_etiketten(self):
        self.assertEqual(kabul.set_kimligi("45448-imzasiz-20261005032127"), "45448")
        self.assertEqual(kabul.set_kimligi("45480"), "45480")
        self.assertEqual(kabul.set_kimligi(45469), "45469")
        self.assertIsNone(kabul.set_kimligi("imzasiz-45448"))
        self.assertIsNone(kabul.set_kimligi(""))
        self.assertIsNone(kabul.set_kimligi(None))

    def test_kod_dizini_varsayilani_genel_dosyanin_yaninda(self):
        self.assertEqual(kabul.akt_kod_dizini_varsayilan(r"C:\empp-ajan\kabul\aktivasyon-test-kodu.txt"),
                         r"C:\empp-ajan\kabul\aktivasyon-kodlari")
        self.assertEqual(kabul.akt_kod_dizini_varsayilan("/x/y/kod.txt"), "/x/y/aktivasyon-kodlari")

    def test_kurulu_imkeys_tek_motor_ve_bookN_yerlesimi(self):
        a = self._imkeys("assets", "45448")
        b = self._imkeys("book2", "assets", "9001")
        c = self._imkeys("sarmal", "book1", "assets", "9002")
        # sayfa klasoru atlanir, kok disi yol yok
        self._imkeys("assets", "45448", "pages")
        self.assertEqual(kabul.kurulu_imkeys_bul(self.kurulum), sorted([a, b, c]))
        self.assertEqual(kabul.kurulu_imkeys_bul(os.path.join(self.d, "yok")), [])

    def test_oncelik_kitap_dosyasi_en_once(self):
        self._yaz(os.path.join(self.kod_dizini, "45448.txt"), "KITAPKOD1\n")
        self._imkeys("assets", "45448")
        self._yaz(self.genel, "GENELKOD1")
        self.assertEqual(kabul.akt_kod_sec("45448-imzasiz-20261005032127", self.kod_dizini, self.kurulum, self.genel),
                         ("KITAPKOD1", "kitap-dosyasi"))

    def test_baska_setin_kitap_dosyasi_kullanilmaz_paket_imkeys_secilir(self):
        self._yaz(os.path.join(self.kod_dizini, "45449.txt"), "BASKASET1")
        self._imkeys("assets", "45448")
        self._yaz(self.genel, "GENELKOD1")
        self.assertEqual(kabul.akt_kod_sec("45448-imzasiz-1", self.kod_dizini, self.kurulum, self.genel),
                         (self.SAHTE, "paket-imkeys"))

    def test_bos_imkeys_atlanir_ilk_dolu_kullanilir(self):
        self._imkeys("assets", "1000", veri=bytes((256 - b) & 0xFF for b in b"[]"))
        self._imkeys("assets", "2000")
        self.assertEqual(kabul.akt_kod_sec("45448", self.kod_dizini, self.kurulum, None), (self.SAHTE, "paket-imkeys"))

    def test_genel_dosya_yalniz_digerleri_yoksa(self):
        self._yaz(self.genel, "GENELKOD1")
        self.assertEqual(kabul.akt_kod_sec("45448", self.kod_dizini, self.kurulum, self.genel),
                         ("GENELKOD1", "genel-dosya"))

    def test_hicbiri_yoksa_none(self):
        self.assertEqual(kabul.akt_kod_sec("45448", self.kod_dizini, self.kurulum, self.genel), (None, None))
        self.assertEqual(kabul.akt_kod_sec("etiketsiz", None, None, None), (None, None))

    def test_kod_rapora_loga_stdouta_yazilmaz_yalniz_kaynak(self):
        import io, contextlib
        from unittest import mock
        self._imkeys("assets", "45448")
        gonderilen, giren = [], {}

        class Sonuc: returncode = 0

        def senaryo(r, kimlik, ana, dizin, kod, profil):
            giren["kod"] = kod
            r["aktivasyon"] = {**(r.get("aktivasyon") or {}), "adimlar": {"a": {"sonuc": "GECTI"},
                               "b": {"sonuc": "GECTI"}, "c": {"sonuc": "KALDI"}}, "profil": "p"}
            return None, None, []

        ortam = {"EMPP_KABUL_AKTIVASYON_KOD_DOSYASI": self.genel, "KABUL_AKT_KOD_DIZINI": self.kod_dizini}
        cikti = io.StringIO()
        with mock.patch.dict(os.environ, ortam), \
             mock.patch.object(kabul.subprocess, "run", lambda *a, **k: Sonuc()), \
             mock.patch.object(kabul, "aktivasyon_senaryosu", senaryo), \
             mock.patch.object(kabul, "oldur", lambda *a, **k: None), \
             mock.patch.object(kabul, "kaldir", lambda *a, **k: {"durum": "KALDIRILDI"}), \
             mock.patch.object(kabul, "gonder", lambda ad, veri: gonderilen.append((ad, veri))), \
             contextlib.redirect_stdout(cikti):
            r = {"bookId": "45448-imzasiz-20261005032127", "baslik": "x"}
            kabul.aktivasyonlu_kabul(r, r["bookId"], "x", self.kurulum, r"C:\P\x.exe")
        self.assertEqual(giren["kod"], self.SAHTE, "paket imKeys kodu senaryoya ulasmali")
        self.assertEqual(r["aktivasyon"]["kodKaynagi"], "paket-imkeys")
        self.assertEqual(r["sonuc"], "KALDI")
        self.assertNotIn(self.SAHTE, cikti.getvalue())
        self.assertNotIn("ZZZ-999", cikti.getvalue())
        self.assertIn("paket-imkeys", cikti.getvalue())
        self.assertTrue(gonderilen)
        for ad, veri in gonderilen:
            self.assertNotIn(self.SAHTE, ad)
            self.assertNotIn(self.SAHTE.encode(), veri if isinstance(veri, bytes) else str(veri).encode())

    def test_hicbir_kaynak_yoksa_olculemedi(self):
        import io, contextlib
        from unittest import mock
        gonderilen = []
        ortam = {"EMPP_KABUL_AKTIVASYON_KOD_DOSYASI": self.genel, "KABUL_AKT_KOD_DIZINI": self.kod_dizini}
        with mock.patch.dict(os.environ, ortam), \
             mock.patch.object(kabul, "kaldir", lambda *a, **k: {}), \
             mock.patch.object(kabul, "gonder", lambda ad, veri: gonderilen.append(ad)), \
             contextlib.redirect_stdout(io.StringIO()):
            r = {"bookId": "45448-x", "baslik": "x"}
            kabul.aktivasyonlu_kabul(r, r["bookId"], "x", self.kurulum, r"C:\P\x.exe")
        self.assertEqual(r["sonuc"], "OLCULEMEDI")
        self.assertEqual(r["sebep"], "aktivasyon test kodu dosyasi yok/bos")
        self.assertNotIn("aktivasyon", r)


if __name__ == "__main__":
    unittest.main()
