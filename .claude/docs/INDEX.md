# Docs Index

Yeni okuyan/ajan önce `.claude/CLAUDE.md`'yi okur; buradaki dosyalar yalnız
CLAUDE.md'nin pointer verdiği yerlerde ihtiyaç anında açılır.

| Dosya | Konu | Durum | Ne zaman oku |
|---|---|---|---|
| `sozlesme.md` | Proje sözleşmesi — amaç, işlevler, ekranlar, veri/limitler, non-goal'lar | TASLAK | Proje kapsamı/sınırları netleşmeden büyük değişiklik öncesi |
| `gotchas.md` | Detaylı tuzak defteri — K17/K18, başsız kabul, Pardus disk kapısı, kurulum bilgilendirme, Windows kapanmama diyaloğu, Electron verimliliği, kapı bayrakları, XML dayanıklılık, 0 bayt flexibleItems, main.js şablon sözdizimi, SET kökü ezilme teşhisi | LIVE | Bir gotcha CLAUDE.md'de yalnız pointer olarak görünüyorsa, tam metin gerektiğinde |
| `set-paketi-know-how.md` | SET paketi (alt-kitap dizinli) K1-K16 kusur/düzeltme tablosu + yeni platform/adım checklist'i | LIVE | SET'e dokunan HERHANGİ değişiklikten önce |
| `windows-imza-bekliyor-tasarimi.md` | Windows "imza bekliyor" kipi (yuva yokken üret+kabul+hazır kuyruk), imza bekçisi, book-update tutma (hold) değişikliği önerisi | LIVE (sunucu kısmı ÖNERİ) | Windows şeridi/imza/bekçi değişikliğinden ya da book-update `/release` işinden önce |
| `flashy-tema-offline.md` | Flashy setleri offline kök menüsü = Worker `web-proxy-modern` teması aynen; ağ bağımlılığı → yerel tablo, bookN kitap bağlantısı, menü sözleşmesi uyumu, kurum 310 kanıtı + motorun kurum/logo okuduğu 4 nokta | LIVE (dal flashy-tema-20261002) | Web-Z tema kabuğu / Flashy offline paket / index üreteci kök kancası işinden önce |
| `kitap-kaynak-sozlesmesi.md` | Kitap kaynağı sözleşmesi — build klasörü nereden/nasıl kurulur, S0-S3 kaynak merdiveni, İmpark-dışı yayınevi kapısı, S1 kimlik toleransı | TASLAK | Kaynak/merdiven/İmpark-kaynak davranışına dokunmadan önce |
| `kitap-guncelleme-sozlesmesi.md` | SET güncelleme kanalı sözleşmesi (exe tarafı) — kimlik, uç noktalar, kapılar, G yayın aracı + istemci (Win/mac/Android), set üyelik eki, ProBook G ölçüm yöntemi | TASLAK | G kanalı veya çalışma-anı güncelleme davranışına dokunmadan önce |
| `index-ureteci-tasarimi.md` | Index üreteci — kaynaksız setlerin build.zip'i (Web-Z listesi + ZKitapZipH + arşiv motoru), tek-motor/bookN düzeni, aktivasyon kancası, yazma kapısı tek motor kuralı, r2-kur bağlantısı | TASARIM + PROTOTİP (dal `index-ureteci-20261002`, merge yok) | Kaynaksız set üretimine ya da yazma kapısının tek motor kuralına dokunmadan önce |
| `windows-paketleme-sozlesmesi.md` | Windows paketleme sözleşmesi — NSIS SET paketi + imza (Authenticode) TEK kaynak | ONAYLI (Nadir, 2026-09-26) | Windows paketleme/imza değişikliğinden önce |
| `platform-kanallari-sozlesmesi.md` | Platform kanalları sözleşmesi — macOS dmg, Android apk, Pardus .impark güncellik/kanal kuralları | TASLAK | Bu üç platformun güncelleme kanalına dokunmadan önce |
| `saglik-kimlik-recetesi.md` | Sağlık ucu → kimlik kontrolü reçetesi — `run-agent.sh`'a uygulanacak env kapı listesi (UYGULANMADI, reçete) | PARTIAL (reçete, uygulanmadı) | `run-agent.sh` kapı bayraklarını gözden geçirirken |
| `set-exe-uretim-defteri.md` | SET güncelleme kanallı Windows exe üretim defteri — adım adım ilk üretim tarifi | LIVE | Yeni bir set güncelleme kanallı Windows exe üretirken |
| `uctan-uca-saglik-sozlesmesi.md` | Uçtan uca sağlık testi sözleşmesi — kalıcı sağlık testi + demo paket kararı | TASLAK | Kalıcı sağlık testi altyapısına dokunmadan önce |
| `acik-kusurlar.md` | Açık kusurlar / karar bekleyenler — G sürüm ad alanı çakışması (Nadir kararı bekliyor), canli-aday'da kalıp agent-mode'a birleşmemiş düzeltmeler | LIVE | Yeni iş almadan önce hangi kararların açık olduğunu görmek için |
| `g-yayin-r2-yol-tasarimi.md` | G yayını R2 yol tasarımı (API/presign kodu yok, geçiş aracı tasarımı) | TASLAK/TASARIM | G yayınının R2 depolama yoluna dokunmadan önce |
| `pardus-seridi-probook-plani-2026-09-24.md` | Pardus paketlemeyi ProBook'a taşıma planı | PLAN: TASLAK | Pardus üretim şeridini değiştirmeden önce |
| `tek-kabuk-ve-guncelleme-plani-2026-09-24.md` | Tek kabuk + içerik güncellemesi planı (tespit raporlarına dayalı) | PLAN: TASLAK | Kabuk/içerik güncelleme mimarisini değiştirmeden önce |
| `windows-uretim-metodu-karar-2026-09-25.md` | Windows exe üretim metodu karar belgesi — mac/android/pardus kaynağını da etkileyen üç bağlı karar | KARAR: BEKLİYOR (Nadir) | Windows üretim metodunu/kaynağını değiştirmeden önce |
| `yukleyici-arastirma-2026-09-18.md` | Kendi yükleyicimiz — 8 paralel araştırma ajanının sentezi + karar taslağı | OBSOLETE (araştırma sentezi; sonraki sözleşmeler bunun yerini aldı) | Yalnız o dönemki karar gerekçesini ararken |
| `karar-defteri-2026-09-26.md` | Karar defteri — yedi hat sözleşmelerinin 2026-09-26 açık karar özeti | LIVE | Bugünün sözleşme durumunu doğrularken |
| `changelog.md` | Değişiklik geçmişi | LIVE | Geçmiş karar/karşılaştırma gerektiğinde |
| `deploy.md` | srv21 dağıtım kuralları | LIVE | Deploy öncesi |
| `devam-notu-2026-09-20.md` | 2026-09-20 ara verme notu — Mac kapağı kapanırken güvenli duruş kaydı | OBSOLETE (tarihli ara-verme notu; iş o tarihten çok ileri gitti, günceli `karar-defteri-2026-09-26.md` + sözleşmeler) | Yalnız o oturumun tam bağlamı gerekirse |
| `paket-guncelleme-plani-2026-09-20.md` | Paket güncelleme planı — "aç, arkada güncelle, göz kırp" | OBSOLETE (dosya içindeki "TASLAK — Nadir kararı bekliyor" ARTIK YANLIŞ: konu G kanalı olarak `kitap-guncelleme-sozlesmesi.md`'de TASLAK/uygulama durumuyla devam etti ve ondan sonra kısmen canlıya alındı — bu dosya kararı değil, o tarihteki ilk taslağı gösterir) | Yalnız fikrin ilk taslak halini ararken |
| `arastirma/aktivasyon-windows-testi-2026-09-26.md` | Aktivasyon kodlu Windows paketi testi — NSIS aktivasyon akışının gerçek testi | LIVE | Windows aktivasyon akışına dokunmadan önce |
| `arastirma/imza-yuvasi-gercek-kosu-2026-09-26.md` | İmza yuvası gerçek koşu kanıtı (66902) | LIVE | Windows imza yuvası davranışını doğrularken |
| `arastirma/mobil-zip-kaynak-olcumu-2026-09-26.md` | Mobil zip'ten build klasörü ölçüm raporu — "m-" adı doğrulaması | LIVE | Mobil/zip kaynak adlandırma/ölçümüne dokunmadan önce |
| `arastirma/platform-kanallari-kanit-20260926.md` | Platform kanalları sözleşmesinin kanıt ayrıntısı (150 satıra indirilirken ayrılan kanıt) | LIVE | `platform-kanallari-sozlesmesi.md` kısaltılmış bir maddenin kanıtını ararken |
