// Stand-alone harness for the signal chain: `npx vite src/schematic/demo --config vite.config.ts --port 4182`.
// URL parameters: ?theme=light|dark, ?probe=<Hz>, ?still, ?rich (LP3 + pads + Zobels), ?h=<dock height px>,
// ?empty (no profile loaded), ?dock (bottom row is the shell's real Dock at that height instead of a bare compact chain).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../ui/fonts";
import "../../ui/tokens.css";
import "../../ui/base.css";
import "../../ui/primitives.css";
import "../../styles/shell.css";
import { Dock } from "../../ui/shell/Dock";
import { BUNDLED_PROFILES, useStore } from "../../state/store";
import { SignalChain } from "../SignalChain";

const q = new URLSearchParams(location.search);
document.documentElement.dataset.theme = q.get("theme") === "light" ? "light" : "dark";
Object.assign(document.body.style, { margin: "0", background: "var(--bg)", height: "100vh" });

const store = useStore.getState();
if (!q.has("empty")) store.loadProfile(BUNDLED_PROFILES[0]);
store.setProbe(Number(q.get("probe") ?? 1000));
store.setUi({ animate: !q.has("still") });
if (q.has("rich")) {
  store.edit(d => {
    d.mid.topo = "LP3"; d.mid.vals = { L1: 1e-3, C1: 6.8e-6, L2: 0.82e-3 }; d.mid.pad = { Rs: 2.2, Rp: 4.7 }; d.mid.zobel = { R: 5.6, C: 4.7e-6 };
    d.tw.topo = "HP3"; d.tw.vals = { C1: 5.6e-6, L1: 2.2e-4, C2: 10e-6 }; d.pol.tw = -1;
  }, false);
}
const dock = Number(q.get("h") ?? 185);

function Harness() {
  const probe = useStore(s => s.probe);
  const focus = useStore(s => s.ui.focus);
  return (
    <div style={{ display: "grid", gridTemplateRows: `1fr auto ${dock}px`, height: "100vh", gap: 0 }}>
      <div style={{ borderBottom: "1px solid var(--line)", minHeight: 0 }}><SignalChain /></div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "6px 16px", color: "var(--text-2)", font: "12px var(--font-ui)", borderBottom: "1px solid var(--line)" }}>
        <label htmlFor="probe">Probe</label>
        <input id="probe" type="range" min={Math.log10(20)} max={Math.log10(20000)} step={0.001} value={Math.log10(probe)}
          onChange={e => useStore.getState().setProbe(10 ** Number(e.target.value))} style={{ flex: 1 }} />
        <span style={{ font: "12px var(--font-mono)", minWidth: 80 }}>{probe.toFixed(0)} Hz</span>
        <span id="focus">focus: {focus ?? "none"}</span>
      </div>
      <div style={{ minHeight: 0 }}>
        {q.has("dock") ? <Dock collapsed={false} height={dock} onToggle={() => {}} /> : <SignalChain compact />}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>);
