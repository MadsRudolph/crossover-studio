// MAT-file Level 5 reader (MATLAB v5, v6 and v7, including zlib-compressed v7 elements).
//
// Written from the MathWorks "MAT-File Format" specification. It reads what a lab group's `save`
// produces: numeric arrays (any class, real or complex, converted to f64), char arrays, logicals and
// structs (whose fields are exposed as "var.field" variables) and cell arrays (elements as "var{k}");
// sparse arrays, objects and opaque classes (MATLAB `datetime`, `string`, ...) are listed and skipped,
// so a file that also holds a timestamp still opens. v7.3 files are HDF5 and get a clear error.
//
// Every read is bounds-checked: truncated or corrupt input returns `Err`, never panics, and no
// allocation is sized from a header field without first checking the bytes are actually there.

use std::io::Read;
use std::path::Path;

use flate2::read::ZlibDecoder;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MatError {
    #[error("could not read the file: {0}")]
    Io(#[from] std::io::Error),
    #[error("not a MATLAB .mat file (no Level 5 header)")]
    NotMat,
    #[error(
        "this .mat file was saved in the v7.3 (HDF5) format, which Crossover Studio cannot read. \
         In MATLAB, load it and save it again with: save('file.mat', '-v7')"
    )]
    V73,
    #[error("this looks like an old Level 4 .mat file; load it in MATLAB and save it again with: save('file.mat', '-v7')")]
    Level4,
    #[error("the file is truncated or corrupt ({0})")]
    Corrupt(String),
}

type Result<T> = std::result::Result<T, MatError>;

fn corrupt<T>(msg: impl Into<String>) -> Result<T> {
    Err(MatError::Corrupt(msg.into()))
}

/// One variable as listed to the user. Struct fields appear as their own entries ("s.field").
#[derive(Debug, Clone, PartialEq)]
pub struct MatVar {
    pub name: String,
    /// "double", "single", "int8".."uint64", "logical", "char", "struct", "cell", "sparse", "object",
    /// or the class of an opaque object such as "datetime".
    pub class: String,
    pub dims: Vec<usize>,
    pub complex: bool,
    pub value: MatValue,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MatValue {
    /// Column-major data, as stored by MATLAB. `im` is present only for complex arrays.
    Numeric { re: Vec<f64>, im: Option<Vec<f64>> },
    /// Char array; a multi-row array has one line per row.
    Text(String),
    /// Struct, cell, sparse, object or opaque: listed but not read.
    Skipped,
}

#[derive(Debug, Clone)]
pub struct MatFile {
    /// The 116-byte descriptive text, e.g. "MATLAB 5.0 MAT-file, Platform: GLNXA64, Created on: ...".
    pub description: String,
    pub variables: Vec<MatVar>,
}

impl MatFile {
    pub fn get(&self, name: &str) -> Option<&MatVar> {
        self.variables.iter().find(|v| v.name == name)
    }
}

// Data types (miXXX) from the specification.
const MI_INT8: u32 = 1;
const MI_UINT8: u32 = 2;
const MI_INT16: u32 = 3;
const MI_UINT16: u32 = 4;
const MI_INT32: u32 = 5;
const MI_UINT32: u32 = 6;
const MI_SINGLE: u32 = 7;
const MI_DOUBLE: u32 = 9;
const MI_INT64: u32 = 12;
const MI_UINT64: u32 = 13;
const MI_MATRIX: u32 = 14;
const MI_COMPRESSED: u32 = 15;
const MI_UTF8: u32 = 16;
const MI_UTF16: u32 = 17;
const MI_UTF32: u32 = 18;

// Array classes (mxXXX_CLASS).
const MX_CELL: u8 = 1;
const MX_STRUCT: u8 = 2;
const MX_OBJECT: u8 = 3;
const MX_CHAR: u8 = 4;
const MX_SPARSE: u8 = 5;
const MX_FUNCTION: u8 = 16;
const MX_OPAQUE: u8 = 17;

const FLAG_COMPLEX: u32 = 0x0800;
const FLAG_LOGICAL: u32 = 0x0200;

/// A compressed element may not inflate beyond this; protects against zip bombs.
const MAX_INFLATED_BYTES: u64 = 2 << 30;
/// Structs nested deeper than this are listed but not descended into.
const MAX_DEPTH: usize = 16;

const HDF5_SIGNATURE: &[u8; 8] = b"\x89HDF\r\n\x1a\n";

fn class_name(class: u8, logical: bool) -> &'static str {
    if logical {
        return "logical";
    }
    match class {
        MX_CELL => "cell",
        MX_STRUCT => "struct",
        MX_OBJECT => "object",
        MX_CHAR => "char",
        MX_SPARSE => "sparse",
        6 => "double",
        7 => "single",
        8 => "int8",
        9 => "uint8",
        10 => "int16",
        11 => "uint16",
        12 => "int32",
        13 => "uint32",
        14 => "int64",
        15 => "uint64",
        MX_FUNCTION => "function_handle",
        MX_OPAQUE => "opaque",
        _ => "unknown",
    }
}

/// True when the bytes start like a v7.3 (HDF5) MAT-file: HDF5 signature at 0 or after the 512-byte user block,
/// or a Level 5 style header that announces version 0x0200.
pub fn is_v73(bytes: &[u8]) -> bool {
    let sig_at = |off: usize| bytes.get(off..off + 8).is_some_and(|s| s == HDF5_SIGNATURE);
    if sig_at(0) || sig_at(512) {
        return true;
    }
    match bytes.get(124..128) {
        Some([a, b, b'I', b'M']) => u16::from_le_bytes([*a, *b]) == 0x0200,
        Some([a, b, b'M', b'I']) => u16::from_be_bytes([*a, *b]) == 0x0200,
        _ => false,
    }
}

/// True when the bytes carry a Level 5 header (any version, including v7.3). Without the "MATLAB" text the
/// endian marker alone counts only when the version field before it is binary (0x0100 or 0x0200): two
/// letters at bytes 126..128 of a text export ("UMIK-1", "TIME") must not make it a MAT file.
pub fn looks_like_mat(bytes: &[u8]) -> bool {
    if is_v73(bytes) || bytes.starts_with(b"MATLAB") {
        return true;
    }
    match bytes.get(124..128) {
        Some([a, b, b'I', b'M']) => matches!(u16::from_le_bytes([*a, *b]), 0x0100 | 0x0200),
        Some([a, b, b'M', b'I']) => matches!(u16::from_be_bytes([*a, *b]), 0x0100 | 0x0200),
        _ => false,
    }
}

/// True when the bytes start like a Level 4 MAT-file (`save -v4`): no text header, but a 20-byte matrix
/// header whose type code MOPT (M = byte order 0/1, O = 0, P = precision 0..5, T = 0..2), imaginary flag (0/1)
/// and name length fit, followed by the NUL-terminated name.
fn looks_like_level4(bytes: &[u8]) -> bool {
    let Some(head) = bytes.get(..20) else { return false };
    [false, true].into_iter().any(|big| {
        let w = |i: usize| {
            let a = [head[i], head[i + 1], head[i + 2], head[i + 3]];
            if big { u32::from_be_bytes(a) } else { u32::from_le_bytes(a) }
        };
        let (mopt, imagf, namlen) = (w(0), w(12), w(16) as usize);
        let (m, o, p, t) = (mopt / 1000, mopt / 100 % 10, mopt / 10 % 10, mopt % 10);
        m <= 1 && o == 0 && p <= 5 && t <= 2 && imagf <= 1 && (1..=64).contains(&namlen) && bytes.get(19 + namlen) == Some(&0)
    })
}

pub fn read_mat_file(path: &Path) -> Result<MatFile> {
    let bytes = std::fs::read(path)?;
    read_mat(&bytes)
}

pub fn read_mat(bytes: &[u8]) -> Result<MatFile> {
    if is_v73(bytes) {
        return Err(MatError::V73);
    }
    if bytes.len() < 128 {
        return Err(if bytes.starts_with(b"MATLAB") {
            MatError::Corrupt("header shorter than 128 bytes".into())
        } else if looks_like_level4(bytes) {
            MatError::Level4
        } else {
            MatError::NotMat
        });
    }
    let big = match &bytes[126..128] {
        b"IM" => false,
        b"MI" => true,
        _ => {
            if bytes.starts_with(b"MATLAB") {
                return corrupt("unknown byte-order mark in the header");
            }
            return Err(if looks_like_level4(bytes) { MatError::Level4 } else { MatError::NotMat });
        }
    };
    let description = String::from_utf8_lossy(&bytes[..116]).trim_end_matches(['\0', ' ']).trim().to_string();

    let mut variables = Vec::new();
    let mut cur = Cursor { buf: &bytes[128..], pos: 0, big };
    while cur.remaining() > 0 {
        if cur.remaining() < 8 {
            // Some writers pad the end of the file with zeros.
            if cur.buf[cur.pos..].iter().all(|b| *b == 0) {
                break;
            }
            return corrupt("incomplete data element at the end of the file");
        }
        let tag = cur.tag()?;
        let data = cur.take(tag.size)?;
        match tag.ty {
            // Compressed elements are not padded: the next tag follows the zlib stream directly.
            MI_COMPRESSED => {
                let inflated = inflate(data)?;
                let mut inner = Cursor { buf: &inflated, pos: 0, big };
                while inner.remaining() >= 8 {
                    let (ty, d) = inner.element()?;
                    if ty == MI_MATRIX {
                        parse_matrix(d, big, None, 0, &mut variables)?;
                    }
                }
            }
            MI_MATRIX => {
                parse_matrix(data, big, None, 0, &mut variables)?;
                cur.pad8();
            }
            _ => cur.pad8(), // anything else at the top level is skipped
        }
    }
    // The subsystem block (the payload of opaque objects) is an unnamed uint8 matrix, not a variable.
    variables.retain(|v| !v.name.is_empty());
    Ok(MatFile { description, variables })
}

fn inflate(data: &[u8]) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut dec = ZlibDecoder::new(data).take(MAX_INFLATED_BYTES);
    match dec.read_to_end(&mut out) {
        Ok(_) => Ok(out),
        // A truncated zlib stream still yields what was inflated; whether that holds a complete element is
        // decided by the bounds checks of the parser.
        Err(_) if !out.is_empty() => Ok(out),
        Err(e) => corrupt(format!("compressed block cannot be inflated: {e}")),
    }
}

struct Tag {
    ty: u32,
    size: usize,
    small: bool,
}

struct Cursor<'a> {
    buf: &'a [u8],
    pos: usize,
    big: bool,
}

impl<'a> Cursor<'a> {
    fn remaining(&self) -> usize {
        self.buf.len() - self.pos
    }

    fn u32(&mut self) -> Result<u32> {
        let b = self.take(4)?;
        let a = [b[0], b[1], b[2], b[3]];
        Ok(if self.big { u32::from_be_bytes(a) } else { u32::from_le_bytes(a) })
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if n > self.remaining() {
            return corrupt(format!("an element needs {n} bytes but only {} are left", self.remaining()));
        }
        let s = &self.buf[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }

    /// Reads a tag. A small data element packs type and size into one word, with its data in the next four
    /// bytes; the cursor is then left on that data.
    fn tag(&mut self) -> Result<Tag> {
        let first = self.u32()?;
        if first >> 16 != 0 {
            let size = (first >> 16) as usize;
            if size > 4 {
                return corrupt("small data element larger than 4 bytes");
            }
            return Ok(Tag { ty: first & 0xffff, size, small: true });
        }
        let size = self.u32()? as usize;
        Ok(Tag { ty: first, size, small: false })
    }

    /// Elements are aligned to 8 bytes (every buffer here starts aligned). Lenient at the end of a buffer,
    /// where some writers drop the final padding.
    fn pad8(&mut self) {
        let pad = (8 - self.pos % 8) % 8;
        self.pos += pad.min(self.remaining());
    }

    /// Reads one whole element, including its padding, and returns (type, data).
    fn element(&mut self) -> Result<(u32, &'a [u8])> {
        if self.remaining() < 8 {
            return corrupt("an array is missing a sub-element");
        }
        let start = self.pos;
        let tag = self.tag()?;
        let data = self.take(tag.size)?;
        if tag.small {
            self.pos = (start + 8).min(self.buf.len());
        } else {
            self.pad8();
        }
        Ok((tag.ty, data))
    }
}

/// Size in bytes of one value of a numeric data type.
fn type_size(ty: u32) -> Option<usize> {
    Some(match ty {
        MI_INT8 | MI_UINT8 | MI_UTF8 => 1,
        MI_INT16 | MI_UINT16 | MI_UTF16 => 2,
        MI_INT32 | MI_UINT32 | MI_SINGLE | MI_UTF32 => 4,
        MI_DOUBLE | MI_INT64 | MI_UINT64 => 8,
        _ => return None,
    })
}

/// Converts a numeric data element to f64. MATLAB stores a double array in a smaller integer type when the
/// values fit, so the storage type is independent of the array class.
fn to_f64(ty: u32, data: &[u8], big: bool) -> Result<Vec<f64>> {
    let Some(w) = type_size(ty) else {
        return corrupt(format!("unexpected data type {ty} in a numeric array"));
    };
    if !data.len().is_multiple_of(w) {
        return corrupt("numeric data length is not a whole number of values");
    }
    macro_rules! conv {
        ($t:ty, $n:expr) => {
            data.chunks_exact($n)
                .map(|c| {
                    let a: [u8; $n] = c.try_into().unwrap_or([0; $n]);
                    (if big { <$t>::from_be_bytes(a) } else { <$t>::from_le_bytes(a) }) as f64
                })
                .collect()
        };
    }
    Ok(match ty {
        MI_INT8 => data.iter().map(|b| *b as i8 as f64).collect(),
        MI_UINT8 | MI_UTF8 => data.iter().map(|b| *b as f64).collect(),
        MI_INT16 => conv!(i16, 2),
        MI_UINT16 | MI_UTF16 => conv!(u16, 2),
        MI_INT32 => conv!(i32, 4),
        MI_UINT32 | MI_UTF32 => conv!(u32, 4),
        MI_SINGLE => conv!(f32, 4),
        MI_DOUBLE => conv!(f64, 8),
        MI_INT64 => conv!(i64, 8),
        _ => conv!(u64, 8), // MI_UINT64: the only type left after type_size
    })
}

fn decode_text(ty: u32, data: &[u8], big: bool, dims: &[usize]) -> Result<String> {
    let chars: Vec<char> = match ty {
        MI_UTF8 => String::from_utf8_lossy(data).chars().collect(),
        MI_UINT8 | MI_INT8 => data.iter().map(|b| *b as char).collect(),
        MI_UINT16 | MI_UTF16 | MI_INT16 => {
            let units: Vec<u16> = to_f64(MI_UINT16, data, big)?.into_iter().map(|v| v as u16).collect();
            char::decode_utf16(units).map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER)).collect()
        }
        MI_UTF32 | MI_UINT32 | MI_INT32 => to_f64(MI_UINT32, data, big)?
            .into_iter()
            .map(|v| char::from_u32(v as u32).unwrap_or(char::REPLACEMENT_CHARACTER))
            .collect(),
        _ => return corrupt(format!("unexpected data type {ty} in a char array")),
    };
    // Char arrays are column-major: rebuild the rows so a 2xN array reads as two lines.
    let rows = dims.first().copied().unwrap_or(1);
    if rows <= 1 || dims.len() > 2 || !chars.len().is_multiple_of(rows) {
        return Ok(chars.into_iter().collect());
    }
    let cols = chars.len() / rows;
    let lines: Vec<String> = (0..rows).map(|r| (0..cols).map(|c| chars[c * rows + r]).collect::<String>()).collect();
    Ok(lines.join("\n"))
}

fn parse_name(ty: u32, data: &[u8]) -> Result<String> {
    if !matches!(ty, MI_INT8 | MI_UINT8 | MI_UTF8) {
        return corrupt("array name has an unexpected data type");
    }
    Ok(String::from_utf8_lossy(data).trim_end_matches('\0').to_string())
}

/// Parses the body of one miMATRIX element and appends it (and, for structs, its fields) to `out`.
/// `forced_name` replaces the stored name for struct fields, whose stored name is empty.
fn parse_matrix(data: &[u8], big: bool, forced_name: Option<String>, depth: usize, out: &mut Vec<MatVar>) -> Result<()> {
    if data.is_empty() {
        // An empty miMATRIX stands for [] inside structs and cells.
        if let Some(name) = forced_name {
            out.push(MatVar { name, class: "double".into(), dims: vec![0, 0], complex: false, value: MatValue::Numeric { re: vec![], im: None } });
        }
        return Ok(());
    }
    let mut cur = Cursor { buf: data, pos: 0, big };

    let (ty, flags_raw) = cur.element()?;
    if ty != MI_UINT32 || flags_raw.len() < 4 {
        return corrupt("array flags missing");
    }
    let flags = to_f64(MI_UINT32, &flags_raw[..4], big)?[0] as u32;
    let class = (flags & 0xff) as u8;
    let complex = flags & FLAG_COMPLEX != 0;
    let logical = flags & FLAG_LOGICAL != 0;

    // Opaque classes (datetime, string, table, ...) carry no dims: name, type system ("MCOS"), class name, payload.
    if class == MX_OPAQUE {
        let (nty, ndata) = cur.element()?;
        let stored = parse_name(nty, ndata)?;
        let mut cls = "opaque".to_string();
        if cur.element().is_ok()
            && let Ok((cty, cdata)) = cur.element()
            && let Ok(c) = parse_name(cty, cdata)
            && !c.is_empty()
        {
            cls = c;
        }
        out.push(MatVar { name: forced_name.unwrap_or(stored), class: cls, dims: vec![], complex: false, value: MatValue::Skipped });
        return Ok(());
    }

    let (dty, ddata) = cur.element()?;
    if dty != MI_INT32 {
        return corrupt("array dimensions missing");
    }
    let dims: Vec<usize> = to_f64(MI_INT32, ddata, big)?.into_iter().map(|d| d.max(0.0) as usize).collect();
    let (nty, ndata) = cur.element()?;
    let stored = parse_name(nty, ndata)?;
    let name = forced_name.unwrap_or(stored);
    let numel = dims.iter().try_fold(1usize, |a, d| a.checked_mul(*d));
    let cls = class_name(class, logical).to_string();

    match class {
        MX_STRUCT | MX_OBJECT => {
            if class == MX_OBJECT {
                cur.element()?; // class name
            }
            out.push(MatVar { name: name.clone(), class: cls, dims: dims.clone(), complex: false, value: MatValue::Skipped });
            if depth >= MAX_DEPTH {
                return Ok(());
            }
            let (lty, ldata) = cur.element()?;
            if lty != MI_INT32 || ldata.len() < 4 {
                return corrupt("struct field-name length missing");
            }
            let flen = to_f64(MI_INT32, &ldata[..4], big)?[0].max(0.0) as usize;
            let (_, fdata) = cur.element()?;
            if flen == 0 || fdata.is_empty() {
                return Ok(());
            }
            let fields: Vec<String> = fdata.chunks(flen).map(|c| parse_name(MI_INT8, c)).collect::<Result<_>>()?;
            let n = numel.ok_or_else(|| MatError::Corrupt("struct dimensions overflow".into()))?;
            // Element k of a struct array is named "var(k).field" (1-based, as in MATLAB).
            for k in 0..n {
                if cur.remaining() < 8 {
                    return corrupt(format!("struct {name} has fewer elements than its size says"));
                }
                for field in &fields {
                    let full = if n == 1 { format!("{name}.{field}") } else { format!("{name}({}).{field}", k + 1) };
                    let (ety, edata) = cur.element()?;
                    if ety != MI_MATRIX {
                        return corrupt("struct field is not an array");
                    }
                    parse_matrix(edata, big, Some(full), depth + 1, out)?;
                }
            }
        }
        MX_CHAR => {
            let text = if cur.remaining() >= 8 {
                let (ty, d) = cur.element()?;
                decode_text(ty, d, big, &dims)?
            } else {
                String::new()
            };
            out.push(MatVar { name, class: cls, dims, complex: false, value: MatValue::Text(text) });
        }
        6..=15 => {
            let n = numel.ok_or_else(|| MatError::Corrupt("array dimensions overflow".into()))?;
            let (rty, rdata) = cur.element()?;
            let re = to_f64(rty, rdata, big)?;
            let im = if complex {
                let (ity, idata) = cur.element()?;
                Some(to_f64(ity, idata, big)?)
            } else {
                None
            };
            if re.len() != n || im.as_ref().is_some_and(|v| v.len() != n) {
                return corrupt(format!("variable {name} holds {} values but its size {dims:?} needs {n}", re.len()));
            }
            out.push(MatVar { name, class: cls, dims, complex, value: MatValue::Numeric { re, im } });
        }
        // A cell is listed, and its elements are read as "var{k}" (1-based, column-major as in MATLAB), so a
        // label cell such as Lab E's units = {'woofer','midrange','tweeter'} reaches the import wizard.
        MX_CELL => {
            out.push(MatVar { name: name.clone(), class: cls, dims: dims.clone(), complex: false, value: MatValue::Skipped });
            if depth >= MAX_DEPTH {
                return Ok(());
            }
            let n = numel.ok_or_else(|| MatError::Corrupt("cell dimensions overflow".into()))?;
            for k in 0..n {
                if cur.remaining() < 8 {
                    return corrupt(format!("cell {name} has fewer elements than its size says"));
                }
                let (ety, edata) = cur.element()?;
                if ety != MI_MATRIX {
                    return corrupt("cell element is not an array");
                }
                parse_matrix(edata, big, Some(format!("{name}{{{}}}", k + 1)), depth + 1, out)?;
            }
        }
        // Sparse arrays, function handles: listed, not read.
        _ => out.push(MatVar { name, class: cls, dims, complex, value: MatValue::Skipped }),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(rel: &str) -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures").join(rel)
    }

    fn listing(f: &MatFile) -> Vec<(String, String, Vec<usize>, bool)> {
        f.variables.iter().map(|v| (v.name.clone(), v.class.clone(), v.dims.clone(), v.complex)).collect()
    }

    #[test]
    fn every_fixture_reads() {
        for e in std::fs::read_dir(fixture("mat")).unwrap() {
            let p = e.unwrap().path();
            let f = read_mat_file(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
            assert!(!f.variables.is_empty(), "{} has no variables", p.display());
            assert!(f.description.starts_with("MATLAB 5.0 MAT-file"), "{}", f.description);
            eprintln!("{}: {:?}", p.file_name().unwrap().to_string_lossy(), listing(&f));
        }
    }

    #[test]
    fn datetime_object_does_not_hide_the_data() {
        for name in ["labD_midrange.mat", "labD_woofer_free.mat", "labD_vent_L160.mat"] {
            let f = read_mat_file(&fixture(&format!("mat/{name}"))).unwrap();
            for var in ["fn", "Z"] {
                let v = f.get(var).unwrap_or_else(|| panic!("{name}: {var} missing from {:?}", listing(&f)));
                assert!(matches!(v.value, MatValue::Numeric { .. }));
            }
            assert!(f.variables.iter().any(|v| v.value == MatValue::Skipped), "{name}: no skipped object in {:?}", listing(&f));
        }
    }

    #[test]
    fn v73_is_detected() {
        let mut bytes = vec![0u8; 600];
        bytes[..20].copy_from_slice(b"MATLAB 7.3 MAT-file,");
        bytes[124..128].copy_from_slice(&[0x00, 0x02, b'I', b'M']);
        bytes[512..520].copy_from_slice(HDF5_SIGNATURE);
        assert!(matches!(read_mat(&bytes), Err(MatError::V73)));
        assert!(matches!(read_mat(HDF5_SIGNATURE), Err(MatError::V73)));
        assert!(looks_like_mat(&bytes));
        // a text export with "MI" at bytes 126..128 is not a MAT file
        let mut text = vec![b'x'; 124];
        text.extend_from_slice(b"UMIK-1 measurement\n");
        assert!(!looks_like_mat(&text));
        assert!(MatError::V73.to_string().contains("-v7"));
    }

    /// Hand-built v6 (uncompressed) file with one real 1xN double vector, little endian.
    fn build_uncompressed_double(name: &str, vals: &[f64]) -> Vec<u8> {
        let mut out = vec![b' '; 116];
        out[..19].copy_from_slice(b"MATLAB 5.0 MAT-file");
        out.extend_from_slice(&[0; 8]);
        out.extend_from_slice(&0x0100u16.to_le_bytes());
        out.extend_from_slice(b"IM");
        let mut body = Vec::new();
        let el = |body: &mut Vec<u8>, ty: u32, data: &[u8]| {
            body.extend_from_slice(&ty.to_le_bytes());
            body.extend_from_slice(&(data.len() as u32).to_le_bytes());
            body.extend_from_slice(data);
            while !body.len().is_multiple_of(8) {
                body.push(0);
            }
        };
        el(&mut body, MI_UINT32, &[6, 0, 0, 0, 0, 0, 0, 0]);
        let dims: Vec<u8> = [1i32, vals.len() as i32].iter().flat_map(|d| d.to_le_bytes()).collect();
        el(&mut body, MI_INT32, &dims);
        el(&mut body, MI_INT8, name.as_bytes());
        let data: Vec<u8> = vals.iter().flat_map(|v| v.to_le_bytes()).collect();
        el(&mut body, MI_DOUBLE, &data);
        out.extend_from_slice(&MI_MATRIX.to_le_bytes());
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend_from_slice(&body);
        out
    }

    #[test]
    fn garbage_and_truncation_never_panic() {
        assert!(matches!(read_mat(b"hello world"), Err(MatError::NotMat)));
        assert!(read_mat(&[]).is_err());
        for name in ["labD_midrange.mat", "labD_tweeter.mat"] {
            let bytes = std::fs::read(fixture(&format!("mat/{name}"))).unwrap();
            for cut in (0..600).chain((600..bytes.len()).step_by(97)) {
                let _ = read_mat(&bytes[..cut]);
            }
            assert!(read_mat(&bytes[..bytes.len() / 2]).is_err());
            // Random byte flips (xorshift, fixed seed): Ok or Err, never a panic.
            let mut seed = 0x2545_F491u32;
            for _ in 0..300 {
                let mut b = bytes.clone();
                for _ in 0..4 {
                    seed ^= seed << 13;
                    seed ^= seed >> 17;
                    seed ^= seed << 5;
                    let i = 128 + (seed as usize) % (b.len() - 128);
                    b[i] = (seed >> 24) as u8;
                }
                let _ = read_mat(&b);
            }
        }
        // The fixtures are zlib-compressed; corrupt an uncompressed file too, where every byte is structure.
        let mut v = build_uncompressed_double("x", &[1.0, 2.0, 3.0]);
        assert_eq!(read_mat(&v).unwrap().get("x").unwrap().value, MatValue::Numeric { re: vec![1.0, 2.0, 3.0], im: None });
        for cut in 0..v.len() {
            let _ = read_mat(&v[..cut]);
        }
        for i in 128..v.len() {
            for byte in [0x00, 0x7f, 0xff] {
                let keep = v[i];
                v[i] = byte;
                let _ = read_mat(&v);
                v[i] = keep;
            }
        }
    }

    #[test]
    fn big_endian_small_elements_and_narrow_storage() {
        // Big endian; the name sits in a small data element; a complex double stored as uint8 + int16.
        let mut out = vec![b' '; 116];
        out[..19].copy_from_slice(b"MATLAB 5.0 MAT-file");
        out.extend_from_slice(&[0; 8]);
        out.extend_from_slice(&0x0100u16.to_be_bytes());
        out.extend_from_slice(b"MI");
        let mut body = Vec::new();
        for w in [MI_UINT32, 8, 6 | FLAG_COMPLEX, 0, MI_INT32, 8, 2, 1] {
            body.extend_from_slice(&w.to_be_bytes());
        }
        body.extend_from_slice(&((2u32 << 16) | MI_INT8).to_be_bytes());
        body.extend_from_slice(b"ab\0\0");
        body.extend_from_slice(&((2u32 << 16) | MI_UINT8).to_be_bytes());
        body.extend_from_slice(&[7, 9, 0, 0]);
        body.extend_from_slice(&((4u32 << 16) | MI_INT16).to_be_bytes());
        body.extend_from_slice(&(-1i16).to_be_bytes());
        body.extend_from_slice(&3i16.to_be_bytes());
        out.extend_from_slice(&MI_MATRIX.to_be_bytes());
        out.extend_from_slice(&(body.len() as u32).to_be_bytes());
        out.extend_from_slice(&body);
        let f = read_mat(&out).unwrap();
        let v = f.get("ab").unwrap();
        assert_eq!(v.dims, vec![2, 1]);
        assert!(v.complex);
        assert_eq!(v.value, MatValue::Numeric { re: vec![7.0, 9.0], im: Some(vec![-1.0, 3.0]) });
    }

    #[test]
    fn cell_elements_are_listed() {
        let f = read_mat_file(&fixture("mat/labE_system_0.mat")).unwrap();
        let labels: Vec<String> = (1..=3)
            .map(|k| match &f.get(&format!("units{{{k}}}")).unwrap_or_else(|| panic!("units{{{k}}} in {:?}", listing(&f))).value {
                MatValue::Text(t) => t.clone(),
                v => panic!("{v:?}"),
            })
            .collect();
        assert_eq!(labels.len(), 3);
        assert_eq!(f.get("units").unwrap().class, "cell");
        eprintln!("units = {labels:?}");
    }

    #[test]
    fn char_rows_are_rebuilt_from_column_major() {
        assert_eq!(decode_text(MI_UTF8, b"adbecf", false, &[2, 3]).unwrap(), "abc\ndef");
        let utf16: Vec<u8> = "Ω/V".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        assert_eq!(decode_text(MI_UINT16, &utf16, false, &[1, 3]).unwrap(), "Ω/V");
    }
}
