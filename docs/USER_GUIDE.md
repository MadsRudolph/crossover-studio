# Crossover Studio user guide

This guide follows the 2026 project guide of 34870 Electroacoustics task by task. It assumes a profile is
open: either the bundled System D example, or your own group's profile (see *Importing your group's
measurements* in the [README](../README.md)).

- [The screen](#the-screen)
- [Task 1: tune the woofer box](#task-1-tune-the-woofer-box)
- [Task 2: design the crossover](#task-2-design-the-crossover)
- [Reading the checks](#reading-the-checks)
- [Comparing designs](#comparing-designs)
- [The optimiser](#the-optimiser)
- [Task 3: build it: MiniDSP and passive board](#task-3-build-it-minidsp-and-passive-board)
- [LTspice for the quiz and the report](#ltspice-for-the-quiz-and-the-report)
- [Task 4: listening test tips](#task-4-listening-test-tips)
- [Sharing designs with your group](#sharing-designs-with-your-group)
- [Keyboard](#keyboard)
- [Troubleshooting](#troubleshooting)

## The screen

| Area | What it is |
|---|---|
| **Inspector** (left) | The design as five numbered steps: 1 Box, 2 Digital, 3 Midrange, 4 Tweeter, 5 Check & export. Work from top to bottom. |
| **Workspace** (centre) | One of eight views, chosen by the tabs or the keys 1–8. |
| **Signal chain** (bottom dock) | The live block diagram from the MiniDSP to the three drivers. Click a part to edit it. |
| **Status bar** | The key numbers as coloured chips, the probe frequency and the engine time. |

**Probe.** One frequency is the *probe*. Every plot marks it with an accent line. The 3D model animates the
cones and the vent air at that frequency, with their real relative amplitude and phase. Click any plot to move
the probe, or press **P** and type a frequency.

**Views**

1. **System:** the loudspeaker in 3D at real size, per-unit levels and phase at the probe, and the checks.
2. **Response:** each unit through its filters and the summed response, on axis and at 30°.
3. **Phase:** the units' phase (delay over the profile's reference distance removed). In the crossover
   regions, the curves of neighbouring units should lie on top of each other.
4. **Impedance:** what amplifier channel 2 sees through the passive board, and each driver's impedance.
5. **Filters:** the digital and passive transfer functions on their own, and the voltage at each driver.
6. **Box:** the woofer box model: SPL, cone excursion and vent air speed at 2.83 V, plus the measured
   impedances against the fitted model.
7. **Directivity:** every measured angle side by side.
8. **Compare:** the current design against your snapshots.

## Task 1: tune the woofer box

The woofer was measured in Lab E with the vent plugged. Crossover Studio fits a driver and box model to your
Lab D impedances, then multiplies the measured woofer response by *designed box ÷ plugged box*. The low end
therefore shows the box you design, not the box you measured.

1. Open **1 Box**. The fitted Thiele–Small parameters (f_s, Q_ts, V_as) are listed at the bottom. Check that
   they are plausible for your driver's data sheet. If they are far off, re-check the woofer's R_E in the
   profile (multimeter value).
2. Choose **plugged**, **one vent** or **two vents**.
3. Drag the vent length. The tick marks on the slider are the lengths you measured. Between them the vent mass
   is interpolated from the fit; outside them it is extrapolated, so stay near the ticks if you can.
4. Watch **f_B** (box tuning), **f_3** and the **bass ripple** in the summary, and the **Box** view:
   - A flat SPL curve, or one with a gentle hump of at most +2 dB, is the goal. The *Smooth bass* check
     turns amber above +2 dB of ripple.
   - **Excursion** shows how far the cone moves at 2.83 V; it should dip around f_B.
   - **Vent air speed** above ~17 m/s (about 5 % of the speed of sound) is where port noise starts at higher
     levels.
5. **Filling** reduces the effective volume factor. Leave it at 1.0 unless your box is actually filled.

A second vent's diameter may be marked **estimated** when it was never measured. Its tuning is then only as
good as that guess, so say so in the report.

## Task 2: design the crossover

### Digital (MiniDSP), step 2

The MiniDSP splits the signal: a low-pass to the woofer (output 1) and a high-pass to the midrange/tweeter
board (output 2).

- **Alignment.** LR4 (Linkwitz–Riley 4th order) sums flat with the units in phase and is the usual choice.
  BW2/BW4 are Butterworth: −3 dB at f_c, so they overlap with a bump. LR2 needs one of the two branches
  inverted to sum flat; the picker says so.
- **Crossover frequency.** Drag f_c into the shaded band, which is your profile's woofer/mid target
  (250–600 Hz for System D). Watch the *Response* view. The *acoustic* crossover, where the two measured
  curves cross, is what counts, and it moves with the drivers' own roll-offs.
- **Woofer gain.** The woofer is usually more sensitive than the midrange. Lower its gain until the level below
  the crossover matches the level above it.
- **Polarity.** Try inverting the woofer if the sum dips at the crossover (see *No cancellation* below).

### Passive midrange (step 3) and tweeter (step 4)

The midrange gets a low-pass and the tweeter a high-pass. Both sit behind the MiniDSP high-pass on amplifier
channel 2.

- **Topology.** 1st order (6 dB/oct), 2nd order (12 dB/oct) or 3rd order (18 dB/oct). Higher orders
  protect the tweeter better, but they use more parts and turn the phase more.
- **Part values.** Every value picker steps through the profile's component list, which is the course basket
  (Appendix 1). Use ‹ › or the mouse wheel. A value marked `*` is not in the list.
- **L-pad (tweeter).** A series R_s and a shunt R_p lower the tweeter level without changing its load much.
  The picker shows the attenuation of each option.
- **Zobel (midrange).** An R + C across the driver flattens the rising impedance of its voice coil, so a
  low-pass behaves more like the textbook version. It is optional.
- **Polarity.** Mid/tweeter polarity is set on the passive board: swap the leads of an inverted driver.
- **Coil resistance.** At the bottom of *Check & export* you can give the inductors a resistance per mH,
  e.g. 0.3 Ω/mH for air-core coils. It lowers the midrange level slightly and changes the load.

The passive filters work into the measured impedance of each driver, not into a resistor. That is why a
"textbook" value often does not land where you expect. Check the *Filters* view, which shows the actual
voltage at the driver terminals.

## Reading the checks

Step 5 and the System view list the design rules. Click any item to jump to the control that matters most for
it.

| Check | Green when | What to try |
|---|---|---|
| **Flat on axis** | 150 Hz–15 kHz within ±2 dB (4 dB spread, 1/6-octave smoothed) | Levels first (woofer gain, tweeter L-pad), then crossover frequencies |
| **Even off axis** | 30° within 6 dB | A lower mid/tweeter crossover narrows the midrange less |
| **Woofer/mid crossover placed** | Inside the profile's band (System D: 250–600 Hz) | Digital f_c |
| **Mid/tweeter crossover placed** | Inside the profile's band (System D: 2.2–4 kHz) | Tweeter C1, midrange L1 |
| **Tweeter protected** | Tweeter ≥ 12 dB down at its resonance (System D: 1.45 kHz) | Higher order, higher crossover, smaller C1 |
| **No cancellation** | The complex sum never more than 1 dB below the power sum | Polarity, or move the crossovers so the phases line up |
| **Safe amplifier load** | Channel 2 never below 4 Ω | Bigger L-pad R_s, a Zobel, larger series L |
| **Smooth bass** | Box ripple ≤ +2 dB | Vent length (box tuning) |

Amber means *look at it*, red means *the design has a real problem*. The bands and the tweeter resonance come
from the profile's `limits`, so another system can have other targets.

## Comparing designs

Press **S** (or the camera button) to take a snapshot. Snapshots appear dashed in the plots and side by side in
the **Compare** view. Take one before every bigger change, so you can see whether the change was an
improvement. **Ctrl+Z / Ctrl+Y** undo and redo every committed change.

## The optimiser

Press **O** (or *Optimise* in the title bar). It searches the basket values, the crossover frequency, the
alignment, the woofer gain, the tweeter L-pad (and the midrange L-pad, if you have switched one on) and the midrange and tweeter polarities for the lowest score. The score combines
flatness on axis and at 30° (half weight), cancellation and the design rules above. The best design so far is
shown live while it runs. **Stop** keeps it, and the whole run is a single undo step.

Treat the result as a starting point, not as the answer. It optimises the curves it is given, and it knows
nothing about how the speaker sounds or how many coils your group has left. The report should still explain
*why* the design works.

## Task 3: build it: MiniDSP and passive board

Press **E** to open the export sheet.

**MiniDSP tab.** It shows the two biquad blocks, the same text `DigitalCrossover.m` prints. In the MiniDSP app
(project guide, section 3.1):

1. Click **Connect**.
2. In the routing matrix, activate Input 1 > Output 1 and Input 1 > Output 2.
3. Under **Outputs**, only **Xover** may be active. PEQ, Comp and FIR must be bypassed.
4. Output 1 > Xover > **Advanced**: delete the text, paste the *Output 1* block, click **Process**. Do the same
   for Output 2 with its block.
5. Set Output 1's gain to the woofer gain shown on its card. Leave Output 2 at 0 dB.

Use **Copy** or **Save .txt**. Retyped text, or text that has been through a word processor, can pick up
characters the MiniDSP rejects.

**Parts list tab.** It lists every component with its role and board, and whether it is in the course basket.
Click a row to jump to that part in the inspector. Save it as CSV or Markdown for the report or the shopping
list.

Before you measure the built system in the anechoic chamber, cover the vents, as the project guide says.
The measured result is then comparable with the *plugged* configuration in step 1.

## LTspice for the quiz and the report

The **LTspice** tab writes a complete folder, which is Figure 1 of the project guide already wired:

| File | What it is |
|---|---|
| `System_<profile>.asc` | The schematic: E_LP1/E_LP2 and E_HP1/E_HP2 hold the MiniDSP biquads as Laplace sources, both passive boards are drawn with your values, and series E sources sum the three units at every measured angle. |
| `System_<profile>.plt` | Plot settings: V(Psum) and V(Psum30), the three units, and the load on channel 2. |
| `TF_<unit>.txt`, `TF30_<unit>.txt` | The measured responses in `Matlab2LTspice.m` format, distance-compensated with the profile's phase distance. |
| `Zi_mid.txt`, `Zi_tw.txt` | The measured input impedances as admittances (Bi sources), as the course template expects. |
| `Box_woof.txt` | The box tuning: designed box ÷ plugged box, applied to the woofer. |
| `README.txt` | Every node and file explained. |

Choose an empty folder: files with the same names are replaced. Open the `.asc` in LTspice and press Run.
`V(Psum)` is the system's on-axis response for 1 V into the MiniDSP. It matches the app's *Response* view to
better than 0.001 dB. The phase has the reference distance removed, so it matches the *Phase* view.

The tab also lists each biquad's Laplace string separately, in case you wire your own schematic. Each string is
the text `DigitalCrossover.m` gives as LaplaceTXT_E1 / E2.

## Task 4: listening test tips

The project guide asks for a methodical listening test in the IEC listening room, not casual listening.
Some things that make it work:

- **Write the procedure first:** which tracks, in which order, at what level, how many listeners, and what you
  ask them. Lecture 10 and *Perceptual Audio Evaluation* (Bech & Zacharov) are the references.
- **Fix the level.** Set the same SPL (e.g. pink noise at 75–80 dB(A) at the listening position) every time.
  Louder almost always sounds "better".
- **Compare, don't rate in isolation.** A/B against a reference (another group's box, or your previous
  design) gives far more reliable answers than a 1–10 score alone. Use Crossover Studio's snapshots and design
  files to switch between versions quickly. Load a different `.xstudio` file and re-export the MiniDSP text.
- **Blind if you can.** Listeners should not know which version is playing. Randomise the order.
- **Pick revealing material:** a solo voice (midrange and the mid/tweeter crossover), a well-recorded acoustic
  bass line (box tuning, woofer/mid crossover), cymbals and brushes (tweeter), and something you know very well.
- **Ask about specific attributes,** such as bass extent, tonal balance, voice clarity, harshness and spatial
  image, with a defined scale for each.
- **Tie it back to the curves.** If listeners hear the voice as "boxy" or "thin", look at the response and the
  checks in that region, change the design, and test again. The report should show that iteration.

## Sharing designs with your group

**Export → Design file → Save design…** writes a `.xstudio` file: the design and its snapshots for this
profile, in plain JSON. It does not contain measurements. The person opening it needs the same profile, which
lives in the app data folder:

- Linux: `~/.local/share/dev.madsrudolph.crossoverstudio/profiles/<id>/`
- Windows: `%APPDATA%\dev.madsrudolph.crossoverstudio\profiles\<id>\`

Zip that folder (it includes copies of the source files) and send it, or simply share the original
measurement files and let everyone import them.

Opening a design replaces the current one as a single undo step, so **Ctrl+Z** brings yours back. A design
made for another profile opens after a warning. Its values will load, but they were tuned for other drivers.

## Keyboard

| Keys | Action |
|---|---|
| Ctrl+K (⌘K) | Command palette: every action, searchable |
| ? | Help and all shortcuts |
| 1–8 | Switch view |
| Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) | Undo / redo |
| S | Snapshot |
| O | Optimise (again to stop) |
| E | Export |
| P | Focus the probe frequency |
| X | X-ray the 3D model |
| ← / → in a plot | Step the probe (Shift: ⅓ octave) |
| Wheel / Shift-drag in a plot | Zoom / box-zoom, double-click to reset |

## Troubleshooting

**"This .mat file was saved in the v7.3 (HDF5) format".** In MATLAB: `load file.mat` then
`save('file.mat', '-v7')`.

**A measurement is assigned to the wrong role.** In the import wizard's second step, pick the right file,
variable or column by hand. Hand-made choices are kept when the automatic assignment runs again.

**The woofer's low end looks wrong.** Check the fitted T/S parameters in step 1 and the *Box* view's
impedance comparison. A poor fit usually means a wrong R_E or a mislabelled vent length.

**The phase looks like a comb.** The phase reference distance is off. Use the same value as in
`Matlab2LTspice.m`, the same for all units. It only changes the display, never the summed response.

**"missing or non-positive value".** A passive topology was switched without values for its new parts. Pick a
value for each part in the inspector.
