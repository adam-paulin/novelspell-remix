// The browser's own remixes: IndexedDB database `novelspell-remix` v1, store `remixes` (keyPath id), one record per remix written
// whole as each piece lands (types.ts Remix). Failures never reach the visitor: a browser without IndexedDB simply keeps the remix
// for the session. Pictures are Blobs shown through object URLs, one per Blob on screen, revoked a moment after it is replaced or
// left (a download or share may still hold it); Download and Share read the Blob back through its URL, never a request.
import { DB_NAME, DB_STORE } from "./constants";
import type { Picture, Remix } from "./types";

let opened: Promise<IDBDatabase> | null = null;
const withStore = <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
	(opened ??= new Promise<IDBDatabase>((resolve, reject) => {
		const open = indexedDB.open(DB_NAME, 1);
		open.onupgradeneeded = () => open.result.createObjectStore(DB_STORE, { keyPath: "id" });
		open.onsuccess = () => resolve(open.result);
		open.onerror = () => reject(open.error);
	})).then((db) => new Promise<T>((resolve, reject) => {
		const request = run(db.transaction(DB_STORE, mode).objectStore(DB_STORE));
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	}));
export const loadRemix = (id: string): Promise<Remix | null | undefined> => withStore<Remix | undefined>("readonly", (store) => store.get(id)).catch(() => null);
export const saveRemix = (remix: Remix): Promise<unknown> => withStore("readwrite", (store) => store.put(remix)).catch(() => {});
export const deleteRemix = (id: string): Promise<unknown> => withStore("readwrite", (store) => store.delete(id)).catch(() => {});

export const objectUrls = new Map<Blob, string>(); // Blob -> url
const blobsByUrl = new Map<string, Blob>(); // url -> Blob
/** The URL a picture shows through: its object URL (made once per Blob), or the plain URL of a compiled one. */
export const urlOf = (image: Picture | undefined): string | null => {
	if (!image || typeof image === "string") return image || null;
	if (!objectUrls.has(image)) {
		const url = URL.createObjectURL(image);
		objectUrls.set(image, url);
		blobsByUrl.set(url, image);
	}
	return objectUrls.get(image)!;
};
export function revoke(image: Picture | undefined): void {
	const url = image instanceof Blob ? objectUrls.get(image) : undefined;
	if (!url) return;
	objectUrls.delete(image as Blob);
	setTimeout(() => { blobsByUrl.delete(url); URL.revokeObjectURL(url); }, 4000);
}
export const revokeAll = (): void => { for (const image of [...objectUrls.keys()]) revoke(image); };
/** The picture behind a URL on screen: its stored Blob, else (a compiled example's picture, a file of this site) fetched. */
export async function pictureAt(src: string): Promise<Blob> {
	const stored = blobsByUrl.get(src);
	if (stored) return stored;
	const response = await fetch(src);
	if (!response.ok) throw new Error("picture unavailable");
	return response.blob();
}
