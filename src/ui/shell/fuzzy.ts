// Command-palette matching: literal substrings first, then in-order scattered characters.

/**
 * Fuzzy match score of `query` against `text` (higher is better, null = no match). Characters must appear
 * in order; consecutive runs and word starts score extra, so "mtx" finds "Mid/Tweeter crossover".
 */
export function fuzzy(query: string, text: string): { score: number; hits: number[] } | null {
  const q = query.toLowerCase().replace(/\s+/g, ""), t = text.toLowerCase();
  if (!q) return { score: 0, hits: [] };
  // a literal substring beats any scattered match; earlier and at a word start is better
  const literal = query.toLowerCase().trim();
  const at = t.indexOf(literal);
  if (at >= 0) {
    const n = literal.length;
    const wordStart = at === 0 || /[\s/:(\-.]/.test(t[at - 1]);
    return { score: 100 + n * 4 + (wordStart ? 20 : 0) - at * 0.5, hits: Array.from({ length: n }, (_, k) => at + k) };
  }
  let qi = 0, score = 0, run = 0;
  const hits: number[] = [];
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] !== q[qi]) { run = 0; continue; }
    const wordStart = i === 0 || /[\s/:(\-.]/.test(t[i - 1]);
    run++;
    score += 1 + run * 2 + (wordStart ? 6 : 0) - i * 0.02;
    hits.push(i);
    qi++;
  }
  return qi === q.length ? { score, hits } : null;
}
