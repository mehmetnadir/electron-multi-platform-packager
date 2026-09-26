#!/bin/bash
# ProBook şeridi AÇILIŞ ONARIMI (plan B.3, 2026-09-26) — serit-ajan.sh runner'ı başlatmadan ÖNCE koşar.
#
# 1) Yetim kabul: kapı çökerse/SIGKILL yerse (trap koşmaz) öğretmen kurulumları ~/DijiTap altında
#    `.kabulgizli-<damga>` adıyla GİZLİ kalır — veri kaybı gibi görünür. İş almadan önce geri konur:
#    manifestli olanlar probook-temizlik.sh ile (test kurulumu da kaldırılır), manifestsiz gizliler
#    yerinde başka dizin yoksa eski adına döner (varsa CAKISMA yazılır, EZİLMEZ).
#    Kabul kilidi tazeyse (süren kabul, ör. Mac'in uzak kapısı) HİÇBİR ŞEYE dokunulmaz.
# 2) Yetim iş dizini: runner SIGKILL yerse `finally` koşmaz; ~/empp-serit/work altında kalan
#    empp-agent-* / app-* dizinleri (tek kopya: systemd + flock) önceki koşunundur, kaldırılır.
# Çıkış hep 0 (onarım ajanı başlatmayı engellemez); her eylem tek satır loglanır.
set -u
BETIK_DIZIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMIZLIK="${PROBOOK_TEMIZLIK:-$BETIK_DIZIN/../pardus/probook-temizlik.sh}"
TABAN="$HOME/DijiTap"
L="${KABUL_KILIT:-$HOME/.kabul.lock}"
SERIT="${EMPP_SERIT_KOK:-$HOME/empp-serit}"
say(){ printf '[yetim-onar] %s\n' "$*"; }

if [ -e "$L" ] && [ -n "$(find "$L" -mmin -"${KABUL_KILIT_YAS_DK:-60}" 2>/dev/null)" ]; then
  say "kabul kilidi taze ($(head -1 "$L" 2>/dev/null)) — kabul onarimi atlandi"
else
  for m in "$HOME"/.kabul-*.manifest; do
    [ -e "$m" ] || continue
    d="${m##*/.kabul-}"; d="${d%.manifest}"
    say "yetim manifest: $d — temizlik kosuyor"
    bash "$TEMIZLIK" "$d" 0 "" 2>&1 | sed 's/^/  /'
  done
  for g in "$TABAN"/*/*.kabulgizli-*; do
    [ -d "$g" ] || continue
    a="${g%.kabulgizli-*}"
    if [ -e "$a" ]; then say "CAKISMA: ${a#$TABAN/} yerinde dizin var — gizli kopya birakildi: $(basename "$g")"
    else mv "$g" "$a" && say "geri konuldu: ${a#$TABAN/}"; fi
  done
fi

if [ -d "$SERIT/work" ]; then
  for w in "$SERIT"/work/empp-agent-* "$SERIT"/work/app-*; do
    [ -d "$w" ] || continue
    say "yetim is dizini kaldiriliyor: ${w#$SERIT/} ($(du -sh "$w" 2>/dev/null | cut -f1))"
    rm -rf "$w"   # runner'in kendi mkdtemp dizini (plan B.3: is bitince silinir)
  done
fi
exit 0
