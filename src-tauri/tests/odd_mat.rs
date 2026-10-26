// MAT files written by MATLAB R2026a in every format a student might produce (tests/data, made by
// `save(..., '-v7' | '-v6' | '-v7.3' | '-v4')`): the readable ones give the right series, the others a
// clear instruction instead of a parse error.

use std::path::Path;

use crossover_studio_lib::commands::{ReadSpec, inspect_path, read_series_spec};

fn data(name: &str) -> String {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data").join(name).to_string_lossy().into_owned()
}

fn read(name: &str, f: &str, d: &str, column: Option<usize>) -> Result<crossover_studio_lib::commands::Series, String> {
    read_series_spec(&ReadSpec { path: data(name), freq_var: Some(f.into()), data_var: Some(d.into()), column })
}

#[test]
fn v7_and_v6_read_alike_with_empty_and_cell_variables() {
    for name in ["odd_v7.mat", "odd_v6.mat"] {
        let info = inspect_path(Path::new(&data(name))).unwrap();
        assert!(info.error.is_none(), "{name}: {:?}", info.error);
        let var = |n: &str| info.variables.iter().find(|v| v.name == n).unwrap_or_else(|| panic!("{name}: {n}"));
        assert_eq!(var("empty_var").dims, vec![0, 0]);
        assert_eq!(var("note").dims, vec![0, 0]);
        assert_eq!(var("units{2}").text.as_deref(), Some("midrange"));
        let s = read(name, "fn", "Z", None).unwrap();
        assert_eq!(s.f.len(), 20);
        assert!((s.f[0] - 10.0).abs() < 1e-12 && (s.re[0] - 6.0).abs() < 1e-12 && (s.im[19] - 10.0).abs() < 1e-9);
        // an empty variable is refused with a message, not a panic
        assert!(read(name, "fn", "empty_var", None).unwrap_err().contains("empty_var"));
    }
    let h = read("odd_v7.mat", "fn", "H", Some(1)).unwrap();
    assert_eq!((h.re[4], h.im[4]), (0.0, 5.0));
}

#[test]
fn single_precision_is_widened() {
    let s = read("odd_single.mat", "fn", "Z", None).unwrap();
    assert!((s.re[0] - 6.0).abs() < 1e-6 && (s.f[19] - 1e4).abs() < 1e-2);
}

#[test]
fn struct_arrays_nested_structs_and_objects() {
    let info = inspect_path(Path::new(&data("odd_struct.mat"))).unwrap();
    assert!(info.error.is_none(), "{:?}", info.error);
    let names: Vec<&str> = info.variables.iter().map(|v| v.name.as_str()).collect();
    for n in ["meas(1).fn", "meas(2).Z", "meas(2).tag", "s.fn", "s.Z", "s.inner.deep", "t", "str"] {
        assert!(names.contains(&n), "{n} missing from {names:?}");
    }
    let m2 = read("odd_struct.mat", "meas(2).fn", "meas(2).Z", None).unwrap();
    assert!((m2.re[0] - 7.0).abs() < 1e-12);
    assert!((read("odd_struct.mat", "s.fn", "s.Z", None).unwrap().re[3] - 8.0).abs() < 1e-12);
    assert!(read("odd_struct.mat", "s.fn", "t", None).unwrap_err().contains("choose a numeric"));
}

#[test]
fn v73_and_v4_explain_how_to_resave() {
    for name in ["odd_v73.mat", "odd_v4.mat"] {
        let info = inspect_path(Path::new(&data(name))).unwrap();
        let e = info.error.unwrap_or_else(|| panic!("{name} read without error"));
        assert!(e.contains("save('file.mat', '-v7')"), "{name}: {e}");
        assert!(read(name, "fn", "Z", None).unwrap_err().contains("-v7"), "{name}");
    }
}
