// Tauri commands. Types mirror src/types.ts (FileInfo, MatVariable, ReadSpec, Series, ProfileEntry).
// SEED: stubs with the final signatures; the backend work package implements them.

use serde::{Deserialize, Serialize};
use serde_json::Value;

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

#[tauri::command]
pub fn inspect_file(path: String) -> Result<FileInfo, String> {
    Err(format!("inspect_file not implemented yet ({path})"))
}

#[tauri::command]
pub fn read_series(spec: ReadSpec) -> Result<Series, String> {
    Err(format!("read_series not implemented yet ({})", spec.path))
}

#[tauri::command]
pub fn list_profiles(app: tauri::AppHandle) -> Result<Vec<ProfileEntry>, String> {
    let _ = app;
    Ok(vec![])
}

#[tauri::command]
pub fn load_profile(path: String) -> Result<Value, String> {
    Err(format!("load_profile not implemented yet ({path})"))
}

#[tauri::command]
pub fn save_profile(app: tauri::AppHandle, profile: Value, source_files: Vec<String>) -> Result<String, String> {
    let _ = (app, profile, source_files);
    Err("save_profile not implemented yet".into())
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("could not write {path}: {e}"))
}

#[tauri::command]
pub fn write_binary_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, bytes).map_err(|e| format!("could not write {path}: {e}"))
}
