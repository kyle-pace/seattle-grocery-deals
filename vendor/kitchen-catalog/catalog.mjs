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
const QUALIFIER = /^(?:organic|fresh|frozen|large|small|medium|jumbo|extra|select|premium|natural|local|whole|boneless|skinless|bone|skin|in|on|sliced|diced|chopped|bag|pack|package|tray|bunch|ea|each|ct|count|pc|pcs|lb|lbs|oz|fl|kg|g|ml|l|gal|dozen|doz|value|family|club|bulk|assorted|headless|cut|fillet|filet|steak|portion|piece|chunk|point|flat|roll|wing|midjoint|tip|loin|chop|shank|half|jarred|canned|bottle|jar|can|\d+(?:\.\d+)?)$/;

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
    const head = ` ${words.slice(0, end).join(" ")} `;
    const all = ` ${words.join(" ")} `;
    let best = null;
    for (const t of catalog.terms) {
      const at = all.indexOf(` ${t.term} `);
      if (at < 0) continue;
      const atHead = head.endsWith(` ${t.term} `) || all.endsWith(` ${t.term} `);
      const before = all.slice(0, at).trim().split(" ").pop();
      const changed = t.words === 1 && CHANGES_IT.has(before);
      const rest = new Set(words.filter((w) => !t.term.split(" ").includes(w)));
      const nameWords = normalize(catalog.items[t.id].name).split(" ").filter((w) => !t.term.split(" ").includes(w));
      const overlap = nameWords.filter((w) => rest.has(w)).length;
      const strong = atHead && !changed && (t.words >= 2 || t.isName || end <= 3);
      const score = t.words * 10 + overlap * 3 + (atHead ? 2 : 0) + (t.isName ? 1 : 0) + (strong ? 5 : 0);
      if (!best || score > best.score) best = { id: t.id, item: catalog.items[t.id], term: t.term, strength: strong ? "strong" : "weak", score };
    }
    return best;
  };
  const a = read(text);
  const r = reorder(text);
  const b = r ? read(r) : null;
  const pick = !a ? b : !b ? a : b.score > a.score ? b : a;
  if (!pick) return null;
  const { score, ...result } = pick;
  return result;
}
