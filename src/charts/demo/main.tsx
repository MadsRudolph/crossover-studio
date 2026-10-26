// Stand-alone page for reviewing the chart kit: npx vite src/charts/demo --config vite.config.ts --port 4180
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../ui/fonts";
import "../../ui/tokens.css";
import "./demo.css";
import { ChartsDemo } from "../Demo";

const params = new URLSearchParams(location.search);
const theme = params.get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ChartsDemo />
  </StrictMode>,
);
