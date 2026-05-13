// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Command, Child};
use std::sync::Mutex;
use tauri::Manager;

struct ServerHandle(Mutex<Option<Child>>);

#[tauri::command]
fn start_pyhorn_server(handle: tauri::AppHandle) -> Result<String, String> {
    let state = handle.state::<ServerHandle>();
    if state.0.lock().map_err(|e| e.to_string())?.is_some() {
        return Ok("Server already running".to_string());
    }
    let pyhorn_ui_dir = std::env::current_dir().unwrap();
    let python_exe = std::env::var("PYTHON_EXE")
        .unwrap_or_else(|_| {
            let venv_python = std::env::current_dir().unwrap()
                .join(".venv")
                .join("bin")
                .join("python");
            if venv_python.exists() {
                venv_python.to_string_lossy().to_string()
            } else {
                "/opt/homebrew/bin/python3.14".to_string()
            }
        });
    let mut child = Command::new(&python_exe)
        .current_dir(&pyhorn_ui_dir)
        .args(["-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "8765"])
        .spawn()
        .map_err(|e| format!("Failed to start Python server: {}", e))?;

    std::thread::sleep(std::time::Duration::from_millis(1500));

    if child.try_wait().map(|s| s.is_none()).unwrap_or(false) {
        Ok("Server started on http://127.0.0.1:8765".to_string())
    } else {
        Err("Python server failed to start".to_string())
    }
}

#[tauri::command]
fn stop_pyhorn_server(handle: tauri::AppHandle) -> Result<(), String> {
    let state = handle.state::<ServerHandle>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(ServerHandle(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![start_pyhorn_server, stop_pyhorn_server])
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let state = handle.state::<ServerHandle>();
                let mut server = state.0.lock().unwrap();
                let pyhorn_ui_dir = std::env::current_dir().unwrap();
                let python_exe = std::env::var("PYTHON_EXE")
                    .unwrap_or_else(|_| "/opt/homebrew/bin/python3.14".to_string());
                if let Ok(child) = Command::new(&python_exe)
                    .current_dir(&pyhorn_ui_dir)
                    .args(["-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "8765", "--quiet"])
                    .spawn()
                {
                    *server = Some(child);
                    eprintln!("pyhorn server started on http://127.0.0.1:8765");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}