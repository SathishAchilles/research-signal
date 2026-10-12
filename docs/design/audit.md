# Wave 3 audit (T3): liquid-glass reskin, branch `ui-liquid-glass`

**Date:** 2026-10-13
**Worktree:** `/Users/sathish/ws/research-signal-ui` (HEAD `d3294bf` plus the uncommitted Wave 0 to 2 work)
**Server:** `next build && next start -p 3510` (production). The session cookie was minted with `createSession()` and handed to the browser by a one-shot localhost redirect, so the token never appeared in a tool argument.
**Browsers:**
- Chrome through chrome-devtools-mcp, with the viewport emulated at 1440x900 and DPR 1.
- Chrome for Testing 1243 through the existing playwright-core in the npx cache, which ran the CDP `Emulation.setEmulatedMedia` media-feature checks. No dependency was added to the project.

**Data:**
- The latest brief is `2026-W41`, with 32 cards and 4 domains, all of which have a HERO figure.
- The paper with figures used for /paper is `d9c995ec-6428-496f-bc00-546ef8d7631f` (CADFather, 6 figures, `arxiv_html`).
- 7,097 of 7,305 papers have no `figure_url`, so the glyph fallback is exercised heavily on /search, /log and /ask.

## Summary

The build is green, and Amendment A1 is met: the brief hero is a figure stage built from real arXiv figures, the callouts are links, there is no DNA or helix, the glyph fallback renders, and 0 images sit under a `backdrop-filter`. The `backdrop-filter` budget holds on every route, with a maximum of 3 elements in view.

There are 9 failures, and none of them blocks the A1 visuals:
- 1 performance-budget miss: cold-load CLS on /brief.
- 1 new Lighthouse accessibility failure: the nav logo link.
- 2 mobile overflows.
- 1 `prefers-contrast` rule that is in the checklist but missing from the CSS (the spec's own §2.2 block also omits it).
- 3 contract deviations: the /log query, the /paper alt text and the /ask glyph.
- 1 /ask composer resting over a citation thumbnail.

## V0

| Check | Result | Pass/Fail | Owner |
|---|---|---|---|
| `npx tsc --noEmit` | exit 0 | PASS | – |
| `npm run lint` | exit 0, no output | PASS | – |
| `npm run build` | exit 0; 22 routes, Turbopack, Cache Components/PPR | PASS | – |
| Forbidden paths, measured against the merge base `3b2cf5e` (`email.ts`, `src/app/api`, `src/lib/pipeline`), working tree included | empty | PASS | – |
| Forbidden paths, literal `git diff main` | `src/lib/pipeline/score.ts` +4/−36. This is not a branch edit: `main` gained `9737ae7` after the `d3294bf` merge, so the diff is main's change seen in reverse. | FAIL (process) | Merge owner: merge `main` into `ui-liquid-glass` again before landing |
| `actions.ts` diff against the merge base | empty | PASS | – |
| Hook counts, main against the worktree | data-card 4→7, data-action 2→2, data-search-input 2→2, data-expand 1→1, aria-pressed 2→4 | PASS | – |
| New npm deps (`package.json` / lock against the merge base) | none | PASS | – |
| Loader change (`src/lib/brief/load.ts`) | adds `briefFigures()`, which selects `figure_url`, `figure_source` and `figures`, plus `authors` for the A1 attribution line | PASS (A1 allows it; `authors` is needed for "Figure: <first author> et al.") | – |

## Backdrop-filter budget (§8 ≤ 4; at rest ≤ 3 on /brief and /ask)

The §9 T3 counter was run at the top of each page and at 3 to 6 scroll positions.

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
| Image loading | Frame #1 has `fetchpriority=high` and is not lazy; frames #2 and #3 and every other image are `loading=lazy`. Every image has `sizes`. Stage, banner and thumbnail images carry explicit `width` and `height`. The HERO card and /paper gallery use `fill` inside a fixed-size box, which does not match A1's wording ("explicit width and height") but does meet its purpose: the measured CLS on /paper is 0 and the layout-shift sources on /brief exclude every figure box. It is graded on outcome, and the alt-text row below is graded on wording because there is no outcome to measure for it. | PASS (outcome) | – |
| Callouts are links, synced both ways | 3 `<li>`, each with an `<a href="#card-pN">` that resolves to a `[data-card]`. Sync works both ways:<br>• Hovering or focusing callout #1 puts `data-linked` on `article#card-p1`.<br>• Hovering or focusing `article#card-p17`, which is a Top-3 strip card, puts `data-linked` on the stage callout `a[href="#card-p17"]` (`BriefShell.counterparts`).<br>The callout's focus ring is solid 3px `rgb(127,219,255)`. | PASS | – |
| No DNA or helix as the primary visual | `SignalHelix.tsx` is deleted. `HelixParticles` survives as cyan motes ("no strands, no DNA geometry"), 1 canvas, and is removed under reduced motion, reduced transparency, more contrast and Solid panels. The body text has no "DNA/helix/genome". | PASS | – |
| HERO card is a specimen spec card with the lead figure | Verified by T2a and visible on /brief: a SpecTable and the figure with "Figure: <author> et al., arXiv <id>". | PASS | – |
| Domain banners come from HERO figures | d1 to d4 each show a 212x118 banner figure. `DomainSection` falls back to `StageGlyph` or `QuietDomainGlyph` in code. No quiet domain exists in W41, so the quiet glyph was **not** seen live. | PASS (quiet path checked in code only) | – |
| /paper figure gallery | "Figures · 6" sits above "Abstract"; 6 images, all `data-figure=image`, with captions. | PASS | – |
| Thumbnails in Ask, search and log | /ask citations are 56x56 (3 images and 3 glyphs); /search rows are 40x40 (2 images and 48 glyphs); /log rows are 40x40 (image and glyph). | PASS | – |
| Glyph fallback renders for a paper with no `figure_url` | It renders live on /ask (`data-figure=glyph`, an svg labelled "No figure") and on /search and /log (BENCH, EVAL, REFRAME and METHOD line glyphs, box size unchanged). | PASS | – |
| Images never under `backdrop-filter` (ancestor walk on every `<img>`) | 0 of 9 on /brief, 0 of 6 on /paper, 0 on /ask, /search and /log. No image has a CSS `filter`. | PASS | – |
| Alt text is "Figure from <title>" | This holds on /brief, /ask and /search. The /paper gallery uses the figure caption as alt (for example "Figure 1: CADFather overview…"). That is arguably the better description, but it departs from the A1 contract. | FAIL (minor) | T2e |
| Glyph fallback shows the signal type | On /ask, `CitedPapers` passes `signalType={null}`, so citations without a figure all show the generic "No figure" dashed square instead of the signal-type glyph. | FAIL (minor) | T2c |
| Data scope: loaders are extended "only to SELECT the three figure columns" | `src/app/log/page.tsx` adds a new `loadThumbs()` query in the page. It selects `figure_url` plus a correlated `paper_domain.signal_type` subquery, which is a non-figure column and an extra round trip. /search (`p.figure_url` added to the existing select) and /ask (`figure_url` and `figures`) comply. | FAIL (contract) | T2f |
| Glass painted over an image at rest (every `<img>`/`[data-figure]` rect intersected with every visible `backdrop-filter` rect, at scrollY 0, 1440x900) | /brief, /search, /log and /paper have 0 overlaps. **/ask thread view:** the sticky composer `form.glass-base` (blur 16px, rect 404,762 876x122) covers the first citation row at rest. That row holds the thumbnail image (rect 428,841 54x54) and a glyph frame (852,840 56x56), so the figure is shown blurred under glass (see `ask.png`). Fix: add bottom padding to the scroll area equal to the composer height (about 8rem), or make the composer a plate. The nav covering figures mid-scroll stays a NOTE, because §8 accepts sticky chrome over content. | FAIL (minor) | T2c |

## Accessibility fallbacks (emulated with CDP `Emulation.setEmulatedMedia`; screenshots `brief-*.png`)

| Mode | Measured | Pass/Fail | Owner |
|---|---|---|---|
| `prefers-reduced-motion: reduce` | canvas 0; `.glass-interactive` transition-duration 0s; `scroll-behavior: auto`; GlassRuntime detaches (code). The 3 static `backdrop-filter` surfaces remain, which is allowed. | PASS | – |
| `prefers-reduced-transparency: reduce` | 0 `backdrop-filter` elements. Nav and shell are solid `rgb(15,34,39)` (#0F2227); the card is solid `rgb(12,26,31)`. | PASS | – |
| `prefers-contrast: more` | Solid surfaces, 0 `backdrop-filter`, rims at `#B9D0D3` and `#5E9EA3`, no glow. **The rims stay 1px** (nav, shell and card `border-top-width: 1px`), but the §7 checklist requires "More-contrast also gives 2px rims". The spec's own §2.2 CSS block omits the width change, and the implementation copied it verbatim. | FAIL | T0a (`globals.css`); the spec §2.2 block needs the same fix |
| `forced-colors: active` | The verdict bar is `rgb(255,255,255)` (CanvasText) with `forced-color-adjust: none` and is 4x376px. Borders are CanvasText and the "BRING TO CLIENT" label is visible. The ConeChart keeps its teal fill, which is decorative and `aria-hidden` with an sr-only table. | PASS | – |
| Solid panels (`localStorage rs-glass=off`) | `html[data-glass=off]`, 0 `backdrop-filter`, solid nav, shell and card, canvas 0 | PASS | – |
| Keyboard | j/j/j/k moves focus card-p1 → p17 → p18 → p2 → p18 in DOM order, the focus outline is solid 3px `#7FDBFF`, and `?` opens the "Keyboard shortcuts" dialog outside `<main>` (portalled); Esc closes it. | PASS | – |
| `print:hidden`, nav absent on /login and /a/* | Nav count is 0 on /login and /a/x; no `.fixed.right-4.bottom-4`. | PASS | – |
| `contrast.py` re-run | The tokens in `globals.css` equal the §2.2 values. Every §7 pair meets its "Need" (lowest text pair: muted on glass-nav, 5.46). | PASS | – |

## Lighthouse (accessibility, best practices, SEO; the MCP excludes the performance category)

| Route | Desktop A11y (branch / main) | Mobile A11y (branch) | Failing audits (branch) | Pass/Fail | Owner |
|---|---|---|---|---|---|
| /brief/2026-W41 | 97 / 92 | 100 | `label-content-name-mismatch` (**new**), `target-size` (pre-existing: 14 items on main, 12 on the branch) | FAIL (new audit) | T1a |
| /ask?thread=… | 98 / 98 | 98 | `heading-order` (pre-existing), `label-content-name-mismatch` (**new**) | FAIL (new audit) | T1a |
| /search?q=retrieval | 87 / 83 | 87 | `label` and `select-name` on the filter form (pre-existing), `target-size` (pre-existing), `label-content-name-mismatch` (**new**). Main's 30 `color-contrast` failures are fixed. | FAIL (new audit) | T1a; T2d optionally for the pre-existing labels |

Best practices scored 100 and SEO 100 on every run.

The new failure has one root cause. `GlassNav.tsx:68`: the logo `<a aria-label="Research Signal, latest brief">` shows the text "RESEARCH·SIGNAL". The accessible name must contain the visible text (WCAG 2.5.3), so either drop the `aria-label` or start it with the visible words.

## Performance (§8)

| Check | Result | Pass/Fail | Owner |
|---|---|---|---|
| LCP on /brief, desktop, prod | 713ms; the LCP element is the server-rendered `H1` lede (text, not canvas) | PASS (≤ 2.0s) | – |
| LCP on /brief, mobile-like (412x823, 4x CPU, Slow 4G) | 1,570ms, CLS 0.00 | PASS (absolute). The comparison with `main` + 10% was not run, because `main` is only available as a dev server (:3104). | – |
| CLS on /brief, desktop cold load | **0.038** (one shift at 325ms: `<main>` moves 0→68px). A warm reload gives 0. **Cause:** `layout.tsx:59` mounts `<Suspense fallback={null}><GlassNav/></Suspense>`. The nav streams in a hidden PPR segment after `<main>` has painted, so `<main>` is pushed down 68px. **Fix:** give the fallback a 68px placeholder (`h-[4.25rem]`, on routes that render the nav), or make GlassNav renderable in the static shell. | FAIL (budget ≤ 0.02) | T1a |
| CLS on /ask, /search, /log, /paper, /settings/usage | 0 | PASS | – |
| INP proxy, j/k on /brief (32 cards; the spec asks for 60, but only 32 exist) | key event durations 16 to 80ms, max 80ms | PASS (≤ 100ms) | – |
| Scroll at 60fps (rAF over a 4s scripted scroll of /brief; 32 cards, against the 40+ the spec asks for) | 240 frames, average 60fps, p95 17.2ms, max 17.7ms, 0 frames > 20ms, 0 long animation frames | PASS (limited by data) | – |

## Responsive check (375px, not in the T3 list, recorded because it showed up)

| Route | `scrollWidth` | Cause | Pass/Fail | Owner |
|---|---|---|---|---|
| /brief | 519 | `ConeChart`'s `<table className="sr-only">`. Tables ignore `width:1px` and `overflow:hidden`, so the "sr-only" table lays out 466px wide at `left:53`. Wrap it in `<div className="sr-only">`. | FAIL | T1b (`viz/ConeChart.tsx`) |
| /settings/usage | 465 | The usage ConeChart figure and its figcaption overflow the plate | FAIL | T2g (usage page; it may clear once T1b's fix lands) |
| /ask, /search, /log, /paper, /settings, /settings/domains, /login | 375 | – | PASS (T1a's earlier /settings 427px overflow is fixed) | – |

## Cleanup

- I stopped the :3510 `next start` server, which I had started.
- The :3599 one-shot cookie server is closed, and its token was never written to disk or printed.
- I closed the audit's Chrome pages (isolated contexts `t3audit` and `t3anon`).
- I also stopped the :3501 `next dev` server. The Wave 1 and 2 agents had left it running for each other, and T1a handed it to "the audit or last user". Wave 3 is the last wave.

## Not run

- **Safari/WebKit (T3 step 5).** No WebKit binary is installed; the playwright cache holds only Chromium 1243, and the rules forbid adding one. Coverage comes only from the CSS gate: `url(#rs-lens)` sits under `:root[data-refract]`, which the boot script sets only for Chromium brands.
- **Lighthouse performance category.** The MCP Lighthouse excludes it. LCP and CLS were taken from Chrome performance traces instead.
- **A live, unknown-host `figure_url`.** T2a already covered it with a server render (`isServableFigure`, which falls back to the glyph).

## Screenshots (`docs/design/screens/`, 1440x900, DPR 1)

`login.png`, `brief.png`, `paper.png`, `ask.png`, `search.png`, `log.png`, `settings-usage.png`, plus /brief under each fallback: `brief-default.png`, `brief-reduced-motion.png`, `brief-reduced-transparency.png`, `brief-contrast-more.png`, `brief-forced-colors.png` and `brief-solid-panels.png`. The `T1a`/`T2*` files come from the Wave 1 and 2 agents.

## Fix list by owner

| Owner | File | Fix |
|---|---|---|
| T1a | `src/app/layout.tsx:59`, `src/components/glass/GlassNav.tsx:68` | Reserve the nav's 68px in the Suspense fallback (CLS); make the logo link's accessible name contain "Research Signal" as its visible text, or remove the `aria-label`. |
| T0a | `src/app/globals.css:183` (and spec §2.2) | Inside `@media (prefers-contrast: more)`, set the glass and plate rims to 2px (for example a `--rim-w` token used by `glass-*` and `plate`). |
| T1b | `src/components/viz/ConeChart.tsx:104` | Wrap the sr-only `<table>` in a `div.sr-only`. |
| T2g | `src/app/settings/usage/page.tsx` | Keep the ConeChart figure inside the plate at 375px (`min-w-0`/`overflow-hidden`, or a responsive width). |
| T2f | `src/app/log/page.tsx` | Move the thumbnail data into the existing log loader, selecting only `figure_url` (and reuse the signal type the verdict column already loads), or get explicit approval for the extra query. |
| T2e | `src/app/paper/[id]/page.tsx` | Set the gallery `alt` to "Figure from <title>" (the caption can stay visible), or ask the user to amend A1 to allow caption-as-alt. |
| T2c | `src/components/ask/AskPanel.tsx`, `src/app/ask/page.tsx` | Pass the cited paper's signal type to `PaperFigure`, so the fallback is the BENCH, EVAL, REFRAME or METHOD glyph. Pad the thread scroll area by the composer height, so no citation figure rests under the glass composer at scrollY 0. |
| Merge owner | – | Merge `main` (`9737ae7`) into `ui-liquid-glass` before landing, so that the literal V0 forbidden-path diff prints nothing. |
