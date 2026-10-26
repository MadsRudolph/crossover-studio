import { ChevronDown, Workflow } from "lucide-react";
import { SignalChain } from "../../schematic/SignalChain";
import { useStore } from "../../state/store";
import { ErrorBoundary } from "./ErrorBoundary";

/** Bottom dock: the live signal chain. The header always stays visible; collapsing keeps just the header. */
export function Dock({ collapsed, height, onToggle }: { collapsed: boolean; height: number; onToggle(): void }) {
  const ready = useStore(s => !!s.results);
  return (
    <section className={"cs-dock" + (collapsed ? " is-collapsed" : "")} aria-label="Signal chain">
      <header className="cs-dock-head">
        <button type="button" className="cs-dock-toggle" aria-expanded={!collapsed} onClick={onToggle}>
          <Workflow size={14} strokeWidth={1.75} aria-hidden />
          <span className="label-caps">Signal chain</span>
          <ChevronDown size={14} className="cs-dock-chev" aria-hidden />
        </button>
        <span className="cs-dock-hint">Amplifier → MiniDSP → passive filters → drivers. Click a part to edit it.</span>
      </header>
      {!collapsed && ready && (
        <div className="cs-dock-body">
          <ErrorBoundary label="The signal chain">
            <SignalChain compact={height < 170} />
          </ErrorBoundary>
        </div>
      )}
    </section>
  );
}
