# Windows Kabul Kapısı

Bu dizin, `windows-kasa` VM'inde koşan Windows kabul kapısının kalıcı yerleşimidir.
Pardus tarafındaki karşılığı `tools/pardus/probook-kabul.sh` — aynı sözlüğü kullanır
(**GECTI**/**KALDI**, kanıt dosyası, "asla `rm`, taşı").

Kaynak (2026-09-22 gecesi, `windows-kasa` üzerinde 47 paketlik gerçek koşuda kullanıldı;
kapı koşu SIRASINDA iki kez sıkılaştırıldı — `ilkSayfada` şartı + tek sayfa muafiyeti —
ve bir kez genişletildi — şerit etiketi tema başına değişiyor. Davranış bu taşımada
DEĞİŞTİRİLMEDİ, kaynağın kendisi senkronize edildi): `kabul.py`, `kosu.py`, `dongu.py`,
`tekrar.py`.

## Ne yapar

Dört betik, dört ayrı rol:

- **`kabul.py`** — asıl kapı, **`windows-kasa` VM'i içinde** (guest) koşar. Tek bir Windows
  paketi (.exe) için tam akış: indir → kur → aç (CDP ile) → menüdeki **her kitaba TIKLA** →
  her kitapta ilk sayfa + thumbnail KANITI topla → ekran görüntüsü gönder → paketi kaldır
  (kaldırıcı yoksa **taşı**, asla silme).
- **`kosu.py`** — Mac tarafında koşar, TEK paket için `kabul.py`'yi guest'e kopyalar,
  parametreleri (bookId, indirme URL'i, başlık) enjekte eder, `tools/windows/vm-kapi.js`
  üzerinden VM'de çalıştırır ve sonucu bekler.
- **`dongu.py`** — Mac tarafında koşar, `isler.json` içindeki paket listesini sırayla
  `kosu.py` ile geçirir. **Yeniden başlatılabilir**: zaten `GECTI` olan paketi tekrar
  koşmaz (sonuç JSONL'inden okur).
- **`tekrar.py`** — Mac tarafında koşar, ilk koşuda `KALDI` çıkan VEYA kapı henüz
  sıkılaştırılmadan/genişletilmeden ölçülmüş (bkz. `ZORUNLU_TEKRAR`) paketleri NİHAİ
  kapıyla yeniden koşar. Sonuç aynı `sonuclar.jsonl`'e **EKLENİR** (silinmez); ilk pas
  `sonuclar-1.pas.jsonl` olarak yedeklenir.

## Hangi kanıtı üretir

Her kitap için (`kabul.py` içinde `kitap_kanit()`):

- `thumbOK` — sayfa şeridinde yüklenmiş, benzer boyutlu thumbnail sayısı.
- `canvasDolu`, `canvasRenk` — ilk sayfa tuvalinin (`canvas.lower-canvas`) merkez
  bölgesinde dolu piksel sayısı ve farklı renk sayısı (boş/şeffaf tuvali GEÇTİ saymamak için).
- `ilkSayfada` (`ilk_sayfada_mi()`, saf fonksiyon) — sayfa göstergesi ("12/172" gibi)
  `1/` veya `1 /` ile başlıyor mu? Kitap 1. sayfada AÇILMAZ (ölçüldü: 12/172 ile açılıyor),
  seritteki ilk thumb'a tıklanıp 1'e gidilir.
- **Eşik** (`kanit_sonucu()`, saf fonksiyon, EN YENİ 02:42): `canvasDolu>50` **VE**
  `canvasRenk>1` **VE** (`toplamSayfa==1` **VEYA** `thumbOK>=3`) **VE** `ilkSayfada` →
  `GECTI`; biri eksikse `KALDI`. **Tek sayfa muafiyeti:** `toplamSayfa==1` ise thumb şartı
  muaf sayılır (1 sayfalık kitapçık/afişte şerit hiç oluşmaz — kanıt: 45538/book5,
  45540/book5) ve sonuç JSON'una `muafiyet: "TEK_SAYFA_THUMB_MUAF"` **açıkça** yazılır
  (sessiz geçiş YASAK).
- Her kitap için bir ekran görüntüsü (CDP `Page.captureScreenshot`) köprü sunucusuna
  POST edilir (`{bookId}-k{sira:02d}`); ayrıca paket açılışında bir MENÜ ekran görüntüsü
  (`{bookId}-menu`) — "pakette var ama menüde yok" sınıfı ancak menüye bakılarak kanıtlanır.
- Paket sonu raporu (`rapor-{bookId}`) JSON olarak köprüye POST edilir; ayrıca stdout'a
  `JSON>>>{...}` satırı basılır — `dongu.py` bunu regex ile ayıklar.

Paket sonucu: **tüm kitaplar GECTI ise paket GECTI, aksi halde KALDI.**

## Nasıl koşturulur

Tek paket (Mac'ten):
```bash
cd /Users/nadir/01dev/electron-multi-platform-packager
/usr/bin/python3 tools/windows/kabul/kosu.py <bookId> [zaman-asimi-sn]
```

Tüm liste sırayla (yeniden başlatılabilir):
```bash
/usr/bin/python3 tools/windows/kabul/dongu.py
```

### `isler.json` — çalışma listesi (script'in yanında olmalı)

`kosu.py` ve `dongu.py` her ikisi de kendi dizinlerinde (`SP`) bir `isler.json` arar.
Bu dosya **koda dahil değildir** — her koşunun kendi iş listesidir (o günkü paket
seti değişir), bu yüzden bilinçli olarak repoya committ EDİLMEDİ. Koşmadan önce, o
günün listesini bu dizine (`tools/windows/kabul/isler.json`) koy. Şema (liste elemanı):
```json
{"bookId": "74427", "baslik": "Flashy Grade 2", "yayinevi": "Flashy ELT",
 "url": "https://cdn.yayincilik.net/74427/...exe", "anahtar": "74427/...exe",
 "base": "https://cdn.yayincilik.net"}
```

### Çıktılar

- `dongu.py` sonuçları **kendi dizini altındaki** `kabul/sonuclar.jsonl` ve
  `kabul/dongu.log`'a yazar (`SP/kabul/...`). Bu betik artık `tools/windows/kabul/`
  içinde yaşadığı için gerçek yol `tools/windows/kabul/kabul/sonuclar.jsonl` olur —
  iç içe "kabul/kabul" görünmesi HATA DEĞİL, taşımadan önceki göreli-yol mantığının
  (davranış değiştirilmeden) doğal sonucudur.
- `kosu.py`, guest tarafına gönderilecek `wrap-{bookId}.ps1` dosyasını Mac'teki
  `~/vm-kapi/` dizinine yazar (guest bunu köprüden indirir).

### Köprü adresi (`EMPP_KOPRU_ADRES`) — sabit IP GÖMÜLMEZ

`kabul.py` (guest içinde) sonuçları/ekran görüntülerini bu Mac'e (köprü) POST eder;
`kosu.py` (Mac'te), `kabul.py`'yi guest'e kopyalarken dosyadaki `MACIP` satırını
**çalışma-anı adresiyle** yeniden yazar (`kabul_kopyala()`):

1. Önce `EMPP_KOPRU_ADRES` ortam değişkeni okunur.
2. Yoksa `tailscale ip -4` ile çözülür.
3. `kabul.py` dosyasındaki `MACIP = "..."` satırı bu değerle değiştirilip guest'e
   (`~/vm-kapi/kabul.py`) yazılır.

`kabul.py` içindeki sabit `MACIP` değeri sadece **doğrudan/elle çalıştırma** için bir
yedektir — normal akışta her koşuda üzerine yazılır, koda kalıcı IP gömülmüş sayılmaz.
Mac'in Tailscale adresi değişirse hiçbir dosya elle düzenlenmez.

## Ölçülmüş tuzaklar (2026-09-22, `windows-kasa` — hepsi yanlış alarm üretmişti, tekrar etme)

1. **İKİ PAKET AİLESİ:** `nsis` (bizim Electron kurulumumuz, `/S` ile
   `%LOCALAPPDATA%\Programs`) ve `sfx` (yayıncının WinRAR-SFX'i, argümansız çalışır,
   `C:\DijiTap\<alan>\<Paket>\ZKitap.exe`). SFX'e `/S` vermek 1 sn'de çıkış 0 döndürür
   ve HİÇBİR ŞEY kurmaz → sahte "KURULMADI".
2. **İKİ MENÜ VARYANTI:** A) `img.button[data-url]`  B) `div.book-item` +
   `img.book-cover-image` (React, onclick yok). Yalnız A'yı arayan kapı, B tipi seti
   "tek kitap" sanır.
3. **CDP HEDEFİ:** uygulama birden çok `page` hedefi açar; ilki boş belge olabilir.
   Hedef, BEKLENEN kurulum dizinine ait ve içeriği olan hedeftir.
4. **ESKİ SÜREÇ PORTU TUTAR:** önceki oturumdan kalan uygulama 9333'ü tutuyorsa kapı
   YANLIŞ uygulamayı ölçer (ölçüldü: SM3-v10-Maarif). Açılıştan önce TÜM uygulama
   süreçleri öldürülür.
5. **İLK SAYFA açılışta ÇİZİLMEZ:** sayfa şeridindeki ilk thumb'a tıklanmadan tuval
   şeffaftır. Bu kusur değil, açılış durumu. (tıklama öncesi dolu=0, sonrası dolu=2143.)
6. **THUMB KAYNAĞI DEĞİŞKEN:** bizde `blob:`, yayıncıda `file:`. Yalnız `blob:` arayan
   dedektör sağlam paketi "thumb yok" diye kaldırıyordu. Ölçüt: yüklenmiş + benzer
   boyutlu 3+ resim.
7. **'Atla' desenine 'x' EKLEME:** sayfa panelinin kapatma düğmesi de 'X' — kapı kendi
   kanıtını kapatır. Aynı tuzak sayfa şeridi (`JS_SERIT`) etiketi için de geçerlidir.
8. **GUEST STDOUT cp1254:** tek bir `✕` `UnicodeEncodeError` ile betiği düşürür →
   stdout UTF-8'e zorlanır (`sys.stdout.reconfigure`).
9. **GDI ekran yakalama** RDP oturumu kopukken "İşleyici geçersiz" verir; görüntü CDP
   `Page.captureScreenshot` ile alınır (oturumdan bağımsız çalışır).

### Koşu sırasında sıkılaştırılan/genişletilen ek gerçekler (02:42'ye kadar)

10. **ŞERİT ETİKETİ TEMAYA GÖRE DEĞİŞİR:** "Sayfalar"/"Pages" yanında "Önizleme"/"Preview"/
    "Küçük resim"/"Thumbnails" de olabilir (kanıt: 74405). Yalnız "sayfalar" arayan desen
    o kitaplarda şeridi hiç açamadı, sağlam paket "thumb yok" diye kaldı.
11. **ŞERİT ETİKETİ ÇOCUKSUZ DEĞİL:** ikon+metin sarmalayıcı olabilir — `children.length===0`
    süzgeci hiç eşleşmedi (74427/74430 sağlamken "thumb yok" diye kaldı). Ölçüt gevşetildi:
    `<=1` çocuk. Etiket bulunamazsa alt ortadaki katlanmış şerit tutamacına konumsal
    yedek tıklama yapılır (`JS_SERIT_TANI` de bulunamama durumunda aday dökümü basar).
12. **TEK SAYFALIK İÇERİK MUAFİYETİ:** 1 sayfalık kitapçık/afiş/çalışma kağıdında şerit hiç
    oluşmaz (kanıt: 45538/book5, 45540/book5 — `sayfa="1/1"`, canvas dolu/renkli,
    `thumbAday=0`). Thumb şartı bu durumda muaf, muafiyet JSON'a `muafiyet:
    "TEK_SAYFA_THUMB_MUAF"` olarak AÇIKÇA yazılır (sessiz geçiş YASAK).
13. **`ilkSayfada` ŞARTI:** kitap 12. sayfada açılıyordu; artık sayfa göstergesi `1/N`
    olana kadar seritteki ilk thumb'a tekrar tıklanır, GECTI için bu şart da aranır.
14. **MENÜ EKRANI + `menuAdlar`:** "pakette var ama menüde yok" sınıfı ancak menüye
    bakılarak kanıtlanır (kanıt: 60114 — paket 4 kitap asset'i içeriyor, menü 2 gösteriyor).

## Saf karar fonksiyonları (test edilebilir, I/O'suz)

Kapı büyük ölçüde I/O'ya bağımlı (Windows süreç yönetimi, CDP, dosya sistemi) ama karar
noktaları saf fonksiyona ayrıldı — `kabul_test.py` bunları doğrudan çağırır. İkisi
(`menu_varyant_sec`, `serit_etiket_mi`) tarayıcıda çalışan JS'in (`JS_MENU`, `JS_SERIT`)
Python AYNASIDIR — JS string'i değişmeden testte doğrulanamaz, mirror JS ile BİRLİKTE
güncellenir:

| Fonksiyon | Kural |
|---|---|
| `aile_imzadan(h: bytes)` | `Nullsoft` içeriyorsa `nsis`; `WinRAR`/`SFX` içeriyorsa `sfx`; yoksa `bilinmiyor` |
| `ilk_sayfada_mi(sayfa)` | Sayfa göstergesi `"1/"` veya `"1 /"` ile başlıyorsa `True` |
| `kanit_sonucu(thumbOK, canvasDolu, canvasRenk, toplamSayfa, ilkSayfada)` | `canvasDolu>50` VE `canvasRenk>1` VE (`toplamSayfa==1` VEYA `thumbOK>=3`) VE `ilkSayfada` → `GECTI`; `toplamSayfa==1` VE `GECTI` → `muafiyet="TEK_SAYFA_THUMB_MUAF"` |
| `menu_varyant_sec(a_var, b_var, c_var)` | `JS_MENU`'nun A→B→C öncelik sırasının Python aynası (`JS_MENU` string'inin kendisi DEĞİŞMEDİ) |
| `serit_etiket_mi(metin)` | `JS_SERIT`'teki etiket regex'inin Python aynası — Sayfalar/Pages/Önizleme/Preview/Küçük resim/Thumbnails eşleşir, Atla/Skip/X eşleşMEZ |
| `kaldirma_yontemi(uninstall_var: bool)` | `Uninstall*.exe` bulunduysa `"kaldirici"`, yoksa `"tasi"` — asla `"rm"` |

Test: `/usr/bin/python3 tools/windows/kabul/kabul_test.py -v` (stdlib `unittest`,
harici bağımlılık yok — `kabul.py`'nin `websocket` importu bu Mac'te kurulu
(`websocket-client`), test dosyası ayrıca `LOCALAPPDATA` ortam değişkenini import
patlamasın diye sahte bir değerle doldurur, gerçek testlerde KULLANILMAZ).

## `tools/pardus/probook-kabul.sh` ile ortak sözlük

| Kavram | Windows (`kabul.py`) | Pardus (`probook-kabul.sh`) |
|---|---|---|
| Başarı | `GECTI` | çıkış 0 |
| Başarısızlık | `KALDI` + `sebep` | çıkış !=0 + `RED: ...` |
| Kanıt | kitap başına ekran görüntüsü + thumb/canvas ölçümü | kök sayfa ekran görüntüsü + piksel sapması |
| Kaldırma | kaldırıcı varsa çalıştır, yoksa **TAŞI** (asla `rm`) | test öncesi mevcut kurulumu geçici olarak yeniden adlandır, sonunda geri koy |
