# research-signal: "Mission Control" liquid-glass reskin (build spec)

**Branch:** `ui-liquid-glass`. It is already checked out in the worktree `/Users/sathish/ws/research-signal-ui` (`git worktree list` shows `9c153f9 [ui-liquid-glass]`). Implementers work in that worktree and do not create a branch.

**Base:** Concept C "Mission Control", which all 3 judges picked. It has these grafts:
- From A: a canvas particle helix whose nodes sit at their evidence-rung height, hover and focus sync between the helix and the cards, and the "Solid panels" toggle in the nav.
- From B: dark smoked glass, contrast measured against a flattened worst-case backdrop, 1px cyan section rules, and a smooth j/k scroll.
- From judge 3: a static SVG helix as the baseline, with canvas added as progressive enhancement.

**Reference:** the Dribbble shot "Sci-Fi Bioinformatics Dashboard UI" (`docs/design/reference-dribbble.jpg`).

**Tags:**
- `[R]` marks something the code or the docs require, with its file:line.
- `[D]` marks a design choice made in this spec.

---

> ## Amendment A1 (2026-10-13, user direction): visuals come from the papers, chosen by context
>
> This amendment overrides every helix and DNA reference in §1, §4.3, §5 and §6, and Wave 1 task T1c. The Dribbble style stays: the cockpit layout, smoked glass, callouts, stat tiles and cone charts. **The DNA helix is no longer the motif.** Every visual now comes from the paper data shown in that place.
>
> - **Brief hero, the "figure stage".** This replaces the helix. It shows the top-3 papers' lead figures (`papers.figure_url`, design D23 on main) in three glass frames, with the largest one first. Dribbble-style callouts are pinned to each frame: label chip, dot node and leader line, carrying the signal type, evidence rung, `UP +x%` and verdict. The callouts are real `<a>` links to the card. Hover and focus are synced with the Top-3 strip and with `[data-card]`.
> - **Domain sections.** The header shows a small banner with the domain's HERO-paper figure. A quiet domain shows a line glyph for the domain instead.
> - **HERO card.** It becomes a spec-table card, like the Dribbble specimen card: the lead figure with its caption and attribution, plus SpecTable rows for rung, venue, HF upvotes, stars and linked models.
> - **/paper/[id].** A figure gallery of up to 6 images from `papers.figures`, each with its caption, above the abstract plate.
> - **/ask.** Cited papers appear as 56px figure thumbnails in the citation list. **/search and /log.** Rows get a 40px thumbnail column.
> - **Fallback for papers with no figure.** A glyph for the signal type, drawn as inline SVG on the plate in the cyan line style:
>   - BENCH: a leaderboard bar glyph
>   - EVAL: a scatter glyph
>   - REFRAME: crossing arrows
>   - METHOD: a node graph
>   The fallback keeps the same box size, so nothing shifts.
> - **Images.** Use `next/image` with explicit width and height (no CLS), `sizes`, `loading="lazy"` except the first hero frame (`priority`), and `alt` = "Figure from <title>". The caption plate is α .92 and the attribution reads "Figure: <first author> et al., arXiv <id>". Images go on plates or inside glass frames with a 1px rim and are **never** placed under `backdrop-filter`. Do not blur or tint the figure itself; add a subtle inner vignette only.
> - **What happens to the helix.** `src/components/brief/helix/*` from T1c is not used on /brief. Keep `HelixParticles` only as an optional ambient glow behind the figure stage: particles with no DNA shape, off under reduced motion. Otherwise delete it.
> - **Non-goal change.** §10's "no data or logic changes" now allows reading `figure_url`, `figure_source` and `figures` in the existing loaders. Those columns come from main (D23, tasks 14.x) and are merged into this branch before Wave 2. No other data changes are allowed.
> - **New file.** `src/components/paper/PaperFigure.tsx` (`next/image` with glyph fallback, caption and attribution) is shared by every surface above. It is created on main by task 14.5, then restyled here.


## 1. Direction summary

1. **Cockpit layout.** The Monday brief becomes a dark teal bento cockpit. It has a glass capsule nav, and the hero shell holds big-number stat tiles, a "signal helix" with the top-3 papers pinned to it as real links, and a cone-spike attention chart.
2. **Glass only on chrome.** Glass is used for the nav, the sticky domain bar, one hero shell, the left rails, the composer and transient dialogs. Every card, table, chart and verdict sits on near-solid **plates** (α .92), and no plate has a `backdrop-filter`.
3. **Contrast without blur.** Contrast is computed against the *flattened, unblurred* worst-case backdrop. The frost is therefore pure enhancement, and every fallback rung (solid, no blur, reduced transparency) is at least as readable as the glass.
4. **Typography.** Space Grotesk is the display face, with a two-tone "WEEK 41 **SIGNAL**" heading that mirrors "GENOME MAP". Inter is the body face, and JetBrains Mono is used for micro-labels, meters and numbers.
5. **What does not change.** Behaviour, data, ARIA, keyboard model and the email all stay as they are. This is a presentation-only change, built from Tailwind 4 `@utility` blocks with no glass library.

---

## 2. Tokens

### 2.1 Contrast basis (computed, WCAG 2.x relative luminance)

The worst-case backdrops are:
- **Aurora peak** `#1E6B6E`, the brightest stop of the page glow, behind the hero.
- **Helix particle core** `#3FE0D0`, which passes under the sticky nav when the page scrolls.

The flattened surfaces are:

| Surface | Recipe | Flattened worst case |
|---|---|---|
| glass-base | `rgba(6,24,30,.62)` over `#1E6B6E` | `#0F383C` |
| glass-nav | `rgba(6,24,30,.80)` over `#3FE0D0` | `#114042` |
| glass-elevated | `rgba(8,30,36,.78)` over `#1E6B6E` | `#0D2F34` |
| plate | `rgba(12,26,31,.92)` over `#3FE0D0` | `#102A2D` |
| plate | `rgba(12,26,31,.92)` over `#1E6B6E` | `#0D2025` |
| plate-hover | `#12272C` | `#12272C` |
| solid fallback | `#0F2227` | `#0F2227` |

The nav alpha was raised from .72 to .80 because at .72, text-muted measured 4.36:1 and failed. At .80 it measures 5.46:1. `[D]`

### 2.2 `src/app/globals.css`: replace the `@theme inline`, `:root` and `.dark` blocks

The values live in `:root`, and `@theme inline` only maps them to utilities. The app is dark only, so `:root` and `.dark` share the same values. `.dark` is kept so that shadcn's `dark:` variants still activate. `[D]`

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  /* fonts: fixes the self-reference at globals.css:10 [R] */
  --font-sans: var(--font-inter);
  --font-heading: var(--font-space-grotesk);
  --font-display: var(--font-space-grotesk);
  --font-mono: var(--font-jetbrains-mono);

  /* shadcn semantic map (unchanged names, new values below) */
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  /* keep the existing --color-sidebar-* lines as they are */

  /* new brand tokens -> utilities: bg-plate, text-signal, border-rule, ... */
  --color-canvas: var(--bg-0);
  --color-plate: var(--plate);
  --color-plate-solid: var(--plate-solid);
  --color-plate-hover: var(--plate-hover);
  --color-plate-rim: var(--plate-rim);
  --color-signal: var(--signal);       /* teal accent (not shadcn --accent!) */
  --color-signal-2: var(--signal-2);
  --color-micro: var(--micro);
  --color-rule: var(--rule);
  --color-chip-border: var(--chip-border);
  --color-rising: var(--rising);
  --color-focus: var(--focus);
  --color-verdict-client: var(--verdict-client);
  --color-verdict-read: var(--verdict-read);
  --color-verdict-skip: var(--verdict-skip);

  /* -> utilities rounded-glass / rounded-plate / rounded-tile.
     Raw values live in :root so the hand-written @utility CSS below can read them too. */
  --radius-glass: var(--glass-radius);
  --radius-plate: var(--plate-radius);
  --radius-tile: var(--tile-radius);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
  --ease-glass: var(--glass-ease);
}

:root, .dark {
  color-scheme: dark;
  --radius: 0.625rem;
  --glass-radius: 1.25rem;            /* 20px shell */
  --plate-radius: 0.75rem;            /* 12px = 20 - 8 padding (concentric) */
  --tile-radius: 0.625rem;            /* 10px: inputs, PIN cells, inner tiles */
  --glass-ease: cubic-bezier(.2,.8,.2,1);

  /* canvas */
  --bg-0: #050D10;
  --bg-glow-1: #0A2A2E;
  --bg-glow-peak: #1E6B6E;           /* worst-case backdrop for every contrast figure */

  /* plates (content) */
  --plate: rgb(12 26 31 / .92);       /* flattened worst case #102A2D */
  --plate-solid: #0C1A1F;
  --plate-hover: #12272C;
  --plate-rim: rgb(127 224 230 / .14); /* decorative hairline, not meaningful */

  /* glass (chrome) */
  --glass-tint: rgb(6 24 30 / .62);
  --glass-tint-nav: rgb(6 24 30 / .80);
  --glass-tint-elev: rgb(8 30 36 / .78);
  --glass-sheen: rgb(158 220 226 / .06);
  --glass-rim: rgb(127 224 230 / .22);
  --glass-rim-top: rgb(200 245 247 / .38);
  --glass-hi: rgb(255 255 255 / .14);
  --glass-solid: #0F2227;
  --glass-filter: blur(16px) saturate(170%) brightness(.95);
  --glass-filter-nav: blur(14px) saturate(170%) brightness(.95);
  --glass-filter-elev: blur(24px) saturate(190%) brightness(.95);
  --glass-shadow: 0 12px 40px rgb(0 0 0 / .45);
  --glass-shadow-elev: 0 24px 64px rgb(0 0 0 / .55);
  --glow-signal: 0 0 24px rgb(63 224 208 / .25); /* helix nodes + linked card only */

  /* text */
  --text: #E6F4F3;
  --text-muted: #9DB8BC;
  --micro: #7FD9DD;
  --signal: #3FE0D0;
  --signal-2: #3FB8BD;
  --rule: #4FA3A8;
  --chip-border: #5E9EA3;             /* meaningful borders: signal chips, inputs */
  --focus: #7FDBFF;

  /* cues (mirror COLORS_UI in src/lib/brief/cues.ts) */
  --verdict-client: #FF8A50;
  --verdict-read: #56B4E9;
  --verdict-skip: #A7AEB8;
  --rising: #3DDC97;

  /* shadcn semantic remap: ui/* inherit the palette with almost no edits */
  --background: var(--bg-0);
  --foreground: var(--text);
  --card: var(--plate);
  --card-foreground: var(--text);
  --popover: var(--glass-solid);      /* select/tooltip popups stay solid (no extra blur layer) */
  --popover-foreground: var(--text);
  --primary: var(--signal);
  --primary-foreground: #03201D;      /* 10.41:1 on #3FE0D0 */
  --secondary: var(--plate-hover);
  --secondary-foreground: var(--text);
  --muted: var(--plate-hover);
  --muted-foreground: var(--text-muted);
  --accent: #17333A;                  /* shadcn hover fill */
  --accent-foreground: var(--text);
  --destructive: #FF6B6B;
  --border: #1F3A40;
  --input: var(--chip-border);        /* input boundary >= 3:1 (WCAG 1.4.11) */
  --ring: var(--focus);
  --chart-1: #3FE0D0; --chart-2: #3FB8BD; --chart-3: #56B4E9; --chart-4: #3DDC97; --chart-5: #A7AEB8;
}

/* rung 1: no backdrop-filter support -> solid */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  :root { --glass-tint: var(--glass-solid); --glass-tint-nav: var(--glass-solid); --glass-tint-elev: var(--glass-solid); }
}

/* reduced transparency (Chromium 118+) and the manual "Solid panels" toggle (Safari/Firefox users) */
@media (prefers-reduced-transparency: reduce) {
  :root {
    --glass-tint: var(--glass-solid); --glass-tint-nav: var(--glass-solid); --glass-tint-elev: var(--glass-solid);
    --plate: var(--plate-solid); --glass-sheen: transparent;
    --glass-filter: none; --glass-filter-nav: none; --glass-filter-elev: none;
    --glow-signal: none;
  }
}
:root[data-glass="off"] {
  --glass-tint: var(--glass-solid); --glass-tint-nav: var(--glass-solid); --glass-tint-elev: var(--glass-solid);
  --plate: var(--plate-solid); --glass-sheen: transparent;
  --glass-filter: none; --glass-filter-nav: none; --glass-filter-elev: none;
  --glow-signal: none;
}

/* more contrast: solid surfaces, 2px meaningful rims */
@media (prefers-contrast: more) {
  :root {
    --glass-tint: var(--glass-solid); --glass-tint-nav: var(--glass-solid); --glass-tint-elev: var(--glass-solid);
    --plate: var(--plate-solid);
    --glass-filter: none; --glass-filter-nav: none; --glass-filter-elev: none;
    --glass-rim: var(--text-muted); --glass-rim-top: var(--text-muted); --plate-rim: var(--chip-border);
    --text-muted: #B9D0D3;
  }
}

@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground font-sans; }
  body::before {                      /* static page glow on its own fixed layer; never animated (see 8) */
    content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
    background:
      radial-gradient(60rem 40rem at 78% 8%, color-mix(in srgb, var(--bg-glow-peak) 55%, transparent), transparent 70%),
      radial-gradient(50rem 36rem at 10% 0%, var(--bg-glow-1), transparent 70%),
      var(--bg-0);
  }
  .num, td, th { font-variant-numeric: tabular-nums; }
  :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
}
```

Notes:
- The glow sits on a fixed `body::before` layer, not on `background-attachment: fixed`, which can force a repaint on scroll. Nothing animates it. Do not change it to `transform`-drift. `[D]` In B, the drifting aurora forced a re-blur of every glass layer on every frame, which is why the third judge rejected it.
- **Tailwind v4 syntax.** Use theme utilities (`rounded-glass`, `rounded-plate`, `rounded-tile`, `bg-plate`, `text-signal`, `border-rule`, `outline-focus`) or the v4 forms `-(--var)` and `-[var(--var)]`. Never use the v3 form `-[--var]`, because v4 emits it as an invalid literal.
- The final `:focus-visible` rule gives every focusable element a solid 3px ring. A glow-only ring is never used. `[R]` cookbook §6, WCAG 1.4.11.

---

## 3. Glass recipes (`src/app/globals.css`, after the tokens)

Rules that apply to all of them:
- **`glass-chip` has no `backdrop-filter`.** It repeats around 180 times on the brief (3 actions × 60 cards), and a chip inside a glass shell would only sample its parent's backdrop root. `[D]`
- **Only `glass-base`, `glass-nav` and `glass-elevated` blur.**
- **No glass element may contain another glass element.** Nesting breaks backdrop sampling.
- **No glass element may wrap `position: fixed` or `sticky` descendants.** A `backdrop-filter` makes its element the containing block for fixed descendants, and it can break sticky.

```css
@utility glass-base {          /* rails, sticky domain bar, hero shell, composer */
  background: linear-gradient(to bottom, var(--glass-sheen), transparent 40%), var(--glass-tint);
  -webkit-backdrop-filter: var(--glass-filter);
  backdrop-filter: var(--glass-filter);
  border: 1px solid var(--glass-rim);
  border-top-color: var(--glass-rim-top);
  border-radius: var(--glass-radius);
  box-shadow: inset 0 1px 0 var(--glass-hi), inset 0 -1px 0 rgb(0 0 0 / .2), var(--glass-shadow);
  text-shadow: 0 1px 2px rgb(0 0 0 / .5);
}

@utility glass-nav {           /* the capsule top nav: the only refracting surface */
  background: linear-gradient(to bottom, var(--glass-sheen), transparent 50%), var(--glass-tint-nav);
  -webkit-backdrop-filter: var(--glass-filter-nav);
  backdrop-filter: var(--glass-filter-nav);
  border: 1px solid var(--glass-rim);
  border-top-color: var(--glass-rim-top);
  border-radius: 9999px;
  box-shadow: inset 0 1px 0 var(--glass-hi), inset 0 -1px 0 rgb(0 0 0 / .2), var(--glass-shadow);
  text-shadow: 0 1px 2px rgb(0 0 0 / .5);

  /* rung 3: SVG refraction. @supports alone is not enough because Safari and Firefox
     PARSE url() in backdrop-filter and then paint nothing, so @supports passes there.
     It is also gated on the [data-refract] flag, which the boot script sets only when
     navigator.userAgentData.brands contains "Chromium". It is also off under reduced
     transparency, more contrast, and data-glass=off. */
  @supports (backdrop-filter: url("#rs-lens")) {
    @media (prefers-reduced-transparency: no-preference) and (prefers-contrast: no-preference) {
      :root[data-refract]:not([data-glass="off"]) & {
        backdrop-filter: url("#rs-lens") blur(12px) saturate(170%) brightness(.95);
      }
    }
  }
}

@utility glass-elevated {      /* CommandBar dialog, ? help modal, shadcn Dialog popup */
  background: linear-gradient(to bottom, var(--glass-sheen), transparent 40%), var(--glass-tint-elev);
  -webkit-backdrop-filter: var(--glass-filter-elev);
  backdrop-filter: var(--glass-filter-elev);
  border: 1px solid var(--glass-rim);
  border-top-color: var(--glass-rim-top);
  border-radius: var(--glass-radius);
  box-shadow: inset 0 1px 0 var(--glass-hi), var(--glass-shadow-elev);
}

@utility glass-chip {          /* domain chips, filter pills, badges, action buttons: NO backdrop-filter */
  background: rgb(127 224 230 / .08);
  border: 1px solid var(--glass-rim);
  border-radius: 9999px;
}

@utility glass-interactive {   /* adds pointer specular + press; combine with glass-chip or glass-base */
  position: relative;
  isolation: isolate;
  transition: transform .2s var(--glass-ease), background-color .2s, border-color .15s;
  &::before {
    content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: -1;
    background: radial-gradient(120px circle at var(--mx, 50%) var(--my, 0%), rgb(255 255 255 / .18), transparent 60%);
    opacity: 0; transition: opacity .2s;
  }
  &:hover::before { opacity: 1; }
  &:hover { border-color: var(--glass-rim-top); }
  &:active { transform: scale(.97); }
  &:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) {
    transition: none;
    &::before { transition: none; }
    &:active { transform: none; }
  }
}

@utility plate {               /* content surface: cards, tables, charts, answers, PIN cells */
  text-shadow: none;           /* stop glass-base text-shadow inheriting into content */
  background: var(--plate);
  border: 1px solid var(--plate-rim);
  border-radius: var(--plate-radius);
}

@utility micro {               /* uppercase micro-label */
  font-family: var(--font-jetbrains-mono), ui-monospace, monospace;
  font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase;
  color: var(--micro);
}

@media (forced-colors: active) {
  .glass-base, .glass-nav, .glass-elevated, .glass-chip, .plate { border: 1px solid CanvasText; }
}
```

If Tailwind 4's `@utility` refuses the nested `@supports` or `:root … &` selector at build time, move the refraction block out into a plain rule `:root[data-refract]:not([data-glass="off"]) .glass-nav { … }` wrapped in the same `@supports` and `@media`. The behaviour does not change. `[D]`

### 3.1 Lens filter and boot script (`src/app/layout.tsx`)

1. **Lens filter.** Add the SVG once, as the first child of `<body>`:

```tsx
<svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
  <filter id="rs-lens" x="-10%" y="-30%" width="120%" height="160%" colorInterpolationFilters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="7" result="n" />
    <feDisplacementMap in="SourceGraphic" in2="n" scale="22" xChannelSelector="R" yChannelSelector="G" result="d" />
    <feGaussianBlur in="d" stdDeviation="1.5" />
  </filter>
</svg>
```

2. **Boot script.** It runs before paint, via `next/script` with `strategy="beforeInteractive"` and `id="rs-glass-boot"`. Add `suppressHydrationWarning` on `<html>`, because the script writes `data-glass` and `data-refract` before hydration.

```js
(function(){var d=document.documentElement;
try{if(localStorage.getItem("rs-glass")==="off")d.dataset.glass="off";}catch(e){}
try{var b=navigator.userAgentData&&navigator.userAgentData.brands;
if(b&&b.some(function(x){return x.brand==="Chromium";}))d.dataset.refract="";}catch(e){}})();
```

---

## 4. Component specs, mapped to existing files

Every change below is limited to class names, markup wrappers and presentational children. Props, exports, server/client boundaries, data flow and event handlers stay unchanged unless a change is listed explicitly.

### 4.1 Global

**`src/app/layout.tsx`**
- Replace Geist with the following, each with `subsets: ["latin"]` and `display: "swap"`:
  - `Space_Grotesk({weight:["500","600"], variable:"--font-space-grotesk"})`
  - `Inter({variable:"--font-inter"})`
  - `JetBrains_Mono({weight:["500"], variable:"--font-jetbrains-mono"})`
- Set `<html className="dark …">` with `suppressHydrationWarning`.
- Set the metadata to `title: "Research Signal"` and `description: "Weekly AI/ML research brief"`. `[R]` layout.tsx:18 still reads "Create Next App".
- Add the lens `<svg>` and the boot script (§3.1).
- Wave 1 adds `<GlassNav/>` as the first element inside `<body>` and `<GlassRuntime/>` next to `<CommandBar/>`, both inside `Suspense`.

**`src/lib/brief/cues.ts`**: an additive change only.

```ts
// Web UI on dark plates. The email keeps COLORS (Okabe-Ito on white); do not change COLORS.
export const COLORS_UI = {
  ink: "#E6F4F3",
  muted: "#9DB8BC",
  rule: "#4FA3A8",
  rising: "#3DDC97",
  verdict: { CLIENT: "#FF8A50", READ: "#56B4E9", SKIP: "#A7AEB8" },
} as const;
```

`[R]` `src/lib/brief/email.ts:3` imports `COLORS` and must not change. `[R]` `docs/brief.md:23` says "No cue relies on color or images alone", so the text labels stay.

**New `src/components/glass/GlassNav.tsx`** (client). This is the capsule nav.
- Container: `<header className="sticky top-3 z-30 mx-auto mt-3 w-[min(72rem,calc(100%-2rem))] print:hidden">` around `<nav aria-label="Primary" className="glass-nav flex h-14 items-center gap-1 px-3">`.
- Returns `null` on `/login` and `/a/*`, the same rule CommandBar already applies.
- Contents, in order:
  1. The logo `(R)` mark as an SVG ring with a teal dot, plus the `micro` wordmark "RESEARCH·SIGNAL" linking to `/`.
  2. Links: Brief `/`, Search `/search`, Ask `/ask`, Log `/log` and Settings `/settings`. Each gets `aria-current="page"` when `usePathname()` matches by prefix, with `/brief/*` counting as Brief.
  3. A search pill: `<button className="glass-chip glass-interactive …">` with "Search or ask" and a `/` kbd hint. It dispatches `window.dispatchEvent(new CustomEvent("rs:command-open"))`.
  4. A "Solid panels" toggle: `<button aria-pressed={solid} title="Solid panels">`. It writes `localStorage["rs-glass"]` inside try/catch and sets or removes `document.documentElement.dataset.glass`.
- Nav text uses only `--text`, `--micro` and `--signal`. On glass-nav these measure 10.13, 7.01 and 6.96:1.
- Nav text never uses verdict colours.

**New `src/components/glass/GlassRuntime.tsx`** (client, renders `null`).
- One `document` `pointermove` listener, `passive`, throttled with rAF.
- On each move it finds `e.target.closest(".glass-interactive")` and sets `--mx` and `--my` in px through `style.setProperty`. It does not use React state.
- It is not attached under `matchMedia("(prefers-reduced-motion: reduce)")`.

**`src/components/CommandBar.tsx`** (`[R]` the floating button at CommandBar.tsx:101 carries `backdrop-blur`).
- Delete the floating bottom-right button. The nav pill replaces it, and the button would otherwise be a fifth blur layer.
- Add `useEffect` → `addEventListener("rs:command-open", () => setOpen(true))`.
- Pass `className="glass-elevated"` to the dialog content.
- Mode tabs become a `glass-chip` segmented control. Keep `role=tab`, `aria-selected` and the tablist `aria-label="Mode"`.
- Hit rows become `plate` rows with `data-[selected=true]:bg-plate-hover`.
- Keep the following unchanged: ⌘/Ctrl+K, `/` (unless the page has already called preventDefault), Tab mode switching, the 200ms debounce, the 8 hits, and the Enter routes.

### 4.2 `src/components/ui/*`

Most of the palette arrives through the token remap. The only edits are these:

| File | Change |
|---|---|
| `dialog.tsx` | The overlay goes from `bg-black/10 … supports-backdrop-filter:backdrop-blur-xs` to `bg-black/55` with **no blur**, so a dialog uses one transient layer, not two (`[R]` dialog.tsx:34). The popup gets `glass-elevated` and drops `bg-background`. |
| `command.tsx` | `CommandDialog` passes `glass-elevated` through. The input sits on a plate and its border uses `--input`. |
| `sonner.tsx` | Pin `theme="dark"`. Today it reads `useTheme()` and there is no ThemeProvider (sonner.tsx:8). Toasts use `--popover`. |
| `button.tsx` | `default` = `bg-primary text-primary-foreground` (10.41:1). `outline` = `glass-chip glass-interactive`. `ghost` = `hover:bg-accent`. No API change. |
| `badge.tsx` | `outline` becomes a pill (`rounded-full border-chip-border`). `secondary` = `glass-chip`. `destructive` = `bg-destructive/12 text-destructive` (5.21:1). |
| `input.tsx`, `textarea.tsx`, `select.tsx` | `bg-plate-solid border-input rounded-tile`. The boundary is `#5E9EA3`, at least 4.08:1 on any plate. |
| `table.tsx` | `TableCell` and `TableHead` get `tabular-nums`. Rows get `hover:bg-plate-hover`. No glass. |
| `tooltip.tsx` | `bg-popover` (solid `#0F2227`) with a 1px `--glass-rim`. No blur. |
| `switch.tsx` | Checked = `bg-signal`, with the thumb in `#03201D`. Unchecked track border `--chip-border`. |
| `card.tsx`, `tabs.tsx`, `separator.tsx`, `scroll-area.tsx`, `label.tsx`, `input-group.tsx` | No edit, because tokens cover them. `separator` uses `bg-border`. |

### 4.3 `src/components/brief/*`

Card anatomy is task T2a. It covers the following files.

- **`CardParts.tsx` › `CardFrame`** (`[R]` CardParts.tsx:25 hard-codes `focus-visible:outline-[#0072B2]`, which measures 2.99:1 on `#12272C` and fails)
  - Class becomes `plate relative scroll-mt-32 py-3 pr-3 pl-4 outline-offset-2 focus-visible:outline-3 focus-visible:outline-focus transition-[border-color,box-shadow] duration-150 data-[linked]:border-signal data-[linked]:shadow-[var(--glow-signal)] hover:bg-plate-hover`.
  - Keep `<article id data-card data-paper-id tabIndex={0}>` and its children unchanged.
  - `scroll-mt-32` (128px) clears the sticky nav plus the domain bar during `scrollIntoView`. `[R]` useCardKeys.ts uses `block: "nearest"`, which honours `scroll-margin`.
- **`CardParts.tsx` › `CueRow`**: the rising span uses `COLORS_UI.rising` (`#3DDC97`, at least 8.54:1 on plates) and keeps the text `UP {pct}`.
- **`CardParts.tsx` › `AttentionLine`**: add `num` (tabular-nums) to the counts span. `[R]` The inventory notes the counts currently lack tabular numerals.
- **`CardParts.tsx` › `MoreDetails`**: keep `<details data-expand>`. The summary becomes `micro`.
- **`VerdictBar.tsx`**: `COLORS` → `COLORS_UI` in both components.
  - The bar keeps `aria-hidden`. Change `w-1 rounded-l-md` to `w-1 rounded-l-[inherit]` and add `forced-colors:[forced-color-adjust:none] forced-colors:!bg-[CanvasText]`.
  - The label stays text (`BRING TO CLIENT` / `READ` / `SKIP`) in `font-mono text-[11px] tracking-[.08em]`.
- **`SignalChip.tsx`**
  - The inline border keeps `SIGNAL_BORDER[signal]`. Width is `METHOD ? 3px : 2px`, because `double` needs at least 3px to show two lines. Colour stays `currentColor`.
  - Classes: `rounded-full px-2 bg-[rgb(127_224_230/.08)] text-foreground font-mono`.
  - No `glass-chip`, because that utility would overwrite `border-style`. `[R]` The footer legend refers to these styles.
- **`EvidenceMeter.tsx`**
  - The 4 cells keep `aria-hidden`.
  - A reached cell is `bg-signal border-signal shadow-[0_0_6px_rgb(63_224_208/.5)]`. An unreached cell is `border border-dashed border-chip-border` with no fill, so the state does not depend on colour alone.
  - The text `meterText(rung)` and the `title` stay.
- **`CardActions.tsx`**
  - Buttons become `glass-chip glass-interactive px-2.5 py-0.5 text-xs`. Pressed is `aria-pressed:bg-signal aria-pressed:text-[#03201D] aria-pressed:border-signal` (10.41:1).
  - Keep `role=group aria-label="Your action"`, `data-action`, `aria-pressed`, the ✓ prefix, the optimistic POST and "Not saved".
- **`HeroCard.tsx`**: replace `border-2` with `plate border-signal/40 p-5`. The headline is `font-heading text-xl`. The client angle sits in an inner `rounded-tile bg-plate-hover p-3` block labelled `micro` "CLIENT ANGLE".
- **`StandardCard.tsx`, `CompactRow.tsx`**: tokens only. `CompactRow` keeps its single line and becomes a `plate` row. `/search` also uses `CompactRow`.

Brief composition is task T2b. It covers the following files.

- **`DomainChipsBar.tsx`** (`[R]` DomainChipsBar.tsx:7 has `sticky top-0 … bg-background/95 backdrop-blur`)
  - The bar becomes `sticky top-[76px] z-20 -mx-4 glass-base px-4 py-2 flex items-center gap-2 overflow-x-auto`.
  - Chips are `glass-chip glass-interactive px-3 py-1 text-xs` with `num` counts.
  - The search input keeps `data-search-input` and `aria-label="Search papers"`, styled with the `input` tokens.
  - Keep `nav aria-label="Domains"`.
- **`DomainSection.tsx`**
  - Section `scroll-mt-20` → `scroll-mt-32`, so it clears the 56px nav, the 12px gap and the 44px bar.
  - The h2 gets `border-t border-rule pt-4 font-heading`. This is B's 1px cyan rule, at 5.13:1 or better on plates.
  - Layout: `lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-6`. The left column holds the S-C-I paragraph and the cards. The right column holds the **domain spec aside** (`<SpecTable>`) with these rows:
    - Papers: `1·hero + standard.length + compact.length`
    - Hero: `hero ? 1 : 0`
    - Quiet: `quiet ? "yes" : "no"`
    - Nearest miss: `nearestMiss.final.toFixed(2)` when `quiet`
  - These fields come from `DomainSelection` in `src/lib/brief/types.ts`.
  - The "Quiet week. Nearest miss …" sentence stays in the text.
- **`Top3Strip.tsx`**: the h2 becomes `micro` "TOP 3 THIS WEEK" plus an h2 (`font-heading`). The grid is unchanged (`lg:grid-cols-3`). No other change.
- **`SourceHealthFooter.tsx`**
  - It becomes a `plate` **specimen spec table** (`<SpecTable>`) with these rows:
    - Coverage: `selection.label`
    - Sources: "All normal" or `"{sourceHealth.length} degraded"`
    - One row per `sourceHealth` entry: kind, status, note
    - Summaries: `"plain extracts"` only when `proseSource==="fallback"`
  - The **legend sentence stays word for word**.
- **`BriefShell.tsx`**
  1. Help modal: render it through `createPortal(…, document.body)` so that no glass or transformed ancestor can trap `position: fixed`. The inner box gets `glass-elevated`. Keys are shown as `glass-chip` `<kbd>`. Keep `role=dialog aria-modal aria-label="Keyboard shortcuts"` and the click-outside and Esc behaviour.
  2. Add **helix ↔ card sync**: a delegated `pointerover`, `pointerout`, `focusin` and `focusout` listener on `document`.
     - When the target is inside `[data-helix-target]`, set or clear `data-linked` on `#card-<id>`.
     - When the target is inside `[data-card]`, set or clear `data-linked` on `[data-helix-target="<cardId>"]`.
     - A click on a callout calls `preventDefault()`, then `card.scrollIntoView({block:"center", behavior})`, then `card.focus({preventScroll:true})`, so that j/k continues from that card.
- **`useCardKeys.ts`**: make one change only. `scrollIntoView({ block: "nearest" })` becomes `{ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }`. Every other key branch stays exactly as it is.
- **New `BriefHero.tsx`** (server component): the bento hero (§5). It takes `{ doc: BriefDoc; status: string }`.
- **New `helix/SignalHelix.tsx`** (server) and **`helix/HelixParticles.tsx`** (client): see §6.

**`src/app/brief/[isoWeek]/page.tsx`**
- `main` changes from `max-w-4xl` to `max-w-6xl`.
- Order: `DomainChipsBar` moves *below* `BriefHero`. Then Top3Strip, the domains, Rising and the footer, all as before.
- The rising h2 changes from `text-[#007A5E]` to `text-rising border-t border-rule` and keeps `scroll-mt-32`.
- `<h1>{prose.weekLine}</h1>` is kept as the h1. It moves inside `BriefHero`.

### 4.4 Shared visual primitives (new, `src/components/viz/`, server components)

**`StatTile.tsx`**
- Props: `{ label: string; value: string; hint?: string }`.
- Markup: `plate rounded-tile p-4`, the value in `font-display text-[32px] leading-none num`, and the label in `micro` underneath.

**`SpecTable.tsx`**
- Props: `{ rows: [label: string, value: ReactNode][]; caption?: string }`.
- Renders a `<dl>` with `grid-cols-[auto_1fr]`. Each `dt` is `micro` and each `dd` is `text-sm num`.

**`ConeChart.tsx`**
- Props: `{ title: string; unit: string; data: { label: string; value: number; display: string }[] }`.
- It renders a `<figure>` with a `<figcaption className="micro">` and an inline SVG (`aria-hidden`, `viewBox 0 0 W 160`). Inside the SVG:
  - Each value is a triangular "cone". The base is 70% of the slot width. The apex height is `value/max`. The fill is a `linearGradient` from `--signal` at α .9 at the apex to α .05 at the base, with a 1px `--signal` stroke.
  - The value label `display` sits above each apex (`--text`, 11px, mono).
  - Category labels sit under the 1px `--rule` baseline (`--text-muted`, truncated to 10ch, with the full text in `<title>`).
- Below the SVG is `<table className="sr-only">` with the title as caption and the columns label, value. This gives screen readers the same data.
- If every value is 0, render `<p className="text-sm text-muted-foreground">No data yet.</p>` instead of the chart.
- It always sits on a plate.

### 4.5 `src/components/ask/AskPanel.tsx` and `src/app/ask/page.tsx`

Props, state, fetch calls, the mini-Markdown parser and the keyboard handling stay as they are. Only the classes change.

| Location | Element | Change |
|---|---|---|
| `ask/page.tsx` | page `main` (max-w-6xl) | Keep the width. The 220px threads column becomes `glass-base p-3` (`nav aria-label="Threads"` kept). Thread rows are `rounded-tile px-2 py-1.5 hover:bg-plate-hover`, with `aria-current` on the active thread, and are not glass. "New question" becomes `glass-chip glass-interactive`. |
| AskPanel.tsx:176 | inline `code` (`bg-muted`) | Becomes `bg-plate-hover font-mono` (text 13.75:1). |
| AskPanel.tsx:182 | citation links (`text-primary underline`) | Keep them. They are now teal `#3FE0D0`, 9.19:1 on the worst plate. The muted unresolved `[ref]` at :186 stays muted (7.20). |
| AskPanel.tsx:205 | md `h3` | Becomes `font-heading`. |
| AskPanel.tsx:221–228 | md table | Add `tabular-nums` to `table`. Cell borders become `border-border`. Keep `overflow-x-auto`. |
| AskPanel.tsx:306–310 | answer actions row and `role=status` | Buttons become `glass-chip glass-interactive`. The labels "Copy as client note", "Export .md" and "Save to log" and the `role=status` span stay. |
| AskPanel.tsx:321 | answer card (`rounded-lg border p-4`) | Becomes `plate p-4`. |
| AskPanel.tsx:322 | intent and confidence row | Badges become `glass-chip` pills (`micro`). Low confidence keeps the destructive Badge variant (`bg-destructive/12`, 5.21:1). |
| AskPanel.tsx:332 | "Thin evidence" callout | Keep the text and `bg-destructive/10 text-destructive` (4.80:1). Change the radius to `rounded-tile`. |
| AskPanel.tsx | user question bubble (muted) | Becomes `bg-plate-hover rounded-plate`, right-aligned. |
| AskPanel.tsx | 6 job-prompt buttons (empty state) | Become `glass-chip glass-interactive` in a `grid sm:grid-cols-2 lg:grid-cols-3`. Rename `rounded-full` to `rounded-plate` for 2-line prompts. |
| AskPanel.tsx | composer form | The wrapper becomes `glass-base sticky bottom-4 p-2`. The textarea becomes `bg-plate-solid border-input rounded-tile`. The submit button uses the `default` variant (teal, 10.41:1). Enter and Shift+Enter behaviour is unchanged. The error `role=alert` stays. |

---

## 5. Page layouts

```
/brief/[isoWeek]   (main max-w-6xl; ≥lg bento, <lg stacks top→bottom)
( (R) RESEARCH·SIGNAL   Brief  Search  Ask  Log  Settings   [⌕ Search or ask  /]  [◐ Solid] )  glass-nav, sticky top-3
┌ BriefHero: glass-base shell (the only blurred shell on the page) ───────────────────────────┐
│ micro: RESEARCH-SIGNAL · 2026-W41 · PUBLISHED · PRESS ? FOR SHORTCUTS                        │
│ WEEK 41 SIGNAL   (display 56px; "SIGNAL" in --signal-2)                                       │
│ h1: prose.weekLine (font-heading 24px, max-w-[40ch])                                          │
│ ┌ plate tiles 2×2 ─────────┐ ┌ SignalHelix (on the shell, no plate) ──────────────────────┐ │
│ │ 38        │ 3            │ │ PEER ┆ ·:·.:·  ●──[#1 BRING TO CLIENT · Agents          ]   │ │
│ │ FEATURED  │ BRING TO     │ │      ┆ :·  ·:     [ Long-horizon tool use…  [###-] MODEL ]   │ │
│ │           │ CLIENT       │ │MODEL ┆  ·:·:·                                               │ │
│ │ 6         │ UP +38%      │ │ CODE ┆ ·:  :·  ●──[#2 READ · Evals · [##--] CODE · EVAL]    │ │
│ │ HERO      │ TOP RISING   │ │      ┆ :·.·:   ●──[#3 READ · RAG · [##--] CODE · METHOD]    │ │
│ └───────────┴──────────────┘ │  LAB ┆  ·:·                                                  │ │
│ ┌ plate: ConeChart ────────┐ └──────────────────────────────────────────────────────────────┘ │
│ │ ATTENTION THIS WEEK · HF │  micro under helix: SOURCES · ALL NORMAL  (or "2 DEGRADED")    │
│ │  ▲    ▲  ▲   ▲   ▲       │                                                                 │
│ │ Agt  RAG Evl Vis Rsng    │                                                                 │
│ └──────────────────────────┘                                                                 │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
[ Agents 6 · RAG 4 · Evals 3 · Vision 2 · Rising 3 ·············· ⌕ Search papers ]  glass-base, sticky top-[76px]
TOP 3 THIS WEEK
[plate card ▌][plate card ▌][plate card ▌]        ← the helix callouts target these #card-<id>
──────────────────────────── 1px --rule
## Agents
S·C·I paragraph (max-w-prose, 16/26)                 ┌ plate spec ─────┐
[HERO plate ▌ headline · CueRow · attention · lede   │ PAPERS      6   │
   ┌ CLIENT ANGLE inner tile ┐ · actions R C S]       │ HERO        1   │
[STANDARD ▌][STANDARD ▌]                              │ QUIET       no  │
[compact row ▌] [compact row ▌] …                     └─────────────────┘
──────────────────────────── Rising (text-rising) → StandardCards
┌ plate spec-table footer: COVERAGE · SOURCES · per-source rows · legend sentence ┐
```

How each hero value is computed, using only existing `BriefDoc` fields (§10):

| Tile | Computation |
|---|---|
| FEATURED | `Object.keys(selection.cards).length` |
| BRING TO CLIENT | count of cards with `verdict==="CLIENT"` |
| HERO | `selection.domains.filter(d=>d.hero).length` |
| TOP RISING | `max(cards[id].evidence.rising_pct for id in selection.rising)`, formatted with `formatPercent`, shown as "UP +x%". When `rising` is empty, show "—" with the label "NO RISERS". |
| Cone chart | for each domain, the sum of `evidence.hf_upvotes ?? 0` over `[hero, ...standard, ...compact]` cards, plus a "Rising" cone. Titled "ATTENTION THIS WEEK · HF UPVOTES". |
| Sources line | `sourceHealth.length===0 ? "ALL NORMAL" : "${n} DEGRADED"` |

```
/ask   (max-w-6xl)
nav
┌ threads: glass-base 220px ┐ ┌ answer column ───────────────────────────────────────────┐
│ micro THREADS             │ │ [user bubble: plate-hover, right-aligned]                  │
│ + New question (chip)     │ │ ┌ answer: plate ─────────────────────────────────────────┐ │
│ plate rows (no glass rows)│ │ │ [INTENT chip] [CONFIDENCE ● HIGH chip / destructive]   │ │
│ aria-label="Threads"      │ │ │ Thin evidence: … (bg-destructive/10, 4.80:1) if low    │ │
└───────────────────────────┘ │ │ coverage line (micro) · md tables/bullets · [p3] cites │ │
                              │ │ [Copy as client note] [Export .md] [Save to log] status│ │
                              │ └────────────────────────────────────────────────────────┘ │
                              │ ┌ composer: glass-base, sticky bottom-4 ──────────────────┐ │
                              │ │ textarea (plate-solid, border-input)            [Ask ↵] │ │
                              │ └──────────────────────────────────────────────────────────┘ │
Empty state: 6 job prompts as glass-chip glass-interactive buttons in a 2×3 grid.

/search
nav
┌ facets: glass-base 15rem ┐  SORT [Relevance|Newest|Attention] (glass-chip seg, aria-current)  128 RESULTS (num)
│ q · domain · since/until │  ┌ results: ONE plate container ─────────────────────────────┐
│ source · rung · verdict  │  │ CompactRow (scored) / ResultRow, divide-y divide-border     │
│ action · code · client   │  │ …                                                           │
│ [Save] [Clear] presets   │  └─────────────────────────────────────────────────────────────┘
└──────────────────────────┘

/paper/[id]   (max-w-5xl)
nav
micro: PAPER · arXiv id         [CODE rung pill] [RISING pill]
TITLE (font-display 36px; last word in --signal-2)
[Abstract] [HTML] [PDF]   PaperActions (glass-chip glass-interactive)
┌ plate SpecTable ───────────────┐ ┌ plate ConeChart: HF UPVOTES BY SNAPSHOT ──────────┐
│ AUTHORS   …                    │ │  ▲ ▲  ▲   ▲    ▲ (≤12 latest signals rows, asc)   │
│ RUNG      [###-] MODEL         │ │ 09-01 09-08 …                                      │
│ HF · STARS · MODELS/SPACES     │ └────────────────────────────────────────────────────┘
│ VENUE · FIRST SEEN             │
└────────────────────────────────┘
## Abstract (plate)   ## Per-domain verdicts (plates, verdict text COLORS_UI)
## Signals history (plate table, tabular-nums)   ## Brief appearances   ## Nearest neighbours

/log
nav
NOTABLE LOG (display)   filter row: glass-chip pills (action, domain, client, from/to) [Clear] [CSV ↓]
┌ ONE plate table, tabular-nums ──────────────────────────────────────────────┐
│ PAPER/DOMAINS │ ACTION (badge) via origin │ EVIDENCE │ NOTE + client tag │ DATE │
└──────────────────────────────────────────────────────────────────────────────┘

/settings/*
nav
SETTINGS  ( Domains · Sources · Delivery · Security · Usage )  plate capsule seg, aria-current
domains/sources/delivery/security: plate cards (shadcn Card → plate via tokens), switches teal
usage: [StatTile cost this week][StatTile cost this month][StatTile DB storage]
       plate ConeChart "LLM COST THIS WEEK BY STAGE" (from existing `costs` rows)
       plate tables (cost by stage, run history), Models form

/login                         (no nav)
             ┌ glass-elevated card 24rem, centred over a dim static SignalHelix (no canvas) ┐
             │ RESEARCH SIGNAL (two-tone)  micro: ENTER PIN                                 │
             │ [ ][ ][ ][ ][ ][ ]  plate cells 48×56, radius 10, border-input 1.5px        │
             │ role=alert error (text-destructive)                    [ Unlock ] primary  │
             └──────────────────────────────────────────────────────────────────────────────┘
/a/[token]: the same centred card (no nav). It shows the title and the recorded action, plus the invalid/expired state.
```

Backdrop-filter layers at rest on each page: brief has 3 (nav, hero shell, chip bar). Ask has 3 (nav, threads, composer). Search has 2. Paper, log and settings have 1 each. Login has 1. A transient dialog adds 1, so no page goes above 4.

---

## 6. Hero visual: the signal helix

**Tech choice.** `[D]`
- Server-rendered inline SVG, under 8KB, is the baseline and the LCP-safe frame.
- An optional `<canvas>` particle layer is added as progressive enhancement, in under 4KB gzipped of client JS.
- There is no WebGL, no three.js and no liquid-glass library.

Judges 1 and 2 grafted A's particles. Judge 3 asked for a static baseline. This design does both.

**Geometry** (`viewBox 0 0 600 420`, the `SignalHelix.tsx` server component)
- **Rung bands on the y-axis, from top to bottom:** PEER at y 40–120, MODEL at 120–200, CODE at 200–280 and LAB at 280–360. Each band has a `micro` label at x=8, as SVG `<text>` in `--text-muted`.
- **Two strands.** Strand A is `x(y) = 170 + 70·sin(2π·y/210)` and strand B uses phase +π. Each is drawn as a path with `stroke-dasharray="0 7" stroke-linecap="round" stroke-width="3"`. The round caps turn into dots, so even the static frame reads as particles. Strand A uses `--signal` and strand B uses `--signal-2`.
- **Base pairs.** One line every 14px between the strands, in `--rule` at α .35.
- **Nodes.** One per top-3 card (`selection.top3`, in rank order).
  - `y = bandCenter(card.rung) + (rankWithinSameRung × 18)`, so 3 papers on the same rung don't overlap.
  - `x` = strand A's x at that y.
  - Each node is an `r=6` circle filled with `--signal`, with `filter: drop-shadow(0 0 6px rgb(63 224 208/.6))`. The glow is removed under reduced transparency because `--glow-signal` is `none` there.
  - A leader line runs from the node to x=300 (1px, `--signal` at α .6).

**Callouts: real links, as DOM siblings of the `aria-hidden` art**

```tsx
<div className="relative">                         {/* positioning box, aspect 600/420 */}
  <svg aria-hidden … />                            {/* strands, nodes, leaders */}
  <HelixParticles … />                             {/* canvas, aria-hidden, absolutely positioned */}
  <ol className="absolute inset-0" aria-label="Top 3 on the evidence ladder">
    <li style={{ top: `${(calloutY/420)*100}%`, left: "50%" }} className="absolute -translate-y-1/2 w-[46%]">
      <a href={`#card-${cardId}`} data-helix-target={cardId}
         className="plate glass-interactive block p-2.5 text-xs data-[linked]:border-signal">
        <span className="micro">#1 · {domainName}</span>
        <span style={{ color: COLORS_UI.verdict[v] }} className="font-mono font-bold">{VERDICT_LABEL[v]}</span>
        <span className="line-clamp-1 text-foreground">{headline ?? title}</span>
        <span className="font-mono text-muted-foreground">{meterText(rung)} · {signalType}{rising ? ` · UP ${pct}` : ""}</span>
      </a>
    </li>
  </ol>
</div>
```

- **Callouts never carry `data-card`.** Otherwise j/k would land on them. `[R]` useCardKeys.ts queries every `[data-card]`.
- **Callouts sit on plates.** Verdict text lands on plate-over-particle, which measures at least 6.47:1. On bare glass-nav it would measure 3.92:1 and fail.
- **Collisions.** If two callouts would be closer than 64px vertically, push the later one down by 64px. The leader line still starts from the real node.
- **Mobile (<lg).** The SVG keeps 100% width with `aspect-ratio 600/420`, and the `<ol>` becomes a static list under the art with `position: static`. The leader lines are hidden.
- **Click behaviour.** Handled by `BriefShell` (§4.3): a smooth scroll to the card, then `focus()`. The 150ms `data-linked` rim brighten applies in both directions.

**Particles** (`HelixParticles.tsx`, client)
- It mounts only after `requestIdleCallback`, with a `setTimeout(…, 200)` fallback.
- It does **not** mount when any of these match: `prefers-reduced-motion: reduce`, `prefers-reduced-transparency: reduce`, or `data-glass="off"`. In those cases the static SVG frame is the final render.
- The canvas matches the SVG box. Its DPR is `Math.min(devicePixelRatio, 1.5)`.
- It draws 160 particles distributed over both strands. Each particle moves **upward along its strand** (LAB → PEER) at 0.05 of a period per second, with depth alpha `0.35 + 0.65·(1+cos φ)/2`. The strand geometry is static, so the nodes stay pinned.
- Frame cap is 30fps (skip a frame if less than 33ms has passed) and drawing must stay under 2ms per frame. Glow comes from one `shadowBlur=6` pass on front particles only.
- It pauses through `document.visibilitychange` (when hidden) and an `IntersectionObserver` (`threshold: 0`), cancelling the `requestAnimationFrame`.
- Fade-in is 600ms of `opacity`. `will-change: opacity` is set only during the fade and removed on `transitionend`.
- The canvas is `aria-hidden`, has `pointer-events: none` and sits behind the callout `<ol>`.

**Login variant.** Use the same `SignalHelix` with `top3=[]`, so there are no nodes, at α .35 behind the card and without the canvas.

---

## 7. Accessibility checklist (contrast = WCAG 2.x, flattened worst case from §2.1)

| Foreground | Glass-base `#0F383C` | Glass-nav `#114042` | Glass-elev `#0D2F34` | Plate worst `#102A2D` | Plate-hover `#12272C` | Need |
|---|---|---|---|---|---|---|
| text `#E6F4F3` | 11.26 | 10.13 | 12.62 | 13.37 | 13.75 | 4.5 |
| text-muted `#9DB8BC` | 6.07 | 5.46 | 6.80 | 7.20 | 7.41 | 4.5 |
| micro `#7FD9DD` | 7.80 | 7.01 | 8.74 | 9.25 | 9.52 | 4.5 |
| signal `#3FE0D0` | 7.74 | 6.96 | 8.68 | 9.19 | 9.45 | 4.5 |
| signal-2 `#3FB8BD` (display "SIGNAL") | 5.33 | **not used** | 5.97 | 6.33 | 6.51 | 3.0 (large) |
| CLIENT `#FF8A50` | 5.45 | not used | 6.11 | **6.47** | 6.66 | 4.5 |
| READ `#56B4E9` | 5.51 | not used | 6.18 | **6.54** | 6.73 | 4.5 |
| SKIP `#A7AEB8` | 5.69 | not used | 6.37 | **6.75** | 6.94 | 4.5 |
| rising `#3DDC97` | 7.20 | not used | 8.07 | **8.54** | 8.79 | 4.5 |
| focus ring `#7FDBFF` | 8.16 | 7.34 | 9.15 | 9.69 | 9.97 | 3.0 |
| rule `#4FA3A8` | 4.32 | — | 4.84 | 5.13 | 5.28 | 3.0 |
| chip-border / input `#5E9EA3` | 4.18 | 3.76 | 4.68 | 4.96 | 5.10 | 3.0 |
| destructive `#FF6B6B` on `destructive/10` over plate | — | — | — | 4.80 | — | 4.5 |

Further figures:
- Primary button: `#03201D` on `#3FE0D0` measures 10.41.
- The solid fallback `#0F2227` measures 14.55 for text, 7.83 for muted, 7.12 for READ and 7.04 for CLIENT.
- Before this change, READ `#0072B2` measured 2.99 and CLIENT `#D55E00` 4.02 on plate-hover. Both fail.
- The verdict bars (3:1 non-text) measure CLIENT 6.47, READ 6.54 and SKIP 6.75 on the worst plate.
- `--glass-rim` (1.74:1) and `--plate-rim` are **decorative only**. Every meaningful boundary (inputs, signal chips, PIN cells) uses `#5E9EA3`.

Checklist:
- [ ] **Verdict text renders only on plates or on glass-elevated, never on glass-nav.** `[D]` This gives a ≥ 6.1:1 margin. Bars stay `aria-hidden` and labels stay text. `[R]` docs/brief.md:23.
- [ ] `--text-muted` is allowed on any surface (it measures at least 5.46). `--signal-2` is display text only, at 24px or larger.
- [ ] Focus is a solid 3px `#7FDBFF` outline with a 2px offset on every focusable element, including `[data-card]`, callouts, chips and the nav. A glow is never the only indicator.
- [ ] Every attribute and role from the inventory survives:
  - `data-card`, `tabIndex=0`, `data-action`, `data-search-input`, `details[data-expand]`, `aria-pressed`
  - `aria-current`, `aria-selected`, `aria-invalid`, `role=status/alert/dialog/tab/group`
  - every existing `aria-label`
- [ ] The ✓ prefix, the "UP x%" text, the "Thin evidence" sentence plus the destructive badge, and the footer legend sentence stay word for word.
- [ ] Signal-chip `border-style` semantics: BENCH solid, EVAL dashed, REFRAME dotted, METHOD double at 3px. No glass utility touches `border-style`.
- [ ] Evidence meter: reached cells are filled and unreached cells are dashed. The `[##--] CODE` text and the `title` stay.
- [ ] Helix: the art is `aria-hidden`, the callouts are `<a>` links in an `<ol aria-label>`, and the same data is in the Top-3 strip as text. The cone chart is `aria-hidden` and has an `sr-only` table.
- [ ] `tabular-nums` on: AttentionLine counts, stat tiles, every table cell (via `ui/table.tsx` and the global `td, th` rule), the paper signals table, log dates, and usage figures.
- [ ] `scroll-mt-32` on domain sections, `#rising` and `[data-card]`, so that j/k and the chip anchors never land under the sticky nav and bar.
- [ ] Reduced motion:
  - no particles, so the static SVG is the final render
  - no specular, press scale or smooth scroll
  - `tw-animate-css` dialog animations are kept at 100ms opacity only
- [ ] Reduced transparency, `data-glass="off"` and `prefers-contrast: more` all give solid glass, solid plates and no glow. More-contrast also gives 2px rims. `forced-colors` gives `CanvasText` borders and a `CanvasText` verdict bar via `forced-color-adjust: none`.
- [ ] The "Solid panels" toggle is in the nav. It has `aria-pressed`, persists through `localStorage` in try/catch, and the page renders correctly when storage throws.
- [ ] The help modal is portalled to `body`. Esc and click-outside behave as before.
- [ ] `print:hidden` is on the nav, the search pill and the CommandBar trigger (`[R]` CommandBar.tsx:101 used `print:hidden`).

---

## 8. Performance budget

| Metric | Budget |
|---|---|
| Simultaneous `backdrop-filter` elements in the viewport | **≤ 4** (3 at rest on /brief and /ask, plus 1 transient). Measured with the snippet in §9 T3. |
| Blur radius | ≤ 16px on large surfaces (shell, rails, bar); 14px on the nav; 24px only on glass-elevated (transient, ≤ 40rem wide). **Blur is never animated.** |
| Refraction | 1 SVG filter, only on the nav, only in Chromium |
| Animated properties | `opacity` and `transform` only. The page glow is static. |
| Helix | SVG ≤ 8KB inline; particles JS ≤ 4KB gz; ≤ 2ms per frame at 30fps; DPR ≤ 1.5; paused when hidden or off-screen; `will-change` only during the 600ms fade |
| New client JS in total | ≤ 8KB gz (GlassNav, GlassRuntime, HelixParticles, BriefShell sync). No new npm dependencies. |
| Fonts | 3 families, latin subset, `display: swap`, ~90KB woff2 (an estimate; measure in T3). `next/font` fallback metrics keep CLS low. |
| CSS | The utilities add ≤ 3KB |
| LCP (/brief, `next build && next start`, Lighthouse desktop) | ≤ 2.0s, and no worse than `main` + 10% under Lighthouse mobile. The LCP element must be server-rendered text (h1) or the SVG, never the canvas. |
| CLS | ≤ 0.02 |
| INP (j/k on /brief with 60 cards) | ≤ 100ms |
| Scroll | 60fps in a Chrome performance trace while scrolling /brief with 40 or more cards. No long frames are caused by `backdrop-filter` repaint. |

---

## 9. Implementation tasks (parallel agents, disjoint files)

Shared rules for every task:
- Work in `/Users/sathish/ws/research-signal-ui` (branch `ui-liquid-glass`).
- Never touch `src/lib/brief/email.ts`, `src/app/api/**`, `src/lib/pipeline/**`, `src/lib/**/load*.ts`, DB schema or migrations.
- Every file ends with a newline.
- Follow the existing conventions: shadcn `cn()`, server components by default, `"use client"` only where it is listed.
- No JIRA ids in code.

**Common verify (V0), run after every task:**

```bash
cd /Users/sathish/ws/research-signal-ui
npx tsc --noEmit && npm run lint && npm run build
git diff main --stat -- src/lib/brief/email.ts src/app/api src/lib/pipeline   # must print nothing
for h in data-card data-action data-search-input data-expand aria-pressed; do
  echo "$h main=$(git grep -c "$h" main -- src | awk -F: '{s+=$NF}END{print s+0}') wt=$(grep -rc "$h" src | awk -F: '{s+=$NF}END{print s+0}')"
done   # wt must be >= main for each hook (new code may add uses, e.g. the nav toggle's aria-pressed
       # or BriefShell's closest("[data-card]")). A drop below main means a hook was removed: restore it, never delete new code to match.
```

### Wave 0 (T0a and T0b run in parallel)

**T0a. Tokens, utilities and the root shell.** Files:
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/lib/brief/cues.ts` (additive `COLORS_UI` only)

Implement §2.2, §3, §3.1, the font part of §4.1, and the metadata.

Verify:
- V0 passes.
- `grep -n "font-sans: var(--font-sans)" src/app/globals.css` returns nothing.
- `grep -n "Create Next App" src/app/layout.tsx` returns nothing.
- `git diff main -- src/lib/brief/cues.ts` shows only added lines.
- In Chrome, `getComputedStyle(document.documentElement).getPropertyValue('--signal')` returns `#3FE0D0`.
- `--glass-radius` and `--glass-ease` read non-empty on `<html>`, and a test element with `class="rounded-tile"` computes `border-radius: 10px`.
- After `localStorage.setItem('rs-glass','off')` and a reload, `<html>` has `data-glass="off"`.

**T0b. shadcn primitives.** Files: `src/components/ui/{dialog,command,sonner,button,badge,input,textarea,select,table,tooltip,switch}.tsx`.

Implement the §4.2 table. Use only utility names defined in §3 (`glass-elevated`, `glass-chip`, `glass-interactive`, `plate`). They resolve once T0a lands, and both tasks merge before V0 runs.

Verify:
- V0 passes.
- `grep -n "backdrop-blur" src/components/ui/dialog.tsx` returns nothing.
- `grep -n 'theme="dark"' src/components/ui/sonner.tsx` matches.

### Wave 1 (after Wave 0; T1a, T1b and T1c run in parallel)

**T1a. Nav and command shell.** Files:
- `src/components/glass/GlassNav.tsx` (new)
- `src/components/glass/GlassRuntime.tsx` (new)
- `src/components/CommandBar.tsx`
- `src/app/layout.tsx` (mount lines only)

Implement §4.1.

Verify:
- V0 passes.
- On `/brief/…`, the nav is sticky and `aria-current="page"` is on Brief.
- Clicking the nav pill, pressing ⌘K, and pressing `/` on `/search` all open the CommandBar.
- Tab switches modes.
- The nav is not rendered on `/login` or `/a/x`.
- `document.querySelectorAll('.fixed.right-4.bottom-4').length === 0`.
- In Chrome, `html[data-refract]` is present and the nav's computed `backdrop-filter` starts with `url(`.
- In Safari, the nav's computed `backdrop-filter` has no `url(`.

**T1b. Viz primitives.** Files: `src/components/viz/{StatTile,SpecTable,ConeChart}.tsx` (new).

Implement §4.4.

Verify:
- V0 passes.
- A throwaway render (with no route committed) shows that `ConeChart` with `data=[{label:"a",value:0,display:"0"}]` renders "No data yet."
- The SVG has `aria-hidden` and the `sr-only` table has one row per datum.

**T1c. Signal helix.** Files: `src/components/brief/helix/{SignalHelix,HelixParticles}.tsx` (new).

Implement §6, including the collision rule and the mobile list.

Verify:
- V0 passes.
- With reduced motion emulated in DevTools Rendering, no `<canvas>` is in the DOM.
- With the tab hidden, no rAF callbacks fire (Performance panel).
- A Performance trace on a 4× CPU throttle shows ≤ 2ms scripting per frame.
- `document.querySelectorAll('[data-helix-target][data-card]').length === 0`.

### Wave 2 (after Wave 1; all tasks run in parallel, with disjoint files)

**T2a. Card anatomy.** Files:
- `src/components/brief/{CardParts,VerdictBar,SignalChip,EvidenceMeter,CardActions,HeroCard,StandardCard,CompactRow}.tsx`

Implement the card part of §4.3.

Verify:
- V0 passes.
- Pressing j/k/r/c/s/Enter on `/brief/<latest>` behaves exactly as on `main`.
- The ✓ prefix appears on the pressed action.
- The focused card has a visible `#7FDBFF` outline.
- Emulate `forced-colors: active` and confirm the verdict bar is visible.
- Each signal chip's computed `border-style` is solid, dashed, dotted or double as listed.

**T2b. Brief composition.** Files:
- `src/app/brief/[isoWeek]/page.tsx`
- `src/components/brief/{BriefShell,DomainChipsBar,DomainSection,Top3Strip,SourceHealthFooter,useCardKeys}.tsx|ts`
- `src/components/brief/BriefHero.tsx` (new)

Implement the composition part of §4.3 and §5 /brief.

Verify:
- V0 passes.
- Clicking a helix callout scrolls to the matching card and focuses it, and `j` then moves to the next card.
- Hovering a callout adds `data-linked` to the card, and hovering the card adds it to the callout.
- A chip anchor jump leaves the section heading fully visible under the sticky bar.
- `?` opens the portalled modal and Esc closes it.
- The footer legend text is identical to `main`.
- Run the §9 T3 backdrop counter at the top of the page and after scrolling. It returns ≤ 3.

**T2c. Ask.** Files: `src/app/ask/page.tsx`, `src/components/ask/AskPanel.tsx`.

Implement §4.5 and §5 /ask.

Verify:
- V0 passes.
- Enter sends and Shift+Enter adds a newline.
- A low-confidence answer shows both the destructive badge and the "Thin evidence" sentence.
- `[pN]` links go to `/paper/…`.
- `role=status` and `role=alert` are still present.
- The backdrop count is ≤ 3.

**T2d. Search.** Files: `src/app/search/page.tsx`, `src/app/search/result-row.tsx`.

Implement §5 /search. Use **one** plate container with divided rows, and put no glass on rows.

Verify:
- V0 passes.
- The facet form submits the same query params as `main` (compare URLs).
- The sort nav keeps `aria-current`.

**T2e. Paper.** Files: `src/app/paper/[id]/page.tsx`, `src/app/paper/[id]/PaperActions.tsx`.

Implement §5 /paper. The ConeChart data is the existing `signals` rows (paper/[id]/page.tsx:40, ordered `desc(capturedAt)`), reversed and sliced to the last 12, plotting `hfUpvotes ?? 0`. The SpecTable is filled from the same query results. No new queries.

Verify:
- V0 passes.
- The signals table cells compute `font-variant-numeric: tabular-nums`.
- `git diff main -- 'src/app/paper/[id]/page.tsx' | grep -E "db\.|select\(|from\("` shows no added query lines.

**T2f. Log.** Files: `src/app/log/page.tsx`, `src/app/log/note-editor.tsx`.

Implement §5 /log.

Verify:
- V0 passes.
- The CSV export link is unchanged.
- The inline note editor saves.
- The date cells are tabular.

**T2g. Settings.** Files: `src/app/settings/**` (`layout.tsx`, `settings-nav.tsx`, and the `domains`, `sources`, `delivery`, `security` and `usage` subfolders, excluding the `actions.ts` files).

Implement §5 /settings:
- The usage page gets StatTiles plus a ConeChart that reads the existing `costs` rows (`stage` → `week`).

Verify:
- V0 passes.
- `git diff main -- 'src/app/settings/**/actions.ts'` is empty.
- The domain add/edit Dialog opens as glass-elevated with no overlay blur.
- The API key inputs keep their `aria-label`.

**T2h. Login, action landing and root.** Files:
- `src/app/login/page.tsx`
- `src/app/a/[token]/{page,record}.tsx`
- `src/app/page.tsx` ("No brief yet" state only)

Implement §5 /login and /a.

Verify:
- V0 passes.
- The arrow and backspace movement between digits is unchanged.
- `aria-invalid` and `role=alert` appear on a wrong PIN.
- There is no nav and no CommandBar trigger on these routes.

### Wave 3 (single agent, after Wave 2)

**T3. Audit gate.** No source files, except fixes sent back to the task that owns the file.
1. In DevTools, run the backdrop counter on every route, at the top of the page and after scrolling, both with and without an open dialog. Every result must be ≤ 4.

```js
[...document.querySelectorAll("*")].filter(e => {
  const s = getComputedStyle(e), r = e.getBoundingClientRect();
  const f = s.backdropFilter || s.webkitBackdropFilter;
  return f && f !== "none" && r.bottom > 0 && r.top < innerHeight && r.width > 0;
}).length
```

2. Run Lighthouse (desktop and mobile) on `/brief/<latest>`, `/ask` and `/search`. It must meet the §8 LCP, CLS and INP budgets, with no accessibility regressions against `main`.
3. Take a Chrome performance trace while scrolling /brief with 40 or more cards. It must hold 60fps.
4. In DevTools Rendering, emulate each of the following and screenshot /brief: `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast: more` and `forced-colors`. Then toggle "Solid panels" and screenshot again. Confirm the text stays legible and the verdict bar and labels stay visible.
5. Open /brief in Safari (or WebKit through Playwright). Frost must render, the nav must not refract, and nothing may be blank.
6. Re-run `docs/design/contrast.py` against any token that changed during implementation. Every pair in §7 must still meet its "Need" column.

---

## 10. Explicit non-goals

- **The HTML email is unchanged.** `src/lib/brief/email.ts` and the `COLORS` export keep their Okabe-Ito values. Only `COLORS_UI` is added.
- **No data or logic changes.** That means:
  - no new or changed DB queries, schema, migrations or loaders
  - no changes to ranking or the pipeline
  - no `actions.ts` server-action changes
  - no changes to the prose or selection shape

  Every number on screen is derived from fields that are already loaded.
- **No new API routes.** Nothing changes under `src/app/api/**`. The CommandBar still calls `/api/search`, and the action buttons still POST to `/api/actions`.
- **No new npm dependencies.** That rules out `liquid-glass-react`, `liquidGL`, glasscn, three.js and chart libraries.
- **No light theme and no theme switcher.** The only switch is "Solid panels".
- **No charts that would need data the app does not already load:**
  - source items per day in the footer
  - an 8-week history of per-domain attention
  - a weekly LLM-cost time series

  These are deferred until those queries exist.
- **No Ask dock on /brief.** The nav pill and ⌘K cover it, and it would use the 4th blur slot.
- **No Fraunces or other serif.** The design stays at 3 font families.
- **No animated page background.** The glow stays static.
- **No changes to the keyboard model, ARIA semantics, routes or the `/`, ⌘K and Tab behaviour.** The only behaviour change is that j/k scrolling becomes smooth, and it falls back to `auto` under reduced motion.

---

**Haiku Validation:** I affirm that this spec can be executed by Haiku. Specifically:
- Every task lists its exact files, the tokens and class strings to use, which data fields to bind and from which file, and runnable verification commands.
- No step requires picking a design value, because each value is given as a hex code, px value or alpha above.
- The tasks within each wave touch disjoint files.
