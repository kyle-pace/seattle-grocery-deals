---
name: search-setup
description: Set up a website so search engines find it (Google Search Console, Bing Webmaster Tools, IndexNow), or check that setup. Use when launching a site on its own domain, adding a sitemap, moving a site to a new domain, or when asked about Search Console, Bing or IndexNow.
---

# Search setup

Every site on its own domain gets this at launch. Do the steps in order: Bing copies what Google already has, and IndexNow needs a working sitemap. Last done for all of Kyle's sites on 2026-11-16 (kylepace.net, kylepace.dev, henwood.app, seattlegrocery.deals, findish.now).

## 1. Sitemap and robots.txt

- The site serves a sitemap and `robots.txt` names it on a `Sitemap:` line. Astro's `@astrojs/sitemap` writes `/sitemap-index.xml` (pointing to `/sitemap-0.xml`), not `/sitemap.xml`. Hand-written sites keep `/sitemap.xml`.
- Before submitting anywhere, load the exact URL from `robots.txt` and check it lists the pages you expect. Submitting a guessed URL is how kylepace.net ended up with a "Couldn't fetch" entry in Search Console.
- On kylepace.dev, each lab is its own Worker, so the hub's sitemap only lists the hub's own pages.

## 2. Google Search Console

1. Go to <https://search.google.com/search-console/welcome>, choose **Add a website**, then **Domain**, and enter the bare domain (`findish.now`). Use a domain property, not a URL prefix.
2. Verifying adds a DNS record, so ask Kyle first. Pick **Any DNS provider** and **TXT** (skip the "sign in to Cloudflare" option, which grants Google access to the DNS account). Add the TXT record at the root (`@`) where the domain's DNS lives: Cloudflare for kylepace.net, kylepace.dev and findish.now; Porkbun for seattlegrocery.deals. Check it's live with `dig +short TXT <domain> @1.1.1.1`, then click **Verify**. Leave the record in place, or the property loses verification.
3. Open **Sitemaps** (`https://search.google.com/search-console/sitemaps?resource_id=sc-domain:<domain>`) and submit the **full** sitemap URL. Domain properties reject a bare path like `sitemap.xml`.
4. Check the sitemap row says **Success** with the right page count. A day or two later the Overview fills in. After about a week, check the **Pages** report and fix anything it couldn't crawl.

## 3. Bing Webmaster Tools

Bing also feeds DuckDuckGo, Yahoo and Copilot.

1. Go to My sites: <https://www.bing.com/webmasters/sites>. The **Import** option for Google Search Console is on this page only, not inside a site's dashboard (switch sites with the dropdown at the top left, and **Add site** is at the bottom of that list).
2. Import the new site from Search Console. Bing brings across verification and any sitemaps Google already had at that moment. It doesn't sync later, so a sitemap added after the import has to be submitted in Bing too: open the site, **Sitemaps**, **Submit sitemap**, full URL.
3. The dashboard says reports can take up to 48 hours. That's normal for a new site.
4. A few days later, run **Site Scan** once on the bigger sites for broken links and missing descriptions.

## 4. IndexNow

IndexNow tells Bing (and Yandex, Seznam, Naver and Yep) which pages changed right after a deploy, so nothing needs resubmitting by hand. Google doesn't use it; it reads the sitemap. Nothing needs doing on Bing's IndexNow page; submissions show up there on their own.

Every site uses the same key, `0877964bc9a1b98b43be5762f6c86c6f`. It isn't a secret: IndexNow checks it against a public file.

1. **Key file** at the site root, containing just the key: `public/0877964bc9a1b98b43be5762f6c86c6f.txt` in an Astro site, the repo root for a plain GitHub Pages site, or written into `dist/` by the build script (Seattle Grocery Deals does this in `scripts/build.mjs`). It has to be at the root, because IndexNow only accepts URLs under the folder the key file is in.
2. **Script**: copy `indexnow.mjs` from this skill to `scripts/indexnow.mjs`. It reads the live sitemap (following a sitemap index), checks the key file is live, and submits the pages changed in the last 3 days (all of them with `--all`, or when the sitemap has no `<lastmod>` dates).
3. **Workflow**: copy `indexnow.yml` from this skill to `.github/workflows/indexnow.yml` and set `SITE` and `SITEMAP`. It runs on every push to main, waits for the deploy, then submits, retrying while the key file isn't live yet.
   - Cloudflare Workers Builds sites (kylepace.net, kylepace.dev, Findish): keep the wait at 150 seconds.
   - Plain GitHub Pages sites (henwood.app): 60 seconds is enough.
   - Sites that deploy from their own Actions workflow (Seattle Grocery Deals): trigger on `workflow_run` of the deploy workflow instead of waiting, and only when that run came from a push, so scheduled rebuilds don't ping Bing every hour.
4. Push, then check the IndexNow run in the repo's Actions tab: the log should say `IndexNow answered 202` (or 200) and list the pages. `403` means the key file isn't live. Run the workflow once by hand (**Run workflow**, "all" checked) to send every page at launch.

## When a site moves to a new domain

Do all four steps for the new domain, keep 301s (or 308s) from the old addresses, and update the `SITE` and `SITEMAP` values in the IndexNow workflow.
