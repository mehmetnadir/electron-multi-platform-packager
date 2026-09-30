# Açık kusurlar / karar bekleyenler

> Kod değişikliği içermez — yalnız kayıt. Bir madde çözülünce buradan silinir,
> karar/düzeltme ilgili sözleşmeye veya `changelog.md`'ye taşınır.

## G sürüm numarası üç bağımsız yerden üretiliyor — karar Nadir'de

Kaynak: `~/.empp-agent/arastirma/g-surum-ad-alani-onerisi-20260926.md` (26.09, kod yok).

Biçim tek (`2.<panel>.<N>`) ama üç ayrı yerden bağımsız üretiliyor: (1) paket claim'i DB'de
platform başına `paket_sayaci`, (2) `g-yayin/yayinla.js`'in kendi `sonraki()` hesaplaması (DB'yi
görmez), (3) elle geçilen `--surum`. İstemci üçünü TEK kıyasa sokuyor (kurulu = max(paket sürümü,
G sürümü); yeni manifest ancak KESİN büyükse uygulanır) — bu yüzden platform sayaçları ayrışırsa
(S2) veya yeni paket G'den büyük numarayla çıkarsa (S3) G içeriği sessizce atlanıyor/kayboluyor.
Rapor üç seçenek sunuyor (A: tek ortak sayaç; B: paket numarası ≠ G içerik numarası, istemci
yalnız G'yi kıyaslar — ÖNERİLEN; C: içerik özetine bağlı tekillik, A/B'nin üstüne). Ölçülen: DB
`paket_sayaci` canlıda tüm platform satırlarında 0 — G3 numaralı paket sahada henüz yok, değişiklik
için en ucuz an şimdi. Nadir'e 3 açık soru: B mi A mı? Taze kurulumda canlı son G yeniden uygulansın
mı? Panel kodu olmayanlar `2.0.<sayaç>` + panel "asla küçülmez" kaydı onaylı mı?

## Üç düzeltme `canli-aday-20260928` dalında kaldı, agent-mode'a birleşmedi

Doğrulama (`git merge-base --is-ancestor <commit> agent-mode`, 2026-10-01, worktree `knowhow-20261001`
üzerinden): aşağıdaki üç düzeltme yalnızca kendi dallarında ve `canli-aday-20260928`'de duruyor,
`agent-mode`'un atası DEĞİL — yani bugünkü çalışan koda dahil değiller.

| Düzeltme | Dal | Konu |
|---|---|---|
| `mainjs-sablon-sozdizimi` | `mainjs-sablon-sozdizimi` | main.js şablon `\n` kaçış hatası + `vm.Script` sözdizimi kapısı |
| `cambridge-kapi-runner` | `cambridge-kapi-runner` | İmpark-dışı yayınevi (Cambridge) savunma kapısı (`imparkKaynakliMi`) |
| `s1-kimlik-tolerans` | `s1-kimlik-tolerans` | S1 görsel benzerlik (12.0) / yer tutucu stddev (5.0) eşikleri |

Ayrıca (bu görevin kapsamı dışında ama aynı doğrulamayla bulundu): `bos-flexibleitems` dalındaki
0 bayt `flexibleItems.json` onarımı (`bosJsonOnar`) da agent-mode'un atası DEĞİL — aynı birleştirme
borcuna dahil edilmeli.

Bu dört dal Şef tarafından `agent-mode`'a birleştirilmeden, gotchas.md/kitap-kaynak-sozlesmesi.md'deki
ilgili kayıtlar "belgelendi ama koda yansımadı" durumundadır.
