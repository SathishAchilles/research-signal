# Wave 3 audit (T3): liquid-glass reskin, branch `ui-liquid-glass`

**Date:** 2026-10-13 (first audit, then re-audit R1 after the fix round)
**Worktree:** `/Users/sathish/ws/research-signal-ui`. HEAD is `840468b`, which commits the Wave 0 to 2 work. On top of it, the fix round's uncommitted edits touch 8 files: `ask/page.tsx`, `globals.css`, `layout.tsx`, `paper/[id]/page.tsx`, `AskPanel.tsx`, `DomainChipsBar.tsx`, `GlassNav.tsx` and `ConeChart.tsx`.
**Server:** `next build && next start -p 3510` (production), in both the first audit and R1.
- First audit: the session cookie was minted with `createSession()` and handed to the browser by a one-shot localhost redirect.
- R1: the cookie was minted with `createSession()` inside the same Node process that drove the browser (`tsx --env-file=.env.local`) and added with `context.addCookies`.

In both cases the token never appeared in a tool argument, in output or on disk.

**Browsers:**
- Chrome through chrome-devtools-mcp, with the viewport emulated at 1440x900 and DPR 1 (first audit).
- Chrome for Testing 1243 through the existing playwright-core in the npx cache: the CDP `Emulation.setEmulatedMedia` checks in the first audit, and every measurement in R1. No dependency was added to the project.

**Data:**
- The latest brief is `2026-W41`, with 32 cards and 4 domains, all of which have a HERO figure.
- The paper with figures used for /paper is `d9c995ec-6428-496f-bc00-546ef8d7631f` (CADFather, 6 figures, `arxiv_html`).
- The R1 /ask threads are `80d5c53d…`, `6d9d9889…` and `57805d49…`.
- 7,097 of 7,305 papers have no `figure_url`, so the glyph fallback is exercised heavily on /search, /log and /ask.

## Re-audit R1 (after the fix round)

Every gate is green: `npx tsc --noEmit` exit 0, `npm run lint` exit 0, and `npm run build` exit 0 with 22 routes. All 8 changed files end with a newline.

6 of the 9 first-audit failures are now fixed. 3 remain:
- **375px overflow on `/brief/2026-W41` and `/`.** It is still 414px, and the cause sits in T2a's and T2b's files, which the fix round did not touch.
- **375px overflow on `/settings/usage`.** It is still 465px, in T2g's file, which was also not touched.
- **The extra thumbnail query in `/log`.** T2f's file is unchanged.

The process item, merging `main` again, is also still open.

| # | Item (first-audit failure) | R1 measurement | R1 result | Owner if open |
|---|---|---|---|---|
| 1 | Cold-load CLS on /brief is 0.038 (`<main>` pushed down 68px) | **The prod shell now exercises the fallback.** In the HTML of `/brief/2026-W41`, `GlassNavPlaceholder` sits in the static shell before `<main>`, and `<header>` arrives later inside a hidden `S:` segment.<br><br>**The probe catches shifts.** As a control, injecting a 68px div before `<main>` registers CLS 0.0349, so a regression would show up.<br><br>**`<main>` does not move.** A per-frame timeline shows `mainTop=68` both with the placeholder (`PH`) and after the header swaps in (`-H`), on desktop and under 4x CPU with Slow 4G.<br><br>**CLS is 0.0000 on every route.** That is 3 desktop cold loads at 1440x900 plus 2 throttled mobile loads at 412x823, on /brief/2026-W41, /, /ask?thread, /search, /log, /paper, /settings/usage, /login and /a/invalid-token-x. | **PASS** (≤ 0.02) | – |
| 1a | /a/* placeholder collapse (the fixer's watch item) | `/a/*` hides the nav, but the placeholder is still in its shell. It collapses before contentful paint:<br>• Desktop: collapse at 265ms, first paint at 268ms.<br>• Throttled: collapse at 1731ms, FCP at 1732ms. The first paint at 1708ms is background only.<br><br>CLS is 0 in all 5 runs. | PASS, with a **NOTE**: the margin before FCP is about 1ms under throttling. A route-aware fallback that renders nothing on `/login` and `/a/*` would remove the race. | T1a (optional) |
| 2 | Logo link `label-content-name-mismatch` (WCAG 2.5.3) | The `aria-label` is gone.<br>• CDP's accessible name is "RESEARCH·SIGNAL , latest brief" at 1440 and at 800. It starts with the visible wordmark.<br>• At 375 the link is `display:none`, which is `sm:flex` by design.<br>• axe-core 4.14 (`node_modules`, the engine Lighthouse runs) puts `label-content-name-mismatch` in **inapplicable**, because the logo has no aria-label. `link-name` passes on every link (130 on /brief, 78 on /ask, 132 on /search) at 1440, 800 and 412. | **PASS** (axe re-check). The Lighthouse scores were not re-run, so the score columns below are unchanged. | – |
| 3 | `prefers-contrast: more` leaves the rims at 1px | The computed `border-top-width` and `border-left-width` are 1px by default and **2px** under contrast:more. That covers `.glass-nav`, `.glass-base`, `.glass-chip` and `.plate` on /brief/2026-W41 and /settings/usage, and `.glass-elevated` on /login. Under forced-colors the rims stay at 1px CanvasText (`rgb(255,255,255)`). | **PASS** | Spec §2.2's CSS block still lacks `--rim-w` (`grep -c rim-w` returns 0): a docs item for the spec owner |
| 4 | 375px overflow on /brief | `scrollWidth` is **414** (416 under contrast:more), and `/` renders the same brief at 414.<br><br>**The ConeChart table is fixed:** it still measures 466px wide, but it is now clipped inside `div.sr-only` and no longer contributes.<br><br>**What remains** is two grids with no mobile column template, whose implicit `auto` track grows to min-content:<br>• `DomainSection.tsx:68` `grid gap-3 lg:grid-cols-[…]` (the aside plate measures 398px)<br>• `HeroCard.tsx:53` `mt-4 grid gap-5 md:grid-cols-[…]`<br><br>The fixer isolated these two grids: setting them to `minmax(0,1fr)` gives 414 → 393 → 375. The R1 in-page patch of the brief's base-less grids also brings `scrollWidth` to 375. | **FAIL** | T2a (`HeroCard.tsx:53`), T2b (`DomainSection.tsx:68`): add `grid-cols-[minmax(0,1fr)]` as the mobile base |
| 5 | 375px overflow on /settings/usage | `scrollWidth` is **465** (467 under contrast:more). `page.tsx:119` `grid gap-4 lg:grid-cols-2` has no mobile template, so the "Cost by stage" table (793px, nowrap cells) widens the track to 449px. Patching that one grid in-page gives 375. ConeChart is not the cause. | **FAIL** | T2g (`src/app/settings/usage/page.tsx:119`): add `grid-cols-[minmax(0,1fr)]` |
| 6 | /ask composer rests over a citation thumbnail | The composer `form.glass-base` is now `position: static`, in flow after the thread. Every `backdrop-filter` rect was intersected with every `img`/`[data-figure]` rect, at scrollY 0 and then every 150px to the bottom, on 3 threads:<br>• At 1440x900: 0 composer hits and 0 hits at rest.<br>• At 375x812: 0 composer hits. The nav hits figures 7, 5 and 2 times mid-scroll, which §8 accepts as a NOTE.<br><br>See `ask-citations.png`. | **PASS** (A1). **Spec deviation:** §4.5 specifies the composer as `glass-base sticky bottom-4 p-2`, so it is no longer sticky. A1 ("never placed under `backdrop-filter`") takes precedence, but §4.5 should be amended or the change signed off. The UX cost is that on a long thread you scroll to the end to reach the composer. | Spec owner or user: sign-off on dropping `sticky` |
| 7 | /ask glyph fallback shows the signal type | `genericGlyphs` ("No figure" with no type) is 0 on all 3 threads (5, 8 and 3 glyphs). The labels read, for example, "No figure: method paper (METHOD)", "… benchmark paper (BENCH)", "… evaluation paper (EVAL)" and "… reframing paper (REFRAME)". | **PASS** | – |
| 7a | /ask A1 attribution (added in the fix round) | Each citation row with an image carries "Figure: <first author> et al., arXiv <id>" (for example "Figure: Jingjie Ning et al., arXiv 2610.05034"). No glyph row carries it. The mismatch count is 0 on all 3 threads at both widths. | **PASS** | – |
| 8 | /paper alt is "Figure from <title>" | **6/6** gallery `<img>` have `alt="Figure from CADFather: Autonomous CAD Reconstruction through Coordinated Tool Use"`, and 8 `figcaption` elements render. `PaperFigure` keeps the caption text in the figcaption. The lead figure now has `fetchpriority=high` and is not lazy, because the fix added `priority`. That departs from A1's wording (only "the first hero frame"), but it is graded on outcome like the image-loading row: /paper CLS is 0. | **PASS** | – |
| 9 | /log makes a single query | `src/app/log/page.tsx` has no diff in the fix round. `loadThumbs()` (lines 59 to 71) still runs as a **second query**, after `listLog()`. **Criterion, applied the same way to /ask:** A1 render needs (the signal type for the glyph, and the authors and arXiv id for attribution) may be selected when they ride a query the page already makes. An extra round trip is the violation. /ask passes this criterion: its subquery and attribution columns were added to its existing figure query. /log fails it. | **FAIL** (contract) | T2f: fold `figure_url` and the signal type into `listLog()`'s query (or reuse the verdict column's signal type), or get approval for the extra query |
| 10 | `backdrop-filter` count ≤ 4 on every route | The §9 T3 counter ran at the top and every half viewport down the page (2 to 33 positions per route), at 1440x900 and at 375x812, on 15 routes. The maximum at rest is **3** (/brief at scrollY 450: nav, hero shell and Domains bar; /ask: nav, Threads rail and composer). With a dialog open on /brief: `?` help or ⌘K gives 3 at the top and **4** at scrollY 835. /settings/domains "Add domain" gives 2. Every other route is 1 or 2. | **PASS** | – |
| P | Literal `git diff main` on the forbidden paths | Against the merge base `3b2cf5e`, working tree included: `email.ts`, `src/app/api` and `src/lib/pipeline` are empty; `actions.ts` is empty; `package.json` and the lock are empty. `main` has since moved to `2cc053f` and is still not merged, so the literal diff now shows `score.ts` +4/−36 and `stages.ts` 95 lines, both main's changes seen in reverse. | FAIL (process) | Merge owner: merge `main` (`2cc053f`) before landing |

**R1 NOTE.**
- axe's default ruleset also reports `region:1`, on the CommandBar dialog's sr-only `div[data-slot=dialog-header]`.
- Lighthouse doesn't run the `region` rule, the fix round didn't touch that element, and there is no `main` baseline for it, so it is recorded as a NOTE, not a regression.
- The other axe results match the Lighthouse findings already recorded below, which were present before the reskin: `heading-order` on /ask, and `label` and `select-name` on /search.

**R1 cleanup.** I started and then stopped the :3510 `next start` server. No dev server was started. The probe scripts live in the session scratchpad, not in the repo.

## Summary (first audit)

The build is green, and Amendment A1 is met: the brief hero is a figure stage built from real arXiv figures, the callouts are links, there is no DNA or helix, the glyph fallback renders, and 0 images sit under a `backdrop-filter`. The `backdrop-filter` budget holds on every route, with a maximum of 3 elements in view.

There are 9 failures, and none of them blocks the A1 visuals. R1 above gives the status of each.
- 1 performance-budget miss: cold-load CLS on /brief.
- 1 new Lighthouse accessibility failure: the nav logo link.
- 2 mobile overflows.
- 1 `prefers-contrast` rule that is in the checklist but missing from the CSS (the spec's own §2.2 block also omits it).
- 3 contract deviations: the /log query, the /paper alt text and the /ask glyph.
- 1 /ask composer resting over a citation thumbnail.

## V0

| Check | Result | Pass/Fail | Owner |
|---|---|---|---|
| `npx tsc --noEmit` | exit 0 (R1: exit 0) | PASS | – |
| `npm run lint` | exit 0, no output (R1: exit 0) | PASS | – |
| `npm run build` | exit 0; 22 routes, Turbopack, Cache Components/PPR (R1: exit 0, 22 routes) | PASS | – |
| Forbidden paths, measured against the merge base `3b2cf5e` (`email.ts`, `src/app/api`, `src/lib/pipeline`), working tree included | empty (R1: empty) | PASS | – |
| Forbidden paths, literal `git diff main` | First audit: `src/lib/pipeline/score.ts` +4/−36. This is not a branch edit: `main` gained `9737ae7` after the `d3294bf` merge, so the diff is main's change seen in reverse. R1: `main` is now at `2cc053f`, so `stages.ts` also shows in reverse. | FAIL (process) | Merge owner: merge `main` into `ui-liquid-glass` again before landing |
| `actions.ts` diff against the merge base | empty (R1: empty) | PASS | – |
| Hook counts, main against the worktree | data-card 4→7, data-action 2→2, data-search-input 2→2, data-expand 1→1, aria-pressed 2→4 | PASS | – |
| New npm deps (`package.json` / lock against the merge base) | none (R1: none) | PASS | – |
| Loader change (`src/lib/brief/load.ts`) | adds `briefFigures()`, which selects `figure_url`, `figure_source` and `figures`, plus `authors` for the A1 attribution line | PASS (A1 allows it; `authors` is needed for "Figure: <first author> et al.") | – |

## Backdrop-filter budget (§8 ≤ 4; at rest ≤ 3 on /brief and /ask)

The §9 T3 counter was run at the top of each page and at 3 to 6 scroll positions. R1 re-ran it at every half viewport, at 1440 and 375 (row 10 above). Every value is the same as or lower than below.

| Route | At rest (max over scroll) | With dialog | Elements | Pass/Fail |
|---|---|---|---|---|
| /brief/2026-W41 | 2 at the top, 3 mid-scroll | 3 at the top with CommandBar open. 4 at scrollY 835 with the `?` help open: nav, hero shell, Domains bar and the help panel `div.glass-elevated`, which sits inside the body-portalled `role=dialog` overlay; the overlay has no `backdrop-filter`. 4 is the budget's 3 + 1 transient. | nav, hero shell `glass-base`, sticky Domains bar, `glass-elevated` | PASS |
| /ask (thread view) | 3 | – | nav, Threads rail, composer | PASS |
| /search?q=retrieval | 2 | – | nav, filter rail | PASS |
| /paper/[id] | 1 | – | nav | PASS |
| /log | 1 | – | nav | PASS |
| /settings, /domains, /sources, /delivery, /security, /usage | 1 | /settings/domains "Add domain": 2, and the overlay has no `backdrop-filter` | nav, `glass-elevated` | PASS |
| /login | 1 | – | PIN form `glass-elevated` | PASS |
| /a/invalid-token-x | 1 total | – | – | PASS |

## Amendment A1

| Check | Evidence | Pass/Fail | Owner |
|---|---|---|---|
| The brief hero is a figure stage of the top-3 papers' real figures | `ol[aria-label="Top 3 figures"]` holds 3 `<img>`. Their `src` values are `/_next/image?url=https://arxiv.org/html/2610.06100v1/Trace2Env_intro.png`, `…/2610.07557v1/table3-pass-at-1-paper.png` and `…/2610.12289v1/testprism_overview.png`. All 3 are loaded, with the largest first (398x298 against 274x170). | PASS | – |
| Image loading | Frame #1 has `fetchpriority=high` and is not lazy; frames #2 and #3 and every other image are `loading=lazy`. Every image has `sizes`. Stage, banner and thumbnail images carry explicit `width` and `height`. The HERO card and /paper gallery use `fill` inside a fixed-size box, which does not match A1's wording ("explicit width and height") but does meet its purpose: the measured CLS on /paper is 0 and the layout-shift sources on /brief exclude every figure box. It is graded on outcome, and the alt-text row below is graded on wording because there is no outcome to measure for it. R1: the /paper lead figure is now also `priority`, also graded on outcome (CLS 0). | PASS (outcome) | – |
| Callouts are links, synced both ways | 3 `<li>`, each with an `<a href="#card-pN">` that resolves to a `[data-card]`. Sync works both ways:<br>• Hovering or focusing callout #1 puts `data-linked` on `article#card-p1`.<br>• Hovering or focusing `article#card-p17`, which is a Top-3 strip card, puts `data-linked` on the stage callout `a[href="#card-p17"]` (`BriefShell.counterparts`).<br>The callout's focus ring is solid 3px `rgb(127,219,255)`. | PASS | – |
| No DNA or helix as the primary visual | `SignalHelix.tsx` is deleted. `HelixParticles` survives as cyan motes ("no strands, no DNA geometry"), 1 canvas, and is removed under reduced motion, reduced transparency, more contrast and Solid panels. The body text has no "DNA/helix/genome". | PASS | – |
| HERO card is a specimen spec card with the lead figure | Verified by T2a and visible on /brief: a SpecTable and the figure with "Figure: <author> et al., arXiv <id>". | PASS | – |
| Domain banners come from HERO figures | d1 to d4 each show a 212x118 banner figure. `DomainSection` falls back to `StageGlyph` or `QuietDomainGlyph` in code. No quiet domain exists in W41, so the quiet glyph was **not** seen live. | PASS (quiet path checked in code only) | – |
| /paper figure gallery | "Figures · 6" sits above "Abstract"; 6 images, all `data-figure=image`, with captions. | PASS | – |
| Thumbnails in Ask, search and log | /ask citations are 56x56 (3 images and 3 glyphs); /search rows are 40x40 (2 images and 48 glyphs); /log rows are 40x40 (image and glyph). | PASS | – |
| Glyph fallback renders for a paper with no `figure_url` | It renders live on /ask (`data-figure=glyph`; first audit: an svg labelled "No figure"; R1: signal-typed labels) and on /search and /log (BENCH, EVAL, REFRAME and METHOD line glyphs, box size unchanged). | PASS | – |
| Images never under `backdrop-filter` (ancestor walk on every `<img>`) | 0 of 9 on /brief, 0 of 6 on /paper, 0 on /ask, /search and /log. No image has a CSS `filter`. | PASS | – |
| Alt text is "Figure from <title>" | This holds on /brief, /ask and /search. First audit: the /paper gallery used the figure caption as alt. **R1: 6/6 /paper images now read "Figure from <title>", and the captions stay in the figcaptions.** | **PASS (R1)** | – |
| Glyph fallback shows the signal type | First audit: on /ask, `CitedPapers` passed `signalType={null}`. **R1: 0 generic glyphs on 3 threads, all labels typed (METHOD, BENCH, EVAL, REFRAME).** | **PASS (R1)** | – |
| Data scope: loaders are extended "only to SELECT the three figure columns" | `src/app/log/page.tsx` still adds a separate `loadThumbs()` query (R1: file unchanged). The criterion is applied the same way to /ask and /log: A1 render needs may ride an existing query, and an extra round trip is the violation. **/ask (R1)** adds `arxivId`, `authors` and a correlated `paper_domain.signal_type` subquery to its *existing* figure query, which passes. /search (`p.figure_url` added to the existing select) passes. /log fails. | FAIL (contract, /log only) | T2f |
| Glass painted over an image at rest (every `<img>`/`[data-figure]` rect intersected with every visible `backdrop-filter` rect) | First audit: the sticky /ask composer covered the first citation row at rest. **R1: the composer is in flow (`position: static`); 0 composer overlaps at rest or across the scroll on 3 threads at 1440 and 375.** /brief, /search, /log and /paper have 0. The nav covering figures mid-scroll stays a NOTE (§8 accepts sticky chrome over content). | **PASS (R1)**, with the §4.5 sticky deviation for sign-off | Spec owner or user |

## Accessibility fallbacks (emulated with CDP `Emulation.setEmulatedMedia`; screenshots `brief-*.png`)

| Mode | Measured | Pass/Fail | Owner |
|---|---|---|---|
| `prefers-reduced-motion: reduce` | canvas 0; `.glass-interactive` transition-duration 0s; `scroll-behavior: auto`; GlassRuntime detaches (code). The 3 static `backdrop-filter` surfaces remain, which is allowed. | PASS | – |
| `prefers-reduced-transparency: reduce` | 0 `backdrop-filter` elements. Nav and shell are solid `rgb(15,34,39)` (#0F2227); the card is solid `rgb(12,26,31)`. | PASS | – |
| `prefers-contrast: more` | Solid surfaces, 0 `backdrop-filter`, rims at `#B9D0D3` and `#5E9EA3`, no glow. First audit: the rims stayed 1px. **R1: rims are 2px** on nav, shell, chip, plate and `glass-elevated` (via a `--rim-w` token); 1px by default. | **PASS (R1)** | Spec §2.2's CSS block still needs the `--rim-w` change (docs) |
| `forced-colors: active` | The verdict bar is `rgb(255,255,255)` (CanvasText) with `forced-color-adjust: none` and is 4x376px. Borders are CanvasText and the "BRING TO CLIENT" label is visible. The ConeChart keeps its teal fill, which is decorative and `aria-hidden` with an sr-only table. R1: rims still 1px CanvasText. | PASS | – |
| Solid panels (`localStorage rs-glass=off`) | `html[data-glass=off]`, 0 `backdrop-filter`, solid nav, shell and card, canvas 0 | PASS | – |
| Keyboard | j/j/j/k moves focus card-p1 → p17 → p18 → p2 → p18 in DOM order, the focus outline is solid 3px `#7FDBFF`, and `?` opens the "Keyboard shortcuts" dialog outside `<main>` (portalled); Esc closes it. | PASS | – |
| `print:hidden`, nav absent on /login and /a/* | Nav count is 0 on /login and /a/x; no `.fixed.right-4.bottom-4`. R1: still 0; the placeholder is `print:hidden` and `aria-hidden`. | PASS | – |
| `contrast.py` re-run | The tokens in `globals.css` equal the §2.2 values. Every §7 pair meets its "Need" (lowest text pair: muted on glass-nav, 5.46). R1: no color token changed (only `--rim-w` was added). | PASS | – |

## Lighthouse (accessibility, best practices, SEO; the MCP excludes the performance category)

These are first-audit scores; Lighthouse was not re-run in R1. R1 re-checked the one new failure with axe-core 4.14 (row 2 above): `label-content-name-mismatch` is now inapplicable on every route and width, and `link-name` passes.

| Route | Desktop A11y (branch / main) | Mobile A11y (branch) | Failing audits (branch) | Pass/Fail | Owner |
|---|---|---|---|---|---|
| /brief/2026-W41 | 97 / 92 | 100 | `label-content-name-mismatch` (**new**; R1: fixed), `target-size` (pre-existing: 14 items on main, 12 on the branch) | PASS (R1, axe) | – |
| /ask?thread=… | 98 / 98 | 98 | `heading-order` (pre-existing), `label-content-name-mismatch` (**new**; R1: fixed) | PASS (R1, axe) | – |
| /search?q=retrieval | 87 / 83 | 87 | `label` and `select-name` on the filter form (pre-existing), `target-size` (pre-existing), `label-content-name-mismatch` (**new**; R1: fixed). Main's 30 `color-contrast` failures are fixed. | PASS (R1, axe); pre-existing items remain | T2d optionally for the pre-existing labels |

Best practices scored 100 and SEO 100 on every run.

The first-audit failure had one root cause. The logo `<a aria-label="Research Signal, latest brief">` showed the text "RESEARCH·SIGNAL", and the accessible name must contain the visible text (WCAG 2.5.3). R1: the `aria-label` is removed, the wordmark is `sr-only lg:not-sr-only`, and an sr-only ", latest brief" suffix is added.

## Performance (§8)

| Check | Result | Pass/Fail | Owner |
|---|---|---|---|
| LCP on /brief, desktop, prod | 713ms; the LCP element is the server-rendered `H1` lede (text, not canvas) | PASS (≤ 2.0s) | – |
| LCP on /brief, mobile-like (412x823, 4x CPU, Slow 4G) | 1,570ms, CLS 0.00 | PASS (absolute). The comparison with `main` + 10% was not run, because `main` is only available as a dev server (:3104). | – |
| CLS on /brief, desktop cold load | First audit: **0.038** (`<main>` moved 0→68px when the nav streamed in through `<Suspense fallback={null}>`). **R1: 0.0000** in every cold load, desktop and throttled. `GlassNavPlaceholder` reserves the 68px in the static shell; a 68px control injection registers 0.0349, so the probe is sensitive. See row 1 and 1a. | **PASS (R1)** | – |
| CLS on /ask, /search, /log, /paper, /settings/usage | 0 (R1: 0, plus /login and /a/* 0) | PASS | – |
| INP proxy, j/k on /brief (32 cards; the spec asks for 60, but only 32 exist) | key event durations 16 to 80ms, max 80ms | PASS (≤ 100ms) | – |
| Scroll at 60fps (rAF over a 4s scripted scroll of /brief; 32 cards, against the 40+ the spec asks for) | 240 frames, average 60fps, p95 17.2ms, max 17.7ms, 0 frames > 20ms, 0 long animation frames | PASS (limited by data) | – |

## Responsive check (375x812)

| Route | `scrollWidth` (R1) | Cause | Pass/Fail | Owner |
|---|---|---|---|---|
| /brief/2026-W41 and `/` | 414 (first audit: 519) | **Fixed:** the ConeChart sr-only table is now clipped inside `div.sr-only` (519 → 414).<br>**Remaining:** two base-less grids, `DomainSection.tsx:68` and `HeroCard.tsx:53` (see R1 row 4). | **FAIL** | T2a (`HeroCard.tsx`), T2b (`DomainSection.tsx`) |
| /settings/usage | 465 | `page.tsx:119` grid has no mobile template, so the "Cost by stage" table widens it (see R1 row 5) | **FAIL** | T2g |
| /ask, /ask?thread, /search, /log, /paper, /settings, /settings/domains, /sources, /delivery, /security, /login, /a/invalid-token-x | 375 | Tables wider than 375 on /log and /paper sit inside their own horizontal scrollers. The SettingsNav chips are clipped by `overflow-x-auto`. | PASS | – |

## Cleanup

- First audit:
  - I stopped the :3510 `next start` server, which I had started.
  - The :3599 one-shot cookie server is closed, and its token was never written to disk or printed.
  - I closed the audit's Chrome pages (isolated contexts `t3audit` and `t3anon`).
  - I also stopped the :3501 `next dev` server. The Wave 1 and 2 agents had left it running for each other, and T1a handed it to "the audit or last user".
- R1:
  - I started :3510 `next start` and then stopped it.
  - The headless browsers were closed by the probe scripts.
  - No dev server was started or left running.

## Not run

- **Safari/WebKit (T3 step 5).** No WebKit binary is installed; the playwright cache holds only Chromium 1243, and the rules forbid adding one. Coverage comes only from the CSS gate: `url(#rs-lens)` sits under `:root[data-refract]`, which the boot script sets only for Chromium brands.
- **Lighthouse performance category.** The MCP Lighthouse excludes it. LCP and CLS were taken from Chrome performance traces (first audit) and `layout-shift` PerformanceObserver runs with a positive control (R1).
- **Lighthouse re-run in R1.** The accessibility fix was re-checked with axe-core, the engine Lighthouse uses, instead.
- **A live, unknown-host `figure_url`.** T2a already covered it with a server render (`isServableFigure`, which falls back to the glyph).

## Screenshots (`docs/design/screens/`, DPR 1)

- 1440x900: `login.png`, `brief.png` (R1), `paper.png` (R1), `ask.png` (R1), `search.png`, `log.png`, `settings-usage.png`.
- /brief under each fallback: `brief-default.png`, `brief-reduced-motion.png`, `brief-reduced-transparency.png`, `brief-contrast-more.png`, `brief-forced-colors.png` and `brief-solid-panels.png`.
- R1 additions:
  - `brief-375.png` (375x812)
  - `ask-citations.png` (supplementary, 1440x900): thread `57805d49…` scrolled to its cited papers, showing the in-flow composer, the typed glyphs and the attribution lines.
- The `T1a`/`T2*` files come from the Wave 1 and 2 agents.

## Fix list by owner (open after R1)

| Owner | File | Fix |
|---|---|---|
| T2a | `src/components/brief/HeroCard.tsx:53` | Add `grid-cols-[minmax(0,1fr)]` as the mobile base of the `mt-4 grid gap-5 md:grid-cols-[…]` grid (375px overflow). |
| T2b | `src/components/brief/DomainSection.tsx:68` | Add `grid-cols-[minmax(0,1fr)]` as the mobile base of the `grid gap-3 lg:grid-cols-[…]` grid (375px overflow). |
| T2g | `src/app/settings/usage/page.tsx:119` | Add `grid-cols-[minmax(0,1fr)]` as the mobile base of `grid gap-4 lg:grid-cols-2` (375px overflow). |
| T2f | `src/app/log/page.tsx:59` | Fold `figure_url` and the signal type into `listLog()`'s query (or reuse the verdict column's signal type) and drop `loadThumbs()`; or get explicit approval for the extra query. |
| Spec owner or user | `docs/design/liquid-glass-spec.md` §4.5, §2.2 | Sign off on (or amend §4.5 for) the non-sticky /ask composer that A1 forced. Add the `--rim-w: 2px` contrast-more change to the §2.2 CSS block. |
| T1a (optional) | `src/app/layout.tsx`, `src/components/glass/GlassNav.tsx` | Make the nav fallback route-aware (render nothing on `/login` and `/a/*`), which removes the about-1ms FCP race noted in R1 row 1a. |
| Merge owner | – | Merge `main` (`2cc053f`) into `ui-liquid-glass` before landing, so that the literal V0 forbidden-path diff prints nothing. |

Closed in R1: T1a (CLS, logo name), T0a (contrast-more rims), T1b (ConeChart sr-only table), T2e (/paper alt), T2c (/ask glyph, composer overlap, attribution).
