# G yayını: R2 yol tasarımı  `[TASARIM]`

> 2026-09-26, oturum nadir-b8 (dal `g-yayin`). API/presign kodu YOK; sunucu tarafı Nadir'in
> "güncelleme arayüzden nasıl yönetilecek" kararından sonra yazılır. Geçiş aracı olarak bu Mac'ten
> iki kapılı `yukle` var (aşağıda); 74390 yayını Nadir onayını bekliyor, hiçbir yükleme koşmadı.
> Kaynaklar: `windows-paketleme-sozlesmesi.md` (G3, G4, "Üç parça"), `platform-kanallari-sozlesmesi.md`
> (O3, O4), `kitap-guncelleme-sozlesmesi.md` (uçlar, "Sunucu tarafı — TASARIM"). Araç: `tools/g-yayin/`.

## Taban
`<taban> = <yayıncının r2Config.publicUrl>/guncelleme` (yayınevi başına kova; env varsayılanına düşülmez).
Uçlar `<taban>/set/<id>/…`, R2 anahtarı `guncelleme/set/<id>/…`. Aracın çıktısı `<cikti>/set/<id>/…`
bu düzenin birebir yerel aynasıdır; yerel sınama sunucusu da aynı ağacı servis eder.

## Anahtarlar
| Anahtar (`guncelleme/set/<id>/` altında) | Tür | Cache-Control | Ne |
|---|---|---|---|
| `surum.json` | değişken | `no-cache, no-transform` | `{surum, uretim, setKimligi}`. İmzasız, yalnız tetik. **EN SON** yazılır |
| `manifest.json` | değişken | `no-cache, no-transform` | Son sürümün TAM G durumu (birikimli) |
| `manifest.json.sig` | değişken | `no-cache, no-transform` | Manifestin ham baytları üzerinde ed25519 imza (base64) |
| `dosya/<yol>` | değişken | `no-cache, no-transform` | `index.html`, `bookN/43e23fce2b7009474555a77.js`: son hâl |
| `kitap/<bookN>-<sha256[0:16]>.zip` | değişmez | `public, max-age=31536000, immutable, no-transform` | Eklenen kitabın arşivi; içerik adresli |
| `surumler/<surum>/manifest.json` (+`.sig`) | değişmez | aynı | Her sürümün imzalı manifesti: denetim izi, geri dönüş kaynağı |

`<surum>` = `2.<panel>.<sayaç>` (G3). Sayaç alanı paket sürümüyle ortaktır: ilk G yayını kurulu paketin
sürümünden büyük olmalıdır (`--onceki-surum`).

## Yükleme sırası (aracın `yayin/<id>/<surum>.json` planı)
1. `kitap/*.zip` (yeni olanlar) → 2. değişen `dosya/*` → 3. `surumler/<surum>/*` → 4. `manifest.json`,
   `manifest.json.sig` → 5. `surum.json`.
6. Doğrulama: `GET <taban>/set/<id>/surum.json` = yeni sürüm; `manifest.json` + `.sig` üretim açık
   anahtarıyla doğrulanır. İkisi de tutmazsa yayın "yüklendi" sayılmaz.
7. CDN temizliği: değişken anahtarlar (`surum.json`, `manifest.json(.sig)`, değişen `dosya/*`) purge edilir.

Gerekçe: yükleme ortasında okuyan istemci ya eski `surum.json`'u görür ve bir şey yapmaz, ya da yeni
`surum.json`'u görür ve o anda bütün içerik yerindedir. `manifest` ile `.sig` arasında okuyan istemci
eşleşmeyen çift görür; imza tutmaz, güncelleme atlanır, bir sonraki açılışta yeniden dener. Eski
manifestle yeni `dosya/*` yarışında sha256 tutmaz, sonuç yine "atla".

## Kurallar
- **`no-transform` zorunlu (06.10, ölçüldü):** Cloudflare Web Analytics `text/html` yanıtına beacon
  betiği ekler. 45550 `dosya/index.html` CDN'den 6894 B yerine 7255 B geldi; sha256 tutmadı, istemci
  reddederdi. `Cache-Control: …, no-transform` ile CDN baytı R2 baytıyla aynıdır. Araç bu değeri her
  G nesnesine yazar. Eski başlıklı nesne aynı baytla yeniden yazılarak onarılır.
- **Tek yazar:** `guncelleme/set/<id>/` altına yalnız G yayın aracının çıktısı yüklenir. Paketleyicinin
  eski `guncelleme.tar.gz`'si artık ÜRETİLMEZ — üreticisi 26.09'da karantinada
  (`_graveyard/2026-09-26-g-eski-uretici/`); yüklense G durumunu silerdi (açık karar 2).
- **Geri alma = yeni sürüm:** eski sürüm numarası asla yeniden yayınlanmaz; eski içerik daha büyük
  sayaçla yayınlanır (`surumler/` eski dosyaların sha256'sını verir).
- **Değişmezler üzerine yazılmaz:** `kitap/` ve `surumler/` için PUT `If-None-Match: *` ile istenir.
- **Özel anahtar yalnız bu Mac'te:** üretim anahtarı Anahtar Zinciri'nde (`empp-guncelleme-ed25519-uretim`
  / `nadir`); imza burada atılır. srv21 özel anahtar görmez, yalnız yükleme adresi verir.
- **Saklama:** güncel manifestin gösterdiği her `kitap/*.zip` kalır; gerisi için süre sunucu kararı.

## Bu Mac'ten yükleme — `yukle` ve gece testi `e2e` (Şef talimatı, 26.09)
```
node tools/g-yayin/yayinla.js yukle --set-kimligi 74390 --cikti ~/.empp-agent/g-yayin [--onayli]
node tools/g-yayin/yayinla.js e2e 74390 [--onayli] [--index <74390 index.html> --onceki-surum 2.p.s]
node tools/g-yayin/yayinla.js dogrula --uzak https://cdn.ydspublishing.com/guncelleme --set-kimligi 74390 [--surum 2.p.s] [--arsivler]
```
- **Kapı 1, beyaz liste (kodda):** `YUKLEME_BEYAZ_LISTE` yalnız `74390 → ydsr2:ydsdigital` +
  `https://cdn.ydspublishing.com/guncelleme`. Başka kimlik `400 — … beyaz listesinde değil`. Kova ve
  taban komut satırından alınmaz. Liste genişletmek = kod değişikliği + Nadir onayı.
- **Kapı 2, onay:** `--onayli` yoksa kuru. Plan (sıra, anahtar, boyut) basılır, canlıya yazılmaz.
- **Ek kapı:** yerel durum ÜRETİM açık anahtarıyla doğrulanmazsa, yani TEST imzalıysa, yükleme reddedilir.
- **Taşıyıcı:** bu Mac'teki rclone uzağı `ydsr2:` (`rclone copyto`, `Content-Type` + `Cache-Control`
  başlıklarıyla). Kimlik bilgisi rclone yapılandırmasında kalır; kod onu okumaz, basmaz.
- **Ne yüklenir:** plan dosyası değil; yerel imzalı durum ile canlı `lsjson` (md5) kıyaslanır, eksik ya
  da farklı olan yüklenir. Değişmez anahtar canlıda farklıysa hiçbir şey yüklenmez. Böylece yükleme
  tekrar koşulabilir. Bir adım düşerse sonraki adımlar, `surum.json` dahil, yüklenmez.
- **Yükleme sonrası:** `dogrula --uzak` otomatik koşar; kitap arşivleri de akışla indirilip sha256'ları
  kıyaslanır.
- **`e2e`:** `index.html`'e `<!-- empp-g-e2e <zaman> -->` işareti koyarak yeni sürüm üretir; işaret tek
  kalır. Sonra `yukle` (onaysız kuru) ve `dogrula --uzak` koşar. Çıktı JSON + rc; rc 0 = üret + yükle
  + (onaylıysa) canlı doğrulama geçti. İlk koşu önceki durum ister: yerel çıktı, canlı manifest ya da
  `--index` + `--onceki-surum`.
- **Gece koşusu için karar gerekir:** onaylı `e2e` her gece yeni bir sürüm yayınlar. 74390'ın üretim
  anahtarı gömülü paketleri varsa bu gerçek bir güncellemedir. İşaret HTML yorumu olduğu için görünmez.

## Presign (gelecek iş, bugün kod yok)
`POST /api/v1/agents/:agentId/result/presign-guncelleme`
`{setKimligi, dosyalar:[{anahtar, boyut, sha256, contentType, cacheControl}]}` → her dosya için presigned PUT.
Sunucu şunları denetler: önek `guncelleme/set/<setKimligi>/`, kova kitabın yayıncısının kovası, kira
şartı, değişmez anahtarlarda `If-None-Match: *`. Ek savunma önerisi: `surum.json` PUT'u vermeden önce
sunucu `manifest.json`'u üretim açık anahtarıyla doğrulasın. Girdi, planın `yukle[]` listesidir.

## Ölçülen (26.09)
- 74390 canlı: `guncelleme/set/74390/` boş (rclone lsjson `{}`), CDN `surum.json` 404. Salt okuma.
- Anahtar Zinciri yolu: `node tools/g-yayin/yayinla.js kuru-imza` → **GEÇTİ** (üretim anahtarı okundu,
  test gövdesi imzalandı, `31b8663b…2cf6` açık anahtarıyla doğrulandı; manifest yayınlanmadı).
- Uçtan uca (`tools/g-uctan-uca/`): bugünkü Windows istemcisi gerçek HTTPS'le 6 zorunlu senaryoyu geçer.
  Üç senaryo ise onda açık kalır:
  - `geri-alma`: eski sürümü kabul ediyor, çünkü yalnız damga eşitliğine bakıyor.
  - `baska-set`: başka setin manifestini kabul ediyor, çünkü manifestte kimlik denetimi yok.
  - `kismi-bozuk`: bir dosya bozuk olsa da ötekileri yazıyor.

## Açık kararlar (Nadir)
1. Arayüz: yayını kim, hangi ekrandan tetikler? Araç programatik de çağrılabilir (`yayinla(nesne)`).
2. Tek yazar kuralı: paketleyicinin tam kabuk paketi bu önekten çıkarılsın mı? Öneri: evet.
3. Windows istemcisinin açıkları kapatılsın mı? Dört madde var:
   - geri alma koruması,
   - `setKimligi` bağı,
   - ya hep ya hiç yazımı,
   - aynı sha256'lı `ekle` arşivini yeniden indirmemek. Bugün birikimli manifestte her yeni sürümde eklenen kitaplar yeniden iner.
   Kanal üretimde kapalı (`EMPP_SET_GUNCELLEME=0`).
4. Saklama süresi ve CDN purge sorumluluğu (runner mı, API mi).
