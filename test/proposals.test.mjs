import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const scriptPath = new URL("../content/scripts/praetor-mcp.js", import.meta.url);
const source = await readFile(scriptPath, "utf8");

const items = new Map([
	["EXAMPLE1", {
		key: "EXAMPLE1",
		getDisplayTitle: () => "Synthetic Example A",
		getField: (field) => field === "title" ? "Synthetic Example A" : "",
	}],
]);
const collections = new Map([
	["COLLECT1", { key: "COLLECT1", name: "Example Parent", parentKey: false }],
	["SUBCOLL1", { key: "SUBCOLL1", name: "Example Subcollection", parentKey: "COLLECT1" }],
	["COLLECT2", { key: "COLLECT2", name: "EXample Collection", parentKey: false }],
]);
const Zotero = {
	debug: () => {},
	Libraries: { userLibraryID: 1 },
	Items: {
		getByLibraryAndKey: (_libraryID, key) => items.get(key),
	},
	Collections: {
		getByLibraryAndKey: (_libraryID, key) => collections.get(key),
	},
};
const sandbox = { Zotero };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: scriptPath.pathname });

const mcp = sandbox.ZoteroKPraetorMCP;
const plain = (value) => JSON.parse(JSON.stringify(value));

test("summarizeProposal resolves item titles and collection paths", () => {
	assert.equal(
		mcp.summarizeProposal("update_item_collections", {
			itemKey: "EXAMPLE1",
			addCollectionKeys: ["SUBCOLL1"],
		}),
		"Add ‘Synthetic Example A’ to Example Parent / Example Subcollection"
	);
	assert.equal(
		mcp.summarizeProposal("update_collection", {
			collectionKey: "COLLECT2",
			newName: "Example Collection",
		}),
		"Rename collection ‘EXample Collection’ to ‘Example Collection’"
	);
	assert.equal(
		mcp.summarizeProposal("update_item_fields", {
			itemKey: "EXAMPLE1",
			fields: { publisher: "Example Publisher" },
		}),
		"Set field publisher = ‘Example Publisher’ on ‘Synthetic Example A’"
	);
	assert.equal(
		mcp.summarizeProposal("create_collection", {
			name: "Example Topic",
			parentCollectionKey: "COLLECT1",
		}),
		"Create collection ‘Example Topic’ in Example Parent"
	);
});

test("summarizeProposal falls back to keys and a generic unknown-tool sentence", () => {
	assert.equal(
		mcp.summarizeProposal("update_item_tags", {
			itemKey: "MISSING1",
			add: ["example-tag"],
		}),
		"Add tag ‘example-tag’ to ‘MISSING1’"
	);
	assert.equal(
		mcp.summarizeProposal("future_tool", { value: 1 }),
		"Propose future_tool with the supplied arguments"
	);
});

test("buildInverse restores exactly the prior item fields", () => {
	assert.deepEqual(plain(mcp.buildInverse("update_item_fields", {
		itemKey: "EXAMPLE1",
		libraryID: 1,
		fields: { title: "New title", extra: "New note" },
	}, {
		libraryID: 1,
		fields: { title: "Synthetic Example A" },
	})), {
		tool: "update_item_fields",
		args: {
			itemKey: "EXAMPLE1",
			fields: { title: "Synthetic Example A", extra: "" },
			libraryID: 1,
		},
	});
});

test("buildInverse swaps only tag states that really changed", () => {
	assert.deepEqual(plain(mcp.buildInverse("update_item_tags", {
		itemKey: "EXAMPLE1",
		add: ["example-tag", "new"],
		remove: ["old", "absent"],
	}, {
		tags: ["example-tag", "old"],
	})), {
		tool: "update_item_tags",
		args: {
			itemKey: "EXAMPLE1",
			add: ["old"],
			remove: ["new"],
		},
	});
});

test("buildInverse removes only newly added collections and re-adds actual removals", () => {
	assert.deepEqual(plain(mcp.buildInverse("update_item_collections", {
		itemKey: "EXAMPLE1",
		addCollectionKeys: ["COLLECT1", "SUBCOLL1"],
		removeCollectionKeys: ["COLLECT2", "MISSING1"],
	}, {
		collectionKeys: ["COLLECT1", "COLLECT2"],
	})), {
		tool: "update_item_collections",
		args: {
			itemKey: "EXAMPLE1",
			addCollectionKeys: ["COLLECT2"],
			removeCollectionKeys: ["SUBCOLL1"],
		},
	});
});

test("buildInverse prepares empty-only collection deletion", () => {
	assert.deepEqual(plain(mcp.buildInverse("create_collection", {
		name: "Example Topic",
		parentCollectionKey: "COLLECT1",
		libraryID: 1,
	}, {
		libraryID: 1,
		existingCollectionKey: "",
	})), {
		tool: "delete_collection_if_empty",
		args: {
			collectionKey: "",
			collectionName: "Example Topic",
			created: true,
			libraryID: 1,
		},
	});
});

test("buildInverse restores a collection's prior name and parent", () => {
	assert.deepEqual(plain(mcp.buildInverse("update_collection", {
		collectionKey: "COLLECT2",
		newName: "Example Collection",
		newParentCollectionKey: "COLLECT1",
	}, {
		libraryID: 1,
		name: "EXample Collection",
		parentKey: false,
	})), {
		tool: "update_collection",
		args: {
			collectionKey: "COLLECT2",
			newName: "EXample Collection",
			newParentCollectionKey: "TOP",
			libraryID: 1,
		},
	});
});

test("clearApplied empties the applied log, persists, notifies, and returns the prior count", async () => {
	const originalPersistAppliedNow = mcp.persistAppliedNow;
	const originalNotifyProposalsChanged = mcp.notifyProposalsChanged;
	let persisted = 0;
	let notified = 0;
	mcp.applied = [{ id: 1 }, { id: 2 }, { id: 3 }];
	mcp.persistAppliedNow = async () => {
		persisted++;
	};
	mcp.notifyProposalsChanged = () => {
		notified++;
	};

	try {
		assert.equal(await mcp.clearApplied(), 3);
		assert.deepEqual(plain(mcp.applied), []);
		assert.equal(persisted, 1);
		assert.equal(notified, 1);
	}
	finally {
		mcp.applied = [];
		mcp.persistAppliedNow = originalPersistAppliedNow;
		mcp.notifyProposalsChanged = originalNotifyProposalsChanged;
	}
});

test("access ladder composes real tools while propose lists all and intercepts five", () => {
	assert.deepEqual(plain(mcp.ACCESS_LEVELS), ["read", "notes", "propose", "write", "reorganize"]);

	const profiles = Object.fromEntries(
		mcp.ACCESS_LEVELS.map((level) => [level, plain(mcp.getToolAccessProfile(level))])
	);
	assert.equal(profiles.read.listed.length, 5);
	assert.equal(profiles.notes.listed.length, 7);
	assert.equal(profiles.propose.listed.length, 12);
	assert.equal(profiles.propose.real.length, 7);
	assert.deepEqual(profiles.propose.intercepted, [
		"update_item_tags",
		"update_item_collections",
		"update_item_fields",
		"create_collection",
		"update_collection",
	]);
	assert.equal(profiles.write.listed.length, 10);
	assert.equal(profiles.write.real.length, 10);
	assert.equal(profiles.reorganize.listed.length, 12);
	assert.equal(profiles.reorganize.real.length, 12);

	const proposalTools = new Set(profiles.propose.intercepted);
	const definitions = Object.fromEntries(
		["propose", "write", "reorganize"].map((level) => [level, plain(mcp.getToolDefinitions(level))])
	);
	for (const tool of definitions.propose.filter((entry) => proposalTools.has(entry.name))) {
		assert.ok(tool.description.startsWith("PROPOSE MODE —"));
	}
	for (const level of ["write", "reorganize"]) {
		for (const tool of definitions[level].filter((entry) => proposalTools.has(entry.name))) {
			assert.ok(!tool.description.startsWith("PROPOSE MODE —"));
		}
	}

	const isSubset = (left, right) => left.every((name) => right.includes(name));
	assert.ok(isSubset(profiles.read.real, profiles.notes.real));
	assert.ok(isSubset(profiles.notes.real, profiles.propose.real));
	assert.ok(isSubset(profiles.propose.real, profiles.write.real));
	assert.ok(isSubset(profiles.write.real, profiles.reorganize.real));
});
