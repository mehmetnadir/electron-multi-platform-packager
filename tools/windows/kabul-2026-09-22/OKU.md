# Windows kabul kapısı — 2026-09-22 gecesi sürümü

Bu dizin, 21/22 Eylül gecesi Nadir'in talimatıyla koşulan kabul turunda kullanılan
**canlı kapı**dır. Yanındaki `tools/windows/kabul/` dizini 03:06'daki hâli taşıyor;
o saatten sonra bulunan **altı davranışsal kusur** yalnız burada düzeltilmiştir.

## Neden ayrı dizin (bilinçli, geçici)

`kabul/` içindeki `kabul_test.py` (44 test) altı SAF yardımcı fonksiyonu test ediyor
(`serit_etiket_mi` vb.). Bu gecenin sürümünde o mantığın çoğu, ölçüm doğruluğu için
tarayıcıda koşan JS bloklarının içine taşındı — dolayısıyla eski test dosyası bu
sürümle ÇALIŞMAZ (44/44 `AttributeError`). Eski kapıyı ezip testi kırmak yerine
iki sürüm yan yana bırakıldı ve karar Nadir'e bırakıldı.

**Karar gerekiyor:** (a) bu sürüm `kabul/`'e taşınıp `kabul_test.py` yeni yapıya
uyarlanacak mı, (b) saf fonksiyonlar geri çıkarılıp test korunacak mı, yoksa
(c) iki sürüm ayrı mı kalacak? (c) uzun vadede **tehlikeli** — bu depoda
"iki kopya, biri ölü" tuzağının emsali var.

## Bu sürümdeki altı düzeltme (hepsi ölçümle kanıtlandı)

| # | Kusur | Kanıt |
|---|---|---|
| 1 | Şerit düğmesi etiketi tek varyant sanılıyordu ("Sayfalar" vs "Önizleme") | 74427/74430 sağlamken "thumb yok" dendi |
| 2 | Kapsayıcı tavanı yoktu — küçük ikondan sayfa boyu sarmalayıcıya çıkılıyordu | 45792'de etiket telif dipnotu oldu, tıklama arka plana düştü |
| 3 | Aktivasyon modali görülmüyordu (`jsj()` zaten dict döndürürken üstüne `json.loads` sarılmıştı → TypeError sessiz yutuluyordu) | 45469 sahte KALDI |
| 4 | 42 adımlık tanıtım turu örtüsü tıklamaları yutuyordu; "Atla" yalnız açılışta yoklanıyordu | `74404-k02.png` modal ekranda, kayıt `atlandi:[]`, süre 125,8 sn |
| 5 | Menü geç render ediliyor, tek sefer 10 sn beklenip ölçülüyordu → sessizce "tek kitap" varyantına düşülüyordu | `60016-menu.png`'de 5 kart var, kayıt `menuKitapSayisi:0` |
| 6 | **Aynı hedef N kez tıklanıp N kitap sayılıyordu** | 45695'in 4 kitabının kanıtı BİREBİR aynı, PNG'ler md5-eşit → "GEÇTİ 4/4" sahte yeşildi |

6 numaranın yanlış pozitif denetimi yapıldı: kural geçmiş veriye uygulandığında
çok kitaplı 13 "geçti" kaydının yalnız 2'si takıldı (45695, 45704).

## `kosu.py` bilerek KOPYALANMADI

Depodaki `kosu.py` köprü IP'sini çalışma anında çözüyor (`kopru_adresi()` +
`kabul_kopyala()`); gece koşusunda kullanılan sürüm ise sabit bir Tailscale IP'sine
güveniyor. **Depodaki daha doğru** — o yüzden bu dizine alınmadı. Birleştirme
yapılırsa `kosu.py` deponunki kalmalı.
