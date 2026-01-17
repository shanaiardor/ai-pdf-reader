#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use comrak::Options as MarkdownOptions;
use tauri::Size;

#[derive(Debug, Serialize, Deserialize, Default)]
struct AiConfig {
  model: String,
  base_url: String,
  api_key: String,
  temperature: Option<f32>,
  max_tokens: Option<u32>,
  #[serde(default = "default_show_boxes")]
  show_boxes: bool,
}

fn default_show_boxes() -> bool {
  true
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct LastOpened {
  path: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct ReadingState {
  pages: HashMap<String, u32>,
}

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path_resolver()
    .app_config_dir()
    .ok_or_else(|| "Unable to resolve app config dir".to_string())?;
  fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
  Ok(dir)
}

fn ai_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let mut dir = config_dir(app)?;
  dir.push("ai.json");
  Ok(dir)
}

fn last_opened_path_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let mut dir = config_dir(app)?;
  dir.push("last_opened.json");
  Ok(dir)
}

fn reading_state_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let mut dir = config_dir(app)?;
  dir.push("reading_state.json");
  Ok(dir)
}

fn load_reading_state(app: &tauri::AppHandle) -> Result<ReadingState, String> {
  let path = reading_state_file(app)?;
  if !path.exists() {
    return Ok(ReadingState::default());
  }
  let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
  serde_json::from_str(&content).map_err(|err| err.to_string())
}

fn save_reading_state(app: &tauri::AppHandle, state: &ReadingState) -> Result<(), String> {
  let path = reading_state_file(app)?;
  let content = serde_json::to_string_pretty(state).map_err(|err| err.to_string())?;
  fs::write(path, content).map_err(|err| err.to_string())
}

#[tauri::command]
fn load_ai_config(app: tauri::AppHandle) -> Result<AiConfig, String> {
  let path = ai_config_path(&app)?;
  if !path.exists() {
    return Ok(AiConfig::default());
  }
  let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
  serde_json::from_str(&content).map_err(|err| err.to_string())
}

#[tauri::command]
fn save_ai_config(app: tauri::AppHandle, config: AiConfig) -> Result<(), String> {
  let path = ai_config_path(&app)?;
  let content = serde_json::to_string_pretty(&config).map_err(|err| err.to_string())?;
  fs::write(path, content).map_err(|err| err.to_string())
}

#[tauri::command]
fn load_last_opened_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
  let path = last_opened_path_file(&app)?;
  if !path.exists() {
    return Ok(None);
  }
  let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
  let data: LastOpened = serde_json::from_str(&content).map_err(|err| err.to_string())?;
  let value = data.path.trim();
  if value.is_empty() {
    Ok(None)
  } else {
    Ok(Some(value.to_string()))
  }
}

#[tauri::command]
fn save_last_opened_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
  let file_path = last_opened_path_file(&app)?;
  let data = LastOpened { path };
  let content = serde_json::to_string_pretty(&data).map_err(|err| err.to_string())?;
  fs::write(file_path, content).map_err(|err| err.to_string())
}

#[tauri::command]
fn load_last_reading_page(app: tauri::AppHandle, path: String) -> Result<Option<u32>, String> {
  if path.trim().is_empty() {
    return Ok(None);
  }
  let state = load_reading_state(&app)?;
  Ok(state.pages.get(&path).copied())
}

#[tauri::command]
fn save_last_reading_page(
  app: tauri::AppHandle,
  path: String,
  page: u32,
) -> Result<(), String> {
  if path.trim().is_empty() {
    return Ok(());
  }
  let mut state = load_reading_state(&app)?;
  state.pages.insert(path, page.max(1));
  save_reading_state(&app, &state)
}

#[tauri::command]
fn render_markdown(markdown: String) -> Result<String, String> {
  let mut options = MarkdownOptions::default();
  options.parse.smart = true;
  options.extension.strikethrough = true;
  options.extension.table = true;
  options.extension.tasklist = true;
  options.extension.autolink = true;
  options.render.unsafe_ = true;

  let html = comrak::markdown_to_html(&markdown, &options);
  let clean = ammonia::Builder::default().clean(&html).to_string();
  Ok(clean)
}

#[tauri::command]
fn set_min_window_width(window: tauri::Window, width: f64) -> Result<(), String> {
  let clamped_width = width.max(520.0);
  let size = Size::Logical(tauri::LogicalSize {
    width: clamped_width,
    height: 1.0,
  });
  window.set_min_size(Some(size)).map_err(|err| err.to_string())
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      load_ai_config,
      save_ai_config,
      load_last_opened_path,
      save_last_opened_path,
      load_last_reading_page,
      save_last_reading_page,
      render_markdown,
      set_min_window_width
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
