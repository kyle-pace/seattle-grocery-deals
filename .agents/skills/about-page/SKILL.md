---
name: about-page
description: Write or update a project's About page (how it works, where its data comes from, privacy). Use when adding an About page to a lab, app site or tool, when changing how a project collects or serves its data, or when asked to explain how something works on the site itself.
---

# About pages

Every lab and app site has one About page, and every one uses the same words for the same things, so a visitor who has read one knows how to read the next. The look belongs to the project (a transit line, graph paper, a recipe card layout). The words don't: headings and step names are plain and the same everywhere.

## Where it lives

- Address: `/<slug>/about/`. The top bar link says **About**.
- One page. A project with a lot to say (Seattle Grocery Deals) can split "How it works" onto its own page with the same headings.

## The page

**Title:** `About <name>`, using the project's name as it's listed (About Washington transit, About World cuisine). Nothing above or below it: no tagline, no lede, no "here's how" sentence. The page starts with the first section.

**Sections**, in this order, with exactly these headings. Leave out any that don't apply; don't add others.

| Heading | What goes in it |
| --- | --- |
| What it is | One or two short paragraphs: what it does and who it's for. Link to the project's main page. |
| How to use it | Only if it isn't obvious from the page: how to read the controls or the drawing. |
| How it works | Numbered steps, in the order things happen, from the source to the visitor's screen. |
| Where the data comes from | Every source, linked, with its license where it has one. Credits that a source requires go here. |
| Good to know | Limits and accuracy: how old the data can be, what's missing, what it's not for, how it's tested. |
| Ask your AI assistant | Only if the project has an MCP server. |
| For site owners | Only if the project collects from other people's sites. |
| Privacy | What's collected (usually only kylepace.dev's anonymous analytics), what stays on the device, which outside hosts are contacted. Link to the site's privacy page. |
| Get in touch | Where to send a correction or question (mail@kylepace.net, or the project's own address) and the public code link, if the repo is public. |

## Steps in "How it works"

Each step has three parts:

1. **A name**: a plain sentence about what happens. "Read the list", "Check the new data before publishing", "Your browser draws the map". Never a metaphor or a play on the project's theme ("Plate it", "Taste before serving", "Adds the play").
2. **A "Where it runs:" line**, written exactly like that: "Where it runs: GitHub Actions, once a week."
3. **One or two short paragraphs** in plain language.

Name real tools once, plainly (GitHub Actions, Cloudflare, Wikipedia). Explain a term the first time (GTFS, MCP). Numbers and dates come from the project's data at build time, never typed in.

## Words to avoid

Theme words in headings or step names ("Notes from the cook", "The route, stop by stop", "Ingredients" and "Method" as headings), headings phrased as teasers, and "Here's how…" openers. The theme can show up in the drawing and in an occasional phrase inside a paragraph, never in the structure.

## Share card

Title is the page title (`About <name>`), one plain line under it saying what the page covers, and the address. Make it with the `share-card` skill, in the project's own look.
