import { isMac } from "./hooks";

const NAMES: Record<string, string> = isMac
  ? { mod: "⌘", ctrl: "⌃", shift: "⇧", alt: "⌥", enter: "↵", esc: "Esc", up: "↑", down: "↓", left: "←", right: "→", backspace: "⌫" }
  : { mod: "Ctrl", ctrl: "Ctrl", shift: "Shift", alt: "Alt", enter: "Enter", esc: "Esc", up: "↑", down: "↓", left: "←", right: "→", backspace: "⌫" };

/** Turns "Mod+Shift+Z" into the platform's key names: ⌘ ⇧ Z on macOS, Ctrl Shift Z elsewhere. */
export function keyLabels(keys: string): string[] {
  return keys.split("+").map(k => NAMES[k.trim().toLowerCase()] ?? k.trim().toUpperCase());
}

/** A key combination, e.g. <Kbd keys="Mod+K" />. "Mod" is ⌘ on macOS and Ctrl elsewhere. */
export function Kbd({ keys, quiet }: { keys: string; quiet?: boolean }) {
  return (
    <span className={"cs-kbd" + (quiet ? " cs-kbd-quiet" : "")} aria-label={keyLabels(keys).join(" ")}>
      {keyLabels(keys).map((k, i) => <kbd key={i}>{k}</kbd>)}
    </span>
  );
}
