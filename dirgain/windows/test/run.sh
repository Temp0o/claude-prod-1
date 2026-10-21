#!/bin/sh
# Runs dirgain.exe's real event loop against the mock Interception library under Wine.
# Usage: windows/test/run.sh /path/to/Interception-checkout   (needs x86_64-w64-mingw32-gcc and wine64)
set -eu
SDK=${1:?path to a checkout of github.com/oblitum/Interception}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
WINE=${WINE:-$(command -v wine64 || echo /usr/lib/wine/wine64)}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

x86_64-w64-mingw32-gcc -O2 -std=c11 -Wall -Wextra -Werror -I"$ROOT/core" -I"$SDK/library" -DINTERCEPTION_STATIC -static \
  "$ROOT/windows/dirgain-interception.c" "$ROOT/core/dirgain.c" "$HERE/mock_interception.c" -o "$WORK/dirgain.exe"
cd "$WORK"
export WINEPREFIX="$WORK/prefix" WINEDEBUG=-all
printf 'a1 = 0.1\n' > profile.conf

: > strokes.txt
i=0; while [ $i -lt 300 ]; do echo "11 10 0 0 0 0" >> strokes.txt; i=$((i+1)); done
i=0; while [ $i -lt 300 ]; do echo "11 0 10 0 0 0" >> strokes.txt; i=$((i+1)); done
echo "11 0 0 1 0 0" >> strokes.txt
echo "11 0 0 1024 0 120" >> strokes.txt
echo "11 30000 20000 0 1 0" >> strokes.txt
echo "12 10 0 0 0 0" >> strokes.txt

fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got $2, want $3"; fail=1; fi; }
near() { awk -v a="$2" -v b="$3" -v t="$4" -v n="$1" 'BEGIN { d = a - b; if (d < 0) d = -d; if (d <= t) print "ok   " n " (" a ")"; else { print "FAIL " n ": got " a ", want " b " +-" t; exit 1 } }' || fail=1; }

"$WINE" ./dirgain.exe profile.conf 2>&1 | tr -d '\r' > out.txt || true
grep -q '^END' out.txt || { echo "FAIL: app did not run the loop"; cat out.txt; exit 1; }
sx=$(awk '$1=="SEND" && $2==11 && $4==0 && $6==0 { s += $3 } END { print s }' out.txt | head -1)
sy=$(awk '$1=="SEND" && $2==11 && $3==0 && $6==0 { s += $4 } END { print s }' out.txt)
near "horizontal motion gets exp(+0.1)" "$sx" 3315 3
near "vertical motion gets exp(-0.1)" "$sy" 2715 3
check "button stroke passes unchanged" "$(grep -c '^SEND 11 0 0 1 0 0$' out.txt)" 1
check "wheel stroke passes unchanged" "$(grep -c '^SEND 11 0 0 1024 0 120$' out.txt)" 1
check "absolute stroke passes unchanged" "$(grep -c '^SEND 11 30000 20000 0 1 0$' out.txt)" 1
check "second mouse also corrected (all mice)" "$(grep -c '^SEND 12 11 0 0 0 0$' out.txt)" 1

"$WINE" ./dirgain.exe profile.conf --device 11 2>&1 | tr -d '\r' > out2.txt || true
check "--device leaves other mice alone" "$(grep -c '^SEND 12 10 0 0 0 0$' out2.txt)" 1

"$WINE" ./dirgain.exe --list 2>&1 | tr -d '\r' > out3.txt || true
check "--list prints the hardware id" "$(grep -c 'mouse 11: HID' out3.txt)" 1

[ $fail -eq 0 ] && echo "windows loop tests passed" || exit 1
