// The hosted demo's credit gate. The page asks nothing at load: the gate state arrives with the
// action it governs. An action that ends with error.showcase (Meta refused our key: auth, credits or forbidden) puts the studio in
// its calm state (the line under Write, the paused notice); the next action is the retry (the Worker decides). Words are compiled
// in (HostingFoot / HostingParts); this only picks variants.
import { $, html } from "../lib/dom";
import { showMessage } from "../lib/messages";
import { NOTICE_MS } from "./constants";

export interface Hosting { showcase(): void; live(): void }

export function createHosting(): Hosting {
	const line = $("[data-hosting-line]");
	const toast = $("[data-hosting-toast]");
	let timer: ReturnType<typeof setTimeout> | undefined;
	function showcase() {
		if (line) {
			html.setAttribute("data-hosting", "");
			html.setAttribute("data-hosting-state", "showcase");
			showMessage(line, "showcase");
		}
		if (!toast) return;
		showMessage(toast, "paused");
		toast.setAttribute("data-on", "");
		clearTimeout(timer);
		timer = setTimeout(() => toast.removeAttribute("data-on"), NOTICE_MS);
	}
	// An action that went through: live again. Only the paused state goes; data-hosting stays, since it also shows the foot's Meta
	// data-use line.
	function live() {
		if (html.getAttribute("data-hosting-state") !== "showcase") return;
		html.removeAttribute("data-hosting-state");
		if (line) showMessage(line, null);
	}
	return { showcase, live };
}
