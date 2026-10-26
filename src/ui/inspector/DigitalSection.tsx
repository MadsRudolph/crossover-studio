import { defaultDesign, useStore } from "../../state/store";
import type { Align } from "../../types";
import { Field, Section, Segmented, Slider } from "..";
import { fmtDb, fmtFreq, parseNumber } from "../format";
import { POLARITY_OPTIONS, type SectionCommon } from "./common";

const ALIGNS: { value: Align; label: string; hint: string }[] = [
  { value: "BW2", label: "BW2", hint: "Butterworth, 2nd order: 12 dB/octave, −3 dB at fc." },
  { value: "LR2", label: "LR2", hint: "Linkwitz–Riley, 2nd order: 12 dB/octave, −6 dB at fc (sums flat with the outputs inverted)." },
  { value: "LR4", label: "LR4", hint: "Linkwitz–Riley, 4th order: 24 dB/octave, −6 dB at fc, outputs in phase." },
  { value: "BW4", label: "BW4", hint: "Butterworth, 4th order: 24 dB/octave, −3 dB at fc." },
];

const START = defaultDesign().digital;

export function DigitalSection({ open, onOpenChange, status }: SectionCommon) {
  const dig = useStore(s => s.design.digital);
  const pol = useStore(s => s.design.pol.woof);
  const limits = useStore(s => s.profile?.limits);
  const edit = useStore(s => s.edit);

  return (
    <Section id="digital" step={2} color="var(--woof)" title="Digital crossover" status={status} open={open} onOpenChange={onOpenChange}
             summary={`${dig.align} · ${fmtFreq(dig.fc)} · ${fmtDb(dig.g_woof_dB, { sign: true })}`}>
      <Field label="Alignment" focusId="digital.align" hint="Filter type of the MiniDSP low-pass (woofer) and high-pass (mid + tweeter).">
        <Segmented label="Alignment" size="sm" value={dig.align} options={ALIGNS}
                   onChange={a => edit(d => { d.digital.align = a; })} />
      </Field>
      <Field stacked label="Crossover frequency" focusId="digital.fc"
             hint={limits ? `Where the woofer hands over to the midrange. The green band is the target window, ${fmtFreq(limits.wm[0])}–${fmtFreq(limits.wm[1])}.` : "Where the woofer hands over to the midrange."}>
        <Slider label="Crossover frequency" value={dig.fc} min={100} max={1000} log step={1} format={v => fmtFreq(v)} parse={s => parseNumber(s)}
                band={limits?.wm} defaultValue={START.fc} color="var(--woof)"
                onInput={v => edit(d => { d.digital.fc = v; }, false)} onCommit={v => edit(d => { d.digital.fc = v; })} />
      </Field>
      <Field stacked label="Woofer gain" focusId="digital.gain"
             hint="MiniDSP output level of the woofer channel, to match it to the passively filtered mid and tweeter.">
        <Slider label="Woofer gain" value={dig.g_woof_dB} min={-12} max={6} step={0.1} origin={0} unit="dB" digits={1}
                format={v => fmtDb(v, { sign: true })} parse={s => parseNumber(s, "dB")} defaultValue={START.g_woof_dB} color="var(--woof)"
                onInput={v => edit(d => { d.digital.g_woof_dB = v; }, false)} onCommit={v => edit(d => { d.digital.g_woof_dB = v; })} />
      </Field>
      <Field label="Woofer polarity" focusId="digital.pol" hint="Invert the woofer if it cancels the midrange around the crossover.">
        <Segmented label="Woofer polarity" size="sm" value={pol} options={POLARITY_OPTIONS}
                   onChange={p => edit(d => { d.pol.woof = p; })} />
      </Field>
    </Section>
  );
}
