// The persimmon buddy from the app (KitchenUI Buddy.swift), drawn as inline SVG on a 100 by 100
// grid with the same proportions. Moods: neutral, happy, thinking, sleepy, sad, surprised.
// Decorative only. Colors come from CSS so it follows light and dark.
const r2 = (n) => Math.round(n * 100) / 100;
export function buddy(mood = "neutral", size = 64, cls = "") {
  const w = 7.5, sw = 3;
  const [ew, eh] = { happy: [w * 1.5, w], sleepy: [w * 1.3, 2.2], sad: [w * 0.9, w * 1.15], surprised: [w * 1.3, w * 1.3] }[mood] ?? [w, w * 1.35];
  const [mw, mh] = { happy: [18, 7], thinking: [8, 2], sleepy: [5, 4], sad: [12, 4], surprised: [6, 7] }[mood] ?? [12, 4];
  // Eyes over mouth, 5 apart, the pair centered 12 below the middle.
  const top = 62 - (eh + 5 + mh) / 2;
  const ey = top + (mood === "thinking" ? -3 : mood === "sad" ? 1 : 0);
  const eye = (cx) => {
    const x = cx - ew / 2;
    if (mood === "happy") return `<path d="M${r2(x)} ${r2(ey + eh)}Q${r2(cx)} ${r2(ey - eh * 0.6)} ${r2(x + ew)} ${r2(ey + eh)}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round"/>`;
    if (mood === "surprised") return `<circle cx="${r2(cx)}" cy="${r2(ey + eh / 2)}" r="${r2(ew / 2)}"/>`;
    return `<rect x="${r2(x)}" y="${r2(ey)}" width="${r2(ew)}" height="${r2(eh)}" rx="${r2(Math.min(ew, eh) / 2)}"/>`;
  };
  const my = top + eh + 5;
  const mx = 50 - mw / 2 + (mood === "thinking" ? 4 : 0);
  const curve = { happy: 1, neutral: 0.5, thinking: 0, sad: -0.8 }[mood];
  let mouth;
  if (curve != null) {
    const y = curve >= 0 ? my : my + mh;
    mouth = `<path d="M${r2(mx)} ${r2(y)}Q${r2(mx + mw / 2)} ${r2(y + mh * 2 * curve)} ${r2(mx + mw)} ${r2(y)}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round"/>`;
  } else if (mood === "sleepy") {
    mouth = `<ellipse cx="50" cy="${r2(my + mh / 2)}" rx="2.5" ry="2"/>`;
  } else {
    mouth = `<ellipse cx="50" cy="${r2(my + mh / 2)}" rx="3" ry="3.5" fill="none" stroke="currentColor" stroke-width="${sw}"/>`;
  }
  const blink = ["neutral", "thinking", "surprised"].includes(mood) ? " bd-blink" : "";
  const off = 8 + ew / 2;
  return `<svg class="buddy buddy-${mood}${cls ? " " + cls : ""}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true" focusable="false">`
    // Fruit: a soft rounded square with a shine at the upper left.
    + `<rect class="bd-fruit" x="7" y="25" width="86" height="70" rx="34"/><ellipse class="bd-shine" cx="28" cy="40" rx="8" ry="5" transform="rotate(-30 28 40)"/>`
    // Stem, then the calyx: four leaves in an X, squashed flat like a square cap.
    + `<rect class="bd-stem" x="47.75" y="17.5" width="4.5" height="9" rx="2.25"/>`
    + `<g class="bd-leaf" transform="translate(50 27) scale(1.25 .42)">${[45, 135, 225, 315].map((a) => `<ellipse cx="9" rx="10.5" ry="5.5" transform="rotate(${a})"/>`).join("")}</g>`
    + `<g class="bd-face" fill="currentColor"><g class="bd-eyes${blink}">${eye(50 - off)}${eye(50 + off)}</g>${mouth}</g></svg>`;
}

// The buddy's fruit without a face, for the menu icon and the falling persimmons.
export const PERSIMMON_SVG = `<svg viewBox="0 0 100 100" width="21" height="21" aria-hidden="true"><rect class="bd-fruit" x="7" y="25" width="86" height="70" rx="34"/><ellipse class="bd-shine" cx="28" cy="40" rx="8" ry="5" transform="rotate(-30 28 40)"/><rect class="bd-stem" x="47.75" y="17.5" width="4.5" height="9" rx="2.25"/><g class="bd-leaf" transform="translate(50 27) scale(1.25 .42)">${[45, 135, 225, 315].map((a) => `<ellipse cx="9" rx="10.5" ry="5.5" transform="rotate(${a})"/>`).join("")}</g></svg>`;

// A plain leaf in a circle, for seasonal items without a character yet (KitchenUI's SeasonMark).
// Sits low in the box like the persimmon's fruit, so it lines up with the buddy wherever it stands in.
export const LEAF_SVG = `<svg viewBox="0 0 100 100" width="21" height="21" aria-hidden="true"><circle cx="50" cy="60" r="36" fill="var(--season-soft, #e3efe7)"/><path d="M34 77C34 55 48 44 67 44c0 20-11 34-31 34" fill="var(--season, #1d4d33)"/><path d="M34 79c6-11 14-19 23-25" fill="none" stroke="var(--surface, #fff)" stroke-width="3.5" stroke-linecap="round"/></svg>`;

// Each season's fruit without a face (falling, the menu icon), by its KitchenUI Buddy name.
export const FRUIT_SVG = { persimmon: PERSIMMON_SVG };

/** The season's buddy with a mood, or the leaf when it has no character yet. */
export function seasonBuddy(kind, mood = "happy", size = 64, cls = "") {
  if (kind === "persimmon") return buddy(mood, size, cls);
  return LEAF_SVG.replace(' width="21" height="21"', ` width="${size}" height="${size}" class="buddy season-leaf${cls ? " " + cls : ""}"`);
}

/** The season's small icon: its fruit, or the leaf. */
export const seasonIcon = (kind) => FRUIT_SVG[kind] ?? LEAF_SVG;
