// npm run prompts -- <entries.json> [--send] [--out <dir>]      (in app/server; samples: prompt-cli/entries.json)
// npm run prompts -- --list
//
// Builds the exact request of every entry, with the same prompts and request builder the Worker uses (src/prompts), and writes it to
// <out> (default build/prompt-runs/<time>/): <id>.request.json and summary.json.
// Nothing is sent unless config.payloadOnly is false or --send is given; sending reads the key from META_MODEL_API_KEY and also writes
// <id>.answer.json (and the picture for an image prompt) as each answer lands. Exits 1 when anything fails.
import { join } from "node:path";
import { PROMPTS, modelOf } from "../src/prompts/index.js";
import { config } from "./config.js";
import { build, sendAll, writeAnswer, writeRequests, writeSummary } from "./run.js";

const USAGE = "usage: npm run prompts -- <entries.json> [--send] [--out <dir>]   (payload-only unless --send)\n       npm run prompts -- --list";
const FLAGS = new Set(["--list", "--send", "--out"]);

async function main(args: string[]): Promise<number> {
	const unknown = args.find(arg => arg.startsWith("--") && !FLAGS.has(arg));
	if (unknown) throw new Error(`Unknown option ${unknown}.`);
	if (args.includes("--list") || !args.length) {
		for (const [name, prompt] of Object.entries(PROMPTS)) console.log(`${name.padEnd(10)} ${prompt.output.kind.padEnd(5)} ${modelOf(prompt).id.padEnd(16)} ${prompt.description}`);
		if (!args.length) console.log(`\n${USAGE}`);
		return 0;
	}
	const outAt = args.indexOf("--out");
	if (outAt >= 0 && (!args[outAt + 1] || args[outAt + 1]!.startsWith("--"))) throw new Error("--out needs a folder.");
	const files = args.filter((arg, index) => !arg.startsWith("--") && !(outAt >= 0 && index === outAt + 1));
	if (files.length !== 1) throw new Error(files.length ? `Give one entries file (got ${files.join(", ")}).` : "Give an entries file.");
	const sending = args.includes("--send") || !config.payloadOnly;
	const out = outAt >= 0 ? args[outAt + 1]! : join("build", "prompt-runs", new Date().toISOString().replace(/[:.]/g, "-"));

	const built = await build(files[0]!);
	await writeRequests(built, out); // the payloads are on disk before anything is sent
	if (sending) await sendAll(built, item => writeAnswer(item, out));
	await writeSummary(built, out, sending);

	for (const item of built) {
		const sent = item.sent ? ` ${item.sent.ok ? "ok" : "FAILED"} ${item.sent.seconds}s${item.sent.costUsd !== undefined ? ` $${item.sent.costUsd.toFixed(5)}` : ""}${item.sent.problems.length ? ` ${item.sent.problems.join("; ")}` : ""}` : "";
		console.log(`${item.entry.id.padEnd(26)} ${item.prompt.name.padEnd(7)} group ${item.group.padEnd(30)} prefix ${String(item.prefixChars).padStart(6)} + ${String(item.suffixChars).padStart(6)} chars  ~$${item.estimateUsd.toFixed(4)}${sent}`);
	}
	const textGroups = [...Map.groupBy(built.filter(item => item.prompt.output.kind === "json"), item => item.group).values()];
	const shared = textGroups.filter(group => group.length > 1).length;
	console.log(`\n${sending ? "sent" : "payload-only (nothing sent)"}: ${built.length} requests, ${textGroups.length} text cache group(s), ${shared} shared by more than one request -> ${out}`);
	return built.some(item => item.sent && !item.sent.ok) ? 1 : 0;
}

try {
	process.exitCode = await main(process.argv.slice(2));
} catch (error) {
	console.error(`prompts: ${error instanceof Error ? error.message : error}\n\n${USAGE}`);
	process.exitCode = 1;
}
