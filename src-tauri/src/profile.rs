// Profiles on disk. A profile is one folder: profile.json (measurements embedded, schema = src/types.ts
// `Profile`) plus a sources/ folder with copies of the files it was built from, so a group can zip the
// folder and hand it on. Saved profiles live in <app data>/profiles/<id>/; profiles opened from anywhere
// else are remembered in <app data>/recent.json.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::commands::ProfileEntry;

pub const PROFILE_FILE: &str = "profile.json";
const RECENT_FILE: &str = "recent.json";
const RECENT_MAX: usize = 12;
const SUPPORTED_VERSION: u64 = 1;

/// A path to profile.json, or to the folder that holds it.
pub fn resolve(path: &Path) -> PathBuf {
    if path.is_dir() { path.join(PROFILE_FILE) } else { path.to_path_buf() }
}

/// Folder-safe id: letters, digits, '-', '_' and '.', not starting with '.', at most 64 characters.
pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && !id.starts_with('.')
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Checks the parts of the schema every view relies on, and reports all problems at once.
pub fn validate(p: &Value) -> Result<(), String> {
    let Some(obj) = p.as_object() else {
        return Err("the file is JSON but not a profile (expected an object at the top level)".into());
    };
    match obj.get("version") {
        None => return Err("the file has no \"version\" field; is it a Crossover Studio profile.json?".into()),
        Some(v) => match v.as_u64() {
            Some(SUPPORTED_VERSION) => {}
            Some(n) if n > SUPPORTED_VERSION => {
                return Err(format!("the profile is version {n}, made by a newer Crossover Studio; update the app to open it"));
            }
            _ => return Err(format!("unsupported profile version {v}; this app reads version {SUPPORTED_VERSION}")),
        },
    }
    let mut problems = Vec::new();
    match obj.get("id").and_then(Value::as_str) {
        None => problems.push("\"id\" (text) is missing".to_string()),
        Some(id) if !is_valid_id(id) => {
            problems.push(format!("\"id\" \"{id}\" must use only letters, digits, '-', '_' or '.' (it names a folder)"))
        }
        _ => {}
    }
    if obj.get("name").and_then(Value::as_str).is_none_or(|s| s.trim().is_empty()) {
        problems.push("\"name\" (text) is missing".into());
    }
    for key in ["conditions", "units", "woofer_box", "top_box", "measurements", "components", "limits"] {
        if !obj.get(key).is_some_and(Value::is_object) {
            problems.push(format!("\"{key}\" (object) is missing"));
        }
    }
    if let Some(units) = obj.get("units").and_then(Value::as_object) {
        let missing: Vec<&str> = ["woof", "mid", "tw"].into_iter().filter(|u| !units.contains_key(*u)).collect();
        if !missing.is_empty() {
            problems.push(format!("\"units\" needs woof, mid and tw (missing: {})", missing.join(", ")));
        }
    }
    if let Some(m) = obj.get("measurements").and_then(Value::as_object) {
        if !m.get("tf").and_then(|t| t.get("0")).is_some_and(Value::is_object) {
            problems.push("\"measurements.tf\" needs the on-axis set \"0\"".into());
        }
        if !m.get("zi").is_some_and(Value::is_object) {
            problems.push("\"measurements.zi\" (object) is missing".into());
        }
        if !m.get("woofer").is_some_and(Value::is_object) {
            problems.push("\"measurements.woofer\" (object) is missing".into());
        }
    }
    if problems.is_empty() { Ok(()) } else { Err(format!("the profile is incomplete: {}", problems.join("; "))) }
}

pub fn load(path: &Path) -> Result<Value, String> {
    let file = resolve(path);
    let text = fs::read_to_string(&file).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("no profile at {} (expected a profile.json or a folder holding one)", file.display())
        } else {
            format!("could not read {}: {e}", file.display())
        }
    })?;
    let value: Value =
        serde_json::from_str(&text).map_err(|e| format!("{} is not valid JSON (line {}, column {}): {e}", file.display(), e.line(), e.column()))?;
    validate(&value).map_err(|e| format!("{}: {e}", file.display()))?;
    Ok(value)
}

fn read_recent(app_data: &Path) -> Vec<PathBuf> {
    fs::read_to_string(app_data.join(RECENT_FILE))
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect()
}

/// `fs::canonicalize` on Windows returns verbatim paths ("\\?\C:\Users\..."), which the recent list would
/// then show and hand back. Drop the prefix where the plain form means the same: drive paths, and shares.
fn plain(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    match s.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') && rest.len() < 260 => PathBuf::from(rest),
        _ => p,
    }
}

/// Canonical form of a path for the recent list, without a Windows verbatim prefix.
fn canonical(p: &Path) -> PathBuf {
    plain(fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()))
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// Moves `profile_json` to the front of the recent list. Failures are ignored: the list is a convenience.
pub fn remember_recent(app_data: &Path, profile_json: &Path) {
    let path = canonical(profile_json);
    let mut list: Vec<PathBuf> = read_recent(app_data).into_iter().filter(|p| !same_file(p, &path)).collect();
    list.insert(0, path);
    list.truncate(RECENT_MAX);
    let strings: Vec<String> = list.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    if fs::create_dir_all(app_data).is_ok()
        && let Ok(json) = serde_json::to_string_pretty(&strings)
    {
        let _ = fs::write(app_data.join(RECENT_FILE), json);
    }
}

fn entry_for(profile_json: &Path) -> Option<ProfileEntry> {
    let v = load(profile_json).ok()?;
    Some(ProfileEntry {
        id: v.get("id")?.as_str()?.to_string(),
        name: v.get("name")?.as_str()?.to_string(),
        path: profile_json.to_string_lossy().into_owned(),
        bundled: false,
    })
}

/// Recently opened profiles first (most recent first), then the other saved ones by name. Unreadable
/// or deleted profiles are left out.
pub fn list(app_data: &Path) -> Vec<ProfileEntry> {
    let mut out: Vec<ProfileEntry> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut push = |p: PathBuf, out: &mut Vec<ProfileEntry>| {
        let key = fs::canonicalize(&p).unwrap_or_else(|_| p.clone());
        if seen.contains(&key) {
            return;
        }
        if let Some(e) = entry_for(&p) {
            seen.insert(key);
            out.push(e);
        }
    };
    for p in read_recent(app_data) {
        push(p, &mut out);
    }
    let mut saved: Vec<ProfileEntry> = Vec::new();
    if let Ok(dir) = fs::read_dir(app_data.join("profiles")) {
        for e in dir.flatten() {
            let p = e.path().join(PROFILE_FILE);
            if p.is_file() {
                push(p, &mut saved);
            }
        }
    }
    saved.sort_by_key(|e| e.name.to_lowercase());
    out.extend(saved);
    out
}

/// Picks a file name in `dir` for a copy of `src`: its own name, or "name (2).ext" when a different file
/// already took that name in this save.
fn copy_target(dir: &Path, src: &Path, taken: &HashSet<String>) -> PathBuf {
    let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "source".into());
    if !taken.contains(&name) {
        return dir.join(name);
    }
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = src.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..).map(|k| format!("{stem} ({k}){ext}")).find(|n| !taken.contains(n)).map(|n| dir.join(n)).unwrap_or_else(|| dir.join(name))
}

/// Writes <app_data>/profiles/<id>/profile.json and copies `sources` into its sources/ folder.
/// Returns the profile folder.
pub fn save(app_data: &Path, profile: &Value, sources: &[String]) -> Result<PathBuf, String> {
    validate(profile)?;
    let id = profile["id"].as_str().unwrap_or_default();
    let folder = app_data.join("profiles").join(id);
    let src_dir = folder.join("sources");
    // Check every source before writing anything, so a bad path leaves no half-saved profile.
    let missing: Vec<&str> = sources.iter().map(String::as_str).filter(|s| !Path::new(s).is_file()).collect();
    if !missing.is_empty() {
        return Err(format!("these source files no longer exist: {}", missing.join(", ")));
    }
    fs::create_dir_all(&src_dir).map_err(|e| format!("could not create {}: {e}", src_dir.display()))?;
    // Replacing a profile (the wizard asks first): drop the copies the new one no longer uses, so sources/
    // holds only its own files rather than a mix of two imports. Copies it passes back are kept.
    let keep: HashSet<PathBuf> = sources.iter().filter_map(|s| fs::canonicalize(s).ok()).collect();
    for entry in fs::read_dir(&src_dir).map_err(|e| format!("could not read {}: {e}", src_dir.display()))?.flatten() {
        let p = entry.path();
        if p.is_file() && !fs::canonicalize(&p).is_ok_and(|c| keep.contains(&c)) {
            fs::remove_file(&p).map_err(|e| format!("could not remove the old copy {}: {e}", p.display()))?;
        }
    }

    let mut taken: HashSet<String> = HashSet::new();
    for s in sources {
        let src = Path::new(s);
        let target = copy_target(&src_dir, src, &taken);
        taken.insert(target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
        // Re-saving a profile passes the copies already in sources/: nothing to do.
        if target.exists() && same_file(src, &target) {
            continue;
        }
        fs::copy(src, &target).map_err(|e| format!("could not copy {} into the profile: {e}", src.display()))?;
    }

    let json = serde_json::to_string_pretty(profile).map_err(|e| format!("could not encode the profile: {e}"))?;
    let file = folder.join(PROFILE_FILE);
    let tmp = folder.join("profile.json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, &file).map_err(|e| format!("could not replace {}: {e}", file.display()))?;
    remember_recent(app_data, &file);
    Ok(folder)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundled() -> Value {
        let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../profiles/system-d-group10/profile.json");
        load(&p).unwrap()
    }

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("crossover-studio-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn bundled_profile_validates_and_loads_from_its_folder() {
        let v = bundled();
        assert_eq!(v["id"], "system-d-group10");
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../profiles/system-d-group10");
        assert_eq!(load(&dir).unwrap()["name"], v["name"]);
    }

    #[test]
    fn validation_messages() {
        let mut v = bundled();
        v["version"] = 2.into();
        assert!(validate(&v).unwrap_err().contains("newer"));
        v["version"] = 1.into();
        v["id"] = "../evil".into();
        v.as_object_mut().unwrap().remove("limits");
        let e = validate(&v).unwrap_err();
        assert!(e.contains("\"id\"") && e.contains("\"limits\""), "{e}");
        assert!(validate(&serde_json::json!({"name": "x"})).unwrap_err().contains("version"));
        assert!(validate(&serde_json::json!([1, 2])).is_err());
        let d = scratch("badjson");
        fs::write(d.join(PROFILE_FILE), "{ nope").unwrap();
        assert!(load(&d).unwrap_err().contains("not valid JSON"));
        assert!(load(&d.join("missing")).unwrap_err().contains("no profile"));
    }

    #[test]
    fn windows_verbatim_paths_are_shown_plain() {
        assert_eq!(plain(PathBuf::from(r"\\?\C:\Users\Søren\OneDrive\Dokumenter\p\profile.json")), PathBuf::from(r"C:\Users\Søren\OneDrive\Dokumenter\p\profile.json"));
        assert_eq!(plain(PathBuf::from(r"\\?\UNC\server\share\profile.json")), PathBuf::from(r"\\server\share\profile.json"));
        assert_eq!(plain(PathBuf::from("/home/x/profile.json")), PathBuf::from("/home/x/profile.json"));
        // a path too long for the plain form keeps its prefix
        let long = format!(r"\\?\C:\{}", "a".repeat(300));
        assert_eq!(plain(PathBuf::from(&long)), PathBuf::from(&long));
    }

    #[test]
    fn non_ascii_folders() {
        let app = scratch("Søren Ærø æ ø å");
        let v = bundled();
        let src = app.join("Målinger");
        fs::create_dir_all(&src).unwrap();
        let f = src.join("Z_mellemtone ø.csv");
        fs::write(&f, "f,re,im\n1,2,3\n").unwrap();
        let folder = save(&app, &v, &[f.to_string_lossy().into()]).unwrap();
        assert!(folder.join("sources/Z_mellemtone ø.csv").is_file());
        assert_eq!(list(&app)[0].id, "system-d-group10");
        assert_eq!(load(&folder).unwrap()["id"], "system-d-group10");
        let _ = fs::remove_dir_all(&app);
    }

    #[test]
    fn save_list_and_recent() {
        let app = scratch("save");
        let src = scratch("sources");
        let a = src.join("Z.csv");
        fs::write(&a, "f,re,im\n1,2,3\n").unwrap();
        fs::create_dir_all(src.join("other")).unwrap();
        let b = src.join("other").join("Z.csv");
        fs::write(&b, "f,re,im\n4,5,6\n").unwrap();

        let v = bundled();
        let folder = save(&app, &v, &[a.to_string_lossy().into(), b.to_string_lossy().into()]).unwrap();
        assert_eq!(folder, app.join("profiles/system-d-group10"));
        assert!(folder.join("sources/Z.csv").is_file());
        assert!(folder.join("sources/Z (2).csv").is_file());
        assert_eq!(load(&folder).unwrap(), v);

        // Saving again with the copies themselves as sources keeps them; copies it no longer uses go.
        let again = folder.join("sources/Z.csv").to_string_lossy().into_owned();
        save(&app, &v, &[again]).unwrap();
        assert!(folder.join("sources/Z.csv").is_file());
        assert!(!folder.join("sources/Z (2).csv").exists());

        // An outside profile opened by the user appears first; the saved one is not listed twice.
        let outside = scratch("outside");
        let mut w = v.clone();
        w["id"] = "other".into();
        w["name"] = "Other group".into();
        fs::write(outside.join(PROFILE_FILE), serde_json::to_string(&w).unwrap()).unwrap();
        remember_recent(&app, &outside.join(PROFILE_FILE));
        let listed = list(&app);
        assert_eq!(listed.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), vec!["other", "system-d-group10"]);

        // A deleted recent profile drops out silently.
        fs::remove_dir_all(&outside).unwrap();
        assert_eq!(list(&app).len(), 1);

        assert!(save(&app, &v, &["/definitely/not/here.mat".into()]).unwrap_err().contains("no longer exist"));
        for d in [app, src] {
            let _ = fs::remove_dir_all(d);
        }
    }
}
