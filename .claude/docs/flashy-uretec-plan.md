# Flashy ELT özel arayüzle üretim — plan (06.10.2026)

> Nadir (06.10 12:20): *"Flashy için özel arayüzümüz olmalı ve üretmeliyiz. GOLD için şimdilik bir şey
> yapma."* Setler: 60114, 74404, 74427, 74428. Kova `akillitahtalar` (r2_config 51b354b7 "Impark R2",
> CDN `cdn.yayincilik.net`). Worker rotası `flashyelt.ndr.ist/*`. Hedef: 4 set × 4 platform
> (windows, pardus, mac, android), YDS sf425 kabuğu YOK, Flashy arayüzü VAR.
> Kapsam dışı: GOLD ELT (69588, 72411), G kanalı Flashy hedefi, canlı Web-Z kitap sayfası onarımı.
> Durum: TASLAK — şef onayı bekliyor. Kod değişikliği YOK.

## 1. Ana bulgu

Flashy özel arayüzü ZATEN VAR ve bugün 1 pakette uçtan uca geçti.

| Kanıt | Değer |
|---|---|
| Kabuk modülü | `src/agent/webz-tema-kabuk.js` (02.10), tema kopyası `src/agent/webz-tema/web-proxy-modern/` |
| Canlıyla parite (06.10 ölçüm) | `theme.js`, `theme.css`, `_design/components.js`, `scripts/library.js` sha256 canlı `qlc7p` ile AYNI (4/4) |
| Üreteç yayıncı tablosu | `src/agent/uretec-kaynak.js:47-62` `'flashy elt'` → kurum 310, tema `web-proxy-modern`, kalıp kurumu 60 |
| Kaynak build kanıtı | `kaynak_build_surumleri` id 80 (74404 2.0.10) ve 44 (74427 2.0.2): `"kurum":"310","kabuk":"tema:web-proxy-modern"` |
| 74404 mac (06.10 12:26) | başsız kabul GEÇTİ: menü kart 3/3, okuyucu 1.13.14 = kanonik, K4 3/3 güncel, noter + R2 yüklendi |
| Menü görüntüsü | `~/.empp-agent/kabul-kanit/74404-mac-20261006-122508/menu.png`: Flashy ELT logosu, Flashy kartları |

Sonuç: `uretec-kalip-yok` Flashy'nin değil, GOLD'un hatasıdır (`agent.log` 73677, 75940: "GOLD ELT").
Flashy'nin engelleri kabuk değil; kabul ve şerit halkalarıdır (bölüm 3).

## 2. Mevcut durum (06.10 12:26)

### 2a. Platform özeti (`pipeline_platform_summaries`)

| Set | Ad | windows | mac | pardus | android | Kaynak build |
|---|---|---|---|---|---|---|
| 60114 | Flashy Grade 5 Set (5 öğe: 3 kitap + Games + Extras) | completed (09.19, eski) | completed (09.17, eski) | queued | completed (09.13, eski) | YOK (istek 03.10, kayıt yok) |
| 74404 | Flashy Grade 6 - 2026-27 (3 kitap) | queued — kasa kabul KALDI | **completed 06.10, Flashy kabuğu** | queued | queued — "book3 73769 v3 < v4" | 2.0.10 geçerli |
| 74427 | Flashy Grade 2 (2 kitap) | queued | queued — mac build exit 1 | queued | queued | 2.0.2 geçerli |
| 74428 | Flashy Grade 3 | completed (09.22, eski) | completed (09.22, eski) | queued | completed (09.22, eski) | YOK (istek 04.10, kayıt yok) |

- "eski" = 06.10'dan önceki üretim. Bu paketler Flashy tema kabuğundan ÖNCE üretildi (tema 02.10).
- R2 içeriği Mac'ten DOĞRULANAMADI: `ydsr2` jetonu `akillitahtalar` kovasına 403; CDN imzasız
  isteğe 403. DB `r2_object_key` biçimi `<id>/<ad>` (`softwares/` öneki YOK).
- Sözleşme bekçisi bu 4 seti atlar: `tools/set-yenile/istisnalar.json` `flashy-elt-uretilmez`.

### 2b. Web-Z (Worker)

| Konu | Bulgu |
|---|---|
| Tema seçimi | `set-ui-templates.ts:15429` `PUBLISHER_THEME`: `'Flashy ELT'` → `web-proxy-modern`; `index.ts:14` `resolveTheme` |
| Alan | `index.ts:64` `flashyelt.ndr.ist` katalog, `index.ts:75` yönlendirme |
| Kısa kodlar | 60114 `8iy1a` · 74404 `qlc7p` · 74427 `wflqi` · 74428 `jsofm` |
| Set menüsü (canlı) | 200, `x-source: edge-set-template`, başlık doğru |
| Kitap sayfası (canlı, curl) | `qlc7p`, `8iy1a` → 502 "Kitap yüklenemedi"; `jsofm` → "Bakım Modu". Tarayıcıda doğrulanmadı. |
| Kapak | `images/bookN.png` 200 image/jpeg (74404: 3/3) |

### 2c. Paketleyici zinciri — YDS ve Flashy

```
YDS:    arşiv/üreteç build.zip → merdiven → set eki → sf425 kabuk (Swift) → kabuk eki (ProBook)
        → okuyucu kabuğu 1.13.14 → paket → kabul (mac/kasa/ProBook/android) → R2 ydsdigital
Flashy: üreteç (YDS motoru + kurum 310 dönüşümü) → kök = web-proxy-modern → merdiven → set eki
        → [sf425 kabuk ATLANDI: kök sf425 değil] → okuyucu kabuğu 1.13.14 → paket → kabul → R2 akillitahtalar
```

| Halka | Flashy'de durum | Kanıt |
|---|---|---|
| Üreteç kalıbı + yayıncı tablosu | VAR | `uretec-kaynak.js:47` |
| Kök arayüz | VAR (tema) | `webz-tema-kabuk.js`, `kaynak_build_surumleri` 80 |
| Motor kurum noktaları (2×kurum.txt, kurumlogo, baseEndpointUrl) | VAR, uç = YDS yedeği | `agent.log` 76020: aday HasZKitapKey 403 → `akillitahta.ydspublishing.com` |
| sf425 kabuk (Mac) | doğru şekilde atlanır | `agent.log` 76031 |
| Kabuk eki (ProBook) | YOK — `ek-uret.js:45,190` yalnız `ydsdigital` | ProBook `ek` kipinde `r2-kur` + ≥2 kitap + `son.json` yok → ertele (`runner.js:2876-2893`) |
| Okuyucu sürümü kapısı 1.13.14 | anlamlı (motor YDS kalıbından) | 74404 mac: ölçülen 1.13.14 |
| Mac başsız kabul (`tools/kabul/kosum/dom-yoklama.js`) | `.flashy-card` + ünite modalı tanınır | 74404 GEÇTİ |
| Pardus CDP kabul (`tools/pardus/cdp-kitap-ac.js`) | `.flashy-card` + ünite tanınır (03.10) | testler 59480 |
| Windows kasa kabul (`tools/windows/kabul/kabul.py`) | Flashy kartı TANINMAZ (yalnız A/B/C) | 74404: "0/1 kitap GECTI … thumb=2 tuval=0" |
| Android kabul (`tools/kabul/android-cihaz.js:604`) | kart = erişilebilirlik ağacında kitap adı; Flashy'de ÖLÇÜLMEDİ | — |
| Logo kaydı | VAR: `/api/logos` `flashyelt` "Flashy ELT" | `pickLogoId` eşleşir |
| Kapak | 74404 book2 (70165) `thumbs/1.jpg` YOK → kalem simgesi | `kosum.json` ERR_FILE_NOT_FOUND |
| G kanalı | YOK (`tools/g-yayin/yukle.js:38` yalnız YDS) | kapsam dışı |

### 2d. İçerik kaynağı

- Üye kitap: İmpark `ZKitapZipH/<id>-<Vs>.zip` (merdiven S1) → SMB `Storage3/vhosts/yayincilik.net/flashyelt.yayincilik.net/Uploads`
  → içerik önbelleği → arşiv (`uretec-kaynak.js:42-46`, `icerik-yedek.js`).
- Motor kalıbı: bir YDS (kurum 60) arşiv build'i (74404 için 72379, 74427 için 73768).
- Set listesi: claim `setListesi` > dosya > Worker KV (`/go/<kod>/web-stream/config/settings.json`).
- Yerel arşiv: `~/.empp-agent/kaynak-arsivi/` altında yalnız 74404 ve 74430.

## 3. Mimari karar

| Seçenek | Ne değişir | Kapı | Risk | Süre |
|---|---|---|---|---|
| (a) sf425 kabuğuna Flashy teması | Swift `webz-kabuk-uret` + sf425 şablonu + kabuk eki | sf425 kapıları | 02.10 kararına ters; iki tema bakımı; canlıdan sapar | 3-4 gün |
| **(b) Flashy Web-Z arayüzünün çevrimdışı kopyası** | Yalnız eksik halkalar (bölüm 4) | mevcut kapılar + Windows/Android Flashy kartı | düşük: kabuk ve mac kanıtlı | 1-1,5 gün |
| (c) Ayrı Flashy kabuğu | yeni kabuk + yeni kapılar | hepsi yeni | yüksek; canlıyla parite yok | 5+ gün |

**Öneri: (b).** Gerekçe:
1. Nadir 02.10 kararı: "flashy'nin kendi index'i web'de var, onu aynen kullan".
2. Kod hazır, canlıyla bayt bayt eşit, 74404 mac GEÇTİ.
3. Kalan iş kabuk değil; 4 platform halkasıdır. İş küçük ve ayrık.

## 4. İş kırılımı (dosya sahipliği ayrık)

Sıra: İ1-İ4 paralel → İ5 pilot → İ6 yayılım. Her iş kendi testini yazar (gate).

| İş | Sahip dosyalar | Yapılacak | Kabul ölçütü | Doğrulama |
|---|---|---|---|---|
| İ1 Windows kabul Flashy kartı | `tools/windows/kabul/kabul.py`, `kabul_test.py` | `JS_MENU`'ye D varyantı: `.flashy-card[data-id^="book"]` (link kartı sayılmaz). Ünite modalı açılırsa ilk üniteye tıkla (`dom-yoklama.js:84` ve `cdp-kitap-ac.js:221` ile aynı kural). `menu_varyant_sec` aynası D'yi kapsar. | Flashy fikstüründe kart = settings kitap sayısı; ünite modalında ilk ünite açılır; A/B/C testleri değişmez | `python3 -m pytest tools/windows/kabul/kabul_test.py` + kasa'da 74404 tekrar: "3/3 kitap GECTI" |
| İ2 ProBook ek kilidi | `src/agent/runner.js` (on-kontrol bloğu 2866-2893), `src/agent/runner-uretec.test.js` | Tema kabuklu yayıncıda (`yayinciBul(publisherName).tema !== 'kalip'`) kabuk eki ön kontrolü atlanır. Ek hiç gelmeyeceği için bekleme yok. sf425 kabuk adımı zaten "dokunulmaz" der. | Flashy claim + `ek` kipi + son.json yok → ertele YOK; YDS claim → ertele aynen | `node --test src/agent/runner-uretec.test.js` + ProBook günlüğünde 74404 pardus "kabuk eki yok" satırı YOK |
| İ3 Kapak tamamlama | `src/agent/uretec-kaynak.js` (`kapakGetir` bağlama), `src/agent/webz-tema-kabuk.test.js` | Kitapta `thumbs/1.jpg` yoksa kapak Worker'dan alınır: `https://flashyelt.ndr.ist/go/<kod>/web-stream/images/bookN.png` (UA'lı). Alınamazsa kapak yok ve uyarı. | 74404 menüde 3/3 kart kapaklı; `kosum.json`'da `thumbs/1.jpg` ERR_FILE_NOT_FOUND yok | `node --test src/agent/webz-tema-kabuk.test.js` + mac kabul `menu.png` göz kontrolü |
| İ4 Android Flashy kart ölçümü | `tools/kabul/android-cihaz.test.js` (yalnız test + gerekirse `cihazKartlari`) | Flashy kart metni ("KİTAP / Test Book / book") erişilebilirlik ağacında kitap adıyla eşleşir mi, fikstürle ölç. Eşleşmezse `cihazKartlari` Flashy kartını tanır. | Flashy fikstüründe `kartSayisi` = 3 | `node --test tools/kabul/android-cihaz.test.js` |
| İ5 Pilot 74404 | kod yok; kuyruk + kanıt | 4 platform yeniden kuyruk (android: K4 book3 v4 ister → kaynak 2.0.10 yeterli). Bekçi istisnası yalnız 74404 için kalkar. | 4 platform `completed`, her birinde kabul GEÇTİ + R2 `74404/…` anahtarı + `kabuk_durum` dolu | `pipeline-sql` tek SELECT (platform, status, last_run_at, last_error) + kabul kanıt dizinleri |
| İ6 Yayılım | `tools/set-yenile/istisnalar.json` (kayıt silinir, Nadir onayıyla) | Sıra: 74427 → 74428 → 60114. 74428 ve 60114 önce kaynak kurar (`kaynak_kur_istegi_at` var, build yok — sebep ölçülmeli). | 16/16 hücre `completed` + kabul GEÇTİ; bekçi istisnası yok | gün sonu SELECT + `node tools/set-yenile/sozlesme-bekcisi.js` |

Ek gözlem (iş değil, izlenir):
- 74427 mac "Electron Builder exit 1": sebep `packager.log`'da yok. Pilot sonrası tekrar koşu; açık `.dmg` tuzağı (CLAUDE.md) önce elenir.
- 60114: Games (60112) ve Extras (60113) zip'siz öğe. Üreteç bunları `webzAdresiKur` ile çevrimiçi bağlantı yapar (`akillitahta.ndr.ist/go/8iy1a/…`). Canlı kitap sayfası curl ile 502 verdi.
- Pilot neden 74404: kaynak build geçerli (2.0.10), mac zaten GEÇTİ, K4 3/3 güncel. Windows ve Pardus eksikleri tam bu sette görünür. 60114 ve 74428'in kaynak build'i YOK; ilk deneme için riskli.

## 5. Açık kararlar (Nadir)

1. **Okuyucu ucu:** Flashy paketleri YDS ucunu (`akillitahta.ydspublishing.com`) kullanıyor. Sebep: `flashyelt.yayincilik.net` `HasZKitapKey` Cloudflare 403. Bu uç kalıcı kabul mü? Yoksa İmpark'tan bu yol için bot istisnası mı istenir?
2. **Eksik kapak:** Kitap içinde `thumbs/1.jpg` yoksa kapak Worker'ın `images/bookN.png` dosyasından alınsın mı (İ3)?
3. **60114 zip'siz öğeler:** Games ve Extras pakette çevrimiçi bağlantı kartı olarak mı kalsın, yoksa menüden mi çıksın?

---
Kaynak ölçümler: srv21 `pipeline-sql` (salt okuma), `~/.empp-agent/agent.log`, kabul kanıtı
`74404-mac-20261006-122508`, canlı `flashyelt.ndr.ist` (tarayıcı UA, salt okuma), book-update Worker
`_worktrees/bu-canli-1ad` (9b64f721).
