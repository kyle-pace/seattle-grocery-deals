// Farmers markets and independent shops (config/places.json): the checks, and which markets
// are open on a given day. Used by validate.mjs, build.mjs and scripts/places.test.mjs.
// No prices live here: these places don't post weekly flyers.
import { join } from "node:path";
import { ROOT, readJson } from "./lib.mjs";

export const KINDS = ["market", "shop", "hub"];
export const SHOP_TYPES = {
  butcher: "Butchers",
  seafood: "Fish and shellfish",
  world: "Grocers from around the world",
  neighborhood: "Neighborhood grocers",
};
export const PROGRAMS = {
  market_match: "SNAP Market Match",
  produce_rewards: "SNAP Produce Rewards",
};
export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function loadPlaces(path = join(ROOT, "config", "places.json")) {
  return readJson(path);
}

// Every problem with the file, as "id: message" strings. Empty means it's fine.
export function checkPlaces(file) {
  const errors = [];
  const err = (id, msg) => errors.push(`${id}: ${msg}`);
  if (!DATE.test(file?.checked ?? "")) err("places", "checked must be a YYYY-MM-DD date");
  if (!Array.isArray(file?.places)) return [...errors, "places: places must be a list"];
  const ids = new Map();
  for (const p of file.places) ids.set(p.id, (ids.get(p.id) ?? 0) + 1);
  const url = (v) => typeof v === "string" && /^https:\/\/[^\s]+$/.test(v);
  for (const p of file.places) {
    const id = p.id ?? "(no id)";
    if (!ID.test(p.id ?? "")) err(id, "id must be lowercase words joined by hyphens");
    if (ids.get(p.id) > 1) err(id, "id used twice");
    if (!KINDS.includes(p.kind)) err(id, `kind must be one of ${KINDS.join(", ")}`);
    for (const k of ["name", "neighborhood", "address"]) if (typeof p[k] !== "string" || !p[k].trim()) err(id, `missing ${k}`);
    if (typeof p.about !== "string" || p.about.length < 20 || p.about.length > 300) err(id, "about must be 20 to 300 characters");
    if (!url(p.source)) err(id, "source must be the https link this entry was checked against");
    if (p.website !== undefined && !url(p.website)) err(id, "website must be an https link");
    for (const k of ["weekly", "newsletter"]) {
      if (p[k] !== undefined && (typeof p[k]?.label !== "string" || !url(p[k]?.url))) err(id, `${k} needs a label and an https url`);
    }
    // Every place gets a pin, except shops inside a hub (the hub's pin covers them).
    const pinned = !(p.kind === "shop" && p.hub);
    if (pinned && !(p.lat > 46.5 && p.lat < 48.5 && p.lon > -123.5 && p.lon < -121.5)) err(id, "needs lat and lon in the Seattle area (for the map)");
    if (p.carries !== undefined && (!Array.isArray(p.carries) || !p.carries.length || p.carries.length > 8 || !p.carries.every((c) => typeof c === "string" && c.length >= 3 && c.length <= 60))) err(id, "carries must be 1 to 8 short phrases (3 to 60 characters)");
    if (p.kind === "shop" && !p.carries) err(id, "a shop needs carries: a few things it's known for");
    if (p.services !== undefined) {
      const sv = p.services;
      for (const k of Object.keys(sv)) if (!["order_online", "delivery", "ships", "phone_orders"].includes(k)) err(id, `unknown service ${k}`);
      if (sv.order_online !== undefined && (typeof sv.order_online.how !== "string" || (sv.order_online.url !== undefined && !url(sv.order_online.url)))) err(id, "services.order_online needs how, and an https url if it has one");
      for (const k of ["delivery", "ships", "phone_orders"]) if (sv[k] !== undefined && (typeof sv[k] !== "string" || sv[k].length < 8)) err(id, `services.${k} must say how, in a few words`);
    }
    if (p.kind === "shop" && !SHOP_TYPES[p.type]) err(id, `type must be one of ${Object.keys(SHOP_TYPES).join(", ")}`);
    if (p.fresh_bucks !== undefined && typeof p.fresh_bucks !== "boolean") err(id, "fresh_bucks must be true or false (true only when the City lists it as a Fresh Bucks retailer)");
    if (p.status !== undefined && !["open", "moving"].includes(p.status)) err(id, "status must be open or moving");
    if (p.status === "moving" && !p.status_note) err(id, "a moving place needs status_note saying when and where");
    if (p.hub !== undefined && !file.places.some((h) => h.id === p.hub && h.kind === "hub")) err(id, `hub ${p.hub} isn't a hub in this file`);
    if (p.kind === "hub" && p.market !== undefined && !file.places.some((m) => m.id === p.market && m.kind === "market")) err(id, `market ${p.market} isn't a market in this file`);
    if (p.kind === "market") {
      if (!Array.isArray(p.hours) || !p.hours.length || !p.hours.every((h) => typeof h === "string" && h)) err(id, "hours must be a list of lines, like \"Sundays 9am to 2pm, all year\"");
      for (const k of p.programs ?? []) if (!PROGRAMS[k]) err(id, `unknown program ${k}`);
      if (p.now !== undefined) {
        const n = p.now;
        if (!Array.isArray(n.days) || !n.days.length || !n.days.every((d) => DAYS.includes(d))) err(id, `now.days must be a list of ${DAYS.join(", ")}`);
        if (typeof n.time !== "string" || !n.time) err(id, "now.time must say the hours, like \"9am to 2pm\"");
        for (const k of ["from", "through"]) if (n[k] !== undefined && !DATE.test(n[k])) err(id, `now.${k} must be a YYYY-MM-DD date`);
        if (n.from && n.through && n.from > n.through) err(id, "now.from is after now.through");
      }
      for (const s of p.special ?? []) if (!DATE.test(s.date ?? "") || !s.name) err(id, "each special needs a YYYY-MM-DD date and a name");
      for (const c of p.closed ?? []) if (!DATE.test(c.date ?? "") || !c.note) err(id, "each closed needs a YYYY-MM-DD date and a note");
    } else if (p.now || p.special || p.hours || p.programs) {
      err(id, "only markets have hours, now, special or programs");
    }
  }
  return errors;
}

// YYYY-MM-DD plus n days, and its weekday ("sun".."sat"), in plain calendar terms (no time zone).
export function addDay(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const weekday = (date) => DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];

// Is the market's regular run on that date? Every-day markets count, closures don't.
export function regularOn(p, date) {
  if (p.kind !== "market") return false;
  if ((p.closed ?? []).some((c) => c.date === date)) return false;
  if (p.every_day) return true;
  const n = p.now;
  if (!n) return false;
  if (n.from && date < n.from) return false;
  if (n.through && date > n.through) return false;
  return n.days.includes(weekday(date));
}

// Is the market running at all in the coming weeks (its regular run hasn't ended)?
export const runningNow = (p, today) => p.kind === "market" && (p.every_day || (p.now && !(p.now.through && p.now.through < today)));

// The next `n` days from today, each with the markets open that day: [{ date, open: [{ place, time, name? }] }].
// Every-day markets are left out (the page says so once instead of on every day).
export function daysAhead(places, today, n = 7) {
  return Array.from({ length: n }, (_, i) => {
    const date = addDay(today, i);
    const open = [];
    for (const p of places) {
      if (p.kind !== "market" || p.every_day) continue;
      if (regularOn(p, date)) open.push({ place: p, time: p.now.time });
      for (const s of p.special ?? []) if (s.date === date) open.push({ place: p, time: s.time ?? null, name: s.name });
    }
    return { date, open };
  });
}

// Special market days from today through `days` days out, soonest first.
export function upcomingSpecials(places, today, days = 60) {
  const end = addDay(today, days);
  return places.filter((p) => p.kind === "market")
    .flatMap((p) => (p.special ?? []).filter((s) => s.date >= today && s.date <= end).map((s) => ({ ...s, place: p })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.place.name.localeCompare(b.place.name));
}

// The public feed, /api/places.json: what the MCP server reads. Every entry keeps its own
// fields, plus its page address, and markets get the days they're open in the next week.
export function placesFeed(file, today, pageUrl) {
  const ahead = daysAhead(file.places, today, 7);
  const out = (p) => {
    const { source, ...rest } = p;
    const anchor = p.kind === "market" ? `markets/#${p.id}` : `shops/#${p.id}`;
    const item = { ...rest, url: pageUrl(anchor) };
    if (p.kind === "market") {
      item.open_next_7_days = p.every_day
        ? ahead.map((d) => d.date).filter((d) => regularOn(p, d)).map((date) => ({ date, time: "every day" }))
        : ahead.flatMap((d) => d.open.filter((o) => o.place === p).map((o) => ({ date: d.date, time: o.time, ...(o.name ? { event: o.name } : {}) })));
      item.closed = (p.closed ?? []).filter((c) => c.date >= today);
      item.special = (p.special ?? []).filter((s) => s.date >= today);
    }
    return item;
  };
  return {
    checked: file.checked,
    generated: today,
    note: "No prices: these markets and shops don't post weekly flyers. Hours and details were checked on the `checked` date; confirm before a special trip.",
    shop_types: SHOP_TYPES,
    programs: PROGRAMS,
    places: file.places.map(out),
  };
}
