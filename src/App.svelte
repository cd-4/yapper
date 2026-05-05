<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import {
    ChevronDown,
    ChevronRight,
    Eye,
    EyeOff,
    FileText,
    Folder,
    FolderOpen,
    GripVertical,
    PanelLeftClose,
    PanelLeftOpen,
    Play,
    Plus,
    Save,
    Trash2,
  } from "lucide-svelte";
  import {
    buildConfigYaml,
    buildTestYaml,
    extractReferenceCatalog,
    mergeCatalogs,
    parseConfigDraft,
    parseTestDraft,
    replaceTestDraft,
    sampleConfig,
  } from "./yaml";
  import type {
    ConfigDraft,
    FileEntry,
    GitStatus,
    OutputDraft,
    ReferenceCatalog,
    RunResult,
    StepDraft,
    StepSetDraft,
    TestDraft,
    UrlDraft,
    VariableDraft,
  } from "./types";

  let rootPath = "";
  let files: FileEntry[] = [];
  let selected: FileEntry | null = null;
  let selectedTestKey = "";
  let editor = "";
  let original = "";
  let output = "";
  let runResult: RunResult | null = null;
  let gitStatus: GitStatus | null = null;
  let busy = false;
  let message = "";
  let view: "builder" | "yaml" | "config" = "builder";
  let filter = "";
  let focusedKey = "";
  let draggingStepUid = "";
  let dragOverStepUid = "";
  let expandedTree: Record<string, boolean> = {};
  let sidebarCollapsed = false;
  let editingTest: { file: FileEntry; originalName: string } | null = null;
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
  $: treeRows = buildTreeRows(filteredFiles, expandedTree);
  $: dirty = editor !== original;
  $: generatedYaml = buildTestYaml(draft);
  $: generatedConfigYaml = buildConfigYaml(configDraft);
  $: suggestions = view === "config" ? buildConfigSuggestions(configDraft, catalog) : buildSuggestions(draft, catalog);
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

  async function scan() {
    if (!rootPath.trim()) {
      message = "Enter the path to a Git repository or API test folder.";
      return;
    }
    files = await call<FileEntry[]>("scan_repository", { root: rootPath.trim() });
    gitStatus = await call<GitStatus>("git_status", { root: rootPath.trim() });
    await refreshCatalog();
    expandDefaultTree();
    if (!selected && files.length > 0) await selectFile(files[0]);
  }

  type TreeRow =
    | { type: "dir"; key: string; name: string; depth: number; expanded: boolean }
    | { type: "file"; key: string; file: FileEntry; depth: number; expanded: boolean }
    | { type: "test"; key: string; file: FileEntry; name: string; depth: number };

  type DirectoryNode = {
    dirs: Map<string, DirectoryNode>;
    files: FileEntry[];
  };

  function buildTreeRows(items: FileEntry[], expanded: Record<string, boolean>): TreeRow[] {
    const root: DirectoryNode = { dirs: new Map(), files: [] };

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

    walk(root, 0, "");
    return rows;
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

  async function openTreeFile(file: FileEntry) {
    if (file.tests.length > 0) {
      expandedTree = { ...expandedTree, [file.relative_path]: true };
    }
    await selectFile(file);
  }

  async function selectTest(file: FileEntry, testName: string) {
    selected = file;
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
    message = `Opened ${testName} from ${file.relative_path}`;
  }

  async function refreshCatalog() {
    const configs = files.filter((file) => file.kind === "config");
    const catalogs: ReferenceCatalog[] = [];
    for (const config of configs) {
      const contents = await call<string>("read_yaml_file", {
        root: rootPath.trim(),
        relativePath: config.relative_path,
      });
      catalogs.push(extractReferenceCatalog(contents));
    }
    catalog = catalogs.length > 0 ? mergeCatalogs(catalogs) : emptyCatalog;
  }

  async function selectFile(file: FileEntry) {
    selected = file;
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
        editingTest = { file, originalName: currentName };
      }
      editor = buildTestYaml(draft);
      original = editor;
      view = "builder";
      message = `Saved ${currentName} in ${activeFilePath}`;
      return activeFilePath;
    }

    message = "Select a test from an existing YAML file before saving or running it.";
    return null;
  }

  function showBuilder() {
    if (selected?.kind === "config") {
      showConfig();
      return;
    }
    if (view === "builder") return;
    selected = null;
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

  async function createSampleProject() {
    if (!rootPath.trim()) {
      message = "Enter a repository path first.";
      return;
    }
    await call("create_sample_project", { root: rootPath.trim() });
    await scan();
    message = "Created api-tests/config.yaml and api-tests/health.yaml";
  }

  async function newConfig() {
    const relativePath = "api-tests/config.yaml";
    await call("write_yaml_file", {
      root: rootPath.trim(),
      relativePath,
      contents: sampleConfig,
    });
    await scan();
    const file = files.find((item) => item.relative_path === relativePath);
    if (file) await selectFile(file);
  }

  async function runYapitest(target?: string, testName?: string) {
    output = "Running yapitest...\n";
    runResult = await call<RunResult>("run_yapitest", {
      root: rootPath.trim(),
      target: target || null,
      testName: testName || null,
    });
    output = [runResult.command, "", runResult.stdout, runResult.stderr].filter(Boolean).join("\n");
  }

  async function runDraft() {
    const relativePath = await saveDraft();
    if (!relativePath) return;
    await runYapitest(relativePath, draft.testName.trim() || "new-api-test");
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
    field: "headersCollapsed" | "bodyCollapsed" | "assertionsCollapsed",
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

  function insertStepSuggestion(step: StepDraft, field: "path" | "body", value: string) {
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

<main class="shell" class:sidebar-collapsed={sidebarCollapsed}>
  <aside class="sidebar" aria-label="Repository browser">
    <div class="sidebar-head">
      <div class="brand">
        <span class="mark">B</span>
        {#if !sidebarCollapsed}
          <div>
            <h1>Yapper</h1>
            <p>YAML API tests for Git repositories</p>
          </div>
        {/if}
      </div>
      <button
        class="icon-button"
        on:click={() => (sidebarCollapsed = !sidebarCollapsed)}
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {#if sidebarCollapsed}
          <PanelLeftOpen size={18} />
        {:else}
          <PanelLeftClose size={18} />
        {/if}
      </button>
    </div>

    {#if !sidebarCollapsed}
      <div class="sidebar-body">
        <label class="field">
          <span>Repository path</span>
          <div class="path-row">
            <input bind:value={rootPath} placeholder="/path/to/repo" />
            <button on:click={scan} disabled={busy}>Open</button>
          </div>
        </label>

        <div class="actions">
          <button on:click={createSampleProject} disabled={busy || !rootPath}>Sample</button>
          <button on:click={newConfig} disabled={busy || !rootPath}>Config</button>
          <button on:click={() => runYapitest()} disabled={busy || !rootPath}>Run All</button>
        </div>

        <input class="search" bind:value={filter} placeholder="Filter YAML files" />

        <nav class="file-tree" aria-label="YAML files">
          {#each treeRows as row (row.key)}
            {#if row.type === "dir"}
              <div class="tree-row" style:padding-left={`${row.depth * 16 + 4}px`}>
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
                <button class="tree-label" on:click={() => toggleTree(row.key, row.expanded)}>
                  <span>{row.name}</span>
                </button>
              </div>
            {:else if row.type === "file"}
              <div
                class="tree-row"
                class:active={selected?.relative_path === row.file.relative_path && !selectedTestKey}
                style:padding-left={`${row.depth * 16 + 4}px`}
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
                <button class="tree-label" on:click={() => openTreeFile(row.file)}>
                  <span>{row.file.name}</span>
                </button>
                <small>{row.file.kind}</small>
              </div>
            {:else}
              <div
                class="tree-row test-row"
                class:active={selectedTestKey === row.key}
                style:padding-left={`${row.depth * 16 + 22}px`}
              >
                <span class="tree-test-dot"></span>
                <button class="tree-label" on:click={() => selectTest(row.file, row.name)}>
                  <span>{row.name}</span>
                </button>
              </div>
            {/if}
          {/each}
        </nav>

        {#if gitStatus}
          <section class="git">
            <h2>Git</h2>
            <pre>{gitStatus.available ? gitStatus.output || "Working tree clean" : "Git unavailable"}</pre>
          </section>
        {/if}
      </div>
    {/if}
  </aside>

  <section class="workspace">
    <header class="topbar">
      <div>
        <h2>{selected ? selected.relative_path : "Request Builder"}</h2>
        <p>{dirty ? "Unsaved YAML changes" : "Collections and configs are plain repository files"}</p>
      </div>
      <div class="top-actions">
        {#if view === "config"}
          <button on:click={save} disabled={!selected || busy}>Save Config</button>
        {/if}
        <button on:click={() => runYapitest()} disabled={busy || !rootPath}>Run All</button>
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
                    <section class="step-card nested-step">
                      <div class="step-title config-step-title">
                        <button
                          class="icon-button"
                          on:click={() => toggleStep(step)}
                          aria-label={step.collapsed ? "Show step" : "Hide step"}
                          title={step.collapsed ? "Show step" : "Hide step"}
                        >
                          {#if step.collapsed}
                            <EyeOff size={18} />
                            <Eye class="hover-icon" size={18} />
                          {:else}
                            <Eye size={18} />
                            <EyeOff class="hover-icon" size={18} />
                          {/if}
                        </button>
                        <h3>
                          Step {index + 1}
                          <small>{step.type === "reference" ? step.referenceName || "Config step set" : step.stepId || step.path || "Request"}</small>
                        </h3>
                        <select bind:value={step.type}>
                          <option value="request">Request</option>
                          <option value="reference">Config step set</option>
                        </select>
                        <button
                          class="icon-button danger-button"
                          on:click={() => removeStepSetStep(stepSet, step.uid)}
                          disabled={stepSet.steps.length === 1}
                          aria-label="Remove step"
                          title="Remove step"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>

                    {#if step.collapsed}
                      <p class="step-summary">
                        {step.type === "reference"
                          ? `Runs ${step.referenceName || "a config step set"}`
                          : `${step.method} ${step.path || "/"}`}
                      </p>
                    {:else if step.type === "reference"}
                      <div class="grid reference-grid">
                        <label class="field">
                          <span>Step set</span>
                          <select bind:value={step.referenceName}>
                            <option value="">Select step set</option>
                            {#each catalog.stepSets as catalogStepSet}
                              <option value={catalogStepSet}>{catalogStepSet}</option>
                            {/each}
                          </select>
                        </label>
                      </div>
                    {:else}
                      <div class="request-line">
                        <select bind:value={step.method}>
                          {#each ["GET", "POST", "PUT", "PATCH", "DELETE"] as method}
                            <option>{method}</option>
                          {/each}
                        </select>
                        <div class="suggest-wrap">
                          <input
                            bind:value={step.path}
                            on:focus={(event) => updateSuggestionMenu(event, `${step.uid}:config-path`)}
                            on:click={(event) => updateSuggestionMenu(event, `${step.uid}:config-path`)}
                            on:input={(event) => updateSuggestionMenu(event, `${step.uid}:config-path`)}
                            on:keydown={(event) =>
                              handleSuggestionKeydown(event, `${step.uid}:config-path`, (suggestion) =>
                                insertStepSuggestion(step, "path", suggestion),
                              )}
                            placeholder="/api/resource"
                          />
                          {#if suggestionMenu.key === `${step.uid}:config-path`}
                            <div
                              class="suggestions"
                              style:left={`${suggestionMenu.left}px`}
                              style:top={`${suggestionMenu.top}px`}
                            >
                              {#each suggestionMenu.items as suggestion, suggestionIndex}
                                <button
                                  class:active={suggestionMenu.index === suggestionIndex}
                                  on:mousedown|preventDefault={() => insertStepSuggestion(step, "path", suggestion)}
                                >
                                  {suggestion}
                                </button>
                              {/each}
                            </div>
                          {/if}
                        </div>
                      </div>
                      <div class="grid">
                        <label class="field">
                          <span>Step id</span>
                          <input bind:value={step.stepId} />
                        </label>
                      </div>

                      <section class="step-section">
                        <div class="section-head">
                          <button
                            class="icon-button"
                            on:click={() => toggleStepSection(step, "headersCollapsed")}
                            aria-label={step.headersCollapsed ? "Show headers" : "Hide headers"}
                            title={step.headersCollapsed ? "Show headers" : "Hide headers"}
                          >
                            {#if step.headersCollapsed}
                              <ChevronRight size={18} />
                            {:else}
                              <ChevronDown size={18} />
                            {/if}
                          </button>
                          <span>Headers</span>
                          <button
                            class="icon-button"
                            on:click={() => addHeader(step)}
                            disabled={step.headersCollapsed}
                            aria-label="Add header"
                            title="Add header"
                          >
                            <Plus size={18} />
                          </button>
                        </div>
                        {#if !step.headersCollapsed}
                          {#each step.headers as header (header.id)}
                            <div class="header-row">
                              <input bind:value={header.name} placeholder="Name" />
                              <div class="suggest-wrap">
                                <input
                                  bind:value={header.value}
                                  on:focus={(event) => updateSuggestionMenu(event, `${header.id}:config-header`)}
                                  on:click={(event) => updateSuggestionMenu(event, `${header.id}:config-header`)}
                                  on:input={(event) => updateSuggestionMenu(event, `${header.id}:config-header`)}
                                  on:keydown={(event) =>
                                    handleSuggestionKeydown(event, `${header.id}:config-header`, (suggestion) =>
                                      insertHeaderSuggestion(header, suggestion),
                                    )}
                                  placeholder="Value"
                                />
                                {#if suggestionMenu.key === `${header.id}:config-header`}
                                  <div
                                    class="suggestions"
                                    style:left={`${suggestionMenu.left}px`}
                                    style:top={`${suggestionMenu.top}px`}
                                  >
                                    {#each suggestionMenu.items as suggestion, suggestionIndex}
                                      <button
                                        class:active={suggestionMenu.index === suggestionIndex}
                                        on:mousedown|preventDefault={() => insertHeaderSuggestion(header, suggestion)}
                                      >
                                        {suggestion}
                                      </button>
                                    {/each}
                                  </div>
                                {/if}
                              </div>
                              <button
                                class="icon-button danger-button"
                                on:click={() => removeHeader(step, header.id)}
                                aria-label="Remove header"
                                title="Remove header"
                              >
                                <Trash2 size={18} />
                              </button>
                            </div>
                          {/each}
                        {/if}
                      </section>

                      <section class="step-section">
                        <div class="section-head">
                          <button
                            class="icon-button"
                            on:click={() => toggleStepSection(step, "bodyCollapsed")}
                            aria-label={step.bodyCollapsed ? "Show request body" : "Hide request body"}
                            title={step.bodyCollapsed ? "Show request body" : "Hide request body"}
                          >
                            {#if step.bodyCollapsed}
                              <ChevronRight size={18} />
                            {:else}
                              <ChevronDown size={18} />
                            {/if}
                          </button>
                          <span>Request Body</span>
                        </div>
                        {#if !step.bodyCollapsed}
                          <div class="suggest-wrap">
                            <textarea
                              bind:value={step.body}
                              on:focus={(event) => updateSuggestionMenu(event, `${step.uid}:config-body`)}
                              on:click={(event) => updateSuggestionMenu(event, `${step.uid}:config-body`)}
                              on:input={(event) => updateSuggestionMenu(event, `${step.uid}:config-body`)}
                              on:keydown={(event) =>
                                handleSuggestionKeydown(event, `${step.uid}:config-body`, (suggestion) =>
                                  insertStepSuggestion(step, "body", suggestion),
                                )}
                              spellcheck="false"
                              placeholder="title: Example"
                            ></textarea>
                            {#if suggestionMenu.key === `${step.uid}:config-body`}
                              <div
                                class="suggestions"
                                style:left={`${suggestionMenu.left}px`}
                                style:top={`${suggestionMenu.top}px`}
                              >
                                {#each suggestionMenu.items as suggestion, suggestionIndex}
                                  <button
                                    class:active={suggestionMenu.index === suggestionIndex}
                                    on:mousedown|preventDefault={() => insertStepSuggestion(step, "body", suggestion)}
                                  >
                                    {suggestion}
                                  </button>
                                {/each}
                              </div>
                            {/if}
                          </div>
                        {/if}
                      </section>

                      <section class="step-section">
                        <div class="section-head">
                          <button
                            class="icon-button"
                            on:click={() => toggleStepSection(step, "assertionsCollapsed")}
                            aria-label={step.assertionsCollapsed ? "Show assertions" : "Hide assertions"}
                            title={step.assertionsCollapsed ? "Show assertions" : "Hide assertions"}
                          >
                            {#if step.assertionsCollapsed}
                              <ChevronRight size={18} />
                            {:else}
                              <ChevronDown size={18} />
                            {/if}
                          </button>
                          <span>Assertions</span>
                        </div>
                        {#if !step.assertionsCollapsed}
                          <div class="grid assertion-grid">
                            <label class="field">
                              <span>Expected status</span>
                              <input bind:value={step.statusCode} />
                            </label>
                          </div>
                          <div class="assertion-subsection">
                            <div class="assertion-subsection-head">
                              <span>Header Assertions</span>
                              <button
                                class="icon-button"
                                on:click={() => addAssertionHeader(step)}
                                aria-label="Add header assertion"
                                title="Add header assertion"
                              >
                                <Plus size={18} />
                              </button>
                            </div>
                            {#each step.assertionHeaders as header (header.id)}
                              <div class="header-row">
                                <input bind:value={header.name} placeholder="Name" />
                                <div class="suggest-wrap">
                                  <input
                                    bind:value={header.value}
                                    on:focus={(event) => updateSuggestionMenu(event, `${header.id}:config-assertion-header`)}
                                    on:click={(event) => updateSuggestionMenu(event, `${header.id}:config-assertion-header`)}
                                    on:input={(event) => updateSuggestionMenu(event, `${header.id}:config-assertion-header`)}
                                    on:keydown={(event) =>
                                      handleSuggestionKeydown(event, `${header.id}:config-assertion-header`, (suggestion) =>
                                        insertHeaderSuggestion(header, suggestion),
                                      )}
                                    placeholder="Value"
                                  />
                                  {#if suggestionMenu.key === `${header.id}:config-assertion-header`}
                                    <div
                                      class="suggestions"
                                      style:left={`${suggestionMenu.left}px`}
                                      style:top={`${suggestionMenu.top}px`}
                                    >
                                      {#each suggestionMenu.items as suggestion, suggestionIndex}
                                        <button
                                          class:active={suggestionMenu.index === suggestionIndex}
                                          on:mousedown|preventDefault={() => insertHeaderSuggestion(header, suggestion)}
                                        >
                                          {suggestion}
                                        </button>
                                      {/each}
                                    </div>
                                  {/if}
                                </div>
                                <button
                                  class="icon-button danger-button"
                                  on:click={() => removeAssertionHeader(step, header.id)}
                                  aria-label="Remove header assertion"
                                  title="Remove header assertion"
                                >
                                  <Trash2 size={18} />
                                </button>
                              </div>
                            {/each}
                          </div>
                          <label class="field assertion-body">
                            <span>Response Body Assertions</span>
                            <div class="suggest-wrap">
                              <textarea
                                bind:value={step.responseBody}
                                on:focus={(event) => updateSuggestionMenu(event, `${step.uid}:config-response-body`)}
                                on:click={(event) => updateSuggestionMenu(event, `${step.uid}:config-response-body`)}
                                on:input={(event) => updateSuggestionMenu(event, `${step.uid}:config-response-body`)}
                                on:keydown={(event) =>
                                  handleSuggestionKeydown(event, `${step.uid}:config-response-body`, (suggestion) =>
                                    insertResponseBodySuggestion(step, suggestion),
                                  )}
                                spellcheck="false"
                                placeholder={"title: Example\nid: $create-user.response.id"}
                              ></textarea>
                              {#if suggestionMenu.key === `${step.uid}:config-response-body`}
                                <div
                                  class="suggestions"
                                  style:left={`${suggestionMenu.left}px`}
                                  style:top={`${suggestionMenu.top}px`}
                                >
                                  {#each suggestionMenu.items as suggestion, suggestionIndex}
                                    <button
                                      class:active={suggestionMenu.index === suggestionIndex}
                                      on:mousedown|preventDefault={() => insertResponseBodySuggestion(step, suggestion)}
                                    >
                                      {suggestion}
                                    </button>
                                  {/each}
                                </div>
                              {/if}
                            </div>
                          </label>
                        {/if}
                      </section>
                    {/if}
                    </section>
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
            <select bind:value={draft.setupName}>
              <option value="">None</option>
              {#each catalog.stepSets as stepSet}
                <option value={stepSet}>{stepSet}</option>
              {/each}
            </select>
          </label>
          <label class="field">
            <span>Teardown</span>
            <select bind:value={draft.cleanupName}>
              <option value="">None</option>
              {#each catalog.stepSets as stepSet}
                <option value={stepSet}>{stepSet}</option>
              {/each}
            </select>
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
            <section
              class="step-card"
              role="listitem"
              class:dragging={draggingStepUid === step.uid}
              class:drag-over={dragOverStepUid === step.uid && draggingStepUid !== step.uid}
              on:dragover={(event) => onDragOver(event, step.uid)}
              on:drop={(event) => onDrop(event, step.uid)}
            >
              <div class="step-title">
                <button
                  class="icon-button drag-handle"
                  draggable="true"
                  on:dragstart={(event) => onDragStart(event, step.uid)}
                  on:dragend={onDragEnd}
                  aria-label="Drag step"
                  title="Drag step"
                >
                  <GripVertical size={18} />
                </button>
                <button
                  class="icon-button"
                  on:click={() => toggleStep(step)}
                  aria-label={step.collapsed ? "Show step" : "Hide step"}
                  title={step.collapsed ? "Show step" : "Hide step"}
                >
                  {#if step.collapsed}
                    <EyeOff size={18} />
                    <Eye class="hover-icon" size={18} />
                  {:else}
                    <Eye size={18} />
                    <EyeOff class="hover-icon" size={18} />
                  {/if}
                </button>
                <h3>
                  Step {index + 1}
                  <small>
                    {step.type === "reference"
                      ? step.referenceName || "Config step set"
                      : step.stepId || step.path || "Request"}
                  </small>
                </h3>
                <select bind:value={step.type}>
                  <option value="request">Request</option>
                  <option value="reference">Config step set</option>
                </select>
                <button
                  class="icon-button danger-button"
                  on:click={() => removeStep(step.uid)}
                  disabled={draft.steps.length === 1}
                  aria-label="Remove step"
                  title="Remove step"
                >
                  <Trash2 size={18} />
                </button>
              </div>

              {#if step.collapsed}
                <p class="step-summary">
                  {step.type === "reference"
                    ? `Runs ${step.referenceName || "a config step set"}`
                    : `${step.method} ${step.path || "/"}`}
                </p>
              {:else if step.type === "reference"}
                <div class="grid reference-grid">
                  <label class="field">
                    <span>Step set</span>
                    <select bind:value={step.referenceName}>
                      <option value="">Select step set</option>
                      {#each catalog.stepSets as stepSet}
                        <option value={stepSet}>{stepSet}</option>
                      {/each}
                    </select>
                  </label>
                </div>
              {:else}
                <div class="request-line">
                  <select bind:value={step.method}>
                    {#each ["GET", "POST", "PUT", "PATCH", "DELETE"] as method}
                      <option>{method}</option>
                    {/each}
                  </select>
                  <div class="suggest-wrap">
                    <input
                      bind:value={step.path}
                      on:focus={(event) => updateSuggestionMenu(event, `${step.uid}:path`)}
                      on:click={(event) => updateSuggestionMenu(event, `${step.uid}:path`)}
                      on:input={(event) => updateSuggestionMenu(event, `${step.uid}:path`)}
                      on:keydown={(event) =>
                        handleSuggestionKeydown(event, `${step.uid}:path`, (suggestion) =>
                          insertStepSuggestion(step, "path", suggestion),
                        )}
                      placeholder="/api/resource"
                    />
                    {#if suggestionMenu.key === `${step.uid}:path`}
                      <div
                        class="suggestions"
                        style:left={`${suggestionMenu.left}px`}
                        style:top={`${suggestionMenu.top}px`}
                      >
                        {#each suggestionMenu.items as suggestion, suggestionIndex}
                          <button
                            class:active={suggestionMenu.index === suggestionIndex}
                            on:mousedown|preventDefault={() => insertStepSuggestion(step, "path", suggestion)}
                          >
                            {suggestion}
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                </div>

                <div class="grid">
                  <label class="field">
                    <span>Step id</span>
                    <input bind:value={step.stepId} />
                  </label>
                </div>

                <section class="step-section">
                  <div class="section-head">
                    <button
                      class="icon-button"
                      on:click={() => toggleStepSection(step, "headersCollapsed")}
                      aria-label={step.headersCollapsed ? "Show headers" : "Hide headers"}
                      title={step.headersCollapsed ? "Show headers" : "Hide headers"}
                    >
                      {#if step.headersCollapsed}
                        <ChevronRight size={18} />
                      {:else}
                        <ChevronDown size={18} />
                      {/if}
                    </button>
                    <span>Headers</span>
                    <button
                      class="icon-button"
                      on:click={() => addHeader(step)}
                      disabled={step.headersCollapsed}
                      aria-label="Add header"
                      title="Add header"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  {#if !step.headersCollapsed}
                    {#each step.headers as header (header.id)}
                      <div class="header-row">
                        <input bind:value={header.name} placeholder="Name" />
                        <div class="suggest-wrap">
                          <input
                            bind:value={header.value}
                            on:focus={(event) => updateSuggestionMenu(event, `${header.id}:value`)}
                            on:click={(event) => updateSuggestionMenu(event, `${header.id}:value`)}
                            on:input={(event) => updateSuggestionMenu(event, `${header.id}:value`)}
                            on:keydown={(event) =>
                              handleSuggestionKeydown(event, `${header.id}:value`, (suggestion) =>
                                insertHeaderSuggestion(header, suggestion),
                              )}
                            placeholder="Value"
                          />
                          {#if suggestionMenu.key === `${header.id}:value`}
                            <div
                              class="suggestions"
                              style:left={`${suggestionMenu.left}px`}
                              style:top={`${suggestionMenu.top}px`}
                            >
                              {#each suggestionMenu.items as suggestion, suggestionIndex}
                                <button
                                  class:active={suggestionMenu.index === suggestionIndex}
                                  on:mousedown|preventDefault={() => insertHeaderSuggestion(header, suggestion)}
                                >
                                  {suggestion}
                                </button>
                              {/each}
                            </div>
                          {/if}
                        </div>
                        <button
                          class="icon-button danger-button"
                          on:click={() => removeHeader(step, header.id)}
                          aria-label="Remove header"
                          title="Remove header"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    {/each}
                  {/if}
                </section>

                <section class="step-section">
                  <div class="section-head">
                    <button
                      class="icon-button"
                      on:click={() => toggleStepSection(step, "bodyCollapsed")}
                      aria-label={step.bodyCollapsed ? "Show request body" : "Hide request body"}
                      title={step.bodyCollapsed ? "Show request body" : "Hide request body"}
                    >
                      {#if step.bodyCollapsed}
                        <ChevronRight size={18} />
                      {:else}
                        <ChevronDown size={18} />
                      {/if}
                    </button>
                    <span>Request Body</span>
                  </div>
                  {#if !step.bodyCollapsed}
                    <div class="suggest-wrap">
                      <textarea
                        bind:value={step.body}
                        on:focus={(event) => updateSuggestionMenu(event, `${step.uid}:body`)}
                        on:click={(event) => updateSuggestionMenu(event, `${step.uid}:body`)}
                        on:input={(event) => updateSuggestionMenu(event, `${step.uid}:body`)}
                        on:keydown={(event) =>
                          handleSuggestionKeydown(event, `${step.uid}:body`, (suggestion) =>
                            insertStepSuggestion(step, "body", suggestion),
                          )}
                        spellcheck="false"
                        placeholder="title: Example"
                      ></textarea>
                      {#if suggestionMenu.key === `${step.uid}:body`}
                        <div
                          class="suggestions"
                          style:left={`${suggestionMenu.left}px`}
                          style:top={`${suggestionMenu.top}px`}
                        >
                          {#each suggestionMenu.items as suggestion, suggestionIndex}
                            <button
                              class:active={suggestionMenu.index === suggestionIndex}
                              on:mousedown|preventDefault={() => insertStepSuggestion(step, "body", suggestion)}
                            >
                              {suggestion}
                            </button>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/if}
                </section>

                <section class="step-section">
                  <div class="section-head">
                    <button
                      class="icon-button"
                      on:click={() => toggleStepSection(step, "assertionsCollapsed")}
                      aria-label={step.assertionsCollapsed ? "Show assertions" : "Hide assertions"}
                      title={step.assertionsCollapsed ? "Show assertions" : "Hide assertions"}
                    >
                      {#if step.assertionsCollapsed}
                        <ChevronRight size={18} />
                      {:else}
                        <ChevronDown size={18} />
                      {/if}
                    </button>
                    <span>Assertions</span>
                  </div>
                  {#if !step.assertionsCollapsed}
                    <div class="grid assertion-grid">
                      <label class="field">
                        <span>Expected status</span>
                        <input bind:value={step.statusCode} />
                      </label>
                    </div>
                    <div class="assertion-subsection">
                      <div class="assertion-subsection-head">
                        <span>Header Assertions</span>
                        <button
                          class="icon-button"
                          on:click={() => addAssertionHeader(step)}
                          aria-label="Add header assertion"
                          title="Add header assertion"
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                      {#each step.assertionHeaders as header (header.id)}
                        <div class="header-row">
                          <input bind:value={header.name} placeholder="Name" />
                          <div class="suggest-wrap">
                            <input
                              bind:value={header.value}
                              on:focus={(event) => updateSuggestionMenu(event, `${header.id}:assertion-value`)}
                              on:click={(event) => updateSuggestionMenu(event, `${header.id}:assertion-value`)}
                              on:input={(event) => updateSuggestionMenu(event, `${header.id}:assertion-value`)}
                              on:keydown={(event) =>
                                handleSuggestionKeydown(event, `${header.id}:assertion-value`, (suggestion) =>
                                  insertHeaderSuggestion(header, suggestion),
                                )}
                              placeholder="Value"
                            />
                            {#if suggestionMenu.key === `${header.id}:assertion-value`}
                              <div
                                class="suggestions"
                                style:left={`${suggestionMenu.left}px`}
                                style:top={`${suggestionMenu.top}px`}
                              >
                                {#each suggestionMenu.items as suggestion, suggestionIndex}
                                  <button
                                    class:active={suggestionMenu.index === suggestionIndex}
                                    on:mousedown|preventDefault={() => insertHeaderSuggestion(header, suggestion)}
                                  >
                                    {suggestion}
                                  </button>
                                {/each}
                              </div>
                            {/if}
                          </div>
                          <button
                            class="icon-button danger-button"
                            on:click={() => removeAssertionHeader(step, header.id)}
                            aria-label="Remove header assertion"
                            title="Remove header assertion"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      {/each}
                    </div>
                    <label class="field assertion-body">
                      <span>Response Body Assertions</span>
                      <div class="suggest-wrap">
                        <textarea
                          bind:value={step.responseBody}
                          on:focus={(event) => updateSuggestionMenu(event, `${step.uid}:response-body`)}
                          on:click={(event) => updateSuggestionMenu(event, `${step.uid}:response-body`)}
                          on:input={(event) => updateSuggestionMenu(event, `${step.uid}:response-body`)}
                          on:keydown={(event) =>
                            handleSuggestionKeydown(event, `${step.uid}:response-body`, (suggestion) =>
                              insertResponseBodySuggestion(step, suggestion),
                            )}
                          spellcheck="false"
                          placeholder={"title: Example\nid: $create-user.response.id"}
                        ></textarea>
                        {#if suggestionMenu.key === `${step.uid}:response-body`}
                          <div
                            class="suggestions"
                            style:left={`${suggestionMenu.left}px`}
                            style:top={`${suggestionMenu.top}px`}
                          >
                            {#each suggestionMenu.items as suggestion, suggestionIndex}
                              <button
                                class:active={suggestionMenu.index === suggestionIndex}
                                on:mousedown|preventDefault={() => insertResponseBodySuggestion(step, suggestion)}
                              >
                                {suggestion}
                              </button>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    </label>
                  {/if}
                </section>
              {/if}
            </section>
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

    <section class="console">
      <div>
        <h3>Run Output</h3>
        {#if runResult}
          <span class:fail={runResult.status !== 0}>exit {runResult.status ?? "unknown"}</span>
        {/if}
      </div>
      <pre>{output || "No yapitest run yet."}</pre>
    </section>
  </section>
</main>
