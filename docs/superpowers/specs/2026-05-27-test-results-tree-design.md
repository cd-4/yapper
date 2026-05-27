# Test Results Tree View — Design Spec

**Date:** 2026-05-27  
**Status:** Approved

## Overview

Replace the current raw-text console output (a `<pre>` block rendering stdout) with a structured, interactive tree view component. Tests are split into failed/passed sections; each test expands inline to show assertion-level detail and a navigation action.

---

## Backend Changes

### New serializable types in `lib.rs`

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
    file_path: Option<String>,   // relative to project root
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

The existing `stdout: String` and `stderr: String` fields are removed. `format_run_output` is also removed.

### Mapping in `run_yapitest`

After `yapitest::run_path_blocking` returns `Vec<TestResult>`, map each result:

- `name` — `r.name().to_string()`
- `passed` — `r.passed()`
- `file_path` — `r.file_path()` stripped to a path relative to `root`; `None` if unavailable
- `duration_ms` — `r.duration_ms`
- `failure_message` — `r.get_failure_message().map(str::to_string)`
- `assertions` — collected from `r.assertions()`, each mapped to `AssertionData`

`status` is `Some(0)` if all tests pass, `Some(1)` otherwise.  
`elapsed_ms` is wall-clock time from before the `run_path_blocking` call to after.

---

## Frontend Changes

### Updated types in `types.ts`

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

The `output: string` variable in `App.svelte` is removed. `runResult: RunResult | null` is the sole source of truth.

### New component: `TestResults.svelte`

**Props:**
- `runResult: RunResult | null`
- `running: boolean`
- `onNavigate: (filePath: string, testName: string) => void`

**States:**
1. `runResult === null && !running` — placeholder: "No test run yet."
2. `running` — loading indicator (spinner or "Running…" text)
3. `runResult` present — tree view

**Tree structure:**

```
[header: "Run Output"  command  ✗ N failed  ✓ N passed]
[section: ✗ Failed — expanded by default]
  [test row: ● name  file.yaml · Xms  ▶]
    [expanded: assertion list + "↗ Go to test" button]
[section: ✓ Passed — collapsed by default]
  [test rows ...]
[footer: N tests · Xms total  exit N]
```

**Expand/collapse state:** tracked with a `Set<string>` of expanded test names, keyed by `name`. Toggled on row click.

**Section collapse:** failed section open by default; passed section closed by default. Each section header toggles its body.

**"Go to test" button:** visible inside the expanded detail of every test (not just failed). Clicking it calls `onNavigate(file_path, name)`. If `file_path` is null, the button is hidden.

### Changes in `App.svelte`

- Remove the `<section class="console">` block and the `output` variable.
- Add `<TestResults {runResult} {running} onNavigate={handleNavigate} />` in its place.
- Add `running: boolean = false` state variable, set to `true` before `invoke`, back to `false` after.
- Add `handleNavigate(filePath, testName)`: find the `FileEntry` in the loaded file tree by `relative_path === filePath`, then call the existing `selectTest(file, testName)`. If the file is not found in the tree (e.g., stale run result), do nothing.

---

## Styling

Match the existing app palette:
- Panel border: `#ddd6f0`, background: `#ffffff`
- Section headers: `#faf8fd` background
- Pass accent: `#217a63` / `#d9eee7`
- Fail accent: `#c2415d` / `#f6d7df`
- Expand chevron rotates `0° → 90°` on expand (CSS transition)
- Test row hover: `#faf8fd`

---

## What Is Not Changing

- `run_yapitest` command signature (root, target, test_name) — unchanged
- All run trigger points in `App.svelte` — unchanged
- The existing `selectTest` logic — reused as-is via `handleNavigate`
