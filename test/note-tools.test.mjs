import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const scriptPath = new URL("../content/scripts/praetor-mcp.js", import.meta.url);
const source = await readFile(scriptPath, "utf8");
const items = new Map();
let nextNote = 1;

function makeNote({ key, parentItemID = null, tags = [], note = "" }) {
	return {
		id: 100 + nextNote++,
		key,
		libraryID: 1,
		parentItemID,
		deleted: false,
		note,
		tags: tags.map((tag) => ({ tag, type: 0 })),
		isNote: () => true,
		getTags() {
			return this.tags;
		},
		addTag(tag, type) {
			if (!this.tags.some((entry) => entry.tag === tag)) {
				this.tags.push({ tag, type });
			}
		},
		setNote(value) {
			this.note = value;
		},
		async saveTx() {
			items.set(this.key, this);
		},
	};
}

const parent = {
	id: 10,
	key: "PARENT01",
	libraryID: 1,
	deleted: false,
	isRegularItem: () => true,
};
items.set(parent.key, parent);

const sandbox = {
	Zotero: {
		Libraries: {
			userLibraryID: 1,
			get: (libraryID) => libraryID === 1 ? { libraryID } : null,
		},
		Items: {
			getByLibraryAndKey: (_libraryID, key) => items.get(key) || null,
		},
		Item: function Item(type) {
			assert.equal(type, "note");
			return makeNote({ key: `NEWNOTE${nextNote}` });
		},
	},
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: scriptPath.pathname });
const mcp = sandbox.ZoteroKPraetorMCP;

test("update_note replaces an authorized Praetor note through its parent", async () => {
	const note = makeNote({
		key: "AUTHNOTE",
		parentItemID: parent.id,
		tags: ["zys-praetor"],
	});
	items.set(note.key, note);

	const result = await mcp.toolUpdateNote({
		itemKey: parent.key,
		noteKey: note.key,
		content: "First & line\n\nSecond",
	});

	assert.equal(note.note, "<p>First &amp; line</p><p>Second</p>");
	assert.equal(result.noteKey, note.key);
});

test("update_note refuses an untagged user note", async () => {
	const note = makeNote({ key: "USERNOTE", parentItemID: parent.id });
	items.set(note.key, note);

	await assert.rejects(
		mcp.toolUpdateNote({
			itemKey: note.key,
			noteKey: note.key,
			content: "Do not write this",
		}),
		/Praetor may update only notes tagged zys-praetor or zys-praetor-smart-notes; untagged user notes cannot be edited/
	);
	assert.equal(note.note, "");
});

test("create_note always marks the new note as Praetor-authored", async () => {
	const result = await mcp.toolCreateNote({
		text: "Created by chat",
		parentItemKey: parent.key,
		tags: ["topic"],
	});
	const note = items.get(result.noteKey);

	assert.ok(note);
	assert.deepEqual(
		note.getTags().map((entry) => [entry.tag, entry.type]),
		[["topic", 0], ["zys-praetor", 0]]
	);
	assert.equal(note.parentItemID, parent.id);
});

test("update_note is a notes-tier tool and documents its authorship boundary", () => {
	const definition = mcp.TOOLS.find((tool) => tool.name === "update_note");
	assert.equal(definition.tier, "notes");
	assert.deepEqual(
		Array.from(definition.inputSchema.required),
		["itemKey", "noteKey", "content"]
	);
	assert.match(definition.description, /Restricted to Praetor-authored notes/);
});
