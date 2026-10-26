// Crossover Studio domain types. This file is the contract between the Rust backend, the engine,
// the store and every view. Change it only with care: everything imports from here.

// ---------------------------------------------------------------- measured data
/** One measured complex quantity against frequency (an impedance in ohm, or p/V in Pa/V). */
export interface Series {
  f: number[];
  re: number[];
  im: number[];
  source?: SeriesSource;
}

export interface SeriesSource {
  /** Original file name (no directory), as the user picked it. */
  file: string;
  format: "mat" | "ltspice" | "csv";
  /** .mat only: the variables used. */
  freqVar?: string;
  dataVar?: string;
  /** Column of a matrix variable (0-based), e.g. labE_system_0.mat H(:,1..3) = woofer, mid, tweeter. */
  column?: number;
  /** Anything the importer learned, e.g. the file's `note` variable ("vent plugged"). */
  note?: string;
}

/** Complex arrays used inside the engine. */
export interface CArray {
  re: Float64Array;
  im: Float64Array;
}

export type UnitId = "woof" | "mid" | "tw";
export const UNIT_IDS: UnitId[] = ["woof", "mid", "tw"];

// ---------------------------------------------------------------- profile (one group's system)
export interface UnitInfo {
  label: string;            // e.g. "Scan-Speak 26W/8534G00"
  role: string;             // "woofer" | "midrange" | "tweeter", for display
  kind: "cone" | "dome";
  /** Effective radiating diameter (S_D = pi D^2 / 4). */
  diameter_m: number;
  /** Outer frame diameter, for the 3D model only. */
  frame_diameter_m: number;
  /** Voice-coil DC resistance (multimeter), ohm. Needed for the woofer box fit. */
  Re_ohm?: number;
}

export interface VentSpec {
  id: string;               // "A", "B"
  diameter_m: number;       // inner diameter
  /** true when the diameter is a guess (not measured): the UI marks it. */
  estimated?: boolean;
  length_range_m?: [number, number];
}

export interface WooferBox {
  /** Inner width, height, depth. */
  inner_m: [number, number, number];
  wall_m: number;
  vents: VentSpec[];
  /** Driver centre on the front face: x from the box centre line (+ = right, seen from the front), y from the floor. */
  driver_pos_m: [number, number];
  /** Vent mouth centres, same convention, one per entry in `vents`. */
  vent_pos_m: [number, number][];
}

export interface TopBox {
  outer_m: [number, number, number];
  /** Centre of the top box relative to the woofer box centre line, x (+ = right, seen from the front). Front faces flush. */
  offset_x_m: number;
  /** Driver centres on the top box front, x from its centre line, y from its bottom. */
  mid_pos_m: [number, number];
  tw_pos_m: [number, number];
}

export interface VentedMeasurement {
  /** Which vents were open, and at what length. */
  vents: { id: string; length_m: number }[];
  z: Series;
  nf_cone?: Series;
  nf_vent?: Series;
}

export interface Measurements {
  /** Anechoic p/V per unit, keyed by angle in degrees as a string: "0", "30", ... "0" is required.
   *  All units of one angle must come from the same run so their relative phase is valid. */
  tf: Record<string, Partial<Record<UnitId, Series>>>;
  /** Input impedance of the passively filtered units. */
  zi: { mid?: Series; tw?: Series };
  /** Woofer impedances for the box fit. */
  woofer: { free?: Series; closed?: Series; vented: VentedMeasurement[] };
}

export interface Profile {
  version: 1;
  id: string;               // folder-safe, e.g. "system-d-group10"
  name: string;             // "System D · Group 10"
  group?: string;
  system?: string;          // "D"
  notes?: string;
  conditions: {
    T_C: number;
    /** Distance used for the phase display, Matlab2LTspice convention (the same for every unit). */
    phase_ref_distance_m: number;
    mic_distance_m?: number;
  };
  units: Record<UnitId, UnitInfo>;
  woofer_box: WooferBox;
  top_box: TopBox;
  measurements: Measurements;
  /** Available passive parts (defaults: Appendix 1 of the 2026 project guide). */
  components: { L: number[]; C: number[]; R: number[] };
  /** Design rules for the checks and the optimiser. */
  limits: { wm: [number, number]; mt: [number, number]; tw_fs_hz: number };
}

// ---------------------------------------------------------------- box fit (from the woofer impedances)
export interface DriverParams {
  Bl: number; Mmd: number; Cms: number; Rms: number; Le: number;
}

export interface BoxFit {
  T: number; c: number; rho: number;
  RE: number; SD: number; AD: number; VB: number;
  /** Radius of the vent the vented measurements used. */
  AP: number;
  drv: DriverParams;
  RAB: number; QL: number; QP: number;
  /** Fitted effective vent mass per measured length: [length_m, M_AP kg/m^4]. */
  MAP: [number, number][];
  /** Thiele-Small view of drv, for display. */
  ts: { fs: number; Qms: number; Qes: number; Qts: number; Vas_L: number; Mms: number };
  /** Fit residuals (mean squared log error), lower is better. */
  quality: { driver: number; vents: number };
}

// ---------------------------------------------------------------- design (what the user edits)
export type Align = "BW2" | "LR2" | "LR4" | "BW4";

export interface PassiveBranch {
  topo: string;             // key of the engine's topology library: "LP1" "LP2" "LP3" "HP1" "HP2" "HP3"
  vals: Record<string, number>;
  pad?: { Rs?: number; Rp?: number | null };
  zobel?: { R: number; C: number } | null;
}

export interface BoxDesign {
  mode: "plugged" | "one" | "two";
  /** Vent A length (m); vent B length and diameter for mode "two". */
  L: number;
  L2: number;
  a2: number;               // radius of vent B
  fill: number;             // effective volume factor (filling), 1.0 = empty
  /** Filled in by the engine: the effective vent mass used, and a label. */
  MAP?: number | null;
  label?: string;
}

export interface Design {
  box: BoxDesign;
  digital: { fc: number; align: Align; g_woof_dB: number };
  mid: PassiveBranch;
  tw: PassiveBranch;
  pol: Record<UnitId, 1 | -1>;
  /** Coil resistance, ohm per mH. */
  Rdcr: number;
}

// ---------------------------------------------------------------- results
export interface AngleResult {
  woof: CArray; mid: CArray; tw: CArray; sum: CArray;
  Zamp2: CArray;
  HL: CArray; HH: CArray; Tm: CArray; Tt: CArray;
}

export interface Metrics {
  on: { spread: number; rms: number; level: number };
  /** Off-axis level statistics at `offAngle` (30° when measured, else the first off-axis angle). */
  off30?: { spread: number; rms: number; level: number };
  /** The angle (degrees, as a key of Results.angles) that off30 describes. */
  offAngle?: string;
  x_wm: number | null;
  x_mt: number | null;
  Zamp2_min: number;
}

export type CheckState = "good" | "warn" | "bad";
export interface Check { id: string; state: CheckState; title: string; detail: string }

export interface Results {
  f: Float64Array;
  /** Per angle present in the profile ("0", "30", ...). */
  angles: Record<string, AngleResult>;
  metrics: Metrics;
  checks: Check[];
  box: { MAP: number | null; fill: number; label: string; fB: number | null; f3: number; ripple: number };
}

// ---------------------------------------------------------------- files (Rust backend)
export interface MatVariable {
  name: string;
  class: string;            // "double", "char", "struct", "opaque", ...
  dims: number[];
  complex: boolean;
  /** For char variables, the text (truncated). */
  text?: string;
}

export interface FileInfo {
  path: string;
  name: string;
  format: "mat" | "ltspice" | "csv" | "unknown";
  variables: MatVariable[];     // .mat only
  /** ltspice/csv: number of points and the header line. */
  points?: number;
  header?: string;
  error?: string;
}

export interface ReadSpec {
  path: string;
  /** .mat only. */
  freqVar?: string;
  dataVar?: string;
  column?: number;
}

export interface ProfileEntry { id: string; name: string; path: string; bundled: boolean }
