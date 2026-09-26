# G uçtan uca yerel koşum

G istemcisini (Mac/Pardus Electron, Android) yazanlar için: TEST anahtarıyla imzalı örnek
güncelleme + yerel HTTPS sunucusu + referans koşum. R2'ye ve canlıya dokunmaz.

## Komutlar

```sh
G=~/01dev/_worktrees/g-yayin            # birleşince: depo kökü
D=~/.empp-agent/g-uctan-uca/electron    # Android: ~/.empp-agent/g-uctan-uca/android
P=8443                                  # Android: 8444 (her ajan kendi dizini + portu)

node $G/tools/g-uctan-uca/hazirla.js --dizin $D --port $P   # fikstür + TLS; yeniden koşulabilir (eskisi $D/_eski/'ye)
node $G/tools/g-uctan-uca/sunucu.js  --dizin $D             # https://127.0.0.1:$P/<senaryo>/guncelleme (arka planda bırak)
node $G/tools/g-uctan-uca/kos.js     --dizin $D             # referans: bugünkü Windows istemcisi, 9 senaryo
node $G/tools/g-uctan-uca/dogrula.js <agac> --dizin $D      # kendi istemcinin sonucunu kıyasla
#   --yalniz-g  örtü modeli: yalnız G'nin teslim ettikleri   --degismez  olumsuz senaryo: ağaç kurulu hâliyle aynı
```

`--port` hazirla ile sunucu arasında aynı olmalı (kitap arşivinin adresi manifestte mutlak).

## Üretilenler (`$D`)

| Yol | İçerik |
|---|---|
| `kurulu/` | paket **2.90.1**'in kurulu ağacı: `index.html` v1, `book1..3/` (motor v1), `package.json`, `empp-set.json` (set **99901**, `taban`, TEST açık anahtarı `imza.acikAnahtar`) |
| `kaynak/` | yayının girdileri (index v2/v3, `motor-v2.js`, `book4/`) |
| `senaryolar/<ad>/set/99901/` | sunucunun verdiği uçlar |
| `beklenen.json` | **2.90.3** sonrası: `gDosyalari`, `tabanDosyalari`, `olmamali` (`book3`), `kurulu` |
| `hazirlik.json` | port, taban, açık anahtar + parmak izi, senaryo tabanları, TLS yolları |
| `tls/ca.pem`, `tls/ca.der` | istemcinin güveneceği test CA — ad kısıtlı: yalnız 127.0.0.1, 10.0.2.2, localhost |

## Senaryolar — taban `https://127.0.0.1:$P/<ad>/guncelleme`

| Ad | Beklenen | Zorunlu | Ne sınanır |
|---|---|---|---|
| `gecerli` | 2.90.3, sonra 2. koşu `guncel` | herkes | 2.90.2 atlanır: index v3, book1+book2 motor v2, book4 eklenir, book3 çıkar |
| `imza-bozuk` | değişmez | herkes | manifest imzadan sonra değişmiş |
| `imzasiz` | değişmez | herkes | `.sig` yok |
| `sha-uyusmaz` | değişmez | herkes | `dosya/index.html` sha256 tutmuyor; eklenen/çıkarılan kitap geri alınır |
| `yol-kacisi` | değişmez | herkes | imzalı manifestte `../kacis.txt` |
| `zip-kacisi` | değişmez | herkes | kitap arşivinde `../../kacti.txt` |
| `kismi-bozuk` | değişmez | herkes | bir motor bozuk: ya hep ya hiç |
| `geri-alma` | değişmez | herkes | imzalı ama 2.90.0 < paket 2.90.1 |
| `baska-set` | değişmez | herkes | imzalı ama `setKimligi` 99902 |
| `geri-alma-tetik` | değişmez | herkes | `geri-alma` + imzasız `surum.json` "2.90.9" der: ret İMZALI manifestten |
| `baska-set-tetik` | değişmez | herkes | `baska-set` + `surum.json` "99901/2.90.9" der: ret İMZALI manifestten |

2026-09-26: referans istemci (g-electron dalı) kısmi-bozuk / geri-alma / başka-set açıklarını
kapattı — hepsi HERKES için zorunlu. `-tetik` senaryoları yalnız `surum.json`'a bakan istemciyi
yakalar (tetik imzasızdır; asıl karar imzalı manifestin kimlik/sürüm denetimi).

Örtü kipi (mac/Pardus): `node tools/g-uctan-uca/kos.js --dizin $D --kip ortu` — yazmalar
`EMPP_G_ORTU_KOKU`'ya gider; sınanan ağaç örtünün etkin görünümüdür (`ortuGorunumu`) ve paket
gövdesi her senaryoda birebir aynı kalmalıdır. Sonuç `son-kosu-ortu.json`.

## Uçlar ve biçim

```
GET <taban>/set/<id>/surum.json         {"surum":"2.90.3","uretim":"…","setKimligi":"99901"}   imzasız, yalnız tetik
GET <taban>/set/<id>/manifest.json      aşağıdaki nesne (ham baytlar imzalı)
GET <taban>/set/<id>/manifest.json.sig  base64 ed25519 imza (64 bayt)
GET <taban>/set/<id>/dosya/<yol>        kabuk dosyası (yol segmentleri encodeURIComponent)
GET <kaynak>                            kitap arşivi (manifestteki mutlak adres, …/kitap/bookN-<sha16>.zip)
```

```json
{"sema":1,"kanal":"G","setKimligi":"99901","surum":"2.90.3","onceki":"2.90.2","uretim":"…","anahtar":"<sha256(SPKI)>",
 "kabuk":[{"yol":"index.html","sha256":"…","boyut":320},{"yol":"book1/43e23fce2b7009474555a77.js","sha256":"…","boyut":98}],
 "kitaplar":[{"dizin":"book3","durum":"cikar"},{"dizin":"book4","durum":"ekle","kaynak":"https://…zip","sha256":"…","boyut":619}]}
```

Arşiv: zip (stored/deflate, Zip64 yok, UTF-8 ad), kökü kitap dizininin İÇİ (`index.html`, `sayfa/…`).
Arşivdeki `index.html` paketleyicinin alt-kitap fs-shim etiketlerini taşır (`window.__emppSubBook="bookN"` +
`../empp-fs-shim.js`; g-yayin tek kaynaktan enjekte eder) — istemci ikinci kez enjekte etmez.

## G istemcisi kuralları

1. `surum.json` yerel sürümle aynıysa dur.
2. Manifest + `.sig` indir; gömülü açık anahtarla (`empp-set.json → imza.acikAnahtar`, SPKI DER base64) doğrula; JSON'u ancak sonra ayrıştır.
3. `kanal == "G"`, `setKimligi == paketin kimliği`, `surum > kurulu sürüm` (paket sürümü ya da son uygulanan örtü; sayısal `2.<panel>.<sayaç>` kıyası). Değilse dur.
4. Her `yol`/`dizin`/arşiv girdisi göreli; `..`, mutlak yol, NUL varsa o güncellemeyi reddet.
5. Manifest birikimlidir, yani G'nin yönettiği her şeyin son hâlidir. sha256'sı yereldekiyle aynı dosyayı indirme. Aynı sha256 ile kurulmuş `ekle` arşivini yeniden indirme; bunun için istemci kendi defterini tutar.
6. Ya hep ya hiç: yeni örtüyü ayrı dizine hazırla, her dosyanın sha256'sını ve boyutunu doğrula, sonra tek adımda etkinleştir. Herhangi bir hatada önceki hâl aynen kalır.
7. Önce kitap verisi, sonra `index.html`.
8. `bookN/…` girdisindeki bookN tabanda yoksa ve aynı manifestte eklenmiyorsa girdiyi atla; boş kitap dizini oluşturma.
9. Kabuk artığı silme yok: manifest kabuğun tamamını değil, yalnız G kapsamını taşır.
10. Yalnız `https:` kullan; `http:` yalnız 127.0.0.1/localhost/::1 için. Tabanı test için ezebilmeli (Windows: `EMPP_GUNCELLEME_TABANI`).

## TLS

- Node `https` (Electron ana süreç dahil): `NODE_EXTRA_CA_CERTS=$D/tls/ca.pem`, süreç başlarken verilmeli.
- Electron `net`/Chromium: yalnız test kipinde `session.setCertificateVerifyProc` ile `$D/tls/ca.pem` zincirine izin ver.
- Android: `adb reverse tcp:$P tcp:$P` (cihazda 127.0.0.1) ya da emülatörde `10.0.2.2`. Debug `network_security_config` → `res/raw/ca.der` (`$D/tls/ca.der`).
- CA'yı sistem ya da Anahtar Zinciri deposuna EKLEME.
