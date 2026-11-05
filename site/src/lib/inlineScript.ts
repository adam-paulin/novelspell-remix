import { minifySync } from "vite";

/**
 * A first-paint script: the code of `fn`, called with build-time arguments, minified for an inline, blocking
 * <script is:inline set:html={…}>. Write `fn` as a normal, readable, typed function that uses only browser globals
 * and its arguments (it is serialised with toString, so it cannot close over module variables). Arguments must be
 * JSON-serialisable; `<` is escaped so data can never close the script element.
 */
export function inlineScript<A extends unknown[]>(fn: (...args: A) => void, ...args: A): string {
	const data = args.map((arg) => JSON.stringify(arg).replace(/</g, "\\u003c")).join(",");
	const source = `(${fn.toString()})(${data});`;
	const { code, errors } = minifySync("inline.js", source, { compress: true, mangle: true });
	if (errors.length) throw new Error(`inline script: ${errors.map((error) => error.message).join("; ")}`);
	return code.trim();
}
