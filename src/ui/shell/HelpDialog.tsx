import { Dialog } from "../Dialog";
import { Kbd } from "../Kbd";
import { Logo } from "../Logo";
import { SHORTCUTS } from "./shortcuts";
import { useShell } from "./shellState";
import { STEPS } from "./commands";

const VERSION = "0.1.0";

export function HelpDialog() {
  const open = useShell(s => s.help);
  const setHelp = useShell(s => s.setHelp);
  return (
    <Dialog open={open} onClose={() => setHelp(false)} size="lg" title="Crossover Studio"
            description="Design the three-way loudspeaker of 34870 Electroacoustics from your own Lab D and Lab E measurements.">
      <div className="cs-help">
        <section>
          <h3 className="label-caps">How it works</h3>
          <ol className="cs-help-steps">
            {STEPS.map((s, i) => <li key={s.id}><span className="mono">{i + 1}</span>{s.title}</li>)}
          </ol>
          <p className="cs-help-p">
            Work down the inspector on the left. Every change recomputes the whole system from your measured
            responses, so each curve, the 3D model and the checks update while you drag. When the checks are
            green, export the MiniDSP filters and the parts list.
          </p>
          <div className="cs-help-about">
            <Logo size={36} />
            <div>
              <div className="cs-help-name">Crossover Studio <span className="mono">{VERSION}</span></div>
              <div className="cs-help-sub">Box fit, digital and passive crossovers, checks and optimiser. Runs fully offline.</div>
            </div>
          </div>
        </section>
        <section>
          {SHORTCUTS.map(g => (
            <div key={g.group} className="cs-help-group">
              <h3 className="label-caps">{g.group}</h3>
              <dl>
                {g.items.map(it => (
                  <div key={it.keys + it.what} className="cs-help-row">
                    <dt>{it.what}</dt>
                    <dd><Kbd keys={it.keys} /></dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </section>
      </div>
    </Dialog>
  );
}
