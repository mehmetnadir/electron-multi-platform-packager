#!/usr/bin/env bash
# srv21 köprü anahtarını kasaya yetkilendirir (ŞEF koşturur; Mac'in mevcut kasa SSH'ı ile).
# Administrator, `administrators` grubunda → sshd_config `Match Group administrators` gereği anahtar
# C:\ProgramData\ssh\administrators_authorized_keys dosyasına gider (kullanıcı .ssh\authorized_keys DEĞİL).
# Satır kısıtlı: yalnız srv21 Tailscale adresinden, yönlendirme/pty yok.
# Kullanım: tools/windows/srv21/kasa-anahtar-ekle.sh            (ekle; zaten varsa dokunmaz)
#           tools/windows/srv21/kasa-anahtar-ekle.sh --geri-al  (yalnız srv21-imza-kopru satırını çıkarır)
set -euo pipefail
KASA="${EMPP_KASA_SSH:-Administrator@100.99.245.17}"
SRV21="${SRV21:-root@100.117.187.26}"
SRV21_IP="100.117.187.26"
ETIKET="srv21-imza-kopru"
DOSYA='C:\ProgramData\ssh\administrators_authorized_keys'
KSSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 "$KASA")

if [ "${1:-}" = "--geri-al" ]; then
  "${KSSH[@]}" "powershell -NoProfile -Command \"\$f='$DOSYA'; (Get-Content \$f) | Where-Object { \$_ -notmatch '$ETIKET' } | Set-Content \$f -Encoding ascii; (Select-String -Path \$f -Pattern '$ETIKET' | Measure-Object).Count\""
  echo "geri alındı (yukarıdaki sayı 0 olmalı)"; exit 0
fi

PUB="$(ssh -p 2222 -o ControlPath=none -o ConnectTimeout=10 "$SRV21" 'cat /root/.ssh/kasa-kopru.pub')"
case "$PUB" in "ssh-ed25519 "*" $ETIKET") ;; *) echo "beklenmeyen açık anahtar biçimi" >&2; exit 2;; esac
if "${KSSH[@]}" "findstr /c:\"$ETIKET\" \"$DOSYA\"" >/dev/null 2>&1; then echo "zaten yetkili — dokunulmadı"; exit 0; fi
SATIR="from=\"$SRV21_IP\",no-agent-forwarding,no-X11-forwarding,no-port-forwarding,no-pty $PUB"
GECICI="$(mktemp -t kasa-anahtar)"
# Başta CRLF: mevcut dosya satır sonusuz bitiyorsa yeni anahtar önceki satıra yapışmasın (boş satır yok sayılır).
printf '\r\n%s\r\n' "$SATIR" > "$GECICI"
scp -q -o BatchMode=yes "$GECICI" "$KASA:C:/Users/Administrator/.empp-agent/kopru-anahtar-satiri.txt"
"${KSSH[@]}" "type C:\\Users\\Administrator\\.empp-agent\\kopru-anahtar-satiri.txt >> \"$DOSYA\" && find /c \"ssh-\" \"$DOSYA\""
echo "eklendi. Doğrula: ssh -p 2222 $SRV21 'ssh -o BatchMode=yes -o IdentitiesOnly=yes -i /root/.ssh/kasa-kopru $KASA echo baglandi'"
