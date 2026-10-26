// Stand-alone harness for the 3D viewport: `npx vite src/viewport3d/demo --port 4181`.
// URL parameters: ?preset=front|threeQuarter|side|top, ?theme=light|dark, ?probe=<Hz>, ?xray, ?nowaves, ?still, ?fps, ?mode=plugged|one|two.
import React from "react";
import ReactDOM from "react-dom/client";
import "../../ui/fonts";
import "../../ui/tokens.css";
import { BUNDLED_PROFILES, useStore } from "../../state/store";
import { Viewport3D, type CameraPreset } from "..";

const q = new URLSearchParams(location.search);
document.documentElement.dataset.theme = q.get("theme") === "light" ? "light" : "dark";
Object.assign(document.body.style, { margin: "0", background: "var(--bg)", height: "100vh" });

const store = useStore.getState();
store.loadProfile(BUNDLED_PROFILES[0]);
if (q.has("probe")) store.setProbe(Number(q.get("probe")));
const mode = q.get("mode");
if (mode === "plugged" || mode === "one" || mode === "two") store.edit(d => { d.box.mode = mode; }, false);
store.setUi({ xray: q.has("xray"), waves: !q.has("nowaves"), animate: !q.has("still") });

function Harness() {
  const probe = useStore(s => s.probe);
  const setProbe = useStore(s => s.setProbe);
  const focus = useStore(s => s.ui.focus);
  return (
    <div style={{ display: "grid", gridTemplateRows: "1fr auto", height: "100vh" }}>
      <Viewport3D initialPreset={(q.get("preset") as CameraPreset | null) ?? undefined} />
      <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 16px", color: "var(--text-2)", font: "12px var(--font-ui)", borderTop: "1px solid var(--line)" }}>
        <label htmlFor="probe">Probe</label>
        <input id="probe" type="range" min={Math.log10(20)} max={Math.log10(20000)} step={0.001} value={Math.log10(probe)}
          onChange={e => setProbe(10 ** Number(e.target.value))} style={{ flex: 1 }} />
        <span style={{ font: "12px var(--font-mono)", minWidth: 80 }}>{probe.toFixed(0)} Hz</span>
        <span>focus: {focus ?? "none"}</span>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><Harness /></React.StrictMode>);
