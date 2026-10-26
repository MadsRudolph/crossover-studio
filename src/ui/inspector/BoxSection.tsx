import { useStore } from "../../state/store";
import type { BoxDesign } from "../../types";
import { Badge, Field, Section, Segmented, Slider, Stat } from "..";
import { fmtDb, fmtFreq, fmtLength, fmtSig } from "../format";
import type { SectionCommon } from "./common";

const MODES: { value: BoxDesign["mode"]; label: string; hint: string }[] = [
  { value: "plugged", label: "Closed", hint: "Both vents plugged: a closed box. Tighter bass, higher f3." },
  { value: "one", label: "1 vent", hint: "Vent A open: the box is tuned by its length (Helmholtz resonance)." },
  { value: "two", label: "2 vents", hint: "Vents A and B open: more port area, a higher tuning for the same length." },
];

export function BoxSection({ open, onOpenChange, status }: SectionCommon) {
  const box = useStore(s => s.design.box);
  const profile = useStore(s => s.profile);
  const res = useStore(s => s.results?.box);
  const fit = useStore(s => s.fit);
  const edit = useStore(s => s.edit);
  if (!profile) return null;

  const vents = profile.woofer_box.vents;
  const vA = vents[0], vB = vents[1];
  const rangeA = vA?.length_range_m ?? [0.05, 0.35];
  const rangeB = vB?.length_range_m ?? rangeA;
  const measured = profile.measurements.woofer.vented.flatMap(v => v.vents.filter(x => x.id === vA?.id).map(x => x.length_m));
  const set = <K extends keyof BoxDesign>(k: K, commit: boolean) => (v: BoxDesign[K]) => edit(d => { d.box[k] = v; }, commit);
  const bass = status;

  const summary = !res ? undefined : box.mode === "plugged" ? "Closed box" :
    `${box.mode === "one" ? "1 vent" : "2 vents"} · ${fmtLength(box.L)}${res.fB ? ` · fB ${fmtFreq(res.fB)}` : ""}`;

  return (
    <Section id="box" step={1} color="var(--woof)" title="Woofer box" summary={summary} status={status} open={open} onOpenChange={onOpenChange}>
      <Field label="Vents" focusId="box.mode" hint="How many of the box's vents are open. Each option uses your Lab D vented-box fit.">
        <Segmented
          label="Vents"
          size="sm"
          value={box.mode}
          onChange={m => edit(d => { d.box.mode = m; })}
          options={MODES.map(m => {
            const missing = (m.value === "one" && !vA) || (m.value === "two" && !vB);
            return { ...m, disabled: missing,
                     hint: !missing ? m.hint : !vA ? "The profile lists no vents: the box is closed." : "This box has only one vent." };
          })}
        />
      </Field>

      {box.mode !== "plugged" && !vA && (
        <p className="insp-note">The profile lists no vents, so this design is evaluated as a closed box. Add the vents to the profile to tune it.</p>
      )}

      {box.mode !== "plugged" && vA && (
        <Field stacked label={`Vent ${vA?.id ?? "A"} length`} focusId="box.L"
               hint={`Longer vent = lower tuning. Ticks mark the lengths you measured (${measured.map(m => fmtLength(m)).join(", ") || "none"}); the fit is most trustworthy near them.`}>
          <Slider label={`Vent ${vA?.id ?? "A"} length`} value={box.L} min={rangeA[0]} max={rangeA[1]} step={0.001} scale={1000} unit="mm" digits={0}
                  marks={measured} defaultValue={measured[0] ?? box.L} color="var(--woof)"
                  onInput={set("L", false)} onCommit={set("L", true)} />
        </Field>
      )}

      {box.mode === "two" && vB && (
        <>
          <Field stacked label={`Vent ${vB.id} length`} focusId="box.L2" hint="Length of the second vent. It acts in parallel with vent A.">
            <Slider label={`Vent ${vB.id} length`} value={box.L2} min={rangeB[0]} max={rangeB[1]} step={0.001} scale={1000} unit="mm" digits={0}
                    defaultValue={box.L} color="var(--woof)" onInput={set("L2", false)} onCommit={set("L2", true)} />
          </Field>
          <Field stacked label={`Vent ${vB.id} diameter`} focusId="box.a2"
                 tag={vB.estimated ? <Badge tone="warn" title="Not measured: the profile marks this diameter as a guess">estimated</Badge> : undefined}
                 hint={vB.estimated ? "Never measured in the lab: the profile's value is a guess, so treat two-vent results with care." : "Inner diameter of the second vent."}>
            <Slider label={`Vent ${vB.id} diameter`} value={box.a2} min={0.01} max={0.06} step={0.0005} scale={2000} unit="mm" digits={0}
                    defaultValue={vB.diameter_m / 2} color="var(--woof)" onInput={set("a2", false)} onCommit={set("a2", true)} />
          </Field>
        </>
      )}

      <Field stacked label="Filling" focusId="box.fill"
             hint="Damping material makes the box behave as if it were larger. 1.00 = empty; about 1.2 for a box lined with wool.">
        <Slider label="Filling" value={box.fill} min={1} max={1.5} step={0.01} digits={2} unit="×" defaultValue={1} color="var(--woof)"
                onInput={set("fill", false)} onCommit={set("fill", true)} />
      </Field>

      {res && (
        <div className="insp-stats">
          <Stat label="Tuning fB" value={res.fB ? fmtFreq(res.fB) : "—"} hint="Helmholtz resonance of box + vent" />
          <Stat label="f3" value={fmtFreq(res.f3)} tone={bass ?? undefined} hint="Where the bass is 3 dB below the 150–300 Hz level" />
          <Stat label="Ripple" value={fmtDb(res.ripple, { sign: true })} tone={bass ?? undefined} hint="Largest bass peak above that level" />
        </div>
      )}
      {fit && (
        <div className="insp-fit">
          <span className="label-caps">Fitted woofer</span>
          <span className="mono">fs {fmtFreq(fit.ts.fs)} · Qts {fmtSig(fit.ts.Qts, 2)} · Vas {fmtSig(fit.ts.Vas_L, 3)} L</span>
        </div>
      )}
    </Section>
  );
}
