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


if __name__ == "__main__":
    unittest.main()
