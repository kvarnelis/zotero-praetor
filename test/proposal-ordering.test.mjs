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

const { orderProposals, isFilingGated, resolveOpenTarget, snapshotAppliedNewestFirst } = sandbox.ZoteroKPraetor;
const plain = (value) => JSON.parse(JSON.stringify(value));
const proposal = (id, tool, itemKey = null) => ({
	id,
	tool,
	args: itemKey ? { itemKey } : {},
});

test("orderProposals keeps item groups stable, puts metadata first, and library changes last", () => {
	const ordered = plain(orderProposals([
		proposal(1, "update_item_collections", "ITEM0001"),
		proposal(2, "update_item_tags", "ITEM0002"),
		proposal(3, "update_item_fields", "ITEM0001"),
		proposal(4, "create_collection"),
		proposal(5, "update_item_tags", "ITEM0001"),
		proposal(6, "update_item_collections", "ITEM0002"),
	]));

	assert.deepEqual(ordered.map((group) => group.itemKey), ["ITEM0001", "ITEM0002", null]);
	assert.deepEqual(ordered.map((group) => group.proposals.map((entry) => entry.id)), [
		[3, 5, 1],
		[2, 6],
		[4],
	]);
});

test("isFilingGated blocks a filing while sibling fields are pending and frees it after", () => {
	const filing = proposal(10, "update_item_collections", "ITEM0001");
	const siblingFields = proposal(11, "update_item_fields", "ITEM0001");
	const otherFields = proposal(12, "update_item_fields", "ITEM0002");

	assert.equal(isFilingGated(filing, [filing, siblingFields, otherFields]), true);
	assert.equal(isFilingGated(filing, [filing, otherFields]), false);
	assert.equal(isFilingGated(proposal(13, "update_item_tags", "ITEM0001"), [siblingFields]), false);
});

test("resolveOpenTarget opens an attachment in the reader", () => {
	assert.deepEqual(plain(resolveOpenTarget({ id: 1 }, { id: 42 })), { kind: "reader", id: 42 });
});

test("resolveOpenTarget falls back to viewing the parent item without an attachment", () => {
	assert.deepEqual(plain(resolveOpenTarget({ id: 1 }, null)), { kind: "fallback" });
});

test("resolveOpenTarget does nothing without an item", () => {
	assert.deepEqual(plain(resolveOpenTarget(null, { id: 42 })), { kind: "none" });
});

test("snapshotAppliedNewestFirst returns a mutation-safe newest-first order", () => {
	const applied = [{ id: 1 }, { id: 2 }, { id: 3 }];
	const snapshot = snapshotAppliedNewestFirst(applied);

	assert.deepEqual(plain(snapshot.map((entry) => entry.id)), [3, 2, 1]);
	assert.deepEqual(applied.map((entry) => entry.id), [1, 2, 3]);
	applied.pop();
	assert.deepEqual(plain(snapshot.map((entry) => entry.id)), [3, 2, 1]);
});
