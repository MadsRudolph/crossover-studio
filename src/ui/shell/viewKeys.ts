// Number keys for the views: 1-9 pick the first nine views and 0 the tenth.
// Later views are reached from the tab bar and the command palette.

/** The key that opens view number i (0-based), if it has one. */
export function viewKey(i: number): string | undefined {
  return i < 9 ? String(i + 1) : i === 9 ? "0" : undefined;
}

/** The view index (0-based) that a number key opens. */
export function viewKeyIndex(key: string): number {
  return key === "0" ? 9 : Number(key) - 1;
}
