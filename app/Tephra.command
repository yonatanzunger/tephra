#!/usr/bin/env bash
# Double-clickable from Finder. macOS opens a .command in Terminal and runs it,
# which is the cheapest thing that behaves like an application while the real
# packaging — electron-builder, an icon, signing — is still unscheduled.
cd "$(dirname "${BASH_SOURCE[0]}")"
exec ./run.sh "$@"
