# Crossover Studio — design brief

Every UI work package follows this. The shell package implements the tokens in `src/ui/tokens.css`;
everyone else uses only these variable names (never literal colours) so both themes work everywhere.

## Character
A precision instrument for loudspeaker work, not a generic dashboard. Think of a high-end measurement
system's front panel crossed with a modern pro-audio app: dark graphite surfaces, crisp hairlines, data in a
monospace face, colour used for meaning (the three drivers, state) and one warm accent for action.
Dense but calm: every pixel shows signal, nothing decorative. Smooth, physical motion (springy panels,
eased value changes), never bouncy. Must also be easy: a first-time student opens it and understands
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
Radii `--r-sm 4px`, `--r 8px`, `--r-lg 12px`. Shadows `--shadow-1`, `--shadow-2`.
Motion `--ease: cubic-bezier(.2,.8,.2,1)`, `--t-fast 120ms`, `--t 220ms`; respect prefers-reduced-motion.

## Type (bundled with @fontsource, no network at run time)
- UI and labels: **Barlow** (400/500/600), condensed labels **Barlow Semi Condensed** (600/700, uppercase,
  letter-spacing .08–.14em) for panel titles, tabs, small caps labels.
- Numbers, readouts, axis ticks, part values: **JetBrains Mono** (400/500), `font-variant-numeric: tabular-nums`.
- Scale: 11 / 12 / 13 / 15 / 18 / 24 / 32 px. Body 13–14 px (it is a desktop tool).

## Layout (window ≥ 1100×700, scales to 4K)
```
┌ title bar: logo · profile switcher · design name · undo/redo · snapshot · optimise · export · ⌘K · theme ┐
├ inspector (320px, numbered workflow: 1 Box · 2 Digital · 3 Midrange · 4 Tweeter · 5 Check) ┬ workspace ┤
│                                                                          │ view tabs                     │
│                                                                          │ main view (System = 3D + probe│
│                                                                          │ + checks; others = plots)     │
│                                                                          ├ bottom dock: signal chain     │
├ status bar: metrics chips (spread, crossovers, f3, min load) · probe frequency · profile · engine time ┤
```
Panels resizable (drag handles), bottom dock collapsible. Keyboard: ⌘/Ctrl+K palette, Ctrl+Z/Y,
1–9 and 0 switch views (the first ten; later views by tab or palette), S snapshot, O optimise, E export, P focus probe, X x-ray.

## Shared conventions
- Units always shown: Hz/kHz (format via `src/ui/format.ts`), dB, Ω, mH, µF, mm.
- The probe frequency is global (store.probe); every plot shows it as a vertical accent line, clicking a plot sets it.
- Clicking a part (schematic, 3D driver, check item) sets `store.ui.focus` to an id like `"mid.L1"`, `"tw.pad.Rs"`,
  `"digital.fc"`, `"box.L"`; the inspector scrolls to and pulses that control.
- Empty and error states are designed: say what is missing and offer the action (e.g. "Import measurements").
