// Fills {name} holes in a content template with build-time values.
export const fill = (template: string, values: Record<string, string | number>): string =>
	template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

/** Splits a content template into literal text and {name} holes, in order. */
export const holes = (template: string): Array<{ text: string } | { hole: string }> =>
	template.split(/(\{\w+\})/).filter(Boolean).map((part) => {
		const name = /^\{(\w+)\}$/.exec(part)?.[1];
		return name ? { hole: name } : { text: part };
	});
