// Shell-only UI state that no view needs: the help dialog and the design's display name.
// (Everything about the design itself lives in the app store.)
import { create } from "zustand";

const NAME_KEY = "crossover-studio:design-names";

function readNames(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(NAME_KEY) || "{}"); } catch { return {}; }
}

interface ShellState {
  help: boolean;
  setHelp(open: boolean): void;
  /** Design name per profile id. */
  names: Record<string, string>;
  setName(profileId: string, name: string): void;
}

export const useShell = create<ShellState>((set, get) => ({
  help: false,
  setHelp(help) { set({ help }); },
  names: readNames(),
  setName(profileId, name) {
    const names = { ...get().names, [profileId]: name };
    set({ names });
    try { localStorage.setItem(NAME_KEY, JSON.stringify(names)); } catch { /* storage unavailable: the name lasts this session */ }
  },
}));

export const DEFAULT_DESIGN_NAME = "Untitled design";
