// KitchenCatalog for JavaScript (the Grocery Deals Friday run and site).
// Same rules as the Swift version: normalize, then the longest name or alias found in the text wins.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const CATALOG_PATH = join(here, "..", "Sources", "KitchenCatalog", "Resources", "catalog.json");

/** "Chicken Leg-Quarters, 10 lb!" -> "chicken leg quarter 10 lb" */
export function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9À-ɏ぀-ヿ一-鿿]+/g, " ")
    .trim()
    .split(/\s+/)
    .map(singular)
    .join(" ");
}

function singular(word) {
  if (word.length <= 3 || /(ss|us|is)$/.test(word)) return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (/(oes|ches|shes|xes)$/.test(word)) return word.slice(0, -2);
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

export function load(path = CATALOG_PATH) {
  const catalog = JSON.parse(readFileSync(path, "utf8"));
  // Every name and alias, longest first, so "chicken leg quarter" beats "chicken".
  const terms = [];
  for (const [id, item] of Object.entries(catalog.items)) {
    for (const name of [item.name, ...(item.aliases || [])]) {
      const n = normalize(name);
      if (n) terms.push({ id, term: n, words: n.split(" ").length, isName: name === item.name });
    }
  }
  // Longest first; on a tie, an item's own name beats someone else's alias.
  terms.sort((a, b) => b.words - a.words || b.term.length - a.term.length || (b.isName ? 1 : 0) - (a.isName ? 1 : 0));
  return { ...catalog, terms };
}

// Words that describe a product without changing what it is: "organic", "5 lb bag", "fresh",
// and cuts ("Atlantic salmon steak" is salmon).
const QUALIFIER = /^(?:organic|fresh|frozen|large|small|medium|jumbo|extra|select|premium|natural|local|whole|boneless|skinless|bone|skin|in|on|sliced|diced|chopped|bag|pack|package|tray|bunch|ea|each|ct|count|pc|pcs|lb|lbs|oz|fl|kg|g|ml|l|gal|dozen|doz|value|family|club|bulk|assorted|headless|cut|fillet|filet|steak|portion|piece|chunk|point|flat|roll|wing|midjoint|tip|loin|chop|shank|half|jarred|canned|bottle|jar|can|selected|variety|variant|series|size|pk|multi|single|qt|inch|of|to|the|shell|square|fz|live|box|case|regular|light|original|mini|roast|firm|soft|up|and|s|h|o|p|d|head|tail|off|peeled|deveined|raw|cooked|\d+(?:\.\d+)?(?:g|kg|ml|oz|lb|ct|pk)?)$/;

// A word just before a one-word item that makes it a different product: soy milk isn't milk.
const CHANGES_IT = new Set(["soy", "oat", "almond", "coconut", "rice", "plant", "based", "cashew", "chocolate", "strawberry", "banana", "condensed", "evaporated", "powdered", "flavored", "shrimp", "fish"]);

/** "Onion - Green" -> "green onion"; "Onion, yellow boiler" -> "yellow boiler onion" */
function reorder(text) {
  const m = String(text).replace(/\([^)]*\)/g, " ").match(/^([^,\-–]+)\s*[,\-–]\s*([^,]+)$/);
  return m ? `${m[2]} ${m[1]}` : null;
}

/**
 * The catalog item a piece of text names, or null.
 * - strength "strong": the item is what the product is (its last noun, give or take sizes, cuts
 *   and words like "organic").
 * - strength "weak": it's in there, but maybe as a flavor or an ingredient ("shrimp chips").
 * Every name and alias found is scored; specific beats general ("nappa cabbage" is napa cabbage).
 * Automated jobs should only fill in strong matches and send weak ones for review.
 */
export function match(catalog, text) {
  const read = (candidate) => {
    const words = normalize(String(candidate).replace(/\([^)]*\)/g, " ")).split(" ").filter(Boolean);
    let end = words.length;
    while (end > 1 && QUALIFIER.test(words[end - 1])) end--;
    const all = ` ${words.join(" ")} `;
    let best = null;
    const strongIds = new Set();
    for (const t of catalog.terms) {
      const at = all.indexOf(` ${t.term} `);
      if (at < 0) continue;
      // At the head: the term ends where the product name ends, give or take trailing qualifiers.
      // A term may run into the qualifiers ("beef shank boneless": "shank" is also a cut word),
      // as long as it starts inside the product name ("salmon steak" is still salmon, not steak).
      const startWord = all.slice(0, at).trim() ? all.slice(0, at).trim().split(" ").length : 0;
      const atHead = (startWord < end && startWord + t.words >= end) || all.endsWith(` ${t.term} `);
      const before = all.slice(0, at).trim().split(" ").pop();
      const changed = t.words === 1 && CHANGES_IT.has(before);
      const rest = new Set(words.filter((w) => !t.term.split(" ").includes(w)));
      const nameWords = normalize(catalog.items[t.id].name).split(" ").filter((w) => !t.term.split(" ").includes(w));
      const overlap = nameWords.filter((w) => rest.has(w)).length;
      const strong = atHead && !changed && (t.words >= 2 || t.isName || end <= 3);
      const score = t.words * 10 + overlap * 3 + (atHead ? 2 : 0) + (t.isName ? 1 : 0) + (strong ? 5 : 0);
      if (strong) strongIds.add(t.id);
      if (!best || score > best.score) best = { id: t.id, item: catalog.items[t.id], term: t.term, strength: strong ? "strong" : "weak", score };
    }
    // A longer alias found mid-name ("cosmic crisp" in "Cosmic Crisp Apples") is still a strong match
    // when another name for the same item is at the head.
    if (best && best.strength === "weak" && strongIds.has(best.id)) best.strength = "strong";
    return best;
  };
  // "Braised croaker with rice cake", "Goat meat w/skin on": the product is what comes before "with".
  // (Reading the whole name when that part names nothing was tried: it turned "Braised Yellow Croaker
  // with Rice Cake" into rice cakes.) "Beef short rib for soup": likewise before "for", but only when
  // that part names something ("Pork for stew" is stew meat, not pork).
  const beforeWith = String(text).split(/\s+(?:with\b|w\/)\s*/i)[0] || String(text);
  const beforeFor = beforeWith.split(/\s+for\b\s*/i)[0];
  const main = beforeFor && beforeFor !== beforeWith && read(beforeFor) ? beforeFor : beforeWith;
  const a = read(main);
  const r = reorder(main);
  const b = r ? read(r) : null;
  // "Popcorn, Butter Lovers or Movie Theater Butter": when the part before the comma names the
  // product outright, it wins over a flavor or variant after the comma.
  let pick = !a ? b : !b ? a : (b.strength === "strong" && a.strength === "strong") || b.score >= a.score ? b : a;
  // "Boneless Beef Top Sirloin Steaks, Premium Beef, Value Pack": with more than one comma and no
  // strong reading yet, the part before the first comma is the product.
  if (pick?.strength !== "strong" && (main.match(/,/g) || []).length >= 2) {
    const c = read(main.split(",")[0]);
    if (c?.strength === "strong") pick = c;
  }
  if (!pick) return null;
  const { score, ...result } = pick;
  return result;
}
