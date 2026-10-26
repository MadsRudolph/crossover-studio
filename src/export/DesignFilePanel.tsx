// Design file tab: save the current design and its snapshots as a .xstudio file, or open one.
// Opening replaces the design in one undo step and recomputes every snapshot from the profile.
import { AlertTriangle, FileDown, FileUp, Layers } from "lucide-react";
import { useState } from "react";
import { compute, type Prepared } from "../engine";
import { SNAP_COLORS, useStore, type Snapshot } from "../state/store";
import { useShell, DEFAULT_DESIGN_NAME } from "../ui/shell/shellState";
import type { Profile } from "../types";
import { Button, fmtFreq, toast } from "../ui";
import { pickTextFile, saveTextFile } from "./io";
import { DESIGN_FILE_EXT, designFileText, parseDesignFile, type DesignFile } from "./designFile";
import { safeName } from "./parts";

/** Snapshot colours are data (the plots draw them), so a file without one gets the store's first one. */

export function DesignFilePanel({ profile, prep, designName }: { profile: Profile; prep: Prepared; designName: string }) {
  const design = useStore(s => s.design);
  const snapshots = useStore(s => s.snapshots);
  const [pending, setPending] = useState<{ file: DesignFile; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const text = designFileText({
      profileId: profile.id, profileName: profile.name, name: designName, savedAt: new Date().toISOString(), design,
      snapshots: snapshots.map(s => ({ id: s.id, name: s.name, color: s.color, design: s.design })),
    });
    saveTextFile(`${safeName(designName === DEFAULT_DESIGN_NAME ? profile.id : designName)}.${DESIGN_FILE_EXT}`, text, DESIGN_FILE_EXT, "Design");
  };

  const open = async () => {
    setError(null);
    try {
      const picked = await pickTextFile(`.${DESIGN_FILE_EXT},.json,application/json`);
      if (!picked) return;
      const file = parseDesignFile(picked.text);
      if (file.profileId !== profile.id) { setPending({ file, name: picked.name }); return; }
      apply(file, picked.name);
    } catch (e) { setError(String((e as Error)?.message ?? e)); }
  };

  const apply = (file: DesignFile, fileName: string) => {
    setPending(null);
    // compute everything first, so a design that does not fit this profile changes nothing
    let snaps: Snapshot[];
    try {
      compute(prep, file.design);
      snaps = file.snapshots.map(s => ({ id: s.id, name: s.name, color: s.color || SNAP_COLORS[0], design: s.design, results: compute(prep, s.design) }));
    } catch (e) {
      setError(`${fileName} does not fit this profile: ${String((e as Error)?.message ?? e)}`);
      return;
    }
    const st = useStore.getState();
    // the store's undo history holds designs only: keep what opening replaces, so Undo can put it all back
    const prevSnapshots = st.snapshots;
    const prevName = useShell.getState().names[profile.id];
    st.setDesign(file.design);
    st.setSnapshots(snaps);
    if (file.name) useShell.getState().setName(profile.id, file.name);
    toast({ tone: "good", title: `Opened ${file.name ?? fileName}`,
            description: snaps.length ? `With ${snaps.length} snapshot${snaps.length > 1 ? "s" : ""}.` : undefined,
            action: { label: "Undo", onClick: () => {
              const now = useStore.getState();
              now.undo();
              now.setSnapshots(prevSnapshots);
              if (file.name) useShell.getState().setName(profile.id, prevName ?? DEFAULT_DESIGN_NAME);
            } } });
  };

  const dg = design.digital;
  return (
    <div className="xs-panel">
      <div className="xs-doc">
        <div className="xs-doc-icon" aria-hidden><Layers size={22} /></div>
        <div className="xs-doc-body">
          <h3>{designName}</h3>
          <p>
            {profile.name} · {dg.align} at <span className="mono">{fmtFreq(dg.fc)}</span> · midrange {design.mid.topo}, tweeter {design.tw.topo}
            {" · "}{snapshots.length ? `${snapshots.length} snapshot${snapshots.length > 1 ? "s" : ""}` : "no snapshots"}
          </p>
        </div>
      </div>
      <p className="xs-note">
        A <span className="mono">.{DESIGN_FILE_EXT}</span> file holds the design and its snapshots for this profile, in plain JSON. It does not
        hold measurements: whoever opens it needs the same profile. Send it to your group, or keep one next to each report draft.
      </p>
      <div className="xs-actions is-start">
        <Button variant="primary" icon={FileDown} onClick={save}>Save design…</Button>
        <Button variant="subtle" icon={FileUp} onClick={open}>Open design…</Button>
      </div>

      {pending && (
        <div className="xs-banner is-warn" role="alertdialog" aria-labelledby="xs-mismatch">
          <AlertTriangle size={18} aria-hidden />
          <div>
            <b id="xs-mismatch">{pending.name} was made for another profile</b>
            <span>
              It belongs to “{pending.file.profileName ?? pending.file.profileId}”, and this is “{profile.name}”. The values will load,
              but they were tuned for other drivers.
            </span>
            <div className="xs-banner-actions">
              <Button size="sm" variant="primary" onClick={() => apply(pending.file, pending.name)}>Open anyway</Button>
              <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="xs-banner is-bad" role="alert">
          <AlertTriangle size={18} aria-hidden />
          <div><b>Could not open the design</b><span>{error}</span></div>
        </div>
      )}
    </div>
  );
}
