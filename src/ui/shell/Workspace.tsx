import { ChevronDown, Import, RotateCcw, TriangleAlert } from "lucide-react";
import { BUNDLED_PROFILES, useStore, type ViewId } from "../../state/store";
import { UNIT_IDS } from "../../types";
import { VIEWS } from "../../views";
import { Button } from "../Button";
import { Checkbox } from "../Toggle";
import { Menu } from "../Menu";
import { EmptyState } from "../EmptyState";
import { Segmented } from "../Segmented";
import { Tabs } from "../Tabs";
import { ErrorBoundary } from "./ErrorBoundary";

/** Which header tools a view uses: the trace toggles and/or the measurement-angle choice. Compare draws
 *  only system sums (no traces); Directivity always draws on and off axis together (no angle choice). */
const VIEW_TOOLS: Partial<Record<ViewId, { traces: boolean; angle: boolean }>> = {
  response: { traces: true, angle: true },
  phase: { traces: true, angle: true },
  directivity: { traces: true, angle: false },
  compare: { traces: false, angle: true },
};
const TRACE_COLOR = { woof: "var(--woof)", mid: "var(--mid)", tw: "var(--tw)", sum: "var(--sum)" };
const TRACE_NAME = { woof: "Woofer", mid: "Mid", tw: "Tweeter", sum: "Sum" };

export function Workspace() {
  const view = useStore(s => s.view);
  const setView = useStore(s => s.setView);
  const results = useStore(s => s.results);
  const error = useStore(s => s.error);
  const def = VIEWS.find(v => v.id === view) ?? VIEWS[0];
  const Active = def.component;

  return (
    <section className="cs-workspace" aria-label="Workspace">
      <div className="cs-ws-head">
        <Tabs
          label="Views"
          idBase="cs-view"
          value={def.id}
          onChange={setView}
          items={VIEWS.map((v, i) => ({ id: v.id, label: v.title, icon: v.icon, shortcut: i < 9 ? String(i + 1) : undefined }))}
        />
        <div className="cs-ws-tools">{VIEW_TOOLS[def.id] && results && <CurveTools {...VIEW_TOOLS[def.id]!} />}</div>
      </div>
      <div className="cs-ws-body" id="cs-view-panel" role="tabpanel" aria-labelledby={`cs-view-tab-${def.id}`}>
        {results ? (
          <ErrorBoundary label={`The ${def.title} view`} resetKey={def.id}>
            <div className="cs-view" key={def.id}><Active /></div>
          </ErrorBoundary>
        ) : (
          <NoDesign error={error} />
        )}
      </div>
    </section>
  );
}

const ON_AXIS = ["0"];

function CurveTools({ traces, angle }: { traces: boolean; angle: boolean }) {
  const ui = useStore(s => s.ui);
  const angles = useStore(s => s.prep?.angles) ?? ON_AXIS;
  const setUi = useStore(s => s.setUi);
  const off = angles.filter(a => a !== "0");
  // the off-axis angle "Both" pairs with on axis: 30° when measured, else the first one (as the metrics)
  const judged = off.includes("30") ? "30" : off[0];
  const ids = [...UNIT_IDS, "sum"] as const;
  const toggle = (u: (typeof ids)[number]) => setUi({ visible: { ...ui.visible, [u]: !ui.visible[u] } });
  const shownCount = ids.filter(u => ui.visible[u]).length;
  return (
    <>
      {traces && (
        <>
          <div className="cs-traces" role="group" aria-label="Visible traces">
            {ids.map(u => (
              <Checkbox key={u} checked={ui.visible[u]} color={TRACE_COLOR[u]}
                        onChange={v => setUi({ visible: { ...ui.visible, [u]: v } })}>
                {TRACE_NAME[u]}
              </Checkbox>
            ))}
          </div>
          {/* the same toggles as a menu, shown instead of the checkboxes when the header is narrow */}
          <div className="cs-traces-menu">
            <Menu label="Visible traces" align="end"
                  trigger={<Button size="sm" variant="ghost" iconRight={ChevronDown}>Traces <span className="mono cs-muted">{shownCount}/4</span></Button>}
                  items={ids.map(u => ({ id: u, label: TRACE_NAME[u], checked: ui.visible[u],
                                         icon: <span className="cs-trace-swatch" style={{ background: TRACE_COLOR[u] }} />, onSelect: () => toggle(u) }))} />
          </div>
        </>
      )}
      {angle && off.length > 0 && (
        <Segmented label="Measurement angle" size="sm" value={ui.angle} onChange={a => setUi({ angle: a })}
                   options={[
                     { value: "0", label: "0°", hint: "On axis" },
                     ...off.map(a => ({ value: a, label: `${a}°`, hint: `${a}° off axis, horizontally` })),
                     { value: "both", label: "Both", hint: `On axis solid, ${judged}° dashed` },
                   ]} />
      )}
    </>
  );
}

function NoDesign({ error }: { error: string | null }) {
  const setUi = useStore(s => s.setUi);
  const loadProfile = useStore(s => s.loadProfile);
  if (error) {
    return (
      <div className="cs-fill-center">
        <EmptyState
          tone="bad"
          icon={TriangleAlert}
          title="This profile could not be loaded"
          description={<><span>{error}</span><br /><span>Check that it has 0° responses for all three units and the woofer impedances.</span></>}
          action={<>
            <Button variant="primary" icon={Import} onClick={() => setUi({ wizard: true })}>Import measurements</Button>
            <Button icon={RotateCcw} onClick={() => loadProfile(BUNDLED_PROFILES[0])}>Open the example</Button>
          </>}
        />
      </div>
    );
  }
  return (
    <div className="cs-fill-center">
      <EmptyState
        icon={Import}
        title="No measurements loaded"
        description="Import your Lab D impedances and Lab E responses (.mat, Matlab2LTspice .txt or CSV), or open the bundled example to explore."
        action={<>
          <Button variant="primary" icon={Import} onClick={() => setUi({ wizard: true })}>Import measurements</Button>
          <Button onClick={() => loadProfile(BUNDLED_PROFILES[0])}>Open the example</Button>
        </>}
      />
    </div>
  );
}
