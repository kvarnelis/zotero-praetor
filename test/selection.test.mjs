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

const praetor = sandbox.ZoteroKPraetor;
const threeItemFixture = [
	{ key: "SYNTH001", title: "Synthetic Example A", creator: "Example Author A", year: "2006", collections: ["Example Collection", "Example Subcollection"] },
	{ key: "SYNTH002", title: "Synthetic Example B", creator: "Example Author B", year: "2012", collections: ["Example Collection"] },
	{ key: "SYNTH003", title: "Synthetic Example C", creator: "Example Author C", year: "1991", collections: [] },
];

test("buildSelectionBlock returns empty for zero or one selected item", () => {
	assert.equal(praetor.buildSelectionBlock([]), "");
	assert.equal(praetor.buildSelectionBlock(threeItemFixture.slice(0, 1)), "");
});

test("buildSelectionBlock renders a three-item pipe-delimited batch", () => {
	const block = praetor.buildSelectionBlock(threeItemFixture);
	const lines = block.split("\n");

	assert.equal(
		lines[0],
		'SELECTED BATCH (3 items) — propose/act on ALL of these when the user says "these", "the selection", or plural books:'
	);
	assert.equal(lines.length, 4);
	assert.deepEqual(lines.slice(1), [
		"SYNTH001 | Synthetic Example A | Example Author A | 2006 | Example Collection; Example Subcollection",
		"SYNTH002 | Synthetic Example B | Example Author B | 2012 | Example Collection",
		"SYNTH003 | Synthetic Example C | Example Author C | 1991 | (none)",
	]);
});

test("buildSelectionBlock caps a 75-item batch at 60 visible lines", () => {
	const fixture = Array.from({ length: 75 }, (_, index) => ({
		key: `KEY${String(index + 1).padStart(5, "0")}`,
		title: `Book ${index + 1}`,
		creator: `Creator ${index + 1}`,
		year: String(1950 + index),
		collections: ["Example Collection A", "Example Collection B", "Example Collection C", "Not shown"],
	}));
	const lines = praetor.buildSelectionBlock(fixture).split("\n");

	assert.equal(lines[0].includes("(75 items)"), true);
	assert.equal(lines.filter((line) => line.startsWith("KEY")).length, 60);
	assert.equal(lines.at(-1), "…and 15 more not shown; ask the owner to narrow the selection or use a collection.");
	assert.equal(lines[1].endsWith("Example Collection A; Example Collection B; Example Collection C"), true);
});

test("batch prompts include item-at-a-time and reading-economy orders", () => {
	const selectionBlock = praetor.buildSelectionBlock(threeItemFixture);
	const lines = praetor.buildPraetorBatchPromptLines({ selectionBlock });

	assert.deepEqual(Array.from(lines.slice(1, 5)), [
		"Work the batch ONE ITEM AT A TIME: gather what you need for a single item, submit that item's tool calls (or proposals) immediately, then move to the next. Do not read the whole batch before acting.",
		"For each item, submit metadata corrections BEFORE its filing proposal.",
		"Reading economy: metadata plus the FIRST page of indexed text is almost always enough to file a book; request more pages only when genuinely undecided. For batches larger than 10, pass maxChars 4000 to get_item_fulltext.",
		"NEVER re-fetch text you already retrieved in this conversation — re-read it from your own context.",
	]);
	assert.equal(lines.at(-1), selectionBlock);
});
