#!/bin/bash
# Attribute shell-side lines to each operation. The success criterion is
# "small enough to describe in a paragraph", so the unit that matters is the
# per-operation code, not the total.
cd "$(dirname "$0")"
count() { # file, section
  awk -v s="$2" '
    $0 ~ "MARK: begin " s { on=1; next }
    $0 ~ "MARK: end " s   { on=0 }
    on && $0 !~ /^[[:space:]]*(\/\/.*)?$/ { n++ }
    END { print n+0 }' "$1"
}
printf "%-22s %10s %10s\n" "section" "swift" "electron"
printf "%s\n" "────────────────────────────────────────────"
for s in loadmode bridge print paste; do
  sw=$(count shell-swift/main.swift "$s")
  el=$(count shell-electron/main.js "$s")
  [ "$s" = bridge ] && el=$((el + $(grep -cvE '^[[:space:]]*(//.*)?$' shell-electron/preload.js)))
  printf "%-22s %10s %10s\n" "$s" "$sw" "$el"
done
printf "%s\n" "────────────────────────────────────────────"
swi=$(( $(count shell-swift/main.swift infrastructure) + $(count shell-swift/main.swift infrastructure2) ))
eli=$(( $(count shell-electron/main.js infrastructure) + $(count shell-electron/main.js infrastructure2) ))
printf "%-22s %10s %10s\n" "infrastructure*" "$swi" "$eli"
printf "%-22s %10s %10s\n" "total file" \
  "$(grep -cvE '^[[:space:]]*(//.*)?$' shell-swift/main.swift)" \
  "$(( $(grep -cvE '^[[:space:]]*(//.*)?$' shell-electron/main.js) + $(grep -cvE '^[[:space:]]*(//.*)?$' shell-electron/preload.js) ))"
echo
echo "* includes each shell's test driver, which a real app would not have"
