var ZoteroKPraetorMCP = {
	ENDPOINT_PATH: "/zys-praetor/mcp",
	PREF_MCP_ACCESS: "zoteroKPraetor.mcp.access",
	PREF_MCP_TOKEN: "zoteroKPraetor.mcp.token",
	DEFAULT_ACCESS: "read",
	ACCESS_LEVELS: ["read", "notes", "propose", "write", "reorganize"],
	ACCESS_LABELS: {
		read: "Read",
		notes: "Add notes",
		propose: "Propose changes",
		write: "Edit items",
		reorganize: "Reorganize",
	},
	PROPOSAL_TOOLS: [
		"update_item_tags",
		"update_item_collections",
		"update_item_fields",
		"create_collection",
		"update_collection",
	],
	PROPOSALS_FILENAME: "zys-praetor-proposals.json",
	MAX_PROPOSALS: 500,
	APPLIED_FILENAME: "zys-praetor-applied.json",
	MAX_APPLIED: 100,
	PROTOCOL_VERSIONS: ["2025-06-18", "2025-03-26", "2024-11-05"],
	DEFAULT_PROTOCOL_VERSION: "2025-03-26",
	SERVER_NAME: "zys-praetor-zotero",
	SERVER_VERSION: "0.4.0",
	MAX_RESULTS: 50,
	DEFAULT_RESULTS: 20,
	MAX_COLLECTIONS: 500,
	MAX_FULLTEXT_CHARS: 20000,
	MIN_FULLTEXT_CHARS: 500,
	FULLTEXT_CACHE_TTL_MS: 15 * 60 * 1000,
	MAX_FULLTEXT_CACHE_ENTRIES: 200,
	MAX_NOTE_CHARS: 100000,
	NOTE_PREVIEW_CHARS: 300,
	PRAETOR_NOTE_TAG: "zys-praetor",
	PRAETOR_SMART_NOTE_TAG: "zys-praetor-smart-notes",
	ITEM_KEY_PATTERN: /^[A-Z0-9]{8}$/,
	FIELD_ALLOWLIST: [
		"title",
		"date",
		"abstractNote",
		"publicationTitle",
		"publisher",
		"place",
		"volume",
		"issue",
		"pages",
		"edition",
		"DOI",
		"ISBN",
		"url",
		"language",
		"shortTitle",
		"extra",
	],
	token: null,
	registerRetryTimer: null,
	proposals: [],
	proposalNextID: 1,
	proposalPersistChain: Promise.resolve(),
	applied: [],
	appliedPersistChain: Promise.resolve(),
	fulltextCache: new Map(),

	TOOLS: [
		{
			name: "search_library",
			tier: "read",
			handler: "toolSearchLibrary",
			description: "Search the user's Zotero library. Modes: everything (metadata, tags, notes, and indexed full text), metadata (title/creator/year only), fulltext (indexed attachment text only). Returns compact item summaries.",
			inputSchema: {
				type: "object",
				properties: {
					query: { type: "string", description: "Search terms (at least 2 characters)." },
					mode: { type: "string", enum: ["everything", "metadata", "fulltext"], description: "Search mode. Default: everything." },
					tag: { type: "string", description: "Restrict results to items with a tag containing this text." },
					itemType: { type: "string", description: "Restrict to a Zotero item type, e.g. book, journalArticle." },
					libraryID: { type: "integer", description: "Zotero library ID. Default: the user library." },
					limit: { type: "integer", description: "Maximum results (default 20, max 50)." },
				},
				required: ["query"],
			},
		},
		{
			name: "get_item",
			tier: "read",
			handler: "toolGetItem",
			description: "Get full metadata for one Zotero item: fields, creators, tags, collections, note previews, and attachments with file paths.",
			inputSchema: {
				type: "object",
				properties: {
					itemKey: { type: "string", description: "8-character Zotero item key." },
					libraryID: { type: "integer", description: "Zotero library ID. Default: the user library." },
				},
				required: ["itemKey"],
			},
		},
		{
			name: "get_item_fulltext",
			tier: "read",
			handler: "toolGetItemFulltext",
			description: "Get the indexed full text of a Zotero item's attachment, paged in slices. Use offset with the returned nextOffset to read further pages; use maxChars 4000 for batch work.",
			inputSchema: {
				type: "object",
				properties: {
					itemKey: { type: "string", description: "8-character Zotero item key (a regular item or an attachment)." },
					attachmentKey: { type: "string", description: "Optional 8-character key of a specific attachment of the item." },
					offset: { type: "integer", description: "Character offset to start from. Default 0." },
					maxChars: { type: "integer", description: "Maximum characters to return (min 500, max and default 20000; use 4000 for batch work)." },
					refresh: { type: "boolean", description: "Force re-fetch even if this slice was recently retrieved." },
					libraryID: { type: "integer", description: "Zotero library ID. Default: the user library." },
				},
				required: ["itemKey"],
			},
		},
		{
			name: "list_collections",
			tier: "read",
			handler: "toolListCollections",
			description: "List the collections in a Zotero library as a flat list with parent keys.",
			inputSchema: {
				type: "object",
				properties: {
					libraryID: { type: "integer", description: "Zotero library ID. Default: the user library." },
				},
			},
		},
		{
			name: "get_collection_items",
			tier: "read",
			handler: "toolGetCollectionItems",
			description: "List the items in one Zotero collection as compact summaries.",
			inputSchema: {
				type: "object",
				properties: {
					collectionKey: { type: "string", description: "8-character Zotero collection key." },
					libraryID: { type: "integer", description: "Zotero library ID. Default: the user library." },
					limit: { type: "integer", description: "Maximum results (default 20, max 50)." },
				},
				required: ["collectionKey"],
			},
		},
		{
			name: "create_note",
			tier: "notes",
			handler: "toolCreateNote",
			description: "Create a Zotero note. Attach it to a parent item, place it in a collection, or leave it standalone. Plain text is wrapped as HTML paragraphs.",
			inputSchema: {
				type: "object",
				properties: {
					text: { type: "string", description: "Note content, HTML or plain text." },
					parentItemKey: { type: "string", description: "Optional 8-character key of the item to attach the note to." },
					collectionKey: { type: "string", description: "Optional 8-character collection key for a standalone note. Ignored when parentItemKey is set." },
					tags: { type: "array", items: { type: "string" }, description: "Optional tags for the note." },
					libraryID: { type: "integer", description: "Zotero library ID. Default: the user library." },
				},
				required: ["text"],
			},
		},
		{
			name: "update_note",
			tier: "notes",
			handler: "toolUpdateNote",
			description: "Replace a Zotero note with plain-text content. Restricted to Praetor-authored notes tagged zys-praetor or zys-praetor-smart-notes; untagged user notes can never be edited.",
			inputSchema: {
				type: "object",
				properties: {
					itemKey: { type: "string", description: "8-character key of the target note itself or its parent item." },
					noteKey: { type: "string", description: "8-character key of the note to update." },
					content: { type: "string", description: "Replacement note content as plain text." },
					libraryID: { type: "integer", description: "Zotero library ID. Default: the user library." },
				},
				required: ["itemKey", "noteKey", "content"],
			},
		},
		{
			name: "update_item_tags",
			tier: "write",
			handler: "toolUpdateItemTags",
			description: "Add or remove tags on a Zotero item.",
			inputSchema: {
				type: "object",
				properties: {
					itemKey: { type: "string", description: "8-character Zotero item key." },
					add: { type: "array", items: { type: "string" }, description: "Tags to add." },
					remove: { type: "array", items: { type: "string" }, description: "Tags to remove." },
					libraryID: { type: "integer", description: "Zotero library ID. Default: the user library." },
				},
				required: ["itemKey"],
			},
		},
		{
			name: "update_item_collections",
			tier: "write",
			handler: "toolUpdateItemCollections",
			description: "Add a Zotero item to collections or remove it from collections.",
			inputSchema: {
				type: "object",
				properties: {
					itemKey: { type: "string", description: "8-character Zotero item key." },
					addCollectionKeys: { type: "array", items: { type: "string" }, description: "Collection keys to add the item to." },
					removeCollectionKeys: { type: "array", items: { type: "string" }, description: "Collection keys to remove the item from." },
					libraryID: { type: "integer", description: "Zotero library ID. Default: the user library." },
				},
				required: ["itemKey"],
			},
		},
		{
			name: "update_item_fields",
			tier: "write",
			handler: "toolUpdateItemFields",
			description: "Update metadata fields on a Zotero item. Allowed fields: title, date, abstractNote, publicationTitle, publisher, place, volume, issue, pages, edition, DOI, ISBN, url, language, shortTitle, extra.",
			inputSchema: {
				type: "object",
				properties: {
					itemKey: { type: "string", description: "8-character Zotero item key." },
					fields: { type: "object", description: "Field name to new value map. Only allowed fields are accepted." },
					libraryID: { type: "integer", description: "Zotero library ID. Default: the user library." },
				},
				required: ["itemKey", "fields"],
			},
		},
		{
			name: "create_collection",
			tier: "reorganize",
			handler: "toolCreateCollection",
			description: "Create a Zotero collection, optionally within an existing parent collection. Returns an existing sibling with the same name instead of creating a duplicate.",
			inputSchema: {
				type: "object",
				properties: {
					name: { type: "string", description: "Collection name." },
					parentCollectionKey: { type: "string", description: "Optional 8-character key of the parent collection. Omit for a top-level collection." },
					libraryID: { type: "integer", description: "Zotero library ID. Default: the user library." },
				},
				required: ["name"],
			},
		},
		{
			name: "update_collection",
			tier: "reorganize",
			handler: "toolUpdateCollection",
			description: "Rename or move a Zotero collection. Use TOP as the new parent key to move the collection to the top level.",
			inputSchema: {
				type: "object",
				properties: {
					collectionKey: { type: "string", description: "8-character Zotero collection key." },
					newName: { type: "string", description: "Optional new collection name." },
					newParentCollectionKey: { type: "string", description: "Optional 8-character key of the new parent collection, or TOP to move to the top level." },
					libraryID: { type: "integer", description: "Zotero library ID. Default: the user library." },
				},
				required: ["collectionKey"],
			},
		},
	],

	register() {
		if (this.token) {
			return;
		}
		if (!Zotero.Server?.Endpoints) {
			this.registerRetryTimer = setTimeout(() => this.register(), 250);
			return;
		}
		this.registerRetryTimer = null;
		let token = null;
		try {
			const value = Zotero.Prefs.get(this.PREF_MCP_TOKEN);
			if (typeof value === "string" && /^[A-Za-z0-9]{32}$/.test(value)) {
				token = value;
			}
		}
		catch (_) {}
		if (!token) {
			token = Zotero.Utilities.randomString(32);
			Zotero.Prefs.set(this.PREF_MCP_TOKEN, token);
		}
		this.token = token;
		const self = this;
		const Endpoint = function () {};
		Endpoint.prototype = {
			supportedMethods: ["POST"],
			supportedDataTypes: ["application/json"],
			init: function (requestData) {
				return self.handleRequest(requestData);
			},
		};
		Zotero.Server.Endpoints[this.ENDPOINT_PATH] = Endpoint;
		Zotero.debug(`Praetor MCP: registered ${this.ENDPOINT_PATH}`);
	},

	unregister() {
		if (this.registerRetryTimer) {
			clearTimeout(this.registerRetryTimer);
			this.registerRetryTimer = null;
		}
		if (Zotero.Server?.Endpoints?.[this.ENDPOINT_PATH]) {
			delete Zotero.Server.Endpoints[this.ENDPOINT_PATH];
		}
		this.token = null;
	},

	getAccessLevel() {
		try {
			const value = Zotero.Prefs.get(this.PREF_MCP_ACCESS);
			return this.ACCESS_LEVELS.includes(value) ? value : this.DEFAULT_ACCESS;
		}
		catch (_) {
			return this.DEFAULT_ACCESS;
		}
	},

	getAccessLabel(level) {
		return this.ACCESS_LABELS[level] || this.ACCESS_LABELS[this.DEFAULT_ACCESS];
	},

	getRuntimeWiring() {
		if (!this.token || !Zotero.Server?.Endpoints?.[this.ENDPOINT_PATH]) {
			return { enabled: false, reason: "Praetor library endpoint is not registered" };
		}
		let port = null;
		try {
			port = Zotero.Server.port;
		}
		catch (_) {
			port = null;
		}
		if (!port) {
			return { enabled: false, reason: "Zotero HTTP server is disabled" };
		}
		return {
			enabled: true,
			url: `http://127.0.0.1:${port}${this.ENDPOINT_PATH}`,
			token: this.token,
			accessLevel: this.getAccessLevel(),
		};
	},

	async handleRequest(requestData) {
		try {
			const auth = requestData?.headers?.authorization || "";
			if (!this.token || auth !== `Bearer ${this.token}`) {
				return [403, "text/plain", "Forbidden"];
			}
			const data = requestData?.data;
			if (Array.isArray(data)) {
				const responses = [];
				for (const message of data) {
					const response = await this.handleMessage(message);
					if (response) {
						responses.push(response);
					}
				}
				if (!responses.length) {
					return 204;
				}
				return [200, "application/json", JSON.stringify(responses)];
			}
			const response = await this.handleMessage(data);
			if (!response) {
				return 204;
			}
			return [200, "application/json", JSON.stringify(response)];
		}
		catch (err) {
			Zotero.debug(`Praetor MCP: request failed: ${err instanceof Error ? err.message : String(err)}`);
			return [500, "text/plain", "Internal error"];
		}
	},

	async handleMessage(message) {
		if (!message || typeof message !== "object") {
			return this.rpcError(null, -32600, "Invalid request");
		}
		const id = message.id;
		if (id === undefined || id === null) {
			// Notifications (notifications/initialized, notifications/cancelled, ...) get no response.
			return null;
		}
		const method = String(message.method || "");
		try {
			if (method === "initialize") {
				return this.rpcResult(id, this.handleInitialize(message.params));
			}
			if (method === "ping") {
				return this.rpcResult(id, {});
			}
			if (method === "tools/list") {
				return this.rpcResult(id, { tools: this.getToolDefinitions(this.getAccessLevel()) });
			}
			if (method === "tools/call") {
				return this.rpcResult(id, await this.handleToolCall(message.params));
			}
			return this.rpcError(id, -32601, `Method not found: ${method}`);
		}
		catch (err) {
			Zotero.debug(`Praetor MCP: ${method} failed: ${err instanceof Error ? err.message : String(err)}`);
			return this.rpcError(id, -32603, err instanceof Error ? err.message : "Internal error");
		}
	},

	handleInitialize(params) {
		const requested = String(params?.protocolVersion || "");
		return {
			protocolVersion: this.PROTOCOL_VERSIONS.includes(requested) ? requested : this.DEFAULT_PROTOCOL_VERSION,
			capabilities: {
				tools: { listChanged: false },
			},
			serverInfo: {
				name: this.SERVER_NAME,
				version: this.SERVER_VERSION,
			},
		};
	},

	getToolDefinitions(level) {
		return this.TOOLS
			.filter((tool) => this.getToolAccessMode(tool, level) !== "unavailable")
			.map((tool) => ({
				name: tool.name,
				description: level === "propose" && this.PROPOSAL_TOOLS.includes(tool.name)
					? `PROPOSE MODE — calling this records a pending proposal for the owner's approval; nothing changes until they apply it. ${tool.description}`
					: tool.description,
				inputSchema: tool.inputSchema,
			}));
	},

	tierAllowed(tier, level) {
		const rank = { read: 0, notes: 1, propose: 2, write: 3, reorganize: 4 };
		return (rank[tier] ?? 4) <= (rank[level] ?? 0);
	},

	getToolAccessMode(toolOrName, level) {
		const tool = typeof toolOrName === "string"
			? this.TOOLS.find((entry) => entry.name === toolOrName)
			: toolOrName;
		if (!tool || !this.ACCESS_LEVELS.includes(level)) {
			return "unavailable";
		}
		if (level === "propose") {
			if (this.PROPOSAL_TOOLS.includes(tool.name)) {
				return "proposal";
			}
			return this.tierAllowed(tool.tier, "notes") ? "real" : "unavailable";
		}
		return this.tierAllowed(tool.tier, level) ? "real" : "unavailable";
	},

	getToolAccessProfile(level) {
		const profile = { listed: [], real: [], intercepted: [] };
		for (const tool of this.TOOLS) {
			const mode = this.getToolAccessMode(tool, level);
			if (mode !== "unavailable") {
				profile.listed.push(tool.name);
			}
			if (mode === "real") {
				profile.real.push(tool.name);
			}
			else if (mode === "proposal") {
				profile.intercepted.push(tool.name);
			}
		}
		return profile;
	},

	async handleToolCall(params) {
		const name = String(params?.name || "");
		const tool = this.TOOLS.find((entry) => entry.name === name);
		if (!tool) {
			return this.toolError(`Unknown tool: ${name}`);
		}
		const level = this.getAccessLevel();
		const mode = this.getToolAccessMode(tool, level);
		if (mode === "unavailable") {
			return this.toolError(
				`Denied: tool "${name}" requires "${this.getAccessLabel(tool.tier)}" access; the Praetor library access setting is "${this.getAccessLabel(level)}".`
			);
		}
		try {
			if (mode === "proposal") {
				const proposal = await this.recordProposal(name, params?.arguments || {});
				return {
					content: [{
						type: "text",
						text: `Recorded as proposal #${proposal.id} (pending owner approval): ${proposal.summary}. Nothing was changed.`,
					}],
				};
			}
			const result = await this[tool.handler](params?.arguments || {});
			return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }] };
		}
		catch (err) {
			return this.toolError(err instanceof Error ? err.message : String(err));
		}
	},

	toolError(text) {
		return { content: [{ type: "text", text }], isError: true };
	},

	rpcResult(id, result) {
		return { jsonrpc: "2.0", id, result };
	},

	rpcError(id, code, message) {
		return { jsonrpc: "2.0", id, error: { code, message } };
	},

	getProposalsPath() {
		return PathUtils.join(Zotero.DataDirectory.dir, this.PROPOSALS_FILENAME);
	},

	getAppliedPath() {
		return PathUtils.join(Zotero.DataDirectory.dir, this.APPLIED_FILENAME);
	},

	getIOUtils() {
		if (typeof IOUtils !== "undefined") {
			return IOUtils;
		}
		return ChromeUtils.importESModule("resource://gre/modules/IOUtils.sys.mjs").IOUtils;
	},

	cloneProposalValue(value) {
		return JSON.parse(JSON.stringify(value));
	},

	getProposals() {
		return this.cloneProposalValue(this.proposals);
	},

	getApplied() {
		return this.cloneProposalValue(this.applied);
	},

	async loadProposals() {
		let raw = "";
		try {
			raw = await this.getIOUtils().readUTF8(this.getProposalsPath());
		}
		catch (_) {
			return;
		}
		try {
			const parsed = JSON.parse(raw);
			const entries = Array.isArray(parsed?.proposals) ? parsed.proposals : [];
			this.proposals = entries
				.filter((entry) => entry && Number.isInteger(entry.id) && this.PROPOSAL_TOOLS.includes(entry.tool))
				.slice(-this.MAX_PROPOSALS)
				.map((entry) => ({
					id: entry.id,
					ts: Number(entry.ts) || 0,
					tool: entry.tool,
					args: entry.args && typeof entry.args === "object" ? entry.args : {},
					summary: String(entry.summary || this.summarizeProposal(entry.tool, entry.args)),
				}));
			const highestID = this.proposals.reduce((highest, entry) => Math.max(highest, entry.id), 0);
			const storedNextID = Number.isInteger(parsed?.nextID) ? parsed.nextID : 1;
			this.proposalNextID = Math.max(1, highestID + 1, storedNextID);
		}
		catch (err) {
			Zotero.debug(`Praetor MCP: parse proposals failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	},

	async persistProposalsNow() {
		const payload = JSON.stringify({
			version: 1,
			nextID: this.proposalNextID,
			proposals: this.proposals,
		});
		const write = () => this.getIOUtils().writeUTF8(this.getProposalsPath(), payload);
		this.proposalPersistChain = this.proposalPersistChain.then(write, write);
		await this.proposalPersistChain;
	},

	async loadApplied() {
		let raw = "";
		try {
			raw = await this.getIOUtils().readUTF8(this.getAppliedPath());
		}
		catch (_) {
			return;
		}
		try {
			const parsed = JSON.parse(raw);
			const entries = Array.isArray(parsed?.applied) ? parsed.applied : [];
			this.applied = entries
				.filter((entry) => entry && Number.isInteger(entry.id) && this.PROPOSAL_TOOLS.includes(entry.tool))
				.slice(-this.MAX_APPLIED)
				.map((entry) => ({
					id: entry.id,
					ts: Number(entry.ts) || 0,
					tool: entry.tool,
					args: entry.args && typeof entry.args === "object" ? entry.args : {},
					inverse: entry.inverse && typeof entry.inverse === "object" ? entry.inverse : {},
					summary: String(entry.summary || this.summarizeProposal(entry.tool, entry.args)),
					undoSummary: String(entry.undoSummary || "Undo the applied change"),
				}));
		}
		catch (err) {
			Zotero.debug(`Praetor MCP: parse applied log failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	},

	async persistAppliedNow() {
		const payload = JSON.stringify({
			version: 1,
			applied: this.applied,
		});
		const write = () => this.getIOUtils().writeUTF8(this.getAppliedPath(), payload);
		this.appliedPersistChain = this.appliedPersistChain.then(write, write);
		await this.appliedPersistChain;
	},

	async recordProposal(tool, args) {
		if (!this.PROPOSAL_TOOLS.includes(tool)) {
			throw new Error(`Tool cannot be proposed: ${tool}`);
		}
		const proposalArgs = this.cloneProposalValue(args || {});
		const proposal = {
			id: this.proposalNextID++,
			ts: Date.now(),
			tool,
			args: proposalArgs,
			summary: this.summarizeProposal(tool, proposalArgs),
		};
		this.proposals.push(proposal);
		if (this.proposals.length > this.MAX_PROPOSALS) {
			this.proposals.splice(0, this.proposals.length - this.MAX_PROPOSALS);
		}
		await this.persistProposalsNow();
		this.notifyProposalsChanged();
		Zotero.debug(`Praetor MCP: recorded proposal #${proposal.id} (${tool})`);
		return this.cloneProposalValue(proposal);
	},

	buildInverse(tool, args, priorState = {}) {
		const cleanList = (values, transform = (value) => value) => {
			const seen = new Set();
			const result = [];
			for (const value of Array.isArray(values) ? values : []) {
				const cleaned = transform(String(value ?? "").trim());
				if (cleaned && !seen.has(cleaned)) {
					seen.add(cleaned);
					result.push(cleaned);
				}
			}
			return result;
		};
		const baseArgs = (values) => {
			const result = { ...values };
			const libraryID = priorState.libraryID ?? args?.libraryID;
			if (libraryID !== undefined && libraryID !== null) {
				result.libraryID = libraryID;
			}
			return result;
		};

		if (tool === "update_item_fields") {
			const fields = {};
			for (const name of Object.keys(args?.fields || {})) {
				fields[name] = Object.prototype.hasOwnProperty.call(priorState.fields || {}, name)
					? priorState.fields[name]
					: "";
			}
			return {
				tool,
				args: baseArgs({ itemKey: args?.itemKey, fields }),
			};
		}

		if (tool === "update_item_tags") {
			const prior = new Set(cleanList(priorState.tags));
			const add = cleanList(args?.add);
			const remove = cleanList(args?.remove);
			const removedByRequest = new Set(remove);
			return {
				tool,
				args: baseArgs({
					itemKey: args?.itemKey,
					add: remove.filter((tag) => prior.has(tag)),
					remove: add.filter((tag) => !prior.has(tag) && !removedByRequest.has(tag)),
				}),
			};
		}

		if (tool === "update_item_collections") {
			const normalizeKey = (value) => value.toUpperCase();
			const prior = new Set(cleanList(priorState.collectionKeys || priorState.collections, normalizeKey));
			const add = cleanList(args?.addCollectionKeys, normalizeKey);
			const remove = cleanList(args?.removeCollectionKeys, normalizeKey);
			const removedByRequest = new Set(remove);
			return {
				tool,
				args: baseArgs({
					itemKey: args?.itemKey,
					addCollectionKeys: remove.filter((key) => prior.has(key)),
					removeCollectionKeys: add.filter((key) => !prior.has(key) && !removedByRequest.has(key)),
				}),
			};
		}

		if (tool === "create_collection") {
			return {
				tool: "delete_collection_if_empty",
				args: baseArgs({
					collectionKey: priorState.existingCollectionKey || "",
					collectionName: String(args?.name || "").trim(),
					created: !priorState.existingCollectionKey,
				}),
			};
		}

		if (tool === "update_collection") {
			return {
				tool,
				args: baseArgs({
					collectionKey: args?.collectionKey,
					newName: priorState.name ?? "",
					newParentCollectionKey: priorState.parentKey || priorState.parentCollectionKey || "TOP",
				}),
			};
		}

		throw new Error(`Cannot build inverse for tool: ${tool}`);
	},

	capturePriorState(tool, args) {
		if (tool === "update_item_fields") {
			const item = this.getItemByKey(args);
			const fields = {};
			for (const name of Object.keys(args?.fields || {})) {
				const value = item.getField(name);
				fields[name] = value === false || value === null || value === undefined ? "" : String(value);
			}
			return { libraryID: item.libraryID, fields };
		}
		if (tool === "update_item_tags") {
			const item = this.getItemByKey(args);
			return { libraryID: item.libraryID, tags: item.getTags().map((entry) => entry.tag) };
		}
		if (tool === "update_item_collections") {
			const item = this.getItemByKey(args);
			const collectionKeys = [];
			for (const collectionID of item.getCollections()) {
				const collection = Zotero.Collections.get(collectionID);
				if (collection) {
					collectionKeys.push(collection.key);
				}
			}
			return { libraryID: item.libraryID, collectionKeys };
		}
		if (tool === "create_collection") {
			const name = String(args?.name || "").trim();
			const libraryID = this.resolveLibraryID(args);
			let parentKey = false;
			if (args?.parentCollectionKey !== undefined && args?.parentCollectionKey !== null) {
				parentKey = this.getCollectionByKey(
					{ libraryID, parentCollectionKey: args.parentCollectionKey },
					"parentCollectionKey"
				).key;
			}
			const existing = (Zotero.Collections.getByLibrary(libraryID, true) || [])
				.find((collection) => collection.name === name && (collection.parentKey || false) === parentKey);
			return { libraryID, parentKey, existingCollectionKey: existing?.key || "" };
		}
		if (tool === "update_collection") {
			const collection = this.getCollectionByKey(args, "collectionKey");
			return {
				libraryID: collection.libraryID,
				name: collection.name,
				parentKey: collection.parentKey || false,
			};
		}
		throw new Error(`Cannot capture inverse state for tool: ${tool}`);
	},

	completeInverse(tool, inverse, result) {
		const completed = this.cloneProposalValue(inverse);
		if (tool === "create_collection") {
			completed.args.collectionKey = result?.collectionKey || completed.args.collectionKey;
			completed.args.created = result?.created !== false && completed.args.created !== false;
		}
		return completed;
	},

	summarizeInverse(inverse) {
		const summary = this.summarizeProposal(inverse.tool, inverse.args);
		if (inverse.tool === "update_item_fields") {
			return summary.replace(/^Set fields? /, "Restore ");
		}
		if (inverse.tool === "update_item_tags"
			&& !(inverse.args?.add?.length || inverse.args?.remove?.length)) {
			return `No tag changes to undo on ‘${this.getProposalItemLabel(inverse.args)}’`;
		}
		if (inverse.tool === "update_item_collections"
			&& !(inverse.args?.addCollectionKeys?.length || inverse.args?.removeCollectionKeys?.length)) {
			return `No filing changes to undo on ‘${this.getProposalItemLabel(inverse.args)}’`;
		}
		return summary;
	},

	async applyProposal(id) {
		const proposal = this.proposals.find((entry) => entry.id === Number(id));
		if (!proposal) {
			throw new Error(`Proposal not found: ${id}`);
		}
		const tool = this.TOOLS.find((entry) => entry.name === proposal.tool);
		if (!tool || !this.PROPOSAL_TOOLS.includes(tool.name) || typeof this[tool.handler] !== "function") {
			throw new Error(`Proposal tool is unavailable: ${proposal.tool}`);
		}
		const args = this.cloneProposalValue(proposal.args);
		const priorState = this.capturePriorState(proposal.tool, args);
		let inverse = this.buildInverse(proposal.tool, args, priorState);
		const result = await this[tool.handler](args);
		inverse = this.completeInverse(proposal.tool, inverse, result);
		const applied = {
			id: proposal.id,
			ts: Date.now(),
			tool: proposal.tool,
			args: this.cloneProposalValue(proposal.args),
			inverse,
			summary: proposal.summary,
			undoSummary: this.summarizeInverse(inverse),
		};
		this.applied.push(applied);
		if (this.applied.length > this.MAX_APPLIED) {
			this.applied.splice(0, this.applied.length - this.MAX_APPLIED);
		}
		this.proposals = this.proposals.filter((entry) => entry.id !== proposal.id);
		await this.persistAppliedNow();
		await this.persistProposalsNow();
		this.notifyProposalsChanged();
		Zotero.debug(`Praetor MCP: applied proposal #${proposal.id} (${proposal.tool})`);
		return result;
	},

	async undoApplied(id) {
		const applied = this.applied.find((entry) => entry.id === Number(id));
		if (!applied) {
			throw new Error(`Applied change not found: ${id}`);
		}
		const inverse = applied.inverse || {};
		const args = this.cloneProposalValue(inverse.args || {});
		const hasTagChanges = (args.add?.length || 0) + (args.remove?.length || 0) > 0;
		const hasCollectionChanges = (args.addCollectionKeys?.length || 0) + (args.removeCollectionKeys?.length || 0) > 0;
		if (inverse.tool === "update_item_tags" && !hasTagChanges) {
			// The applied request was already true, so there is nothing to reverse.
		}
		else if (inverse.tool === "update_item_collections" && !hasCollectionChanges) {
			// The applied request was already true, so there is nothing to reverse.
		}
		else if (inverse.tool === "delete_collection_if_empty") {
			await this.toolDeleteCollectionIfEmpty(args);
		}
		else {
			const tool = this.TOOLS.find((entry) => entry.name === inverse.tool);
			if (!tool || typeof this[tool.handler] !== "function") {
				throw new Error(`Undo tool is unavailable: ${inverse.tool}`);
			}
			await this[tool.handler](args);
		}
		this.applied = this.applied.filter((entry) => entry.id !== applied.id);
		await this.persistAppliedNow();
		this.notifyProposalsChanged();
		Zotero.debug(`Praetor MCP: undid applied proposal #${applied.id} (${applied.tool})`);
	},

	async clearApplied() {
		const count = this.applied.length;
		this.applied = [];
		await this.persistAppliedNow();
		this.notifyProposalsChanged();
		Zotero.debug(`Praetor MCP: cleared ${count} applied entries`);
		return count;
	},

	async discardProposal(id) {
		const proposalID = Number(id);
		if (!this.proposals.some((entry) => entry.id === proposalID)) {
			throw new Error(`Proposal not found: ${id}`);
		}
		this.proposals = this.proposals.filter((entry) => entry.id !== proposalID);
		await this.persistProposalsNow();
		this.notifyProposalsChanged();
		Zotero.debug(`Praetor MCP: discarded proposal #${proposalID}`);
	},

	async discardAllProposals() {
		if (!this.proposals.length) {
			return;
		}
		const count = this.proposals.length;
		this.proposals = [];
		await this.persistProposalsNow();
		this.notifyProposalsChanged();
		Zotero.debug(`Praetor MCP: discarded ${count} proposals`);
	},

	notifyProposalsChanged() {
		try {
			Zotero.ZoteroKPraetor?.refreshProposalViews?.();
		}
		catch (err) {
			Zotero.debug(`Praetor MCP: proposal view refresh failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	},

	summarizeProposal(tool, args, zotero = Zotero) {
		const item = this.getProposalItemLabel(args, zotero);
		const collection = (keyField) => this.getProposalCollectionLabel(args, keyField, zotero);
		const quote = (value) => `‘${String(value ?? "")}’`;
		const list = (values) => {
			const labels = values.map(quote);
			if (labels.length < 2) {
				return labels[0] || "";
			}
			return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
		};
		const cleanList = (values) => (Array.isArray(values) ? values : [])
			.map((value) => String(value ?? "").trim())
			.filter(Boolean);

		if (tool === "update_item_tags") {
			const add = cleanList(args?.add);
			const remove = cleanList(args?.remove);
			const addText = `tag${add.length === 1 ? "" : "s"} ${list(add)}`;
			const removeText = `tag${remove.length === 1 ? "" : "s"} ${list(remove)}`;
			if (add.length && remove.length) {
				return `Add ${addText} and remove ${removeText} on ${quote(item)}`;
			}
			if (add.length) {
				return `Add ${addText} to ${quote(item)}`;
			}
			if (remove.length) {
				return `Remove ${removeText} from ${quote(item)}`;
			}
		}
		else if (tool === "update_item_collections") {
			const add = cleanList(args?.addCollectionKeys).map((key) => this.getProposalCollectionLabel({ ...args, collectionKey: key }, "collectionKey", zotero));
			const remove = cleanList(args?.removeCollectionKeys).map((key) => this.getProposalCollectionLabel({ ...args, collectionKey: key }, "collectionKey", zotero));
			if (add.length && remove.length) {
				return `Add ${quote(item)} to ${add.join(", ")} and remove it from ${remove.join(", ")}`;
			}
			if (add.length) {
				return `Add ${quote(item)} to ${add.join(", ")}`;
			}
			if (remove.length) {
				return `Remove ${quote(item)} from ${remove.join(", ")}`;
			}
		}
		else if (tool === "update_item_fields") {
			const fields = args?.fields && typeof args.fields === "object" && !Array.isArray(args.fields)
				? Object.entries(args.fields)
				: [];
			if (fields.length) {
				const assignments = fields.map(([name, value]) => `${name} = ${quote(value ?? "")}`);
				return `Set field${fields.length === 1 ? "" : "s"} ${assignments.join(", ")} on ${quote(item)}`;
			}
		}
		else if (tool === "create_collection") {
			const name = String(args?.name || "").trim() || "unnamed collection";
			if (args?.parentCollectionKey) {
				return `Create collection ${quote(name)} in ${collection("parentCollectionKey")}`;
			}
			return `Create top-level collection ${quote(name)}`;
		}
		else if (tool === "update_collection") {
			const current = collection("collectionKey").split(" / ").pop();
			const newName = String(args?.newName || "").trim();
			const hasParent = args?.newParentCollectionKey !== undefined;
			if (newName && !hasParent) {
				return `Rename collection ${quote(current)} to ${quote(newName)}`;
			}
			const target = String(args?.newParentCollectionKey || "").trim().toUpperCase() === "TOP"
				? "the top level"
				: collection("newParentCollectionKey");
			if (newName && hasParent) {
				return `Rename collection ${quote(current)} to ${quote(newName)} and move it to ${target}`;
			}
			if (hasParent) {
				return `Move collection ${quote(current)} to ${target}`;
			}
		}
		else if (tool === "delete_collection_if_empty") {
			const name = String(args?.collectionName || "").trim();
			if (args?.created === false) {
				return `Leave existing collection ${quote(name || collection("collectionKey"))} unchanged`;
			}
			return `Delete empty collection ${quote(name || collection("collectionKey"))}`;
		}
		return `Propose ${String(tool || "change")} with the supplied arguments`;
	},

	getProposalLibraryID(args, zotero) {
		const value = args?.libraryID;
		const parsed = parseInt(value, 10);
		return Number.isInteger(parsed) ? parsed : zotero?.Libraries?.userLibraryID;
	},

	getProposalItemLabel(args, zotero) {
		const key = String(args?.itemKey || "").trim().toUpperCase();
		try {
			const item = zotero?.Items?.getByLibraryAndKey?.(this.getProposalLibraryID(args, zotero), key);
			return item?.getDisplayTitle?.() || item?.getField?.("title") || key || "item";
		}
		catch (_) {
			return key || "item";
		}
	},

	getProposalCollectionLabel(args, keyField, zotero) {
		const key = String(args?.[keyField] || "").trim().toUpperCase();
		if (key === "TOP") {
			return "the top level";
		}
		const libraryID = this.getProposalLibraryID(args, zotero);
		try {
			let current = zotero?.Collections?.getByLibraryAndKey?.(libraryID, key);
			if (!current) {
				return key || "collection";
			}
			const names = [];
			const visited = new Set();
			while (current && !visited.has(current.key)) {
				visited.add(current.key);
				names.unshift(current.name || current.key);
				current = current.parentKey
					? zotero?.Collections?.getByLibraryAndKey?.(libraryID, current.parentKey)
					: null;
			}
			return names.join(" / ") || key || "collection";
		}
		catch (_) {
			return key || "collection";
		}
	},

	async toolSearchLibrary(args) {
		const query = String(args?.query || "").trim();
		if (query.length < 2) {
			throw new Error("query must be at least 2 characters");
		}
		const libraryID = this.resolveLibraryID(args);
		const mode = String(args?.mode || "everything");
		const search = new Zotero.Search();
		search.libraryID = libraryID;
		if (mode === "fulltext") {
			search.addCondition("fulltextContent", "contains", query);
		}
		else if (mode === "metadata") {
			search.addCondition("quicksearch-titleCreatorYear", "contains", query);
		}
		else {
			search.addCondition("quicksearch-everything", "contains", query);
		}
		const tag = String(args?.tag || "").trim();
		if (tag) {
			search.addCondition("tag", "contains", tag);
		}
		const itemType = String(args?.itemType || "").trim();
		if (itemType) {
			search.addCondition("itemType", "is", itemType);
		}
		const ids = await search.search();
		const limit = this.clampLimit(args?.limit);
		const seen = new Set();
		const results = [];
		let total = 0;
		for (const id of ids) {
			let item = Zotero.Items.get(id);
			if (!item || item.deleted) {
				continue;
			}
			if (!item.isRegularItem?.()) {
				// Fulltext matches surface attachments; report their parent item.
				const top = item.topLevelItem || (item.parentItemID ? Zotero.Items.get(item.parentItemID) : null);
				if (!top?.isRegularItem?.() || top.deleted) {
					continue;
				}
				item = top;
			}
			if (seen.has(item.key)) {
				continue;
			}
			seen.add(item.key);
			total++;
			if (results.length < limit) {
				results.push(this.summarizeItem(item));
			}
		}
		return { results, total, truncated: total > results.length };
	},

	async toolGetItem(args) {
		const item = this.getItemByKey(args);
		const fields = {};
		try {
			for (const fieldID of Zotero.ItemFields.getItemTypeFields(item.itemTypeID)) {
				const name = Zotero.ItemFields.getName(fieldID);
				const value = item.getField(name);
				if (value) {
					fields[name] = value;
				}
			}
		}
		catch (_) {}

		const creators = [];
		try {
			for (const creator of item.getCreators()) {
				const creatorType = Zotero.CreatorTypes.getName(creator.creatorTypeID);
				const name = creator.name || [creator.lastName, creator.firstName].filter(Boolean).join(", ");
				if (name) {
					creators.push(`${creatorType}: ${name}`);
				}
			}
		}
		catch (_) {}

		const collections = [];
		try {
			for (const collectionID of item.getCollections()) {
				const collection = Zotero.Collections.get(collectionID);
				if (collection) {
					collections.push({ key: collection.key, name: collection.name });
				}
			}
		}
		catch (_) {}

		const notes = [];
		for (const noteID of item.getNotes?.() || []) {
			const note = Zotero.Items.get(noteID);
			if (!note || note.deleted) {
				continue;
			}
			notes.push({
				key: note.key,
				preview: this.stripHTML(note.getNote()).slice(0, this.NOTE_PREVIEW_CHARS),
			});
		}

		const attachments = [];
		const attachmentIDs = item.isAttachment?.() ? [item.id] : item.getAttachments?.() || [];
		for (const attachmentID of attachmentIDs) {
			const attachment = Zotero.Items.get(attachmentID);
			if (!attachment || attachment.deleted) {
				continue;
			}
			let path = "";
			try {
				path = (await attachment.getFilePathAsync()) || "";
			}
			catch (_) {
				path = "";
			}
			let hasIndexedText = null;
			try {
				const state = await Zotero.Fulltext.getIndexedState(attachment);
				hasIndexedText = state > 0;
			}
			catch (_) {
				hasIndexedText = null;
			}
			attachments.push({
				key: attachment.key,
				title: attachment.getField("title") || attachment.attachmentFilename || attachment.key,
				contentType: attachment.attachmentContentType || "",
				path,
				hasIndexedText,
			});
		}

		return {
			...this.summarizeItem(item),
			fields,
			creators,
			collections,
			notes,
			attachments,
		};
	},

	async toolGetItemFulltext(args) {
		const item = this.getItemByKey(args);
		const offset = Math.max(0, parseInt(args?.offset, 10) || 0);
		const cacheKey = `${item.libraryID}:${item.key}:${offset}`;
		const nowMs = Date.now();
		const cached = this.fulltextCache.get(cacheKey);
		if (!args?.refresh && !this.shouldServeFulltext(this.fulltextCache, cacheKey, nowMs)) {
			return `Already retrieved in this session (item ${item.key}, offset ${offset}, ${cached.chars} chars served) — re-read it from your context. Pass refresh:true to force re-fetch.`;
		}
		const attachmentKey = String(args?.attachmentKey || "").trim().toUpperCase();
		let attachment = null;
		let text = "";
		if (attachmentKey) {
			attachment = this.getItemByKey({ libraryID: item.libraryID, itemKey: attachmentKey });
			if (!attachment.isAttachment?.()) {
				throw new Error(`Not an attachment: ${attachmentKey}`);
			}
			text = (await attachment.attachmentText) || "";
		}
		else if (item.isAttachment?.()) {
			attachment = item;
			text = (await attachment.attachmentText) || "";
		}
		else {
			for (const candidateID of item.getAttachments?.() || []) {
				const candidate = Zotero.Items.get(candidateID);
				if (!candidate || candidate.deleted) {
					continue;
				}
				attachment = attachment || candidate;
				const candidateText = (await candidate.attachmentText) || "";
				if (candidateText) {
					attachment = candidate;
					text = candidateText;
					break;
				}
			}
		}
		if (!text) {
			let path = "";
			try {
				path = attachment ? (await attachment.getFilePathAsync()) || "" : "";
			}
			catch (_) {
				path = "";
			}
			return {
				hasFulltext: false,
				attachmentKey: attachment?.key || null,
				path,
				hint: "No indexed text for this item. If a file path is given, the file can be read directly when it is within an allowed directory.",
			};
		}
		const maxChars = this.clampFulltextChars(args?.maxChars);
		const slice = text.slice(offset, offset + maxChars);
		const nextOffset = offset + slice.length < text.length ? offset + slice.length : null;
		this.rememberFulltextSlice(this.fulltextCache, cacheKey, nowMs, slice.length);
		return {
			hasFulltext: true,
			attachmentKey: attachment.key,
			totalChars: text.length,
			offset,
			maxChars,
			text: slice,
			nextOffset,
		};
	},

	toolListCollections(args) {
		const libraryID = this.resolveLibraryID(args);
		const all = Zotero.Collections.getByLibrary(libraryID, true) || [];
		const collections = all.slice(0, this.MAX_COLLECTIONS).map((collection) => ({
			key: collection.key,
			name: collection.name,
			parentKey: collection.parentKey || null,
		}));
		return { collections, total: all.length, truncated: all.length > collections.length };
	},

	toolGetCollectionItems(args) {
		const collection = this.getCollectionByKey(args, "collectionKey");
		const limit = this.clampLimit(args?.limit);
		const results = [];
		let total = 0;
		for (const item of collection.getChildItems() || []) {
			if (!item || item.deleted || !item.isRegularItem?.()) {
				continue;
			}
			total++;
			if (results.length < limit) {
				results.push(this.summarizeItem(item));
			}
		}
		return { collectionKey: collection.key, name: collection.name, results, total, truncated: total > results.length };
	},

	async toolCreateNote(args) {
		const text = String(args?.text || "").trim();
		if (!text) {
			throw new Error("text is required");
		}
		if (text.length > this.MAX_NOTE_CHARS) {
			throw new Error(`Note text exceeds ${this.MAX_NOTE_CHARS} characters`);
		}
		const libraryID = this.resolveLibraryID(args);
		const note = new Zotero.Item("note");
		note.libraryID = libraryID;
		note.setNote(this.toNoteHTML(text));
		const parentItemKey = String(args?.parentItemKey || "").trim().toUpperCase();
		if (parentItemKey) {
			const parent = this.getItemByKey({ libraryID, itemKey: parentItemKey });
			if (!parent.isRegularItem?.()) {
				throw new Error("parentItemKey must reference a regular item");
			}
			note.parentItemID = parent.id;
		}
		else if (args?.collectionKey) {
			const collection = this.getCollectionByKey({ libraryID, collectionKey: args.collectionKey }, "collectionKey");
			note.addToCollection(collection.id);
		}
		for (const tag of args?.tags || []) {
			const trimmed = String(tag || "").trim();
			if (trimmed) {
				note.addTag(trimmed, 0);
			}
		}
		note.addTag(this.PRAETOR_NOTE_TAG, 0);
		await note.saveTx();
		return { noteKey: note.key, libraryID };
	},

	async toolUpdateNote(args) {
		if (!args || !Object.prototype.hasOwnProperty.call(args, "content")) {
			throw new Error("content is required");
		}
		const content = String(args?.content ?? "");
		if (content.length > this.MAX_NOTE_CHARS) {
			throw new Error(`Note content exceeds ${this.MAX_NOTE_CHARS} characters`);
		}
		const libraryID = this.resolveLibraryID(args);
		const item = this.getItemByKey({ libraryID, itemKey: args?.itemKey });
		const note = this.getItemByKey({ libraryID, itemKey: args?.noteKey });
		if (!note.isNote?.()) {
			throw new Error("noteKey must reference a Zotero note");
		}
		if (item.key !== note.key && note.parentItemID !== item.id) {
			throw new Error("itemKey must reference the target note itself or its parent item");
		}
		const tags = new Set((note.getTags?.() || []).map((entry) => entry.tag));
		if (!tags.has(this.PRAETOR_NOTE_TAG) && !tags.has(this.PRAETOR_SMART_NOTE_TAG)) {
			throw new Error("Praetor may update only notes tagged zys-praetor or zys-praetor-smart-notes; untagged user notes cannot be edited");
		}
		note.setNote(this.toNoteHTML(content));
		await note.saveTx();
		return { noteKey: note.key, libraryID };
	},

	async toolCreateCollection(args) {
		const name = String(args?.name || "").trim();
		if (!name) {
			throw new Error("name is required");
		}
		const libraryID = this.resolveLibraryID(args);
		let parentKey = false;
		if (args?.parentCollectionKey !== undefined && args?.parentCollectionKey !== null) {
			const parent = this.getCollectionByKey({ libraryID, parentCollectionKey: args.parentCollectionKey }, "parentCollectionKey");
			parentKey = parent.key;
		}
		for (const existing of Zotero.Collections.getByLibrary(libraryID, true) || []) {
			if (existing.name === name && (existing.parentKey || false) === parentKey) {
				return {
					collectionKey: existing.key,
					name: existing.name,
					parentCollectionKey: existing.parentKey || null,
					created: false,
				};
			}
		}
		const collection = new Zotero.Collection();
		collection.libraryID = libraryID;
		collection.name = name;
		if (parentKey) {
			collection.parentKey = parentKey;
		}
		await collection.saveTx();
		return {
			collectionKey: collection.key,
			name: collection.name,
			parentCollectionKey: collection.parentKey || null,
			created: true,
		};
	},

	async toolDeleteCollectionIfEmpty(args) {
		if (args?.created === false) {
			return { collectionKey: args?.collectionKey || null, deleted: false };
		}
		const collection = this.getCollectionByKey(args, "collectionKey");
		const childItems = collection.getChildItems?.() || [];
		const childCollections = typeof collection.getChildCollections === "function"
			? collection.getChildCollections()
			: (Zotero.Collections.getByLibrary(collection.libraryID, true) || [])
				.filter((candidate) => candidate.parentKey === collection.key);
		if (childItems.length || childCollections.length) {
			throw new Error("Collection is no longer empty — undo it manually.");
		}
		await collection.eraseTx();
		return { collectionKey: collection.key, deleted: true };
	},

	async toolUpdateCollection(args) {
		const collection = this.getCollectionByKey(args, "collectionKey");
		const hasNewName = args?.newName !== undefined;
		const hasNewParent = args?.newParentCollectionKey !== undefined;
		if (!hasNewName && !hasNewParent) {
			throw new Error("Provide newName and/or newParentCollectionKey");
		}
		let newName = null;
		if (hasNewName) {
			newName = String(args.newName || "").trim();
			if (!newName) {
				throw new Error("newName cannot be empty");
			}
		}
		let newParent = null;
		if (hasNewParent) {
			const newParentKey = String(args.newParentCollectionKey || "").trim().toUpperCase();
			if (newParentKey !== "TOP") {
				newParent = this.getCollectionByKey(
					{ libraryID: collection.libraryID, newParentCollectionKey: newParentKey },
					"newParentCollectionKey"
				);
				const visited = new Set();
				let ancestor = newParent;
				while (ancestor) {
					if (ancestor.key === collection.key) {
						throw new Error("Cannot move a collection into itself or one of its descendants");
					}
					if (!ancestor.parentKey || visited.has(ancestor.key)) {
						break;
					}
					visited.add(ancestor.key);
					ancestor = Zotero.Collections.getByLibraryAndKey(collection.libraryID, ancestor.parentKey);
				}
			}
		}
		if (hasNewName) {
			collection.name = newName;
		}
		if (hasNewParent) {
			collection.parentKey = newParent?.key || false;
		}
		await collection.saveTx();
		return {
			collectionKey: collection.key,
			name: collection.name,
			parentCollectionKey: collection.parentKey || null,
		};
	},

	async toolUpdateItemTags(args) {
		const item = this.getItemByKey(args);
		let changed = false;
		for (const tag of args?.add || []) {
			const trimmed = String(tag || "").trim();
			if (trimmed) {
				item.addTag(trimmed, 0);
				changed = true;
			}
		}
		for (const tag of args?.remove || []) {
			const trimmed = String(tag || "").trim();
			if (trimmed) {
				item.removeTag(trimmed);
				changed = true;
			}
		}
		if (!changed) {
			throw new Error("Provide tags to add or remove");
		}
		await item.saveTx();
		return { key: item.key, tags: item.getTags().map((entry) => entry.tag) };
	},

	async toolUpdateItemCollections(args) {
		const item = this.getItemByKey(args);
		if (!item.isTopLevelItem?.()) {
			throw new Error("Only top-level items can be assigned to collections");
		}
		const libraryID = item.libraryID;
		let changed = false;
		for (const key of args?.addCollectionKeys || []) {
			const collection = this.getCollectionByKey({ libraryID, collectionKey: key }, "collectionKey");
			item.addToCollection(collection.id);
			changed = true;
		}
		for (const key of args?.removeCollectionKeys || []) {
			const collection = this.getCollectionByKey({ libraryID, collectionKey: key }, "collectionKey");
			item.removeFromCollection(collection.id);
			changed = true;
		}
		if (!changed) {
			throw new Error("Provide collection keys to add or remove");
		}
		await item.saveTx();
		const collections = [];
		for (const collectionID of item.getCollections()) {
			const collection = Zotero.Collections.get(collectionID);
			if (collection) {
				collections.push(collection.key);
			}
		}
		return { key: item.key, collections };
	},

	async toolUpdateItemFields(args) {
		const item = this.getItemByKey(args);
		if (!item.isRegularItem?.()) {
			throw new Error("Only regular items can be edited");
		}
		const fields = args?.fields;
		if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
			throw new Error("fields must be an object of field names to values");
		}
		const updated = {};
		for (const [name, value] of Object.entries(fields)) {
			if (!this.FIELD_ALLOWLIST.includes(name)) {
				throw new Error(`Field not allowed: ${name}`);
			}
			const fieldID = Zotero.ItemFields.getID(name);
			if (!fieldID || !Zotero.ItemFields.isValidForType(fieldID, item.itemTypeID)) {
				throw new Error(`Field not valid for this item type: ${name}`);
			}
			const nextValue = value === null || value === undefined ? "" : String(value);
			item.setField(name, nextValue);
			updated[name] = nextValue;
		}
		if (!Object.keys(updated).length) {
			throw new Error("Provide at least one field to update");
		}
		await item.saveTx();
		return { key: item.key, updated };
	},

	resolveLibraryID(args) {
		if (args?.libraryID === undefined || args?.libraryID === null) {
			return Zotero.Libraries.userLibraryID;
		}
		const libraryID = parseInt(args.libraryID, 10);
		if (!Number.isInteger(libraryID) || !Zotero.Libraries.get(libraryID)) {
			throw new Error(`Unknown libraryID: ${args.libraryID}`);
		}
		return libraryID;
	},

	getItemByKey(args, keyField = "itemKey") {
		const key = String(args?.[keyField] || "").trim().toUpperCase();
		if (!this.ITEM_KEY_PATTERN.test(key)) {
			throw new Error(`${keyField} must be an 8-character Zotero key`);
		}
		const libraryID = this.resolveLibraryID(args);
		const item = Zotero.Items.getByLibraryAndKey(libraryID, key);
		if (!item || item.deleted) {
			throw new Error(`Item not found: ${key}`);
		}
		return item;
	},

	getCollectionByKey(args, keyField) {
		const key = String(args?.[keyField] || "").trim().toUpperCase();
		if (!this.ITEM_KEY_PATTERN.test(key)) {
			throw new Error(`${keyField} must be an 8-character Zotero key`);
		}
		const libraryID = this.resolveLibraryID(args);
		const collection = Zotero.Collections.getByLibraryAndKey(libraryID, key);
		if (!collection) {
			throw new Error(`Collection not found: ${key}`);
		}
		return collection;
	},

	clampLimit(value) {
		const limit = parseInt(value, 10);
		if (!Number.isInteger(limit) || limit < 1) {
			return this.DEFAULT_RESULTS;
		}
		return Math.min(limit, this.MAX_RESULTS);
	},

	clampFulltextChars(value) {
		const maxChars = parseInt(value, 10);
		if (!Number.isInteger(maxChars)) {
			return this.MAX_FULLTEXT_CHARS;
		}
		return Math.min(Math.max(maxChars, this.MIN_FULLTEXT_CHARS), this.MAX_FULLTEXT_CHARS);
	},

	shouldServeFulltext(cacheLike, key, nowMs) {
		const cached = cacheLike?.get?.(key);
		return !cached || nowMs - cached.servedAt >= this.FULLTEXT_CACHE_TTL_MS;
	},

	rememberFulltextSlice(cacheLike, key, nowMs, chars) {
		cacheLike.delete(key);
		while (cacheLike.size >= this.MAX_FULLTEXT_CACHE_ENTRIES) {
			cacheLike.delete(cacheLike.keys().next().value);
		}
		cacheLike.set(key, { servedAt: nowMs, chars });
	},

	summarizeItem(item) {
		const creators = [];
		try {
			for (const creator of item.getCreators()) {
				const name = creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(" ");
				if (name) {
					creators.push(name);
				}
			}
		}
		catch (_) {}
		let tags = [];
		try {
			tags = item.getTags().map((entry) => entry.tag);
		}
		catch (_) {}
		let title = "";
		try {
			title = item.getField("title") || item.attachmentFilename || item.key;
		}
		catch (_) {
			title = item.key;
		}
		let date = "";
		try {
			date = item.getField("date") || "";
		}
		catch (_) {}
		return {
			key: item.key,
			libraryID: item.libraryID,
			itemType: item.itemTypeID ? Zotero.ItemTypes.getName(item.itemTypeID) : "",
			title,
			creators,
			date,
			numAttachments: item.getAttachments?.()?.length ?? 0,
			numNotes: item.getNotes?.()?.length ?? 0,
			tags,
		};
	},

	stripHTML(html) {
		return String(html || "")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<[^>]+>/g, " ")
			.replace(/&nbsp;/gi, " ")
			.replace(/&amp;/gi, "&")
			.replace(/&lt;/gi, "<")
			.replace(/&gt;/gi, ">")
			.replace(/\s+/g, " ")
			.trim();
	},

	toNoteHTML(text) {
		if (/<[a-z][^>]*>/i.test(text)) {
			return text;
		}
		const escaped = text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
		return escaped
			.split(/\n{2,}/)
			.map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br/>")}</p>`)
			.join("");
	},

};
