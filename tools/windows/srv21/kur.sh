#!/usr/bin/env bash
# srv21 imza köprüsü ikizi — HAZIRLIK. Mac'ten koşturulur. Zamanlayıcıyı ETKİNLEŞTİRMEZ, kasaya anahtar EKLEMEZ.
#  1. /opt/empp-imza-kopru altına 2 dosya kopyalar (köprü + src/agent/imza-istek.js) + SURUM damgası.
#  2. systemd birimlerini /etc/systemd/system'e koyar, daemon-reload (enable YOK).
#  3. /root/.ssh/kasa-kopru yoksa üretir (gizli anahtar srv21'den çıkmaz; yalnız .pub basılır).
#  4. Kasa ana makine anahtarını Mac known_hosts parmak iziyle KIYASLAR; eşleşirse srv21 known_hosts'a ekler.
#  5. srv21'de kuru nöbet ölçümü: o anki rol (pasif konak kasaya bağlanmaz).
# Kullanım: tools/windows/srv21/kur.sh
set -euo pipefail
HEDEF="${SRV21:-root@100.117.187.26}"
PORT="${SRV21_PORT:-2222}"
KASA_IP="100.99.245.17"
KOK="$(cd "$(dirname "$0")/../../.." && pwd)"
SSH=(ssh -p "$PORT" -o ControlPath=none -o ConnectTimeout=10 "$HEDEF")
SCP=(scp -q -P "$PORT" -o ControlPath=none -o ConnectTimeout=10)

SURUM="$(/usr/bin/git -C "$KOK" rev-parse --short HEAD 2>/dev/null || echo bilinmiyor)"
"${SSH[@]}" 'mkdir -p /opt/empp-imza-kopru/tools/windows /opt/empp-imza-kopru/src/agent'
"${SCP[@]}" "$KOK/tools/windows/imza-tetik-koprusu.js" "$HEDEF:/opt/empp-imza-kopru/tools/windows/"
"${SCP[@]}" "$KOK/src/agent/imza-istek.js" "$HEDEF:/opt/empp-imza-kopru/src/agent/"
"${SCP[@]}" "$KOK/tools/windows/srv21/empp-imza-kopru.service" "$KOK/tools/windows/srv21/empp-imza-kopru.timer" \
  "$HEDEF:/etc/systemd/system/"
"${SSH[@]}" "echo '$SURUM' > /opt/empp-imza-kopru/SURUM && systemctl daemon-reload"
echo "kod: /opt/empp-imza-kopru (sürüm $SURUM) · birimler yerinde, ETKİN DEĞİL"

"${SSH[@]}" 'test -f /root/.ssh/kasa-kopru || ssh-keygen -q -t ed25519 -f /root/.ssh/kasa-kopru -N "" -C "srv21-imza-kopru"; chmod 600 /root/.ssh/kasa-kopru; echo "açık anahtar: $(cat /root/.ssh/kasa-kopru.pub)"'

BEKLENEN="$(ssh-keygen -F "$KASA_IP" -l 2>/dev/null | awk '$2=="ED25519"{print $3}' | head -1)"
GELEN="$("${SSH[@]}" "ssh-keyscan -T 10 -t ed25519 $KASA_IP 2>/dev/null | ssh-keygen -lf - | awk '{print \$2}'")"
if [ -n "$BEKLENEN" ] && [ "$BEKLENEN" = "$GELEN" ]; then
  "${SSH[@]}" "ssh-keygen -F $KASA_IP >/dev/null || ssh-keyscan -T 10 -t ed25519 $KASA_IP 2>/dev/null >> /root/.ssh/known_hosts"
  echo "kasa ana makine anahtarı eşleşti ($GELEN) → srv21 known_hosts"
else
  echo "UYARI: kasa ana makine anahtarı EŞLEŞMEDİ (Mac: ${BEKLENEN:-yok} · srv21 gördü: ${GELEN:-yok}) — known_hosts'a yazılmadı" >&2
  exit 3
fi

"${SSH[@]}" 'cd /opt/empp-imza-kopru && EMPP_KOPRU_KONAK=srv21 /usr/local/bin/node -e "
const K=require(\"./tools/windows/imza-tetik-koprusu.js\");const c=K.ayarlar();const s=Date.now();
console.log(\"node\",process.version,\"· konak\",c.konak,\"· kip\",c.kip,\"· saat nöbetçisi\",K.saatNobetcisi(s),\"· bu konak\",K.saatePasifMi(c,s)?\"PASİF\":\"NÖBETÇİ\")"'
echo "Etkinleştirme (ŞEF): ssh -p $PORT $HEDEF 'systemctl enable --now empp-imza-kopru.timer'"
