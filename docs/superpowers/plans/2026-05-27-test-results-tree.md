# Test Results Tree View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw-text `<pre>` console with a structured tree UI that groups test results into collapsible Failed/Passed sections, expands inline to show assertion detail, and lets the user navigate to any test.

**Architecture:** The backend maps `Vec<TestResult>` from the yapitest library into a new structured `RunResult` type (replacing stdout/stderr strings). A new `TestResults.svelte` component consumes this structured data and owns all expand/collapse state. App.svelte wires the component in place of the old console section.

**Tech Stack:** Rust (serde), Svelte 4 legacy API, TypeScript

---

## File Map

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Replace `RunResult`, add `TestResultData`/`AssertionData`, update `run_yapitest`, remove `format_run_output` |
| `src/types.ts` | Replace `RunResult`, add `TestResultItem`/`AssertionResult` |
| `src/TestResults.svelte` | **Create** — tree view component |
| `src/App.svelte` | Import component, replace console section, add `testRunning` state, add `handleNavigate` |

---

## Task 1: Update backend types and mapping

**Files:**
- Modify: `src-tauri/src/lib.rs:28-49` (struct definitions)
- Modify: `src-tauri/src/lib.rs:600-661` (run_yapitest + format_run_output)

- [ ] **Step 1: Replace the three structs**

Find the existing `RunResult` struct (around line 44) and replace it, adding `AssertionData` and `TestResultData` above it:

```rust
#[derive(Serialize)]
struct AssertionData {
    name: String,
    passed: bool,
    message: Option<String>,
}

#[derive(Serialize)]
struct TestResultData {
    name: String,
    passed: bool,
    file_path: Option<String>,
    duration_ms: u64,
    failure_message: Option<String>,
    assertions: Vec<AssertionData>,
}

#[derive(Serialize)]
struct RunResult {
    command: String,
    status: Option<i32>,
    elapsed_ms: u64,
    tests: Vec<TestResultData>,
}
```

The old `RunResult` (with `stdout`, `stderr`) is fully replaced — remove it.

- [ ] **Step 2: Rewrite `run_yapitest` and remove `format_run_output`**

Replace the body of `run_yapitest` (lines ~605–643) and delete `format_run_output` entirely:

```rust
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

    let tests = results
        .iter()
        .map(|r| TestResultData {
            name: r.name().to_string(),
            passed: r.passed(),
            file_path: r
                .file_path()
                .and_then(|p| p.strip_prefix(&root).ok())
                .map(|p| p.to_string_lossy().into_owned()),
            duration_ms: r.duration_ms,
            failure_message: r.get_failure_message().map(str::to_string),
            assertions: r
                .assertions()
                .map(|a| AssertionData {
                    name: a.name.clone(),
                    passed: a.passed,
                    message: a.message.clone(),
                })
                .collect(),
        })
        .collect();

    Ok(RunResult {
        command: display,
        status: Some(if all_passed { 0 } else { 1 }),
        elapsed_ms,
        tests,
    })
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd src-tauri && cargo check
```

Expected: `Finished` with no errors.

---

## Task 2: Update frontend types

**Files:**
- Modify: `src/types.ts:14-19`

- [ ] **Step 1: Replace `RunResult` and add the two new types**

In `src/types.ts`, replace the existing `RunResult` type and add `AssertionResult` and `TestResultItem` before it:

```typescript
export type AssertionResult = {
  name: string;
  passed: boolean;
  message: string | null;
};

export type TestResultItem = {
  name: string;
  passed: boolean;
  file_path: string | null;
  duration_ms: number;
  failure_message: string | null;
  assertions: AssertionResult[];
};

export type RunResult = {
  command: string;
  status: number | null;
  elapsed_ms: number;
  tests: TestResultItem[];
};
```

The old `RunResult` (with `stdout`, `stderr`) is fully replaced.

---

## Task 3: Create the TestResults component

**Files:**
- Create: `src/TestResults.svelte`

- [ ] **Step 1: Write the component**

Create `src/TestResults.svelte` with the following content:

```svelte
<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { RunResult, TestResultItem } from "./types";

  export let runResult: RunResult | null;
  export let running: boolean;

  const dispatch = createEventDispatcher<{
    navigate: { filePath: string; testName: string };
  }>();

  let expandedTests = new Set<string>();
  let failedOpen = true;
  let passedOpen = false;

  $: failedTests = runResult?.tests.filter((t) => !t.passed) ?? [];
  $: passedTests = runResult?.tests.filter((t) => t.passed) ?? [];

  $: if (runResult) {
    expandedTests = new Set(failedTests.map((t) => t.name));
    failedOpen = true;
    passedOpen = false;
  }

  function toggleTest(name: string) {
    if (expandedTests.has(name)) {
      expandedTests.delete(name);
    } else {
      expandedTests.add(name);
    }
    expandedTests = expandedTests;
  }

  function navigate(item: TestResultItem) {
    if (item.file_path) {
      dispatch("navigate", { filePath: item.file_path, testName: item.name });
    }
  }

</script>

<section class="results-panel">
  <div class="results-header">
    <div class="results-header-left">
      <h3>Run Output</h3>
      {#if runResult}
        <span class="results-command">{runResult.command}</span>
      {/if}
    </div>
    {#if runResult}
      <div class="results-badges">
        {#if failedTests.length > 0}
          <span class="badge badge-fail">✗ {failedTests.length} failed</span>
        {/if}
        <span class="badge badge-pass">✓ {passedTests.length} passed</span>
      </div>
    {/if}
  </div>

  {#if running}
    <div class="results-empty">Running…</div>
  {:else if !runResult}
    <div class="results-empty">No test run yet.</div>
  {:else}
    {#if failedTests.length > 0}
      <div class="results-section">
        <button class="section-toggle" on:click={() => (failedOpen = !failedOpen)}>
          <span class="chevron" class:open={failedOpen}>▶</span>
          <span class="section-title fail">✗ Failed</span>
          <span class="section-count">{failedTests.length} test{failedTests.length !== 1 ? "s" : ""}</span>
        </button>
        {#if failedOpen}
          <div class="section-body">
            {#each failedTests as test (test.name)}
              <div class="test-row">
                <button
                  class="test-row-header"
                  on:click={() => toggleTest(test.name)}
                >
                  <span class="status-dot dot-fail"></span>
                  <span class="test-name">{test.name}</span>
                  {#if test.file_path}
                    <span class="test-meta">{test.file_path} · {test.duration_ms}ms</span>
                  {:else}
                    <span class="test-meta">{test.duration_ms}ms</span>
                  {/if}
                  <span class="test-chevron" class:open={expandedTests.has(test.name)}>▶</span>
                </button>
                {#if expandedTests.has(test.name)}
                  <div class="test-detail">
                    <div class="assertion-list">
                      {#each test.assertions as assertion (assertion.name)}
                        <div class="assertion">
                          <span class="assertion-icon" class:pass={assertion.passed} class:fail={!assertion.passed}>
                            {assertion.passed ? "✓" : "✗"}
                          </span>
                          <div class="assertion-body">
                            <span class="assertion-name">{assertion.name}</span>
                            {#if assertion.message}
                              <span class="assertion-msg">{assertion.message}</span>
                            {/if}
                          </div>
                        </div>
                      {/each}
                    </div>
                    {#if test.file_path}
                      <div class="test-actions">
                        <button class="action-link" on:click={() => navigate(test)}>
                          ↗ Go to test
                        </button>
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <div class="results-section">
      <button class="section-toggle" on:click={() => (passedOpen = !passedOpen)}>
        <span class="chevron" class:open={passedOpen}>▶</span>
        <span class="section-title pass">✓ Passed</span>
        <span class="section-count">{passedTests.length} test{passedTests.length !== 1 ? "s" : ""}</span>
      </button>
      {#if passedOpen}
        <div class="section-body">
          {#each passedTests as test (test.name)}
            <div class="test-row">
              <button
                class="test-row-header"
                on:click={() => toggleTest(test.name)}
              >
                <span class="status-dot dot-pass"></span>
                <span class="test-name">{test.name}</span>
                {#if test.file_path}
                  <span class="test-meta">{test.file_path} · {test.duration_ms}ms</span>
                {:else}
                  <span class="test-meta">{test.duration_ms}ms</span>
                {/if}
                <span class="test-chevron" class:open={expandedTests.has(test.name)}>▶</span>
              </button>
              {#if expandedTests.has(test.name)}
                <div class="test-detail">
                  <div class="assertion-list">
                    {#each test.assertions as assertion (assertion.name)}
                      <div class="assertion">
                        <span class="assertion-icon" class:pass={assertion.passed} class:fail={!assertion.passed}>
                          {assertion.passed ? "✓" : "✗"}
                        </span>
                        <div class="assertion-body">
                          <span class="assertion-name">{assertion.name}</span>
                          {#if assertion.message}
                            <span class="assertion-msg">{assertion.message}</span>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                  {#if test.file_path}
                    <div class="test-actions">
                      <button class="action-link" on:click={() => navigate(test)}>
                        ↗ Go to test
                      </button>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="results-footer">
      <span>{runResult.tests.length} test{runResult.tests.length !== 1 ? "s" : ""} · {runResult.elapsed_ms}ms total</span>
      <span class:exit-fail={runResult.status !== 0}>exit {runResult.status ?? "unknown"}</span>
    </div>
  {/if}
</section>

<style>
  .results-panel {
    background: #ffffff;
    border: 1px solid #ddd6f0;
    border-radius: 4px;
    overflow: hidden;
  }

  .results-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid #ede8f7;
    background: #faf8fd;
  }

  .results-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .results-header h3 {
    font-size: 13px;
    font-weight: 500;
    color: #3d2f6e;
    margin: 0;
  }

  .results-command {
    font-size: 11px;
    font-family: monospace;
    color: #8b7aaa;
  }

  .results-badges {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 99px;
  }
  .badge-pass { background: #d9eee7; color: #217a63; }
  .badge-fail { background: #f6d7df; color: #c2415d; }

  .results-empty {
    padding: 20px 12px;
    font-size: 13px;
    color: #8b7aaa;
  }

  .results-section {
    border-bottom: 1px solid #ede8f7;
  }
  .results-section:last-of-type {
    border-bottom: none;
  }

  .section-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 12px;
    background: #faf8fd;
    border: none;
    border-bottom: 1px solid #ede8f7;
    cursor: pointer;
    text-align: left;
  }
  .section-toggle:hover { background: #f3eeff; }

  .chevron {
    font-size: 9px;
    color: #8b7aaa;
    transition: transform 0.15s;
    display: inline-block;
  }
  .chevron.open { transform: rotate(90deg); }

  .section-title {
    font-size: 12px;
    font-weight: 600;
  }
  .section-title.fail { color: #c2415d; }
  .section-title.pass { color: #217a63; }

  .section-count {
    font-size: 11px;
    color: #8b7aaa;
    margin-left: auto;
  }

  .test-row {
    border-bottom: 1px solid #f3eeff;
  }
  .test-row:last-child { border-bottom: none; }

  .test-row-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px 6px 24px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .test-row-header:hover { background: #faf8fd; }

  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot-pass { background: #217a63; }
  .dot-fail { background: #c2415d; }

  .test-name {
    font-size: 13px;
    color: #2e2252;
    flex: 1;
    text-align: left;
  }

  .test-meta {
    font-size: 11px;
    color: #a098c0;
    font-family: monospace;
    white-space: nowrap;
  }

  .test-chevron {
    font-size: 9px;
    color: #b0a4d0;
    transition: transform 0.15s;
    flex-shrink: 0;
  }
  .test-chevron.open { transform: rotate(90deg); }

  .test-detail {
    padding: 8px 12px 10px 40px;
    background: #f8f5ff;
    border-top: 1px solid #ede8f7;
  }

  .assertion-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }

  .assertion {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    font-size: 12px;
  }

  .assertion-icon {
    flex-shrink: 0;
    margin-top: 1px;
    font-weight: 600;
  }
  .assertion-icon.pass { color: #217a63; }
  .assertion-icon.fail { color: #c2415d; }

  .assertion-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .assertion-name { color: #3d2f6e; }

  .assertion-msg {
    color: #c2415d;
    font-family: monospace;
    font-size: 11px;
  }

  .test-actions { display: flex; gap: 8px; }

  .action-link {
    font-size: 11px;
    color: #7b6cb5;
    border: 1px solid #ddd6f0;
    border-radius: 4px;
    padding: 3px 8px;
    cursor: pointer;
    background: white;
  }
  .action-link:hover {
    background: #f0ebf8;
    border-color: #b09ed8;
    color: #4a3488;
  }

  .results-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: #faf8fd;
    border-top: 1px solid #ede8f7;
    font-size: 11px;
    color: #8b7aaa;
  }

  .exit-fail { color: #c2415d; font-weight: 500; }
</style>
```

---

## Task 4: Wire TestResults into App.svelte

**Files:**
- Modify: `src/App.svelte`

- [ ] **Step 1: Add the import**

In `App.svelte`, after the existing component imports (around line 23–24 where `StepEditor` and `ThemedSelect` are imported), add:

```svelte
  import TestResults from "./TestResults.svelte";
```

- [ ] **Step 2: Add `testRunning` state and remove `output`**

In the state declarations block (around line 66–67), remove:

```svelte
  let output = "";
```

And add in its place:

```svelte
  let testRunning = false;
```

- [ ] **Step 3: Update `runYapitest`**

Replace the existing `runYapitest` function (lines 971–979):

```svelte
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
```

- [ ] **Step 4: Add `handleNavigate`**

Add this function anywhere near `runYapitest` (after it is fine):

```svelte
  function handleNavigate(e: CustomEvent<{ filePath: string; testName: string }>) {
    const file = files.find((f) => f.relative_path === e.detail.filePath);
    if (file) selectTest(file, e.detail.testName);
  }
```

- [ ] **Step 5: Replace the console section**

Find and replace the entire `<section class="console">` block (lines 2058–2066):

```svelte
    <section class="console">
      <div>
        <h3>Run Output</h3>
        {#if runResult}
          <span class:fail={runResult.status !== 0}>exit {runResult.status ?? "unknown"}</span>
        {/if}
      </div>
      <pre>{output || "No yapitest run yet."}</pre>
    </section>
```

Replace with:

```svelte
    <TestResults {runResult} running={testRunning} on:navigate={handleNavigate} />
```

- [ ] **Step 6: Check for remaining `output` references**

Search for any remaining uses of the `output` variable and remove them. The only one should have been the `<pre>` block just replaced. Also check that `runResult.stdout` and `runResult.stderr` are not referenced anywhere in the template.

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Run the app and verify**

```bash
npm run tauri dev
```

Open the app, run a test suite, and confirm:
- The results panel shows the pass/fail split tree
- Failed tests start expanded with assertion detail visible
- Passed section starts collapsed
- Clicking section headers toggles them
- Clicking a test row expands/collapses it
- "Go to test" navigates the sidebar to that test and loads it in the builder
