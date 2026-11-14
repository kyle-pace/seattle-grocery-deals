# Design plan

The site's look is set (tokens in `site/assets/style.css`, KitchenUI in the app). This file records
the plan for pages that add something new to it.

## Farmers markets (/markets/) and Shops worth a trip (/shops/), November 2026

**Subject and reader.** Places that don't post weekly flyers, so there are no prices: Seattle's
farmers markets, and independent butchers, fishmongers and grocers from around the world. For
someone who already uses the deals pages and wants to know what else is out there, often to
spend less. EBT and Fresh Bucks are mentioned where they apply, never as the headline.

**The one bold element.** On Farmers markets, "The next seven days": a row of days, each with a
big date number and the markets open that day, the way a market chalkboard reads. Today is
marked with the word "Today", not a color. Everything else stays quiet.

**Colors.** No new colors. The page uses the site's tokens: `--ink`, `--text-body`, `--muted`,
`--line`, `--accent` (links, today's date), and `--good-*` for the "Takes Fresh Bucks" and EBT
program badges, in light and dark.

**Layout.**

```
Farmers markets                         Shops worth a trip
--------------------------------        --------------------------------
h1 + one sentence                       h1 + one sentence
THE NEXT SEVEN DAYS                     [Butchers] [Fish] [World] [Pike Place]
| Sat | Sun | Mon | ... |  (wraps)      BUTCHERS
| 14  | 15  | 16  |     |               name               name
| U District 9-2 | Ballard 9-2 ...      neighborhood, addr  neighborhood, addr
Pike Place is open every day.           about               about
OPEN NOW          (ruled list)          ---------------     ---------------
HARVEST AND HOLIDAY MARKETS (dates)     FISH AND SHELLFISH ...
SUMMER MARKETS (2026 dates)             PIKE PLACE MARKET (hub, its food shops)
EBT and Fresh Bucks note -> food help   Know a shop we missed?
```

Entries are a ruled directory (a line between each, no boxes), one column on phones and two or
three on wide screens, so it doesn't read as a grid of identical cards.

**Checked against the generated defaults.** No pill buttons or new badges beyond the site's own;
no small labels above headings (section names are the site's existing `sec-h` style); no
colored dots; details are joined with commas, not middle dots; copy talks about the places, not
the interface.

## The map (/map/), November 2026

**Subject and reader.** Someone deciding where to shop: what's near, who delivers, who's open today.
**The one bold element.** The map itself, full width and tall, with lettered pins (D, M, B, F, W, N)
so a kind reads without color. **Colors.** No new ones: pins use the tone marks (`--accent`,
`--good-mark`, `--bad-mark`, `--info-mark`, `--warn-mark`, `--neutral-mark`) with `--surface` letters,
which flip together in dark mode. **Layout.** Search, two rows of filter chips (they scroll sideways
on phones so the map stays near the top), the map, a legend, then the same ruled directory as the
shops page.
