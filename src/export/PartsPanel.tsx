// Parts list tab: every component of the two passive boards, marked by whether the course basket has it.
// Clicking a row closes the sheet and takes you to that part in the inspector.
import { Copy, Download, PackageCheck, PackageX } from "lucide-react";
import { useMemo } from "react";
import type { Design, Profile } from "../types";
import { Badge, Button, EmptyState, fmtValue } from "../ui";
import { focusControl } from "../ui/shell/commands";
import { useStore } from "../state/store";
import { copyText, saveTextFile } from "./io";
import { bom, bomCsv, bomMarkdown, safeName, SOURCE_LABEL } from "./parts";

export function PartsPanel({ profile, design, designName }: { profile: Profile; design: Design; designName: string }) {
  const rows = useMemo(() => bom(profile, design), [profile, design]);
  const missing = rows.filter(r => r.source === "other").length;
  const base = `Parts_${safeName(profile.id)}`;
  const jump = (id: string) => { useStore.getState().setUi({ exportSheet: false }); focusControl(id); };

  if (!rows.length)
    return <EmptyState icon={PackageX} title="No passive parts yet" description="Choose a midrange and a tweeter topology in steps 3 and 4 of the inspector." />;

  const counts = { L: 0, C: 0, R: 0 };
  rows.forEach(r => counts[r.kind]++);

  return (
    <div className="xs-panel">
      <div className={`xs-banner ${missing ? "is-warn" : "is-good"}`} role="status">
        {missing ? <PackageX size={18} aria-hidden /> : <PackageCheck size={18} aria-hidden />}
        <div>
          <b>{missing ? `${missing} part${missing > 1 ? "s are" : " is"} not in the course basket` : "Every part is in the course basket"}</b>
          <span>
            {rows.length} components: {counts.L} inductor{counts.L === 1 ? "" : "s"}, {counts.C} capacitor{counts.C === 1 ? "" : "s"}, {counts.R} resistor{counts.R === 1 ? "" : "s"}
            {missing ? ". Pick a listed value in the inspector, or plan to combine two parts." : ", all from Appendix 1 of the project guide."}
          </span>
        </div>
      </div>

      <div className="xs-table-wrap">
        <table className="xs-table">
          <thead>
            <tr><th scope="col">Ref</th><th scope="col">Board</th><th scope="col">Role</th><th scope="col" className="is-num">Value</th><th scope="col">Source</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.ref} tabIndex={0} title="Show this part in the inspector"
                  onClick={() => jump(r.focusId)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); jump(r.focusId); } }}>
                <td className="mono xs-ref"><span><span className={`xs-swatch xs-swatch-${r.focusId.startsWith("mid") ? "mid" : "tw"}`} aria-hidden />{r.ref}</span></td>
                <td>{r.board}</td>
                <td>{r.role}</td>
                <td className="mono is-num">{fmtValue(r.value, r.kind)}</td>
                <td>{r.source === "basket"
                  ? <Badge tone="good" title={SOURCE_LABEL.basket}>Basket</Badge>
                  : <Badge tone="warn" title={SOURCE_LABEL.other}>Not in basket</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {design.Rdcr > 0 && <p className="xs-note">Inductors are modelled with <span className="mono">{design.Rdcr} Ω/mH</span> coil resistance.</p>}
      <p className="xs-note">Basket = Appendix 1 of the 2026 project guide (the profile's component list). There are at least two of each value.</p>

      <div className="xs-actions">
        <Button size="sm" variant="subtle" icon={Copy} onClick={() => copyText(bomMarkdown(rows, profile, design, designName), "Parts list (Markdown)")}>Copy Markdown</Button>
        <Button size="sm" variant="subtle" icon={Download} onClick={() => saveTextFile(`${base}.md`, bomMarkdown(rows, profile, design, designName), "md", "Parts list")}>Save .md</Button>
        <Button size="sm" variant="subtle" icon={Copy} onClick={() => copyText(bomCsv(rows, design), "Parts list (CSV)")}>Copy CSV</Button>
        <Button size="sm" variant="primary" icon={Download} onClick={() => saveTextFile(`${base}.csv`, bomCsv(rows, design), "csv", "Parts list")}>Save .csv</Button>
      </div>
    </div>
  );
}
