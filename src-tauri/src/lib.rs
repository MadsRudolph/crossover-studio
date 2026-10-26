// Crossover Studio backend: file IO and parsing only. All acoustics lives in the TypeScript engine.
// Command signatures are fixed by src/platform/index.ts; keep them in sync.

mod commands;
pub mod mat;
pub mod profile;
pub mod text;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::inspect_file,
            commands::read_series,
            commands::list_profiles,
            commands::load_profile,
            commands::save_profile,
            commands::write_text_file,
            commands::write_binary_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
