// Types for the test runtime: the Worker under test is the main module (so `exports.default` is its fetch handler).
declare namespace Cloudflare {
	interface GlobalProps {
		mainModule: typeof import("../src/index");
	}
}
