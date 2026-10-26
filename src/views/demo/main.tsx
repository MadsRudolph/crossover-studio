// Stand-alone page for reviewing the views without the rest of the shell:
//   npx vite src/views/demo --config vite.config.ts --port 4192
// URL options: ?theme=light|dark, ?view=<ViewId>, ?snap=1 (adds two snapshots to compare).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../ui/fonts";
import "../../ui/tokens.css";
import "../../ui/base.css";
import "../../ui/primitives.css";
import "../../styles/shell.css";
import { Toaster } from "../../ui";
import { Workspace } from "../../ui/shell/Workspace";
import { BUNDLED_PROFILES, useStore, type ViewId } from "../../state/store";

const params = new URLSearchParams(location.search);
const theme = params.get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

const st = useStore.getState();
st.loadProfile(BUNDLED_PROFILES[0]);
const view = params.get("view") as ViewId | null;
if (view) st.setView(view);
if (params.get("snap")) {
  st.snapshot("Baseline");
  st.edit(d => { d.digital.fc = 400; d.digital.align = "BW4"; });
  st.snapshot("BW4 at 400 Hz");
  st.edit(d => { d.digital.fc = 300; d.digital.align = "LR4"; d.tw.vals.C1 = 4.7e-6; });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <Workspace />
    </div>
    <Toaster />
  </StrictMode>,
);
