import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const scriptPath = new URL("../content/scripts/praetor.js", import.meta.url);
const fixturePath = (name) => new URL(`fixtures/${name}`, import.meta.url);

const source = await readFile(scriptPath, "utf8");
const sandbox = {
	addonID: "zys-praetor@zys",
	rootURI: "resource://zys-praetor/",
	Zotero: {},
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: scriptPath.pathname });

const parsers = sandbox.ZoteroKPraetor;
const plain = (value) => JSON.parse(JSON.stringify(value));

test("parseClaudeModelHandshake pins model filtering and capability flags", async () => {
	const transcript = await readFile(fixturePath("claude-model-handshake.jsonl"), "utf8");

	assert.deepEqual(plain(parsers.parseClaudeModelHandshake(transcript)), [
		{
			value: "opus",
			label: "Opus",
			description: "Most capable",
			supportsFastMode: true,
			supportsEffort: true,
		},
		{
			value: "haiku",
			label: "Haiku",
			description: "Fast and efficient",
			supportsFastMode: false,
			supportsEffort: false,
		},
	]);
});

test("parseCodexModelsCache pins visibility, priority, tiers, and reasoning order", async () => {
	const cache = await readFile(fixturePath("codex-models-cache.json"), "utf8");

	assert.deepEqual(plain(parsers.parseCodexModelsCache(cache)), [
		{
			value: "gpt-5.6-sol",
			label: "GPT-5.6-Sol",
			description: "Latest frontier agentic coding model.",
			reasoningLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
			defaultReasoningLevel: "medium",
			fastTierId: "priority",
		},
		{
			value: "gpt-5.4-mini",
			label: "GPT-5.4-Mini",
			description: "Small, fast, and cost-efficient model for simpler coding tasks.",
			reasoningLevels: ["low", "medium", "high", "xhigh"],
			defaultReasoningLevel: "medium",
			fastTierId: null,
		},
	]);
});

test("parseCodexModelListResponse pins transcript selection and response order", async () => {
	const transcript = await readFile(fixturePath("codex-model-list.stdout"), "utf8");

	assert.deepEqual(plain(parsers.parseCodexModelListResponse(transcript)), [
		{
			value: "gpt-5.6-sol",
			label: "GPT-5.6 Sol",
			description: "Latest model",
			reasoningLevels: ["low", "medium", "high", "ultra"],
			defaultReasoningLevel: "medium",
			fastTierId: "priority",
		},
		{
			value: "gpt-5.4-mini",
			label: "GPT-5.4 Mini",
			description: "Fast model",
			reasoningLevels: ["low", "medium", "high"],
			defaultReasoningLevel: "medium",
			fastTierId: null,
		},
	]);
});

test("parseClaudeModelHandshake returns null for malformed input", () => {
	for (const input of ["", "not json", '{"type":"control_response","response":{}}']) {
		assert.equal(parsers.parseClaudeModelHandshake(input), null);
	}
});

test("parseCodexModelsCache returns null for malformed input", () => {
	for (const input of ["", "not json", "{}"]) {
		assert.equal(parsers.parseCodexModelsCache(input), null);
	}
});

test("parseCodexModelListResponse returns null for malformed input", () => {
	for (const input of ["", "not json", '{"id":2,"result":{}}']) {
		assert.equal(parsers.parseCodexModelListResponse(input), null);
	}
});

test("parseCodexUsage separates cached input from fresh input", () => {
	const log = [
		JSON.stringify({
			type: "turn.completed",
			usage: {
				input_tokens: 5_000,
				cached_input_tokens: 4_200,
				output_tokens: 300,
				reasoning_output_tokens: 50,
			},
		}),
	].join("\n");

	assert.deepEqual(plain(parsers.parseCodexUsage(log)), {
		inputTokens: 5000,
		cachedInputTokens: 4200,
		freshInputTokens: 800,
		outputTokens: 350,
		turns: 1,
		costUSD: null,
	});
});

test("diffCodexUsage charges only the increment of cumulative resume usage", () => {
	assert.deepEqual(plain(parsers.diffCodexUsage(
		{ inputTokens: 9000, cachedInputTokens: 7000, outputTokens: 900, turns: 1 },
		{ inputTokens: 5000, cachedInputTokens: 4200, outputTokens: 350, turns: 1 }
	)), {
		inputTokens: 4000,
		cachedInputTokens: 2800,
		freshInputTokens: 1200,
		outputTokens: 550,
		turns: 1,
		costUSD: null,
	});
});

test("diffCodexUsage establishes a zero baseline for a legacy resumed session", () => {
	const baseline = parsers.diffCodexUsage(
		{ inputTokens: 9000, cachedInputTokens: 7000, outputTokens: 900, turns: 1 },
		null
	);
	assert.deepEqual(plain(baseline), {
		inputTokens: 0,
		cachedInputTokens: 0,
		freshInputTokens: 0,
		outputTokens: 0,
		turns: 1,
		costUSD: null,
		baselineReset: true,
	});
	const conversation = {
		usageTotals: {
			inputTokens: 21_000_000,
			outputTokens: 10_000,
			turns: 7,
			requests: 7,
		},
	};
	parsers.accumulateUsage(conversation, baseline);
	assert.equal(conversation.usageTotals, null);
});

test("fresh and resume prompts carry the Zotero capability boundary", () => {
	const context = {
		title: "Example",
		itemType: "book",
		creators: [],
		fields: {},
		attachments: [],
	};
	const fresh = parsers.buildPraetorPrompt("Revise the note", context);
	const resumed = parsers.buildPraetorResumePrompt("Revise the note", context);
	for (const prompt of [fresh, resumed]) {
		assert.match(prompt, /available Zotero abilities are exactly the MCP tools available to you/);
		assert.match(prompt, /update only Praetor-authored notes tagged zys-praetor or zys-praetor-smart-notes via update_note/);
		assert.match(prompt, /NEVER attempt computer use, app control, screen control, or approval escalation/);
		assert.match(prompt, /edit, revise, restructure, or add citations\/links to an editable note, DO IT yourself/);
		assert.match(prompt, /Suggest the Smart Notes button only when the user wants this conversation merged/);
	}
});

test("MCP prompt forbids parallel fulltext offset prefetch", () => {
	sandbox.ZoteroKPraetorMCP = {
		getToolDefinitions: () => [{ name: "get_item_fulltext" }],
		getAccessLabel: () => "Read",
	};
	const lines = parsers.buildMcpPromptLines({ key: "ITEM0001", libraryID: 1 }, {
		accessLevel: "read",
	});
	assert.match(lines.join("\n"), /one slice at a time/);
	assert.match(lines.join("\n"), /never prefetch multiple offsets/);
});

test("runtime commands follow the active home and request directory", () => {
 const runtime = Object.create(parsers);
 runtime.getHomeDir = () => "/tmp/synthetic home";
 runtime.getRuntimeReadDirs = () => [];
 const paths = { input: "/tmp/synthetic request/input.txt", output: "/tmp/out", error: "/tmp/err", log: "/tmp/log" };
 for (const provider of ["codex", "claude"]) {
  const command = runtime.buildRuntimeShellCommand(provider, paths, "");
  assert.ok(command.startsWith("cd '/tmp/synthetic request' && "));
  assert.ok(command.includes("HOME='/tmp/synthetic home'"));
  assert.ok(command.includes("/tmp/synthetic home/.local/bin"));
 }
 assert.equal(runtime.CLAUDE_PATH, "/tmp/synthetic home/.local/bin/claude");
});
