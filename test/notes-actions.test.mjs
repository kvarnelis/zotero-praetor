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

test("To Notes HTML escapes response text and preserves line breaks", () => {
	assert.equal(
		praetor.praetorPlainTextToNoteHTML("First <line> & more\n\nLast"),
		"<p>First &lt;line&gt; &amp; more<br/><br/>Last</p>"
	);
});

test("latest response ignores newer user turns", () => {
	const conversation = {
		turns: [
			{ role: "assistant", content: "Earlier answer" },
			{ role: "user", content: "Unanswered follow-up" },
		],
	};
	assert.equal(praetor.getLatestPraetorAssistantTurn(conversation).content, "Earlier answer");
});

test("To Notes marks newly created notes as Praetor-authored", async () => {
	setLibraryMocks();
	let created = null;
	sandbox.Zotero.Item = function Item(type) {
		assert.equal(type, "note");
		created = {
			tags: [],
			setNote(value) {
				this.note = value;
			},
			addTag(tag, tagType) {
				this.tags.push({ tag, type: tagType });
			},
			async saveTx() {},
		};
		return created;
	};
	const item = {
		id: 12,
		key: "ITEM0001",
		libraryID: 1,
		isRegularItem: () => true,
	};

	await praetor.createPraetorResponseNote(item, "Saved response");

	assert.deepEqual(created.tags, [{ tag: "zys-praetor", type: 0 }]);
	assert.equal(created.parentItemID, item.id);
});

test("Smart Notes update target requires both Praetor tag and fixed header", () => {
	const makeNote = (html, tags) => ({
		deleted: false,
		getNote: () => html,
		getTags: () => tags.map((tag) => ({ tag })),
	});
	assert.equal(praetor.isPraetorSmartNote(makeNote(
		"<p><strong>Praetor Smart Notes</strong></p><p>Body</p>",
		["zys-praetor-smart-notes"]
	)), true);
	assert.equal(praetor.isPraetorSmartNote(makeNote(
		"<p><strong>Praetor Smart Notes</strong></p><p>Body</p>",
		[]
	)), false);
	assert.equal(praetor.isPraetorSmartNote(makeNote(
		"<p>User-authored note</p>",
		["zys-praetor-smart-notes"]
	)), false);
});

test("Smart Notes prompt carries every stored turn and integration rules", () => {
	const item = {
		key: "ABCD1234",
		getDisplayTitle: () => "Example",
	};
	const conversation = {
		turns: [
			{ role: "user", content: "Initial question", createdAt: 1 },
			{ role: "assistant", content: "Initial answer", createdAt: 2 },
			{ role: "user", content: "Correction", createdAt: 3 },
			{ role: "assistant", content: "Corrected answer", createdAt: 4 },
		],
	};
	const prompt = praetor.buildPraetorSmartNotesPrompt(item, conversation, [
		{ key: "NOTE1234", praetorSmartNote: false, text: "Existing fact" },
	]);
	for (const text of ["Initial question", "Initial answer", "Correction", "Corrected answer", "Existing fact"]) {
		assert.match(prompt, new RegExp(text));
	}
	assert.match(prompt, /do not transcribe/i);
	assert.match(prompt, /prefer the later turn/i);
	assert.match(prompt, /read-only source context/i);
	assert.match(prompt, /\{\{page: N\}\}/);
	assert.match(prompt, /\{\{item: <creator> <title fragment>\}\}/);
	assert.match(prompt, /Never write Zotero URIs/i);
	assert.match(prompt, /This is a WRITING task/);
	assert.match(prompt, /you have no tools/i);
	assert.match(prompt, /===ZYS NOTE BEGIN===/);
	assert.match(prompt, /===ZYS NOTE END===/);
	assert.doesNotMatch(prompt, /ABCD1234|NOTE1234/);
});

test("Smart Notes extracts a sentinel-framed body and strips sentinel lines", () => {
	assert.equal(
		praetor.extractPraetorSmartNoteBody(
			"===ZYS NOTE BEGIN===\nFirst point\n\nSecond point\n===ZYS NOTE END==="
		),
		"First point\n\nSecond point"
	);
});

test("Smart Notes ignores preamble and trailing noise outside sentinels", () => {
	assert.equal(
		praetor.extractPraetorSmartNoteBody(
			"Preamble that must not be saved.\n===ZYS NOTE BEGIN===\nUseful body\n===ZYS NOTE END===\nTrailing chatter."
		),
		"Useful body"
	);
});

test("Smart Notes rejects a runtime refusal without sentinels", () => {
	const refusal = "I still can't edit existing notes because Zotero app control is disabled. Please enable access to Zotero; then I'll update note **YDQDDWQ8** in place, without creating anything new.";
	assert.throws(
		() => praetor.extractPraetorSmartNoteBody(refusal),
		(error) => {
			assert.match(error.message, /missing valid sentinel framing/i);
			assert.match(error.message, /I still can't edit existing notes/);
			assert.match(error.message, /no note was modified/i);
			return true;
		}
	);
});

test("Smart Notes rejects an empty sentinel body", () => {
	assert.throws(
		() => praetor.extractPraetorSmartNoteBody(
			"===ZYS NOTE BEGIN===\n \n===ZYS NOTE END==="
		),
		(error) => {
			assert.match(error.message, /empty sentinel body/i);
			assert.match(error.message, /no note was modified/i);
			return true;
		}
	);
});

function setLibraryMocks({ items = new Map(), searchIDs = [], libraryType = "user", groupID = 0 } = {}) {
	sandbox.Zotero.Libraries = {
		userLibraryID: 1,
		get: () => ({ libraryType }),
	};
	sandbox.Zotero.Groups = {
		getGroupIDFromLibraryID: () => groupID,
	};
	sandbox.Zotero.Items = {
		get: (id) => items.get(id) || null,
	};
	sandbox.Zotero.Search = class {
		addCondition() {}
		async search() {
			return searchIDs;
		}
	};
}

function makeParent(overrides = {}) {
	return {
		id: 1,
		key: "PARENT01",
		libraryID: 1,
		isRegularItem: () => true,
		getBestAttachments: async () => [],
		...overrides,
	};
}

function makeRegularItem({ id, key, title, creators = [], libraryID = 1 }) {
	return {
		id,
		key,
		libraryID,
		deleted: false,
		isRegularItem: () => true,
		getDisplayTitle: () => title,
		getCreators: () => creators,
	};
}

test("Smart Notes escapes first and converts page markers to PDF links", async () => {
	setLibraryMocks();
	const pdf = {
		key: "PDF12345",
		libraryID: 1,
		deleted: false,
		isPDFAttachment: () => true,
	};
	const parent = makeParent({ getBestAttachments: async () => [pdf] });
	assert.equal(
		await praetor.praetorSmartNoteTextToHTML(
			parent,
			"Use <claim> & p. 143{{page: 143}}."
		),
		'<p>Use &lt;claim&gt; &amp; <a href="zotero://open-pdf/library/items/PDF12345?page=143">p. 143</a>.</p>'
	);
});

test("Smart Notes page markers fall back to plain text when there is no PDF", async () => {
	setLibraryMocks();
	assert.equal(
		await praetor.praetorSmartNoteTextToHTML(
			makeParent(),
			"See p. 143{{page: 143}} for the argument."
		),
		"<p>See p. 143 for the argument.</p>"
	);
});

test("Smart Notes resolves one unique other work and links its visible title", async () => {
	const other = makeRegularItem({
		id: 2,
		key: "OTHER001",
		title: "Other Work",
		creators: [{ firstName: "Jane", lastName: "Smith" }],
	});
	setLibraryMocks({ items: new Map([[2, other]]), searchIDs: [2] });
	assert.equal(
		await praetor.praetorSmartNoteTextToHTML(
			makeParent(),
			"Smith's Other Work{{item: Smith Other Work}} develops the point."
		),
		'<p>Smith\'s <a href="zotero://select/library/items/OTHER001">Other Work</a> develops the point.</p>'
	);
});

test("Smart Notes leaves ambiguous item mentions plain", async () => {
	const first = makeRegularItem({ id: 2, key: "OTHER001", title: "Other Work" });
	const second = makeRegularItem({ id: 3, key: "OTHER002", title: "Other Work Revised" });
	setLibraryMocks({
		items: new Map([[2, first], [3, second]]),
		searchIDs: [2, 3],
	});
	assert.equal(
		await praetor.praetorSmartNoteTextToHTML(
			makeParent(),
			"Other Work{{item: Smith Other Work}} remains useful."
		),
		"<p>Other Work remains useful.</p>"
	);
});

test("Smart Notes neutralizes malicious markers and emits no non-Zotero anchors", async () => {
	setLibraryMocks();
	const html = await praetor.praetorSmartNoteTextToHTML(
		makeParent(),
		'Work{{item: <a href="http://evil">x</a>}} and {{item: javascript:alert(1)}}'
	);
	assert.match(html, /&lt;a href="http:\/\/evil"&gt;x&lt;\/a&gt;/);
	assert.doesNotMatch(html, /<a\b[^>]*href="(?!zotero:\/\/(?:select|open-pdf)\/)/i);
	assert.doesNotMatch(html, /<script|<a\b[^>]*href="javascript:/i);
});

test("Praetor Zotero links use group IDs for group libraries", () => {
	setLibraryMocks({ libraryType: "group", groupID: 42 });
	assert.equal(
		praetor.buildPraetorZoteroHref("select", {
			key: "GROUP001",
			libraryID: 7,
		}),
		"zotero://select/groups/42/items/GROUP001"
	);
});
