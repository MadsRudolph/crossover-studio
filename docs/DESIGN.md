# Crossover Studio — design brief

Every UI work package follows this. The shell package implements the tokens in `src/ui/tokens.css`;
everyone else uses only these variable names (never literal colours or ad-hoc pixel paddings) so both themes
and the spacing work everywhere. How the app should *feel* (spacing, hierarchy, how panels share the window,
the card and header patterns) is in [LOOK_AND_FEEL.md](LOOK_AND_FEEL.md); read it before adding UI.

## Character
A precision instrument for loudspeaker work, not a generic dashboard. Think of a high-end measurement
system's front panel crossed with a modern pro-audio app: dark graphite surfaces, crisp hairlines, data in a
monospace face, colour used for meaning (the three drivers, state) and one warm accent for action.
Calm before dense: every pixel shows signal, nothing decorative, and what is not needed every time sits one
click away (a folded step, a folded lede, a "More" row) instead of on screen. Smooth, physical motion
(springy panels, eased value changes), never bouncy. Must also be easy: a first-time student opens it and understands
what to do next, because the left inspector is a numbered workflow and every number has a unit and a hint.

## Tokens (CSS custom properties on :root, dark default; `[data-theme="light"]` overrides)
Surfaces: `--bg` (app background), `--surface-1` (panels), `--surface-2` (raised: cards, popovers),
`--surface-3` (inputs, wells), `--line` (hairlines), `--line-strong`.
Text: `--text`, `--text-2` (secondary), `--text-3` (hints, axis labels).
Accent: `--accent` (warm amber-copper, actions/selection), `--accent-text` (text on accent), `--focus`.
Drivers (fixed meaning everywhere: plots, 3D glow, schematic wires, inspector badges):
`--woof` (blue), `--mid` (amber/orange), `--tw` (green), `--sum` (= `--text`, the sum is always the brightest neutral),
`--ref` (grey, references/snapshots dashed).
State: `--good`, `--warn`, `--bad`. Plot: `--grid`, `--grid-strong`, `--band` (translucent fill).
Quiet lines and cards: `--line-soft` (dividers inside a surface), `--surface-card` (a card: no shadow).
Radii `--r-sm 4px`, `--r 8px`, `--r-lg 12px`. Shadows `--shadow-1` (raised controls), `--shadow-2` (popovers,
drawers, dialogs); cards on the workspace have none.
Spacing (4 px scale): `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 20 · `--sp-6` 24 · `--sp-7` 32 ·
`--sp-8` 40; rhythm `--pad-view`, `--gap-view`, `--pad-card`, `--gap-card`, `--measure` (84 ch prose width).
Chrome sizes: `--titlebar-h`, `--tabbar-h`, `--statusbar-h`, `--dock-head-h`, `--insp-w`, `--rail-w`, `--side-w`,
`--ctl-h`, `--ctl-h-sm`.
Motion `--ease: cubic-bezier(.2,.8,.2,1)`, `--t-fast 120ms`, `--t 220ms`; respect prefers-reduced-motion.

## Type (bundled with @fontsource, no network at run time)
- UI and labels: **Barlow** (400/500/600), condensed labels **Barlow Semi Condensed** (600/700, uppercase,
  letter-spacing .08–.14em) for panel titles, tabs, small caps labels.
- Numbers, readouts, axis ticks, part values: **JetBrains Mono** (400/500), `font-variant-numeric: tabular-nums`.
- Scale: 11 / 12 / 13 / 14 / 15 / 18 / 20 / 24 / 32 px. Body 13 px (it is a desktop tool).
- Three levels only: **view title** (Barlow 600, 18 px, sentence case), **label** (condensed caps 11 px, `--text-3`),
  **body / number** (13 px; lead numbers 18 px mono). Caps are for labels, never for titles or sentences.

## Layout (window ≥ 1100×700, scales to 4K)
```
┌ title bar: logo · profile / design name · undo/redo · snapshot · optimise · export · ⌘K · chat · theme · help ┐
├ inspector (320px, or a 56px rail)  ┬ tab bar: Guide | Design | Analyse | Build & test, view tools at the right┤
│ numbered workflow, one step open:  │ view: title + folded lede · hint strip · hero (plot / 3D / score)        │
│ 1 Box · 2 Digital · 3 Mid · 4 Tw · │       + side column (300px)                                               │
│ 5 Check                            ├ bottom dock: signal chain (folds on short windows)                       │
├ status bar: score · check chips (quiet when passing) · probe frequency · engine time ─────────────────────────┤
```
Panels resizable (drag handles), bottom dock collapsible, inspector one step at a time (toggle "Open all steps")
and an icon rail when the column is narrow, chat as a drawer on smaller windows. Keyboard: ⌘/Ctrl+K palette,
Ctrl+Z/Y, 1–9 and 0 switch views (the first ten; later views by tab or palette), S snapshot, O optimise, E export,
P focus probe, X x-ray, C chat, D design it for me.

## View anatomy (every view)
`.vw-view` frame (padding `--pad-view`, gap `--gap-view`; never its own outer padding) → `ViewHeader` (title,
lede folded to two lines with "More", at most three tools) → at most one hint strip and one read-out strip →
the hero. Read-outs are `Readout` in `.vw-strip` (no boxes, hairlines between). Secondary blocks are `Card`s
(title, optional `sub`, actions) in a side column; cards never nest (use space or `.vw-rule`).

## Shared conventions
- Units always shown: Hz/kHz (format via `src/ui/format.ts`), dB, Ω, mH, µF, mm.
- The probe frequency is global (store.probe); every plot shows it as a vertical accent line, clicking a plot sets it.
- Clicking a part (schematic, 3D driver, check item) sets `store.ui.focus` to an id like `"mid.L1"`, `"tw.pad.Rs"`,
  `"digital.fc"`, `"box.L"`; the inspector scrolls to and pulses that control.
- Empty and error states are designed: say what is missing and offer the action (e.g. "Import measurements").
