<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { Eye, EyeOff, GripVertical, Play, Plus, Save, Trash2 } from "lucide-svelte";
  import { buildTestYaml, extractReferenceCatalog, mergeCatalogs, sampleConfig } from "./yaml";
  import type { FileEntry, GitStatus, ReferenceCatalog, RunResult, StepDraft, TestDraft } from "./types";

  let rootPath = "";
  let files: FileEntry[] = [];
  let selected: FileEntry | null = null;
  let editor = "";
  let original = "";
  let output = "";
  let runResult: RunResult | null = null;
  let gitStatus: GitStatus | null = null;
  let busy = false;
  let message = "";
  let view: "builder" | "yaml" = "builder";
  let filter = "";
  let focusedKey = "";
  let previewCollapsed = false;
  let draggingStepUid = "";
  let dragOverStepUid = "";
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
    path: "/health",
    method: "GET",
    stepId: "health",
    headers: [{ id: crypto.randomUUID(), name: "Authorization", value: "Bearer $vars.api-token" }],
    body: "",
    statusCode: "200",
    ...overrides,
  });

  let draft: TestDraft = {
    testName: "health-check",
    setupName: "",
    cleanupName: "",
    steps: [newRequestStep()],
  };

  $: filteredFiles = files.filter((file) =>
    file.relative_path.toLowerCase().includes(filter.toLowerCase()),
  );
  $: dirty = editor !== original;
  $: generatedYaml = buildTestYaml(draft);
  $: suggestions = buildSuggestions(draft, catalog);
  $: if (view === "builder") {
    editor = generatedYaml;
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
    if (!selected && files.length > 0) await selectFile(files[0]);
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
    editor = await call<string>("read_yaml_file", {
      root: rootPath.trim(),
      relativePath: file.relative_path,
    });
    original = editor;
    view = "yaml";
  }

  async function save() {
    if (!selected) return;
    await call("write_yaml_file", {
      root: rootPath.trim(),
      relativePath: selected.relative_path,
      contents: editor,
    });
    original = editor;
    await scan();
    message = `Saved ${selected.relative_path}`;
  }

  async function saveDraft() {
    const relativePath = `api-tests/${draft.testName.trim() || "new-api-test"}.yaml`;
    const activeView = view;
    await call("write_yaml_file", {
      root: rootPath.trim(),
      relativePath,
      contents: generatedYaml,
    });
    await scan();
    const file = files.find((item) => item.relative_path === relativePath);
    if (file && activeView !== "builder") {
      selected = file;
      editor = generatedYaml;
      original = generatedYaml;
    } else {
      selected = null;
      editor = generatedYaml;
      original = generatedYaml;
    }
    view = activeView;
    return relativePath;
  }

  function showBuilder() {
    selected = null;
    editor = generatedYaml;
    original = generatedYaml;
    view = "builder";
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

  async function runYapitest(target?: string) {
    output = "Running yapitest...\n";
    runResult = await call<RunResult>("run_yapitest", {
      root: rootPath.trim(),
      target: target || null,
    });
    output = [runResult.command, "", runResult.stdout, runResult.stderr].filter(Boolean).join("\n");
  }

  async function runDraft() {
    const relativePath = await saveDraft();
    await runYapitest(relativePath);
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
  }

  function removeHeader(step: StepDraft, id: string) {
    step.headers = step.headers.filter((header) => header.id !== id);
    draft.steps = [...draft.steps];
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

  function insertHeaderSuggestion(header: { value: string }, value: string) {
    const input = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const caret = input?.selectionStart ?? header.value.length;
    const next = replaceToken(header.value, value, caret);
    header.value = next.value;
    draft.steps = [...draft.steps];
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
</script>

<main class="shell">
  <aside class="sidebar">
    <div class="brand">
      <span class="mark">B</span>
      <div>
        <h1>Blitzen</h1>
        <p>YAML API tests for Git repositories</p>
      </div>
    </div>

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

    <nav class="file-list" aria-label="YAML files">
      {#each filteredFiles as file}
        <button class:active={selected?.relative_path === file.relative_path} on:click={() => selectFile(file)}>
          <span>{file.name}</span>
          <small>{file.kind}</small>
        </button>
      {/each}
    </nav>

    {#if gitStatus}
      <section class="git">
        <h2>Git</h2>
        <pre>{gitStatus.available ? gitStatus.output || "Working tree clean" : "Git unavailable"}</pre>
      </section>
    {/if}
  </aside>

  <section class="workspace">
    <header class="topbar">
      <div>
        <h2>{selected ? selected.relative_path : "Request Builder"}</h2>
        <p>{dirty ? "Unsaved YAML changes" : "Collections and configs are plain repository files"}</p>
      </div>
      <div class="top-actions">
        <button on:click={() => runYapitest()} disabled={busy || !rootPath}>Run All</button>
        <button on:click={runDraft} disabled={busy || !rootPath}>Run Draft</button>
        <div class="tabs">
          <button class:active={view === "builder"} on:click={showBuilder}>Builder</button>
          <button class:active={view === "yaml"} on:click={() => (view = "yaml")}>YAML</button>
        </div>
      </div>
    </header>

    {#if message}
      <div class="notice">{message}</div>
    {/if}

    {#if view === "builder"}
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
                <button on:click={() => removeStep(step.uid)} disabled={draft.steps.length === 1}>Remove</button>
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
                  <label class="field">
                    <span>Expected status</span>
                    <input bind:value={step.statusCode} />
                  </label>
                </div>

                <section class="headers">
                  <div>
                    <h3>Headers</h3>
                    <button on:click={() => addHeader(step)}>Add Header</button>
                  </div>
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
                </section>

                <label class="field">
                  <span>Body YAML</span>
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
                </label>
              {/if}
            </section>
          {/each}
        </div>

        <section class="preview" class:collapsed={previewCollapsed}>
          <div class="preview-head">
            <h3>Generated yapitest file</h3>
            <button on:click={() => (previewCollapsed = !previewCollapsed)}>
              {previewCollapsed ? "Show" : "Hide"}
            </button>
          </div>
          {#if !previewCollapsed}
            <pre>{generatedYaml}</pre>
          {/if}
        </section>
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
