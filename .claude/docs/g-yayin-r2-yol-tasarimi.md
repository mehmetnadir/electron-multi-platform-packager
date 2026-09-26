# G yayını: R2 yol tasarımı  `[TASARIM]`

> 2026-09-26, oturum nadir-b8 (dal `g-yayin`). Yalnız tasarım: R2'ye yazan kod ve API/presign
> kodu YOK. Sunucu tarafı Nadir'in "güncelleme arayüzden nasıl yönetilecek" kararından sonra yazılır.
> Kaynaklar: `windows-paketleme-sozlesmesi.md` (G3, G4, "Üç parça"), `platform-kanallari-sozlesmesi.md`
> (O3, O4), `kitap-guncelleme-sozlesmesi.md` (uçlar, "Sunucu tarafı — TASARIM"). Araç: `tools/g-yayin/`.

## Taban
`<taban> = <yayıncının r2Config.publicUrl>/guncelleme` (yayınevi başına kova; env varsayılanına düşülmez).
Uçlar `<taban>/set/<id>/…`, R2 anahtarı `guncelleme/set/<id>/…`. Aracın çıktısı `<cikti>/set/<id>/…`
bu düzenin birebir yerel aynasıdır; yerel sınama sunucusu da aynı ağacı servis eder.

## Anahtarlar
| Anahtar (`guncelleme/set/<id>/` altında) | Tür | Cache-Control | Ne |
|---|---|---|---|
| `surum.json` | değişken | `no-cache` | `{surum, uretim, setKimligi}`. İmzasız, yalnız tetik. **EN SON** yazılır |
| `manifest.json` | değişken | `no-cache` | Son sürümün TAM G durumu (birikimli) |
| `manifest.json.sig` | değişken | `no-cache` | Manifestin ham baytları üzerinde ed25519 imza (base64) |
| `dosya/<yol>` | değişken | `no-cache` | `index.html`, `bookN/43e23fce2b7009474555a77.js`: son hâl |
| `kitap/<bookN>-<sha256[0:16]>.zip` | değişmez | `public, max-age=31536000, immutable` | Eklenen kitabın arşivi; içerik adresli |
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
- **Tek yazar:** `guncelleme/set/<id>/` altına yalnız G yayın aracının çıktısı yüklenir. Paketleyicinin
  `guncelleme.tar.gz`'si (tam kabuk, sha256 sürüm, `scripts/guncelleme-manifesti-uret.js`) bu öneke
  YÜKLENMEZ. Yüklenirse G durumunu siler ve sürümü sıralanamaz hâle getirir (açık karar 2).
- **Geri alma = yeni sürüm:** eski sürüm numarası asla yeniden yayınlanmaz; eski içerik daha büyük
  sayaçla yayınlanır (`surumler/` eski dosyaların sha256'sını verir).
- **Değişmezler üzerine yazılmaz:** `kitap/` ve `surumler/` için PUT `If-None-Match: *` ile istenir.
- **Özel anahtar yalnız bu Mac'te:** üretim anahtarı Anahtar Zinciri'nde (`empp-guncelleme-ed25519-uretim`
  / `nadir`); imza burada atılır. srv21 özel anahtar görmez, yalnız yükleme adresi verir.
- **Saklama:** güncel manifestin gösterdiği her `kitap/*.zip` kalır; gerisi için süre sunucu kararı.

## Presign (gelecek iş, bugün kod yok)
`POST /api/v1/agents/:agentId/result/presign-guncelleme`
`{setKimligi, dosyalar:[{anahtar, boyut, sha256, contentType, cacheControl}]}` → her dosya için presigned PUT.
Sunucu şunları denetler: önek `guncelleme/set/<setKimligi>/`, kova kitabın yayıncısının kovası, kira
şartı, değişmez anahtarlarda `If-None-Match: *`. Ek savunma önerisi: `surum.json` PUT'u vermeden önce
sunucu `manifest.json`'u üretim açık anahtarıyla doğrulasın. Girdi, planın `yukle[]` listesidir.

## Ölçülen (26.09)
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
