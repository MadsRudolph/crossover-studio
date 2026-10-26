import { LOGO_PATHS } from "../Logo";

/** First paint while the profile is fitted and prepared: the mark draws itself, then fades into the app. */
export function Splash({ leaving, message }: { leaving: boolean; message: string }) {
  return (
    <div className={"cs-splash" + (leaving ? " is-leaving" : "")} role="status" aria-live="polite">
      <div className="cs-splash-card">
        <svg width="72" height="72" viewBox="0 0 100 100" aria-hidden className="cs-splash-mark">
          <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6">
            <path d={LOGO_PATHS.woof} stroke="var(--woof)" pathLength={1} />
            <path d={LOGO_PATHS.mid} stroke="var(--mid)" pathLength={1} />
            <path d={LOGO_PATHS.tw} stroke="var(--tw)" pathLength={1} />
            <path d={LOGO_PATHS.sum} stroke="var(--accent)" strokeWidth="7" pathLength={1} />
          </g>
        </svg>
        <div className="cs-splash-word">Crossover<b>Studio</b></div>
        <div className="cs-splash-msg">{message}</div>
      </div>
    </div>
  );
}
