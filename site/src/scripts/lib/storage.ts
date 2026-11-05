// Browser storage that never throws (the port of the framework's safeStorage.js). Browsers that block site data throw SecurityError
// on the first touch of window.localStorage / sessionStorage, and a full or private store throws on write. Such storage is treated as
// unavailable: the page keeps working from memory for its own lifetime, nothing persists and nothing throws. With working storage
// every call is the plain Storage call.
export interface SafeStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

function guarded(name: "localStorage" | "sessionStorage"): SafeStorage {
	const memory = new Map<string, string>();
	let unavailable = false;
	const area = (): Storage | null => {
		if (unavailable) return null;
		try { return window[name] ?? null; } catch { unavailable = true; return null; }
	};
	return {
		getItem(key) {
			const storage = area();
			if (storage) try { return storage.getItem(key); } catch { unavailable = true; }
			return memory.has(key) ? memory.get(key)! : null;
		},
		setItem(key, value) {
			const storage = area();
			if (storage) try { storage.setItem(key, value); return; } catch { unavailable = true; }
			memory.set(key, String(value));
		},
		removeItem(key) {
			const storage = area();
			if (storage) try { storage.removeItem(key); return; } catch { unavailable = true; }
			memory.delete(key);
		},
	};
}

export const safeLocalStorage = guarded("localStorage");
export const safeSessionStorage = guarded("sessionStorage");
