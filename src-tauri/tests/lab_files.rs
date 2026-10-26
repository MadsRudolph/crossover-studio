// Reads every real lab file of the 34870 course: Lab D and Lab E .mat files and the Matlab2LTspice
// tables and CSVs of the project. The data is not part of this repository, so the test looks for it in
// XS_LAB_DIR (default: the course folder on the author's PC) and passes silently when it is not there.

use std::path::{Path, PathBuf};

use crossover_studio_lib::mat::{self, MatValue};
use crossover_studio_lib::text;

fn lab_dir() -> Option<PathBuf> {
    let dir = std::env::var_os("XS_LAB_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| Path::new(&h).join("DTU/5. Semester/Electroacoustics/Labs")))?;
    dir.is_dir().then_some(dir)
}

fn files(dir: &Path, ext: &str) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|d| d.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case(ext))).collect())
        .unwrap_or_default();
    v.sort();
    v
}

/// (real part, imaginary part, dims) of a numeric variable.
type Numeric<'a> = (&'a Vec<f64>, &'a Option<Vec<f64>>, &'a Vec<usize>);

fn numeric<'a>(f: &'a mat::MatFile, name: &str) -> Option<Numeric<'a>> {
    match f.get(name) {
        Some(v) => match &v.value {
            MatValue::Numeric { re, im } => Some((re, im, &v.dims)),
            _ => None,
        },
        None => None,
    }
}

#[test]
fn every_lab_d_and_lab_e_mat_file_reads() {
    let Some(root) = lab_dir() else {
        eprintln!("lab data not found; set XS_LAB_DIR to run this test");
        return;
    };
    let mut count = 0;
    for sub in ["Lab D/data", "Lab E/data"] {
        for p in files(&root.join(sub), "mat") {
            let f = mat::read_mat_file(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
            let (fnv, _, _) = numeric(&f, "fn").unwrap_or_else(|| panic!("{}: no numeric fn", p.display()));
            assert!(fnv.len() > 100, "{}: fn has {} points", p.display(), fnv.len());
            assert!(fnv.windows(2).all(|w| w[1] > w[0]), "{}: fn does not rise", p.display());
            // Lab D holds Z (impedance) or H (near field); Lab E holds H with one column per driver or one series.
            let data = ["Z", "H"].into_iter().find_map(|n| numeric(&f, n)).unwrap_or_else(|| panic!("{}: neither Z nor H", p.display()));
            let (re, im, dims) = data;
            assert!(im.is_some(), "{}: data is not complex", p.display());
            assert!(dims.contains(&fnv.len()), "{}: data {:?} does not run along fn ({})", p.display(), dims, fnv.len());
            assert!(re.iter().all(|x| x.is_finite()), "{}: non-finite data", p.display());
            count += 1;
        }
    }
    assert!(count >= 50, "only {count} .mat files found");
}

#[test]
fn every_project_text_table_and_csv_reads() {
    let Some(root) = lab_dir() else { return };
    let data = root.join("Project/data");
    let mut count = 0;
    for p in files(&data, "txt").into_iter().chain(files(&data.join("csv"), "csv")) {
        let s = std::fs::read_to_string(&p).unwrap();
        let (_, t) = text::parse_text(&s).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
        text::validate(&t.f, &t.re, &t.im).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
        if p.file_name().unwrap().to_string_lossy().starts_with("Zi_") {
            // an impedance after the 1/Y inversion: the voice-coil resistance, a few ohm, at the low end
            let z0 = t.re[0].hypot(t.im[0]);
            assert!((2.0..60.0).contains(&z0), "{}: |Z| at {} Hz is {z0}", p.display(), t.f[0]);
        }
        count += 1;
    }
    assert!(count >= 25, "only {count} text files found");
}

/// The inspector's listing of every Lab D/E file, as the import wizard receives it. Written to
/// src/wizard/fixtures/lab_inspect.json when XS_WRITE_SNAPSHOT=1, so the wizard's role assignment is tested
/// on the real variable lists (the data itself stays out of the repository). Without the variable set the
/// snapshot is compared, so a reader change that alters a listing shows up here.
#[test]
fn inspector_listing_snapshot() {
    let Some(root) = lab_dir() else { return };
    let mut infos = Vec::new();
    for sub in ["Lab D/data", "Lab E/data"] {
        for p in files(&root.join(sub), "mat") {
            let mut info = crossover_studio_lib::commands::inspect_path(&p).unwrap();
            assert!(info.error.is_none(), "{}: {:?}", p.display(), info.error);
            info.path = format!("/lab/{}", info.name);
            infos.push(info);
        }
    }
    let json = serde_json::to_string(&infos).unwrap() + "\n";
    let snap = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/wizard/fixtures/lab_inspect.json");
    if std::env::var_os("XS_WRITE_SNAPSHOT").is_some() {
        std::fs::create_dir_all(snap.parent().unwrap()).unwrap();
        std::fs::write(&snap, json).unwrap();
    } else if let Ok(old) = std::fs::read_to_string(&snap) {
        assert!(old == json, "the inspector listing changed; check it and rerun with XS_WRITE_SNAPSHOT=1");
    }
}

/// Every .mat series a profile reads equals the CSV the course scripts exported from it, so the wizard test
/// (src/wizard/labFiles.test.ts) may stand in the CSV fixtures for the .mat reads.
#[test]
fn mat_series_equal_the_project_csv_exports() {
    use crossover_studio_lib::commands::{ReadSpec, read_series_spec};
    let Some(root) = lab_dir() else { return };
    let read = |path: PathBuf, data: &str, column: Option<usize>| {
        read_series_spec(&ReadSpec { path: path.to_string_lossy().into_owned(), freq_var: Some("fn".into()), data_var: Some(data.into()), column })
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
    };
    let mut pairs: Vec<(PathBuf, &str, Option<usize>, String)> = Vec::new();
    let d = root.join("Lab D/data");
    for t in ["midrange", "tweeter", "woofer_free", "woofer_closed"] {
        pairs.push((d.join(format!("labD_{t}.mat")), "Z", None, format!("Z_{t}.csv")));
    }
    for l in [160, 200, 240] {
        pairs.push((d.join(format!("labD_vent_L{l}.mat")), "Z", None, format!("Z_vent_L{l}.csv")));
        pairs.push((d.join(format!("labD_nf_cone_L{l}.mat")), "H", None, format!("NF_cone_L{l}.csv")));
        pairs.push((d.join(format!("labD_nf_vent_L{l}.mat")), "H", None, format!("NF_vent_L{l}.csv")));
    }
    for (angle, name) in [(0, "on"), (30, "off30")] {
        for (j, u) in ["woofer", "midrange", "tweeter"].into_iter().enumerate() {
            pairs.push((root.join(format!("Lab E/data/labE_system_{angle}.mat")), "H", Some(j), format!("TF_{name}_{u}.csv")));
        }
    }
    for (mat_path, var, col, csv_name) in pairs {
        let m = read(mat_path.clone(), var, col);
        let c = text::parse_csv(&std::fs::read_to_string(root.join("Project/data/csv").join(&csv_name)).unwrap()).unwrap();
        assert_eq!(m.f.len(), c.f.len(), "{csv_name}");
        for k in 0..c.f.len() {
            let mag = c.re[k].hypot(c.im[k]);
            assert!((m.f[k] - c.f[k]).abs() <= 1e-5 * c.f[k], "{csv_name}: f");
            assert!((m.re[k] - c.re[k]).abs() <= 1e-6 * mag && (m.im[k] - c.im[k]).abs() <= 1e-6 * mag, "{csv_name} at {} Hz", c.f[k]);
        }
    }
}
