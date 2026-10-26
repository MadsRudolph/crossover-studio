import React from "react";
import ReactDOM from "react-dom/client";
import "./ui/fonts";
import "./ui/tokens.css";
import "./ui/base.css";
import "./ui/primitives.css";
import "./styles/shell.css";
import "./styles/inspector.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
