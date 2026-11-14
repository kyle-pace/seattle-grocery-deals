// Stickers: one small drawing per catalog item, all in one style (white die-cut border, flat
// fills, a thin dark outline), for Grocery Deals' rows and anything else that shows an item.
// The drawings live in stickers/stickers.json; this turns them into SVG and picks the one to show.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const STICKERS_PATH = join(here, "..", "stickers", "stickers.json");

/** The dark of outlines, detail lines and dots. */
export const INK = "#131822";
/** Fill colors by role letter. A shape's third value is one of these, or d, l, k (below). */
export const COLORS = {
  g: "#6fd16a", G: "#2fa35a", // light and dark green
  w: "#f4efe2", t: "#e6d6b0", T: "#cdb98c", c: "#fbe7a1", // cream, tan, dark tan, pale yellow
  o: "#ff9a3d", r: "#f0483e", p: "#ff8a73", y: "#ffd23f", // orange, red, salmon pink, yellow
  b: "#a8744f", B: "#6b4a35", u: "#4fb0ea", v: "#9b6bd6", // brown, dark brown, blue, purple
  U: "#4a63c9", m: "#e84a8a", // deep blue, magenta
  e: "#b8c2cc", N: "#2c3b36", // metal gray, nori
};
/** Line and dot roles: d = dark detail line, l = light line, k = dark dot. */
export const MARKS = ["d", "l", "k"];

/** The drawings are on a 48 x 48 grid; the border needs 5 more on each side. */
export const VIEW_BOX = "-5 -5 58 58";

export function load(path = STICKERS_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The shapes for a sticker name ("bok-choy", "section-produce"), following "same as" names. */
export function shapes(stickers, name) {
  let s = stickers.stickers[name];
  for (let hops = 0; typeof s === "string" && hops < 5; hops++) s = stickers.stickers[s];
  return Array.isArray(s) ? s : null;
}

export function has(stickers, name) {
  return shapes(stickers, name) != null;
}

/**
 * The sticker to show for a catalog id: its own, else its nearest parent's, else its store
 * section's ("section-produce"). Null when there is none, or the id isn't in the catalog.
 */
export function resolve(catalog, stickers, id) {
  let section = null;
  for (let cur = id, hops = 0; cur && catalog.items[cur] && hops < 8; cur = catalog.items[cur].parent, hops++) {
    if (has(stickers, cur)) return cur;
    section ??= catalog.items[cur].section;
  }
  return sectionSticker(stickers, section);
}

/** "section-produce" for a store section (or a Deals category) that has a sticker, else null. */
export function sectionSticker(stickers, section) {
  const name = section ? `section-${section}` : null;
  return name && has(stickers, name) ? name : null;
}

/** One sticker as a standalone SVG, upright. Apps add the tilt and any shadow themselves. */
export function svg(list, { size = 58 } = {}) {
  const under = [], top = [];
  for (const [tag, geo, role] of list) {
    const line = `fill="none" stroke-linecap="round" stroke-linejoin="round"`;
    if (role === "d") {
      under.push(`<${tag} ${geo} ${line} stroke="#fff" stroke-width="6"/>`);
      top.push(`<${tag} ${geo} ${line} stroke="${INK}" stroke-width="1.4"/>`);
    } else if (role === "l") {
      top.push(`<${tag} ${geo} ${line} stroke="#fff" stroke-opacity="0.9" stroke-width="1.5"/>`);
    } else if (role === "k") {
      top.push(`<${tag} ${geo} fill="${INK}"/>`);
    } else {
      under.push(`<${tag} ${geo} fill="#fff" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>`);
      top.push(`<${tag} ${geo} fill="${COLORS[role]}" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW_BOX}" width="${size}" height="${size}">${under.join("")}${top.join("")}</svg>\n`;
}

/** Problems with the file: unknown ids, sections, tags or roles, and "same as" names that lead nowhere. */
export function problems(catalog, stickers) {
  const out = [];
  const sections = new Set(catalog.sections.map((s) => s.id));
  for (const [name, value] of Object.entries(stickers.stickers)) {
    if (name.startsWith("section-")) {
      if (!sections.has(name.slice(8))) out.push(`${name}: no such store section`);
    } else if (!catalog.items[name]) out.push(`${name}: not a catalog id`);
    const list = shapes(stickers, name);
    if (!list) { out.push(`${name}: points at "${value}", which has no drawing`); continue; }
    for (const shape of list) {
      const [tag, geo, role] = shape;
      if (!["path", "circle", "ellipse", "rect"].includes(tag)) out.push(`${name}: tag "${tag}"`);
      if (typeof geo !== "string" || /[<>]/.test(geo)) out.push(`${name}: bad attributes`);
      if (!COLORS[role] && !MARKS.includes(role)) out.push(`${name}: role "${role}"`);
    }
  }
  return out;
}
