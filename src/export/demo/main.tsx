// Stand-alone page for reviewing the export sheet: npx vite src/export/demo --config vite.config.ts --port 4190
// URL options: ?theme=light|dark  &tab=minidsp|ltspice|parts|file
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../ui/fonts";
import "../../ui/tokens.css";
import "../../ui/base.css";
import "../../ui/primitives.css";
import { BUNDLED_PROFILES, useStore } from "../../state/store";
import { Toaster } from "../../ui";
import { ExportSheet } from "../ExportSheet";

const params = new URLSearchParams(location.search);
const theme = params.get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
const tab = params.get("tab");
if (tab) try { localStorage.setItem("crossover-studio:export-tab", tab); } catch { /* storage unavailable */ }

useStore.getState().loadProfile(BUNDLED_PROFILES[0]);
useStore.getState().setUi({ exportSheet: true });

function Demo() {
  const open = useStore(s => s.ui.exportSheet);
  return (
    <>
      <button style={{ margin: 24 }} onClick={() => useStore.getState().setUi({ exportSheet: true })}>Open export</button>
      {open && <ExportSheet />}
      <Toaster />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Demo /></StrictMode>);
