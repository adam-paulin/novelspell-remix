// The studio's deferred stage. Before it runs, the Studio section's first-paint scripts have set only what the first frame needs
// (<html data-book>, data-restore, data-featured; the composer's text and its pressed turning point). This does the rest: it paints
// remixes (view.ts), keeps them in the visitor's own browser (records.ts), and owns every network call and every interaction.
// The backend is stateless: the only requests are the three actions (actions.ts), each ONE POST whose framed response streams the
// prose, the pictures and the signed version token; the reader's /library/<slug>/chapters.json (reader.ts); a shared remix's link
// (?share=<id>: GET /api/share/<id>) and publishing a share (POST /api/share, share.ts). Nothing is fetched at load except a shared
// link. Words come from the page (data-messages variants, data-slot holes, templates); the featured remixes are compiled in.
import { $, $$ } from "../lib/dom";
import { safeLocalStorage as local } from "../lib/storage";
import { LEGACY_KEYS } from "./constants";
import { initContext, state } from "./context";
import { bindDialogs } from "./dialogs";
import { bindEvents, bindNavigation } from "./events";
import { bindPicker } from "./picker";
import { featuredBook } from "./page-data";
import { bindDownloads } from "./pictures";
import { applyTextSize, bindReader, initReader } from "./reader";
import { readIds, syncUrl } from "./memory";
import { open, quiet } from "./screen";
import { initShare } from "./share";
import { bindFollow } from "./stream";
import { view } from "./view";
import { openShared, restore, scrollRail } from "./workspace";

export default function initStudio(): void {
	const studio = $("[data-studio]");
	if (!studio) return;
	// Bound in the dev bundle's order (listeners on the same node and event run in registration order).
	initContext(studio);
	bindFollow();
	bindDialogs();
	initReader();
	bindDownloads();
	initShare();
	bindEvents();
	bindReader();
	bindNavigation();
	bindPicker();
	start();
}

// The first-paint scripts set <html data-book>, data-restore and data-featured, the composer text and the pressed turning point;
// everything that depends on a remix starts here.
function start(): void {
	for (const key of LEGACY_KEYS) local.removeItem(key);
	applyTextSize(0);
	for (const button of $$("[data-target-book]")) button.setAttribute("aria-pressed", String(button.dataset.targetBook === state.book));
	scrollRail(state.book, "instant");
	const params = new URLSearchParams(location.search);
	if (state.id) {
		// The remix the URL names: the featured copy compiled into the page, else this browser's saved one (filled in when the store answers).
		if (featuredBook(state.id)) { quiet(); open(view.featured(state.id)!); } else restore(state.id);
	} else if (params.get("share")) {
		openShared(params.get("share")!);
	} else {
		const saved = readIds()[state.book];
		if (saved && params.has("restore")) restore(saved); else syncUrl();
	}
}
