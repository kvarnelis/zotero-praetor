#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
XPI="$DIST/zotero-praetor.xpi"
mkdir -p "$DIST"
rm -f "$XPI"
(cd "$ROOT" && /usr/bin/zip -qr "$XPI" manifest.json bootstrap.js chrome.manifest content)
python3 "$ROOT/scripts/update-manifest.py"
echo "Built $XPI"
