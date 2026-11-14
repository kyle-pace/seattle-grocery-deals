<!-- BEGIN principles (web, apple): synced from github.com/kyle-pace/principles. Edit them there; changes made here are overwritten. -->

## Development principles

These apply to every project Kyle builds, on any platform, with any agent. The project's own section of this file adds specifics and can override a default for that project. Kyle's direct instructions in a session override both.

### Priority order

When two goals conflict, the higher one wins:

1. Accessibility
2. Privacy
3. Correctness and reliability
4. Performance
5. Polish

### Accessibility comes first

Accessibility is designed in from the first commit, not audited in at the end.

- Meet WCAG 2.2 AA at minimum. Text contrast is at least 4.5:1 (3:1 for large text and for UI parts like borders and icons), in both light and dark mode.
- Use semantic, native elements first (`button`, `a`, `label`, headings in order, landmarks). Add ARIA only when no native element does the job.
- Everything interactive works with a keyboard, has a visible focus style and has an accessible name. Touch targets are at least 24×24 px; aim for 44×44.
- Never carry meaning with color alone. Meaningful images get alt text; decorative ones get empty alt.
- Respect user settings: reduced motion, light/dark preference, text zoom to 200% without breaking layout.
- On Apple platforms that means Dynamic Type, VoiceOver labels and hints, Reduce Motion and Increase Contrast.
- Motion is short (under 300 ms for interface animation) and never `ease-in`.
- On the web, motion only runs inside `@media (prefers-reduced-motion: no-preference)`.

### Every screen size from day one

Layouts are designed for phones, tablets and big screens from the first commit, not stretched or squeezed in later.

- **Apps** are built for both phone and tablet from day one. On Apple platforms that means one universal iPhone and iPad app that supports iPad multitasking (Split View, Slide Over, Stage Manager) and resizable windows. On iPad, support every orientation. On iPhone, portrait is the default; add landscape only where it helps the app (video, maps, wide charts, a recipe propped up while cooking). Use size classes and adaptive SwiftUI layouts (`NavigationSplitView`, `ViewThatFits`, grids) so iPad gets a layout that uses the space, not a blown-up phone screen.
- **Web projects** are fully responsive: mobile first, fluid from 320 px wide up to large desktop monitors. No sideways scrolling at 320 px. Cap line length for reading (about 70 characters), and let wider screens add columns instead of stretching text.
- Prefer fluid layouts (flexbox, grid, `clamp()`, container queries) over many fixed breakpoints.
- Handle touch, mouse and keyboard on every size, and respect safe areas and notches.

### Type

- Atkinson Hyperlegible Next for all text and Atkinson Hyperlegible Mono for code, in every product.
- Self-host the fonts. Never load them from Google Fonts or any other font CDN.
- On the web, use the `@fontsource/atkinson-hyperlegible-next` and `@fontsource/atkinson-hyperlegible-mono` packages.
- In apps, bundle the font files.
- Offering a setting to switch to the device's own font is fine.

### Privacy comes second, and right behind

- Collect the least data that answers a real product question. No ad or marketing pixels, no fingerprinting, no selling or sharing data.
- Never put personal information in analytics: no names, emails, free-text input or precise location.
- Respect Global Privacy Control and Do Not Track by sending no analytics at all, and give people an opt-out.
- No cookies for analytics (keep the ID in `localStorage`), so no cookie banner is needed.
- Analytics only runs on the live production domain, never on localhost or preview builds.
- In Apple apps, keep personal data on the device or in the user's own iCloud unless a feature truly needs a server.
- Any project that collects data has a short, plain-language privacy page.
- Secrets never go in Git. (Browser API keys that are public by design, like Amplitude's, are fine in code.)

### Default stack

Use these unless the project's section says otherwise. **Do not add any other third-party service, SDK, script, font or paid tool without asking Kyle first.**

- **Product analytics: Amplitude**, set up the private way:
  - on the web, use `startAnalytics` from kp-design's `kp-design/analytics`, which does all of this
  - autocapture on, IP address tracking off, identity in `localStorage`
  - off under GPC, Do Not Track or the opt-out; only on the live domain
  - Session Replay only if the project wants it: a small sample (about 5%), conservative masking, and its code only loaded for sampled sessions
  - custom events follow the naming rules under "Analytics events" below
- **Backend: Firebase** (Auth, Firestore, Functions, Storage) when a project needs accounts or shared data.
  - Security rules deny by default and are locked down before anything ships.
  - Firebase Analytics stays off; Amplitude covers analytics.
- **Web hosting: Cloudflare** (Workers with static assets). GitHub Pages is fine for a simple static site.
- **Design system for Kyle's websites: [kp-design](https://github.com/kyle-pace/kp-design)**, installed from GitHub and pinned to a commit. It holds the tokens, self-hosted Atkinson, header, footer, display settings and analytics; projects on kylepace.dev use its `DevLayout`. Don't copy these into a project; change them in kp-design. (Apple apps don't use it.)
- **Apple apps:** native Swift and SwiftUI.
- Put each outside service behind its own module (one file talks to Amplitude, one to Firebase), so switching tools means changing one file.
- CI checks the stack on every push: Amplitude is in every site and app, Firebase Analytics isn't, each Firebase config file is for a bundle ID the app really has, and Firestore rules aren't open. It can't see inside the Amplitude or Firebase consoles, so settings there (APNs keys, API key restrictions, a separate production project) still need a person.
- Keep running costs near zero: prefer static pages, free tiers and on-device work, and ask before adding anything that bills.

### Analytics events

Every project uses the same rules, so charts read the same way everywhere.

- **Event names:** Title Case, past-tense verb first, then the object: "Saved Recipe", "Viewed Deal", "Completed Onboarding". Not "Recipe Saved" and not `save_recipe`. Use the same verb for the same action across projects (Viewed, Opened, Tapped, Added, Removed, Changed, Saved, Completed).
- **Property names:** lowercase `snake_case` (`deal_id`, `stores_picked`). Keep names and values the same across events and projects when they mean the same thing.
- Leave Amplitude's own `[Amplitude] …` events alone. Add custom events only for actions that answer a real product question; autocapture covers page views and clicks.
- **One Amplitude project per product.**
- kylepace.dev and every experiment on it share the kylepace.dev project, so each experiment's custom events also send `experiment` with the project's slug (`experiment: "skill-tree"`).
- **Tracking plan first:** add each new event to the project's tracking plan in Amplitude, with a description and category, when it ships. Nothing should arrive as "unexpected".
- **Renaming an event:** rename it in code, then merge the old name into the new one in Amplitude so history stays connected. Don't rename in Amplitude alone.
- **New product:** create its Amplitude project and add a row for it to the "All projects overview" dashboard. A new experiment on kylepace.dev needs neither: it appears there by page path.

### Self-host everything; approve outside hosts one at a time

- Serve libraries, fonts and assets from the project itself. Install them from npm and bundle them, or keep a pinned copy in the repo (for example in `vendor/`) with a script that refreshes it.
- Never load them from a CDN like jsDelivr, unpkg or cdnjs.
- **Scripts, styles, fonts and APIs** from an outside host need Kyle's OK every time. Approvals are per project and per host. Once he approves, add the host to that project's `.agents/allowed-hosts.txt` with a comment saying what it's for and the date he approved it.
- **Images** are lighter, because an outside image can only learn that someone visited, not run code. An image host can be added without asking when the image belongs to the content being shown (a recipe site's own photo on a result for its recipe, a book's cover from the library that lists it). Load those images with `referrerpolicy="no-referrer"` and `loading="lazy"`, add the host to `.agents/allowed-hosts.txt` with a comment saying what it's for, and mention the new host to Kyle when you report back. Decorative images, stock photos and anything that looks like tracking still need his OK.
- All of this applies to hosts that JavaScript calls at runtime too, even though the CI check only sees HTML and CSS. List those in the same file.

### Look and feel: no generated defaults

- Before building a page or app's look, write a short plan in `design/PLAN.md`: the subject and who it's for, the one bold element, 4 to 6 named colors (light and dark), and the layout as a sketch. Take the ideas from the subject's own world, not from other websites. If a frontend-design skill is available, load it.
- Check the plan against the generated defaults and change anything that matches: a big headline over a muted sentence and a pill button; pills or one corner radius on everything; grids of identical cards; small labels above headings; colored dots or squares as decoration; details joined with middle dots; monospace for small labels; copy that explains the interface instead of using it.
- Spend boldness in one place and keep the rest quiet. Look at screenshots (phone and desktop, light and dark) before calling it done.
- Experiments on kylepace.dev are their own pages (kp-design's `LabLayout`) with their own look. The app comes first; the explanation goes in an About section linked from the top bar.

### How things get built

- Static and simple by default. Add JavaScript, servers or dependencies only where they earn it.
- Colors, type and spacing live in one tokens file. Light and dark mode exist from the start.
- Copy is plain language, written for the person using it.
- Don't add "Built with AI" lines or other AI credits to sites or apps unless Kyle asks.

### App builds: two channels, both TestFlight

- **Internal TestFlight** is the main channel: every build worth trying on a device goes there. Before an app has a public beta, it is the only channel.
- **Public TestFlight** is added once the app is ready for other people. A public build comes from a commit that has already run on internal.
- After the App Store release the same two stay; the release is chosen from builds the public beta has run.
- Don't install builds straight onto Kyle's devices as a routine. A direct "Dev" install is a tool for when TestFlight can't do the job: debugging on the device, something only the developer menu or a development build can do, an OS beta the cloud build can't target, or a quick loop Kyle asks for. Say why when you do one, and don't treat the Dev app as up to date.
- Before sending a build to TestFlight, build and run it on the Mac's iPhone and iPad simulators. Cloud build hours are shared across all the apps; don't spend them finding compile errors.
- The project's section says how to cut each kind of build.
- Keep the version number steady while iterating and give every build a new build number. Change the version only when Kyle says to.
- Sending an app to App Store review, or releasing it, needs Kyle's OK every time.

### Correctness

- Anything that reads data from outside the project (a feed, a flyer, an API response, a file someone picks) gets a test that runs it against a saved real sample, plus one broken sample.
- One bad record never takes down the rest: skip it, log it, and keep going.
- A scheduled job that fails must fail out loud (a red run), and must never replace good published data with empty or partial data.
- A bug fix comes with a test that fails without the fix, when the project has tests.

### Performance

Budgets, not goals. If a project needs to go over (a map, a globe, a video player), its section says so and by how much.

- Content pages ship no more than 50 KB of JavaScript (compressed), and read fine without it.
- No single image over 200 KB. Images are sized to how they're shown, served as AVIF or WebP, given `width` and `height`, and lazy-loaded below the first screen.
- On a mid-range phone: the main content shows within 2.5 seconds (Largest Contentful Paint) and the layout shifts less than 0.1 (Cumulative Layout Shift). Lighthouse performance is 90 or higher on mobile.

- An app shows something useful within 2 seconds of a cold launch on the oldest device it supports, and scrolling never stutters: no network, disk or heavy work on the main thread.

### Shipping

- Small commits, each with a plain sentence saying what changed for the person using it.
- Websites deploy from `main`. Once the checks for the change's tier pass (see "Before you call it done"), push to `main`; no need to wait for Kyle. Use a branch and pull request when he asks for one, or when you want him to look before it goes live.
- Never force-push `main`, skip a failing check to get something out, or commit a secret.
- Changing the principles or kp-design changes every project. Test the change against one real project first, then roll it out.
- **Ask Kyle first, every time:** anything that costs money; a new outside service, SDK or host (see above); DNS, domain or email changes; deleting data, a repo or a deployed project; making a private repo public or a public one private; publishing something he hasn't linked publicly yet (a draft, a case study, an unannounced app); anything that speaks for him (his résumé, LinkedIn, a post or message in his name).
- When Kyle has to do a step himself (approve a setting, create a repo, sign in), give him the direct link to the exact page.
- If you couldn't finish or couldn't check something, say so plainly in your report. Don't describe work as done when a step was skipped.

### Teach Kyle as you go

Kyle is a product leader building his development skills through this work. Treat each session as a chance to teach, briefly.

- When a change involves a real decision (data structure, architecture, a library, security, performance, a tradeoff), explain it in plain language: what you chose, the main alternative, and why. A short paragraph, not a lecture.
- After making changes, show the most important part of the diff and walk through what it does in plain terms. Point out one thing worth learning from it.
- Define jargon the first time it comes up in a session.
- When a change is small and safe (a color, copy, a value, spacing), offer to let Kyle make it by hand, and tell him which file and line to change.
- Skip all of this for trivial changes like typos and formatting.

### Every new page or project ships with

- A share card (Open Graph image, 1200×630) in dark mode, using Atkinson. Follow `.agents/skills/share-card/SKILL.md`.
- A real title, description and favicon.
- A real name, icon and App Store description.
- A privacy note if it collects anything.

### Before you call it done

Match the checking to the change. If you're unsure which tier a change is, use the higher one. In your report, say which tier you used and what you ran.

**Tier 1: words and data.** Copy, a link, a value in a data file, a dependency pin, docs.

- The build passes, and so do any tests and linters.
- Read the changed text where it shows up in the built output.

**Tier 2: something people see or use changed.** Layout, styles, a component, a new control, new behavior.

- Everything in tier 1.
- Run the project's check command (`npm run check` where a project has one). It runs axe on every page in light and dark, fails on sideways scrolling, and saves screenshots at 320, 768, 1280 and 1920 px. Fix what it finds.
- Run Accessibility Inspector's audit on the changed screens and fix what it finds.
- Look at the changed screen in light and dark, at the smallest size and a large one.
- Use new controls with the keyboard (and VoiceOver in apps): reachable, visible focus, a name that makes sense.

**Tier 3: a new page, screen or project, or a redesign.**

- Everything in tier 2.
- Look at every size in light and dark: 320, 768, 1280 and 1920 px wide.
- Look at it on the smallest iPhone, a large iPhone and an iPad in portrait, landscape and Split View, in light and dark.
- Check it at 200% text zoom (the largest Dynamic Type size in apps) and with reduced motion on.
- Everything under "Every new page or project ships with".
- Check it against the performance budgets.

CI runs the check command where a project has one, the stack check (see "Default stack"), and a third-party check that fails if a page loads scripts, styles, fonts or images from a host that isn't allowed. Don't add a host just to get past it: ask Kyle, or for a content image follow the image rule above.

<!-- END principles -->

## This project

Seattle Grocery Deals: the website (seattlegrocery.deals, a static site built by `scripts/build.mjs` into `dist/` and served by GitHub Pages), the iPhone and iPad app in `apple/`, and the MCP server in `mcp/`.

- **Start with [HANDOFF.md](HANDOFF.md)**: decisions, the app plan, where work left off, and house rules. Where it and the principles above disagree, HANDOFF.md wins for this project; tell Kyle about the difference.
- **`npm run check` here means validate the data and build** (the weekly routine depends on it). It is not the page check from the principles.
- **The page check isn't set up here yet.** A first run (November 14, 2026) found two things for Kyle to decide before it goes into CI: ended deals fade to 55% opacity, which drops their text to about 2.3:1 to 3.8:1 contrast (AA needs 4.5:1), and pages ship 54 to 97 KB of JavaScript against the 50 KB default, so this project needs its own budget written here. When both are settled, add it as `check:pages` (see `.agents/skills/page-check/SKILL.md`) and set `check-script: check:pages` in `.github/workflows/principles.yml`.
- This site doesn't use kp-design; its own tokens and components are in `site/assets/` and KitchenUI.
