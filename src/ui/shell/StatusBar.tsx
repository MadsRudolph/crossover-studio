import { useEffect, useMemo, useState } from "react";
import { Crosshair, Cpu, FolderOpen } from "lucide-react";
import { compute, probeSample } from "../../engine";
import { useStore } from "../../state/store";
import type { Check, CheckState, Results } from "../../types";
import { NumberField } from "../NumberField";
import { Tooltip } from "../Tooltip";
import { fmtDb, fmtFreq, fmtMs, fmtOhm, parseNumber } from "../format";
import { focusControl } from "./commands";
import { CHECK_FOCUS } from "../inspector/focus";

interface Chip { id: string; label: string; value: string; check?: Check }

function chips(r: Results): Chip[] {
  const by = (id: string) => r.checks.find(c => c.id === id);
  const m = r.metrics;
  const out: Chip[] = [
    { id: "flat", label: "Flat", value: fmtDb(m.on.spread), check: by("flat") },
  ];
  if (m.off30) out.push({ id: "off", label: `${m.offAngle ?? "30"}°`, value: fmtDb(m.off30.spread), check: by("off") });
  out.push(
    { id: "xwm", label: "W/M", value: fmtFreq(m.x_wm), check: by("xwm") },
    { id: "xmt", label: "M/T", value: fmtFreq(m.x_mt), check: by("xmt") },
    { id: "bass", label: "f3", value: fmtFreq(r.box.f3), check: by("bass") },
    { id: "load", label: "Min load", value: fmtOhm(m.Zamp2_min), check: by("load") },
  );
  return out;
}

/**
 * Time of a full recompute of the current design, measured once the person pauses (measuring mid-drag
 * would double the work). The engine memoises filter responses by value, so the design is nudged by a
 * negligible amount to force a cold evaluation instead of timing a cache hit.
 */
function useEngineTime(): number | null {
  const prep = useStore(s => s.prep);
  const design = useStore(s => s.design);
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    if (!prep) { setMs(null); return; }
    const t = window.setTimeout(() => {
      try {
        const cold = { ...design, Rdcr: design.Rdcr + 1e-12, digital: { ...design.digital, fc: design.digital.fc * (1 + 1e-12) } };
        const t0 = performance.now();
        compute(prep, cold);
        setMs(performance.now() - t0);
      } catch { setMs(null); }
    }, 350);
    return () => window.clearTimeout(t);
  }, [prep, design]);
  return ms;
}

const UNIT_NAME = { woof: "Woofer", mid: "Mid", tw: "Tweeter", sum: "Sum" };

const STATE_WORD: Record<CheckState, string> = { good: "OK", warn: "Check", bad: "Problem" };

export function StatusBar() {
  const results = useStore(s => s.results);
  const prep = useStore(s => s.prep);
  const profile = useStore(s => s.profile);
  const probe = useStore(s => s.probe);
  const angle = useStore(s => s.ui.angle);
  const setProbe = useStore(s => s.setProbe);
  const engineMs = useEngineTime();
  const list = useMemo(() => (results ? chips(results) : []), [results]);
  const sample = useMemo(() => {
    if (!results || !prep) return null;
    try { return probeSample(prep, results, probe, angle === "both" ? "0" : angle); } catch { return null; }
  }, [prep, results, probe, angle]);

  return (
    <footer className="cs-statusbar" aria-label="Status">
      <div className="cs-sb-chips">
        {list.map(c => (
          <Tooltip key={c.id} title={c.check?.title} content={c.check ? `${c.check.detail}. ${STATE_WORD[c.check.state]}.` : undefined} side="top">
            <button type="button" className={`cs-chip is-${c.check?.state ?? "idle"}`}
                    onClick={() => CHECK_FOCUS[c.id] && focusControl(CHECK_FOCUS[c.id])}>
              <span className="cs-chip-dot" aria-hidden />
              <span className="cs-chip-label">{c.label}</span>
              <span className="cs-chip-value mono">{c.value}</span>
            </button>
          </Tooltip>
        ))}
        {!results && <span className="cs-sb-muted">No design loaded</span>}
      </div>

      <div className="cs-sb-right">
        <div className="cs-sb-probe">
          <Tooltip title="Probe" shortcut="P" side="top" content="The frequency every plot marks. Click a plot, or type a value here (e.g. 2.5k).">
            <span className="cs-sb-probe-icon"><Crosshair size={13} strokeWidth={1.9} aria-hidden /></span>
          </Tooltip>
          <NumberField id="cs-probe-input" label="Probe frequency" value={probe} size={7}
                       format={v => fmtFreq(v)} parse={s => parseNumber(s)} min={20} max={20000}
                       step={Math.max(1, Math.round(probe / 50))} onChange={setProbe} />
          {sample && (
            <Tooltip side="top" title={`At ${fmtFreq(sample.f)}${sample.angle === "30" ? ", 30°" : ""}`}
                     content={<span className="cs-sb-probe-tip">{(["woof", "mid", "tw", "sum"] as const).map(u => (
                       <span key={u} className="mono"><i style={{ background: `var(--${u})` }} />{UNIT_NAME[u]} {fmtDb(sample.units[u].relDb, { sign: true })}</span>
                     ))}<em>relative to the system level</em></span>}>
              <span className="cs-sb-level mono" tabIndex={0}>Σ {fmtDb(sample.units.sum.relDb, { sign: true })}</span>
            </Tooltip>
          )}
        </div>
        {profile && (
          <span className="cs-sb-item" title={profile.notes}>
            <FolderOpen size={12} strokeWidth={1.9} aria-hidden />
            {profile.name}
          </span>
        )}
        <span className="cs-sb-item mono" title="Time the engine needs for a full recompute of every curve and check">
          <Cpu size={12} strokeWidth={1.9} aria-hidden />
          {engineMs === null ? "—" : fmtMs(engineMs)}
        </span>
      </div>
    </footer>
  );
}
