#!/usr/bin/env bash
# Run Tephra the way it actually ships.
#
# There is one trap this exists to close: ELECTRON_RUN_AS_NODE is set in some
# shells, and with it set `require('electron')` returns a path string instead of
# the API — so the app dies at startup with an error that names none of that.
# It has cost an afternoon once already. Everything else here is convenience.
#
#   ./run.sh                 the real notebook at ~/Tephra
#   ./run.sh --scratch       a fresh throwaway notebook, for testing
#   ./run.sh --root PATH     a specific notebook
#   ./run.sh --no-build      skip the build, even if sources look newer
#   ./run.sh --dev           electron-vite dev, with renderer HMR
#
# Note that --dev serves the renderer over HTTP so hot reload works, which is a
# development-only exception to D17. It carries the app bundle, never the
# corpus. Anything being judged for feel or for security should use the default.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

ROOT="${TEPHRA_ROOT:-$HOME/Tephra}"
BUILD=1
DEV=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scratch)  ROOT="$(mktemp -d /tmp/tephra-scratch-XXXXXX)"; shift ;;
    --root)     ROOT="${2:?--root needs a path}"; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    --dev)      DEV=1; shift ;;
    -h|--help)  awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)          echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ ! -d node_modules ]]; then
  echo "installing dependencies…"
  npm install
fi

# The env var that makes Electron pretend to be Node. Unset for the child only.
unset ELECTRON_RUN_AS_NODE

if [[ $DEV -eq 1 ]]; then
  echo "Tephra (dev, HMR)  notebook: $ROOT"
  TEPHRA_ROOT="$ROOT" exec ./node_modules/.bin/electron-vite dev
fi

# Rebuild when anything under src/ is newer than the built main process, so
# "did I remember to build?" stops being a question worth asking.
if [[ $BUILD -eq 1 ]]; then
  if [[ ! -f out/main/index.cjs ]] || [[ -n "$(find src electron.vite.config.ts -newer out/main/index.cjs 2>/dev/null | head -1)" ]]; then
    echo "building…"
    npm run build --silent
  fi
fi

mkdir -p "$ROOT"
echo "Tephra  notebook: $ROOT"
TEPHRA_ROOT="$ROOT" exec ./node_modules/.bin/electron .
