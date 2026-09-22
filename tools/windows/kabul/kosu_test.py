#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""kosu.py'nin SAF ayiklama fonksiyonu icin testler (stdlib unittest).

Bu dosyanin varlik sebebi tek bir saha arizasi (2026-09-22):
kapi 47 Windows paketini gecirirken UC paket — 72379 (7 kitap), 72380 (7 kitap),
59834 (5 kitap) — kayitta "KALDI / CIKTI_YOK" gorundu. Ekran goruntuleri ve kapinin
kendi ciktisi ise ucunun de GECTI oldugunu soyluyordu (7/7, 7/7, 5/5). Sebep pakette
ya da kapida degil, RAPOR KATMANINDAYDI: kosu.py ciktinin son 3000 karakterini
basiyordu, buyuk paketin JSON'u bunu asinca `JSON>>>` isareti bastan kirpiliyor ve
cagiran hicbir sey ayiklayamiyordu.

Kritik ozellik: yanlilik KITAP SAYISIYLA ARTAR. Yani kapi en cok, icinde en cok kitap
olan — en degerli — paketlerde yaniliyordu. Asagidaki `test_buyuk_json_*` testleri tam
olarak bunu cakar: eski kirpma davranisi ayiklamayi bozar, yenisi bozmaz.

Kosum: /usr/bin/python3 tools/windows/kabul/kosu_test.py -v
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kosu  # noqa: E402


def sahte_kapi_ciktisi(kitap_sayisi):
    """Gercek kapi ciktisinin bicimini taklit eder: once konuk tarafin log satirlari,
    sonra `JSON>>>` isareti, sonra tek satirlik JSON. Kitap basina ~350 karakter."""
    kitaplar = [
        {
            "sira": i,
            "id": "book%d" % i,
            "ad": "Unite %d - Ornek Kitap Adi Uzunca Yazilmis Hali" % i,
            "sayfa": "1/172",
            "toplamSayfa": 172,
            "canvasDolu": 0.81,
            "canvasRenk": 4213,
            "thumbOK": 7,
            "thumbBoyut": 96,
            "ekran": "72379-k%02d" % i,
            "ekranBayt": 2003145 + i,
            "ilkSayfada": True,
            "ilkSayfaVar": True,
            "thumbVar": True,
            "tekSayfa": False,
            "modal": None,
            "seritAnahtari": None,
            "atlandi": [],
            "menuAdi": "Unite %d - Ornek Kitap Adi Uzunca Yazilmis Hali (Maarif Model)" % i,
            "sonuc": "GECTI",
            "sn": 11.2,
        }
        for i in range(1, kitap_sayisi + 1)
    ]
    kayit = {
        "bookId": "72379",
        "baslik": "Lingoland Grade 3 - Maarif Model",
        "kitaplar": kitaplar,
        "gecenKitap": kitap_sayisi,
        "toplamKitap": kitap_sayisi,
        "sonuc": "GECTI",
        "kaldirma": "TASINDI",
    }
    govde = json.dumps(kayit, ensure_ascii=False)
    if kitap_sayisi >= 7:
        # Sozlesme: gercek arizada JSON'un KENDISI 3000 karakteri asiyordu; kuyruk
        # kirpmasi isareti degil, JSON'un ta kendisini ortadan kesiyordu.
        assert len(govde) > 3000, "fixture bozuk: 7 kitapta JSON 3000'i asmali (%d)" % len(govde)
    log = "\n".join("[kopru] adim %d tamam" % i for i in range(40))
    return log + "\nJSON>>>" + govde + "\n"


class AyiklamaTest(unittest.TestCase):
    def test_kucuk_json_ayiklanir(self):
        d = kosu.ciktidan_json(sahte_kapi_ciktisi(1))
        self.assertIsNotNone(d)
        self.assertEqual(d["sonuc"], "GECTI")
        self.assertEqual(d["toplamKitap"], 1)

    def test_buyuk_json_ayiklanir_yedi_kitap(self):
        """72379/72380 senaryosu: JSON 3000 karakteri ASIYOR, yine de ayiklanmali."""
        out = sahte_kapi_ciktisi(7)
        self.assertGreater(len(out), 3000, "test kurgusu bozuk: cikti 3000'i asmali")
        d = kosu.ciktidan_json(out)
        self.assertIsNotNone(d, "buyuk paket JSON'u ayiklanamadi — kirpma tuzagi geri geldi")
        self.assertEqual(d["gecenKitap"], 7)
        self.assertEqual(d["sonuc"], "GECTI")

    def test_eski_kirpma_davranisi_buyuk_pakette_kaniti_yok_ederdi(self):
        """Regresyonun KENDISINI cakar: son 3000 karakter alinirsa isaret kaybolur.
        Bu test gecmezse kirpma yeniden yapiliyor demektir."""
        out = sahte_kapi_ciktisi(7)
        self.assertIsNotNone(kosu.ciktidan_json(out))
        self.assertIsNone(
            kosu.ciktidan_json(out[-3000:]),
            "kurgu bozuk: 3000 karakterlik kuyruk isareti hala iceriyor",
        )

    def test_kirpma_yanliligi_kitap_sayisiyla_artar(self):
        """Kucuk paket kirpilsa da kurtulur, buyuk paket kurtulmaz — yanliligin yonu."""
        self.assertIsNotNone(kosu.ciktidan_json(sahte_kapi_ciktisi(1)[-3000:]))
        self.assertIsNone(kosu.ciktidan_json(sahte_kapi_ciktisi(7)[-3000:]))

    def test_isaret_yoksa_none(self):
        self.assertIsNone(kosu.ciktidan_json('{"sonuc": "GECTI"}'))

    def test_bozuk_json_istisna_atmaz_none_doner(self):
        self.assertIsNone(kosu.ciktidan_json("JSON>>>{bu gecerli json degil}"))

    def test_bos_cikti_none(self):
        self.assertIsNone(kosu.ciktidan_json(""))

    def test_isaretten_sonra_suslu_parantez_yoksa_none(self):
        self.assertIsNone(kosu.ciktidan_json("JSON>>>hicbir sey"))

    def test_son_isaret_kazanir(self):
        """Ayni kosuda iki kez yazilmissa (yeniden deneme) SONUNCUSU gecerlidir."""
        out = 'JSON>>>{"sonuc": "KALDI", "deneme": 1}\nJSON>>>{"sonuc": "GECTI", "deneme": 2}'
        d = kosu.ciktidan_json(out)
        self.assertEqual(d["deneme"], 2)
        self.assertEqual(d["sonuc"], "GECTI")

    def test_json_sonrasi_log_satirlari_ayiklamaya_zarar_vermez(self):
        out = sahte_kapi_ciktisi(5) + "\n[kopru] baglanti kapandi\n[kopru] cikis 0\n"
        d = kosu.ciktidan_json(out)
        self.assertIsNotNone(d)
        self.assertEqual(d["toplamKitap"], 5)



class TekAyiklamaNoktasiTest(unittest.TestCase):
    """Cagiranlar kendi ayiklamasini YAPMAMALI.

    SINIR: bu testler KAYNAK METNI tarar, davranisi degil — `dongu.py`/`tekrar.py`
    modul seviyesinde is kosturdugu icin import edilemez. Davranis kanitini yukaridaki
    AyiklamaTest verir; buradaki testler yalniz "cagiran yeniden kendi regex'ini yazdi"
    geriletmesini yakalar. Neden gerekli: 2026-09-22'de kosu.py duzeltildi ama iki
    cagiran kendi `re.search(r"JSON>>>(\\{.*\\})")` kopyasiyla (DOTALL yok) kaldi.
    """

    def _oku(self, ad):
        yol = os.path.join(os.path.dirname(os.path.abspath(__file__)), ad)
        return open(yol, encoding="utf-8").read()

    def test_cagiranlar_tek_noktayi_kullanir(self):
        for ad in ("dongu.py", "tekrar.py"):
            s = self._oku(ad)
            self.assertIn("from kosu import ciktidan_json", s,
                          "%s tek ayiklama noktasini kullanmiyor" % ad)
            self.assertIn("ciktidan_json(out)", s, "%s ayiklamayi cagirmiyor" % ad)

    def test_cagiranlarda_kendi_json_regexi_kalmadi(self):
        for ad in ("dongu.py", "tekrar.py"):
            kod = "\n".join(l for l in self._oku(ad).split("\n")
                            if not l.lstrip().startswith("#"))
            self.assertNotIn('re.search(r"JSON>>>', kod,
                             "%s yine kendi ayiklamasini yapiyor" % ad)
            self.assertNotIn('re.match(r"(?s)', kod,
                             "%s yine kendi ayiklamasini yapiyor" % ad)

if __name__ == "__main__":
    unittest.main(verbosity=2)
