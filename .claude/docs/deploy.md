# srv21 dağıtım kuralları (2026-09-09)

> Amaç: srv21'de gerçek Android paketleyiciyi (systemd `empp-packager`, :3091)
> ve ajanı (systemd `empp-agent`) güncellerken sık düşülen üç tuzağı kalıcı
> hale getirmek. Servis haritası: `.claude/CLAUDE.md` "Sunucu (S21) servisleri".

## 1. "Kirli" görünen ağaç yanıltıcı olabilir — commit'lenmiş olabilir

`/opt/empp-packager` ağacında `git status` değişiklik gösterse bile bu KOD
DEĞİŞİKLİĞİ anlamına gelmez — dosya izinleri/mtime/CRLF gibi işletim-dışı
farklar da "modified" olarak görünebilir. Güncellemeden ÖNCE gerçek kod
farkını KANITLA:

```bash
git -C /opt/empp-packager fetch origin
git -C /opt/empp-packager diff origin/<dal> -- <şüpheli-dosya>   # 0 satır = gerçek fark YOK
```

0 satır dönüyorsa "kirli" görünüm zararsızdır (reset gerekmez). Satır
dönüyorsa AŞAĞIDAKİ `--ff-only` adımıyla güncelle — asla `reset --hard`
veya `checkout .` ile körü körüne ezme (paylaşılan-ağaç stash/reset yasağı —
`~/.claude/projects/.../paylasilan-agac-stash-yasagi.md`, git-yıkıcı-gate
hook'u bu sınıf komutları zaten blokluyor).

## 2. Güncelleme SADECE `--ff-only`

```bash
git -C /opt/empp-packager pull --ff-only origin <dal>
```

`--ff-only` fast-forward olmayan bir durumda (yerel commit, çakışan tarih)
SESSİZCE reset/merge YAPMAZ — hata verir, orada durursun. Bu, srv21'de elle
yapılmış acil bir düzeltmenin (varsa) sessizce ezilmesini önler.

## 3. Restart YALNIZ kuyruk boşken

Ağır build (electron-builder → mksquashfs/fpm) çalışırken servisi restart
etmek yarım kalmış bir paketleme işini kaybettirir. Restart öncesi:

```bash
curl -s http://127.0.0.1:3091/api/health   # süreç ayakta mı, hangi commit'i koşuyor (K13)
# kuyrukta aktif iş var mı kontrol et (packagingJobs / queueService durumu) — BOŞSA:
systemctl restart empp-packager empp-agent
```

Restart SONRASI `commit` alanının (K13, `/api/health`) beklenen yeni hash'e
döndüğünü DOĞRULA — restart komutu "başarılı" çıksa da systemd eski binary/kod
yolunu cache'lemiş olabilir; tek kanıt güncellenmiş `commit` alanıdır.

## 4. Paralel `/opt/electron-packager` (pm2, :3005) — AYRI kopya, DOKUNMA

`/opt/electron-packager` (pm2 `packager-service`, port 3005) `/opt/empp-packager`
(systemd, port 3091) ile AYNI kod tabanının FARKLI bir kopyasıdır — birini
güncellemek diğerini GÜNCELLEMEZ. Bu görevin kapsamı `/opt/empp-packager`
(gerçek Android paketleyici) ise `/opt/electron-packager`'a HİÇ dokunma;
karıştırırlarsa "güncelledim ama davranış değişmedi" şüphesi K13'ün tam
çözmeye çalıştığı sorunun AYNISINI üretir (yanlış süreci restart etmiş
olursun).

## Tek örnek kuralı (agent, launchd)

Ajan (`src/agent/runner.js`) için de aynı "iki süreç aynı anda OLMAMALI"
kuralı geçerli — detay ve `launchctl print` kontrolü:
`.claude/docs/set-paketi-know-how.md` "Tek örnek kuralı" bölümü.

Son Güncelleme: 2026-09-09 (ilk sürüm — item-11 denetimi, tudem-apk-batch/coordinator dersleri)
