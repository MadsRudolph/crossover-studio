// Limits view: how loud the design can play and what gives up first. One curve per failure mechanism
// (the level at 1 m where a sine at that frequency takes the part to its limit) with their lower
// envelope, the programme headline ("about 92 dB at 1 m before ..."), a level slider that shows how
// close every part is to its limit, the data-sheet values (editable, kept per profile) and a short
// explanation of the model.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Plot, type PlotMarker, type PlotSeries } from "../charts";
import {
  CREST_IEC_DB, CREST_MUSIC_DB, DEFAULT_AMP_VRMS, DEFAULT_LISTEN_M, limits, limitSettings, loadsAt,
  type LimitOverrides, type LimitSource, type LimitsResult, type Mechanism,
} from "../engine";
import { loadLimitOverrides, limitReason, onLimitOverrides, saveLimitOverrides } from "../insights/providers/limits";
import { ViewInsights } from "../insights/ViewInsights";
import { Button, NumberField, Segmented, Slider, withUnits } from "../ui";
import { focusControl } from "../ui/shell/commands";
import { useStore } from "../state/store";
import type { UnitId } from "../types";
import { Card, Readout, ViewHeader, crossoverLines, useProbe, useSize } from "./common";
import "./limits.css";

let lastCrest = CREST_MUSIC_DB;   // remembered while the app runs
let lastLevel: number | null = null;

const UNITS: { id: UnitId; name: string }[] = [{ id: "woof", name: "Woofer" }, { id: "mid", name: "Midrange" }, { id: "tw", name: "Tweeter" }];

/** The user's data-sheet entries for the current profile, live. */
function useOverrides(profileId: string): [LimitOverrides, (o: LimitOverrides) => void] {
  const [o, setO] = useState(() => loadLimitOverrides(profileId));
  useEffect(() => {
    setO(loadLimitOverrides(profileId));
    return onLimitOverrides(() => setO(loadLimitOverrides(profileId)));
  }, [profileId]);
  return [o, (next) => saveLimitOverrides(profileId, next)];
}

export function LimitsView() {
  const prep = useStore(s => s.prep)!;
  const design = useStore(s => s.design);
  const results = useStore(s => s.results)!;
  const profile = useStore(s => s.profile)!;
  const [overrides, setOverrides] = useOverrides(profile.id);
  const [crest, setCrestState] = useState(lastCrest);
  const setCrest = (c: number) => { lastCrest = c; setCrestState(c); };
  const r = useMemo(() => limits(prep, design, results, limitSettings(profile, overrides, crest)),
                    [prep, design, results, profile, overrides, crest]);
  const m = r.limiting;

  return (
    <div className="vw-view">
      <ViewInsights view="limits" />
      <ViewHeader title="Limits"
        actions={<Segmented label="Programme" size="sm" value={crest} onChange={setCrest}
                            options={[{ value: CREST_MUSIC_DB, label: "Music · 12 dB crest" }, { value: CREST_IEC_DB, label: "Test noise · 6 dB crest" }]} />}>
        How loud the speaker can play before a part reaches its limit: woofer and vent from the box model, midrange
        and tweeter from their measured response, the crossover resistors and both amplifier channels. Pink noise,
        20 Hz–20 kHz, on axis.
      </ViewHeader>
      <div className="vw-strip">
        <Readout label="Loudest clean level · 1 m" value={r.maxSpl1m.toFixed(0)} unit="dB SPL" tone="accent"
                 hint="Programme level at 1 m when the first part reaches its limit" />
        <Readout label={`At ${fmtSig2(r.settings.listenM)} m`} value={r.maxSplListen.toFixed(0)} unit="dB SPL"
                 hint="Free field. A room adds a few dB of reverberant sound" />
        <Readout label="Set by" value={m.label} tone={m.estimated ? "warn" : undefined} onClick={() => focusControl(m.focus)}
                 hint={m.estimated ? "This limit uses an estimate: enter the real value below" : "Show the control that changes it most"} />
        <Readout label="Drive then" value={r.maxV.toFixed(1)} unit="V rms" hint={`About ${(r.maxV ** 2 / 8).toFixed(0)} W of programme into 8 Ω`} />
        <p className="vw-strip-note">
          About {r.maxSpl1m.toFixed(0)} dB at 1 m {limitReason(m)}.
        </p>
      </div>
      <div className="lm-grid">
        <div className="lm-main">
          <LimitPlot r={r} />
        </div>
        <aside className="lm-side">
          <LevelCard r={r} />
          <DataSheetCard overrides={overrides} setOverrides={setOverrides} r={r} />
          <ExplainCard r={r} />
        </aside>
      </div>
    </div>
  );
}

const fmtSig2 = (x: number) => (Number.isInteger(x) ? x.toFixed(0) : x.toFixed(1));

// ---------------------------------------------------------------- max SPL vs frequency
const DASH: Record<Mechanism["kind"], number[] | undefined> = { xmax: undefined, thermal: [6, 4], vent: [2, 3], resistor: [6, 3, 2, 3], amp: [8, 4] };

function LimitPlot({ r }: { r: LimitsResult }) {
  const [probe, setProbe] = useProbe();
  const metrics = useStore(s => s.results!.metrics);
  const [ref, size] = useSize<HTMLDivElement>();
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(lastHidden));
  const toggle = (id: string) => setHidden(h => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); lastHidden = n; return n; });
  const all: PlotSeries[] = [
    { id: "env", label: "Lowest limit", x: r.f, y: r.envelope, color: "sum", width: 2.75, unit: "dB SPL" },
    ...r.mechanisms.map((m, k): PlotSeries => ({
      id: m.id, label: m.label + (m.estimated ? " (est.)" : ""), x: r.f, y: m.sineSpl, color: m.color, width: 1.5,
      dash: m.kind === "resistor" && k % 2 ? [3, 3] : m.id === "amp.ch1" ? [2, 2] : DASH[m.kind], opacity: 0.9, unit: "dB SPL",
    })),
  ];
  const series = all.filter(s => !hidden.has(s.id));
  let lo = Infinity;
  for (let i = 0; i < r.f.length; i++) if (Number.isFinite(r.envelope[i])) lo = Math.min(lo, r.envelope[i]);
  const y0 = Math.floor((lo - 5) / 10) * 10;
  const lim = r.limiting, i = nearest(r.f, lim.worstF);
  const markers: PlotMarker[] = lim.kind === "amp" || hidden.has(lim.id) ? [] : [{ x: r.f[i], y: lim.sineSpl[i], color: lim.color, shape: "diamond", size: 5, label: lim.label }];
  return (
    <>
      <div className="vw-plots lm-plot" ref={ref}>
        {size.height > 0 && (
          <Plot height={size.height} xRange={[20, 20000]} yRange={[y0, y0 + 70]} yLabel="Max SPL" yUnit="dB" legend={false}
                series={series} markers={markers} vLines={crossoverLines(metrics, false)} probeHz={probe} onProbe={setProbe}
                title={<span className="vw-plot-title">{withUnits("Max SPL at 1 m per part · sine")}</span>}
                ariaLabel="Maximum SPL per limiting mechanism" />
        )}
      </div>
      <ul className="lm-legend" aria-label="Curves">
        {all.map(s => (
          <li key={s.id}>
            <button type="button" className={"lm-leg" + (hidden.has(s.id) ? " is-off" : "")} aria-pressed={!hidden.has(s.id)} onClick={() => toggle(s.id)}>
              <svg width="18" height="6" aria-hidden><line x1="1" y1="3" x2="17" y2="3" stroke={`var(--${s.color})`} strokeWidth={s.id === "env" ? 2.5 : 1.75}
                                                            strokeDasharray={s.dash?.join(" ")} /></svg>
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
let lastHidden = new Set<string>();

function nearest(f: Float64Array, x: number): number {
  let best = 0;
  for (let i = 1; i < f.length; i++) if (Math.abs(Math.log(f[i] / x)) < Math.abs(Math.log(f[best] / x))) best = i;
  return best;
}

// ---------------------------------------------------------------- at a chosen level
function LevelCard({ r }: { r: LimitsResult }) {
  const top = Math.ceil(r.maxSpl1m + 8);
  const [level, setLevelState] = useState(() => lastLevel ?? Math.round(r.maxSpl1m - 3));
  const setLevel = (v: number) => { lastLevel = v; setLevelState(v); };
  const { V, loads } = loadsAt(r, level);
  const byId = new Map(r.mechanisms.map(m => [m.id, m]));
  const [all, setAll] = useState(false);
  const sorted = [...loads].sort((a, b) => b.fraction - a.fraction), rows = all ? sorted : sorted.slice(0, 6);
  return (
    <Card title="At this level" actions={<span className="vw-muted mono">{V.toFixed(1)} V rms</span>}>
      <Slider label="Programme level at 1 m" value={level} min={70} max={top} step={0.5} unit="dB" digits={1}
              onInput={setLevel} onCommit={setLevel} band={[r.maxSpl1m - 6, r.maxSpl1m]} marks={[Math.round(r.maxSpl1m)]} />
      <ul className="lm-bars">
        {rows.map(l => {
          const mm = byId.get(l.id)!, pct = l.fraction * 100;
          const tone = l.fraction >= 1 ? "bad" : l.fraction >= 0.7 ? "warn" : "good";
          return (
            <li key={l.id} className="lm-bar-row" style={{ ["--unit" as string]: `var(--${mm.color})` }}>
              <button type="button" className="lm-bar-name" onClick={() => focusControl(mm.focus)} title="Show the control that changes it most">
                {mm.label}{mm.estimated && <span className="lm-est" title="Estimate, not a data-sheet value">est.</span>}
              </button>
              <span className={`lm-bar-value mono is-${tone}`}>{pct >= 999 ? "> 999" : pct.toFixed(0)} %</span>
              <div className="vw-bar lm-bar" aria-hidden>
                <div className={`vw-bar-fill lm-fill is-${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <span className="lm-bar-detail mono">{fmtQ(l.value, mm.quantityUnit)} of {fmtQ(mm.limit, mm.quantityUnit)}</span>
            </li>
          );
        })}
      </ul>
      {sorted.length > 6 && (
        <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>{all ? "Show the closest six" : `Show all ${sorted.length}`}</Button>
      )}
      <p className="vw-foot">Bars show each part's share of its limit for this programme: peak stroke, peak vent speed and peak amplifier voltage at the crest factor chosen above, heat as long-term power.</p>
    </Card>
  );
}

function fmtQ(v: number, unit: Mechanism["quantityUnit"]): string {
  const d = unit === "mm" ? (v < 1 ? 2 : 1) : unit === "W" ? (v < 10 ? 1 : 0) : 1;
  return `${v.toFixed(d)} ${unit}`;
}

// ---------------------------------------------------------------- data-sheet editor
const SRC_LABEL: Record<LimitSource, string> = { profile: "data sheet", user: "yours", estimate: "estimate" };

function DataSheetCard({ overrides, setOverrides, r }: { overrides: LimitOverrides; setOverrides: (o: LimitOverrides) => void; r: LimitsResult }) {
  const profile = useStore(s => s.profile)!;
  const S = r.settings;
  const setUnit = (u: UnitId, k: "xmax_mm" | "p_rated_w" | "p_rated_hp_hz" | "z_nom_ohm", v: number | undefined) => {
    const units = { ...overrides.units, [u]: { ...overrides.units?.[u], [k]: v } };
    setOverrides({ ...overrides, units });
  };
  const has = !!(overrides.amp_vrms || overrides.listen_m || Object.values(overrides.units ?? {}).some(x => x && Object.values(x).some(v => v)));
  return (
    <Card title="Data sheet"
          actions={has ? <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setOverrides({})}>Reset</Button> : undefined}>
      {UNITS.map(({ id, name }) => {
        const sp = S.units[id], info = profile.units[id], user = overrides.units?.[id] ?? {};
        const field = (k: "xmax_mm" | "p_rated_w" | "p_rated_hp_hz" | "z_nom_ohm", label: ReactNode, unit: string, shown: number | undefined, src: LimitSource | null, aria: string) => (
          <label className="lm-ds-cell">
            <span className="lm-ds-name">{label}{src && <SrcTag src={src} />}</span>
            <NumberField label={`${name} ${aria}`} unit={unit} size={5} min={0}
                         value={user[k] ?? info[k] ?? null} placeholder={shown !== undefined ? fmtPlace(shown) : "none"}
                         onChange={v => setUnit(id, k, v > 0 ? v : undefined)} />
          </label>
        );
        return (
          <fieldset key={id} className="lm-ds-unit" style={{ ["--unit" as string]: `var(--${id})` }}>
            <legend>{name}</legend>
            <div className="lm-ds-grid">
              {field("xmax_mm", <>X<sub>max</sub></>, "mm", sp.xmax_mm, sp.src.xmax, "linear excursion")}
              {field("p_rated_w", "Power", "W", sp.p_rated_w, sp.src.p, "rated power")}
              {field("p_rated_hp_hz", "Rated through HP", "Hz", sp.p_rated_hp_hz, null, "rating test high-pass")}
              {field("z_nom_ohm", <>Z<sub>nom</sub></>, "Ω", sp.z_nom_ohm, sp.src.z, "nominal impedance")}
            </div>
          </fieldset>
        );
      })}
      <div className="lm-ds-row">
        <span className="lm-ds-label">Amplifier, clean sine per channel</span>
        <NumberField label="Amplifier maximum output" unit="V rms" size={4} min={0} value={overrides.amp_vrms ?? profile.amp?.max_vrms ?? null}
                     placeholder={String(DEFAULT_AMP_VRMS)} onChange={v => setOverrides({ ...overrides, amp_vrms: v > 0 ? v : undefined })} />
        <SrcTag src={S.amp.src} />
      </div>
      <div className="lm-ds-row">
        <span className="lm-ds-label">Listening distance</span>
        <NumberField label="Listening distance" unit="m" size={4} min={0} value={overrides.listen_m ?? null}
                     placeholder={String(DEFAULT_LISTEN_M)} onChange={v => setOverrides({ ...overrides, listen_m: v > 0 ? v : undefined })} />
      </div>
      <p className="vw-foot">
        X<sub>max</sub> is the linear excursion, one way. Power is the long-term (IEC noise) rating; for a tweeter
        rated through a high-pass, enter that frequency too. {S.amp.src === "estimate" && <>The amplifier is assumed to give {DEFAULT_AMP_VRMS} V rms (50 W into 8 Ω): enter the lab amplifier's figure. </>}
        Your values are kept on this computer for this profile.
      </p>
    </Card>
  );
}

const fmtPlace = (x: number) => (x >= 100 ? x.toFixed(0) : String(+x.toPrecision(2)));

function SrcTag({ src }: { src: LimitSource }) {
  return <span className={`lm-src is-${src}`}>{SRC_LABEL[src]}</span>;
}

// ---------------------------------------------------------------- explanation
function ExplainCard({ r }: { r: LimitsResult }) {
  return (
    <Card title="How this works">
      <ul className="vw-notes lm-notes">
        <li>Each curve is the level at 1 m where a steady sine at that frequency takes one part to its limit. The lowest curve wins at every frequency.</li>
        <li>The headline uses music-like pink noise: everything plays at once, so heat adds up over the whole band and peaks are {r.settings.crestDb} dB above the average.</li>
        <li>Stroke: woofer and vent from the fitted box model, midrange and tweeter from their measured pressure. The vent chuffs above {r.settings.ventMs} m/s.</li>
        <li>The Lab E responses include the amplifier's gain; it is taken out ({r.chainGainDb.toFixed(1)} dB, from the woofer model) so the levels are real.</li>
        <li>Crossover resistors are assumed to be {r.settings.resistorW} W types. A linear model: real drivers compress a little before these limits.</li>
      </ul>
    </Card>
  );
}
