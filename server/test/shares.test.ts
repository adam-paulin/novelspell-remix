// Shared links: a finished version and its pictures published into D1, read back by anyone with the link. Only what this service
// signed goes in: the version's token and pictures carrying the signature of their image event.
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shareId } from "../src/shares";
import { ORIGIN, act, frameOf, get, type Frame } from "./api";
import { CHAPTER, SIX_EVENTS, fakeModels } from "./fake-models";

afterEach(() => vi.restoreAllMocks());

type Image = Extract<Frame, { t: "image" }>;
let token: string;
let pictures: Record<string, Image>;

beforeEach(async () => {
	fakeModels();
	const { frames } = await act("/api/remix", { book: "frankenstein", request: "What if Victor kept his promise and built the companion?" });
	token = frameOf(frames, "version")!.token;
	pictures = Object.fromEntries(frames.filter((frame): frame is Image => frame.t === "image").map(image => [image.id, image]));
});

// The page's upload: multipart with the token and each picture as a file plus its signature.
async function share(fields: { token: string; slots?: Record<string, { bytes: Uint8Array; mime: string; sig: string }> }) {
	const form = new FormData();
	form.set("token", fields.token);
	for (const [slot, picture] of Object.entries(fields.slots ?? {})) {
		form.set(slot, new File([picture.bytes], `${slot}.png`, { type: picture.mime }));
		form.set(`${slot}Sig`, picture.sig);
	}
	const encoded = new Response(form);
	const body = await encoded.arrayBuffer();
	return exports.default.fetch(new Request(`${ORIGIN}/api/share`, { method: "POST", headers: { origin: ORIGIN, "content-type": encoded.headers.get("content-type")!, "content-length": String(body.byteLength) }, body }));
}

const signed = (slot: string) => ({ bytes: pictures[slot]!.bytes!, mime: pictures[slot]!.mime, sig: pictures[slot]!.sig });

describe("share", () => {
	it("publishes a version with its pictures under the id the page can compute", async () => {
		const response = await share({ token, slots: { cover: signed("cover"), comic: signed("comic") } });
		expect(response.status).toBe(200);
		const { id } = await response.json() as { id: string };
		expect(id).toBe(await shareId(token));

		const read = await get(`/api/share/${id}`);
		expect(read.status).toBe(200);
		const snapshot = await read.json() as { book: string; n: number; chapter: { events: string[]; chapter: string }; pictures: Record<string, { mime: string; hash: string }> };
		expect(snapshot).toMatchObject({ book: "frankenstein", n: 1, chapter: { events: SIX_EVENTS, chapter: CHAPTER } });
		expect(Object.keys(snapshot.pictures).sort()).toEqual(["comic", "cover"]);

		const picture = await get(`/api/share-picture/${snapshot.pictures.cover!.hash}`);
		expect(picture.headers.get("content-type")).toBe("image/png");
		expect(new Uint8Array(await picture.arrayBuffer())).toEqual(pictures.cover!.bytes);
	});

	it("adds the comic to an existing link when the page sends it later", async () => {
		const first = await (await share({ token, slots: { cover: signed("cover") } })).json() as { id: string };
		const second = await (await share({ token, slots: { comic: signed("comic") } })).json() as { id: string };
		expect(second.id).toBe(first.id);
		const snapshot = await (await get(`/api/share/${first.id}`)).json() as { pictures: Record<string, unknown> };
		expect(Object.keys(snapshot.pictures).sort()).toEqual(["comic", "cover"]);
	});

	it("refuses a picture that was not drawn for this slot of this remix", async () => {
		const swapped = { ...signed("cover"), sig: pictures.comic!.sig }; // the comic's signature on the cover slot
		const response = await share({ token, slots: { cover: swapped } });
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: "bad_picture" } });
	});

	it("refuses a token this service did not sign", async () => {
		const response = await share({ token: `${token.slice(0, -4)}AAAA` === token ? `${token.slice(0, -4)}BBBB` : `${token.slice(0, -4)}AAAA` });
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: "bad_token" } });
	});

	it("answers 404 for a link that does not exist", async () => {
		const response = await get(`/api/share/${"A".repeat(22)}`);
		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
	});
});
