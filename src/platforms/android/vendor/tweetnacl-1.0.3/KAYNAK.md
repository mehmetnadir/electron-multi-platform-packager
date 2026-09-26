# tweetnacl-js 1.0.3 — `nacl.min.js` (DEĞİŞTİRİLMEDEN)

- Kaynak: `https://registry.npmjs.org/tweetnacl/-/tweetnacl-1.0.3.tgz`
- npm bütünlüğü (doğrulandı 2026-09-26): `sha512-6rt+RN7aOi1nGMyC4Xa5DdYiukl2UWCbcJft7YhxReBGQD7OAM8Pbxw6YMo4r2diNEA8FEmu32YOn9rhaiE5yw==`
- `nacl.min.js` sha256: `973cc5733cc7432e30ee4682098f413094f494bccf76a567c23908c5035ddbbc` (test çivisi: `g-katmani.test.js`)
- Lisans: Unlicense (kamu malı) — `LICENSE`.
- Denetim: Cure53, Ocak–Şubat 2017, "güvenlik sorunu bulunamadı" (paket README'si). 1.0.3 düzeltmesi
  yalnız İMZALAMAYI etkiler; doğrulama değişmedi (CHANGELOG).
- Neden bu kütüphane: ES5, BigInt/ES2020 gerektirmez (minSdk 23 WebView'larında da ayrışır), kendi
  SHA-512'si var, 18 KB. Yalnız `nacl.sign.detached.verify` kullanılır ve yalnız WebView'ın WebCrypto'su
  Ed25519'u desteklemediğinde yüklenir (`empp-g-istemci.js` → `imzaDogrula`).
