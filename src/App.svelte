<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { buildTestYaml, sampleConfig } from "./yaml";
  import type { FileEntry, GitStatus, RequestDraft, RunResult } from "./types";

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

  let draft: RequestDraft = {
    testName: "health-check",
    path: "/health",
    method: "GET",
    stepId: "health",
    headers: "Authorization: Bearer $api-token",
    body: "",
    statusCode: "200",
  };

  $: filteredFiles = files.filter((file) =>
    file.relative_path.toLowerCase().includes(filter.toLowerCase()),
  );
  $: dirty = editor !== original;
  $: generatedYaml = buildTestYaml(draft);

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
    if (!selected && files.length > 0) await selectFile(files[0]);
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

  async function newTestFromBuilder() {
    const relativePath = `api-tests/${draft.testName.trim() || "new-api-test"}.yaml`;
    await call("write_yaml_file", {
      root: rootPath.trim(),
      relativePath,
      contents: generatedYaml,
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
    output = [runResult.command, "", runResult.stdout, runResult.stderr]
      .filter(Boolean)
      .join("\n");
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
        <button
          class:active={selected?.relative_path === file.relative_path}
          on:click={() => selectFile(file)}
        >
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
      <div class="tabs">
        <button class:active={view === "builder"} on:click={() => (view = "builder")}>Builder</button>
        <button class:active={view === "yaml"} on:click={() => (view = "yaml")}>YAML</button>
      </div>
    </header>

    {#if message}
      <div class="notice">{message}</div>
    {/if}

    {#if view === "builder"}
      <section class="builder">
        <div class="request-line">
          <select bind:value={draft.method}>
            {#each ["GET", "POST", "PUT", "PATCH", "DELETE"] as method}
              <option>{method}</option>
            {/each}
          </select>
          <input bind:value={draft.path} placeholder="/api/resource" />
          <button on:click={newTestFromBuilder} disabled={!rootPath || busy}>Save Test</button>
        </div>

        <div class="grid">
          <label class="field">
            <span>Test name</span>
            <input bind:value={draft.testName} />
          </label>
          <label class="field">
            <span>Step id</span>
            <input bind:value={draft.stepId} />
          </label>
          <label class="field">
            <span>Expected status</span>
            <input bind:value={draft.statusCode} />
          </label>
        </div>

        <div class="split">
          <label class="field">
            <span>Headers</span>
            <textarea bind:value={draft.headers} spellcheck="false"></textarea>
          </label>
          <label class="field">
            <span>Body YAML</span>
            <textarea bind:value={draft.body} spellcheck="false" placeholder="title: Example"></textarea>
          </label>
        </div>

        <section class="preview">
          <div>
            <h3>Generated yapitest file</h3>
            <button on:click={() => (editor = generatedYaml)}>Send to Editor</button>
          </div>
          <pre>{generatedYaml}</pre>
        </section>
      </section>
    {:else}
      <section class="editor-pane">
        <div class="editor-actions">
          <button on:click={save} disabled={!selected || !dirty || busy}>Save</button>
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
