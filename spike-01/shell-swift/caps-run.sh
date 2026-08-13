#!/bin/bash
# Load caps.html three ways and collect what each origin grants.
cd "$(dirname "$0")"
for MODE in localhost file scheme; do
  echo "=== $MODE ==="
  ( ./run.sh "$MODE" caps.html > "/tmp/caps-swift-$MODE.txt" 2>&1 & echo $! > /tmp/caps.pid )
  sleep 7
  kill "$(cat /tmp/caps.pid)" 2>/dev/null
  wait 2>/dev/null
  grep -m1 '^CAPS' "/tmp/caps-swift-$MODE.txt" | sed 's/^CAPS //' > "/tmp/caps-swift-$MODE.json" || true
  if [ -s "/tmp/caps-swift-$MODE.json" ]; then echo "  collected"; else echo "  NO REPORT"; head -5 "/tmp/caps-swift-$MODE.txt"; fi
done
