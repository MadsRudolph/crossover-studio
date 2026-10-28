// Listening test view (project Task 4): a methodical, blind listening test in four steps. 1 Protocol (what
// is compared, the programme, the attributes, the procedure), 2 Sessions (blind, balanced play order and
// the printable sheets), 3 Run (play the design variants in the app, level matched, or type in the
// printed sheets), 4 Results (mean ± 95 % CI, conclusions, and the region and control each attribute
// points at). The kit lives in src/listentest; its document (protocol + ratings) is kept per profile.
// `?ltdemo=1` loads an example test (not saved) and `?ltstep=protocol|sessions|run|results` opens a step.

import { useEffect, useState } from "react";
import { Download, FlaskConical, ListChecks, Upload } from "lucide-react";
import { Button, EmptyState, toast } from "../ui";
import { useStore } from "../state/store";
import { ViewInsights } from "../insights/ViewInsights";
import { pickTextFile, saveTextFile } from "../export/io";
import { ViewHeader } from "./common";
import { useListenTest, docFromFile, docToFile } from "../listentest/store";
import { demoDoc } from "../listentest/demo";
import { ProtocolStep } from "../listentest/ProtocolStep";
import { SessionsStep } from "../listentest/SessionsStep";
import { RunStep } from "../listentest/RunStep";
import { ResultsStep } from "../listentest/ResultsStep";
import { makePlan } from "../listentest/random";
import "../listentest/listentest.css";

type Step = "protocol" | "sessions" | "run" | "results";
const STEPS: Step[] = ["protocol", "sessions", "run", "results"];

function urlParam(name: string): string | null {
  try { return new URLSearchParams(window.location.search).get(name); } catch { return null; }
}

export function ListeningTestView() {
  const profile = useStore(s => s.profile);
  const design = useStore(s => s.design);
  const doc = useListenTest(s => s.doc);
  const ephemeral = useListenTest(s => s.ephemeral);
  const open = useListenTest(s => s.open);
  const replace = useListenTest(s => s.replace);
  const [step, setStep] = useState<Step>(() => (STEPS.includes(urlParam("ltstep") as Step) ? urlParam("ltstep") as Step : "protocol"));

  useEffect(() => {
    if (!profile) return;
    if (urlParam("ltdemo") === "1" && !useListenTest.getState().ephemeral) replace(demoDoc(profile, design), true);
    else open(profile.id);
    // the design is read once for the demo; later edits must not reload the document
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, open, replace]);

  if (!profile) return <div className="cs-fill-center"><EmptyState icon={ListChecks} title="No profile loaded" description="Import measurements or load the bundled example first." /></div>;
  if (!doc || doc.profileId !== profile.id) return null;

  const p = doc.protocol, ratings = doc.ratings;
  const plan = p.variants.length ? makePlan(p) : [];
  const trials = plan.reduce((n, s) => n + s.trials.length, 0);
  const perTrial = p.variants.length * p.attributes.length;
  const rated = ratings.length;
  const expected = trials * perTrial;
  const sub: Record<Step, string> = {
    protocol: p.variants.length ? `${p.variants.length} variants · ${p.items.length} items · ${p.attributes.length} attributes` : "Choose what to compare",
    sessions: p.variants.length ? `${p.listeners} sheets · ${plan[0]?.trials.length ?? 0} trials each` : "Needs the protocol",
    run: expected ? `${Math.round((100 * rated) / expected)} % rated` : "—",
    results: rated ? `${new Set(ratings.map(r => r.listener)).size} listeners so far` : "No ratings yet",
  };
  const done: Record<Step, boolean> = { protocol: p.variants.length > 0, sessions: false, run: expected > 0 && rated >= expected, results: false };
  const titles: Record<Step, string> = { protocol: "Protocol", sessions: "Sessions", run: "Run", results: "Results" };

  const exportDoc = () => {
    const name = `listening_test_${profile.id.replace(/[^A-Za-z0-9_-]+/g, "_")}.json`;
    void saveTextFile(name, docToFile(doc), "json", "Listening test");
  };
  const importDoc = async () => {
    try {
      const f = await pickTextFile(".json,application/json");
      if (!f) return;
      const prev = useListenTest.getState().doc;
      replace(docFromFile(f.text, profile.id));
      toast({ tone: "good", title: "Listening test opened", description: f.name,
              action: prev ? { label: "Undo", onClick: () => replace(prev) } : undefined });
    } catch (e) {
      toast({ tone: "bad", title: "Could not open the listening test", description: String((e as Error)?.message ?? e) });
    }
  };

  return (
    <div className="vw-view lt-view">
      <ViewInsights view="listentest" />
      <ViewHeader title="Listening test" actions={<>
        {ephemeral && <span className="lt-kind" title="Example data: nothing is saved">Example</span>}
        {!ephemeral && !p.variants.length && (
          <Button size="sm" variant="ghost" icon={FlaskConical} title="An example test with ratings, to see how it works (not saved)"
                  onClick={() => replace(demoDoc(profile, design), true)}>Example</Button>
        )}
        {ephemeral && <Button size="sm" variant="ghost" onClick={() => { useListenTest.setState({ doc: null, ephemeral: false }); open(profile.id); }}>Close example</Button>}
        <Button size="sm" variant="ghost" icon={Upload} onClick={() => void importDoc()}>Open…</Button>
        <Button size="sm" variant="ghost" icon={Download} onClick={exportDoc}>Save…</Button>
      </>}>
        Task 4, done methodically: blind, balanced and level matched, after IEC 60268-13 and Bech &amp; Zacharov. The results say which
        frequency region and control to change.
      </ViewHeader>

      <nav className="lt-steps" aria-label="Listening test steps">
        {STEPS.map((s, i) => (
          <button key={s} type="button" className={"lt-step" + (step === s ? " is-on" : "") + (done[s] ? " is-done" : "")}
                  aria-current={step === s ? "step" : undefined} onClick={() => setStep(s)}>
            <span className="lt-step-n">{i + 1}</span>
            <span className="lt-step-text"><span className="lt-step-title">{titles[s]}</span><span className="lt-step-sub">{sub[s]}</span></span>
          </button>
        ))}
      </nav>

      {step === "protocol" && <ProtocolStep protocol={p} />}
      {step === "sessions" && <SessionsStep protocol={p} />}
      {step === "run" && <RunStep protocol={p} ratings={ratings} onDone={() => setStep("results")} />}
      {step === "results" && <ResultsStep protocol={p} ratings={ratings} onRun={() => setStep("run")} />}
    </div>
  );
}
