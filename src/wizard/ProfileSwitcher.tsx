// Title-bar profile switcher: bundled and saved profiles, import, open from disk, and the details sheet.
import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, FileUp, FolderOpen, Info, Package, RefreshCw } from "lucide-react";
import { BUNDLED_PROFILES, useStore } from "../state/store";
import { isTauri } from "../platform";
import { Button, Menu, type MenuItem } from "../ui";
import { loadIntoApp, openProfilePath, pickAndOpenProfile, refreshSavedProfiles, useSavedProfiles } from "./profiles";
import { ProfileDetails } from "./ProfileDetails";

export function ProfileSwitcher() {
  const profile = useStore(s => s.profile);
  const saved = useSavedProfiles(s => s.entries);
  const status = useSavedProfiles(s => s.status);
  const [details, setDetails] = useState(false);

  // the list changes when a profile is opened, saved or imported; re-read it then
  useEffect(() => { void refreshSavedProfiles(); }, [profile?.id]);

  const desktop = isTauri();
  const items: MenuItem[] = [
    { kind: "label", id: "l-bundled", label: "Example" },
    ...BUNDLED_PROFILES.map((p): MenuItem => ({
      id: `bundled:${p.id}`, label: p.name, icon: Package, checked: p === profile, hint: "bundled",
      onSelect: () => { if (p !== profile) loadIntoApp(p); },
    })),
  ];
  const onBundled = !!profile && BUNDLED_PROFILES.includes(profile);
  if (desktop) {
    items.push({ kind: "label", id: "l-saved", label: "Your profiles" });
    if (saved.length) {
      items.push(...saved.map((e): MenuItem => ({
        id: `saved:${e.path}`, label: e.name, icon: BookOpen, checked: !onBundled && e.id === profile?.id,
        hint: e.id, onSelect: () => void openProfilePath(e.path),
      })));
    } else {
      items.push({ id: "none", label: status === "loading" ? "Looking…" : status === "error" ? "Could not list profiles" : "None yet: import your measurements",
                   disabled: true, onSelect: () => {} });
    }
  }
  items.push(
    { kind: "separator", id: "s1" },
    { id: "import", label: "Import measurements…", icon: FileUp, onSelect: () => useStore.getState().setUi({ wizard: true }) },
    { id: "open", label: "Open profile file…", icon: FolderOpen, disabled: !desktop, hint: desktop ? undefined : "desktop app",
      onSelect: () => void pickAndOpenProfile() },
    { id: "details", label: "Show profile details", icon: Info, disabled: !profile, onSelect: () => setDetails(true) },
  );
  if (desktop) items.push({ id: "refresh", label: "Refresh the list", icon: RefreshCw, onSelect: () => void refreshSavedProfiles() });

  return (
    <>
      <Menu
        label="Profiles"
        trigger={
          <Button variant="ghost" size="sm" iconRight={ChevronDown} className="wz-switcher" title="Switch profile">
            <span className="wz-switcher-label">{profile?.name ?? "No profile"}</span>
          </Button>
        }
        items={items}
      />
      <ProfileDetails open={details} onClose={() => setDetails(false)} />
    </>
  );
}
