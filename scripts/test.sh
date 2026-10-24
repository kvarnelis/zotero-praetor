#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
node --check bootstrap.js
while IFS= read -r source_file; do node --check "$source_file"; done < <(find content -type f \( -name '*.js' -o -name '*.mjs' \))
node --test test/*.test.mjs
