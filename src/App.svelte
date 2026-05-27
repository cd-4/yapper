<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { onMount } from "svelte";
  import {
    ChevronDown,
    ChevronRight,
    FileText,
    Folder,
    FolderOpen,
    FolderTree,
    Maximize,
    Minus,
    PanelLeftClose,
    PanelLeftOpen,
    Play,
    Plus,
    Save,
    Trash2,
    X,
  } from "lucide-svelte";
  import StepEditor from "./StepEditor.svelte";
  import TestResults from "./TestResults.svelte";
  import ThemedSelect from "./ThemedSelect.svelte";
  import {
    buildConfigYaml,
    buildTestYaml,
    extractReferenceCatalog,
    mergeCatalogs,
    parseConfigDraft,
    parseTestDraft,
    removeTestDraft,
    replaceTestDraft,
  } from "./yaml";
  import type {
    ConfigDraft,
    DirectoryEntry,
    FileEntry,
    OutputDraft,
    ProjectEntry,
    ReferenceCatalog,
    RunResult,
    StepDraft,
    StepSetDraft,
    TestDraft,
    UrlDraft,
    VariableDraft,
  } from "./types";

  type UiState = {
    sidebarCollapsed: boolean;
    rootPath: string | null;
    relativePath: string | null;
    testName: string | null;
  };

  let rootPath = "";
  let projects: ProjectEntry[] = [];
  let directories: DirectoryEntry[] = [];
  let files: FileEntry[] = [];
  let selected: FileEntry | null = null;
  let selectedRelativePath = "";
  let selectedTestKey = "";
  let editor = "";
  let original = "";
  let testRunning = false;
  let runResult: RunResult | null = null;
  let busy = false;
  let message = "";
  let view: "builder" | "yaml" | "config" = "builder";
  let filter = "";
  let focusedKey = "";
  let draggingStepUid = "";
  let dragOverStepUid = "";
  let expandedTree: Record<string, boolean> = {};
  let sidebarCollapsed = false;
  let isMac = navigator.platform.toLowerCase().includes("mac");
  let collapsedTreeOpen = false;
  let workspaceContent: HTMLDivElement;
  let runMenu = { open: false, left: 0, top: 0 };
  let editingTest: { file: FileEntry; originalName: string } | null = null;
  let treeMenu:
    | { type: "none"; left: 0; top: 0 }
    | { type: "project"; path: string; left: number; top: number }
    | { type: "dir"; path: string; left: number; top: number }
    | { type: "file"; file: FileEntry; left: number; top: number }
    | { type: "test"; file: FileEntry; name: string; left: number; top: number } = { type: "none", left: 0, top: 0 };
  let renamingProject = { path: "", name: "" };
  let renamingTreePath = { from: "", name: "" };
  let projectLongPressTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressProjectClickPath = "";
  let suggestionMenu = {
    key: "",
    index: 0,
    left: 0,
    top: 0,
    items: [] as string[],
  };

  const emptyCatalog: ReferenceCatalog = { vars: [], urls: [], stepSets: [], outputs: [] };
  let catalog = emptyCatalog;

  const newRequestStep = (overrides: Partial<StepDraft> = {}): StepDraft => ({
    uid: crypto.randomUUID(),
    type: "request",
    referenceName: "",
    collapsed: false,
    headersCollapsed: false,
    bodyCollapsed: false,
    assertionsCollapsed: false,
    optionsCollapsed: false,
    url: "",
    waitBefore: "",
    waitAfter: "",
    retry: "",
    path: "/health",
    method: "GET",
    stepId: "health",
    headers: [{ id: crypto.randomUUID(), name: "Authorization", value: "Bearer $vars.api-token" }],
    body: "",
    statusCode: "200",
    assertionHeaders: [],
    responseBody: "",
    ...overrides,
  });

  let draft: TestDraft = {
    testName: "health-check",
    setupName: "",
    cleanupName: "",
    steps: [newRequestStep()],
  };
  let configDraft: ConfigDraft = { vars: [], urls: [], stepSets: [] };

  $: filteredFiles = files.filter((file) =>
    file.relative_path.toLowerCase().includes(filter.toLowerCase()),
  );
  $: filteredDirectories = directories.filter(
    (directory) =>
      !filter.trim() || directory.relative_path.toLowerCase().includes(filter.toLowerCase()),
  );
  $: treeRows = buildTreeRows(filteredFiles, filteredDirectories, expandedTree);
  $: dirty = editor !== original;
  $: generatedYaml = buildTestYaml(draft);
  $: generatedConfigYaml = buildConfigYaml(configDraft);
  $: suggestions = view === "config" ? buildConfigSuggestions(configDraft, catalog) : buildSuggestions(draft, catalog);
  $: treeMenuPath = treeMenu.type === "project" || treeMenu.type === "dir" ? treeMenu.path : "";
  $: treeMenuFile = treeMenu.type === "file" ? treeMenu.file : null;
  $: treeMenuTest = treeMenu.type === "test" ? treeMenu : null;
  $: if (view === "builder") {
    editor = generatedYaml;
  }
  $: if (view === "config") {
    editor = generatedConfigYaml;
  }

  async function call<T>(name: string, args: Record<string, unknown> = {}) {
    try {
      busy = true;
      message = "";
      return await invoke<T>(name, args);
    } catch (error) {
      message = String(error);
      throw error;
    } finally {
      busy = false;
    }
  }

  function appWindow() {
    try {
      return getCurrentWindow();
    } catch {
      return null;
    }
  }

  function startWindowDrag(event: MouseEvent) {
    if (event.button !== 0 || event.detail > 1) return;
    void appWindow()?.startDragging();
  }

  function toggleWindowMaximize() {
    void appWindow()?.toggleMaximize();
  }

  function minimizeWindow() {
    void appWindow()?.minimize();
  }

  function closeWindow() {
    void appWindow()?.close();
  }

  function shouldUseNativeContextMenu(target: EventTarget | null) {
    const element = target instanceof Element ? target : null;
    if (!element) return false;
    return Boolean(element.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"));
  }

  function currentUiState(overrides: Partial<UiState> = {}): UiState {
    return {
      sidebarCollapsed,
      rootPath: rootPath || null,
      relativePath: selected?.relative_path || editingTest?.file.relative_path || selectedRelativePath || null,
      testName: selectedTestKey ? selectedTestKey.split("#").slice(1).join("#") || null : null,
      ...overrides,
    };
  }

  function saveUiState(overrides: Partial<UiState> = {}) {
    void invoke("save_ui_state", { state: currentUiState(overrides) }).catch((error) => {
      console.error("Could not save UI state", error);
    });
  }

  onMount(() => {
    void restoreSession();
    const closeTreeMenu = () => {
      treeMenu = { type: "none", left: 0, top: 0 };
      runMenu = { open: false, left: 0, top: 0 };
    };
    const suppressWebviewContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented || shouldUseNativeContextMenu(event.target)) return;
      event.preventDefault();
      closeTreeMenu();
    };
    window.addEventListener("click", closeTreeMenu);
    window.addEventListener("contextmenu", suppressWebviewContextMenu);
    return () => {
      window.removeEventListener("click", closeTreeMenu);
      window.removeEventListener("contextmenu", suppressWebviewContextMenu);
    };
  });

  async function restoreSession() {
    const savedState = await invoke<UiState>("load_ui_state").catch(() => currentUiState());
    sidebarCollapsed = savedState.sidebarCollapsed;
    await loadProjects(savedState);
  }

  async function loadProjects(savedState: UiState | null = null) {
    projects = await call<ProjectEntry[]>("list_projects");
    if (rootPath || projects.length === 0) return;

    const savedProject = savedState?.rootPath
      ? projects.find((project) => project.root === savedState.rootPath)
      : null;
    await loadProject(savedProject?.root || projects[projects.length - 1].root, savedState);
  }

  async function loadProject(path: string, savedState: UiState | null = null) {
    rootPath = path;
    treeMenu = { type: "none", left: 0, top: 0 };
    selected = null;
    selectedRelativePath = "";
    selectedTestKey = "";
    editingTest = null;
    if (!rootPath.trim()) {
      message = "Enter the path to a Git repository or API test folder.";
      return;
    }
    directories = await call<DirectoryEntry[]>("list_directories", { root: rootPath.trim() });
    files = await call<FileEntry[]>("scan_repository", { root: rootPath.trim() });
    await refreshCatalog();
    expandDefaultTree();
    const restoredFile =
      savedState?.rootPath === rootPath && savedState.relativePath
        ? files.find((file) => file.relative_path === savedState.relativePath)
        : null;
    if (restoredFile && savedState?.testName && restoredFile.tests.includes(savedState.testName)) {
      await selectTest(restoredFile, savedState.testName);
    } else if (restoredFile) {
      await selectFile(restoredFile);
    } else if (!selected && files.length > 0) {
      await selectFile(files[0]);
    } else {
      saveUiState({ rootPath, relativePath: null, testName: null });
    }
  }

  async function scan() {
    await loadProject(rootPath);
  }

  async function refreshRepositoryTree() {
    if (!rootPath.trim()) return;
    directories = await call<DirectoryEntry[]>("list_directories", { root: rootPath.trim() });
    files = await call<FileEntry[]>("scan_repository", { root: rootPath.trim() });
    await refreshCatalog();
    expandDefaultTree();
  }

  async function chooseRoot() {
    const selectedPath = await open({
      directory: true,
      multiple: false,
      title: "Open repository",
    });
    if (typeof selectedPath !== "string") return;
    projects = await call<ProjectEntry[]>("add_project", { root: selectedPath });
    await loadProject(projects[projects.length - 1]?.root || selectedPath);
  }

  type TreeRow =
    | { type: "dir"; key: string; name: string; depth: number; expanded: boolean }
    | { type: "file"; key: string; file: FileEntry; depth: number; expanded: boolean }
    | { type: "test"; key: string; file: FileEntry; name: string; depth: number };

  type DirectoryNode = {
    dirs: Map<string, DirectoryNode>;
    files: FileEntry[];
  };

  function buildTreeRows(
    items: FileEntry[],
    directoryItems: DirectoryEntry[],
    expanded: Record<string, boolean>,
  ): TreeRow[] {
    const root: DirectoryNode = { dirs: new Map(), files: [] };

    for (const directory of directoryItems) {
      let node = root;
      for (const part of directory.relative_path.split("/").filter(Boolean)) {
        if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
        node = node.dirs.get(part)!;
      }
    }

    for (const file of items) {
      const parts = file.relative_path.split("/");
      let node = root;
      for (const part of parts.slice(0, -1)) {
        if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
        node = node.dirs.get(part)!;
      }
      node.files.push(file);
    }

    const rows: TreeRow[] = [];
    const walk = (node: DirectoryNode, depth: number, parentPath: string) => {
      for (const [name, child] of [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const key = parentPath ? `${parentPath}/${name}` : name;
        const isExpanded = expanded[key] ?? true;
        rows.push({ type: "dir", key, name, depth, expanded: isExpanded });
        if (isExpanded) walk(child, depth + 1, key);
      }

      for (const file of [...node.files].sort((a, b) => a.name.localeCompare(b.name))) {
        const isExpanded = expanded[file.relative_path] ?? false;
        rows.push({ type: "file", key: file.relative_path, file, depth, expanded: isExpanded });
        if (isExpanded) {
          for (const testName of file.tests) {
            rows.push({
              type: "test",
              key: `${file.relative_path}#${testName}`,
              file,
              name: testName,
              depth: depth + 1,
            });
          }
        }
      }
    };

    walk(root, 1, "");
    return rows;
  }

  function projectKey(path: string) {
    return `project:${path}`;
  }

  function projectName(project: ProjectEntry) {
    if (project.display_name?.trim()) return project.display_name;
    const path = project.root;
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || path || "Repository";
  }

  function expandDefaultTree() {
    const next = { ...expandedTree };
    for (const file of files) {
      const parts = file.relative_path.split("/");
      let path = "";
      for (const part of parts.slice(0, -1)) {
        path = path ? `${path}/${part}` : part;
        next[path] = true;
      }
    }
    expandedTree = next;
  }

  function toggleTree(key: string, expanded: boolean) {
    expandedTree = { ...expandedTree, [key]: !expanded };
  }

  function setSidebarCollapsed(collapsed: boolean) {
    sidebarCollapsed = collapsed;
    if (!collapsed) collapsedTreeOpen = false;
    saveUiState({ sidebarCollapsed: collapsed });
  }

  function focusOnMount(node: HTMLInputElement) {
    requestAnimationFrame(() => {
      node.focus();
      node.select();
    });
  }

  function runDirectory(path: string) {
    void runYapitest(path);
  }

  function runFile(file: FileEntry) {
    void runYapitest(file.relative_path);
  }

  function runTreeTest(file: FileEntry, testName: string) {
    void runYapitest(file.relative_path, testName);
  }

  function runProject(path: string) {
    void runYapitest(undefined, undefined, path);
  }

  function openProjectMenu(event: MouseEvent, path: string) {
    if (shouldUseNativeContextMenu(event.target)) return;
    event.preventDefault();
    treeMenu = { type: "project", path, left: event.clientX, top: event.clientY };
  }

  function openDirectoryMenu(event: MouseEvent, path: string) {
    if (shouldUseNativeContextMenu(event.target)) return;
    event.preventDefault();
    treeMenu = { type: "dir", path, left: event.clientX, top: event.clientY };
  }

  function openFileMenu(event: MouseEvent, file: FileEntry) {
    if (shouldUseNativeContextMenu(event.target)) return;
    event.preventDefault();
    treeMenu = { type: "file", file, left: event.clientX, top: event.clientY };
  }

  function openTestMenu(event: MouseEvent, file: FileEntry, name: string) {
    if (shouldUseNativeContextMenu(event.target)) return;
    event.preventDefault();
    treeMenu = { type: "test", file, name, left: event.clientX, top: event.clientY };
  }

  async function removeSavedProject(path: string) {
    projects = await call<ProjectEntry[]>("remove_project", { root: path });
    treeMenu = { type: "none", left: 0, top: 0 };
    if (rootPath === path) {
      rootPath = "";
      directories = [];
      files = [];
      selected = null;
      selectedRelativePath = "";
      selectedTestKey = "";
      if (projects.length > 0) await loadProject(projects[projects.length - 1].root);
      else saveUiState({ rootPath: null, relativePath: null, testName: null });
    }
  }

  function selectFromCollapsedTree() {
    if (sidebarCollapsed) collapsedTreeOpen = false;
  }

  function toggleTreeFile(file: FileEntry, expanded: boolean) {
    if (file.tests.length > 0) {
      toggleTree(file.relative_path, expanded);
      return;
    }
    selectFromCollapsedTree();
    void selectFile(file);
  }

  function startProjectRename(project: ProjectEntry) {
    cancelProjectLongPress();
    treeMenu = { type: "none", left: 0, top: 0 };
    renamingProject = { path: project.root, name: projectName(project) };
  }

  async function saveProjectRename() {
    if (!renamingProject.path) return;
    projects = await call<ProjectEntry[]>("rename_project", {
      root: renamingProject.path,
      displayName: renamingProject.name,
    });
    renamingProject = { path: "", name: "" };
  }

  function cancelProjectRename() {
    renamingProject = { path: "", name: "" };
  }

  function startTreeRename(path: string) {
    treeMenu = { type: "none", left: 0, top: 0 };
    renamingTreePath = { from: path, name: baseName(path) };
  }

  async function saveTreeRename() {
    if (!renamingTreePath.from) return;

    const from = renamingTreePath.from;
    const requested = renamingTreePath.name.trim();
    renamingTreePath = { from: "", name: "" };
    if (!requested) return;

    const to = requested.includes("/") || requested.includes("\\") ? cleanRelativePath(requested) : joinPath(parentPath(from), requested);
    if (!to || to === from) return;

    await performTreeRename(from, to);
  }

  function cancelTreeRename() {
    renamingTreePath = { from: "", name: "" };
  }

  function startProjectLongPress(event: PointerEvent, project: ProjectEntry) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    cancelProjectLongPress();
    projectLongPressTimer = setTimeout(() => {
      suppressProjectClickPath = project.root;
      startProjectRename(project);
    }, 600);
  }

  function cancelProjectLongPress() {
    if (!projectLongPressTimer) return;
    clearTimeout(projectLongPressTimer);
    projectLongPressTimer = null;
  }

  function handleProjectClick(project: ProjectEntry) {
    if (suppressProjectClickPath === project.root) {
      suppressProjectClickPath = "";
      return;
    }
    selectFromCollapsedTree();
    void loadProject(project.root);
  }

  const cleanRelativePath = (path: string) =>
    path
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");

  function parentPath(path: string) {
    return path.split("/").slice(0, -1).join("/");
  }

  function baseName(path: string) {
    const parts = path.split("/").filter(Boolean);
    return parts[parts.length - 1] || path;
  }

  function joinPath(parent: string, child: string) {
    return [parent, child].filter(Boolean).join("/");
  }

  function fileNameToTestName(name: string) {
    return name.replace(/\.(ya?ml)$/i, "").replace(/[^a-zA-Z0-9_-]+/g, "-") || "new-api-test";
  }

  function nextTestName(file: FileEntry) {
    const existing = new Set(file.tests);
    let index = file.tests.length + 1;
    let name = "new-api-test";
    while (existing.has(name)) {
      name = `new-api-test-${index}`;
      index += 1;
    }
    return name;
  }

  function newTestDraft(testName: string): TestDraft {
    return {
      testName,
      setupName: "",
      cleanupName: "",
      steps: [newRequestStep()],
    };
  }

  async function createTreeDirectory(parent = "") {
    const initial = joinPath(parent, "new-directory");
    const requested = window.prompt("Directory path", initial);
    const relativePath = requested ? cleanRelativePath(requested) : "";
    if (!relativePath) return;
    await call("create_directory", { root: rootPath.trim(), relativePath });
    expandedTree = { ...expandedTree, [parent]: true, [relativePath]: true };
    treeMenu = { type: "none", left: 0, top: 0 };
    await refreshRepositoryTree();
    message = `Created ${relativePath}`;
  }

  async function createTreeTestFile(parent = "") {
    const initial = joinPath(parent, "new-test.yaml");
    const requested = window.prompt("Test file path", initial);
    const relativePath = requested ? cleanRelativePath(requested) : "";
    if (!relativePath) return;
    const testName = fileNameToTestName(baseName(relativePath));
    await call("create_test_file", {
      root: rootPath.trim(),
      relativePath,
      contents: `${buildTestYaml(newTestDraft(testName)).trimEnd()}\n`,
    });
    expandedTree = { ...expandedTree, [parentPath(relativePath)]: true, [relativePath]: true };
    treeMenu = { type: "none", left: 0, top: 0 };
    await refreshRepositoryTree();
    const file = files.find((item) => item.relative_path === relativePath);
    if (file) await selectTest(file, testName);
    message = `Created ${relativePath}`;
  }

  async function performTreeRename(from: string, to: string) {
    const selectedPath = selected?.relative_path || "";
    await call("rename_path", { root: rootPath.trim(), from, to });
    treeMenu = { type: "none", left: 0, top: 0 };
    expandedTree = Object.fromEntries(
      Object.entries(expandedTree).map(([key, value]) => [
        key === from || key.startsWith(`${from}/`) ? `${to}${key.slice(from.length)}` : key,
        value,
      ]),
    );
    if (selectedPath === from || selectedPath.startsWith(`${from}/`)) {
      selected = null;
      selectedRelativePath = "";
      selectedTestKey = "";
      editingTest = null;
    }
    await refreshRepositoryTree();
    const renamedSelectedPath =
      selectedPath === from || selectedPath.startsWith(`${from}/`) ? `${to}${selectedPath.slice(from.length)}` : to;
    const renamedFile = files.find((item) => item.relative_path === renamedSelectedPath);
    if (renamedFile) await selectFile(renamedFile);
    message = `Renamed ${from} to ${to}`;
  }

  function renameTreePath(path: string) {
    startTreeRename(path);
  }

  async function deleteTreePath(path: string) {
    const confirmed = window.confirm(`Delete ${path} from disk? This cannot be undone.`);
    if (!confirmed) return;

    const selectedPath = selected?.relative_path || "";
    await call("delete_path", { root: rootPath.trim(), relativePath: path });
    treeMenu = { type: "none", left: 0, top: 0 };

    if (selectedPath === path || selectedPath.startsWith(`${path}/`)) {
      selected = null;
      selectedRelativePath = "";
      selectedTestKey = "";
      editingTest = null;
      editor = "";
      original = "";
    }

    await refreshRepositoryTree();
    if (!selected && files.length > 0) await selectFile(files[0]);
    else if (!selected) saveUiState({ relativePath: null, testName: null });
    message = `Deleted ${path}`;
  }

  async function deleteTreeTest(file: FileEntry, testName: string) {
    const confirmed = window.confirm(`Delete test "${testName}" from ${file.relative_path}? This cannot be undone.`);
    if (!confirmed) return;

    const contents = await call<string>("read_yaml_file", {
      root: rootPath.trim(),
      relativePath: file.relative_path,
    });
    const nextContents = removeTestDraft(contents, testName);
    if (nextContents === null) {
      message = `Could not find ${testName} in ${file.relative_path}`;
      return;
    }

    await call("write_yaml_file", {
      root: rootPath.trim(),
      relativePath: file.relative_path,
      contents: nextContents,
    });
    treeMenu = { type: "none", left: 0, top: 0 };

    if (selectedTestKey === `${file.relative_path}#${testName}`) {
      selectedTestKey = "";
      editingTest = null;
      selected = null;
      selectedRelativePath = "";
      editor = "";
      original = "";
    }

    await refreshRepositoryTree();
    const updatedFile = files.find((item) => item.relative_path === file.relative_path);
    if (updatedFile) await selectFile(updatedFile);
    message = `Deleted ${testName} from ${file.relative_path}`;
  }

  async function addTestToFile(file: FileEntry) {
    const requested = window.prompt("Test name", nextTestName(file));
    const testName = requested?.trim() || "";
    if (!testName) return;
    const contents = await call<string>("read_yaml_file", {
      root: rootPath.trim(),
      relativePath: file.relative_path,
    });
    const nextContents = `${contents.trimEnd()}\n\n${buildTestYaml(newTestDraft(testName)).trimEnd()}\n`;
    await call("write_yaml_file", {
      root: rootPath.trim(),
      relativePath: file.relative_path,
      contents: nextContents,
    });
    expandedTree = { ...expandedTree, [file.relative_path]: true };
    treeMenu = { type: "none", left: 0, top: 0 };
    await refreshRepositoryTree();
    const updatedFile = files.find((item) => item.relative_path === file.relative_path);
    if (updatedFile) await selectTest(updatedFile, testName);
    message = `Added ${testName} to ${file.relative_path}`;
  }

  async function selectTest(file: FileEntry, testName: string) {
    selectFromCollapsedTree();
    selected = file;
    selectedRelativePath = file.relative_path;
    selectedTestKey = `${file.relative_path}#${testName}`;
    const contents = await call<string>("read_yaml_file", {
      root: rootPath.trim(),
      relativePath: file.relative_path,
    });
    const parsed = parseTestDraft(contents, testName);
    if (!parsed) {
      editor = contents;
      original = contents;
      view = "yaml";
      message = `Could not load ${testName} into the builder. Opened ${file.relative_path} as YAML.`;
      return;
    }

    draft = parsed;
    editingTest = { file, originalName: testName };
    editor = buildTestYaml(parsed);
    original = editor;
    view = "builder";
    saveUiState({
      rootPath,
      relativePath: file.relative_path,
      testName,
    });
  }

  async function refreshCatalog() {
    const catalogs: ReferenceCatalog[] = [];
    for (const file of files) {
      const contents = await call<string>("read_yaml_file", {
        root: rootPath.trim(),
        relativePath: file.relative_path,
      });
      const references = extractReferenceCatalog(contents);
      if (
        references.vars.length > 0 ||
        references.urls.length > 0 ||
        references.stepSets.length > 0 ||
        references.outputs.length > 0
      ) {
        catalogs.push(references);
      }
    }
    catalog = catalogs.length > 0 ? mergeCatalogs(catalogs) : emptyCatalog;
  }

  async function selectFile(file: FileEntry) {
    selected = file;
    selectedRelativePath = file.relative_path;
    selectedTestKey = "";
    editingTest = null;
    const contents = await call<string>("read_yaml_file", {
      root: rootPath.trim(),
      relativePath: file.relative_path,
    });
    editor = contents;
    original = editor;
    if (file.kind === "config") {
      configDraft = parseConfigDraft(contents);
      view = "config";
    } else {
      view = "yaml";
    }
    saveUiState({
      rootPath,
      relativePath: file.relative_path,
      testName: null,
    });
  }

  async function save() {
    if (!selected) return;
    const contents = view === "config" ? generatedConfigYaml : editor;
    await call("write_yaml_file", {
      root: rootPath.trim(),
      relativePath: selected.relative_path,
      contents,
    });
    editor = contents;
    original = contents;
    await scan();
    message = `Saved ${selected.relative_path}`;
  }

  async function saveDraft() {
    if (editingTest) {
      const contents = await call<string>("read_yaml_file", {
        root: rootPath.trim(),
        relativePath: editingTest.file.relative_path,
      });
      const updated = replaceTestDraft(contents, editingTest.originalName, draft);
      if (!updated) {
        message = `Could not update ${editingTest.originalName} in ${editingTest.file.relative_path}`;
        return editingTest.file.relative_path;
      }
      await call("write_yaml_file", {
        root: rootPath.trim(),
        relativePath: editingTest.file.relative_path,
        contents: updated,
      });
      const activeFilePath = editingTest.file.relative_path;
      const currentName = draft.testName.trim() || "new-api-test";
      await scan();
      const file = files.find((item) => item.relative_path === activeFilePath);
      if (file) {
        selected = file;
        selectedRelativePath = file.relative_path;
        editingTest = { file, originalName: currentName };
      }
      editor = buildTestYaml(draft);
      original = editor;
      view = "builder";
      saveUiState({
        rootPath,
        relativePath: activeFilePath,
        testName: currentName,
      });
      message = `Saved ${currentName} in ${activeFilePath}`;
      return activeFilePath;
    }

    message = "Select a test from an existing YAML file before saving or running it.";
    return null;
  }

  function showBuilder() {
    const activeFile = selected || files.find((file) => file.relative_path === currentUiState().relativePath);
    if (activeFile?.kind === "config") {
      selected = activeFile;
      selectedRelativePath = activeFile.relative_path;
      showConfig();
      return;
    }
    if (view === "builder") return;
    selected = null;
    selectedRelativePath = "";
    selectedTestKey = "";
    editingTest = null;
    editor = generatedYaml;
    original = generatedYaml;
    view = "builder";
  }

  async function showYaml() {
    if (editingTest) {
      await selectFile(editingTest.file);
      return;
    }
    view = "yaml";
  }

  function showConfig() {
    if (!selected || selected.kind !== "config") return;
    configDraft = parseConfigDraft(editor || original);
    view = "config";
  }

  const newVariable = (overrides: Partial<VariableDraft> = {}): VariableDraft => ({
    id: crypto.randomUUID(),
    name: "",
    env: "",
    defaultValue: "",
    ...overrides,
  });

  const newUrl = (overrides: Partial<UrlDraft> = {}): UrlDraft => ({
    id: crypto.randomUUID(),
    name: "",
    value: "",
    ...overrides,
  });

  const newOutput = (overrides: Partial<OutputDraft> = {}): OutputDraft => ({
    id: crypto.randomUUID(),
    name: "",
    value: "",
    ...overrides,
  });

  const newStepSet = (overrides: Partial<StepSetDraft> = {}): StepSetDraft => ({
    id: crypto.randomUUID(),
    name: "",
    once: false,
    collapsed: false,
    steps: [newRequestStep()],
    outputs: [],
    ...overrides,
  });

  function addConfigVar() {
    configDraft.vars = [...configDraft.vars, newVariable()];
  }

  function removeConfigVar(id: string) {
    configDraft.vars = configDraft.vars.filter((item) => item.id !== id);
  }

  function addConfigUrl() {
    configDraft.urls = [...configDraft.urls, newUrl()];
  }

  function removeConfigUrl(id: string) {
    configDraft.urls = configDraft.urls.filter((item) => item.id !== id);
  }

  function addStepSet() {
    configDraft.stepSets = [...configDraft.stepSets, newStepSet({ name: `step-set-${configDraft.stepSets.length + 1}` })];
  }

  function removeStepSet(id: string) {
    configDraft.stepSets = configDraft.stepSets.filter((item) => item.id !== id);
  }

  function toggleStepSet(stepSet: StepSetDraft) {
    stepSet.collapsed = !stepSet.collapsed;
    configDraft.stepSets = [...configDraft.stepSets];
  }

  function addStepSetStep(stepSet: StepSetDraft) {
    stepSet.steps = [...stepSet.steps, newRequestStep({ stepId: `step-${stepSet.steps.length + 1}` })];
    configDraft.stepSets = [...configDraft.stepSets];
  }

  function removeStepSetStep(stepSet: StepSetDraft, uid: string) {
    if (stepSet.steps.length === 1) return;
    stepSet.steps = stepSet.steps.filter((step) => step.uid !== uid);
    configDraft.stepSets = [...configDraft.stepSets];
  }

  function addStepSetOutput(stepSet: StepSetDraft) {
    stepSet.outputs = [...stepSet.outputs, newOutput()];
    configDraft.stepSets = [...configDraft.stepSets];
  }

  function removeStepSetOutput(stepSet: StepSetDraft, id: string) {
    stepSet.outputs = stepSet.outputs.filter((output) => output.id !== id);
    configDraft.stepSets = [...configDraft.stepSets];
  }

  async function runYapitest(target?: string, testName?: string, rootOverride?: string) {
    testRunning = true;
    runResult = null;
    runResult = await call<RunResult>("run_yapitest", {
      root: (rootOverride || rootPath).trim(),
      target: target || null,
      testName: testName || null,
    });
    testRunning = false;
  }

  function handleNavigate(e: CustomEvent<{ filePath: string; testName: string }>) {
    const file = files.find((f) => f.relative_path === e.detail.filePath);
    if (file) {
      void selectTest(file, e.detail.testName).then(() => {
        workspaceContent?.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
  }

  async function runDraft() {
    const relativePath = await saveDraft();
    if (!relativePath) return;
    await runYapitest(relativePath, draft.testName.trim() || "new-api-test");
  }

  async function runCurrentTest() {
    runMenu = { open: false, left: 0, top: 0 };
    await runDraft();
  }

  async function runCurrentYamlFile() {
    runMenu = { open: false, left: 0, top: 0 };
    const relativePath = selected?.relative_path || editingTest?.file.relative_path || "";
    if (!relativePath) {
      message = "Select a YAML file before running it.";
      return;
    }
    await runYapitest(relativePath);
  }

  async function runCurrentProject() {
    runMenu = { open: false, left: 0, top: 0 };
    if (!rootPath) {
      message = "Open a project before running it.";
      return;
    }
    await runYapitest(undefined, undefined, rootPath);
  }

  function openRunMenu(event: MouseEvent) {
    if (shouldUseNativeContextMenu(event.target)) return;
    event.preventDefault();
    runMenu = { open: true, left: event.clientX, top: event.clientY };
  }

  function touchDraft() {
    draft.steps = [...draft.steps];
  }

  function touchConfigDraft() {
    configDraft.stepSets = [...configDraft.stepSets];
  }

  function addStep() {
    draft.steps = [...draft.steps, newRequestStep({ stepId: `step-${draft.steps.length + 1}` })];
  }

  function removeStep(uid: string) {
    if (draft.steps.length === 1) return;
    draft.steps = draft.steps.filter((step) => step.uid !== uid);
  }

  function toggleStep(step: StepDraft) {
    step.collapsed = !step.collapsed;
    draft.steps = [...draft.steps];
    configDraft.stepSets = [...configDraft.stepSets];
  }

  function toggleStepSection(
    step: StepDraft,
    field: "headersCollapsed" | "bodyCollapsed" | "assertionsCollapsed" | "optionsCollapsed",
  ) {
    step[field] = !step[field];
    draft.steps = [...draft.steps];
    configDraft.stepSets = [...configDraft.stepSets];
  }

  function moveStep(fromUid: string, toUid: string) {
    if (!fromUid || !toUid || fromUid === toUid) return;
    const next = [...draft.steps];
    const from = next.findIndex((step) => step.uid === fromUid);
    const to = next.findIndex((step) => step.uid === toUid);
    if (from === -1 || to === -1) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    draft.steps = next;
  }

  function onDragStart(event: DragEvent, uid: string) {
    draggingStepUid = uid;
    event.dataTransfer?.setData("text/plain", uid);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(event: DragEvent, uid: string) {
    event.preventDefault();
    dragOverStepUid = uid;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function onDrop(event: DragEvent, uid: string) {
    event.preventDefault();
    moveStep(event.dataTransfer?.getData("text/plain") || draggingStepUid, uid);
    draggingStepUid = "";
    dragOverStepUid = "";
  }

  function onDragEnd() {
    draggingStepUid = "";
    dragOverStepUid = "";
  }

  function addHeader(step: StepDraft) {
    step.headers = [...step.headers, { id: crypto.randomUUID(), name: "", value: "" }];
    draft.steps = [...draft.steps];
    configDraft.stepSets = [...configDraft.stepSets];
  }

  function removeHeader(step: StepDraft, id: string) {
    step.headers = step.headers.filter((header) => header.id !== id);
    draft.steps = [...draft.steps];
    configDraft.stepSets = [...configDraft.stepSets];
  }

  function addAssertionHeader(step: StepDraft) {
    step.assertionHeaders = [
      ...step.assertionHeaders,
      { id: crypto.randomUUID(), name: "", value: "" },
    ];
    draft.steps = [...draft.steps];
    configDraft.stepSets = [...configDraft.stepSets];
  }

  function removeAssertionHeader(step: StepDraft, id: string) {
    step.assertionHeaders = step.assertionHeaders.filter((header) => header.id !== id);
    draft.steps = [...draft.steps];
    configDraft.stepSets = [...configDraft.stepSets];
  }

  function tokenAtCaret(value: string, caret: number) {
    const beforeCaret = value.slice(0, caret);
    const start = beforeCaret.lastIndexOf("$");
    if (start === -1) return null;

    const token = beforeCaret.slice(start);
    if (/[\s"'{}[\],]/.test(token)) return null;

    return { start, token: token.toLowerCase() };
  }

  function matchesForToken(value: string, caret: number) {
    const activeToken = tokenAtCaret(value, caret);
    if (!activeToken) return [];
    return suggestions
      .filter((suggestion) => suggestion.toLowerCase().startsWith(activeToken.token))
      .slice(0, 8);
  }

  function positionForToken(input: HTMLInputElement | HTMLTextAreaElement, tokenStart: number) {
    const wrapper = input.closest(".suggest-wrap") as HTMLElement | null;
    if (!wrapper) return { left: 0, top: input.offsetHeight + 4 };

    const inputStyle = window.getComputedStyle(input);
    const mirror = document.createElement("div");
    const marker = document.createElement("span");

    mirror.style.position = "fixed";
    mirror.style.visibility = "hidden";
    mirror.style.left = `${input.getBoundingClientRect().left}px`;
    mirror.style.top = `${input.getBoundingClientRect().top}px`;
    mirror.style.width = `${input.getBoundingClientRect().width}px`;
    mirror.style.boxSizing = inputStyle.boxSizing;
    mirror.style.border = inputStyle.border;
    mirror.style.padding = inputStyle.padding;
    mirror.style.font = inputStyle.font;
    mirror.style.letterSpacing = inputStyle.letterSpacing;
    mirror.style.lineHeight = inputStyle.lineHeight;
    mirror.style.whiteSpace = input instanceof HTMLTextAreaElement ? "pre-wrap" : "pre";
    mirror.style.overflowWrap = "break-word";

    mirror.textContent = input.value.slice(0, tokenStart);
    marker.textContent = "$";
    mirror.append(marker);
    document.body.append(mirror);

    const markerRect = marker.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const lineHeight = Number.parseFloat(inputStyle.lineHeight) || 18;
    const position = {
      left: Math.max(0, markerRect.left - wrapperRect.left - input.scrollLeft),
      top: Math.max(0, markerRect.top - wrapperRect.top - input.scrollTop + lineHeight + 4),
    };

    mirror.remove();
    return position;
  }

  function updateSuggestionMenu(event: Event, key: string) {
    const input = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
    focusedKey = key;

    const caret = input.selectionStart ?? input.value.length;
    const activeToken = tokenAtCaret(input.value, caret);
    const items = matchesForToken(input.value, caret);

    if (!activeToken || items.length === 0) {
      if (suggestionMenu.key === key) closeSuggestions();
      return;
    }

    const position = positionForToken(input, activeToken.start);
    suggestionMenu = {
      key,
      index: suggestionMenu.key === key ? Math.min(suggestionMenu.index, items.length - 1) : 0,
      left: position.left,
      top: position.top,
      items,
    };
  }

  function closeSuggestions() {
    suggestionMenu = { key: "", index: 0, left: 0, top: 0, items: [] };
  }

  function replaceToken(current: string, suggestion: string, caret: number) {
    const activeToken = tokenAtCaret(current, caret);
    if (!activeToken) return { value: `${current}${suggestion}`, caret: current.length + suggestion.length };

    const value = `${current.slice(0, activeToken.start)}${suggestion}${current.slice(caret)}`;
    return { value, caret: activeToken.start + suggestion.length };
  }

  function restoreCaret(caret: number) {
    const input = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    window.setTimeout(() => {
      input?.focus();
      input?.setSelectionRange(caret, caret);
    });
  }

  function insertStepSuggestion(step: StepDraft, field: "path" | "body" | "url", value: string) {
    const input = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const caret = input?.selectionStart ?? step[field].length;
    const next = replaceToken(step[field], value, caret);
    step[field] = next.value;
    draft.steps = [...draft.steps];
    closeSuggestions();
    restoreCaret(next.caret);
  }

  function insertResponseBodySuggestion(step: StepDraft, value: string) {
    const input = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const caret = input?.selectionStart ?? step.responseBody.length;
    const next = replaceToken(step.responseBody, value, caret);
    step.responseBody = next.value;
    draft.steps = [...draft.steps];
    closeSuggestions();
    restoreCaret(next.caret);
  }

  function insertHeaderSuggestion(header: { value: string }, value: string) {
    const input = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const caret = input?.selectionStart ?? header.value.length;
    const next = replaceToken(header.value, value, caret);
    header.value = next.value;
    draft.steps = [...draft.steps];
    closeSuggestions();
    restoreCaret(next.caret);
  }

  function insertConfigValueSuggestion(item: { value: string }, value: string) {
    const input = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const caret = input?.selectionStart ?? item.value.length;
    const next = replaceToken(item.value, value, caret);
    item.value = next.value;
    configDraft = { ...configDraft };
    closeSuggestions();
    restoreCaret(next.caret);
  }

  function handleSuggestionKeydown(
    event: KeyboardEvent,
    key: string,
    insert: (suggestion: string) => void,
  ) {
    const openedMenu = event.key === "ArrowDown" && suggestionMenu.key !== key;
    if (event.key === "ArrowDown" && suggestionMenu.key !== key) {
      updateSuggestionMenu(event, key);
    }

    if (suggestionMenu.key !== key || suggestionMenu.items.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (openedMenu) return;
      suggestionMenu = {
        ...suggestionMenu,
        index: (suggestionMenu.index + 1) % suggestionMenu.items.length,
      };
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      suggestionMenu = {
        ...suggestionMenu,
        index: (suggestionMenu.index - 1 + suggestionMenu.items.length) % suggestionMenu.items.length,
      };
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      insert(suggestionMenu.items[suggestionMenu.index]);
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeSuggestions();
    }
  }

  function buildSuggestions(test: TestDraft, references: ReferenceCatalog) {
    const stepTokens = test.steps
      .filter((step) => step.type === "request" && step.stepId.trim())
      .flatMap((step) => [
        `$${step.stepId.trim()}.response`,
        `$${step.stepId.trim()}.response.id`,
        `$${step.stepId.trim()}.response.token`,
        `$${step.stepId.trim()}.data`,
      ]);

    return [
      ...references.vars,
      ...references.urls,
      ...references.outputs,
      "$setup.token",
      "$setup.user-id",
      ...stepTokens,
    ];
  }

  function buildConfigSuggestions(config: ConfigDraft, references: ReferenceCatalog) {
    const vars = config.vars.filter((item) => item.name.trim()).map((item) => `$vars.${item.name.trim()}`);
    const urls = config.urls.filter((item) => item.name.trim()).map((item) => `$urls.${item.name.trim()}`);
    const outputs = config.stepSets.flatMap((stepSet) =>
      stepSet.outputs
        .filter((output) => stepSet.name.trim() && output.name.trim())
        .map((output) => `$${stepSet.name.trim()}.${output.name.trim()}`),
    );

    return [...new Set([...vars, ...urls, ...outputs, ...references.vars, ...references.urls, ...references.outputs])].sort();
  }
</script>

<div class="app-frame">
  <header class="titlebar" class:mac-titlebar={isMac}>
    {#if isMac}
      <div class="window-controls mac-window-controls" aria-label="Window controls">
        <button class="window-control close-control" on:click={closeWindow} aria-label="Close window" title="Close">
          <span aria-hidden="true"></span>
        </button>
        <button class="window-control minimize-control" on:click={minimizeWindow} aria-label="Minimize window" title="Minimize">
          <span aria-hidden="true"></span>
        </button>
        <button class="window-control maximize-control" on:click={toggleWindowMaximize} aria-label="Maximize window" title="Maximize">
          <span aria-hidden="true"></span>
        </button>
      </div>
    {/if}
    <button
      class="titlebar-drag"
      on:mousedown={startWindowDrag}
      on:dblclick={toggleWindowMaximize}
      aria-label="Move window"
    >
      <span class="titlebar-brand">
        <img src="/YapperLogoAlpha.png" alt="Yapper" class="titlebar-logo" />
      </span>
      <span class="titlebar-context">
        {#if rootPath}
          <span>{rootPath}</span>
        {:else}
          <span>No repository open</span>
        {/if}
      </span>
    </button>
    {#if !isMac}
      <div class="window-controls" aria-label="Window controls">
        <button class="window-control" on:click={minimizeWindow} aria-label="Minimize window" title="Minimize">
          <Minus size={15} />
        </button>
        <button class="window-control" on:click={toggleWindowMaximize} aria-label="Maximize window" title="Maximize">
          <Maximize size={14} />
        </button>
        <button class="window-control close-control" on:click={closeWindow} aria-label="Close window" title="Close">
          <X size={15} />
        </button>
      </div>
    {/if}
  </header>

<main class="shell" class:sidebar-collapsed={sidebarCollapsed}>
  <aside class="sidebar" aria-label="Repository browser">
    {#if sidebarCollapsed}
      <div class="collapsed-rail">
        <img src="/YapperLogoAlpha.png" alt="" class="rail-logo" aria-hidden="true" />
        <button
          class="icon-button rail-button"
          on:click={() => setSidebarCollapsed(false)}
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <PanelLeftOpen size={18} />
        </button>
        <button
          class="icon-button rail-button run-button"
          on:click={runCurrentTest}
          on:contextmenu={openRunMenu}
          disabled={busy || !rootPath}
          aria-label="Run current test"
          title="Run current test"
        >
          <Play size={18} />
        </button>
        <button
          class="icon-button rail-button"
          on:click={chooseRoot}
          disabled={busy}
          aria-label="Open project"
          title="Open project"
        >
          <FolderOpen size={18} />
        </button>
        <button
          class="icon-button rail-button"
          class:active={collapsedTreeOpen}
          on:click={() => (collapsedTreeOpen = !collapsedTreeOpen)}
          aria-label="Show tree view"
          title="Show tree view"
        >
          <FolderTree size={18} />
        </button>
      </div>
    {:else}
      <div class="sidebar-head">
        <div class="brand">
          <div>
            <h1>Yapper</h1>
          </div>
        </div>
        <button
          class="icon-button"
          on:click={() => setSidebarCollapsed(true)}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          <PanelLeftClose size={18} />
        </button>
      </div>
    {/if}

    {#if !sidebarCollapsed || collapsedTreeOpen}
      <div class="sidebar-body" class:tree-popout={sidebarCollapsed}>
        <button class="open-root-button" on:click={chooseRoot} disabled={busy}>Open</button>

        <input class="search" bind:value={filter} placeholder="Filter YAML files" />

        <nav class="file-tree" aria-label="YAML files">
          {#if projects.length === 0}
            <div class="empty-tree">No Projects Found</div>
          {:else}
            {#each projects as project (project.root)}
              {@const projectExpanded = expandedTree[projectKey(project.root)] ?? true}
              {@const isRenamingProject = renamingProject.path === project.root}
              <div
                class="tree-row tree-root-row"
                class:active={rootPath === project.root && !selected}
                role="treeitem"
                aria-selected={rootPath === project.root && !selected}
                style:padding-left="4px"
                tabindex="-1"
                on:contextmenu={(event) => openProjectMenu(event, project.root)}
                on:pointerdown={(event) => startProjectLongPress(event, project)}
                on:pointerup={cancelProjectLongPress}
                on:pointercancel={cancelProjectLongPress}
                on:pointerleave={cancelProjectLongPress}
              >
                <button
                  class="tree-toggle"
                  aria-label={projectExpanded ? "Collapse repository" : "Expand repository"}
                  aria-expanded={projectExpanded}
                  on:click={() => {
                    if (rootPath !== project.root) void loadProject(project.root);
                    toggleTree(projectKey(project.root), projectExpanded);
                  }}
                >
                  {#if projectExpanded}
                    <ChevronDown size={14} />
                  {:else}
                    <ChevronRight size={14} />
                  {/if}
                </button>
                <FolderTree size={15} />
                {#if isRenamingProject}
                  <input
                    class="tree-rename-input"
                    bind:value={renamingProject.name}
                    aria-label="Project name"
                    on:click|stopPropagation
                    on:pointerdown|stopPropagation
                    on:blur={saveProjectRename}
                    on:keydown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      } else if (event.key === "Escape") {
                        cancelProjectRename();
                      }
                    }}
                    use:focusOnMount
                  />
                {:else}
                  <button
                    class="tree-label"
                    on:click={() => handleProjectClick(project)}
                    on:dblclick|stopPropagation={() => startProjectRename(project)}
                  >
                    <span>{projectName(project)}</span>
                  </button>
                {/if}
                <button
                  class="tree-run-button"
                  on:click|stopPropagation={() => runProject(project.root)}
                  disabled={busy}
                  aria-label="Run all tests"
                  title="Run all tests"
                >
                  <Play size={14} />
                </button>
              </div>

              {#if rootPath === project.root && projectExpanded}
                {#each treeRows as row (row.key)}
                  {#if row.type === "dir"}
                    {@const isRenamingPath = renamingTreePath.from === row.key}
                    <div
                      class="tree-row"
                      role="treeitem"
                      aria-selected="false"
                      tabindex="-1"
                      style:padding-left={`${row.depth * 16 + 4}px`}
                      on:contextmenu={(event) => openDirectoryMenu(event, row.key)}
                    >
                      <button
                        class="tree-toggle"
                        aria-label={row.expanded ? "Collapse folder" : "Expand folder"}
                        aria-expanded={row.expanded}
                        on:click={() => toggleTree(row.key, row.expanded)}
                      >
                        {#if row.expanded}
                          <ChevronDown size={14} />
                        {:else}
                          <ChevronRight size={14} />
                        {/if}
                      </button>
                      {#if row.expanded}
                        <FolderOpen size={15} />
                      {:else}
                        <Folder size={15} />
                      {/if}
                      {#if isRenamingPath}
                        <input
                          class="tree-rename-input"
                          bind:value={renamingTreePath.name}
                          aria-label="Directory name"
                          on:click|stopPropagation
                          on:pointerdown|stopPropagation
                          on:blur={saveTreeRename}
                          on:keydown={(event) => {
                            if (event.key === "Enter") {
                              event.currentTarget.blur();
                            } else if (event.key === "Escape") {
                              cancelTreeRename();
                            }
                          }}
                          use:focusOnMount
                        />
                      {:else}
                        <button
                          class="tree-label"
                          on:click={() => toggleTree(row.key, row.expanded)}
                          on:dblclick|stopPropagation={() => startTreeRename(row.key)}
                        >
                          <span>{row.name}</span>
                        </button>
                      {/if}
                      <button
                        class="tree-run-button"
                        on:click|stopPropagation={() => runDirectory(row.key)}
                        disabled={busy || !rootPath}
                        aria-label={`Run tests in ${row.name}`}
                        title={`Run tests in ${row.name}`}
                      >
                        <Play size={14} />
                      </button>
                    </div>
                  {:else if row.type === "file"}
                    {@const isRenamingPath = renamingTreePath.from === row.file.relative_path}
                    <div
                      class="tree-row"
                      class:active={selected?.relative_path === row.file.relative_path && !selectedTestKey}
                      role="treeitem"
                      aria-selected={selected?.relative_path === row.file.relative_path && !selectedTestKey}
                      tabindex="-1"
                      style:padding-left={`${row.depth * 16 + 4}px`}
                      on:contextmenu={(event) => openFileMenu(event, row.file)}
                    >
                      {#if row.file.tests.length}
                        <button
                          class="tree-toggle"
                          aria-label={row.expanded ? "Collapse file tests" : "Expand file tests"}
                          aria-expanded={row.expanded}
                          on:click|stopPropagation={() => toggleTree(row.key, row.expanded)}
                        >
                          {#if row.expanded}
                            <ChevronDown size={14} />
                          {:else}
                            <ChevronRight size={14} />
                          {/if}
                        </button>
                      {:else}
                        <span class="tree-spacer"></span>
                      {/if}
                      <FileText size={15} />
                      {#if isRenamingPath}
                        <input
                          class="tree-rename-input"
                          bind:value={renamingTreePath.name}
                          aria-label="File name"
                          on:click|stopPropagation
                          on:pointerdown|stopPropagation
                          on:blur={saveTreeRename}
                          on:keydown={(event) => {
                            if (event.key === "Enter") {
                              event.currentTarget.blur();
                            } else if (event.key === "Escape") {
                              cancelTreeRename();
                            }
                          }}
                          use:focusOnMount
                        />
                      {:else}
                        <button
                          class="tree-label"
                          on:click={() => toggleTreeFile(row.file, row.expanded)}
                          on:dblclick|stopPropagation={() => startTreeRename(row.file.relative_path)}
                        >
                          <span>{row.file.name}</span>
                        </button>
                      {/if}
                      {#if row.file.kind === "test"}
                        <button
                          class="tree-run-button"
                          on:click|stopPropagation={() => runFile(row.file)}
                          disabled={busy || !rootPath}
                          aria-label={`Run ${row.file.name}`}
                          title={`Run ${row.file.name}`}
                        >
                          <Play size={14} />
                        </button>
                      {/if}
                    </div>
                  {:else}
                    <div
                      class="tree-row test-row"
                      class:active={selectedTestKey === row.key}
                      role="treeitem"
                      aria-selected={selectedTestKey === row.key}
                      tabindex="-1"
                      style:padding-left={`${row.depth * 16 + 22}px`}
                      on:contextmenu={(event) => openTestMenu(event, row.file, row.name)}
                    >
                      <span class="tree-test-dot"></span>
                      <button class="tree-label" on:click={() => selectTest(row.file, row.name)}>
                        <span>{row.name}</span>
                      </button>
                      <button
                        class="tree-run-button"
                        on:click|stopPropagation={() => runTreeTest(row.file, row.name)}
                        disabled={busy || !rootPath}
                        aria-label={`Run ${row.name}`}
                        title={`Run ${row.name}`}
                      >
                        <Play size={14} />
                      </button>
                    </div>
                  {/if}
                {/each}
              {/if}
            {/each}
          {/if}
          {#if treeMenu.type !== "none"}
            <div
              class="context-menu"
              role="menu"
              style:left={`${treeMenu.left}px`}
              style:top={`${treeMenu.top}px`}
              tabindex="-1"
              on:click|stopPropagation
              on:keydown|stopPropagation
            >
              {#if treeMenu.type === "project"}
                <button role="menuitem" on:click={() => createTreeDirectory()}>New Directory</button>
                <button role="menuitem" on:click={() => createTreeTestFile()}>New Test File</button>
                <button
                  role="menuitem"
                  on:click={() => {
                    const project = projects.find((project) => project.root === treeMenuPath);
                    if (project) startProjectRename(project);
                  }}
                >
                  Rename Project
                </button>
                <button role="menuitem" class="danger" on:click={() => removeSavedProject(treeMenuPath)}>Remove</button>
              {:else if treeMenu.type === "dir"}
                <button role="menuitem" on:click={() => createTreeDirectory(treeMenuPath)}>New Directory</button>
                <button role="menuitem" on:click={() => createTreeTestFile(treeMenuPath)}>New Test File</button>
                <button role="menuitem" on:click={() => renameTreePath(treeMenuPath)}>Rename</button>
                <button role="menuitem" class="danger" on:click={() => deleteTreePath(treeMenuPath)}>Delete</button>
              {:else if treeMenu.type === "file"}
                {#if treeMenuFile?.kind === "test"}
                  <button role="menuitem" on:click={() => treeMenuFile && addTestToFile(treeMenuFile)}>Add Test</button>
                {/if}
                <button role="menuitem" on:click={() => treeMenuFile && renameTreePath(treeMenuFile.relative_path)}>Rename</button>
                <button role="menuitem" class="danger" on:click={() => treeMenuFile && deleteTreePath(treeMenuFile.relative_path)}>
                  Delete
                </button>
              {:else if treeMenu.type === "test"}
                <button
                  role="menuitem"
                  class="danger"
                  on:click={() => treeMenuTest && deleteTreeTest(treeMenuTest.file, treeMenuTest.name)}
                >
                  Delete
                </button>
              {/if}
            </div>
          {/if}
        </nav>
      </div>
    {/if}
    {#if runMenu.open}
      <div
        class="context-menu"
        role="menu"
        style:left={`${runMenu.left}px`}
        style:top={`${runMenu.top}px`}
        tabindex="-1"
        on:click|stopPropagation
        on:keydown|stopPropagation
      >
        <button role="menuitem" on:click={runCurrentTest} disabled={busy || !rootPath}>Run Current Test</button>
        <button role="menuitem" on:click={runCurrentYamlFile} disabled={busy || !selected}>Run YAML File</button>
        <button role="menuitem" on:click={runCurrentProject} disabled={busy || !rootPath}>Run Project</button>
      </div>
    {/if}
  </aside>

  <section class="workspace">
    <div class="workspace-content" bind:this={workspaceContent}>
    <header class="topbar">
      <div>
        <h2>{selected ? selected.relative_path : "Request Builder"}</h2>
      </div>
      <div class="top-actions">
        {#if view === "config"}
          <button on:click={save} disabled={!selected || busy}>Save Config</button>
        {/if}
        <button on:click={runDraft} disabled={busy || !rootPath}>Run Draft</button>
        <div class="tabs">
          <button class:active={view === "builder" || view === "config"} on:click={showBuilder}>Builder</button>
          <button class:active={view === "yaml"} on:click={showYaml}>YAML</button>
        </div>
      </div>
    </header>

    {#if message}
      <div class="notice">{message}</div>
    {/if}

    {#if view === "config"}
      <section class="config-editor">
        <div class="config-section-head">
          <h3>Variables</h3>
          <button class="icon-button" on:click={addConfigVar} aria-label="Add variable" title="Add variable">
            <Plus size={18} />
          </button>
        </div>
        <div class="config-rows">
          {#each configDraft.vars as variable (variable.id)}
            <div class="config-row variable-row">
              <input bind:value={variable.name} placeholder="name" />
              <input bind:value={variable.env} placeholder="ENV_VAR" />
              <input bind:value={variable.defaultValue} placeholder="default value" />
              <button
                class="icon-button danger-button"
                on:click={() => removeConfigVar(variable.id)}
                aria-label="Remove variable"
                title="Remove variable"
              >
                <Trash2 size={18} />
              </button>
            </div>
          {/each}
        </div>

        <div class="config-section-head">
          <h3>URLs</h3>
          <button class="icon-button" on:click={addConfigUrl} aria-label="Add URL" title="Add URL">
            <Plus size={18} />
          </button>
        </div>
        <div class="config-rows">
          {#each configDraft.urls as url (url.id)}
            <div class="config-row url-row">
              <input bind:value={url.name} placeholder="name" />
              <div class="suggest-wrap">
                <input
                  bind:value={url.value}
                  on:focus={(event) => updateSuggestionMenu(event, `${url.id}:config-url`)}
                  on:click={(event) => updateSuggestionMenu(event, `${url.id}:config-url`)}
                  on:input={(event) => updateSuggestionMenu(event, `${url.id}:config-url`)}
                  on:keydown={(event) =>
                    handleSuggestionKeydown(event, `${url.id}:config-url`, (suggestion) =>
                      insertConfigValueSuggestion(url, suggestion),
                    )}
                  placeholder="$vars.default-url"
                />
                {#if suggestionMenu.key === `${url.id}:config-url`}
                  <div
                    class="suggestions"
                    style:left={`${suggestionMenu.left}px`}
                    style:top={`${suggestionMenu.top}px`}
                  >
                    {#each suggestionMenu.items as suggestion, suggestionIndex}
                      <button
                        class:active={suggestionMenu.index === suggestionIndex}
                        on:mousedown|preventDefault={() => insertConfigValueSuggestion(url, suggestion)}
                      >
                        {suggestion}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
              <button
                class="icon-button danger-button"
                on:click={() => removeConfigUrl(url.id)}
                aria-label="Remove URL"
                title="Remove URL"
              >
                <Trash2 size={18} />
              </button>
            </div>
          {/each}
        </div>

        <div class="config-section-head">
          <h3>Step Sets</h3>
          <button class="icon-button" on:click={addStepSet} aria-label="Add step set" title="Add step set">
            <Plus size={18} />
          </button>
        </div>
        <div class="steps">
          {#each configDraft.stepSets as stepSet (stepSet.id)}
            <section class="step-card">
              <div class="step-set-title">
                <button
                  class="icon-button"
                  on:click={() => toggleStepSet(stepSet)}
                  aria-label={stepSet.collapsed ? "Show step set" : "Hide step set"}
                  title={stepSet.collapsed ? "Show step set" : "Hide step set"}
                >
                  {#if stepSet.collapsed}
                    <ChevronRight size={18} />
                  {:else}
                    <ChevronDown size={18} />
                  {/if}
                </button>
                <input bind:value={stepSet.name} placeholder="step-set-name" />
                <label class="check-field">
                  <input type="checkbox" bind:checked={stepSet.once} />
                  <span>once</span>
                </label>
                <button class="icon-button" on:click={() => addStepSetStep(stepSet)} aria-label="Add step" title="Add step">
                  <Plus size={18} />
                </button>
                <button
                  class="icon-button danger-button"
                  on:click={() => removeStepSet(stepSet.id)}
                  aria-label="Remove step set"
                  title="Remove step set"
                >
                  <Trash2 size={18} />
                </button>
              </div>

              {#if stepSet.collapsed}
                <p class="step-summary">{stepSet.steps.length} step{stepSet.steps.length === 1 ? "" : "s"}</p>
              {:else}
                <div class="steps">
                  {#each stepSet.steps as step, index (step.uid)}
                    <StepEditor
                      {step}
                      {index}
                      stepCount={stepSet.steps.length}
                      stepSets={catalog.stepSets}
                      {suggestionMenu}
                      keyPrefix="config"
                      nested={true}
                      onChange={touchConfigDraft}
                      onToggleStep={toggleStep}
                      onToggleSection={toggleStepSection}
                      onAddHeader={addHeader}
                      onRemoveHeader={removeHeader}
                      onAddAssertionHeader={addAssertionHeader}
                      onRemoveAssertionHeader={removeAssertionHeader}
                      onRemoveStep={(uid) => removeStepSetStep(stepSet, uid)}
                      {updateSuggestionMenu}
                      {handleSuggestionKeydown}
                      {insertStepSuggestion}
                      {insertHeaderSuggestion}
                      {insertResponseBodySuggestion}
                    />
                  {/each}
                </div>

                <section class="step-section">
                  <div class="section-head">
                    <span>Outputs</span>
                    <button class="icon-button" on:click={() => addStepSetOutput(stepSet)} aria-label="Add output" title="Add output">
                      <Plus size={18} />
                    </button>
                  </div>
                  {#each stepSet.outputs as output (output.id)}
                    <div class="header-row">
                      <input bind:value={output.name} placeholder="name" />
                      <div class="suggest-wrap">
                        <input
                          bind:value={output.value}
                          on:focus={(event) => updateSuggestionMenu(event, `${output.id}:config-output`)}
                          on:click={(event) => updateSuggestionMenu(event, `${output.id}:config-output`)}
                          on:input={(event) => updateSuggestionMenu(event, `${output.id}:config-output`)}
                          on:keydown={(event) =>
                            handleSuggestionKeydown(event, `${output.id}:config-output`, (suggestion) =>
                              insertConfigValueSuggestion(output, suggestion),
                            )}
                          placeholder="$step.response.id"
                        />
                        {#if suggestionMenu.key === `${output.id}:config-output`}
                          <div
                            class="suggestions"
                            style:left={`${suggestionMenu.left}px`}
                            style:top={`${suggestionMenu.top}px`}
                          >
                            {#each suggestionMenu.items as suggestion, suggestionIndex}
                              <button
                                class:active={suggestionMenu.index === suggestionIndex}
                                on:mousedown|preventDefault={() => insertConfigValueSuggestion(output, suggestion)}
                              >
                                {suggestion}
                              </button>
                            {/each}
                          </div>
                        {/if}
                      </div>
                      <button
                        class="icon-button danger-button"
                        on:click={() => removeStepSetOutput(stepSet, output.id)}
                        aria-label="Remove output"
                        title="Remove output"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  {/each}
                </section>
              {/if}
            </section>
          {/each}
        </div>
      </section>
    {:else if view === "builder"}
      <section class="builder">
        <div class="builder-head">
          <label class="field">
            <span>Test name</span>
            <input bind:value={draft.testName} />
          </label>
          <label class="field">
            <span>Setup</span>
            <ThemedSelect
              bind:value={draft.setupName}
              ariaLabel="Setup"
              options={[{ value: "", label: "None" }, ...catalog.stepSets.map((stepSet) => ({ value: stepSet, label: stepSet }))]}
            />
          </label>
          <label class="field">
            <span>Teardown</span>
            <ThemedSelect
              bind:value={draft.cleanupName}
              ariaLabel="Teardown"
              options={[{ value: "", label: "None" }, ...catalog.stepSets.map((stepSet) => ({ value: stepSet, label: stepSet }))]}
            />
          </label>
          <div class="step-buttons">
            <button class="icon-button" on:click={addStep} aria-label="Add step" title="Add step">
              <Plus size={18} />
            </button>
            <button
              class="icon-button"
              on:click={saveDraft}
              disabled={!rootPath || busy}
              aria-label="Save test"
              title="Save test"
            >
              <Save size={18} />
            </button>
            <button
              class="icon-button run-button"
              on:click={runDraft}
              disabled={!rootPath || busy}
              aria-label="Run test"
              title="Run test"
            >
              <Play size={18} />
            </button>
          </div>
        </div>

        <div class="steps" role="list">
          {#each draft.steps as step, index (step.uid)}
            <StepEditor
              {step}
              {index}
              stepCount={draft.steps.length}
              stepSets={catalog.stepSets}
              {suggestionMenu}
              draggable={true}
              {draggingStepUid}
              {dragOverStepUid}
              onChange={touchDraft}
              onToggleStep={toggleStep}
              onToggleSection={toggleStepSection}
              onAddHeader={addHeader}
              onRemoveHeader={removeHeader}
              onAddAssertionHeader={addAssertionHeader}
              onRemoveAssertionHeader={removeAssertionHeader}
              onRemoveStep={removeStep}
              {onDragStart}
              {onDragOver}
              {onDrop}
              {onDragEnd}
              {updateSuggestionMenu}
              {handleSuggestionKeydown}
              {insertStepSuggestion}
              {insertHeaderSuggestion}
              {insertResponseBodySuggestion}
            />
          {/each}
        </div>

      </section>
    {:else}
      <section class="editor-pane">
        <div class="editor-actions">
          <button on:click={selected ? save : saveDraft} disabled={busy || (!selected && !rootPath) || (selected && !dirty)}>
            Save
          </button>
          <button on:click={() => selected && runYapitest(selected.relative_path)} disabled={!selected || busy}>
            Run File
          </button>
        </div>
        <textarea class="editor" bind:value={editor} spellcheck="false"></textarea>
      </section>
    {/if}

    </div>
    {#if runResult || testRunning}
      <TestResults {runResult} running={testRunning} on:navigate={handleNavigate} />
    {/if}
  </section>
</main>
</div>
