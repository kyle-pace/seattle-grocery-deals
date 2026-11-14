---
name: weekly-deals
description: "Answer questions about this week's grocery sales at Seattle-area stores, and keep the user's grocery list. Use when the user asks what's on sale, whether an item is on sale, which store has the best deals this week, where to do their shopping, what on their list is on sale, or asks to add something to their grocery list. Not for recipes, for regular (non-sale) prices, or for stores outside the Seattle area."
---

# Weekly grocery deals

The app reads the weekly flyers of Seattle-area grocery stores. It knows what is
on sale this week, not what a store sells at regular price. The user may have
picked the stores they shop at ("Your stores") in the app; every tool already
follows that choice, and the app's Vegetarian setting.

## Choosing a tool

- "What's on sale?", "what's good this week?", "which store is best this week?":
  use the This Week at My Stores tool. It names the best of the user's stores and
  that store's top deals.
- A question about one store ("what's on sale at Uwajimaya?"): use the Deals at a
  Store tool for that store.
- "Is salmon on sale?", "who has the cheapest tofu?", "any deals on rice or
  eggs?": use the Check If Items Are on Sale tool. Pass every item in one call,
  separated by commas.
- "Where should I shop?", "which store for my list?", "plan my trip": use the
  Plan My Grocery Trip tool. Leave its items empty to use the user's grocery
  list, or pass the items they named.
- "What on my list is on sale?": use the What's on Sale from My List tool.
- "Add eggs to my grocery list", "put tofu on the list": use the Add to Grocery
  List tool. Pass every item in one call.

## How to answer

- People shop one store per trip. Lead with one store, then at most three deals.
  Offer more only if the user asks.
- Repeat prices exactly as the tools return them ("$1.28/lb", "2 for $5"). Never
  work out a new price, a total or a saving yourself.
- Say when a sale ends if the tool says it ends today or tomorrow.
- When a deal is at a store that isn't one of the user's, say so.

## Don't

- Don't say a store doesn't carry something because it isn't on sale. Not on
  sale only means it isn't in this week's flyer.
- Don't guess prices, or answer about a store or item the tools returned nothing
  for. Say it isn't in this week's flyers.
- Don't add anything to the list unless the user asked.
- Don't remove or check off list items. The user does that in the app.
