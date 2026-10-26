# Crossover Studio roadmap

Ranked by value to a 34870 group working through the 2026 project guide (Task 1 box, Task 2 crossover in
LTspice, Task 3 build and anechoic measurement, Task 4 listening test, Task 5 quiz and demo day). It also weighs
what VituixCAD, XSim, REW, SoundEasy and LspCAD offer that this app lacks.

## Where the app stands (26 October 2026)

- **Eleven views:** System 3D, Verdict, Response, Phase, Impedance, Filters, Box, Directivity, Compare, Listen
  and As built.
- The **Verdict** view gives the bundled design 96/100 and offers tested "Try this" suggestions.
- The **Response** view has a Monte Carlo tolerance band.
- There is an **optimiser** and there are **snapshots**.
- **Exports:** MiniDSP text, an LTspice folder (it matches the app to 0.0001 dB), a parts list, `.xstudio` design
  files and the report pack.

**Done in this round**

- **Listen** (#1): the design played through Web Audio.
- **As built** (#2): the measured system against the prediction, plus a fault finder.
- **Report pack** (#3): LaTeX and Markdown report sections, and a sheet of quiz numbers.

**Still missing, compared with the pro tools**

- Nothing in the time domain: no group delay, no step or impulse response.
- No limits for maximum SPL, excursion or power.
- No power response, directivity index or listening window.
- No guided listening test for Task 4.

**Keys and tabs.** Keys 1–9 open the first nine views and 0 opens Listen. As built and any later view are
reached from the tab bar or Ctrl+K. Below about 1440 px of workspace the tabs get tighter. Below about 1160 px
(or 920 px for a view without curve tools) the inactive tabs show only their icons. A later pass should group
the tabs (Design / Analyse / Build) before more views arrive.

## Backlog

| # | Feature | Status | Value for the students | Effort | Depends on |
|---|---|---|---|---|---|
| 1 | **Listen: auralisation** (new view). The design is turned into FIR filters and played through Web Audio. Signals: pink noise, crossover-band noise, a probe tone, a log sweep or the student's own track. Solo or mute each driver, flip polarity live, and A/B current / snapshot / flat with gapless crossfades. | **Done** | High. Students hear what a 3 dB step, a crossover null or an inverted tweeter does before they build, and it prepares Task 4. No course tool does this, and neither does VituixCAD. | M | Results per angle, box model below 50 Hz |
| 2 | **As built: the measured system against the prediction, plus a fault finder** (new view). Import the Task 3 anechoic measurement (0°/30°, optionally per unit). Overlay it on the prediction with the vents plugged, after a fitted level offset. Show the deviation with a ±1.5 dB band. Rank single-fault hypotheses (inverted unit, a part one basket step off, shorted or open part, swapped L-pad resistors, swapped MiniDSP outputs, gain left at 0 dB, wrong f_c) by how well each explains the measurement. | **Done** | Very high. This is the step where real groups lose days ("why is there a 10 dB hole at 3 kHz?"), and quiz part 2 asks for measured against simulated with a discussion. | M | `compute`, `interpLogF`, wizard readers |
| 3 | **Report pack** (export tab). A LaTeX section with booktabs tables and pgfplots figures fed from CSV files, a Markdown version with inline SVG figures, and a quiz-numbers sheet. Figures follow the course's grading rules: no [unit] brackets, a phase panel with every magnitude, dB with a reference. | **Done** | High. It saves hours on the report and quiz parts 1/2, and the numbers stay consistent with the design. | M | `parts.ts`, `assess`, `boxModelCurves`, `fit.ts` |
| 4 | **Time-domain view**: group delay per unit and for the sum, step response and impulse response (VituixCAD, REW). Shares the FIR synthesis with Listen. | Next | Medium-high. It is standard in pro tools, explains why LR4 is not phase-linear, and gives the oral exam a talking point. | M | Move `src/listen/ir.ts` into the engine first |
| 5 | **Limits: maximum SPL, excursion and power** (VituixCAD's Enclosure/Power charts). Uses X_max and P_rated from the data sheet in the profile. Shows the input voltage at which the cone reaches X_max, the vent reaches 17 m/s, or the tweeter's resistors and voice coil get too hot, with the crossover's filtering included. Adds a "how loud can the demo get" readout. | Planned | Medium-high. It matters for demo day in room 019 and protects the tweeter. | M | Box curves; optional `limits.xmax_mm` / `p_rated_w` in the profile |
| 6 | **Guided listening-test kit (Task 4)**. Protocol builder (IEC 60268-13, Bech & Zacharov), randomised blind A/B order with a session sheet, attribute questionnaire on a 1–7 scale (bass extent, voice clarity, harshness, image), results entry, and mean ± CI charts. Each attribute is linked to a frequency region and a control, and the results export to the report. | Planned | Medium-high. The guide says "methodical, not casual", and groups usually improvise this. | M | Works best with #1 and #3 |
| 7 | **Part sensitivity ranking**. For each part, the dB change of the on-axis sum per ±1 basket step and per ±10 % tolerance, as a tornado chart, plus "which part matters most at the crossover". | Next | Medium. It answers the guide's "their values have tolerances, test the effects" and tells the group which part to measure with the LCR meter. | S–M | `compute`, `tolerance` |
| 8 | **Printable build sheet**. One A4 page (HTML to print/PDF): the passive board drawn as the screw board with banana-plug colours, the polarity of each driver lead, the MiniDSP steps with the biquad text, and a pre-measurement checklist (vents plugged, gain, polarity). | Planned | Medium. The lab day goes more smoothly, and fewer build faults reach the As built view. | S–M | `SignalChain` layout, `parts.ts` |
| 9 | **Lock parts and a constrained optimiser**. Pin any value (a part already wired, or no coil of that value left in the basket), cap the number of parts, and limit the basket stock per value (the guide: "at least two components for each value"). | Planned | Medium. It makes the optimiser usable on lab day. | S–M | `optimise.ts` |
| 10 | **Power response, DI and listening window** from the 0°/30° data, plus any extra angles a group measured. A CTA-2034-style spinorama from the angles available, stating that two angles give only an approximation. | Planned | Medium. The off-axis criterion gets a physical meaning, and the directivity lectures connect here. | M | More angles help; Directivity view |
| 11 | **Gated import of single-driver measurements** (REW style): window a raw impulse or a sweep recording, and merge near field and far field with a baffle-step correction. Groups could then take extra measurements outside the Lab E slot. | Later | Medium-low for this course, because the data arrives processed. | L | Wizard |
| 12 | **Demo-day mode**: full-screen 3D plus the live response, a large "why we chose this" panel, and switching between design versions on stage (with the matching MiniDSP text to paste). | Later | Medium-low, but very visible on demo day. | S | System view, design files |
| 13 | **FIR (linear-phase) MiniDSP option and a room-gain preview** (SoundEasy and rePhase style). Shows what an FIR crossover or a room boundary would change, clearly marked as beyond the course hardware. | Later | Low for the course, high "wow". | L | #4 |
| 14 | **Shared group workspace**: design history with comments per version, merging snapshots from several `.xstudio` files, and a part-by-part diff of two designs. | Later | Low-medium. | M | Design files |

**Suggested order:** build 4 (reusing the IR synthesis from Listen) and 7 (the quickest strong win) next,
then 5, 6 and 8.

## Known follow-ups from the October audit

- The Release workflow has never run. Run it once by hand (workflow_dispatch) and install the Windows `.exe`
  and the Linux AppImage. If the Linux build fails at linking, add `libxdo-dev` to the apt-get line.
- The engine's `minidspText` still writes `", "` after the last coefficient (as `fixtures/reference.json`
  expects). The export corrects this. Move the fix into the engine and regenerate the reference.
- The crossing windows of the displayed metrics (limits ×0.6 / ×1.5) and the optimiser penalty (÷1.5 / ×1.5)
  differ slightly. Both are copied from `xover.py`.
- The balance criterion reports 0 dB for an empty band (woofer/mid crossover below about 212 Hz). Mark such a
  band as not judged instead.
- Listen: in the desktop app a track can be chosen but not dropped (Tauri intercepts native drops).
- As built: the desktop `.mat` import has been type-checked but not yet run in Tauri.
- Top and Side camera presets: with software WebGL the contact shadow shows as a dark square. Check this on a
  GPU.

## Sources consulted

- [VituixCAD v2 release thread (HTGuide)](https://www.htguide.com/forum/mission-possible-diy/development-tools-techniques/42827-vituixcad-v2?p=958565)
- [Some VituixCAD tips (Midwest Audio Club)](https://diy.midwestaudio.club/discussion/2643/some-vituixcad-tips)
- [VituixCAD thread (diyAudio)](https://www.diyaudio.com/community/threads/vituixcad.307910/post-8093805)
- The 2026 project guide, tasks 1–5 and appendix 1.
