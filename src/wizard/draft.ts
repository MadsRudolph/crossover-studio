// The import wizard's working draft. It is ephemeral UI state (the files being imported, the role choices,
// the system description), not app state: the app store only ever receives the finished Profile. It
// survives closing the wizard, so an import can be resumed until the user starts over or saves.

import { create } from "zustand";
import { produce } from "immer";
import type { Profile, Series, UnitId } from "../types";
import { compute, fitBox, prepare, type BoxFitEx } from "../engine";
import { BUNDLED_PROFILES, defaultDesign, useStore } from "../state/store";
import * as platform from "../platform";
import { decodeText, parseText, validateSeries } from "./parsers";
import { autoAssign, choiceKey, ventKey, type Assignment, type Choice, type RoleKey, type VentConfig, type WizardFile } from "./roles";
import { buildProfile, draftFromProfile, estimatePhaseRef, estimateResonance, isValidId, slugify,
         type DraftSystem, type PhaseRefEstimate } from "./build";
import { refreshSavedProfiles } from "./profiles";

export interface SeriesState { status: "loading" | "ready" | "error"; series?: Series; error?: string }

/** Where a system value came from: the bundled example (no entry), the user, or the user's own data. */
export type Provenance = "user" | "data";

export interface FitState {
  status: "idle" | "busy" | "ready" | "error";
  /** Signature of the inputs the fit ran on: a change invalidates it. */
  key?: string;
  fit?: BoxFitEx;
  profile?: Profile;
  error?: string;
}

export const STEP_TITLES = ["Files", "Roles", "System", "Phase reference", "Review & fit"] as const;

interface WizardState {
  step: number;
  /** Furthest step opened so far: the rail ticks only steps the user has seen. */
  maxVisited: number;
  files: WizardFile[];
  assignments: Record<RoleKey, Assignment>;
  /** Roles the user emptied on purpose: the automatic assignment leaves them empty. */
  cleared: RoleKey[];
  vents: VentConfig[];
  /** Vent configurations the user added or edited (kept even with no data assigned yet). */
  userVents: string[];
  angles: string[];
  series: Record<string, SeriesState>;
  system: DraftSystem;
  provenance: Record<string, Provenance>;
  /** Profile id typed by the user; null = derived from the name. */
  idOverride: string | null;
  phase: { value: number; manual: boolean; estimate: PhaseRefEstimate | null; busy: boolean; key?: string };
  fit: FitState;
  saving: boolean;

  reset(): void;
  setStep(step: number): void;
  /** Adds files, and every measurement file inside a folder. Returns the names of folder files left out
   *  because they hold no measurement (a README.txt, a MiniDSP coefficient file). */
  addPaths(paths: string[]): Promise<{ skipped: string[] }>;
  addBrowserFiles(files: File[]): Promise<void>;
  loadExampleFiles(): Promise<void>;
  removeFile(id: string): void;
  assign(role: RoleKey, choice: Choice | null): void;
  addAngle(angle: string): void;
  removeAngle(angle: string): void;
  addVent(vents: VentConfig["vents"]): void;
  updateVent(key: string, vents: VentConfig["vents"]): void;
  removeVent(key: string): void;
  ensureSeries(choice: Choice): Promise<void>;
  setSystem(mut: (d: DraftSystem) => void, path?: string | string[], how?: Provenance): void;
  setId(id: string | null): void;
  runPhaseEstimate(): void;
  setPhase(d: number, manual: boolean): void;
  runFit(): void;
  /** Save into the app's profile folder and open it. Without `replace`, an id that is already saved is
   *  not overwritten: the result names it in `conflict`, with a free id to save under instead. */
  save(opts?: { replace?: boolean }): Promise<{ ok: boolean; folder?: string; error?: string; conflict?: SaveConflict }>;
  openWithoutSaving(): { ok: boolean; error?: string };
}

const initial = () => ({
  step: 0,
  maxVisited: 0,
  files: [] as WizardFile[],
  assignments: {} as Record<RoleKey, Assignment>,
  cleared: [] as RoleKey[],
  vents: [] as VentConfig[],
  userVents: [] as string[],
  angles: [] as string[],
  series: {} as Record<string, SeriesState>,
  system: draftFromProfile(BUNDLED_PROFILES[0]),
  provenance: {} as Record<string, Provenance>,
  idOverride: null as string | null,
  phase: { value: BUNDLED_PROFILES[0].conditions.phase_ref_distance_m, manual: false, estimate: null, busy: false },
  fit: { status: "idle" } as FitState,
  saving: false,
});

const extOf = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export const useWizard = create<WizardState>()((set, get) => {
  /** Re-run the automatic assignment after files changed, keeping the user's own choices. */
  const reassign = () => {
    const s = get();
    const ready = s.files.filter(f => f.status === "ready");
    const keepVents = s.vents.filter(v => s.userVents.includes(v.key));
    const manual = Object.fromEntries(Object.entries(s.assignments).filter(([, a]) => !a.auto && ready.some(f => f.id === a.choice.fileId)));
    const r = autoAssign(ready, manual, keepVents);
    for (const role of s.cleared) if (r.assignments[role]?.auto) delete r.assignments[role];
    // off-axis angles and vent configurations the user added stay even while empty
    const angles = [...new Set([...s.angles, ...r.angles])].sort((a, b) => +a - +b);
    set({ assignments: r.assignments, vents: r.vents, angles });
    for (const a of Object.values(r.assignments)) void get().ensureSeries(a.choice);
  };

  /** Fill in the tweeter resonance from the impedance peak unless the user typed it. (R_E is only offered,
   *  not filled: the impedance minimum reads low, and the box fit is sensitive to it.) */
  const deriveFromData = () => {
    const s = get();
    const a = s.assignments["zi:tw"];
    const tw = a ? s.series[choiceKey(a.choice)]?.series : undefined;
    if (!tw || s.provenance["limits.tw_fs_hz"] === "user") return;
    const fs = estimateResonance(tw);
    if (fs && Math.abs(fs - s.system.limits.tw_fs_hz) > 0.5) get().setSystem(d => { d.limits.tw_fs_hz = Math.round(fs); }, "limits.tw_fs_hz", "data");
  };

  const seriesFor = (role: RoleKey): Series | undefined => {
    const s = get(), a = s.assignments[role];
    return a ? s.series[choiceKey(a.choice)]?.series : undefined;
  };

  const assembleProfile = (): Profile => {
    const s = get();
    const series: Record<RoleKey, Series | undefined> = {};
    for (const role of Object.keys(s.assignments)) series[role] = seriesFor(role);
    const system = produce(s.system, d => { d.conditions.phase_ref_distance_m = s.phase.value; });
    return buildProfile({ system, id: profileId(s), assignments: s.assignments, series, vents: s.vents });
  };

  return {
    ...initial(),

    reset() { set(initial()); },
    setStep(step) {
      const s = Math.max(0, Math.min(STEP_TITLES.length - 1, step));
      set({ step: s, maxVisited: Math.max(get().maxVisited, s) });
    },

    async addPaths(given) {
      // a dropped or chosen folder stands for the measurement files inside it
      let paths = given;
      try { paths = await platform.expandFolders(given); } catch { /* older backend: add the paths as given */ }
      const fromFolder = new Set(paths.filter(p => !given.includes(p)));
      const known = new Set(get().files.map(f => f.id));
      const fresh = [...new Set(paths)].filter(p => !known.has(p));
      if (!fresh.length) return { skipped: [] };
      set({ files: [...get().files, ...fresh.map((p): WizardFile => ({ id: p, path: p, name: baseName(p), format: guessFormat(p), status: "reading" }))] });
      await Promise.all(fresh.map(async path => {
        let patch: Partial<WizardFile>;
        try {
          const info = await platform.inspectFile(path);
          patch = { info, format: info.format, status: info.error ? "error" : info.format === "unknown" ? "error" : "ready",
                    error: info.error ?? (info.format === "unknown" ? "Not a measurement file: expected MATLAB .mat, Matlab2LTspice .txt or CSV." : undefined) };
        } catch (e) {
          patch = { status: "error", error: message(e) };
        }
        set({ files: get().files.map(f => f.id === path ? { ...f, ...patch } : f) });
      }));
      // files found in a folder that turn out not to be measurements are left out rather than listed as errors
      const skipped = get().files.filter(f => fromFolder.has(f.id) && f.status === "error");
      if (skipped.length) set({ files: get().files.filter(f => !skipped.includes(f)) });
      reassign();
      return { skipped: skipped.map(f => f.name) };
    },

    async addBrowserFiles(list) {
      const known = new Set(get().files.map(f => f.id));
      const fresh = list.filter(f => !known.has(`${f.name}:${f.size}`));
      if (!fresh.length) return;
      const files = await Promise.all(fresh.map(async (file): Promise<WizardFile> => {
        const id = `${file.name}:${file.size}`, ext = extOf(file.name);
        if (ext === "mat")
          return { id, name: file.name, format: "mat", status: "error",
                   error: "MATLAB .mat files are read by the desktop app. In the browser preview, use Matlab2LTspice .txt or CSV files." };
        try {
          const { format, table } = parseText(decodeText(new Uint8Array(await file.arrayBuffer())));
          return { id, name: file.name, format, status: "ready", table };
        } catch (e) {
          return { id, name: file.name, format: ext === "csv" ? "csv" : ext === "txt" ? "ltspice" : "unknown", status: "error", error: message(e) };
        }
      }));
      set({ files: [...get().files, ...files] });
      reassign();
    },

    async loadExampleFiles() {
      // The System D measurements as CSV, bundled as separate chunks that load only on request.
      const mods = import.meta.glob("../../fixtures/csv/*.csv", { query: "?raw", import: "default" });
      const files = await Promise.all(Object.entries(mods).map(async ([path, load]) => {
        const text = String(await load()), name = baseName(path);
        return new File([text], name, { type: "text/csv" });
      }));
      await get().addBrowserFiles(files);
    },

    removeFile(id) {
      const s = get();
      const assignments = Object.fromEntries(Object.entries(s.assignments).filter(([, a]) => a.choice.fileId !== id));
      set({ files: s.files.filter(f => f.id !== id), assignments });
      reassign();
    },

    assign(role, choice) {
      const s = get();
      const assignments = { ...s.assignments };
      if (choice) {
        // one item feeds one role: take it away from wherever it was
        for (const [r, a] of Object.entries(assignments)) if (r !== role && choiceKey(a.choice) === choiceKey(choice)) delete assignments[r];
        assignments[role] = { role, choice, confidence: 1, reason: "Chosen by hand.", auto: false };
        set({ assignments, cleared: s.cleared.filter(r => r !== role) });
        void get().ensureSeries(choice);
      } else {
        delete assignments[role];
        set({ assignments, cleared: [...new Set([...s.cleared, role])] });
      }
    },

    addAngle(angle) {
      const a = String(Math.round(+angle));
      if (!Number.isFinite(+a) || a === "0" || get().angles.includes(a)) return;
      set({ angles: [...get().angles, a].sort((x, y) => +x - +y) });
    },
    removeAngle(angle) {
      const s = get();
      const assignments = Object.fromEntries(Object.entries(s.assignments).filter(([r]) => !r.startsWith(`tf:${angle}:`)));
      set({ angles: s.angles.filter(a => a !== angle), assignments,
            cleared: [...new Set([...s.cleared, ...["woof", "mid", "tw"].map(u => `tf:${angle}:${u}`)])] });
    },

    addVent(vents) {
      const key = ventKey(vents), s = get();
      if (s.vents.some(v => v.key === key)) return;
      set({ vents: [...s.vents, { key, vents }], userVents: [...s.userVents, key] });
    },
    updateVent(oldKey, vents) {
      const s = get(), key = ventKey(vents);
      if (key !== oldKey && s.vents.some(v => v.key === key)) return;
      const assignments: Record<RoleKey, Assignment> = {};
      for (const [r, a] of Object.entries(s.assignments)) {
        const nr = r.startsWith(`vent:${oldKey}:`) ? r.replace(`vent:${oldKey}:`, `vent:${key}:`) : r;
        // re-keyed by hand: the user now owns this configuration
        assignments[nr] = nr === r ? a : { ...a, role: nr, auto: false };
      }
      set({ vents: s.vents.map(v => v.key === oldKey ? { key, vents } : v), assignments,
            userVents: [...s.userVents.filter(k => k !== oldKey), key] });
    },
    removeVent(key) {
      const s = get();
      const assignments = Object.fromEntries(Object.entries(s.assignments).filter(([r]) => !r.startsWith(`vent:${key}:`)));
      set({ vents: s.vents.filter(v => v.key !== key), userVents: s.userVents.filter(k => k !== key), assignments,
            cleared: [...new Set([...s.cleared, `vent:${key}:z`, `vent:${key}:nf_cone`, `vent:${key}:nf_vent`])] });
    },

    async ensureSeries(choice) {
      const key = choiceKey(choice);
      const cur = get().series[key];
      if (cur && cur.status !== "error") return;
      const file = get().files.find(f => f.id === choice.fileId);
      if (!file) return;
      const put = (st: SeriesState) => set({ series: { ...get().series, [key]: st } });
      put({ status: "loading" });
      try {
        let series: Series;
        if (file.table) {
          const t = file.table, problem = validateSeries(t.f, t.re, t.im);
          if (problem) throw new Error(problem);
          const note = t.notes.join(" ");
          series = { f: t.f, re: t.re, im: t.im, source: { file: file.name, format: file.format === "csv" ? "csv" : "ltspice", ...(note ? { note } : {}) } };
        } else if (file.path) {
          series = await platform.readSeries({ path: file.path, freqVar: choice.freqVar, dataVar: choice.dataVar, column: choice.column });
        } else throw new Error("This file can no longer be read: add it again.");
        put({ status: "ready", series });
        deriveFromData();
      } catch (e) {
        put({ status: "error", error: message(e) });
      }
    },

    setSystem(mut, path, how = "user") {
      const s = get();
      const paths = path === undefined ? [] : Array.isArray(path) ? path : [path];
      const provenance = { ...s.provenance };
      for (const p of paths) provenance[p] = how;
      set({ system: produce(s.system, mut), provenance });
    },

    setId(id) { set({ idOverride: id === null || id.trim() === "" ? null : id.trim() }); },

    runPhaseEstimate() {
      const s = get();
      const tf: Partial<Record<UnitId, Series>> = {};
      for (const u of ["woof", "mid", "tw"] as const) { const x = seriesFor(`tf:0:${u}`); if (x) tf[u] = x; }
      // only loaded series count, so a unit arriving later triggers a new estimate
      const key = (["woof", "mid", "tw"] as const).map(u => tf[u] ? choiceKey(s.assignments[`tf:0:${u}`].choice) : "-").join("/");
      if (s.phase.key === key && (s.phase.estimate || s.phase.busy)) return;
      if (!Object.keys(tf).length) return;
      set({ phase: { ...s.phase, busy: true, key } });
      // ~0.1 s of number crunching: let the step paint first
      window.setTimeout(() => {
        const est = estimatePhaseRef(tf);
        const ph = get().phase;
        set({ phase: { ...ph, busy: false, estimate: est, value: !ph.manual && est ? est.d : ph.value } });
      }, 30);
    },
    setPhase(d, manual) {
      const ph = get().phase;
      set({ phase: { ...ph, manual, value: manual ? d : ph.estimate?.d ?? d } });
    },

    runFit() {
      let profile: Profile;
      try { profile = assembleProfile(); }
      catch (e) { set({ fit: { status: "error", error: message(e) } }); return; }
      const key = JSON.stringify([profile.units.woof, profile.woofer_box, profile.conditions.T_C,
        Object.keys(get().assignments).filter(r => r.startsWith("woofer") || r.startsWith("vent")).map(r => choiceKey(get().assignments[r].choice)),
        get().vents]);
      const cur = get().fit;
      if (cur.key === key && (cur.status === "ready" || cur.status === "busy")) {
        // the fit inputs are unchanged; keep the fit but carry the latest profile (name, limits, phase)
        if (cur.status === "ready") set({ fit: { ...cur, profile } });
        return;
      }
      set({ fit: { status: "busy", key } });
      window.setTimeout(() => {
        try {
          const fit = fitBox(profile);
          // prove the profile works end to end before it reaches the app
          compute(prepare(profile, fit), defaultDesign(profile));
          if (get().fit.key === key) set({ fit: { status: "ready", key, fit, profile } });
        } catch (e) {
          if (get().fit.key === key) set({ fit: { status: "error", key, error: message(e) } });
        }
      }, 40);
    },

    async save(opts) {
      let profile: Profile;
      try { profile = assembleProfile(); }
      catch (e) { return { ok: false, error: message(e) }; }
      if (!isValidId(profile.id)) return { ok: false, error: "The profile id may only use letters, digits, '.', '_' and '-' (64 at most)." };
      if (!opts?.replace) {
        // two groups both called "System D" on one machine must not overwrite each other silently
        const saved = await platform.listProfiles().catch(() => []);
        const clash = saved.find(e => e.id === profile.id && !e.bundled);
        if (clash) {
          const ids = new Set(saved.map(e => e.id)), base = profile.id.slice(0, 60);
          let k = 2;
          while (ids.has(`${base}-${k}`)) k++;
          return { ok: false, conflict: { id: profile.id, name: clash.name, freeId: `${base}-${k}` } };
        }
      }
      set({ saving: true });
      try {
        const sources = [...new Set(Object.values(get().assignments).map(a => get().files.find(f => f.id === a.choice.fileId)?.path)
          .filter((p): p is string => !!p))];
        const folder = await platform.saveProfile(profile, sources);
        const opened = openInApp(profile);
        void refreshSavedProfiles();
        if (!opened.ok) return { ok: false, error: opened.error, folder };
        set(initial());
        return { ok: true, folder };
      } catch (e) {
        return { ok: false, error: message(e) };
      } finally {
        set({ saving: false });
      }
    },

    openWithoutSaving() {
      let profile: Profile;
      try { profile = assembleProfile(); }
      catch (e) { return { ok: false, error: message(e) }; }
      return openInApp(profile);
    },
  };
});

function openInApp(profile: Profile): { ok: boolean; error?: string } {
  const app = useStore.getState();
  app.loadProfile(profile);
  const st = useStore.getState();
  // loadProfile keeps the previous profile and only sets `error` when the new one cannot be prepared
  if (st.profile !== profile) return { ok: false, error: st.error ?? "The app could not open the profile." };
  app.setUi({ wizard: false });
  return { ok: true };
}

/** The id the profile will be saved under. */
export interface SaveConflict { id: string; name: string; freeId: string }

export function profileId(s: Pick<WizardState, "idOverride" | "system">): string {
  return s.idOverride ?? slugify(s.system.name || "my-system");
}

/** The series currently assigned to a role (undefined while loading or when unassigned). */
export function useRoleSeries(role: RoleKey): SeriesState | undefined {
  return useWizard(s => { const a = s.assignments[role]; return a ? s.series[choiceKey(a.choice)] : undefined; });
}

function guessFormat(path: string): WizardFile["format"] {
  const e = extOf(path);
  return e === "mat" ? "mat" : e === "csv" ? "csv" : e === "txt" ? "ltspice" : "unknown";
}

export function message(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.charAt(0).toUpperCase() + m.slice(1);
}
