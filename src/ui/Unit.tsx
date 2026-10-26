// Units and quantity symbols inside upper-case labels. The label styles (Barlow Semi Condensed caps)
// would turn "200 Hz–15 kHz" into "200 HZ–15 KHZ" and "1 m" into "1 M"; wrapping the unit in
// <span class="unit"> (text-transform: none, base.css) keeps SI spelling while the words stay in caps.
import { Fragment, type ReactNode } from "react";

/** A unit right after a number ("200 Hz", "-4.5 dB", "2.83 V", "1 m"), or a quantity symbol
 *  (fB, f3, fs, fc). Longest units first, so "kHz" is not read as "k" + "Hz". */
const UNIT_RE = /(?<=\d\s?)(kHz|Hz|dB|kΩ|Ω|mH|µH|uH|µF|uF|nF|mm|cm|m\/s|ms|kg|V|W|L|m)(?![\p{L}])|\b(fB|f3|fs|fc|fS)\b/gu;

/** The text with its units wrapped so an upper-case label leaves them alone. Non-strings pass through. */
export function withUnits(text: ReactNode): ReactNode {
  if (typeof text !== "string") return text;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(UNIT_RE)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(<span key={at} className="unit">{m[0]}</span>);
    last = at + m[0].length;
  }
  if (!parts.length) return text;
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment>{parts}</Fragment>;
}

/** <Unit>kHz</Unit>: an explicit unit inside a label. */
export function Unit({ children }: { children: ReactNode }) {
  return <span className="unit">{children}</span>;
}
