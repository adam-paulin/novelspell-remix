// Signed version tokens. The service keeps no remix records: a finished version travels to the visitor's browser as an opaque token
// and comes back with a revise or redraw.
//   token = base64url(JSON payload) + "." + hex HMAC-SHA256 of that base64url text, keyed by the secret VERSION_SECRET.
// The signature proves this service wrote the chapter, so a revise can never smuggle arbitrary text into the writer's `previous`.
import type { Env } from "./config";

/** What a token carries. Tokens signed by older versions may name the events `summary` (or carry `panels[].beat`). */
export interface VersionPayload {
	book: string;
	request: string;
	divergenceId: string | null;
	n: number;
	events?: unknown;
	chapter: string;
	title?: string;
	summary?: unknown;
	panels?: unknown;
	mock?: { pick?: { request?: string } };
}

const encoder = new TextEncoder();
const CHUNK = 3 * 8192; // bytes per String.fromCharCode spread (a multiple of 3: only the last chunk can need base64 padding)
const keys = new Map<string, CryptoKey>(); // secret -> CryptoKey (one per isolate)

/** Whether VERSION_SECRET can sign: checked before any work starts, so a misconfigured Worker never pays for a remix it cannot hand back. */
export const versionSecretReady = (env: Env): boolean => typeof env.VERSION_SECRET === "string" && env.VERSION_SECRET.length >= 32;

async function key(env: Env): Promise<CryptoKey> {
	const secret = env.VERSION_SECRET;
	if (!secret || secret.length < 32) throw new Error("VERSION_SECRET is not set (32+ characters) on this Worker.");
	if (!keys.has(secret)) keys.set(secret, await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));
	return keys.get(secret)!;
}

export const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const unbase64url = (text: string) => Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
const fromHex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], pair => Number.parseInt(pair, 16));

// The longest token accepted back: a chapter at the writer's whole output cap (32,768 tokens, ~150 KB of JSON) is ~200 KB of base64, so every token
// this service signs fits (and the request body limit is this plus room for the instruction).
export const TOKEN_MAX = 320_000;

export async function signVersion(env: Env, payload: VersionPayload): Promise<string> {
	const bytes = encoder.encode(JSON.stringify(payload));
	let body = "";
	for (let at = 0; at < bytes.length; at += CHUNK) body += base64url(bytes.subarray(at, at + CHUNK));
	return `${body}.${hex(await crypto.subtle.sign("HMAC", await key(env), encoder.encode(body)))}`;
}

/** The payload of a token this service signed, or null (malformed, or a signature that does not verify). */
export async function readVersion(env: Env, token: unknown): Promise<VersionPayload | null> {
	if (typeof token !== "string" || token.length > TOKEN_MAX) return null;
	const [body, signature, extra] = token.split(".");
	if (!body || !/^[a-f0-9]{64}$/.test(signature ?? "") || extra !== undefined) return null;
	if (!(await crypto.subtle.verify("HMAC", await key(env), fromHex(signature!), encoder.encode(body)))) return null;
	try {
		return JSON.parse(new TextDecoder().decode(unbase64url(body)));
	} catch {
		return null;
	}
}

// Signed pictures: every image event carries `sig`, the HMAC of its slot (cover | comic), its remix (book and what-if) and its
// SHA-256, so a shared remix (shares.ts) carries only pictures this service drew for that remix and that slot.
export interface PictureOwner {
	slot: string;
	book: string;
	request: string | null | undefined;
}

export const digestHex = async (bytes: Uint8Array | string) => hex(await crypto.subtle.digest("SHA-256", typeof bytes === "string" ? encoder.encode(bytes) : bytes));
const pictureMessage = async (bytes: Uint8Array, { slot, book, request }: PictureOwner) => encoder.encode(`picture:${slot}:${book}:${await digestHex(String(request ?? ""))}:${await digestHex(bytes)}`);

export async function signPicture(env: Env, bytes: Uint8Array, owner: PictureOwner): Promise<string> {
	return hex(await crypto.subtle.sign("HMAC", await key(env), await pictureMessage(bytes, owner)));
}

export async function pictureSigned(env: Env, bytes: Uint8Array, sig: string, owner: PictureOwner): Promise<boolean> {
	if (!/^[a-f0-9]{64}$/.test(sig ?? "")) return false;
	return crypto.subtle.verify("HMAC", await key(env), fromHex(sig), await pictureMessage(bytes, owner));
}
