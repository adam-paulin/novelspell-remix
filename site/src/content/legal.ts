// The two legal documents (Terms of Service, Privacy Policy) as typed blocks, the text of the shipped /terms and /privacy
// pages. Both follow the legal templates of the main NovelSpell site (novelspell.com): same sections,
// order and wording; only Remix facts differ (terms effective 2026-11-02; privacy 2026-11-04: Cloudflare hosting, Meta and, in Fast mode,
// Baseten; what-if text and shared remixes; browser storage; no orders or billing). Each page renders its document in full
// (title as <h1>); the footer-link dialog compiles the same blocks without the title (LegalDialog.astro).
// Inline text is a string or a list of runs, where { strong } is bold. Soft line breaks are kept as the policy source wraps them.
export type Inline = string | Array<string | { strong: string }>;
export type Block = { h2: Inline } | { h3: Inline } | { p: Inline } | { ul: Inline[] } | { hr: true };
export interface LegalDocument { title: string; seo: { title: string; description: string }; blocks: Block[] }

export const legal: Record<"terms" | "privacy", LegalDocument> = {
	"terms": {
		"title": "Terms of Service",
		"seo": {
			"title": "Terms of Service | NovelSpell Remix",
			"description": "Frostwave Labs Inc. terms of service for novelspell-remix.apptory.workers.dev."
		},
		"blocks": [
			{
				"p": [
					{
						"strong": "Website:"
					},
					" https://novelspell-remix.apptory.workers.dev"
				]
			},
			{
				"p": [
					{
						"strong": "Company:"
					},
					" Frostwave Labs Inc."
				]
			},
			{
				"p": [
					{
						"strong": "Contact:"
					},
					" info@novelspell.com"
				]
			},
			{
				"p": [
					{
						"strong": "Address:"
					},
					" 2967 Dundas St. W. #992, Toronto, ON M6P 1Z2, Canada"
				]
			},
			{
				"p": [
					{
						"strong": "Jurisdiction:"
					},
					" Ontario, Canada"
				]
			},
			{
				"p": [
					{
						"strong": "Effective date:"
					},
					" 2026-11-02"
				]
			},
			{
				"p": "By accessing or using https://novelspell-remix.apptory.workers.dev (the \"Website\"), you agree to these Terms of\nService (the \"Terms\") and acknowledge our Privacy Policy. If you do not agree,\ndo not use the Website."
			},
			{
				"hr": true
			},
			{
				"h2": "1) Definitions"
			},
			{
				"p": "For purposes of these Terms:"
			},
			{
				"ul": [
					[
						{
							"strong": "\"Content\""
						},
						" means text, images, graphics, audio, video, code, and other\nmaterials made available on the Website."
					],
					[
						{
							"strong": "\"User\" / \"you\""
						},
						" means any person who accesses or uses the Website."
					],
					[
						{
							"strong": "\"We\" / \"us\" / \"our\""
						},
						" means Frostwave Labs Inc."
					],
					[
						{
							"strong": "\"Third-party services\""
						},
						" means services and sites not owned or controlled\nby us, including linked sites and providers used for enabled Website features."
					]
				]
			},
			{
				"hr": true
			},
			{
				"h2": "2) Who we are"
			},
			{
				"p": "The Website is owned and operated by Frostwave Labs Inc."
			},
			{
				"p": "The Website may also use the brand or site name NovelSpell. Our mailing address is 2967 Dundas St. W. #992, Toronto, ON M6P 1Z2, Canada."
			},
			{
				"hr": true
			},
			{
				"h2": "3) Eligibility"
			},
			{
				"p": "You must be at least 13 years old, or the age of majority in your jurisdiction\nif higher, to use the Website. By using the Website, you represent and warrant\nthat you meet this requirement and have the legal capacity to enter into these\nTerms."
			},
			{
				"hr": true
			},
			{
				"h2": "4) Website content"
			},
			{
				"p": "Content on this Website is provided for general informational, entertainment,\nmarketing, and educational purposes only and is not professional advice, including legal,\nmedical, financial, tax, or other regulated advice. You should not rely on any\nContent as a substitute for professional advice tailored to your situation."
			},
			{
				"p": "We do not represent or warrant that any Content is current, complete, or\nerror-free, and we may change or remove Content at any time."
			},
			{
				"p": "Some Content may be generated or assisted by automated systems, including\nartificial intelligence, and may contain errors or omissions. You agree to\nindependently verify any Content before relying on it."
			},
			{
				"p": "We do not guarantee any specific outcomes or results from your use of the\nWebsite or Content."
			},
			{
				"hr": true
			},
			{
				"h2": "5) Intellectual property"
			},
			{
				"p": "Unless otherwise stated, we own or license the content on the Website,\nincluding text, graphics, logos, and design."
			},
			{
				"p": "You may view and print content for personal, non-commercial use. You may not\nreproduce, distribute, sell, or create derivative works from our content without\npermission."
			},
			{
				"p": "If you believe content infringes your rights, contact: info@novelspell.com"
			},
			{
				"p": "Nothing in these Terms grants you any license or right to use our trademarks,\nlogos, or brand features without our prior written permission."
			},
			{
				"p": [
					{
						"strong": "Feedback:"
					},
					" If you provide us with feedback, suggestions, or ideas regarding\nthe Website, you assign all rights in that feedback to us and agree that we may\nuse it and related information in any manner we deem appropriate."
				]
			},
			{
				"hr": true
			},
			{
				"h2": "6) Copyright infringement"
			},
			{
				"p": "We respect the intellectual property rights of others. If you believe material\nlocated on or linked to by the Website violates your copyright, contact us at\ninfo@novelspell.com with:"
			},
			{
				"ul": [
					"Your physical or electronic signature",
					"Identification of the copyrighted work",
					"Identification of the material you believe is infringing",
					"Your contact information",
					"A statement that you have a good faith belief that the use is not authorized",
					"A statement that the information is accurate and that you are the copyright\nowner or authorized to act on their behalf"
				]
			},
			{
				"p": "We will respond as required or appropriate, including by removing the\ninfringing material or disabling links to it."
			},
			{
				"hr": true
			},
			{
				"h2": "7) Acceptable use"
			},
			{
				"p": "You agree not to:"
			},
			{
				"ul": [
					"Use the Website in any unlawful way",
					"Attempt to disrupt or damage the Website, including scraping at abusive\nrates, probing, DDoS, malware, or similar activity",
					"Circumvent security or access restricted areas",
					"Use automated means to access the Website in a manner that imposes an\nunreasonable load or bypasses access controls, unless you have our express\nwritten permission",
					"Reverse engineer, decompile, or attempt to extract source code except to the\nextent such restriction is prohibited by law",
					"Remove, obscure, or alter proprietary notices"
				]
			},
			{
				"p": "This does not apply to generally accepted search engine crawling or indexing.\nWe may suspend or block access if we reasonably believe you are misusing the\nWebsite."
			},
			{
				"hr": true
			},
			{
				"h2": "8) Third-party links and services"
			},
			{
				"p": "The Website may link to or use third-party websites and services. We do not\ncontrol them and are not responsible for their content, policies, practices,\navailability, or security. Your use of third-party sites and services is at\nyour own risk."
			},
			{
				"p": "Third-party services may have their own terms and privacy practices. You are\nresponsible for reviewing and complying with those terms."
			},
			{
				"hr": true
			},
			{
				"h2": "9) AI-generated remixes"
			},
			{
				"p": "Remix chapters, comic pages and share images are generated automatically by AI models from your request and a public-domain book. They are fan fiction, may contain errors or content you did not expect, and are not reviewed by a person before you see them. You are responsible for what you ask for and for how you share the results."
			},
			{
				"hr": true
			},
			{
				"h2": "10) User content"
			},
			{
				"p": "The Website does not currently accept public user-submitted content, such as\ncomments. If this changes, we may update these Terms."
			},
			{
				"hr": true
			},
			{
				"h2": "11) Disclaimer of warranties"
			},
			{
				"p": "THE WEBSITE AND ALL CONTENT ARE PROVIDED \"AS IS\" AND \"AS AVAILABLE\". TO THE\nMAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR\nIMPLIED, INCLUDING ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A\nPARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT."
			},
			{
				"p": "We do not warrant that the Website will be uninterrupted, error-free, secure,\nor free of viruses or other harmful components. Any reliance on the Website or\nContent is at your own risk."
			},
			{
				"hr": true
			},
			{
				"h2": "12) Limitation of liability"
			},
			{
				"p": "To the maximum extent permitted by law, Frostwave Labs Inc. will not be liable for any\nindirect, incidental, consequential, special, or punitive damages arising from\nor related to your use of, or inability to use, the Website."
			},
			{
				"p": "Nothing in these Terms excludes or limits liability that cannot lawfully be\nexcluded or limited, including any liability or remedy preserved by mandatory\nconsumer law. If liability cannot be excluded, it will be limited only to the\nextent permitted by applicable law."
			},
			{
				"hr": true
			},
			{
				"h2": "13) Indemnity"
			},
			{
				"p": "You agree to indemnify and hold harmless Frostwave Labs Inc. from claims, damages,\nliabilities, and expenses arising out of your misuse of the Website or\nviolation of these Terms."
			},
			{
				"p": "This includes claims arising from:"
			},
			{
				"ul": [
					"Your violation of any applicable law or regulation",
					"Your infringement or alleged infringement of any third-party rights",
					"Your use of third-party products or services linked from the Website"
				]
			},
			{
				"hr": true
			},
			{
				"h2": "14) Changes to the Website or Terms"
			},
			{
				"p": "We may change or discontinue the Website at any time. We may update these Terms\nby posting an updated version with a new effective date. Changes apply\nprospectively from that date. Where applicable law requires notice or consent,\nwe will provide it."
			},
			{
				"hr": true
			},
			{
				"h2": "15) Termination"
			},
			{
				"p": "We reserve the right, without notice and in our sole discretion, to terminate\nyour right to use the Website, and to block or prevent your future access to\nand use of the Website, if you violate these Terms or for any lawful reason."
			},
			{
				"p": "All provisions of these Terms which by their nature should survive termination\nshall survive termination, including ownership provisions, warranty\ndisclaimers, indemnity, and limitations of liability."
			},
			{
				"hr": true
			},
			{
				"h2": "16) Governing law and consumer rights"
			},
			{
				"p": "These Terms are governed by the laws of Ontario, Canada, without regard to\nconflict-of-law rules."
			},
			{
				"p": "This choice of law does not deprive you of mandatory consumer protections that\napply where you live."
			},
			{
				"hr": true
			},
			{
				"h2": "17) Dispute resolution"
			},
			{
				"p": "Before filing a claim, you agree to contact us at info@novelspell.com and make a\nreasonable attempt to resolve the dispute informally. This does not prevent\neither party from seeking urgent relief or using a court, tribunal, regulator,\nconsumer-protection body, or dispute process available under applicable law."
			},
			{
				"hr": true
			},
			{
				"h2": "18) Severability; waiver; assignment"
			},
			{
				"p": "If any provision of these Terms is held unlawful, void, or unenforceable, that\nprovision will be severed and the remaining provisions will remain in full\nforce and effect."
			},
			{
				"hr": true
			},
			{
				"h2": "19) Entire agreement"
			},
			{
				"p": "These Terms constitute the entire agreement between you and us regarding the\nWebsite and supersede all prior or contemporaneous agreements, understandings,\nor representations, whether written or oral."
			},
			{
				"p": [
					{
						"strong": "No third-party beneficiaries:"
					},
					" These Terms are for the benefit of you and us\nonly and do not create third-party beneficiary rights."
				]
			},
			{
				"p": [
					{
						"strong": "Headings and interpretation:"
					},
					" Section headings are for convenience only and\ndo not affect interpretation. The word \"including\" means \"including without\nlimitation\"."
				]
			},
			{
				"hr": true
			},
			{
				"h2": "20) Force majeure"
			},
			{
				"p": "We will not be liable for any delay or failure to perform resulting from causes\noutside our reasonable control, including acts of God, war, terrorism, riots,\nembargos, acts of civil or military authorities, fire, floods, accidents,\nstrikes, transportation shortages, fuel shortages, energy shortages, labor\nshortages, or material shortages."
			},
			{
				"hr": true
			},
			{
				"h2": "21) Contact"
			},
			{
				"p": [
					"Questions about these Terms: ",
					{
						"strong": "info@novelspell.com"
					}
				]
			},
			{
				"p": [
					"Mailing address: ",
					{
						"strong": "2967 Dundas St. W. #992, Toronto, ON M6P 1Z2, Canada"
					}
				]
			}
		]
	},
	"privacy": {
		"title": "Privacy Policy",
		"seo": {
			"title": "Privacy Policy | NovelSpell Remix",
			"description": "Frostwave Labs Inc. privacy policy for novelspell-remix.apptory.workers.dev."
		},
		"blocks": [
			{
				"p": [
					{
						"strong": "Website:"
					},
					" https://novelspell-remix.apptory.workers.dev"
				]
			},
			{
				"p": [
					{
						"strong": "Company:"
					},
					" Frostwave Labs Inc."
				]
			},
			{
				"p": [
					{
						"strong": "Contact:"
					},
					" info@novelspell.com"
				]
			},
			{
				"p": [
					{
						"strong": "Address:"
					},
					" 2967 Dundas St. W. #992, Toronto, ON M6P 1Z2, Canada"
				]
			},
			{
				"p": [
					{
						"strong": "Jurisdiction:"
					},
					" Ontario, Canada"
				]
			},
			{
				"p": [
					{
						"strong": "Effective date:"
					},
					" 2026-11-04"
				]
			},
			{
				"p": "We are based in Ontario, Canada."
			},
			{
				"h2": "Privacy contact and data controller"
			},
			{
				"p": "For purposes of applicable data protection laws, the data controller is:"
			},
			{
				"p": "Frostwave Labs Inc."
			},
			{
				"p": "Email: info@novelspell.com"
			},
			{
				"p": "Address: 2967 Dundas St. W. #992, Toronto, ON M6P 1Z2, Canada"
			},
			{
				"p": "Ontario, Canada"
			},
			{
				"p": "Use the contact details above for privacy inquiries, rights requests, or\ncomplaints. We will review and respond in accordance with applicable law."
			},
			{
				"p": "This Privacy Policy explains how Frostwave Labs Inc. (\"we\", \"us\", or \"our\") collects,\nuses, discloses, and protects information when you visit or use https://novelspell-remix.apptory.workers.dev\n(the \"Website\")."
			},
			{
				"p": "This policy is intended to describe our practices in a clear manner. It does\nnot limit any rights or remedies available under applicable law."
			},
			{
				"hr": true
			},
			{
				"h2": "1) Definitions"
			},
			{
				"p": "For purposes of this Privacy Policy:"
			},
			{
				"ul": [
					[
						{
							"strong": "\"Personal information\" / \"personal data\""
						},
						" means information that\nidentifies, relates to, describes, is reasonably capable of being associated\nwith, or could reasonably be linked with you or your device."
					],
					[
						{
							"strong": "\"Processing\""
						},
						" means any operation performed on personal information,\nincluding collection, use, storage, disclosure, or deletion."
					],
					[
						{
							"strong": "\"Service providers\""
						},
						" means vendors that process information on our behalf\nto provide enabled features such as hosting, security, payment processing,\nfulfillment, analytics, communications, and support."
					],
					[
						{
							"strong": "\"Controller\""
						},
						" or ",
						{
							"strong": "\"business\""
						},
						", where applicable, means the entity that\ndetermines the purposes and means of processing personal information."
					]
				]
			},
			{
				"hr": true
			},
			{
				"h2": "2) What we collect"
			},
			{
				"h3": "Information you provide"
			},
			{
				"ul": [
					[
						{
							"strong": "Contact, order, and support information:"
						},
						" If you contact us, request\ninformation, submit a form, place an order, or ask for support, we collect the\ndetails you choose to provide and may keep records needed to respond, fulfill\nthe request, and maintain the resulting transaction or correspondence."
					],
					[
						{
							"strong": "Remix requests:"
						},
						" The what-if request and revision notes you type are sent, with the book\npassage, to the AI providers named below to write your chapter and draw its\npictures. The Website has no accounts."
					],
					[
						{
							"strong": "Shared remixes:"
						},
						" When you share a remix, we store the what-if request as shown, the\nshared chapter and its cover and comic pictures so anyone with the link can\nread it."
					]
				]
			},
			{
				"h3": "Information collected automatically"
			},
			{
				"ul": [
					[
						{
							"strong": "Device and usage data:"
						},
						" IP address, browser type, device identifiers,\npages viewed, time spent, referral URLs, and similar diagnostics."
					],
					[
						{
							"strong": "Cookies and similar technologies:"
						},
						" We may use cookies, pixels, tags, local\nstorage, or similar technologies to operate the Website, remember preferences,\nmeasure performance, protect against abuse, and support the features enabled\nfor this Website. On this Website, your browser's local and session storage keep\nyour remixes, drafts and settings (such as theme and Fast mode) on your device."
					],
					[
						{
							"strong": "Log and security data:"
						},
						" We and our service providers may collect logs and\nrelated information to maintain the security and integrity of the Website,\nincluding detecting suspicious activity, preventing abuse, and troubleshooting."
					]
				]
			},
			{
				"hr": true
			},
			{
				"h2": "3) How we use information"
			},
			{
				"p": "We may use information to:"
			},
			{
				"ul": [
					"Provide, operate, secure, and maintain the Website",
					"Respond to inquiries and provide customer support",
					"Generate the remix chapters and pictures you request, and keep shared remixes\navailable at their link",
					"Understand Website usage and improve content, performance, and reliability",
					"Prevent fraud, abuse, security incidents, and unlawful activity",
					"Enforce our Terms of Service and other agreements",
					"Comply with legal obligations and respond to lawful requests",
					"Protect the rights, safety, and property of us, our users, and others"
				]
			},
			{
				"hr": true
			},
			{
				"h2": "4) Named service providers and recipients"
			},
			{
				"p": "The following providers or recipients are declared for this Website. Each is\nused only for the role and purpose described in the current configuration."
			},
			{
				"ul": [
					[
						{
							"strong": "Cloudflare, Inc."
						},
						" — Role: website hosting, edge delivery, and security provider. Purpose: Provide Workers hosting, CDN and edge delivery, security controls, and request logging for the Website. Cloudflare's privacy policy and applicable service terms govern provider retention; no fixed provider retention period is declared here. Information: IP address, request headers, browser and device information, requested URLs, security and diagnostic logs. Countries or regions: United States, European Economic Area, other countries where Cloudflare operates. Transfer mechanism: EU-U.S. Data Privacy Framework, Swiss-U.S. Data Privacy Framework, UK Extension to the EU-U.S. Data Privacy Framework, and Standard Contractual Clauses where applicable. Safeguards: Cloudflare's privacy policy describes its Data Privacy Framework certifications and Standard Contractual Clauses for applicable international transfers. Legal basis: Legitimate interests in operating, securing, and delivering the Website."
					],
					[
						{
							"strong": "Meta Platforms, Inc. (Meta Model API)"
						},
						" — Role: text and image generation service provider. Purpose: Write and revise the remix chapter you ask for (Muse Wonder) and draw its comic page and the cover of the alternate book (Muse Image): receives the book passage, your what-if request and revision notes, and returns generated text and images. Information: what-if requests and revision notes you type, the generated chapter text. Endpoint or service: https://www.facebook.com/privacy/policy/. Countries or regions: United States, other countries where Meta operates. Safeguards: Transfer safeguards are governed by Meta’s current terms and configuration. Legal basis: Providing the remix you request."
					],
					[
						{
							"strong": "Baseten Labs, Inc."
						},
						" — Role: model hosting (inference) service provider. Purpose: Only when you turn on Fast mode: runs Muse Spark Open, Meta’s open-weights model, to write and revise the remix chapter: receives the book passage, your what-if request and revision notes, and returns the generated text. Information: what-if requests and revision notes you type, the generated chapter text. Endpoint or service: https://www.baseten.co/privacy-policy/. Countries or regions: United States. Safeguards: Transfer safeguards are governed by Baseten’s current terms and configuration. Legal basis: Providing the remix you request."
					]
				]
			},
			{
				"hr": true
			},
			{
				"h2": "5) Sharing and disclosures"
			},
			{
				"p": "We may share information:"
			},
			{
				"ul": [
					"With service providers who help operate the Website and provide enabled\nfeatures",
					"To comply with legal obligations or lawful requests",
					"To protect our rights, safety, and property, and that of users and others",
					"In connection with a merger, acquisition, financing, restructuring, or sale of\nassets, where permitted by law"
				]
			},
			{
				"p": "We do not authorize service providers to use personal information we share with\nthem except as necessary to provide services to us or to comply with applicable\nlaw."
			},
			{
				"p": "We may also share aggregated or de-identified information that cannot\nreasonably be used to identify you."
			},
			{
				"hr": true
			},
			{
				"h2": "6) Data retention"
			},
			{
				"p": "We retain personal information only as long as needed for the purposes\ndescribed in this policy, unless a longer retention period is required or\npermitted by law."
			},
			{
				"p": "Examples include retaining correspondence for support records, technical logs\nfor security and operational purposes, and shared remixes for as long as their\nlink is offered, unless you ask us to remove them. Remixes you do not share are\nkept in your browser, not on our servers."
			},
			{
				"hr": true
			},
			{
				"h2": "7) Security and your rights"
			},
			{
				"p": "We use reasonable technical and organizational measures to protect information.\nNo method of transmission or storage is 100% secure, so we cannot guarantee\nabsolute security."
			},
			{
				"p": "You may have rights depending on your location, including:"
			},
			{
				"ul": [
					"Access, correction, or deletion of personal information",
					"Objection or restriction of processing",
					"Data portability",
					"Withdrawal of consent where processing is based on consent"
				]
			},
			{
				"p": [
					"To exercise rights, contact: ",
					{
						"strong": "info@novelspell.com"
					}
				]
			},
			{
				"hr": true
			},
			{
				"h2": "8) GDPR notes"
			},
			{
				"p": "If you are in the EEA or UK, we rely on a legal basis for processing such as:"
			},
			{
				"ul": [
					"Consent, for example where required for optional cookies or requested email\ncommunications",
					"Legitimate interests, for example site security, fraud prevention, support,\nand basic operational analytics where permitted by law",
					"Contract, where processing is needed to take steps at your request or perform\nan agreement",
					"Legal obligation, where processing is required by applicable law"
				]
			},
			{
				"p": "Where we rely on legitimate interests, we consider and balance any potential\nimpact on your rights and may limit processing where required. You also have\nthe right to lodge a complaint with your local data protection authority."
			},
			{
				"hr": true
			},
			{
				"h2": "9) California privacy notes"
			},
			{
				"p": "We may collect identifiers, internet or electronic network activity\ninformation, commercial information where applicable, and other information you\nprovide or that is generated through your use of the Website."
			},
			{
				"p": "We do not sell personal information in the traditional sense. If this Website later enables advertising or ad-tech features that are considered sharing under California privacy law, we will provide required notices or controls."
			},
			{
				"p": "If you submit a request to exercise your rights, we may need to verify your\nidentity, which may require additional information. We will use verification\ninformation only for that purpose."
			},
			{
				"hr": true
			},
			{
				"h2": "10) Do Not Track signals"
			},
			{
				"p": "Some browsers transmit Do Not Track or other browser-based privacy signals. We\nhonor such signals where applicable law requires it. Otherwise, because there\nis no consistent standard for interpreting every signal, users can manage\ncookie preferences through browser settings and any consent tools we provide."
			},
			{
				"hr": true
			},
			{
				"h2": "11) International visitors"
			},
			{
				"p": "If you access the Website from outside Ontario, Canada, your information may be\nprocessed in countries where our service providers operate, which may have\ndifferent data protection laws."
			},
			{
				"p": "For the named providers or recipients above, the declared transfer details are:"
			},
			{
				"ul": [
					[
						{
							"strong": "Cloudflare, Inc."
						},
						" — countries or regions: United States, European Economic Area, other countries where Cloudflare operates; transfer mechanism: EU-U.S. Data Privacy Framework, Swiss-U.S. Data Privacy Framework, UK Extension to the EU-U.S. Data Privacy Framework, and Standard Contractual Clauses where applicable; safeguards: Cloudflare's privacy policy describes its Data Privacy Framework certifications and Standard Contractual Clauses for applicable international transfers."
					],
					[
						{
							"strong": "Meta Platforms, Inc. (Meta Model API)"
						},
						" — countries or regions: United States, other countries where Meta operates; safeguards: Transfer safeguards are governed by Meta’s current terms and configuration."
					],
					[
						{
							"strong": "Baseten Labs, Inc."
						},
						" — countries or regions: United States; safeguards: Transfer safeguards are governed by Baseten’s current terms and configuration."
					]
				]
			},
			{
				"p": "Where required by applicable law, cross-border transfers are subject to\nrecognized safeguards, such as an adequacy decision, Standard Contractual\nClauses, a UK International Data Transfer Addendum, or another lawful transfer\nmechanism. The safeguards stated for a named provider apply only where that\nprovider and transfer are enabled.\nContact the privacy contact listed above to request information about the safeguards applying to a transfer of your personal data and, where applicable, a copy of those safeguards."
			},
			{
				"hr": true
			},
			{
				"h2": "12) Links to other websites"
			},
			{
				"p": "The Website may contain links to other websites that are not operated by us. If\nyou click on a third-party link, you will be directed to that third party's\nsite. We strongly advise you to review the Privacy Policy of every site you\nvisit. We have no control over and assume no responsibility for the content,\nprivacy policies, or practices of third-party sites or services."
			},
			{
				"hr": true
			},
			{
				"h2": "13) Children's privacy"
			},
			{
				"p": [
					"The Website is not intended for children under 13, or the minimum age required\nby your jurisdiction if higher. We do not knowingly collect personal\ninformation from children. If you believe a child provided us data, contact\n",
					{
						"strong": "info@novelspell.com"
					},
					"."
				]
			},
			{
				"hr": true
			},
			{
				"h2": "14) Sensitive personal information"
			},
			{
				"p": "We ask that you do not send us, and do not disclose, any sensitive personal\ninformation on or through the Website or otherwise to us unless we specifically\nrequest it for a lawful purpose."
			},
			{
				"hr": true
			},
			{
				"h2": "15) Changes to this policy"
			},
			{
				"p": "We may update this policy from time to time. The updated version will be posted\non this page with a revised effective date."
			},
			{
				"hr": true
			},
			{
				"h2": "16) Contact"
			},
			{
				"p": [
					"Questions about this Privacy Policy: ",
					{
						"strong": "info@novelspell.com"
					}
				]
			},
			{
				"p": [
					"Mailing address: ",
					{
						"strong": "2967 Dundas St. W. #992, Toronto, ON M6P 1Z2, Canada"
					}
				]
			}
		]
	}
};

const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const runs = (text: Inline): string => typeof text === "string" ? escape(text) : text.map((run) => typeof run === "string" ? escape(run) : `<strong>${escape(run.strong)}</strong>`).join("");

/** A document's blocks as HTML, one block a line, the markup the shipped pages carry. */
export function legalHtml(blocks: readonly Block[]): string {
	return blocks.map((block) => {
		if ("hr" in block) return "<hr/>";
		if ("ul" in block) return `<ul>\n${block.ul.map((item) => `<li>${runs(item)}</li>`).join("\n")}\n</ul>`;
		const [tag, text] = Object.entries(block)[0] as ["h2" | "h3" | "p", Inline];
		return `<${tag}>${runs(text)}</${tag}>`;
	}).join("\n");
}
