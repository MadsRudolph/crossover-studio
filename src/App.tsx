// Application shell: title bar, inspector | workspace (+ signal-chain dock), status bar, and the layers
// above them (palette, help, wizard, export, toasts). Panel sizes are remembered between sessions.
import { useEffect, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { BUNDLED_PROFILES, useStore } from "./state/store";
import { Toaster } from "./ui";
import { useApplyTheme } from "./ui/theme";
import { TitleBar } from "./ui/shell/TitleBar";
import { StatusBar } from "./ui/shell/StatusBar";
import { Workspace } from "./ui/shell/Workspace";
import { Dock } from "./ui/shell/Dock";
import { CommandPalette } from "./ui/shell/CommandPalette";
import { HelpDialog } from "./ui/shell/HelpDialog";
import { Splash } from "./ui/shell/Splash";
import { ErrorBoundary } from "./ui/shell/ErrorBoundary";
import { useGlobalShortcuts } from "./ui/shell/shortcuts";
import { Inspector } from "./ui/inspector/Inspector";
import { ImportWizard } from "./wizard/ImportWizard";
import { ExportSheet } from "./export/ExportSheet";

// localStorage can throw (private mode, blocked storage): layouts then simply are not remembered
const layoutStorage = {
  getItem: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } },
};

const DOCK_COLLAPSED_PX = 36;

function useBoot(): "loading" | "leaving" | "done" {
  const profile = useStore(s => s.profile);
  const settled = useStore(s => !!s.results || !!s.error);
  const [phase, setPhase] = useState<"loading" | "leaving" | "done">(profile ? "done" : "loading");
  useEffect(() => {
    if (useStore.getState().profile) return;
    // give the splash one painted frame before the (synchronous) fit and prepare run
    const t = window.setTimeout(() => useStore.getState().loadProfile(BUNDLED_PROFILES[0]), 60);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (phase !== "loading" || !settled) return;
    setPhase("leaving");
    const t = window.setTimeout(() => setPhase("done"), 420);
    return () => window.clearTimeout(t);
  }, [settled, phase]);
  return phase;
}

/** Below this window height the views need the room more than the signal chain does. */
const DOCK_AUTO_COLLAPSE_PX = 850;
/** Set once the user expands or collapses the dock: their choice is not overridden afterwards. */
let dockTouched = false;

/** Fold the signal-chain dock to its header on short windows (and unfold it again when the window grows),
 *  until the user toggles it by hand. */
function useAutoCollapseDock(dockRef: ReturnType<typeof usePanelRef>) {
  useEffect(() => {
    let auto = false;
    const apply = () => {
      const p = dockRef.current;
      if (!p || dockTouched) return;
      const short = window.innerHeight < DOCK_AUTO_COLLAPSE_PX;
      if (short && !p.isCollapsed()) { p.collapse(); auto = true; }
      else if (!short && auto && p.isCollapsed()) { p.expand(); auto = false; }
    };
    // the panel ref is attached after the first layout pass
    const raf = requestAnimationFrame(apply);
    window.addEventListener("resize", apply);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", apply); };
  }, [dockRef]);
}

export default function App() {
  useApplyTheme();
  useGlobalShortcuts();
  const boot = useBoot();
  const wizard = useStore(s => s.ui.wizard);
  const exportSheet = useStore(s => s.ui.exportSheet);

  const main = useDefaultLayout({ id: "cs-layout-main", storage: layoutStorage, panelIds: ["inspector", "work"] });
  const work = useDefaultLayout({ id: "cs-layout-work", storage: layoutStorage, panelIds: ["view", "dock"] });
  const dockRef = usePanelRef();
  const [dock, setDock] = useState({ collapsed: false, height: 160 });
  useAutoCollapseDock(dockRef);

  return (
    <>
      <div className="cs-app">
        <TitleBar />
        <Group id="cs-layout-main" orientation="horizontal" className="cs-main" defaultLayout={main.defaultLayout}
               onLayoutChanged={main.onLayoutChanged}>
          <Panel id="inspector" defaultSize={320} minSize={280} maxSize={480} groupResizeBehavior="preserve-pixel-size" className="cs-pane-inspector">
            <ErrorBoundary label="The inspector">
              <Inspector />
            </ErrorBoundary>
          </Panel>
          <Separator className="cs-sep cs-sep-v" aria-label="Resize the inspector" />
          <Panel id="work" minSize={560} className="cs-pane-work">
            <Group id="cs-layout-work" orientation="vertical" defaultLayout={work.defaultLayout} onLayoutChanged={work.onLayoutChanged}>
              <Panel id="view" minSize={240}>
                <Workspace />
              </Panel>
              <Separator className="cs-sep cs-sep-h" aria-label="Resize the signal chain dock" />
              <Panel
                id="dock"
                panelRef={dockRef}
                defaultSize={200}
                minSize={110}
                maxSize="60%"
                collapsible
                collapsedSize={DOCK_COLLAPSED_PX}
                groupResizeBehavior="preserve-pixel-size"
                onResize={size => setDock({ collapsed: size.inPixels <= DOCK_COLLAPSED_PX + 1, height: size.inPixels })}
              >
                <Dock
                  collapsed={dock.collapsed}
                  height={dock.height}
                  onToggle={() => {
                    const p = dockRef.current; if (!p) return;
                    dockTouched = true; // the user's own choice wins over the automatic one from now on
                    if (p.isCollapsed()) p.expand(); else p.collapse();
                  }}
                />
              </Panel>
            </Group>
          </Panel>
        </Group>
        <StatusBar />
      </div>

      <CommandPalette />
      <HelpDialog />
      {wizard && <ImportWizard />}
      {exportSheet && <ExportSheet />}
      <Toaster />
      {boot !== "done" && <Splash leaving={boot === "leaving"} message={`Fitting ${BUNDLED_PROFILES[0]?.name ?? "the example"}…`} />}
    </>
  );
}
