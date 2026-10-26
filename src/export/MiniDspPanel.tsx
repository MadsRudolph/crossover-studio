// MiniDSP tab: the two custom biquad blocks DigitalCrossover.m would print, ready to paste into the
// MiniDSP app's Xover > Advanced window, with the course procedure (project guide, section 3.1).
import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { ALIGNMENTS, type FilterKind } from "../engine";
import type { Design, Profile } from "../types";
import { Badge, Button, fmtFreq } from "../ui";
import { copyText, saveTextFile } from "./io";
import { minidspFileText } from "./minidsp";
import { safeName } from "./parts";

const STEPS: { title: string; body: string }[] = [
  { title: "Connect", body: "Open the MiniDSP software and click Connect to link it to the MiniDSP card." },
  { title: "Routing", body: "In the routing matrix, Input 1 > Output 1 and Input 1 > Output 2 must be active. Route Input 2 too if you want to play a stereo source as mono." },
  { title: "Outputs", body: "Click Outputs. Only outputs 1 and 2 are used, and only Xover may be active: PEQ, Comp and FIR must show as bypassed, since LTspice cannot model them." },
  { title: "Paste", body: "Choose Xover on Output 1, click Advanced, delete the text in the window and paste the Output 1 block below. Click Process. Repeat for Output 2. Synchronise with the DSP card if asked." },
  { title: "Levels", body: "Set the woofer gain on Output 1 (shown below) and leave Output 2 at 0 dB, so the hardware matches the design and its LTspice export." },
];

interface OutputDef { n: 1 | 2; kind: FilterKind; title: string; units: string; tone: "woof" | "mid" }
const OUTPUTS: OutputDef[] = [
  { n: 1, kind: "LPF", title: "Low-pass", units: "Woofer", tone: "woof" },
  { n: 2, kind: "HPF", title: "High-pass", units: "Midrange + tweeter", tone: "mid" },
];

function polText(p: 1 | -1) { return p === 1 ? "normal" : "inverted"; }

export function MiniDspPanel({ profile, design }: { profile: Profile; design: Design }) {
  const dg = design.digital;
  const align = ALIGNMENTS.find(a => a.key === dg.align);
  const sections = align ? Math.ceil(align.order / 2) : 1;
  return (
    <div className="xs-panel">
      <div className="xs-summary">
        <div><span className="label-caps">Alignment</span><b>{align?.name ?? dg.align}</b></div>
        <div><span className="label-caps">Crossover</span><b className="mono">{fmtFreq(dg.fc)}</b></div>
        <div><span className="label-caps">Sample rate</span><b className="mono">96 kHz</b></div>
        <div><span className="label-caps">Biquads</span><b className="mono">{sections} per output</b></div>
      </div>
      {align?.note && <p className="xs-note">{align.note}</p>}

      {OUTPUTS.map(o => (
        <OutputBlock key={o.n} o={o} profile={profile} design={design} />
      ))}

      <section className="xs-steps" aria-labelledby="xs-minidsp-steps">
        <h3 id="xs-minidsp-steps" className="label-caps">In the MiniDSP app</h3>
        <ol>
          {STEPS.map((s, i) => (
            <li key={s.title}><span className="xs-step-n mono" aria-hidden>{i + 1}</span><div><b>{s.title}.</b> {s.body}</div></li>
          ))}
        </ol>
        <p className="xs-note">Copy straight from here or from the saved file: text retyped by hand or passed through a word processor can pick up hidden characters the MiniDSP rejects.</p>
      </section>
    </div>
  );
}

function OutputBlock({ o, profile, design }: { o: OutputDef; profile: Profile; design: Design }) {
  const dg = design.digital;
  const text = minidspFileText(dg.fc, o.kind, dg.align);
  const [copied, setCopied] = useState(false);
  const gain = o.n === 1 ? dg.g_woof_dB : 0;
  const file = `MiniDSP_output${o.n}_${o.kind}_${dg.align}_${Math.round(dg.fc)}Hz_${safeName(profile.id)}.txt`;
  const copy = async () => {
    if (await copyText(text, `Output ${o.n} biquads`)) { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
  };
  return (
    <section className="xs-card" aria-label={`Output ${o.n}, ${o.units}`}>
      <header className="xs-card-head">
        <span className={`xs-swatch xs-swatch-${o.tone}`} aria-hidden />
        <div className="xs-card-titles">
          <h3>Output {o.n} <span className="xs-dim">·</span> {o.units}</h3>
          <p>{o.title} {dg.align} at <span className="mono">{fmtFreq(dg.fc)}</span></p>
        </div>
        <div className="xs-card-tags">
          <Badge tone={gain === 0 ? "neutral" : "accent"} title="Output gain in the MiniDSP app">
            gain <span className="mono">{gain > 0 ? "+" : gain < 0 ? "−" : ""}{Math.abs(gain).toFixed(1)} dB</span>
          </Badge>
          {o.n === 1
            ? <Badge tone={design.pol.woof === 1 ? "neutral" : "warn"} title="Invert Output 1 in the MiniDSP app, or swap the woofer leads">polarity {polText(design.pol.woof)}</Badge>
            : <Badge tone={design.pol.mid === 1 && design.pol.tw === 1 ? "neutral" : "warn"} title="Set on the passive board: swap the leads of an inverted driver">
                mid {polText(design.pol.mid)} · tw {polText(design.pol.tw)}
              </Badge>}
        </div>
      </header>
      <pre className="xs-code mono" tabIndex={0} aria-label={`Output ${o.n} biquad text`}>{text.replace(/^\n/, "")}</pre>
      <div className="xs-card-actions">
        <Button size="sm" variant={copied ? "subtle" : "primary"} icon={copied ? Check : Copy} onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
        <Button size="sm" variant="subtle" icon={Download} onClick={() => saveTextFile(file, text, "txt", `Output ${o.n} biquads`)}>Save .txt</Button>
      </div>
    </section>
  );
}
