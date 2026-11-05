// The chapter markdown (paragraphs, ## headings, > quotes, --- rules, **strong**, *em*) built from the build-time template[data-md]
// parts, so the script only clones markup and fills its text slot; and the typographic quotes of model text.
import { $ } from "../lib/dom";
import { cloneTemplate } from "../lib/messages";

const part = (name: string): HTMLTemplateElement => $<HTMLTemplateElement>(`template[data-md="${name}"]`)!;
const segment = (kind: string, text: string): HTMLElement => cloneTemplate(part(kind), { text });

/** Typographic quotes and apostrophes for model text. */
export function smart(text: string): string {
	let out = "";
	let open = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (c !== '"' && c !== "'") { out += c; continue; }
		let j = out.length - 1;
		while (j >= 0 && (out[j] === "*" || out[j] === "_")) j--;
		const prev = j >= 0 ? out[j]! : "";
		const opener = !prev || /[\s(\[{<>#“‘]/.test(prev);
		if (c === '"') { open = opener || (/[—–]/.test(prev) && !open); out += open ? "“" : "”"; }
		else if (/[A-Za-z0-9À-ɏ]/.test(prev)) out += "’";
		else if (opener) out += /^(tis|twas|twere|til|em|cause|round)\b|^\d\d/i.test(text.slice(i + 1, i + 9)) ? "’" : "‘";
		else out += "’";
	}
	return out;
}

function inline(parent: HTMLElement, text: string): void {
	for (const piece of text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/)) {
		if (!piece) continue;
		if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4) parent.append(segment("strong", piece.slice(2, -2)));
		else if ((piece.startsWith("*") && piece.endsWith("*") && piece.length > 2) || (piece.startsWith("_") && piece.endsWith("_") && piece.length > 2)) parent.append(segment("em", piece.slice(1, -1)));
		else parent.append(segment("text", piece));
	}
}

/** `first`: the next paragraph is the chapter's first (it may open with a quote: data-opens-quote). */
export interface BlockState { first: boolean }
export function blocks(target: DocumentFragment, list: string[], state: BlockState): void {
	let broke = false;
	for (const block of list) {
		const text = smart(block.trim());
		if (!text) continue;
		const heading = /^(#{1,3})\s+(.*)$/.exec(text);
		const rule = /^([-*_])(\s*\1){2,}$/.test(text);
		if (rule && broke) continue;
		broke = rule;
		const kind = rule ? "rule" : heading ? (heading[1]!.length > 1 ? "h3" : "h2") : text.startsWith(">") ? "quote" : "p";
		const node = cloneTemplate(part(kind));
		if (!rule) inline(node, heading ? heading[2]! : kind === "quote" ? text.replace(/^>\s?/gm, "").replace(/\n/g, " ") : text);
		if (kind === "p" && state.first) {
			state.first = false;
			if (/^[“‘"'«]/.test(text) || text.length < 60) node.setAttribute("data-opens-quote", "");
		}
		target.append(node);
	}
}
/** The markdown's blocks (split on blank lines). */
export const split = (markdown: string): string[] => markdown.replace(/\r\n?/g, "\n").replace(/^\s+/, "").split(/\n{2,}/);
/** Replaces `target`'s children with the rendered markdown, under an optional title. */
export function markdown(target: Element, text: string, lead?: string): void {
	const fragment = document.createDocumentFragment();
	if (lead) fragment.append(cloneTemplate(part("title"), { text: smart(lead) }));
	blocks(fragment, split(text.trim()), { first: true });
	target.replaceChildren(fragment);
}
