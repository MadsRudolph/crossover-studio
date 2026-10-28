// Application shell: title bar, inspector | workspace (+ signal-chain dock) | optional AI chat, status bar,
// and the layers above them (palette, help, wizard, export, toasts). Panel sizes are remembered between
// sessions (the layout with the chat open is remembered separately from the one without).
// How they share the window (docs/LOOK_AND_FEEL.md): the inspector folds to an icon rail, the dock folds
// on short windows, the chat is a drawer over the workspace below CHAT_DOCK_PX and a column above it, and
// focus mode (F) leaves just the title bar, the tabs and the view.
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
import { useShell } from "./ui/shell/shellState";
import { useInspectorChrome } from "./ui/inspector/chrome";
import { Inspector } from "./ui/inspector/Inspector";
import { ImportWizard } from "./wizard/ImportWizard";
import { ExportSheet } from "./export/ExportSheet";
import { ChatPanel } from "./chat/ChatPanel";

// localStorage can throw (private mode, blocked storage): layouts then simply are not remembered
const layoutStorage = {
  getItem: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } },
};

const DOCK_COLLAPSED_PX = 34;
/** The inspector's icon rail (--rail-w). */
const RAIL_PX = 56;
/** From this window width the chat is a resizable column beside the workspace; below it, a drawer over it. */
const CHAT_DOCK_PX = 1600;

/** `?chat=1` opens the chat panel on start and `?focus=1` starts in focus mode (deep links, screenshots),
 *  like `?sheet=` does for the sheets. */
function useUrlChat() {
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("chat") === "1") useStore.getState().setUi({ chat: true });
      if (q.get("focus") === "1") useShell.getState().setFocus(true);
    }
    catch { /* no URL to read */ }
  }, []);
}

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
const DOCK_AUTO_COLLAPSE_PX = 1000;
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

/** The window's inner width, updated on resize. */
function useWindowWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

/** Lets the inspector's rail (and its header) widen or fold the column it sits in. */
function useInspectorPanel(ref: ReturnType<typeof usePanelRef>) {
  useEffect(() => {
    const c = useInspectorChrome.getState();
    c.setExpand(() => { const p = ref.current; if (p?.isCollapsed()) p.expand(); });
    c.setCollapse(() => { const p = ref.current; if (p && !p.isCollapsed()) p.collapse(); });
    return () => { c.setExpand(null); c.setCollapse(null); };
  }, [ref]);
}

export default function App() {
  useApplyTheme();
  useGlobalShortcuts();
  const boot = useBoot();
  const wizard = useStore(s => s.ui.wizard);
  const exportSheet = useStore(s => s.ui.exportSheet);
  const chat = useStore(s => s.ui.chat);
  useUrlChat();

  const focus = useShell(x => x.focus);
  const width = useWindowWidth();
  const chatDocked = chat && width >= CHAT_DOCK_PX;

  const main = useDefaultLayout({ id: "cs-layout-main", storage: layoutStorage, panelIds: chatDocked ? ["inspector", "work", "chat"] : ["inspector", "work"] });
  const work = useDefaultLayout({ id: "cs-layout-work", storage: layoutStorage, panelIds: ["view", "dock"] });
  const dockRef = usePanelRef();
  const inspRef = usePanelRef();
  useAutoCollapseDock(dockRef);
  useInspectorPanel(inspRef);

  return (
    <>
      <div className={"cs-app" + (focus ? " is-focus" : "")}>
        <TitleBar />
        <div className="cs-main-wrap">
          <Group id="cs-layout-main" orientation="horizontal" className="cs-main" defaultLayout={main.defaultLayout}
                 onLayoutChanged={main.onLayoutChanged}>
            <Panel id="inspector" panelRef={inspRef} defaultSize={320} minSize={280} maxSize={480} collapsible collapsedSize={RAIL_PX}
                   groupResizeBehavior="preserve-pixel-size" className="cs-pane-inspector">
              <ErrorBoundary label="The inspector">
                <Inspector />
              </ErrorBoundary>
            </Panel>
            <Separator className="cs-sep cs-sep-v cs-sep-insp" aria-label="Resize the inspector" />
            <Panel id="work" minSize={560} className="cs-pane-work">
              <Group id="cs-layout-work" orientation="vertical" defaultLayout={work.defaultLayout} onLayoutChanged={work.onLayoutChanged}>
                <Panel id="view" minSize={240}>
                  <Workspace />
                </Panel>
                <Separator className="cs-sep cs-sep-h cs-sep-dock" aria-label="Resize the signal chain dock" />
                <Panel
                  id="dock"
                  panelRef={dockRef}
                  defaultSize={200}
                  minSize={110}
                  maxSize="60%"
                  collapsible
                  collapsedSize={DOCK_COLLAPSED_PX}
                  groupResizeBehavior="preserve-pixel-size"
                  className="cs-pane-dock"
                >
                  <Dock
                    collapsedPx={DOCK_COLLAPSED_PX}
                    onToggle={() => {
                      const p = dockRef.current; if (!p) return;
                      dockTouched = true; // the user's own choice wins over the automatic one from now on
                      if (p.isCollapsed()) p.expand(); else p.collapse();
                    }}
                  />
                </Panel>
              </Group>
            </Panel>
            {chatDocked && (
              <>
                <Separator className="cs-sep cs-sep-v" aria-label="Resize the chat" />
                <Panel id="chat" defaultSize={380} minSize={300} maxSize={600} groupResizeBehavior="preserve-pixel-size" className="cs-pane-chat">
                  <ErrorBoundary label="The chat">
                    <ChatPanel />
                  </ErrorBoundary>
                </Panel>
              </>
            )}
          </Group>
          {chat && !chatDocked && (
            <div className="cs-chat-drawer">
              <ErrorBoundary label="The chat">
                <ChatPanel />
              </ErrorBoundary>
            </div>
          )}
        </div>
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
