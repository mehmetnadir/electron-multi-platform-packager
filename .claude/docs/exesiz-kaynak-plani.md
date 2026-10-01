# Exe'siz kaynak planı — `[PLAN: TASLAK]` (Nadir onayı bekliyor)

> Karar (Nadir 01.10): geçiş dönemi bitti — İmpark exe'si HİÇBİR koşulda indirilmez (ne Windows
> passthrough ne paket kaynağı). Panelde Yenile → Web-Z'de tanımlı (panel set listesi) kitapların
> içeriği İmpark'tan çekilir → TEK build kurulur → dört platform o build'den üretilir (Windows bizim
> NSIS + İmpark imza kuyruğu) → build R2'ye son 2 sürümden biri olarak yedeklenir.
> Kaynak araştırmaları (01.10, salt okuma): scratchpad `exesiz/paketleyici.md`, `exesiz/book-update.md`.

## Bugün (01.10 ölçümü)
| Parça | Durum |
|---|---|
| Kaynak | Arşivli 17/57 kitapta Üretim Masası build zip'i (Mac `~/.empp-agent/kaynak-arsivi`, 25.09) — exe indirilmez; 40 kitapta İmpark exe'si indirilir |
| Kitap içeriği | İçerik merdiveni (S0+S1) ZKitapZipH'den tazeler; set listesi eki eksik kitabı ekler (01.10'dan beri claim alanıyla) |
| Build | Her platform kendi kopyasında ayrı tazeler (4×); tazelenen build hiçbir yere geri yazılmaz |
| R2 yedeği | YOK (sözleşmede var, kod yok; `cdn…/kaynak/<id>/surumler.json` 404) |
| Windows | 55/57 satır passthrough (srv21 İmpark exe'sini aynalar); 2 satır (45482, 45549) bizim hat |
| Sunucu kapısı | Köprüde exe yoksa claim 204 — exe'siz kitap hiç kiralanmaz (`tek-kuyruk` §2.5) |

## İş sırası (her adım kapı + test + kanıt; deploy adım adım)
1. **Sözleşme önce** — `tek-kuyruk-sozlesmesi.md` §2.5, book-update `sozlesme.md` "İş:2", windows sözleşmesi
   "Kaynak" bölümü: "geçiş bitti" maddesi. Onaylanmadan kod yok.
2. **Windows passthrough kapanır** — tüm windows satırları `build`; yeni satır varsayılanı (book-update
   `4e5661b`, hazır). İşçinin windows dalı İmpark'a hiç gitmez.
3. **Tek build + R2 yedeği** — Yenile'de ilk kiralanan platform build'i kurar (arşiv + merdiven + set eki),
   R2'ye `kaynak/<id>/<sürüm>/build.zip` + `surumler.json` (son 2) yazar; diğer platformlar aynı sürümü
   R2'den alır. Mac arşivi R2'nin önbelleği olur.
4. **Runner'da exe kapanır** — arşiv/R2 build yoksa iş exe'ye düşmez: görünür ret + bildirim
   (`parseNextJob` downloadUrl'süz işi kabul eder; HEAD/ısıtıcı/hazır pardus dalı kapanır). Sunucu kapısı
   "köprüde exe" yerine "R2 build ya da liste var mı"ya döner.
5. **Arşivsiz 40 kitap** — build'i exe'siz kurma: kabuk (motor + okuyucu iskeleti) bizim deposundan,
   kitaplar listeden ZKitapZipH ile, set menüsü listeden. İlk kurulum Üretim Masası'nda, sonra 3. adım.
6. **Güncellik tetiği exe'den içerik sürümüne** — version-refresh/guardian İmpark exe'sine HEAD atmaz;
   her kitabın içerik sürümünü (`GetKitapGuncellemeBilgi`, merdivenin S0 sorusu) düzenli sorar, bir kitap
   ilerlediyse onu içeren setler yeniden kuyruğa girer. Sürüm artmadan içerik değişimi için S2 (dosya
   farkı) ayrı kalem. Bugün: üretim anında yeni sürüm İNDİRİLİR (01.10 45549: 25775 v23→v27), ama
   üretimi tetikleyen exe değişimidir — exe kapanınca tetik de kapanır.
7. **Tek kitap yapılı setler (45448/45472/45477/45480)** — karar: bookN'li set kabuğuna taşınsın mı?

## Nadir'den karar
- (a) Arşivsiz kitaplar 5. adım bitene kadar: üretim BEKLESİN mi (önerim: evet, İmpark exe'si yayında kalır)?
- (b) Güncellik ölçümü İmpark origin'e HEAD atıyor (version-refresh/guardian): "exe indirme yok" mu,
  "İmpark'a hiç sorma" mı? (Kitap içeriği zaten İmpark'tan çekiliyor → önerim: exe'ye sorma, içerik API'sine sor.)
- (c) Tek kitap yapılı 4 set.

Tahmin (ajan raporları, ölçüm değil): 2-4. adımlar ~4-6 G; 5. adım ~6-9 G; 6. adım 3-5 G.
