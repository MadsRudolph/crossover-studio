import { useEffect, useRef, useState } from "react";
import { Camera, CircleQuestionMark, Download, Monitor, Moon, Redo2, Search, Sparkles, Square, Sun, Undo2 } from "lucide-react";
import { useStore } from "../../state/store";
import { ProfileSwitcher } from "../../wizard/ProfileSwitcher";
import { Button, IconButton } from "../Button";
import { Kbd } from "../Kbd";
import { Logo } from "../Logo";
import { Tooltip } from "../Tooltip";
import { fmtFixed } from "../format";
import { cycleTheme, openExport, snapshotNow } from "./commands";
import { useOptimiser } from "./optimiser";
import { DEFAULT_DESIGN_NAME, useShell } from "./shellState";

export function TitleBar() {
  const s = useStore();
  const opt = useOptimiser();
  const setHelp = useShell(x => x.setHelp);
  const ready = !!s.results;
  const ThemeIcon = s.theme === "dark" ? Moon : s.theme === "light" ? Sun : Monitor;

  return (
    <header className="cs-titlebar">
      <div className="cs-tb-brand">
        <Logo size={24} />
        <span className="cs-tb-word">Crossover<b>Studio</b></span>
      </div>
      <span className="cs-tb-div" aria-hidden />
      <ProfileSwitcher />
      <span className="cs-tb-slash" aria-hidden>/</span>
      <DesignName />

      <div className="cs-tb-spacer" />

      <div className="cs-tb-group" role="group" aria-label="History">
        <IconButton icon={Undo2} label="Undo" shortcut="Mod+Z" disabled={!s.history.length} onClick={s.undo} />
        <IconButton icon={Redo2} label="Redo" shortcut="Mod+Shift+Z" disabled={!s.future.length} onClick={s.redo} />
      </div>
      <span className="cs-tb-div" aria-hidden />
      <Tooltip title="Snapshot" shortcut="S" content="Freeze the current design as a reference curve for the Compare view." side="bottom">
        <Button variant="ghost" icon={Camera} disabled={!ready} onClick={snapshotNow} className="cs-tb-snap"
                aria-label={`Take snapshot${s.snapshots.length ? ` (${s.snapshots.length} saved)` : ""}`}>
          {s.snapshots.length > 0 && <span className="cs-tb-count mono" aria-hidden>{s.snapshots.length}</span>}
        </Button>
      </Tooltip>

      {opt.running ? (
        <div className="cs-tb-opt is-running" role="status" aria-live="polite">
          <span className="cs-tb-opt-ring" style={{ ["--p" as string]: opt.progress }} aria-hidden />
          <span className="mono cs-tb-opt-text">
            {Math.round(opt.progress * 100)}%{opt.score !== null && <span className="cs-tb-opt-score"> · {fmtFixed(opt.score, 2)}</span>}
          </span>
          <Button size="sm" variant="subtle" icon={Square} onClick={opt.stop}>Stop</Button>
        </div>
      ) : (
        <Tooltip title="Optimise" shortcut="O" side="bottom"
                 content="Search your parts list for the flattest response that keeps the crossovers, the tweeter and the amplifier load safe.">
          <Button variant="subtle" icon={Sparkles} disabled={!ready} onClick={opt.start}>Optimise</Button>
        </Tooltip>
      )}
      <Tooltip title="Export" shortcut="E" side="bottom" content="MiniDSP filters, LTspice files, parts list and report figures.">
        <Button variant="primary" icon={Download} disabled={!ready} onClick={openExport}>Export</Button>
      </Tooltip>

      <span className="cs-tb-div" aria-hidden />
      <Tooltip title="Command palette" shortcut="Mod+K" side="bottom" content="Every action, view and probe target, by name.">
        <button type="button" className="cs-tb-search" onClick={() => s.setUi({ commandPalette: true })} aria-label="Open command palette">
          <Search size={14} strokeWidth={1.75} />
          <span>Search</span>
          <Kbd keys="Mod+K" quiet />
        </button>
      </Tooltip>
      <IconButton icon={ThemeIcon} label={`Theme: ${s.theme}`} hint="Dark, light, or follow the system. Click to switch." onClick={cycleTheme} />
      <IconButton icon={CircleQuestionMark} label="Help" shortcut="?" hint="Keyboard shortcuts and how the workflow goes." onClick={() => setHelp(true)} />
    </header>
  );
}

/** Click to rename; Enter or blur saves, Escape cancels. Stored per profile. */
function DesignName() {
  const profileId = useStore(s => s.profile?.id);
  const dirty = useStore(s => s.history.length > 0);
  const name = useShell(x => (profileId && x.names[profileId]) || DEFAULT_DESIGN_NAME);
  const setName = useShell(x => x.setName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  if (!profileId) return null;

  if (editing) {
    const done = (save: boolean) => {
      setEditing(false);
      const v = draft.trim();
      if (save && v) setName(profileId, v);
    };
    return (
      <input
        ref={input}
        className="cs-tb-name-input"
        value={draft}
        aria-label="Design name"
        maxLength={60}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => done(true)}
        onKeyDown={e => {
          if (e.key === "Enter") done(true);
          if (e.key === "Escape") { e.stopPropagation(); done(false); }
        }}
      />
    );
  }
  return (
    <Tooltip content="Click to rename this design" side="bottom">
      <button type="button" className="cs-tb-name" onClick={() => { setDraft(name); setEditing(true); }}>
        <span>{name}</span>
        {dirty && <span className="cs-tb-dirty" aria-label="edited" />}
      </button>
    </Tooltip>
  );
}
