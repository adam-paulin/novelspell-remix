// Every word the site shows (en-US). Pages, components and scripts never hold text; they read it from here.
// The book catalogue and the featured example remixes are data: src/data/books.json and src/data/featured.json.
export const en = {
	"seo": {
		"title": "NovelSpell Remix: fork a classic",
		"description": "Pick a classic, ask what if, and get a canon-divergence chapter with its own comic page.",
		"author": "NovelSpell",
		"robots": {
			"index": true,
			"follow": true
		},
		"image": {
			"url": "/__assets/images/03ea155c535da5d3/novelspell-remix-og-card-1200x630.jpg",
			"width": 1200,
			"height": 630,
			"alt": "NovelSpell Remix: “What if Frankenstein went another way?” beside a Frankenstein comic page",
			"type": "image/jpeg"
		},
		"og": {
			"type": "website",
			"siteName": "NovelSpell Remix"
		},
		"twitter": {
			"card": "summary_large_image",
			"imageAlt": "NovelSpell Remix: “What if Frankenstein went another way?” beside a Frankenstein comic page"
		},
		"schemas": [
			{
				"@type": "Organization",
				"@id": "https://novelspell.com/#organization",
				"name": "NovelSpell",
				"legalName": "Frostwave Labs Inc.",
				"url": "https://novelspell.com"
			}
		],
		"llms": {
			"title": "NovelSpell Remix: fork a classic",
			"summary": "NovelSpell Remix is a studio for public-domain classics: pick a book, ask what if, and get a new canon-divergence chapter with its own comic page, then revise it, share it or build it into a full novel on NovelSpell.",
			"tools": []
		}
	},
	"notFound": {
		"seo": {
			"title": "Page not found | NovelSpell Remix",
			"description": "This page does not exist. Open the NovelSpell Remix studio to fork a classic.",
			"robots": {
				"index": false,
				"follow": true
			}
		},
		"heading": "This page is not in the library",
		"body": "The link may be old or mistyped. All ten classics are waiting in the studio.",
		"cta": "Open the studio"
	},
	"novelspell": {
		"genres": {
			"fantasy": "Fantasy",
			"science_fiction": "Science fiction",
			"mystery": "Mystery",
			"thriller": "Thriller",
			"romance": "Romance",
			"historical": "Historical",
			"horror": "Horror",
			"literary": "Literary",
			"adventure": "Adventure",
			"dystopian": "Dystopian"
		},
		"arcs": {
			"man_in_hole": "Fall, then rise",
			"cinderella": "Rise, fall, rise again",
			"rags_to_riches": "Steady rise",
			"icarus": "Rise, then fall",
			"oedipus": "Fall, rise, fall again",
			"riches_to_rags": "Steady fall",
			"wavering": "Ups and downs",
			"flat": "Even keel"
		}
	},
	"novelspellLink": {
		"origin": "https://novelspell.com",
		"path": "/custom",
		"language": "en"
	},
	"studio": {
		"llm": {
			"heading": "NovelSpell Remix studio",
			"summary": "Choose one of ten public-domain classics, start from a turning point or write your own what if, and the studio writes a new chapter where the story splits, with a comic page. Revise it, share it, or open the NovelSpell builder pre-filled from it."
		},
		"rail": {
			"label": "Choose a book to remix",
			/** The book-icon badge on each cover: opens that book's reader ({title} is filled at build time). */
			"read": "Read {title}",
			"lockupLabel": "NovelSpell Remix: studio home",
			/** Phones and tablets: the picker button's count beside the current book ({count} is filled at build time). */
			"pickerCount": "{count} books"
		},
		"workspace": {
			"headingBefore": "What if",
			"headingAfter": "went another way?",
			"promise": "A new chapter in the author’s voice, plus a comic page.",
			"productName": "NovelSpell Remix",
			"newRemix": "New remix",
			"newRemixShort": "New"
		},
		"composer": {
			"label": "Your what if",
			"placeholder": "What if…",
			"submit": "Write the chapter",
			"pointsLabel": "Turning points"
		},
		"progress": {
			"label": "Remix progress",
			"titles": {
				"restoring": "Opening the remix",
				"failed": "This chapter stopped partway",
				"notStarted": "The chapter didn’t start",
				"network": "We lost the connection",
				"notFound": "This remix isn’t here"
			},
			"voice": "The voice it will be written in",
			"demoNoteRevise": "Live revising is off in this demo, so this is the closest revision already written.",
			"hints": {
				"failed": "Writing stopped before the end. Your what-if is still here.",
				"notStarted": "Nothing was written yet. Your what-if is still here, so try again.",
				"network": "We couldn’t reach the studio. Try again in a moment.",
				"notFound": "The link may be mistyped, or the remix was removed. Pick a book to write your own.",
				"shareNetwork": "We couldn’t reach the studio to open this link. Reload the page in a moment."
			},
			"retry": "Try again"
		},
		"result": {
			"version": "Version {version}",
			"versionOf": "of {versions}",
			"splitsAt": "Splits from the original at {splitChapter}",
			"chapter": "chapter",
			"splitsPlain": "Where it splits: {moment}",
			"fleuron": "⁂",
			"splitReadLabel": "Read this chapter in the original book",
			"chapterLabel": "The remix chapter",
			"comicLabel": "The comic page",
			"comicAlt": "A comic page illustrating this remix chapter",
			"comicAltBeats": "Comic page in {altCount} panels:",
			"drawingNext": "Comic page after the chapter",
			"drawing": "Drawing the comic page",
			"redrawing": "Redrawing the comic page",
			"comicMissing": "No comic page for this remix.",
			"comicFailed": "The comic page didn’t draw.",
			"comicRetry": "Redraw the comic",
			"comicUnloaded": "The comic page didn’t load.",
			"comicReload": "Load it again",
			"fullSize": "Open the comic page full size",
			"comicJump": "Comic ready · View",
			"tagDemo": "Demo",
			"tagExample": "Example",
			"tagShared": "Shared",
			"changed": "Changed:",
			"versionPrevWith": "Previous version, changed: {instruction}",
			"versionNextWith": "Next version, changed: {instruction}",
			"writingLive": "Writing · {words} words",
			"readTime": "{minutes}-minute read",
			"followAlong": "Follow along ↓",
			"versionPrev": "Previous version",
			"versionNext": "Next version",
			"versionLatest": "Back to latest"
		},
		"steer": {
			"label": "Ask for a change",
			"placeholder": "Ask for a change…",
			"submit": "Revise",
			"busy": "Rewriting with your change",
			"failed": "That change didn’t finish. Your chapter is unchanged.",
			"failedNoMore": "This book has no fresh version left to show. Start a new remix to see more.",
			"ideasLabel": "Quick ideas",
			"ideas": [
				{
					"label": "Darker",
					"text": "Make it darker and more menacing."
				},
				{
					"label": "More dialogue",
					"text": "Add more dialogue and let the characters argue it out."
				},
				{
					"label": "Hopeful ending",
					"text": "Give the chapter a more hopeful ending."
				},
				{
					"label": "Tighter",
					"text": "Tighten the prose and cut anything slow."
				}
			]
		},
		/** Fast mode: the writer for new chapters and revisions is Muse Spark Open (open weights, served by Baseten) instead of Muse Wonder. */
		/** The thinking steps beside Write and Revise (the request's thinking: low | medium | high). The hint is each step's tooltip. */
		"thinking": {
			"label": "Thinking",
			"steps": {
				"low": { "label": "Low", "hint": "Low: fastest" },
				"medium": { "label": "Medium", "hint": "Medium: balanced" },
				"high": { "label": "High", "hint": "High: deepest, slower" }
			}
		},
		"fast": {
			"label": "Fast mode",
			"tip": "Fast mode: quicker at every step"
		},
		/** A writer provider that refused our key or is out of budget (the end line's error.provider, without showcase), by provider id.
		   title/hint: the failed-create card; dock: a failed revision's line; status: the screen-reader announcement. */
		"unavailable": {
			"baseten": {
				"title": "Fast mode is unavailable right now",
				"hint": "Turn Fast mode off to write with Muse Wonder. Your what-if is still here.",
				"dock": "Fast mode is unavailable right now. Turn Fast mode off to revise with Muse Wonder.",
				"status": "Fast mode is unavailable right now. Turn Fast mode off to write with Muse Wonder."
			}
		},
		"tab": {
			"writing": "Writing your remix… · NovelSpell Remix",
			"ready": "Your remix is ready · NovelSpell Remix"
		},
		"status": {
			"restoring": "Opening the remix.",
			"writing": "Opening the book at your what-if.",
			"streaming": "Your chapter is being written.",
			"chapter": "Your chapter is ready. Drawing the comic page.",
			"ready": "Your remix is ready, with its comic page.",
			"revising": "Rewriting with your change.",
			"revised": "Your revision is ready.",
			"comicFailed": "Your chapter is ready, but the comic page didn’t draw.",
			"failed": "This chapter stopped partway.",
			"notStarted": "The chapter didn’t start.",
			"network": "We lost the connection.",
			"notFound": "This remix isn’t here."
		},
		"actions": {
			"build": "Make it a full novel",
			"endEyebrow": "End of chapter one",
			"endCard": "NovelSpell can write a full novel inspired by this chapter.",
			"endShare": "Share this chapter",
			"comicEyebrow": "The chapter, drawn"
		},
		"featured": {
			"eyebrow": "An example remix",
			"read": "Read this example"
		},
		"cover": {
			"heading": "Your novel’s cover",
			"imageAlt": "The cover of your remixed novel",
			"fullSize": "Open the cover full size",
			"hashtag": "#NovelSpellRemix",
			"redditTitle": "{book}, remixed: “{request}” (AI chapter)",
			"shareText": "A new chapter of {book}: “{request}”",
			"group": "Share your remix",
			"share": "Share",
			"replaces": "Replaces {cardChapter}",
			"readTime": "{cardMinutes} min read",
			"download": "Download cover",
			"downloadShort": "Download",
			"downloadName": "novelspell-remix-cover",
			"copy": "Copy link",
			"native": "Share…",
			"instagram": "Share on Instagram",
			"facebook": "Share on Facebook",
			"whatsapp": "Share on WhatsApp",
			"threads": "Share on Threads",
			"copied": "Link copied",
			"copyFailed": "Copy failed"
		},
		"credit": {
			"writerWonder": "Written by Muse Wonder",
			"writer": "Written by Muse Spark",
			"writerOpen": "Written by Muse Spark Open",
			"illustrator": "Drawn by Muse Image",
			"writerWonderShort": "Muse Wonder",
			"writerShort": "Muse Spark",
			"writerOpenShort": "Muse Spark Open",
			"illustratorShort": "Muse Image"
		},
		"build": {
			"title": "Turn this chapter into a full novel",
			"intro": "A full novel with its own cover, inspired by this chapter and its characters. You review everything on NovelSpell before anything is ordered.",
			"fields": {
				"genre": "Genre",
				"arc": "Story arc"
			},
			"open": "Continue on NovelSpell ↗",
			"close": "Close",
			"brief": {
				"basedOn": "A remix of {book} by {author}: the original story with one chapter rewritten.",
				"replaces": "The new chapter below replaces {chapter} of the original.",
				"replacesNone": "The new chapter below answers the reader’s what-if: “{request}”",
				"chapter": "The new chapter, in full:",
				"presetBasedOn": "A novel from {book} by {author}: the original story, taken another way.",
				"presetWhatIf": "The turn it takes, at {chapter}: “{request}”",
				"presetWhatIfNone": "The turn it takes: “{request}”"
			}
		},
		"preview": {
			"heading": "The original book",
			"close": "Close",
			"tabAbout": "About",
			"tabRead": "Read",
			"start": "Start reading",
			"tocOpen": "Contents",
			"tocClose": "Close contents",
			"tocTitle": "Contents",
			"tocFront": "Front matter",
			"tocChapters": "Chapters",
			"previous": "Previous chapter",
			"next": "Next chapter",
			"loading": "Opening the book",
			"failed": "This book didn’t open. Try again.",
			"retry": "Try again",
			"readerLabel": "Reader",
			"zoomOut": "Zoom out",
			"zoomIn": "Zoom in",
			"splitMarker": "The story splits here"
		},
		"lightbox": {
			"label": "The comic page, full size",
			"coverLabel": "The cover, full size",
			"beatsLabel": "The panels",
			"close": "Close",
			"download": "Download",
			"downloadName": "novelspell-remix-comic"
		},
		"legal": {
			"close": "Close",
			"pages": {
				"terms": {
					"title": "Terms of Service",
					"url": "/terms/"
				},
				"privacy": {
					"title": "Privacy Policy",
					"url": "/privacy/"
				},
				"contact": {
					"title": "Contact",
					"url": "mailto:info@novelspell.com"
				}
			},
			"contact": {
				"lede": "Questions about NovelSpell Remix, your data or these pages? Write to us.",
				"emailLabel": "Email",
				"email": "info@novelspell.com",
				"operatorLabel": "Operated by",
				"operator": "Frostwave Labs Inc."
			}
		},
		"hosting": {
			"legal": "Generated content may be used to improve Meta models; don’t enter personal information.",
			"line": {
				"showcase": "Live remixing is paused. Browse the examples."
			},
			"toast": {
				"paused": "Live remixing is paused. Browse the examples.",
				"shareFailed": "Your link isn’t online yet. We’ll try again when you come back to this page.",
				"linkCopied": "Link copied."
			}
		}
	},
	"layout": {
		/** The brand name the logo links and frames are labelled with. */
		"brand": "NovelSpell Remix",
		"header": {
			"nav": {
				"tools": {
					"theme": {
						"default": "light"
					}
				}
			},
			"localization": {
				"themeLight": "Switch to light mode",
				"themeDark": "Switch to dark mode"
			},
			"skipToContent": "Skip to main content"
		},
		"footer": {
			"links": [
				{
					"text": "Terms",
					"url": "/terms/"
				},
				{
					"text": "Privacy",
					"url": "/privacy/"
				},
				{
					"text": "Contact",
					"url": "mailto:info@novelspell.com"
				}
			],
			"address": false,
			/** {year}: the build year; {host}: the site host. */
			"copyright": "{year} {host} All rights reserved."
		}
	}
} as const;

export type Content = typeof en;
