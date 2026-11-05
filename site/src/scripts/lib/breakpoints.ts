// The framework's breakpoint vocabulary (siteScale.js `breakpoints`): the bands the CSS media queries are written for, so a
// script's matchMedia cannot drift from the band its stylesheet targets.
export const breakpoints = {
	phone: { max: "29.999rem" },
	phablet: { min: "30rem", max: "47.999rem" },
	tablet: { min: "48rem", max: "63.999rem" },
	laptop: { min: "64rem", max: "79.999rem" },
	desktop: { min: "80rem", max: "95.999rem" },
	wide: { min: "96rem" },
} as const;
