#!/usr/bin/env python3
"""Write the Zotero update manifest for the XPI just built."""
import hashlib
import json
from pathlib import Path
root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / "manifest.json").read_text())
app = manifest["applications"]["zotero"]
slug = manifest["homepage_url"].rsplit("/", 1)[-1]
package = root / "dist" / (slug + ".xpi")
update = {"version": manifest["version"],
          "update_link": manifest["homepage_url"] + "/releases/download/v" + manifest["version"] + "/" + package.name,
          "update_hash": "sha256:" + hashlib.sha256(package.read_bytes()).hexdigest(),
          "applications": {"zotero": {key: app[key] for key in ("strict_min_version", "strict_max_version")}}}
(root / "updates.json").write_text(json.dumps({"addons": {app["id"]: {"updates": [update]}}}, indent=2) + "\n")
