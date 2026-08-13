#!/bin/bash
cd "$(dirname "$0")"
for MODE in localhost file scheme; do
  echo "=== $MODE ==="
  ( ./run.sh "$MODE" caps.html > "/tmp/caps-electron-$MODE.txt" 2>&1 & echo $! > /tmp/ecaps.pid )
  sleep 9
  kill "$(cat /tmp/ecaps.pid)" 2>/dev/null
  pkill -f "Electron.app/Contents/MacOS/Electron" 2>/dev/null
  sleep 1
  grep -m1 '^CAPS' "/tmp/caps-electron-$MODE.txt" | sed 's/^CAPS //' > "/tmp/caps-electron-$MODE.json"
  if [ -s "/tmp/caps-electron-$MODE.json" ]; then echo "  collected"; else echo "  NO REPORT"; tail -3 "/tmp/caps-electron-$MODE.txt"; fi
done
