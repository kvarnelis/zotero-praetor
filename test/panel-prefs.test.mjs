import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const scriptPath = new URL("../content/scripts/praetor.js", import.meta.url);
const source = await readFile(scriptPath, "utf8");
const sandbox = {
	addonID: "zys-praetor@zys",
	rootURI: "resource://zys-praetor/",
	Zotero: {},
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: scriptPath.pathname });

const resolvePanelPrefs = sandbox.ZoteroKPraetor.resolvePanelPrefs;
const plain = (value) => JSON.parse(JSON.stringify(value));

test("panel preferences default both surfaces on when absent", () => {
	assert.deepEqual(plain(resolvePanelPrefs({})), { mini: true, full: true });
});

test("panel preferences respect explicit false values", () => {
	assert.deepEqual(plain(resolvePanelPrefs({
		"zoteroKPraetor.ui.miniPanel": false,
		"zoteroKPraetor.ui.fullPanel": false,
	})), { mini: false, full: false });
});

test("panel preferences replace junk values with defaults", () => {
	assert.deepEqual(plain(resolvePanelPrefs({
		"zoteroKPraetor.ui.miniPanel": "false",
		"zoteroKPraetor.ui.fullPanel": 0,
	})), { mini: true, full: true });
});
