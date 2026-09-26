# Karar defteri — yedi hat sözleşmeleri (2026-09-26)

> Tek yerde. **"Varsayılan"** sütunu, sen aksini yazmazsan taslak sözleşmeye işlenen öneri. **Senin cevabın şart**
> olanlar yalnız deploy / kimlik bilgisi / geri alınamaz dış sistem işi (en üstteki blok). Diğerlerinde itirazın
> varsa satır numarasını yazman yeter; sözleşmeler ONAYLI'ya ancak sen dersen geçer.

## A. Senin cevabın şart (deploy · kimlik · dış sistem)
| # | Karar | Neden şimdi | Önerim |
|---|---|---|---|
| A1 | **45550 + 45551 indirmeden kalksın mı?** Pasif setler. Windows exe'si 25.09 ölçümünde 59834 Maarif içeriğiydi; mac/android paketlerinde kitap klasörleri HİÇ yok (26.09 ölçüm, APK 18,5 MB); kaynak exe artık 75 MB ince/stub | İndiren öğretmen yanlış ya da boş kitap alıyor; yeniden üretim de boş çıkar (kabul RED) | Evet: indirme linkini kapat (R2 dosyası Silinecekler'e değil `_pasif/`'e taşınır) |
| A2 | **`/go/<kod>/apk` 404** (3 kitapta ölçüldü) — düzeltme kodu yerelde, canlıda değil | Paylaşılan APK linki boş dönüyor | book-update deploy onayı; `apk` → android yönlendirmesi + bekçi |
| A3 | **5 Windows kitap 19.09'dan beri bayat exe veriyor** (45448 · 45487 · 45449 · 45792 · 45100; bekçi `teslim_bayat`) | Bekçi 7 gündür kırmızı (güven kapısı aşıldı) | İmpark'ta exe yeniden üretilsin (exe-create) + passthrough yeniden kuyruk; onay senin |
| A4 | **srv21 işçisi `build_method=build` tanısın** | Bizim imzalı exe'lerimizin yayını bunu bekliyor | Kod + deploy onayı |
| A5 | **Üretim ed25519 anahtarı + yedeği** | Windows SET kanalı ve toplu üretim bunu bekliyor | Anahtarı ben üreteyim, yedeği Anahtar Zinciri güvenli notu + ikinci kopya senin seçtiğin yer |
| A6 | **Pipeline DB parolası** bugün iki kez ajan çıktısına düştü (kök kapandı: betiklerde parola yok) | Sızmış parola hâlâ geçerli | Parola değişsin + salt-okur kullanıcı |
| A7 | srv21'de satır içi parola taşıyan 7 betik (site-monitoring, mailjet, flashy-kv…) | Aynı sızıntı sınıfı | Aynı yöntemle cnf dosyasına geçireyim |

## B. Kitap kaynağı (`kitap-kaynak-sozlesmesi.md`)
| # | Karar | Varsayılan |
|---|---|---|
| B1 | Yeni sürüm bir alt ağacı düşürmüşse (58237 v14) | Eski katmanı koru + bildir |
| B2 | `flexibleItems.json` kaynağı | Kabukla birlikte exe'den; panel verisinden kurulabilirliği ölçülür |
| B3 | Set sürümü | Panelin set paket sürüm kodu; kitap sürümleri `empp-set.json`'da |
| B4 | Kod nerede | Masa tetikler, packager `kaynak` modülü kurar; srv21 aynı kodu koşar |

## C. Platform kanalları (`platform-kanallari-sozlesmesi.md`) + güncellik (`guncellik-bekci-sozlesmesi.md`)
| # | Karar | Varsayılan |
|---|---|---|
| C1 | Kabulden geçen paket onaysız yayına çıksın mı | Evet; ilk 20 RED elle doğrulanana dek her RED bildirim. Windows imzalı exe ilk 10 sette elle "Yayına al" |
| C2 | Önceki paket geri dönüş için saklansın mı | `softwares/<id>/_onceki/` altında son 1 sürüm (taşıma, silme yok) |
| C3 | Tüm platformlar hep artan sürüm (`2.<panel>.<sayaç>`) | Evet (Pardus kurulum kuralı bugün "farklıysa kur"a çekildi — `cd97045`) |
| C4 | İçerik güncelleme kanalı K mac/Pardus'ta | Önce Pardus (ProBook geçti), mac imzalı derlemede ölçülünce |
| C5 | Android artan versionCode + yedekli imza anahtarı | Evet; anahtar yedeği A5 ile aynı yer |
| C6 | srv21 Pardus yedek yolu | Hayır; ProBook + Mac Docker |
| C7 | Kabuldeki "aktivasyonlu" işareti | keypanel.db (başlıktan tahmin değil) |
| C8 | Bekçi alarm üst kademesi | Tur sayısı değil süre: 24 saat |
| C9 | Pasif kitaplar bekçi kapsamı | Kapsam dışı (A1 ile birlikte) |
| C10 | CMS/WP sayfalarındaki indirme linkleri | Masa listesini tutar, her gün yoklanır |
| C11 | Git dışındaki Mac gözcüsü | Depoya alınır, kaynak bekçisiyle birleşir |

## D. Web-Z v2 (`book-update/.claude/docs/webz-v2-sozlesmesi.md`)
| # | Karar | Varsayılan |
|---|---|---|
| D1 | Web motoru R2'de sürümlü kopya (`webz/_motor/<md5>/`) | Evet (yoksa İmpark bağımlılığı sürer) |
| D2 | Sayfa WebP | Kayıpsız (−%41; q60 −%57 ama q82'de pikselleşme görülmüştü) |
| D3 | YDS dışı 11 set / 29 kitap | Önce yalnız YDS; GOLD ELT `goldelt-media`, Flashy/Cambridge yeni kova; `akillitahtalar` asla |
| D4 | v2'de R2'de olmayan dosya | Yalnız kanaryada proxy'den, görünür sayaçla; sonra kapanır, alarm |
| D5 | Aktivasyonlu 11 set (240 kitap) | Son dalga, aracı uç canlı + sayım sonrası |
| D6 | Kanarya seti | k08ou (SM2 Set 59835) |
| D7 | v2 üretim yeri | Masa tetikler, Mac paketleyici üretir, yükleme ofiste sıralı |
| D8 | Eski sürüm kuralı | Kaynak arşiviyle aynı: son 2, üçüncüsü `_eski/` 60 gün |

## E. Masa (`uretim-masasi-mac/docs/sozlesmeler/12-yayin-hatti.md`)
| # | Karar | Varsayılan |
|---|---|---|
| E1 | Aktivasyon masada | Salt okuma rozeti + "keypanel'de aç"; kod yönetimi keypanel'de |
| E2 | Toplu imza masadan | Evet; masa betiği arka planda koşturur, izler |
| E3 | Üst bant | Tüm ekranlar |
| E4 | Kodlama sırası | kabul sonucu + build_method → İmza kuyruğu → Kaynak kartı → Güncellik → Aktivasyon → Web-Z v2 anahtarı |

## F. Windows (ONAYLI sözleşmenin kapanışı)
- Aktivasyon testi: `~/vm-kapi/MARVEL11-AKTIVASYON-TEST-*` — **internet açık** VM'de kod ekranı + kalıcılık + B-üstüne-A.
- A4 + A5 kapanınca toplu üretim → yükle → sıralı imza → indir/doğrula → yayınla başlar.
