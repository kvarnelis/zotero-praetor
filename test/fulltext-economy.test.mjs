import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const scriptPath = new URL("../content/scripts/praetor-mcp.js", import.meta.url);
const source = await readFile(scriptPath, "utf8");
const fulltext = "x".repeat(25000);
let attachmentTextReads = 0;
const attachment = {
	key: "EXAMPLE1",
	libraryID: 1,
	isAttachment: () => true,
	get attachmentText() {
		attachmentTextReads++;
		return Promise.resolve(fulltext);
	},
};
const sandbox = {
	Zotero: {
		Libraries: { userLibraryID: 1 },
		Items: { getByLibraryAndKey: (_libraryID, key) => key === attachment.key ? attachment : null },
	},
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: scriptPath.pathname });

const mcp = sandbox.ZoteroKPraetorMCP;

test("clampFulltextChars keeps the default and clamps min and max bounds", () => {
	assert.equal(mcp.clampFulltextChars(undefined), 20000);
	assert.equal(mcp.clampFulltextChars(4000), 4000);
	assert.equal(mcp.clampFulltextChars(499), 500);
	assert.equal(mcp.clampFulltextChars(500), 500);
	assert.equal(mcp.clampFulltextChars(20000), 20000);
	assert.equal(mcp.clampFulltextChars(20001), 20000);
});

test("get_item_fulltext respects maxChars and reports the effective page size and next offset", async () => {
	mcp.fulltextCache.clear();
	const requested = await mcp.toolGetItemFulltext({ itemKey: "EXAMPLE1", maxChars: 4000 });
	assert.equal(requested.maxChars, 4000);
	assert.equal(requested.text.length, 4000);
	assert.equal(requested.nextOffset, 4000);

	const minimum = await mcp.toolGetItemFulltext({ itemKey: "EXAMPLE1", offset: 4000, maxChars: 1 });
	assert.equal(minimum.maxChars, 500);
	assert.equal(minimum.text.length, 500);
	assert.equal(minimum.nextOffset, 4500);

	const maximum = await mcp.toolGetItemFulltext({ itemKey: "EXAMPLE1", offset: 4500, maxChars: 99999 });
	assert.equal(maximum.maxChars, 20000);
	assert.equal(maximum.text.length, 20000);
	assert.equal(maximum.nextOffset, 24500);
});

test("shouldServeFulltext serves first and expired calls but blocks recent repeats", () => {
	const cache = new Map();
	const key = "1:EXAMPLE1:0";
	const now = 1_000_000;

	assert.equal(mcp.shouldServeFulltext(cache, key, now), true);
	cache.set(key, { servedAt: now, chars: 4000 });
	assert.equal(mcp.shouldServeFulltext(cache, key, now + mcp.FULLTEXT_CACHE_TTL_MS - 1), false);
	assert.equal(mcp.shouldServeFulltext(cache, key, now + mcp.FULLTEXT_CACHE_TTL_MS), true);
});

test("repeat calls return the guard message and refresh forces the body to be served", async () => {
	mcp.fulltextCache.clear();
	attachmentTextReads = 0;
	const first = await mcp.toolGetItemFulltext({ itemKey: "EXAMPLE1", offset: 37, maxChars: 500 });
	assert.equal(first.text.length, 500);
	assert.equal(attachmentTextReads, 1);

	const repeated = await mcp.toolGetItemFulltext({ itemKey: "EXAMPLE1", offset: 37, maxChars: 500 });
	assert.equal(
		repeated,
		"Already retrieved in this session (item EXAMPLE1, offset 37, 500 chars served) — re-read it from your context. Pass refresh:true to force re-fetch."
	);
	assert.equal(attachmentTextReads, 1);

	const refreshed = await mcp.toolGetItemFulltext({ itemKey: "EXAMPLE1", offset: 37, maxChars: 500, refresh: true });
	assert.equal(refreshed.text.length, 500);
	assert.equal(attachmentTextReads, 2);
});
