#!/bin/bash
cd "$(dirname "$0")"
export TEPHRA_PUBLIC="$(cd ../editor/public && pwd)"
export TEPHRA_NOTES="$(pwd)/notes"
export TEPHRA_PAGE="${2:-index.html}"
unset ELECTRON_RUN_AS_NODE
exec ./node_modules/.bin/electron . "${1:-localhost}"
