// Text measurement files: Matlab2LTspice frequency tables (.txt) and plain CSV.
//
// Matlab2LTspice writes one LTspice behavioural source with a FREQ= table, e.g.
//     BvTF_mid Pout_mid 0  V=V(Vspkr_mid,0) DB FREQ=
//     +(5.0000000000E+01,-1.9973815578E+01,5.5267288934E+00)
// with the pair after the frequency in one of three modes: DB (dB, degrees), MAG (magnitude, degrees) or
// R_I (real, imaginary). A current source (`B... I=...` or a G source) is an admittance table: the
// script stores 1/Z_i so that LTspice draws I = V/Z; it is inverted back to impedance here.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum TextError {
    #[error("could not read the file: {0}")]
    Io(#[from] std::io::Error),
    #[error("line {line}: {msg}")]
    Line { line: usize, msg: String },
    #[error("{0}")]
    Format(String),
}

type Result<T> = std::result::Result<T, TextError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextFormat {
    Ltspice,
    Csv,
}

/// A parsed complex frequency table, ready for the app (SI units, impedance not admittance).
#[derive(Debug, Clone, Default)]
pub struct Table {
    pub f: Vec<f64>,
    pub re: Vec<f64>,
    pub im: Vec<f64>,
    /// The LTspice source line, or the CSV header line ("" when the CSV has none).
    pub header: String,
    /// What the importer learned or assumed, in plain sentences for the user.
    pub notes: Vec<String>,
}

impl Table {
    pub fn note(&self) -> Option<String> {
        (!self.notes.is_empty()).then(|| self.notes.join(" "))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PairMode {
    Db,
    Mag,
    ReIm,
}

fn is_comment(line: &str) -> bool {
    let t = line.trim_start();
    t.is_empty() || t.starts_with('*') || t.starts_with('#') || t.starts_with('%') || t.starts_with("//") || t.starts_with(';')
}

/// True when the text is a LTspice FREQ= table rather than a CSV.
pub fn looks_like_ltspice(text: &str) -> bool {
    let mut data = text.lines().filter(|l| !is_comment(l));
    data.next().is_some_and(|l| find_freq_table(&l.to_ascii_uppercase()).is_some())
        || data.next().is_some_and(|l| l.trim_start().starts_with("+("))
}

/// Position of "FREQ" in "FREQ=" (spaces allowed before the '='), in an upper-cased line.
fn find_freq_table(upper: &str) -> Option<usize> {
    upper.match_indices("FREQ").map(|(i, _)| i).find(|&i| upper[i + 4..].trim_start().starts_with('='))
}

pub fn parse_text(text: &str) -> Result<(TextFormat, Table)> {
    if looks_like_ltspice(text) {
        Ok((TextFormat::Ltspice, parse_ltspice(text)?))
    } else {
        Ok((TextFormat::Csv, parse_csv(text)?))
    }
}

fn polar(mag: f64, deg: f64) -> (f64, f64) {
    let r = deg.to_radians();
    (mag * r.cos(), mag * r.sin())
}

pub fn parse_ltspice(text: &str) -> Result<Table> {
    let mut lines = text.lines().enumerate();
    let mut comments = Vec::new();
    let (header_no, header) = loop {
        match lines.next() {
            None => return Err(TextError::Format("the file is empty: expected an LTspice source line with FREQ=".into())),
            Some((_, l)) if is_comment(l) => {
                let c = l.trim().trim_start_matches(['*', '#', '%', ';', '/']).trim();
                if !c.is_empty() {
                    comments.push(c.to_string());
                }
            }
            Some((i, l)) => break (i + 1, l.trim().to_string()),
        }
    };
    let upper = header.to_ascii_uppercase();
    let Some(freq_at) = find_freq_table(&upper) else {
        return Err(TextError::Line { line: header_no, msg: "no FREQ= table on the source line".into() });
    };
    // The mode keyword sits between the expression and FREQ=; LTspice's default is dB.
    let before: Vec<&str> = upper[..freq_at].split_whitespace().collect();
    let mode = if before.contains(&"R_I") {
        PairMode::ReIm
    } else if before.contains(&"MAG") {
        PairMode::Mag
    } else {
        PairMode::Db
    };
    let name = upper.split_whitespace().next().unwrap_or("");
    let admittance = name.starts_with('G') || (name.starts_with('B') && before.iter().skip(1).any(|t| t.starts_with("I=")));

    // Data: "+(f,a,b)" triples. Accept several per line and the table opening on the header line itself.
    let mut f = Vec::new();
    let mut a = Vec::new();
    let mut b = Vec::new();
    let mut take_triples = |s: &str, line: usize| -> Result<()> {
        let mut rest = s;
        while let Some(open) = rest.find('(') {
            let Some(close) = rest[open..].find(')') else {
                return Err(TextError::Line { line, msg: "unclosed '(' in the frequency table".into() });
            };
            let inner = &rest[open + 1..open + close];
            rest = &rest[open + close + 1..];
            let nums: Vec<&str> = inner.split([',', ' ', '\t']).filter(|t| !t.is_empty()).collect();
            if nums.len() != 3 {
                return Err(TextError::Line { line, msg: format!("expected (frequency, value, value), found ({inner})") });
            }
            let parse = |t: &str| t.parse::<f64>().map_err(|_| TextError::Line { line, msg: format!("'{t}' is not a number") });
            f.push(parse(nums[0])?);
            a.push(parse(nums[1])?);
            b.push(parse(nums[2])?);
        }
        Ok(())
    };
    // The source expression itself has parentheses (V(Vspkr,0)); only the text after FREQ= is table.
    let after_freq = header[freq_at..].split_once('=').map(|x| x.1).unwrap_or("");
    take_triples(after_freq, header_no)?;
    for (i, l) in lines {
        if is_comment(l) {
            continue;
        }
        take_triples(l.trim().trim_start_matches('+'), i + 1)?;
    }
    if f.is_empty() {
        return Err(TextError::Format("the FREQ= table has no points".into()));
    }

    let mut re = Vec::with_capacity(f.len());
    let mut im = Vec::with_capacity(f.len());
    for k in 0..f.len() {
        let (x, y) = match mode {
            PairMode::Db => polar(10f64.powf(a[k] / 20.0), b[k]),
            PairMode::Mag => polar(a[k], b[k]),
            PairMode::ReIm => (a[k], b[k]),
        };
        if admittance {
            // Z = 1/Y. A zero admittance (open circuit) has no finite impedance; validation reports it.
            let d = x * x + y * y;
            re.push(x / d);
            im.push(-y / d);
        } else {
            re.push(x);
            im.push(y);
        }
    }
    let mut notes = comments;
    let mode_txt = match mode {
        PairMode::Db => "dB and degrees",
        PairMode::Mag => "magnitude and degrees",
        PairMode::ReIm => "real and imaginary parts",
    };
    notes.push(format!("LTspice table in {mode_txt}."));
    if admittance {
        notes.push("Admittance table (Matlab2LTspice stores 1/Z for a current source): inverted back to impedance.".into());
    } else {
        notes.push("Transfer-function phases include the distance compensation chosen when the file was exported.".into());
    }
    Ok(Table { f, re, im, header, notes }.without_dc())
}

// ---------------------------------------------------------------- CSV

#[derive(Debug, Clone, Copy, PartialEq)]
enum Col {
    Freq,
    Re,
    Im,
    Mag,
    Db,
    PhaseDeg,
    PhaseRad,
    Other,
}

fn classify(name: &str) -> Col {
    // Drop units in brackets: "Frequency (Hz)", "Phase [deg]", "SPL(dB)".
    let lower = name.trim().trim_matches('"').to_ascii_lowercase();
    let base: String = lower.split(['(', '[']).next().unwrap_or("").trim().replace([' ', '-'], "_");
    let unit = lower.split(['(', '[']).nth(1).unwrap_or("").trim_end_matches([')', ']']).trim().to_string();
    match base.as_str() {
        "f" | "freq" | "frequency" | "fn" | "hz" | "f_hz" | "freq_hz" | "frequency_hz" => Col::Freq,
        "re" | "real" | "r" | "re_z" | "real_part" => Col::Re,
        "im" | "imag" | "imaginary" | "x" | "im_z" | "imag_part" => Col::Im,
        "mag" | "abs" | "magnitude" | "modulus" | "z" | "abs_z" | "mag_lin" => {
            if unit == "db" { Col::Db } else { Col::Mag }
        }
        "db" | "mag_db" | "level" | "spl" | "spl_db" | "gain_db" | "gain" | "magnitude_db" | "level_db" => Col::Db,
        "phase" | "deg" | "phase_deg" | "arg" | "angle" | "phi" | "phase_degrees" => {
            if unit.starts_with("rad") { Col::PhaseRad } else { Col::PhaseDeg }
        }
        "rad" | "phase_rad" | "arg_rad" => Col::PhaseRad,
        _ => Col::Other,
    }
}

fn split_fields(line: &str, delim: Option<char>) -> Vec<String> {
    match delim {
        Some(d) => line.split(d).map(|s| s.trim().to_string()).collect(),
        None => line.split_whitespace().map(str::to_string).collect(),
    }
}

fn parse_number(s: &str, decimal_comma: bool) -> Option<f64> {
    let t = s.trim().trim_matches('"');
    if decimal_comma { t.replace(',', ".").parse().ok() } else { t.parse().ok() }
}

/// Column names written as a comment line, as REW does ("* Freq(Hz), SPL(dB), Phase(degrees)"): the last
/// non-empty comment line above the first data row, if it splits into `count` fields that name a
/// frequency and a data column.
fn comment_header(lines: &[&str], first_no: usize, delim: Option<char>, count: usize) -> Option<Vec<String>> {
    let line = lines[..first_no].iter().rev().map(|l| l.trim()).find(|l| !l.is_empty())?;
    let mut body = line;
    while let Some(rest) = ["*", "#", "%", "//", ";"].iter().find_map(|p| body.strip_prefix(p)) {
        body = rest;
    }
    let body = body.trim();
    for d in [delim, Some(','), Some(';'), Some('\t'), None] {
        let fields: Vec<String> =
            split_fields(body, d).into_iter().map(|f| f.trim_end_matches([',', ';']).to_string()).filter(|f| !f.is_empty()).collect();
        if fields.len() != count {
            continue;
        }
        let roles: Vec<Col> = fields.iter().map(|f| classify(f)).collect();
        if roles.contains(&Col::Freq) && roles.iter().any(|r| matches!(r, Col::Re | Col::Mag | Col::Db)) {
            return Some(fields);
        }
    }
    None
}

/// Drop leading points at 0 Hz (the DC bin of an FFT axis), with a note, so the rest still loads:
/// the engine's grid is logarithmic and its models divide by the frequency.
pub fn drop_dc(f: &mut Vec<f64>, re: &mut Vec<f64>, im: &mut Vec<f64>) -> Option<String> {
    let n = f.iter().take_while(|&&x| x == 0.0).count();
    if n == 0 {
        return None;
    }
    f.drain(..n);
    re.drain(..n.min(re.len()));
    im.drain(..n.min(im.len()));
    Some(if n == 1 { "The 0 Hz (DC) point was left out.".into() } else { format!("{n} points at 0 Hz were left out.") })
}

impl Table {
    fn without_dc(mut self) -> Self {
        if let Some(n) = drop_dc(&mut self.f, &mut self.re, &mut self.im) {
            self.notes.push(n);
        }
        self
    }
}

pub fn parse_csv(text: &str) -> Result<Table> {
    let lines: Vec<&str> = text.trim_start_matches('\u{feff}').lines().collect();
    let rows: Vec<(usize, &str)> = lines.iter().copied().enumerate().filter(|(_, l)| !is_comment(l)).collect();
    let Some(&(first_no, first)) = rows.first() else {
        return Err(TextError::Format("the file has no data rows".into()));
    };
    // The delimiter that splits the first line into the most fields; whitespace when none of them occurs.
    let delim = [';', '\t', ',']
        .into_iter()
        .map(|d| (d, first.matches(d).count()))
        .filter(|(_, n)| *n > 0)
        .max_by_key(|(_, n)| *n)
        .map(|(d, _)| d);
    let decimal_comma = delim == Some(';') || (delim == Some('\t') && rows.iter().skip(1).take(3).any(|(_, l)| l.contains(',')));

    let first_fields = split_fields(first, delim);
    let has_header = first_fields.iter().any(|t| parse_number(t, decimal_comma).is_none());
    let mut notes = Vec::new();
    let named = if has_header { None } else { comment_header(&lines, first_no, delim, first_fields.len()) };
    let roles: Vec<Col> = if has_header {
        first_fields.iter().map(|h| classify(h)).collect()
    } else if let Some(names) = &named {
        notes.push(format!("Column names read from the comment line \"{}\".", names.join(", ")));
        names.iter().map(|h| classify(h)).collect()
    } else {
        match first_fields.len() {
            // three unnamed columns could as well be dB and phase as re and im: guessing would corrupt the data
            3 => {
                return Err(TextError::Format(
                    "no header row and 3 columns, which could be re/im or dB/phase: add a header line such as f,re,im or f,db,phase".into(),
                ));
            }
            2 => {
                notes.push("No header row: columns read as frequency and a real value.".into());
                vec![Col::Freq, Col::Re]
            }
            n => return Err(TextError::Format(format!("no header row and {n} columns: add a header such as f,re,im or f,db,phase"))),
        }
    };
    let find = |c: Col| roles.iter().position(|r| *r == c);
    let Some(fi) = find(Col::Freq) else {
        return Err(TextError::Line { line: first_no + 1, msg: format!("no frequency column in the header '{first}' (name it f, freq or frequency)") });
    };
    enum Shape {
        ReIm(usize, Option<usize>),
        Polar { mag: usize, db: bool, phase: Option<(usize, bool)> },
    }
    let phase = find(Col::PhaseDeg).map(|i| (i, false)).or_else(|| find(Col::PhaseRad).map(|i| (i, true)));
    let shape = if let Some(r) = find(Col::Re) {
        Shape::ReIm(r, find(Col::Im))
    } else if let Some(m) = find(Col::Mag) {
        Shape::Polar { mag: m, db: false, phase }
    } else if let Some(m) = find(Col::Db) {
        Shape::Polar { mag: m, db: true, phase }
    } else {
        return Err(TextError::Line {
            line: first_no + 1,
            msg: format!("the header '{first}' names no data columns: use re + im, or mag/db + phase (degrees)"),
        });
    };
    match &shape {
        Shape::ReIm(_, None) => notes.push("No imaginary column: the data is read as real.".into()),
        Shape::Polar { phase: None, .. } => notes.push("No phase column: the phase is taken as zero.".into()),
        _ => {}
    }

    let header = if has_header { first.trim().to_string() } else { named.map(|n| n.join(",")).unwrap_or_default() };
    let mut t = Table { header, notes, ..Default::default() };
    let start = if has_header { 1 } else { 0 };
    for &(no, line) in &rows[start..] {
        let fields = split_fields(line, delim);
        let get = |i: usize| -> Result<f64> {
            let s = fields.get(i).ok_or_else(|| TextError::Line { line: no + 1, msg: format!("expected at least {} columns", i + 1) })?;
            parse_number(s, decimal_comma).ok_or_else(|| TextError::Line { line: no + 1, msg: format!("'{s}' is not a number") })
        };
        t.f.push(get(fi)?);
        let (x, y) = match shape {
            Shape::ReIm(r, i) => (get(r)?, i.map(get).transpose()?.unwrap_or(0.0)),
            Shape::Polar { mag, db, phase } => {
                let m = get(mag)?;
                let m = if db { 10f64.powf(m / 20.0) } else { m };
                let p = match phase {
                    Some((i, rad)) => {
                        let v = get(i)?;
                        if rad { v.to_degrees() } else { v }
                    }
                    None => 0.0,
                };
                polar(m, p)
            }
        };
        t.re.push(x);
        t.im.push(y);
    }
    if t.f.is_empty() {
        return Err(TextError::Format("the file has a header but no data rows".into()));
    }
    Ok(t.without_dc())
}

/// Shared checks for any series before it reaches the engine.
pub fn validate(f: &[f64], re: &[f64], im: &[f64]) -> std::result::Result<(), String> {
    if f.len() != re.len() || f.len() != im.len() {
        return Err(format!("frequency has {} points but the data has {}", f.len(), re.len()));
    }
    if f.len() < 2 {
        return Err("a series needs at least two points".into());
    }
    if let Some(i) = (0..f.len()).find(|&i| !f[i].is_finite() || !re[i].is_finite() || !im[i].is_finite()) {
        return Err(format!("point {} (f = {}) is not a finite number", i + 1, f[i]));
    }
    if f[0] == 0.0 {
        return Err("the frequency axis starts at 0 Hz: leave the DC point out".into());
    }
    if f[0] < 0.0 {
        return Err("frequencies must be above 0 Hz, not negative".into());
    }
    if let Some(i) = (1..f.len()).find(|&i| f[i] <= f[i - 1]) {
        return Err(format!("frequencies must rise strictly: point {} ({} Hz) follows {} Hz", i + 1, f[i], f[i - 1]));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn read(rel: &str) -> String {
        std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures").join(rel)).unwrap()
    }

    fn rel_err(a: f64, b: f64) -> f64 {
        (a - b).abs() / b.abs().max(1e-300)
    }

    #[test]
    fn admittance_table_reproduces_the_impedance() {
        let (fmt, z) = parse_text(&read("text/Zi_mid.txt")).unwrap();
        assert_eq!(fmt, TextFormat::Ltspice);
        let csv = parse_csv(&read("csv/Z_midrange.csv")).unwrap();
        assert_eq!(z.f.len(), csv.f.len());
        for k in 0..z.f.len() {
            // The CSV frequencies are written with six significant digits (1044.125 -> 1044.12).
            assert!(rel_err(z.f[k], csv.f[k]) < 1e-5, "f {} vs {}", z.f[k], csv.f[k]);
            let (za, ca) = (z.re[k].hypot(z.im[k]), csv.re[k].hypot(csv.im[k]));
            assert!((z.re[k] - csv.re[k]).abs() < 1e-6 * ca, "re at {}: {} vs {}", z.f[k], z.re[k], csv.re[k]);
            assert!((z.im[k] - csv.im[k]).abs() < 1e-6 * ca, "im at {}: {} vs {}", z.f[k], z.im[k], csv.im[k]);
            assert!(rel_err(za, ca) < 1e-6);
        }
        assert!(z.note().unwrap().contains("Admittance"));
        validate(&z.f, &z.re, &z.im).unwrap();
    }

    #[test]
    fn tf_magnitude_matches_the_csv() {
        for (txt, csv) in [("text/TF_mid.txt", "csv/TF_on_midrange.csv"), ("text/TF_tw.txt", "csv/TF_on_tweeter.csv"), ("text/TF_woof.txt", "csv/TF_on_woofer.csv")] {
            let t = parse_ltspice(&read(txt)).unwrap();
            let c = parse_csv(&read(csv)).unwrap();
            assert_eq!(t.f.len(), c.f.len(), "{txt}");
            for k in 0..t.f.len() {
                assert!(rel_err(t.re[k].hypot(t.im[k]), c.re[k].hypot(c.im[k])) < 1e-6, "{txt} at {}", t.f[k]);
            }
            assert!(t.note().unwrap().contains("distance compensation"));
        }
    }

    #[test]
    fn comment_lines_and_modes() {
        let b = parse_ltspice(&read("text/Box_woof.txt")).unwrap();
        assert!(b.header.starts_with("BvBox_woof"));
        assert!(b.notes[0].starts_with("Task 1 box tuning"));
        let ri = parse_ltspice("BvX a 0 V=V(b,0) R_I FREQ=(1,2,3)\n+(2,4,-5)\n").unwrap();
        assert_eq!((ri.f.clone(), ri.re.clone(), ri.im.clone()), (vec![1.0, 2.0], vec![2.0, 4.0], vec![3.0, -5.0]));
        let mag = parse_ltspice("BiY a 0 I=V(a,0) MAG FREQ=\n+(10, 0.5, 90)\n").unwrap();
        // Y = 0.5j -> Z = -2j
        assert!(mag.re[0].abs() < 1e-12 && (mag.im[0] + 2.0).abs() < 1e-12);
        assert!(parse_ltspice("BvX a 0 V=V(b,0) DB FREQ=\n+(1,2)\n").is_err());
        assert!(parse_ltspice("BvX a 0 V=V(b,0) DB FREQ=\n+(1,2,x)\n").is_err());
        assert!(parse_ltspice("BvX a 0 V=V(b,0) DB FREQ=\n+(1,2,3\n").is_err());
        assert!(parse_ltspice("").is_err());
    }

    #[test]
    fn csv_variants() {
        let c = parse_csv(&read("csv/Z_midrange.csv")).unwrap();
        assert_eq!(c.header, "f,re,im");
        assert!((c.re[0] - 4.668385487).abs() < 1e-12);
        let semi = parse_csv("# exported\nFrequency (Hz);Magnitude [dB];Phase [deg]\n100;0;90\n200;6,0206;0\n").unwrap();
        assert!(semi.re[0].abs() < 1e-12 && (semi.im[0] - 1.0).abs() < 1e-12);
        assert!((semi.re[1] - 2.0).abs() < 1e-4);
        let tab = parse_csv("freq\tmag\tphase_rad\n1\t2\t0\n2\t2\t3.141592653589793\n").unwrap();
        assert!((tab.re[1] + 2.0).abs() < 1e-12);
        let rew = parse_csv("* REW export\nFreq(Hz) SPL(dB) Phase(degrees)\n20 0 0\n30 0 0\n").unwrap();
        assert_eq!(rew.f, vec![20.0, 30.0]);
        assert!(!looks_like_ltspice("freq,re,im\n1,2,3\n"));
        // three unnamed columns are refused rather than guessed as re/im
        assert!(parse_csv("1,2,3\n2,3,4\n").unwrap_err().to_string().contains("re/im or dB/phase"));
        assert!(parse_csv("1,2\n2,3\n").unwrap().note().unwrap().contains("No header"));
        // REW writes its column names as a comment line
        let rew_c = parse_csv("* Measurement: UMIK-1\n* Freq(Hz), SPL(dB), Phase(degrees)\n100, 0, 90\n200, 6.0206, 0\n").unwrap();
        assert!(rew_c.note().unwrap().contains("comment line"));
        assert!(rew_c.re[0].abs() < 1e-12 && (rew_c.im[0] - 1.0).abs() < 1e-12);
        // a DC bin is dropped with a note
        let dc = parse_csv("f,re,im\n0,1,0\n1,2,3\n2,3,4\n").unwrap();
        assert_eq!(dc.f, vec![1.0, 2.0]);
        assert!(dc.note().unwrap().contains("0 Hz"));
        assert!(validate(&[0.0, 1.0], &[0.0, 0.0], &[0.0, 0.0]).unwrap_err().contains("0 Hz"));
        assert!(parse_csv("a,b,c\n1,2,3\n").is_err());
        assert!(parse_csv("f,re,im\n1,2\n").is_err());
        assert!(parse_csv("").is_err());
    }

    #[test]
    fn validation() {
        assert!(validate(&[1.0, 2.0], &[0.0, 0.0], &[0.0, 0.0]).is_ok());
        assert!(validate(&[2.0, 1.0], &[0.0, 0.0], &[0.0, 0.0]).unwrap_err().contains("rise"));
        assert!(validate(&[1.0, 2.0], &[0.0, f64::NAN], &[0.0, 0.0]).is_err());
        assert!(validate(&[1.0, 2.0], &[0.0], &[0.0]).is_err());
    }

    #[test]
    fn truncated_text_never_panics() {
        for rel in ["text/Zi_mid.txt", "csv/Z_midrange.csv", "text/Box_woof.txt"] {
            let s = read(rel);
            for cut in (0..s.len().min(800)).chain((800..s.len()).step_by(53)) {
                if s.is_char_boundary(cut) {
                    let _ = parse_text(&s[..cut]);
                }
            }
        }
    }
}
