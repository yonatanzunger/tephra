#!/bin/bash
cd "$(dirname "$0")"
MODE="${1:-localhost}"
export TEPHRA_PUBLIC="$(cd ../editor/public && pwd)"
export TEPHRA_NOTES="$(pwd)/notes"
export TEPHRA_PAGE="${2:-index.html}"
exec ./Tephra.app/Contents/MacOS/Tephra "$MODE"
