// The Export sheet: hands the design to the MiniDSP, LTspice, the parts basket and other group members.
// Rendered by App while store.ui.exportSheet is true.
import { CircuitBoard, Cpu, FileJson, FileText, ListChecks, Upload } from "lucide-react";
import { useState } from "react";
import { useStore } from "../state/store";
import { useShell, DEFAULT_DESIGN_NAME } from "../ui/shell/shellState";
import { Button, EmptyState, Sheet, Tabs, type TabItem } from "../ui";
import { DesignFilePanel } from "./DesignFilePanel";
import { LtspicePanel } from "./LtspicePanel";
import { MiniDspPanel } from "./MiniDspPanel";
import { PartsPanel } from "./PartsPanel";
import { ReportPanel } from "./ReportPanel";
import "./export.css";

type TabId = "minidsp" | "ltspice" | "parts" | "file" | "report";
const TAB_KEY = "crossover-studio:export-tab";

const TABS: TabItem<TabId>[] = [
  { id: "minidsp", label: "MiniDSP", icon: Cpu, hint: "Biquad text for outputs 1 and 2" },
  { id: "ltspice", label: "LTspice", icon: CircuitBoard, hint: "The whole system as a ready-to-run schematic" },
  { id: "parts", label: "Parts list", icon: ListChecks, hint: "Components for the passive boards" },
  { id: "file", label: "Design file", icon: FileJson, hint: "Save or open a .xstudio design" },
  { id: "report", label: "Report", icon: FileText, hint: "LaTeX and Markdown report section, figures and the quiz numbers" },
];

function initialTab(): TabId {
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (TABS.some(x => x.id === t)) return t as TabId;
  } catch { /* storage unavailable */ }
  return "minidsp";
}

export function ExportSheet() {
  const profile = useStore(s => s.profile);
  const prep = useStore(s => s.prep);
  const design = useStore(s => s.design);
  const error = useStore(s => s.error);
  const designName = useShell(s => (profile && s.names[profile.id]) || DEFAULT_DESIGN_NAME);
  const [tab, setTab] = useState<TabId>(initialTab);
  const close = () => useStore.getState().setUi({ exportSheet: false });
  const choose = (t: TabId) => {
    setTab(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* storage unavailable */ }
  };

  return (
    <Sheet open onClose={close} size="lg" title="Export"
           description={profile ? `${designName} · ${profile.name}` : "Hand the design to the MiniDSP, LTspice and your report."}
           footer={<Button onClick={close}>Done</Button>}>
      {!profile || !prep ? (
        <EmptyState icon={Upload} title="Nothing to export yet"
                    description="Open the example profile or import your group's measurements first. The export is built from the profile and the design."
                    action={<Button variant="primary" onClick={() => { close(); useStore.getState().setUi({ wizard: true }); }}>Import measurements</Button>} />
      ) : (
        <div className="xs-root">
          <Tabs items={TABS} value={tab} onChange={choose} label="Export format" idBase="xs-tab" className="xs-tabs" />
          {error && (tab === "ltspice" || tab === "parts" || tab === "report") && (
            <div className="xs-banner is-bad" role="alert"><div><b>The design has a problem</b><span>{error}</span></div></div>
          )}
          <div id="xs-tab-panel" role="tabpanel" aria-labelledby={`xs-tab-tab-${tab}`} className="xs-tabpanel" key={tab}>
            {tab === "minidsp" && <MiniDspPanel profile={profile} design={design} />}
            {tab === "ltspice" && <LtspicePanel prep={prep} design={design} designName={designName} />}
            {tab === "parts" && <PartsPanel profile={profile} design={design} designName={designName} />}
            {tab === "file" && <DesignFilePanel profile={profile} prep={prep} designName={designName} />}
            {tab === "report" && <ReportPanel profile={profile} prep={prep} design={design} designName={designName} />}
          </div>
        </div>
      )}
    </Sheet>
  );
}
