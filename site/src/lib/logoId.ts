// Build-time counter for the logo's SVG mask ids: every inline copy of the logo on a page needs its own (see Logo.astro).
let count = 0;

export function nextLogoId(): string {
	count += 1;
	return `nsr${count}`;
}
