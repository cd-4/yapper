use serde::{Deserialize, Serialize};
use std::{
    env,
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
struct DirectoryEntry {
    relative_path: String,
    name: String,
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

#[derive(Clone, Deserialize, Serialize)]
struct ProjectEntry {
    root: String,
    display_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum StoredProjectEntry {
    Path(String),
    Entry(ProjectEntry),
}

#[derive(Deserialize)]
struct StoredProjectStore {
    projects: Vec<StoredProjectEntry>,
}

#[derive(Serialize)]
struct ProjectStore {
    projects: Vec<ProjectEntry>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UiState {
    sidebar_collapsed: bool,
    root_path: Option<String>,
    relative_path: Option<String>,
    test_name: Option<String>,
}

fn config_dir() -> AppResult<PathBuf> {
    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| AppError::Message("Could not resolve the home directory".into()))?;
    Ok(home.join(".config").join("yapper"))
}

fn projects_file() -> AppResult<PathBuf> {
    Ok(config_dir()?.join("projects.json"))
}

fn ui_state_file() -> AppResult<PathBuf> {
    Ok(config_dir()?.join("ui-state.json"))
}

fn read_project_store() -> AppResult<ProjectStore> {
    let path = projects_file()?;
    if !path.exists() {
        return Ok(ProjectStore {
            projects: Vec::new(),
        });
    }
    let contents = fs::read_to_string(path)?;
    let stored: StoredProjectStore = serde_json::from_str(&contents)
        .map_err(|error| AppError::Message(format!("Could not read saved projects: {error}")))?;
    Ok(ProjectStore {
        projects: stored
            .projects
            .into_iter()
            .map(|project| match project {
                StoredProjectEntry::Path(root) => ProjectEntry {
                    root,
                    display_name: None,
                },
                StoredProjectEntry::Entry(project) => project,
            })
            .collect(),
    })
}

fn write_project_store(store: &ProjectStore) -> AppResult<()> {
    let path = projects_file()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let contents = serde_json::to_string_pretty(store)
        .map_err(|error| AppError::Message(format!("Could not save projects: {error}")))?;
    fs::write(path, contents)?;
    Ok(())
}

#[tauri::command]
fn load_ui_state() -> AppResult<UiState> {
    let path = ui_state_file()?;
    if !path.exists() {
        return Ok(UiState::default());
    }
    let contents = fs::read_to_string(path)?;
    serde_json::from_str(&contents)
        .map_err(|error| AppError::Message(format!("Could not read UI state: {error}")))
}

#[tauri::command]
fn save_ui_state(state: UiState) -> AppResult<()> {
    let path = ui_state_file()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let contents = serde_json::to_string_pretty(&state)
        .map_err(|error| AppError::Message(format!("Could not save UI state: {error}")))?;
    fs::write(path, contents)?;
    Ok(())
}

#[tauri::command]
fn list_projects() -> AppResult<Vec<ProjectEntry>> {
    Ok(read_project_store()?.projects)
}

#[tauri::command]
fn add_project(root: String) -> AppResult<Vec<ProjectEntry>> {
    let root = normalize_root(&root)?.to_string_lossy().to_string();
    let mut store = read_project_store()?;
    let existing = store.projects.iter().find(|project| project.root == root).cloned();
    store.projects.retain(|project| project.root != root);
    store.projects.push(existing.unwrap_or(ProjectEntry {
        root,
        display_name: None,
    }));
    write_project_store(&store)?;
    Ok(store.projects)
}

#[tauri::command]
fn remove_project(root: String) -> AppResult<Vec<ProjectEntry>> {
    let mut store = read_project_store()?;
    store.projects.retain(|project| project.root != root);
    write_project_store(&store)?;
    Ok(store.projects)
}

#[tauri::command]
fn rename_project(root: String, display_name: String) -> AppResult<Vec<ProjectEntry>> {
    let mut store = read_project_store()?;
    let display_name = display_name.trim();
    let Some(project) = store.projects.iter_mut().find(|project| project.root == root) else {
        return Err(AppError::Message("Project is not saved".into()));
    };
    project.display_name = if display_name.is_empty() {
        None
    } else {
        Some(display_name.to_string())
    };
    write_project_store(&store)?;
    Ok(store.projects)
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

fn normalized_relative_path(relative_path: &str) -> AppResult<String> {
    let trimmed = relative_path.trim().trim_matches('/');
    if trimmed.is_empty() {
        return Err(AppError::Message("Path cannot be empty".into()));
    }
    safe_join(Path::new(""), trimmed)?;
    Ok(trimmed.replace('\\', "/"))
}

fn ensure_yaml_path(relative_path: &str) -> AppResult<()> {
    let extension = Path::new(relative_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default();
    if extension == "yaml" || extension == "yml" {
        Ok(())
    } else {
        Err(AppError::Message("Test file must end in .yaml or .yml".into()))
    }
}

fn is_ignored_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | ".svelte-kit" | ".tauri"
    )
}

fn collect_dirs(root: &Path, dir: &Path, directories: &mut Vec<DirectoryEntry>) -> AppResult<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let metadata = entry.metadata()?;
        if !metadata.is_dir() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        if is_ignored_dir(&file_name) {
            continue;
        }

        let relative = path
            .strip_prefix(root)
            .map_err(|_| AppError::Message("Could not resolve relative path".into()))?
            .to_string_lossy()
            .replace('\\', "/");

        directories.push(DirectoryEntry {
            relative_path: relative,
            name: file_name,
        });
        collect_dirs(root, &path, directories)?;
    }
    Ok(())
}

fn yaml_key(line: &str) -> Option<&str> {
    let (key, _) = line.split_once(':')?;
    let key = key.trim().trim_start_matches('-').trim();
    if key.is_empty() {
        None
    } else {
        Some(key.trim_matches(['"', '\'']))
    }
}

fn indentation(line: &str) -> usize {
    line.chars().take_while(|character| *character == ' ').count()
}

fn is_config_section(key: &str) -> bool {
    matches!(
        key,
        "vars" | "urls" | "step-sets" | "headers" | "auth" | "environments" | "plugins"
    )
}

fn yaml_test_names(contents: &str) -> Vec<String> {
    let lines: Vec<String> = contents
        .lines()
        .map(|line| line.replace('\t', "  "))
        .filter(|line| {
            let trimmed = line.trim();
            !trimmed.is_empty() && !trimmed.starts_with('#')
        })
        .collect();
    let mut tests = Vec::new();

    for (index, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if indentation(line) != 0 || trimmed.starts_with('-') {
            continue;
        }

        let Some(key) = yaml_key(trimmed) else {
            continue;
        };

        if key == "tests" || key == "test" {
            for child in lines.iter().skip(index + 1) {
                let child_indent = indentation(child);
                if child_indent == 0 {
                    break;
                }
                if child_indent != 2 {
                    continue;
                }

                let child_trimmed = child.trim();
                if let Some(name) = child_trimmed
                    .strip_prefix("- name:")
                    .map(|value| value.trim().trim_matches(['"', '\'']))
                    .filter(|value| !value.is_empty())
                {
                    tests.push(name.to_string());
                    continue;
                }

                if let Some(name) = yaml_key(child_trimmed) {
                    tests.push(name.to_string());
                }
            }
            continue;
        }

        if is_config_section(key) {
            continue;
        }

        let mut has_steps = false;
        for child in lines.iter().skip(index + 1) {
            let child_indent = indentation(child);
            if child_indent == 0 {
                break;
            }
            if child_indent == 2 && yaml_key(child.trim()) == Some("steps") {
                has_steps = true;
                break;
            }
        }

        if has_steps {
            tests.push(key.to_string());
        }
    }

    tests.sort();
    tests.dedup();
    tests
}

fn is_config_yaml(contents: &str) -> bool {
    contents
        .lines()
        .map(|line| line.replace('\t', "  "))
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') || indentation(&line) != 0 {
                None
            } else {
                yaml_key(trimmed).map(str::to_string)
            }
        })
        .any(|key| matches!(key.as_str(), "vars" | "urls" | "step-sets"))
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

        let contents = fs::read_to_string(&path).unwrap_or_default();
        let kind = if file_name == "config.yaml" || file_name == "config.yml" || is_config_yaml(&contents) {
            "config"
        } else {
            "test"
        };
        let tests = if kind == "test" {
            yaml_test_names(&contents)
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
fn list_directories(root: String) -> AppResult<Vec<DirectoryEntry>> {
    let root = normalize_root(&root)?;
    let mut directories = Vec::new();
    collect_dirs(&root, &root, &mut directories)?;
    directories.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(directories)
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
fn create_directory(root: String, relative_path: String) -> AppResult<()> {
    let root = normalize_root(&root)?;
    let relative_path = normalized_relative_path(&relative_path)?;
    let path = safe_join(&root, &relative_path)?;
    if path.exists() {
        return Err(AppError::Message(format!("{relative_path} already exists")));
    }
    fs::create_dir_all(path)?;
    Ok(())
}

#[tauri::command]
fn create_test_file(root: String, relative_path: String, contents: String) -> AppResult<()> {
    let root = normalize_root(&root)?;
    let relative_path = normalized_relative_path(&relative_path)?;
    ensure_yaml_path(&relative_path)?;
    let path = safe_join(&root, &relative_path)?;
    if path.exists() {
        return Err(AppError::Message(format!("{relative_path} already exists")));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, contents)?;
    Ok(())
}

#[tauri::command]
fn rename_path(root: String, from: String, to: String) -> AppResult<()> {
    let root = normalize_root(&root)?;
    let from = normalized_relative_path(&from)?;
    let to = normalized_relative_path(&to)?;
    let from_path = safe_join(&root, &from)?;
    let to_path = safe_join(&root, &to)?;
    if !from_path.exists() {
        return Err(AppError::Message(format!("{from} does not exist")));
    }
    if to_path.exists() {
        return Err(AppError::Message(format!("{to} already exists")));
    }
    if from_path.is_file() {
        ensure_yaml_path(&to)?;
    }
    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(from_path, to_path)?;
    Ok(())
}

#[tauri::command]
fn delete_path(root: String, relative_path: String) -> AppResult<()> {
    let root = normalize_root(&root)?;
    let relative_path = normalized_relative_path(&relative_path)?;
    let path = safe_join(&root, &relative_path)?;
    if !path.exists() {
        return Err(AppError::Message(format!("{relative_path} does not exist")));
    }
    if path.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
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
fn run_yapitest(
    root: String,
    target: Option<String>,
    test_name: Option<String>,
) -> AppResult<RunResult> {
    let root = normalize_root(&root)?;

    let target = target.filter(|v| !v.trim().is_empty());
    let name_filter = test_name.filter(|v| !v.trim().is_empty());

    let mut display = String::from("yapitest");
    let path = match &target {
        Some(t) => {
            display.push(' ');
            display.push_str(t);
            safe_join(&root, t)?
        }
        None => root.clone(),
    };

    if let Some(ref name) = name_filter {
        display.push_str(" -k ");
        display.push_str(name);
    }

    let start = std::time::Instant::now();
    let mut results = yapitest::run_path_blocking(&path)
        .map_err(|e| AppError::Message(e.to_string()))?;
    let elapsed_ms = start.elapsed().as_millis() as u64;

    if let Some(ref filter) = name_filter {
        results.retain(|r: &yapitest::TestResult| r.name().contains(filter.as_str()));
    }

    let all_passed = results.iter().all(|r| r.passed());

    Ok(RunResult {
        command: display,
        status: Some(if all_passed { 0 } else { 1 }),
        stdout: format_run_output(&results, elapsed_ms),
        stderr: String::new(),
    })
}

fn format_run_output(results: &[yapitest::TestResult], elapsed_ms: u64) -> String {
    let mut out = String::new();
    for r in results {
        if r.passed() {
            out.push_str(&format!("PASS {}\n", r.name()));
        } else {
            out.push_str(&format!("FAIL {}\n", r.name()));
            if let Some(msg) = r.get_failure_message() {
                out.push_str(&format!("     {msg}\n"));
            }
        }
    }
    let passed = results.iter().filter(|r| r.passed()).count();
    let total = results.len();
    out.push_str(&format!("\n{passed}/{total} passed ({elapsed_ms} ms)\n"));
    out
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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan_repository,
            list_directories,
            read_yaml_file,
            write_yaml_file,
            create_directory,
            create_test_file,
            rename_path,
            delete_path,
            create_sample_project,
            run_yapitest,
            git_status,
            load_ui_state,
            save_ui_state,
            list_projects,
            add_project,
            remove_project,
            rename_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::yaml_test_names;

    #[test]
    fn extracts_top_level_test_blocks() {
        let contents = r#"
health-check:
  steps:
    - path: /health
      method: GET

create-user:
  setup: login
  steps:
    - path: /users
      method: POST
"#;

        assert_eq!(yaml_test_names(contents), vec!["create-user", "health-check"]);
    }

    #[test]
    fn extracts_tests_nested_under_tests_map() {
        let contents = r#"
vars:
  token: secret

tests:
  health-check:
    steps:
      - path: /health
  "create-user":
    steps:
      - path: /users
"#;

        assert_eq!(yaml_test_names(contents), vec!["create-user", "health-check"]);
    }

    #[test]
    fn extracts_tests_nested_under_tests_list() {
        let contents = r#"
tests:
  - name: health-check
    steps:
      - path: /health
  - create-user:
      steps:
        - path: /users
"#;

        assert_eq!(yaml_test_names(contents), vec!["create-user", "health-check"]);
    }

    #[test]
    fn ignores_config_sections_in_test_files() {
        let contents = r#"
vars:
  token: secret
urls:
  api: https://api.example.com
step-sets:
  login:
    steps:
      - path: /login

health-check:
  steps:
    - path: /health
"#;

        assert_eq!(yaml_test_names(contents), vec!["health-check"]);
    }
}
