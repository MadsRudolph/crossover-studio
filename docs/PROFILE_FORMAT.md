# Profile format (`profile.json`, version 1)

A **profile** describes one group's loudspeaker system: the drivers, the two boxes, every measurement the
model needs, the parts you may use and the design targets. The import wizard writes it for you. This page is
for anyone who wants to write or generate one by script, or to check what the wizard stored.

The TypeScript definition is `Profile` in [`src/types.ts`](../src/types.ts), and that file is the contract. The
desktop app also checks the rules marked **required** below when it opens or saves a profile, and it lists
every problem in one message.

## Units and conventions

- **SI everywhere:** metres, hertz, ohms, henry, farad, °C. Sizes such as `0.065` are metres (65 mm), and
  `0.00082` in an inductor list is 0.82 mH.
- **Positions** are seen from the front of the speaker: `x` to the right from the box's centre line, `y` up from
  the bottom of that box.
- **Measurements** are complex series (see [Series](#series)): an impedance in Ω, or a transfer function p/V in
  Pa/V. Frequencies must rise strictly.

## Folder layout

```
<id>/
  profile.json        this file, with every measurement embedded
  sources/            copies of the files it was built from (written by the app; optional)
```

Saved profiles live in the app data folder: `~/.local/share/dev.madsrudolph.crossoverstudio/profiles/<id>/`
on Linux and `%APPDATA%\dev.madsrudolph.crossoverstudio\profiles\<id>\` on Windows. **Open profile…** also
accepts a `profile.json` anywhere else, or the folder holding one. Opened profiles are remembered in the
recent list.

## Top level

| Field | Type | | Meaning |
|---|---|---|---|
| `version` | `1` | **required** | Format version. A newer number asks you to update the app. |
| `id` | string | **required** | Folder-safe id: letters, digits, `-`, `_`, `.`; at most 64 characters; not starting with `.`. Example: `"system-d-group10"`. |
| `name` | string | **required** | Display name, e.g. `"System D · Group 10"`. |
| `group` | string | | Group name, for display. |
| `system` | string | | Course system letter, e.g. `"D"`. |
| `notes` | string | | Free text: what was measured, quirks, things to remember. |
| `conditions` | object | **required** | [Measurement conditions](#conditions). |
| `units` | object | **required** | `woof`, `mid` and `tw`, each a [unit](#units). |
| `woofer_box` | object | **required** | [The woofer's vented box](#woofer_box). |
| `top_box` | object | **required** | [The midrange/tweeter box](#top_box). |
| `measurements` | object | **required** | [All measured data](#measurements). |
| `components` | object | **required** | [Parts you may use](#components). |
| `limits` | object | **required** | [Design targets](#limits) for the checks and the optimiser. |

## `conditions`

| Field | Type | | Meaning |
|---|---|---|---|
| `T_C` | number | **required** | Air temperature during the measurements (°C). Sets ρ and c for the box model. |
| `phase_ref_distance_m` | number | **required** | The distance `d` for the phase display, as in `Matlab2LTspice.m`: the shown phase is the measured phase + 2πf·d/345. It is the same for every unit, and is often negative (System D: −1.15). It only changes how phase is *displayed* and exported to LTspice, never the summed response. |
| `mic_distance_m` | number | | Microphone distance in Lab E, for the record. |

## `units`

An object with exactly the keys `woof`, `mid` and `tw`, each:

| Field | Type | | Meaning |
|---|---|---|---|
| `label` | string | **required** | Driver name, e.g. `"Scan-Speak 26W/8534G00"`. |
| `role` | string | **required** | `"woofer"`, `"midrange"` or `"tweeter"`, for display. |
| `kind` | `"cone"` \| `"dome"` | **required** | Shape for the 3D model. |
| `diameter_m` | number | **required** | Effective radiating diameter. S_D = π·D²/4 enters the box model, so use the data-sheet S_D if you have it. |
| `frame_diameter_m` | number | **required** | Outer frame diameter (3D model only). |
| `Re_ohm` | number | | Voice-coil DC resistance (multimeter). **Strongly recommended for the woofer**: the box fit uses it. Without it, R_E is estimated from the impedance minimum. |

## `woofer_box`

| Field | Type | | Meaning |
|---|---|---|---|
| `inner_m` | [w, h, d] | **required** | Inner width, height and depth. The net volume V_B = w·h·d. |
| `wall_m` | number | **required** | Wall thickness (3D model; the outer size is inner + 2·wall). |
| `vents` | [VentSpec](#ventspec)[] | **required** | The vents the box has. The first is the primary vent the measurements used. |
| `driver_pos_m` | [x, y] | **required** | Woofer centre on the front baffle. |
| `vent_pos_m` | [x, y][] | **required** | Vent mouth centres, one per entry in `vents`. |

### `VentSpec`

| Field | Type | | Meaning |
|---|---|---|---|
| `id` | string | **required** | `"A"`, `"B"`, … Referenced by `measurements.woofer.vented[].vents[].id`. |
| `diameter_m` | number | **required** | Inner diameter. |
| `estimated` | boolean | | `true` when the diameter is a guess. The inspector then marks the vent as estimated. |
| `length_range_m` | [min, max] | | Slider range for the vent length. |

## `top_box`

| Field | Type | | Meaning |
|---|---|---|---|
| `outer_m` | [w, h, d] | **required** | Outer size of the box on top. |
| `offset_x_m` | number | **required** | Its centre relative to the woofer box centre line (+ = right, seen from the front). The front faces are flush. |
| `mid_pos_m` | [x, y] | **required** | Midrange centre on the top box front. |
| `tw_pos_m` | [x, y] | **required** | Tweeter centre. |

The geometry drives the 3D model only. The acoustic offsets between the drivers are already inside the
measured transfer functions.

## `measurements`

| Field | Type | | Meaning |
|---|---|---|---|
| `tf` | `{ [angle]: { woof?, mid?, tw? } }` | **required** | Anechoic p/V per unit, keyed by the angle in degrees as a string: `"0"`, `"30"`, … `"0"` is required and needs all three units. Other angles are optional; an angle missing a unit is skipped with a note. **All units of one angle must come from the same run**, so their relative phase is valid. |
| `zi` | `{ mid?, tw? }` | **required** | Input impedance of the midrange and tweeter (Lab D). Both are needed to compute the passive filters, because they are the filters' load. |
| `woofer` | object | **required** | Woofer impedances for the box fit, below. |

### `measurements.woofer`

| Field | Type | | Meaning |
|---|---|---|---|
| `free` | [Series](#series) | | Free-air impedance. |
| `closed` | [Series](#series) | | Impedance in the box with all vents plugged. Together with `free` this pins down V_AS. |
| `vented` | VentedMeasurement[] | **required** (may be `[]`) | One entry per vented configuration measured. |

At least one woofer impedance is needed. With fewer curves the fit falls back, and the Box view says how:
- no `closed` curve: driver and vents are fitted jointly;
- no `vented` curves: the vent mass comes from the tube formula.

### `VentedMeasurement`

| Field | Type | | Meaning |
|---|---|---|---|
| `vents` | `{ id, length_m }[]` | **required** | Which vents were open, and at what length. Usually one entry: `[{ "id": "A", "length_m": 0.16 }]`. |
| `z` | [Series](#series) | **required** | Woofer impedance in this configuration. Its double peak fixes the vent's effective mass. |
| `nf_cone` | [Series](#series) | | Near-field pressure at the cone (validation plot only). |
| `nf_vent` | [Series](#series) | | Near-field pressure at the vent mouth (validation plot only). |

Measure two or three vent lengths. The model interpolates the vent mass between them.

### Series

```json
{ "f": [20, 20.25, 20.5], "re": [5.91, 5.92, 5.93], "im": [0.41, 0.42, 0.44],
  "source": { "file": "labD_midrange.mat", "format": "mat", "freqVar": "f", "dataVar": "Z" } }
```

| Field | Type | | Meaning |
|---|---|---|---|
| `f` | number[] | **required** | Frequency in Hz, strictly rising, at least 2 points. |
| `re`, `im` | number[] | **required** | Real and imaginary part, same length as `f`. |
| `source` | object | | Where the data came from, kept for the record. |
| `source.file` | string | | File name, without the folder. |
| `source.format` | `"mat"` \| `"ltspice"` \| `"csv"` | | |
| `source.freqVar`, `source.dataVar` | string | | `.mat` only: the variables used. Struct fields are written `s.field`. |
| `source.column` | number | | 0-based column of a matrix variable, e.g. 0/1/2 = woofer/mid/tweeter in `labE_system_0.mat`'s `H`. |
| `source.note` | string | | The file's own `note` text, e.g. `"vent plugged"`. |

Different series may use different frequency grids. The model works on the grid of the on-axis woofer response
and interpolates everything else onto it (in log-frequency).

## `components`

```json
"components": {
  "L": [0.00015, 0.00018, 0.00022, 0.00033, 0.00039, 0.00047, 0.00056, 0.00068, 0.00082, 0.001, 0.0012, 0.0015, 0.0018, 0.0022],
  "C": [1.5e-6, 2.2e-6, 2.7e-6, 3.3e-6, 3.9e-6, 4.7e-6, 5.6e-6, 6.8e-6, 8.2e-6, 1e-5, 1.2e-5, 1.5e-5, 2.2e-5, 3.3e-5, 4.7e-5, 6.8e-5, 1e-4],
  "R": [1, 1.5, 2.2, 3.3, 4.7, 5.6, 6.8, 8.2, 10, 15, 22, 33, 47]
}
```

The values the part pickers and the optimiser may use, in H, F and Ω. These are the values of Appendix 1 of
the 2026 project guide (the course basket), and the wizard fills them in for you. The parts list marks every
part in this list as *course basket (Appendix 1)*.

## `limits`

| Field | Type | | Meaning |
|---|---|---|---|
| `wm` | [lo, hi] Hz | **required** | Target band for the woofer/midrange acoustic crossover. System D: `[250, 600]`. |
| `mt` | [lo, hi] Hz | **required** | Target band for the midrange/tweeter crossover. System D: `[2200, 4000]`. |
| `tw_fs_hz` | number | **required** | Tweeter resonance. The *Tweeter protected* check wants the tweeter ≥ 12 dB down here. System D: `1450`. |

The crossover-finding windows of the metrics are these bands widened by ×0.6 and ×1.5.

## A minimal example

The smallest useful profile has the on-axis responses, both passive-unit impedances and one woofer impedance.
The arrays are shortened here; real ones hold hundreds of points.

```json
{
  "version": 1,
  "id": "system-x-group3",
  "name": "System X · Group 3",
  "conditions": { "T_C": 21, "phase_ref_distance_m": -1.0 },
  "units": {
    "woof": { "label": "Woofer", "role": "woofer", "kind": "cone", "diameter_m": 0.21, "frame_diameter_m": 0.26, "Re_ohm": 5.6 },
    "mid":  { "label": "Midrange", "role": "midrange", "kind": "cone", "diameter_m": 0.10, "frame_diameter_m": 0.13 },
    "tw":   { "label": "Tweeter", "role": "tweeter", "kind": "dome", "diameter_m": 0.025, "frame_diameter_m": 0.07 }
  },
  "woofer_box": {
    "inner_m": [0.4, 0.45, 0.45], "wall_m": 0.018,
    "vents": [{ "id": "A", "diameter_m": 0.065 }],
    "driver_pos_m": [0, 0.29], "vent_pos_m": [[0, 0.08]]
  },
  "top_box": { "outer_m": [0.17, 0.29, 0.24], "offset_x_m": 0, "mid_pos_m": [0, 0.09], "tw_pos_m": [0, 0.21] },
  "measurements": {
    "tf": { "0": { "woof": { "f": [50, 51], "re": [0.01, 0.01], "im": [0.0, 0.001] },
                   "mid":  { "f": [50, 51], "re": [0.002, 0.002], "im": [0.001, 0.001] },
                   "tw":   { "f": [50, 51], "re": [1e-5, 1e-5], "im": [0, 0] } } },
    "zi": { "mid": { "f": [20, 21], "re": [5.9, 5.9], "im": [0.4, 0.4] },
            "tw":  { "f": [20, 21], "re": [3.6, 3.6], "im": [0.1, 0.1] } },
    "woofer": { "free": { "f": [10, 11], "re": [6.0, 6.2], "im": [1.0, 1.4] }, "vented": [] }
  },
  "components": { "L": [0.00082, 0.001], "C": [6.8e-6, 1e-5], "R": [3.3, 4.7] },
  "limits": { "wm": [250, 600], "mt": [2200, 4000], "tw_fs_hz": 1500 }
}
```

The bundled [`profiles/system-d-group10/profile.json`](../profiles/system-d-group10/profile.json) is a
complete real example, and [`scripts/make_example_profile.py`](../scripts/make_example_profile.py) shows how
to generate a profile from a lab repository by script.

## Compatibility

Version 1 profiles will keep opening in later releases. Fields may be added; an app that does not know a field
ignores it. A change that older apps cannot read raises `version`.
