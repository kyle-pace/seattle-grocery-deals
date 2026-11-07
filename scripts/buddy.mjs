// The site's characters, drawn as inline SVG. Decorative only; colors come from CSS so they
// follow light and dark. Moods: neutral, happy, thinking, sleepy, sad, surprised.
//
// buddy(): the crow, Seattle Grocery Deals' mascot (KitchenUI CrowBuddy), on a 200 grid. Crows
// remember where the good stuff is. persimmon(): the persimmon with a face, now only for the
// persimmon season (seasonBuddy); it was the mascot before the crow (2026-11-06).
const r2 = (n) => Math.round(n * 100) / 100;

// The crow's parts, back to front. Same paths as KitchenUI's Crow.swift.
const CROW = {
  feet: "M88 172v12m-7 2h14m22-14v12m-7 2h14",
  tail: "M148 118 L190 132 L186 142 L192 150 L150 146 Z",
  beak: "M62 78 C42 76 22 84 10 100 C9 102 10 104 13 103 C28 100 46 100 64 102 Z",
  beakLine: "M56 92 C42 93 28 96 14 101",
  body: "M40 120 C40 78 70 56 102 56 C138 56 162 84 162 122 C162 156 136 176 100 176 C64 176 40 156 40 120 Z",
  wing: "M126 110 C150 110 160 132 150 152 C140 142 126 138 116 138 C114 124 118 112 126 110 Z",
  wingLine: "M130 118 C140 122 146 130 147 140",
  tuft: "M96 60 C94 46 102 38 114 40 C108 44 106 50 108 58 Z M110 58 C112 48 120 44 128 48 C122 50 119 54 120 60 Z",
};
export function buddy(mood = "neutral", size = 64, cls = "") {
  // The eye carries the mood: open (blinking), a happy squint, looking up, closed, low, wide.
  const open = (r, px, py, pr) => `<circle cx="80" cy="82" r="${r}" fill="#fff"/><circle cx="${px}" cy="${py}" r="${pr}" fill="#111418"/><circle cx="${px + 2.5}" cy="${py - 2.5}" r="2.2" fill="#fff"/>`;
  const eye = {
    happy: `<path d="M71 86 Q80 76 89 86" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`,
    sleepy: `<path d="M71 82 Q80 88 89 82" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`,
    thinking: open(10, 78, 79, 6),
    sad: open(9, 77, 86, 5.5),
    surprised: open(12, 79, 82, 4.5),
  }[mood] ?? open(10, 77, 83, 6);
  const blink = ["neutral", "thinking", "surprised"].includes(mood) ? " bd-blink" : "";
  // The tuft droops when sleepy or sad and stands up when surprised.
  const tilt = { sleepy: 14, sad: 18, surprised: -8 }[mood] ?? 0;
  const sink = mood === "sad" ? 3 : 0;
  return `<svg class="buddy crow buddy-${mood}${cls ? " " + cls : ""}" viewBox="3 10 192 192" width="${size}" height="${size}" aria-hidden="true" focusable="false">`
    + `<path class="cr-feet" d="${CROW.feet}"/>`
    + `<g transform="translate(0 ${sink})">`
    + `<path class="cr-wing" d="${CROW.tail}"/><path class="cr-beak" d="${CROW.beak}"/><path class="cr-line" d="${CROW.beakLine}"/>`
    + `<path class="cr-body" d="${CROW.body}"/><ellipse class="cr-sheen" cx="96" cy="142" rx="38" ry="28"/>`
    + `<path class="cr-wing" d="${CROW.wing}"/><path class="cr-wing-line" d="${CROW.wingLine}"/>`
    + `<path class="cr-body cr-tuft" d="${CROW.tuft}"${tilt ? ` transform="rotate(${tilt} 108 60)"` : ""}/>`
    + `<g class="bd-eye${blink}">${eye}</g><circle cx="80" cy="108" r="7" fill="#F29A9A" opacity=".55"/>`
    + `</g></svg>`;
}

/** The persimmon with a face: the persimmon season's character. */
export function persimmon(mood = "neutral", size = 64, cls = "") {
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
  if (kind === "persimmon") return persimmon(mood, size, cls);
  return LEAF_SVG.replace(' width="21" height="21"', ` width="${size}" height="${size}" class="buddy season-leaf${cls ? " " + cls : ""}"`);
}

/** The season's small icon: its fruit, or the leaf. */
export const seasonIcon = (kind) => FRUIT_SVG[kind] ?? LEAF_SVG;
