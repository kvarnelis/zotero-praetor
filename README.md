# Praetor for Zotero

Praetor puts Codex or Claude Code beside your Zotero items. Ask about the selected item, search indexed attachment text, draft notes, and review proposed metadata or collection changes without leaving Zotero.

It uses an installed CLI and its existing account login. The add-on does not ask for an API key. Requests still go to the provider used by that CLI; this is not an offline language model.

## Install

Current version: **0.9.14**. Supported target: **Zotero 9.x and 10.0.x on macOS**. No companion add-on is required.

1. Download [`zotero-praetor.xpi`](https://github.com/kvarnelis/zotero-praetor/releases/latest/download/zotero-praetor.xpi) from [Releases](https://github.com/kvarnelis/zotero-praetor/releases).
2. In Zotero, open the Add-ons Manager and choose **Install Add-on From File…**.
3. Select the XPI and restart Zotero.

After this version is installed, Zotero can check this repository's `updates.json` for future releases. Downloading and installing a newer XPI manually also works.

## Setup

Install and sign in to at least one supported runtime before sending a message:

- Codex must be available at `/opt/homebrew/bin/codex`.
- Claude Code must be available at `$HOME/.local/bin/claude`.

These executable paths are currently fixed. An installation elsewhere will need to be made available at the expected path; the add-on has no executable-path picker. You only need one runtime. Provider account access and any usage limits belong to that runtime.

Open the **AI** section in Zotero's item pane, choose the runtime, and check its login status. **Log In** opens Terminal for the provider's login command. Complete that process, return to Zotero, and choose **Check Login**.

The add-on registers its own authenticated library endpoint in Zotero and passes the connection details to its CLI requests. There is no separate MCP server to install for in-pane use. Zotero's built-in local HTTP server is enabled by default, so it normally needs no setup. If Praetor reports that it is disabled, open Zotero **Settings → Advanced → Config Editor**, search for `extensions.zotero.httpServer.enabled`, set it to `true`, and restart Zotero. See Zotero's [hidden preferences documentation](https://www.zotero.org/support/preferences/hidden_preferences) for this setting. **Copy MCP Config** is for connecting an external client and is not a required setup step.

## Use

The compact AI section and the full-pane view share the same conversation. The framed robot button toggles the full pane. Select an item, ask a question, and use **Stop** to cancel a running request.

The Library selector controls access:

- **Read** searches and reads metadata, notes, collections, and indexed text.
- **Add notes** permits new notes.
- **Propose changes** prepares edits and filing for review.
- **Edit items** permits supported metadata, tag, and collection-membership edits.
- **Reorganize** also permits creating, renaming, and moving collections.

Start with **Read**. Review proposals before applying them. Applied proposals have an Undo action; this is separate from Zotero's general undo history. Praetor also has tools for revising notes it created and tagged itself.

Attachment-file access and notes-vault access have separate switches. Attachment access starts enabled; vault access starts disabled. Obsidian is optional. If enabled, the vault is detected from the current user's local Obsidian configuration or its saved path preference.

In **Settings → Praetor**, choose the compact section, full-pane view, or both; set the default runtime and access level; and review file-access switches. Conversations persist locally in the Zotero data directory.

Example requests using synthetic data:

- “Summarize the selected item and cite the passages you used.”
- “Which selected items are missing a publication date?”
- “Propose adding Synthetic Example A to Example Collection.”

## Limits

The current release is built for macOS and relies on zsh and AppleScript for CLI execution and login. Windows and Linux have not been tested. CLI protocol or authentication changes may require an update. The add-on does not create or delete Zotero items or import attachment files.

Extracted unit tests cover parsing, selection, proposals, notes, and access behavior. The predecessor build received Zotero 10.0.6 startup and registration checks; this standalone release has not yet had a complete provider conversation or library-editing acceptance test on a fresh computer.

## Related tools

See the [Zotero Tools main page](https://kvarnelis.github.io/zotero-tools/) for an overview. Each tool installs independently. Book Helper is a separate Mac app.

- [NotebookLM Pane for Zotero](https://github.com/kvarnelis/zotero-notebooklm-pane) — Keep Google NotebookLM in the item pane and prepare local PDFs for its upload dialog.
- [Page View for Zotero](https://github.com/kvarnelis/zotero-page-view) — Add single-page reading, two-page spreads, page fitting, and focus controls to the PDF reader.
- [Compact Pane for Zotero](https://github.com/kvarnelis/zotero-compact-pane) — Show selected metadata fields for each item type, expand the full list when needed, and copy attachment paths.
- [Quiet Theme for Zotero](https://github.com/kvarnelis/zotero-quiet-theme) — Change Zotero’s colors, typography, and interface spacing.
- [Book Helper](https://github.com/kvarnelis/book-helper) — Identify and rename PDF and DRM-free EPUB books in a native Mac app, with optional Zotero import.

## Build and check

Building requires a Unix shell, `zip`, and Python 3. Syntax checks and any included unit tests require Node.js. End users installing an XPI do not need these developer tools.

```sh
./scripts/build.sh
./scripts/test.sh
```

The package is written to `dist/zotero-praetor.xpi`. The build also regenerates `updates.json` with the package's SHA-256 hash and versioned release URL. To publish an update, change the version in `manifest.json`, build and check, commit the new update manifest, and attach that exact XPI to release `v<version>`.

Keep examples synthetic. Do not commit library exports, conversations, personal configuration, or screenshots containing private material.

## License

No repository-wide license has been specified. Author attribution is retained in the add-on manifest.
