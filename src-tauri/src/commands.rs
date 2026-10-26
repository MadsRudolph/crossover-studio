// Tauri commands. Types mirror src/types.ts (FileInfo, MatVariable, ReadSpec, Series, ProfileEntry);
// the command names and arguments are fixed by src/platform/index.ts.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::Manager;

use crate::mat::{self, MatFile, MatValue, MatVar};
use crate::profile;
use crate::text::{self, TextFormat};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct MatVariable {
    pub name: String,
    pub class: String,
    pub dims: Vec<usize>,
    pub complex: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub format: String,
    pub variables: Vec<MatVariable>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub points: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReadSpec {
    pub path: String,
    pub freq_var: Option<String>,
    pub data_var: Option<String>,
    pub column: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Series {
    pub f: Vec<f64>,
    pub re: Vec<f64>,
    pub im: Vec<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ProfileEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub bundled: bool,
}

/// Char variables longer than this are shown truncated in the file inspector.
const TEXT_PREVIEW_CHARS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Mat,
    Text,
    Unknown,
}

/// Format by content first (a .mat renamed .txt still opens), then by extension.
fn detect(path: &Path, bytes: &[u8]) -> Kind {
    let ext = path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    if mat::looks_like_mat(bytes) {
        return Kind::Mat;
    }
    // Text files are UTF-8 or ASCII; a NUL byte in the first kilobyte means binary.
    let head = &bytes[..bytes.len().min(1024)];
    let binary = head.contains(&0);
    // A .mat that is really text (a renamed CSV) is read as text; a binary one goes to the MAT reader,
    // which explains what is wrong with it.
    if !binary && (std::str::from_utf8(bytes).is_ok() || matches!(ext.as_str(), "txt" | "csv" | "tsv" | "dat")) {
        return Kind::Text;
    }
    if ext == "mat" {
        return Kind::Mat;
    }
    Kind::Unknown
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("could not read {}: {e}", path.display()))
}

fn to_variable(v: &MatVar) -> MatVariable {
    let text = match &v.value {
        MatValue::Text(t) if t.chars().count() > TEXT_PREVIEW_CHARS => Some(format!("{}…", t.chars().take(TEXT_PREVIEW_CHARS).collect::<String>())),
        MatValue::Text(t) => Some(t.clone()),
        _ => None,
    };
    MatVariable { name: v.name.clone(), class: v.class.clone(), dims: v.dims.clone(), complex: v.complex, text }
}

pub fn inspect_path(path: &Path) -> Result<FileInfo, String> {
    let bytes = read_bytes(path)?;
    let mut info = FileInfo { path: path.to_string_lossy().into_owned(), name: file_name(path), ..Default::default() };
    // Parse failures are reported in `error` rather than as Err, so the UI can still list the file.
    match detect(path, &bytes) {
        Kind::Mat => {
            info.format = "mat".into();
            match mat::read_mat(&bytes) {
                Ok(f) => info.variables = f.variables.iter().map(to_variable).collect(),
                Err(e) => info.error = Some(e.to_string()),
            }
        }
        Kind::Text => {
            let text = String::from_utf8_lossy(&bytes);
            info.format = if text::looks_like_ltspice(&text) { "ltspice" } else { "csv" }.into();
            match text::parse_text(&text) {
                Ok((_, t)) => {
                    info.points = Some(t.f.len());
                    info.header = Some(t.header);
                }
                Err(e) => info.error = Some(e.to_string()),
            }
        }
        Kind::Unknown => {
            info.format = "unknown".into();
            info.error = Some("not a MATLAB .mat, LTspice .txt or CSV file".into());
        }
    }
    Ok(info)
}

/// One series cut out of a variable: (re, im, the column used when the variable is a matrix).
type Picked = (Vec<f64>, Vec<f64>, Option<usize>);

/// Splits a numeric variable into the series selected by `column`, given the frequency length `n`.
/// Accepts row or column vectors and n x k matrices (column j) or k x n matrices (row j).
fn pick(v: &MatVar, n: usize, column: Option<usize>) -> Result<Picked, String> {
    let MatValue::Numeric { re, im } = &v.value else {
        return Err(format!("{} is a {} variable; choose a numeric one", v.name, v.class));
    };
    let im = im.clone().unwrap_or_else(|| vec![0.0; re.len()]);
    // Drop trailing singleton dimensions: [412 3 1] is a matrix.
    let mut dims = v.dims.clone();
    while dims.len() > 2 && dims.last() == Some(&1) {
        dims.pop();
    }
    if dims.len() > 2 {
        return Err(format!("{} has {} dimensions ({:?}); Crossover Studio reads vectors and matrices", v.name, dims.len(), v.dims));
    }
    let (rows, cols) = (dims.first().copied().unwrap_or(0), dims.get(1).copied().unwrap_or(1));
    if rows == 1 || cols == 1 {
        if re.len() != n {
            return Err(format!("{} has {} points but the frequency vector has {n}", v.name, re.len()));
        }
        return Ok((re.clone(), im, None));
    }
    // Matrix: the dimension that matches the frequency length runs along frequency.
    let (count, along_rows) = if rows == n {
        (cols, true)
    } else if cols == n {
        (rows, false)
    } else {
        return Err(format!("{} is {rows}x{cols}, but the frequency vector has {n} points", v.name));
    };
    let Some(j) = column else {
        return Err(format!("{} holds {count} series ({rows}x{cols}); choose a column 0..{}", v.name, count - 1));
    };
    if j >= count {
        return Err(format!("{} has only {count} series; column {j} does not exist (0-based)", v.name));
    }
    let idx: Vec<usize> = if along_rows { (0..n).map(|i| j * rows + i).collect() } else { (0..n).map(|i| i * rows + j).collect() };
    Ok((idx.iter().map(|&i| re[i]).collect(), idx.iter().map(|&i| im[i]).collect(), Some(j)))
}

fn read_mat_series(file: &MatFile, spec: &ReadSpec, name: String) -> Result<Series, String> {
    let (Some(fv), Some(dv)) = (spec.freq_var.as_deref(), spec.data_var.as_deref()) else {
        return Err("choose the frequency variable and the data variable".into());
    };
    let get = |n: &str| file.get(n).ok_or_else(|| format!("{name} has no variable \"{n}\""));
    let fvar = get(fv)?;
    let dvar = get(dv)?;
    let MatValue::Numeric { re: fre, .. } = &fvar.value else {
        return Err(format!("{fv} is a {} variable; the frequency must be numeric", fvar.class));
    };
    if fvar.dims.iter().filter(|d| **d > 1).count() > 1 {
        return Err(format!("{fv} is a matrix ({:?}); the frequency must be a vector", fvar.dims));
    }
    let (mut re, mut im, column) = pick(dvar, fre.len(), spec.column)?;
    let mut f = fre.clone();
    let dc_note = text::drop_dc(&mut f, &mut re, &mut im);
    text::validate(&f, &re, &im).map_err(|e| format!("{dv} against {fv}: {e}"))?;

    let mut src = Map::new();
    src.insert("file".into(), name.into());
    src.insert("format".into(), "mat".into());
    src.insert("freqVar".into(), fv.into());
    src.insert("dataVar".into(), dv.into());
    if let Some(c) = column {
        src.insert("column".into(), c.into());
    }
    // Lab scripts store a free-text `note` ("vent plugged"); carry it along.
    let lab_note = match file.get("note").map(|v| &v.value) {
        Some(MatValue::Text(t)) if !t.trim().is_empty() => Some(t.trim().to_string()),
        _ => None,
    };
    let note: Vec<String> = lab_note.into_iter().chain(dc_note).collect();
    if !note.is_empty() {
        src.insert("note".into(), note.join(" ").into());
    }
    Ok(Series { f, re, im, source: Some(Value::Object(src)) })
}

pub fn read_series_spec(spec: &ReadSpec) -> Result<Series, String> {
    let path = PathBuf::from(&spec.path);
    let bytes = read_bytes(&path)?;
    let name = file_name(&path);
    match detect(&path, &bytes) {
        Kind::Mat => {
            let file = mat::read_mat(&bytes).map_err(|e| format!("{name}: {e}"))?;
            read_mat_series(&file, spec, name)
        }
        Kind::Text => {
            let (fmt, t) = text::parse_text(&String::from_utf8_lossy(&bytes)).map_err(|e| format!("{name}: {e}"))?;
            text::validate(&t.f, &t.re, &t.im).map_err(|e| format!("{name}: {e}"))?;
            let mut src = Map::new();
            src.insert("file".into(), name.into());
            src.insert("format".into(), if fmt == TextFormat::Ltspice { "ltspice" } else { "csv" }.into());
            if let Some(n) = t.note() {
                src.insert("note".into(), n.into());
            }
            Ok(Series { f: t.f, re: t.re, im: t.im, source: Some(Value::Object(src)) })
        }
        Kind::Unknown => Err(format!("{name} is not a MATLAB .mat, LTspice .txt or CSV file")),
    }
}

fn app_data(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| format!("could not find the app data folder: {e}"))
}

// Parsing a 6 MB .mat takes a moment: the file commands are async so they run off the main thread
// and never freeze the window.

#[tauri::command]
pub async fn inspect_file(path: String) -> Result<FileInfo, String> {
    inspect_path(Path::new(&path))
}

#[tauri::command]
pub async fn read_series(spec: ReadSpec) -> Result<Series, String> {
    read_series_spec(&spec)
}

#[tauri::command]
pub async fn list_profiles(app: tauri::AppHandle) -> Result<Vec<ProfileEntry>, String> {
    Ok(profile::list(&app_data(&app)?))
}

#[tauri::command]
pub async fn load_profile(app: tauri::AppHandle, path: String) -> Result<Value, String> {
    let file = profile::resolve(Path::new(&path));
    let value = profile::load(&file)?;
    if let Ok(dir) = app_data(&app) {
        profile::remember_recent(&dir, &file);
    }
    Ok(value)
}

#[tauri::command]
pub async fn save_profile(app: tauri::AppHandle, profile: Value, source_files: Vec<String>) -> Result<String, String> {
    let folder = profile::save(&app_data(&app)?, &profile, &source_files)?;
    Ok(folder.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    write_creating_dirs(&path, contents.as_bytes())
}

#[tauri::command]
pub fn write_binary_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    write_creating_dirs(&path, &bytes)
}

/// Writes a file, creating its parent folders first so exporters can write into a subfolder.
fn write_creating_dirs(path: &str, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = Path::new(path).parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    std::fs::write(path, bytes).map_err(|e| format!("could not write {path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fx(rel: &str) -> String {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures").join(rel).to_string_lossy().into_owned()
    }

    fn csv(rel: &str) -> Series {
        read_series_spec(&ReadSpec { path: fx(rel), ..Default::default() }).unwrap()
    }

    fn mat(rel: &str, f: &str, d: &str, column: Option<usize>) -> Result<Series, String> {
        read_series_spec(&ReadSpec { path: fx(rel), freq_var: Some(f.into()), data_var: Some(d.into()), column })
    }

    /// Data to `tol` relative to the magnitude; frequency to 1e-5 because the CSVs round it to six digits.
    fn assert_close(a: &Series, b: &Series, tol: f64, what: &str) {
        assert_eq!(a.f.len(), b.f.len(), "{what}: length");
        for k in 0..a.f.len() {
            assert!((a.f[k] - b.f[k]).abs() <= 1e-5 * b.f[k].abs(), "{what}: f {} vs {}", a.f[k], b.f[k]);
            let m = b.re[k].hypot(b.im[k]);
            assert!((a.re[k] - b.re[k]).abs() <= tol * m, "{what}: re at {} Hz: {} vs {}", b.f[k], a.re[k], b.re[k]);
            assert!((a.im[k] - b.im[k]).abs() <= tol * m, "{what}: im at {} Hz: {} vs {}", b.f[k], a.im[k], b.im[k]);
        }
    }

    #[test]
    fn text_with_mi_at_the_mat_marker_offset_is_text() {
        // REW-style export whose comment puts "MI" (of "UMIK-1") at bytes 126..128
        let mut text = String::from("* Measurement data exported from a measurement program for the loudspeaker lab, group ten, ");
        while text.len() < 125 {
            text.push('x');
        }
        text.push_str("UMIK-1\n* Freq(Hz), SPL(dB), Phase(degrees)\n100, 0, 90\n200, 6, 0\n");
        assert_eq!(&text.as_bytes()[126..128], b"MI");
        let dir = std::env::temp_dir().join(format!("xs-detect-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("rew.txt");
        std::fs::write(&path, &text).unwrap();
        assert_eq!(detect(&path, text.as_bytes()), Kind::Text);
        let s = read_series_spec(&ReadSpec { path: path.to_string_lossy().into_owned(), ..Default::default() }).unwrap();
        assert_eq!(s.f, vec![100.0, 200.0]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn mat_impedance_matches_the_csv() {
        let s = mat("mat/labD_midrange.mat", "fn", "Z", None).unwrap();
        assert_close(&s, &csv("csv/Z_midrange.csv"), 1e-9, "Z_midrange");
        let src = s.source.unwrap();
        assert_eq!(src["format"], "mat");
        assert_eq!(src["dataVar"], "Z");
        assert!(src.get("column").is_none());
        assert!(src.get("note").is_none(), "the midrange note is empty");
        for (m, c) in [("labD_tweeter", "Z_tweeter"), ("labD_woofer_free", "Z_woofer_free"), ("labD_woofer_closed", "Z_woofer_closed"), ("labD_vent_L160", "Z_vent_L160")] {
            assert_close(&mat(&format!("mat/{m}.mat"), "fn", "Z", None).unwrap(), &csv(&format!("csv/{c}.csv")), 1e-9, m);
        }
        assert_close(&mat("mat/labD_nf_cone_L160.mat", "fn", "H", None).unwrap(), &csv("csv/NF_cone_L160.csv"), 1e-9, "nf cone");
    }

    #[test]
    fn mat_matrix_columns_match_the_csv() {
        let tw = mat("mat/labE_system_0.mat", "fn", "H", Some(2)).unwrap();
        assert_close(&tw, &csv("csv/TF_on_tweeter.csv"), 1e-9, "tweeter 0 deg");
        let src = tw.source.as_ref().unwrap();
        assert_eq!(src["column"], 2);
        assert_eq!(src["note"], "vent plugged");
        assert_close(&mat("mat/labE_system_0.mat", "fn", "H", Some(0)).unwrap(), &csv("csv/TF_on_woofer.csv"), 1e-9, "woofer 0 deg");
        assert_close(&mat("mat/labE_system_30.mat", "fn", "H", Some(1)).unwrap(), &csv("csv/TF_off30_midrange.csv"), 1e-9, "mid 30 deg");

        let no_col = mat("mat/labE_system_0.mat", "fn", "H", None).unwrap_err();
        assert!(no_col.contains("choose a column"), "{no_col}");
        assert!(mat("mat/labE_system_0.mat", "fn", "H", Some(3)).unwrap_err().contains("does not exist"));
        assert!(mat("mat/labE_system_0.mat", "fn", "specn", Some(0)).unwrap_err().contains("dimensions"));
        assert!(mat("mat/labE_system_0.mat", "fn", "units", None).unwrap_err().contains("cell"));
        assert!(mat("mat/labE_system_0.mat", "f", "H", Some(0)).unwrap_err().contains("frequency vector has 48000"));
        assert!(mat("mat/labE_system_0.mat", "fn", "nope", None).unwrap_err().contains("no variable"));
        // A .mat read without naming the variables asks for them.
        assert!(read_series_spec(&ReadSpec { path: fx("mat/labD_midrange.mat"), ..Default::default() }).unwrap_err().contains("choose"));
    }

    #[test]
    fn text_series_carry_their_notes() {
        let z = csv("text/Zi_mid.txt");
        assert_close(&z, &csv("csv/Z_midrange.csv"), 1e-6, "Zi_mid");
        let src = z.source.unwrap();
        assert_eq!(src["format"], "ltspice");
        assert!(src["note"].as_str().unwrap().contains("Admittance"));
        let tf = csv("text/TF_mid.txt");
        let c = csv("csv/TF_on_midrange.csv");
        for k in 0..c.f.len() {
            let (a, b) = (tf.re[k].hypot(tf.im[k]), c.re[k].hypot(c.im[k]));
            assert!((a - b).abs() <= 1e-6 * b);
        }
        assert_eq!(csv("csv/Z_tweeter.csv").source.unwrap()["format"], "csv");
    }

    #[test]
    fn inspect_lists_variables_and_reports_problems() {
        let i = inspect_path(Path::new(&fx("mat/labD_midrange.mat"))).unwrap();
        assert_eq!(i.format, "mat");
        assert!(i.error.is_none());
        let z = i.variables.iter().find(|v| v.name == "Z").unwrap();
        assert_eq!((z.class.as_str(), z.dims.clone(), z.complex), ("double", vec![479, 1], true));
        assert_eq!(i.variables.iter().find(|v| v.name == "tag").unwrap().text.as_deref(), Some("midrange"));
        assert_eq!(i.variables.iter().find(|v| v.name == "time").unwrap().class, "datetime");

        let t = inspect_path(Path::new(&fx("text/Zi_mid.txt"))).unwrap();
        assert_eq!((t.format.as_str(), t.points), ("ltspice", Some(479)));
        assert!(t.header.unwrap().starts_with("BiZin_mid"));
        let c = inspect_path(Path::new(&fx("csv/Z_midrange.csv"))).unwrap();
        assert_eq!((c.format.as_str(), c.points, c.header.as_deref()), ("csv", Some(479), Some("f,re,im")));

        let dir = std::env::temp_dir().join(format!("crossover-studio-inspect-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let v73 = dir.join("new.mat");
        let mut bytes = vec![0u8; 520];
        bytes[..10].copy_from_slice(b"MATLAB 7.3");
        bytes[512..520].copy_from_slice(b"\x89HDF\r\n\x1a\n");
        std::fs::write(&v73, &bytes).unwrap();
        let i = inspect_path(&v73).unwrap();
        assert_eq!(i.format, "mat");
        assert!(i.error.unwrap().contains("-v7"));
        assert!(read_series_spec(&ReadSpec { path: v73.to_string_lossy().into(), freq_var: Some("f".into()), data_var: Some("Z".into()), column: None })
            .unwrap_err()
            .contains("v7.3"));
        let truncated = dir.join("cut.mat");
        let full = std::fs::read(fx("mat/labD_midrange.mat")).unwrap();
        std::fs::write(&truncated, &full[..full.len() / 3]).unwrap();
        assert!(inspect_path(&truncated).unwrap().error.is_some());
        let bin = dir.join("x.bin");
        std::fs::write(&bin, [0u8, 1, 2, 255]).unwrap();
        assert_eq!(inspect_path(&bin).unwrap().format, "unknown");
        assert!(inspect_path(&dir.join("missing.csv")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
