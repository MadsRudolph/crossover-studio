// Step 2 of the listening-test view: the session sheets. A summary of the plan, each listener's blind
// play order, a preview of the printed sheet, and Print (the browser's print dialog: choose "Save as
// PDF" for a file) or Save as HTML (opens and prints in any browser).

import { useMemo, useState } from "react";
import { FileDown, Printer } from "lucide-react";
import { Badge, Button, toast } from "../ui";
import { Card } from "../views/common";
import { saveTextFile } from "../export/io";
import type { Protocol } from "./model";
import { makePlan } from "./random";
import { SHEET_CSS, sheetsDocument, sheetsHtml } from "./sheet";
import { Select } from "./parts";

/** Print the sheets: a print-only copy is added to the page, the print dialog opens, and the copy goes. */
export function printSheets(p: Protocol): void {
  const root = document.createElement("div");
  root.className = "lt-print-root";
  root.innerHTML = `<style>${SHEET_CSS}</style>${sheetsHtml(p)}`;
  document.body.appendChild(root);
  const done = () => { root.remove(); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  try { window.print(); }
  catch (e) { done(); toast({ tone: "bad", title: "Could not open the print dialog", description: `${String(e)}. Use Save as HTML and print it from a browser.` }); return; }
  setTimeout(done, 60_000);                          // a webview that never fires afterprint
}

export function SessionsStep({ protocol }: { protocol: Protocol }) {
  const p = protocol;
  const plan = useMemo(() => makePlan(p), [p]);
  const [who, setWho] = useState("0");
  const listener = Math.min(+who, plan.length - 1);
  const preview = useMemo(() => sheetsHtml(p, { only: listener, key: false }), [p, listener]);
  const item = (id: string) => p.items.find(i => i.id === id)?.name ?? id;
  const s = plan[listener];
  const fileBase = p.title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "listening_test";

  if (!p.variants.length)
    return <Card title="Session sheets"><p className="lt-msg">Add the variants to compare in step 1 first; the sheets follow from the protocol.</p></Card>;

  return (
    <div className="lt-cols">
      <div className="lt-col">
        <Card title="Plan" actions={<>
          <Button size="sm" icon={FileDown} onClick={() => void saveTextFile(`${fileBase}_sheets.html`, sheetsDocument(p), "html", "Session sheets")}>Save as HTML</Button>
          <Button size="sm" variant="primary" icon={Printer} onClick={() => printSheets(p)}>Print sheets</Button>
        </>}>
          <div className="lt-summary">
            <Badge>{`${p.listeners} listeners`}</Badge>
            <Badge>{`${p.reps} repetitions`}</Badge>
            <Badge>{`${s?.trials.length ?? 0} trials each`}</Badge>
            <Badge>{`${p.variants.length} variants, blind`}</Badge>
            <Badge>{`seed ${p.seed}`}</Badge>
          </div>
          <p className="lt-help">
            Print one sheet per listener plus the test leader&apos;s key (the last page: which letter is which variant). In the print dialog choose
            <b> Save as PDF</b> for a file. The same seed always gives the same sheets, so the app decodes the ratings you type in later.
          </p>
        </Card>

        <Card title="Play order" actions={
          <Select<string> label="Listener" value={String(listener)} onChange={setWho} options={plan.map(x => ({ value: String(x.listener), label: `Listener ${x.listener + 1}` }))} />}>
          {s && (
            <table className="lt-order-table">
              <thead><tr><th>Trial</th><th>Item</th><th>Rep.</th><th>Order</th><th>Key</th></tr></thead>
              <tbody>
                {s.trials.map(t => (
                  <tr key={t.n}>
                    <td className="mono">{t.n}</td>
                    <td>{item(t.item)}</td>
                    <td className="mono">{t.rep + 1}</td>
                    <td className="mono">{t.order.map(v => s.labels[v]).join(" ")}</td>
                    <td className="lt-trial-meta">{t.order.map(v => p.variants.find(x => x.id === v)?.name).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="lt-help">The key column is for the test leader only. Play the variants in the printed order; listeners may ask to hear any of them again.</p>
        </Card>
      </div>

      <div className="lt-col">
        <Card title={`Sheet preview · listener ${listener + 1}`}>
          <style>{SHEET_CSS.replace(/@page[^}]*}/, "")}</style>
          {/* generated here from the protocol with every text escaped (sheet.ts), never from foreign markup */}
          <div className="lt-sheet-preview" dangerouslySetInnerHTML={{ __html: preview }} />
        </Card>
      </div>
    </div>
  );
}
