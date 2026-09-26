# Uçtan uca sağlık — gece koşusu (HAZIR, KURULMADI)

`e2e-gece.sh` 22:00'de T1-T5, 07:30'da T5 doğrulamasını `agir.sh` semaforundan koşar; özeti
`bildir e2e "<özet>"` ile yollar (çıkış kodu ≠0 → öncelik yuksek; bildir gönderilemezse çıkış 2).
Varsayılan `E2E_KURU=1`: yalnız yazan/tetikleyen adımlar (t5-tetik, g-uygula) koşmaz; salt-okuma ölçümler
(pipeline keşfi, CDN paket denetimi `--indir`, canlı G manifesti, İmpark K içeriği, kabul kanıtı) kuruda da
koşar. Girdi verilmezse koşucu kitabın pipeline satırlarından CDN URL'lerini kendisi bulur.

Kurulum (depo kökünde, kod birleştikten sonra; ilk koşu bildirim atmadan elle doğrulanır):

```sh
sed -e "s#__DEPO__#$PWD#g" -e "s#__HOME__#$HOME#g" -e "s#__NODE_DIZIN__#$(dirname "$(command -v node)")#g" tests/e2e/gece/com.empp.e2e-saglik.plist.sablon > ~/Library/LaunchAgents/com.empp.e2e-saglik.plist
E2E_BILDIRME=0 bash tests/e2e/gece/e2e-gece.sh aksam
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.empp.e2e-saglik.plist
```

Kaldırma: `launchctl bootout gui/$(id -u)/com.empp.e2e-saglik`. Günlük: `~/.empp-agent/e2e/gece.log`.
