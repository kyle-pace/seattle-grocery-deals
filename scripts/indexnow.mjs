// Tells Bing (and the other IndexNow engines: Yandex, Seznam, Naver, Yep) which pages changed,
// so they recrawl right away instead of waiting to find the change. Runs after each deploy
// from .github/workflows/indexnow.yml. Google doesn't use IndexNow; it reads the sitemap.
//
// It reads the live sitemap (following a sitemap index), then submits:
//   - every URL, when run with --all or when the sitemap has no <lastmod> dates
//   - otherwise only URLs whose <lastmod> is within the last RECENT_DAYS days
//
// The key isn't a secret: IndexNow checks it against the copy served at https://<host>/<key>.txt.
//
// Usage: SITE=https://example.com SITEMAP=https://example.com/sitemap.xml node scripts/indexnow.mjs [--all]

const KEY = "0877964bc9a1b98b43be5762f6c86c6f";
const RECENT_DAYS = 3;

const site = new URL(process.env.SITE);
const sitemapUrl = process.env.SITEMAP || new URL("/sitemap.xml", site).href;
const all = process.argv.includes("--all");

const tag = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"))].map((m) => m[1]);
const text = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").trim();

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": "indexnow-submit (github actions)" } });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}

async function readSitemap(url, out = []) {
  const xml = await get(url);
  if (/<sitemapindex[\s>]/.test(xml)) {
    for (const loc of tag(xml, "loc")) await readSitemap(text(loc), out);
    return out;
  }
  for (const entry of tag(xml, "url")) {
    const loc = tag(entry, "loc")[0];
    const lastmod = tag(entry, "lastmod")[0];
    if (loc) out.push({ loc: text(loc), lastmod: lastmod ? new Date(text(lastmod)) : null });
  }
  return out;
}

// Make sure the key file is live before submitting, or IndexNow answers 403.
const served = (await get(new URL(`/${KEY}.txt`, site)).catch(() => "")).trim();
if (served !== KEY) {
  console.error(`Key file isn't live yet at ${site.origin}/${KEY}.txt. Nothing submitted.`);
  process.exit(1);
}

const entries = (await readSitemap(sitemapUrl)).filter((e) => new URL(e.loc).host === site.host);
const dated = entries.some((e) => e.lastmod);
const cutoff = Date.now() - RECENT_DAYS * 86_400_000;
const urls = [...new Set(
  entries.filter((e) => all || !dated || !e.lastmod || e.lastmod.getTime() >= cutoff).map((e) => e.loc),
)];

if (!urls.length) {
  console.log(`No pages changed in the last ${RECENT_DAYS} days. Nothing to submit.`);
  process.exit(0);
}

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: site.host, key: KEY, keyLocation: `${site.origin}/${KEY}.txt`, urlList: urls.slice(0, 10_000) }),
});

console.log(`IndexNow answered ${res.status} for ${urls.length} URL(s) on ${site.host}:`);
for (const u of urls) console.log(`  ${u}`);
if (res.status !== 200 && res.status !== 202) {
  console.error(await res.text());
  process.exit(1);
}
