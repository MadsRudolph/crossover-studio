import { useMemo, useRef, useState, type ReactNode } from "react";
import { CornerDownLeft, Crosshair, Search } from "lucide-react";
import { useStore } from "../../state/store";
import { Dialog } from "../Dialog";
import { Kbd } from "../Kbd";
import { fmtFreq } from "../format";
import { buildCommands, fuzzy, probeQuery, type Command } from "./commands";

const SECTION_ORDER: Command["section"][] = ["Design", "View", "Probe", "Display", "Go to", "File", "App"];

function highlight(text: string, hits: number[]): ReactNode {
  if (!hits.length) return text;
  const set = new Set(hits);
  return Array.from(text).map((ch, i) => set.has(i) ? <mark key={i}>{ch}</mark> : ch);
}

/** Ctrl/Cmd+K: type to find any action, arrows to choose, Enter to run. */
export function CommandPalette() {
  const open = useStore(s => s.ui.commandPalette);
  const close = () => useStore.getState().setUi({ commandPalette: false });
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onClose={close} hideClose size="md" className="cs-palette" initialFocus={input}>
      {open && <PaletteBody input={input} close={close} />}
    </Dialog>
  );
}

function PaletteBody({ input, close }: { input: React.RefObject<HTMLInputElement | null>; close(): void }) {
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  // built once per opening: the titles reflect the state at the moment the palette opened
  const all = useMemo(() => buildCommands(), []);

  const results = useMemo(() => {
    if (!query.trim()) {
      return [...all].sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section))
        .map(c => ({ c, hits: [] as number[], score: 0 }));
    }
    // a typed frequency ("2k", "500 Hz") becomes the first result: probe it
    const f = probeQuery(query);
    const probe: Command[] = f === null || !useStore.getState().results ? [] : [{
      id: "probe.query", title: `Probe ${fmtFreq(f)}`, section: "Probe", icon: Crosshair, detail: "set the probe",
      run: () => useStore.getState().setProbe(f),
    }];
    return [...probe.map(c => ({ c, hits: [] as number[], score: Infinity })), ...all
      .map(c => {
        const t = fuzzy(query, c.title);
        const k = fuzzy(query, `${c.section} ${c.keywords ?? ""}`);
        const score = Math.max(t?.score ?? -Infinity, (k?.score ?? -Infinity) - 8);
        return { c, hits: t?.hits ?? [], score };
      })
      .filter(r => r.score > -Infinity)
      .sort((a, b) => (a.c.disabled ? 1 : 0) - (b.c.disabled ? 1 : 0) || b.score - a.score)];
  }, [all, query]);

  const run = (c: Command | undefined) => {
    if (!c || c.disabled) return;
    close();
    // let the palette's focus return first, so commands that focus something keep it
    requestAnimationFrame(() => c.run());
  };

  const moveTo = (i: number) => {
    const n = results.length;
    if (!n) return;
    const j = (i + n) % n;
    setHi(j);
    list.current?.querySelector(`[data-index="${j}"]`)?.scrollIntoView({ block: "nearest" });
  };

  let lastSection = "";
  return (
    <div className="cs-palette-inner">
      <div className="cs-palette-search">
        <Search size={16} strokeWidth={1.75} aria-hidden />
        <input
          ref={input}
          value={query}
          placeholder="Type a command, a view, or what you want to probe…"
          aria-label="Search commands"
          role="combobox"
          aria-expanded
          aria-controls="cs-palette-list"
          aria-activedescendant={results[hi] ? `cs-cmd-${results[hi].c.id}` : undefined}
          spellCheck={false}
          onChange={e => { setQuery(e.target.value); setHi(0); }}
          onKeyDown={e => {
            if (e.key === "ArrowDown") { e.preventDefault(); moveTo(hi + 1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); moveTo(hi - 1); }
            else if (e.key === "PageDown") { e.preventDefault(); moveTo(Math.min(results.length - 1, hi + 8)); }
            else if (e.key === "PageUp") { e.preventDefault(); moveTo(Math.max(0, hi - 8)); }
            else if (e.key === "Enter") { e.preventDefault(); run(results[hi]?.c); }
          }}
        />
        <Kbd keys="Esc" quiet />
      </div>
      <div ref={list} id="cs-palette-list" role="listbox" aria-label="Commands" className="cs-palette-list">
        {results.length === 0 && (
          <div className="cs-palette-empty">
            No command matches “{query}”. Try a view name, “probe”, “export” or “theme”.
          </div>
        )}
        {results.map((r, i) => {
          const head = !query.trim() && r.c.section !== lastSection ? r.c.section : null;
          lastSection = r.c.section;
          const Icon = r.c.icon;
          return (
            <div key={r.c.id}>
              {head && <div className="cs-palette-section label-caps">{head}</div>}
              <div
                id={`cs-cmd-${r.c.id}`}
                data-index={i}
                role="option"
                aria-selected={i === hi}
                aria-disabled={r.c.disabled || undefined}
                className={"cs-palette-item" + (i === hi ? " is-hi" : "") + (r.c.disabled ? " is-disabled" : "")}
                onPointerMove={() => i !== hi && setHi(i)}
                onClick={() => run(r.c)}
              >
                <span className="cs-palette-icon">{Icon && <Icon size={15} strokeWidth={1.75} />}</span>
                <span className="cs-palette-title">{highlight(r.c.title, r.hits)}</span>
                {query.trim() && <span className="cs-palette-sec">{r.c.section}</span>}
                {r.c.detail && <span className="cs-palette-detail mono">{r.c.detail}</span>}
                {r.c.shortcut && <Kbd keys={r.c.shortcut} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="cs-palette-foot">
        <span><Kbd keys="Up" quiet /><Kbd keys="Down" quiet /> choose</span>
        <span><CornerDownLeft size={12} /> run</span>
        <span><Kbd keys="Esc" quiet /> close</span>
      </div>
    </div>
  );
}
