let chromeHandle;
let preferencePaneID;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
	const aomStartup = Components.classes[
		"@mozilla.org/addons/addon-manager-startup;1"
	].getService(Components.interfaces.amIAddonManagerStartup);

	const manifestURI = Services.io.newURI(rootURI + "manifest.json");
	chromeHandle = aomStartup.registerChrome(manifestURI, [
		["content", "zys-praetor", rootURI + "content/"],
	]);

	const ctx = {
		addonID: id,
		addonVersion: version,
		rootURI,
	};
	ctx._globalThis = ctx;

	Services.scriptloader.loadSubScript(
		rootURI + "content/scripts/praetor-mcp.js",
		ctx
	);

	Services.scriptloader.loadSubScript(
		rootURI + "content/scripts/praetor.js",
		ctx
	);

	await Zotero.ZoteroKPraetor.hooks.onStartup();

	preferencePaneID = await Zotero.PreferencePanes.register({
		pluginID: id,
		src: rootURI + "content/preferences.xhtml",
		label: "Praetor",
		image: rootURI + "content/icons/praetor.svg",
		stylesheets: [rootURI + "content/styles/praetor.css"],
	});
}

async function onMainWindowLoad({ window }, reason) {
	await Zotero.ZoteroKPraetor?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
	await Zotero.ZoteroKPraetor?.hooks.onMainWindowUnload(window);
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
	if (reason === APP_SHUTDOWN) {
		return;
	}

	if (preferencePaneID) {
		Zotero.PreferencePanes.unregister(preferencePaneID);
		preferencePaneID = null;
	}

	await Zotero.ZoteroKPraetor?.hooks.onShutdown();

	if (chromeHandle) {
		chromeHandle.destruct();
		chromeHandle = null;
	}
}

async function uninstall(data, reason) {}
