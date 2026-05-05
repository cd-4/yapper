use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
};

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

type AppResult<T> = Result<T, AppError>;

#[derive(Serialize)]
struct FileEntry {
    relative_path: String,
    name: String,
    kind: String,
    size: u64,
    tests: Vec<String>,
}

#[derive(Serialize)]
struct RunResult {
    command: String,
    status: Option<i32>,
    stdout: String,
    stderr: String,
}

#[derive(Serialize)]
struct GitStatus {
    available: bool,
    output: String,
}

fn normalize_root(root: &str) -> AppResult<PathBuf> {
    let path = PathBuf::from(root);
    if !path.exists() {
        return Err(AppError::Message(format!("{root} does not exist")));
    }
    if !path.is_dir() {
        return Err(AppError::Message(format!("{root} is not a directory")));
    }
    Ok(path.canonicalize()?)
}

fn safe_join(root: &Path, relative_path: &str) -> AppResult<PathBuf> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(AppError::Message(
            "Path must stay inside the repository".into(),
        ));
    }
    Ok(root.join(relative))
}

fn is_ignored_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | ".svelte-kit" | ".tauri"
    )
}

fn yaml_top_level_keys(contents: &str) -> Vec<String> {
    contents
        .lines()
        .filter_map(|line| {
            if line.starts_with(' ') || line.starts_with('\t') || line.trim_start().starts_with('#')
            {
                return None;
            }

            let (key, _) = line.split_once(':')?;
            let key = key.trim();
            if key.is_empty() || key.starts_with('-') {
                None
            } else {
                Some(key.trim_matches(['"', '\'']).to_string())
            }
        })
        .collect()
}

fn collect_yaml(root: &Path, dir: &Path, files: &mut Vec<FileEntry>) -> AppResult<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        let metadata = entry.metadata()?;

        if metadata.is_dir() {
            if !is_ignored_dir(&file_name) {
                collect_yaml(root, &path, files)?;
            }
            continue;
        }

        let extension = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default();
        if extension != "yaml" && extension != "yml" {
            continue;
        }

        let relative = path
            .strip_prefix(root)
            .map_err(|_| AppError::Message("Could not resolve relative path".into()))?
            .to_string_lossy()
            .replace('\\', "/");

        let kind = if file_name == "config.yaml" || file_name == "config.yml" {
            "config"
        } else {
            "test"
        };
        let tests = if kind == "test" {
            fs::read_to_string(&path)
                .map(|contents| yaml_top_level_keys(&contents))
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        files.push(FileEntry {
            relative_path: relative,
            name: file_name,
            kind: kind.into(),
            size: metadata.len(),
            tests,
        });
    }

    Ok(())
}

#[tauri::command]
fn scan_repository(root: String) -> AppResult<Vec<FileEntry>> {
    let root = normalize_root(&root)?;
    let mut files = Vec::new();
    collect_yaml(&root, &root, &mut files)?;
    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(files)
}

#[tauri::command]
fn read_yaml_file(root: String, relative_path: String) -> AppResult<String> {
    let root = normalize_root(&root)?;
    let path = safe_join(&root, &relative_path)?;
    Ok(fs::read_to_string(path)?)
}

#[tauri::command]
fn write_yaml_file(root: String, relative_path: String, contents: String) -> AppResult<()> {
    let root = normalize_root(&root)?;
    let path = safe_join(&root, &relative_path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, contents)?;
    Ok(())
}

#[tauri::command]
fn create_sample_project(root: String) -> AppResult<()> {
    let root = normalize_root(&root)?;
    let config = safe_join(&root, "api-tests/config.yaml")?;
    let health = safe_join(&root, "api-tests/health.yaml")?;
    fs::create_dir_all(config.parent().expect("sample config has a parent"))?;

    if !config.exists() {
        fs::write(
            config,
            r#"vars:
  base-url: https://api.example.com
  api-token: replace-me

urls:
  api: $base-url

step-sets:
  authenticated-health:
    - path: /health
      method: GET
      headers:
        Authorization: Bearer $api-token
      assert:
        status-code: 200
"#,
        )?;
    }

    if !health.exists() {
        fs::write(
            health,
            r#"health-check:
  steps:
    - path: /health
      id: health
      method: GET
      assert:
        status-code: 200
"#,
        )?;
    }

    Ok(())
}

#[tauri::command]
fn run_yapitest(root: String, target: Option<String>) -> AppResult<RunResult> {
    let root = normalize_root(&root)?;
    let mut command = Command::new("yapitest");
    command.current_dir(&root);

    let mut display = String::from("yapitest");
    if let Some(target) = target.filter(|value| !value.trim().is_empty()) {
        let path = safe_join(&root, &target)?;
        command.arg(path);
        display.push(' ');
        display.push_str(&target);
    }

    let output = command.output().map_err(|error| {
        AppError::Message(format!(
            "Could not run yapitest. Install it with `pip install yapitest`. Details: {error}"
        ))
    })?;

    Ok(RunResult {
        command: display,
        status: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

#[tauri::command]
fn git_status(root: String) -> AppResult<GitStatus> {
    let root = normalize_root(&root)?;
    let output = Command::new("git")
        .args(["status", "--short"])
        .current_dir(root)
        .output();

    match output {
        Ok(output) if output.status.success() => Ok(GitStatus {
            available: true,
            output: String::from_utf8_lossy(&output.stdout).to_string(),
        }),
        Ok(output) => Ok(GitStatus {
            available: false,
            output: String::from_utf8_lossy(&output.stderr).to_string(),
        }),
        Err(error) => Ok(GitStatus {
            available: false,
            output: error.to_string(),
        }),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_repository,
            read_yaml_file,
            write_yaml_file,
            create_sample_project,
            run_yapitest,
            git_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
