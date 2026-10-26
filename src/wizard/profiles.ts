// Saved and recently opened profiles (desktop only), shared by the profile switcher and the wizard.
import { create } from "zustand";
import type { Profile, ProfileEntry } from "../types";
import * as platform from "../platform";
import { useStore } from "../state/store";
import { toast } from "../ui";

interface SavedProfiles {
  entries: ProfileEntry[];
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
}

export const useSavedProfiles = create<SavedProfiles>()(() => ({ entries: [], status: "idle" }));

/** Re-read the saved/recent list from the backend. A no-op in the browser preview. */
export async function refreshSavedProfiles(): Promise<void> {
  if (!platform.isTauri()) return;
  useSavedProfiles.setState({ status: "loading" });
  try {
    const entries = await platform.listProfiles();
    useSavedProfiles.setState({ entries, status: "ready", error: undefined });
  } catch (e) {
    useSavedProfiles.setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

/** Open a profile.json (or its folder) from disk and load it into the app, with a toast either way. */
export async function openProfilePath(path: string): Promise<boolean> {
  try {
    const profile = await platform.loadProfile(path);
    return loadIntoApp(profile);
  } catch (e) {
    toast({ tone: "bad", title: "Could not open that profile", description: e instanceof Error ? e.message : String(e) });
    return false;
  } finally {
    // opening records it as recent; a failed open may have dropped a deleted entry
    void refreshSavedProfiles();
  }
}

/** Ask for a profile file, then open it. */
export async function pickAndOpenProfile(): Promise<void> {
  if (!platform.isTauri()) {
    toast({ tone: "warn", title: "Opening files needs the desktop app", description: "The browser preview only has the bundled profile and the import wizard." });
    return;
  }
  let path: string | null;
  try { path = await platform.pickProfileFile(); }
  catch (e) { toast({ tone: "bad", title: "Could not open the file dialog", description: String(e) }); return; }
  if (path) await openProfilePath(path);
}

export function loadIntoApp(profile: Profile): boolean {
  useStore.getState().loadProfile(profile);
  const st = useStore.getState();
  if (st.profile !== profile) {
    toast({ tone: "bad", title: `Could not open ${profile.name}`, description: st.error ?? undefined });
    return false;
  }
  toast({ tone: "good", title: `Opened ${profile.name}` });
  return true;
}
