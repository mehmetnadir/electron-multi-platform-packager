#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""kabul.py grup karti sayim ve acma mantigi icin saf testler (stdlib unittest)."""
import os, sys, unittest

os.environ.setdefault("LOCALAPPDATA", "C:\\Users\\test\\AppData\\Local")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kabul


class GrupKartiSayimTest(unittest.TestCase):

    def test_grup_etiketinden_4_okunur(self):
        """aria-label, badgeText veya metin icinden 4 okunur."""
        self.assertEqual(kabul.grup_adet_coz(aria_label="Fen Bilimleri serisi, 4 kitap"), 4)
        self.assertEqual(kabul.grup_adet_coz(badge_text="4 kitap"), 4)
        self.assertEqual(kabul.grup_adet_coz(metin="Türkçe serisi\n4 kitap"), 4)

    def test_bir_grup_beklenen_4_sayim_gecer(self):
        """1 grup karti (4 kitap) -> toplam sayim 4; 1 grup (4) + 1 normal (1) -> 5."""
        kartlar_grup = [
            {"seri": True, "ariaLabel": "Matematik serisi, 4 kitap", "badgeText": "4 kitap"}
        ]
        self.assertEqual(kabul.menu_kitap_sayisi_hesapla(kartlar_grup), 4)

        kartlar_karma = [
            {"seri": True, "ariaLabel": "Matematik serisi, 4 kitap"},
            {"seri": False, "ad": "Tek Kitap"}
        ]
        self.assertEqual(kabul.menu_kitap_sayisi_hesapla(kartlar_karma), 5)

    def test_grupsuz_eski_davranis_ayni(self):
        """Grupsuz normal kartlar eski davranisla birebir ayni sayilir."""
        kartlar = [
            {"seri": False, "ad": "Kitap 1"},
            {"seri": False, "ad": "Kitap 2"},
            {"seri": False, "ad": "Kitap 3"}
        ]
        self.assertEqual(kabul.menu_kitap_sayisi_hesapla(kartlar), 3)

    def test_grup_acma_bekleme_yapraklari_dondurur(self):
        """grup_ac_bekle, grup acilinca yaprak kartlari dondurur, acilmazsa bos doner."""
        durum = {"tiklandi": False, "menu": []}
        def sahte_cagirici(islem, arg):
            if islem == "tikla":
                durum["tiklandi"] = True
                durum["menu"] = [{"seri": False, "id": "book1"}]
            elif islem == "menu_al":
                return durum["menu"]
            elif islem == "bekle":
                pass

        grup_kart = {"seri": True, "ad": "Seri 1"}
        res = kabul.grup_ac_bekle(sahte_cagirici, grup_kart, tavan_sn=1)
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["id"], "book1")


if __name__ == "__main__":
    unittest.main()
