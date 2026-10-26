// The Crossover Studio mark: three filter slopes (woofer low-pass, midrange band-pass, tweeter high-pass)
// hanging from one flat accent line, their acoustic sum. The same drawing is the app icon
// (src-tauri/icons/icon.svg) on a graphite tile.

export const LOGO_PATHS = {
  sum: "M10 26 H90",
  woof: "M10 42 H28 C38 42 44 58 52 78",
  mid: "M24 78 C32 58 36 42 46 42 H54 C64 42 68 58 76 78",
  tw: "M48 78 C56 58 62 42 72 42 H90",
};

export function Logo({ size = 22, title = "Crossover Studio" }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={title} className="cs-logo">
      <rect x="2" y="2" width="96" height="96" rx="24" fill="var(--surface-3)" stroke="var(--line-strong)" strokeWidth="2" />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="7">
        <path d={LOGO_PATHS.woof} stroke="var(--woof)" />
        <path d={LOGO_PATHS.mid} stroke="var(--mid)" />
        <path d={LOGO_PATHS.tw} stroke="var(--tw)" />
        <path d={LOGO_PATHS.sum} stroke="var(--accent)" strokeWidth="8" />
      </g>
    </svg>
  );
}
