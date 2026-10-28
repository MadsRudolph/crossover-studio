# Crossover Studio — look and feel

The design brief ([DESIGN.md](DESIGN.md)) says what the app is. This page says how it should *feel* as it grows
past sixteen views, a hint strip, a chat panel and an autopilot: calm, roomy and clear, and still a precision
instrument. Every UI change follows it; the per-view list at the end is the work still to do.

## What made it feel crammed (audit, October 2026)

Screenshots of every view at 1100×700, 1440×900 and 1920×1080, both themes.

1. **Five bands of chrome at once.** Title bar (48 px) + tab bar (40) + dock (35–220) + status bar (32) frame
   the view, and the 320 px inspector takes 29 % of a 1100 px window. At 1100×700 the Response view had about
   90 px per plot; with the new hint strip, about 60.
2. **The inspector was one long scroll.** All five steps open by default (about 2 600 px of controls), so the
   step you are on was never on screen with its neighbours, and the column read as a wall of sliders.
3. **The system name three times.** Title-bar profile switcher, inspector header (name + three driver rows,
   ~100 px) and the status bar all said "System D · Group 10".
4. **Boxes inside boxes.** The workspace pane, a card with a border *and* a shadow, a read-out tile with its own
   border inside the strip, a well inside the card. Every number sat in two or three frames.
5. **Everything shouted in small caps.** Tabs, view titles, card titles, plot titles, read-out labels, section
   titles and badges were all letter-spaced upper case of nearly the same size: no visible hierarchy between "this
   is the view" and "this is a label".
6. **No spacing scale.** Paddings of 2, 5, 6, 9, 10, 12, 14 and 16 px side by side (the view frame was 14/16/12,
   the System view 10/12, cards 12/14, the inspector 14), so neighbouring surfaces never lined up.
7. **Long ledes.** Every view opened with a 2–3 line paragraph at 110 ch, pushing the plots down by 60–70 px
   on every visit, long after the student had read it once.
8. **A crowded tab bar.** Sixteen upper-case tabs with icons, overflowing at 1440 px and icon-only at 1100 px.
9. **Status-bar noise.** Seven chips each with a glowing green dot; the passing checks were as loud as the
   failing one.
10. **A dock that costs more than it gives on small windows.** 160–220 px for the signal chain, whose one-line
    hint repeated in every view; on 900 px tall windows it took a quarter of the workspace.

## Principles

1. **One primary thing per screen.** Each view has one hero (a plot, the 3D stage, the score) that gets the
   space; everything else is a side column or a strip, visibly secondary.
2. **Progressive disclosure, never deletion.** Information that is not needed every time moves behind one
   click (a folded lede, a folded step, a "More" row, a tooltip), and the choice is remembered.
3. **Space groups, lines separate.** Use the spacing scale to group; use a hairline only where two different
   things meet. One frame per thing: cards do not nest, read-outs are not boxed.
4. **Three levels of type, and only three.** Title (Barlow 600, 18 px, sentence case), label (Barlow Semi
   Condensed caps, 11 px, `--text-3`), body/number (13 px Barlow / JetBrains Mono). Lead numbers 18 px mono.
5. **Quiet when fine, loud when not.** Passing states are muted; colour is spent on warnings, problems, the
   drivers and the accent.
6. **Generous plots.** Plots take whatever is left; chrome yields first (dock folds, ledes fold, the inspector
   becomes a rail), plots last.
7. **The same rhythm everywhere.** Every view, card and panel uses the same paddings and gaps from the tokens,
   so edges line up across the app.

## Tokens (in `src/ui/tokens.css`)

Spacing, a 4 px scale: `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 20 · `--sp-6` 24 ·
`--sp-7` 32 · `--sp-8` 40.

Rhythm: `--pad-view` (20/24/20: the padding of a view), `--pad-view-x` (24), `--gap-view` (16, between the
blocks of a view), `--pad-card` (16), `--gap-card` (12, title to content), `--measure` (84 ch, the widest
prose line). Small windows (≤ 1280 px wide or ≤ 760 px tall) step the view padding and gap down one notch.

Chrome sizes: `--titlebar-h` 48, `--tabbar-h` 44, `--statusbar-h` 30, `--dock-head-h` 34, `--insp-w` 320,
`--rail-w` 56, `--side-w` 300 (a view's side column), `--ctl-h` 28 / `--ctl-h-sm` 24 (control heights).

Type: the existing `--fs-11 … --fs-32` plus `--fs-14` and `--fs-20`; line heights `--lh-tight` 1.2,
`--lh` 1.45, `--lh-loose` 1.6.

Surfaces and lines: `--surface-card` (a card on the workspace: `--surface-1`, no shadow), `--line-soft` (a
divider inside a surface, quieter than `--line`). `--line` stays for edges between different things.

## Typography

| Level | Face | Size | Case | Colour | Used for |
|---|---|---|---|---|---|
| View title | Barlow 600 | 18 | Sentence | `--text` | `ViewHeader` title, dialog titles |
| Lead number | JetBrains Mono 400 | 18–32 | — | `--text` / state | read-outs, the probe, the score |
| Label | Barlow Semi Condensed 600 | 11 | CAPS .1em | `--text-3` | card, plot and read-out labels, tabs, step titles |
| Body | Barlow 400 | 13 | Sentence | `--text-2` | ledes, explanations |
| Number | JetBrains Mono 400 | 12–13 | — | `--text` | values, ticks, tables |
| Hint | Barlow 400 | 11–12 | Sentence | `--text-3` | captions, footnotes |

Small caps are for *labels*, never for something you read as a sentence or a title.

## How the panels share the window

```
┌ title bar 48: brand · system / design · ─── · history · snapshot · Optimise · Export · ⌘K · chat · ⚙ ┐
├ inspector 320 (or rail 56) ┬ tab bar 44: Guide │ Design ▸ │ Analyse ▸ │ Build & test ▸ · view tools ┤
│ one step open at a time     │ view: title + folded lede · hint strip (1 row) · hero · side column    │
│                             ├ dock 34 (folded on windows < 1000 px tall) ─────────────────────────────┤
├ status bar 30: score · check chips (quiet when passing) · probe · engine time ──────────────────────────┤
```

- **Inspector.** One step open at a time by default (`useInspectorChrome().mode`, toggle in its header, "Open
  all steps" for those who want the long column). The header is one row: the system name and its three driver
  dots; the driver names and profile notes fold out under it. Below 140 px wide it draws an **icon rail** (the
  five step numbers with their status dots); the shell lets the column collapse to `--rail-w` and registers
  `useInspectorChrome().setExpand` so a rail click widens it again.
- **Dock.** Folded to its 34 px header on windows under 1000 px tall (today 850) and by default on first run
  below 1440×1000; the user's own choice always wins. The how-to hint only shows while it is open.
- **Chat.** An overlay drawer from the right (380–440 px, `--shadow-2`, over the workspace, not beside it) on
  windows under 1600 px wide; a resizable docked column at 1600 px and up. It never squeezes the inspector.
- **Focus mode (`F`, and a title-bar toggle).** Hides the inspector, dock and status bar, leaving title bar,
  tabs and the view; Escape or F again restores them. For reading a plot or showing the design to someone.
- **Status bar.** Only what is about the *design* and the probe: score, check chips, probe, engine time
  (quiet). The profile name lives in the title bar and the inspector.

## Patterns every view uses

- **Frame:** `.vw-view` (padding `--pad-view`, gap `--gap-view`), then `ViewHeader`, then at most one strip,
  then the hero. No view sets its own outer padding.
- **Header:** `ViewHeader` — sentence-case title, a lede folded to two lines with **More** (one remembered
  choice for every view), the view's own tools at the right (at most three; more go in a `Menu`).
- **Hint strip:** one row, the most important hint only; further hints behind "+N more" (folded, remembered).
- **Read-outs:** `Readout` in a `.vw-strip`: a label over an 18 px number, parted by hairlines, no boxes; a
  state colours the line and the number.
- **Cards:** `Card` (title, optional `sub`, actions). `--surface-card`, `--line-soft` border, no shadow,
  padding `--pad-card`. Never a card in a card: use space or `.vw-rule`.
- **Side column:** `--side-w` (300 px), cards stacked with `--sp-3`, scrolls on its own.
- **Plots:** fill the rest; plot titles are labels; legends sit in the plot title row.
- **Empty states:** `EmptyState`, centred in the hero area, with one primary action.

## Phase 2: per-view changes

Global layers that are wired in shell files:

- **App.tsx:** inspector panel `collapsible` to `--rail-w` (register `setExpand`), dock auto-fold below
  1000 px tall, chat as overlay drawer below 1600 px, focus mode (`F`) hiding inspector, dock and status bar.
- **Tab bar (Tabs.tsx, Workspace.tsx):** tabs in sentence case 13 px (labels stay caps only for the group
  names), the active group expanded and the others as a labelled menu button ("Analyse ▾") when narrow; height
  `--tabbar-h`; view tools capped at the right with a divider.
- **Title bar:** group into three clusters (identity · history+snapshot · actions); the search box becomes an
  icon with ⌘K below 1440 px; theme and help move into a "⋯" menu with the chat toggle staying visible.
- **Hint strip (insights.css):** one 28 px row, borderless with only the left severity bar, "+N more" folds
  the rest; inherit `--gap-view`.

Views:

- **Guide:** a single centred column (`--measure` wide), steps as a quiet list, the autopilot as the one
  primary button; no cards inside cards.
- **System:** side column to `--side-w`; probe card and checks card merge into one card with a `.vw-rule`;
  quick probe chips on one row; 3D stage loses its border (it is the hero).
- **Verdict:** score card and "Try this" stay; the criteria list and the detail panel share one card, the
  detail as a right-hand column without its own border; the three detail columns become two at ≤ 1280 px.
- **Response / Phase / Impedance / Filters:** read-out strip + plots only; tolerance and power-sum switches
  move to the view header tools as one `Menu` when narrow; plot minimum 160 px.
- **Box:** design-model / validation toggle stays in the header; the side column's three cards become one
  card with rules; the three stacked plots get weights 3/2/2.
- **Directivity, Time, Sensitivity, Limits:** read-out strip, one hero plot, secondary plots in tabs or a
  `Segmented` switch instead of stacked when the view is under 800 px tall.
- **Compare:** snapshot list and metrics in one side card (`--side-w`), diff table rows at 28 px.
- **Listen:** transport, source and "what plays" in one side card with rules; the plot is the hero.
- **As built / Listening test:** step headers use the `Card` `sub` line; the fault list and report pack as
  `.vw-strip` + one card; no nested borders.
- **Sheets (import, export, report pack):** `Sheet` with the dialog paddings; one primary action in the foot;
  sections parted by `.vw-rule`, not boxes.
- **Chat panel:** `--surface-1`, messages at `--measure`, tool calls as one-line chips that fold out.
