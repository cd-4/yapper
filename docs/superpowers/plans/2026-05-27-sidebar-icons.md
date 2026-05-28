# Sidebar Icon Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the text "Open" button with an icon, add Save / Save All / Run icon buttons to both the collapsed rail and a new uncollapsed toolbar row, and implement `saveAll()`.

**Architecture:** All changes are in `src/App.svelte`. A new `saveAll()` function groups dirty drafts by file, applies replacements, and writes each file once. A new `sidebar-toolbar` div (uncollapsed only) holds the four action buttons; the collapsed rail gets Save and SaveAll added alongside existing buttons.

**Tech Stack:** Svelte 5, TypeScript, lucide-svelte icons, Tauri invoke for file I/O.

---

### Task 1: Add `saveAll()` function

**Files:**
- Modify: `src/App.svelte` (script block, after `saveDraft()` around line 938)

- [ ] **Step 1: Insert `saveAll()` after `saveDraft()`**

Add this function immediately after the closing brace of `saveDraft()` (~line 938):

```typescript
  async function saveAll() {
    const toSave: Record<string, TestDraft> = {};

    for (const [key, { draft: d }] of Object.entries(dirtyDrafts)) {
      toSave[key] = d;
    }
    if (editingTest && dirty) {
      toSave[selectedTestKey] = draft;
    }

    if (Object.keys(toSave).length === 0) return;

    const byFile = new Map<string, Map<string, TestDraft>>();
    for (const [key, d] of Object.entries(toSave)) {
      const hashIdx = key.indexOf("#");
      const filePath = key.slice(0, hashIdx);
      const testName = key.slice(hashIdx + 1);
      if (!byFile.has(filePath)) byFile.set(filePath, new Map());
      byFile.get(filePath)!.set(testName, d);
    }

    for (const [filePath, tests] of byFile) {
      let contents = await call<string>("read_yaml_file", {
        root: rootPath.trim(),
        relativePath: filePath,
      });
      for (const [testName, testDraft] of tests) {
        const updated = replaceTestDraft(contents, testName, testDraft);
        if (updated) contents = updated;
      }
      await call("write_yaml_file", {
        root: rootPath.trim(),
        relativePath: filePath,
        contents,
      });
    }

    dirtyDrafts = {};
    if (editingTest && dirty) {
      editor = buildTestYaml(draft);
      original = editor;
    }
    await scan();
    message = "Saved all";
  }
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/charliedudzik/repos/yapper && npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add saveAll function to batch-save all dirty tests"
```

---

### Task 2: Add `sidebar-toolbar` to uncollapsed sidebar

**Files:**
- Modify: `src/App.svelte` (template, sidebar section ~lines 1533–1553)
- Modify: `src/styles.css` (add `.sidebar-toolbar` styles)

- [ ] **Step 1: Add toolbar div after `sidebar-head` in the `{:else}` branch**

Find this block (around line 1533):

```svelte
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
```

Replace with:

```svelte
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
      <div class="sidebar-toolbar">
        <button
          class="icon-button"
          on:click={chooseRoot}
          disabled={busy}
          aria-label="Open project"
          title="Open project"
        >
          <FolderOpen size={18} />
        </button>
        <button
          class="icon-button"
          on:click={saveDraft}
          disabled={!editingTest || !dirty || busy || !rootPath}
          aria-label="Save test"
          title="Save test"
        >
          <Save size={18} />
        </button>
        <button
          class="icon-button"
          on:click={saveAll}
          disabled={allDirtyTestKeys.size === 0 || busy || !rootPath}
          aria-label="Save all"
          title="Save all"
        >
          <SaveAll size={18} />
        </button>
        <button
          class="icon-button run-button"
          on:click={runCurrentTest}
          on:contextmenu={openRunMenu}
          disabled={busy || !rootPath}
          aria-label="Run current test"
          title="Run current test"
        >
          <Play size={18} />
        </button>
      </div>
    {/if}
```

- [ ] **Step 2: Remove the text "Open" button from `sidebar-body`**

Find and remove this line inside `sidebar-body` (~line 1553):

```svelte
        <button class="open-root-button" on:click={chooseRoot} disabled={busy}>Open</button>
```

- [ ] **Step 3: Add `.sidebar-toolbar` CSS to `src/styles.css`**

Read `src/styles.css` first to find the right place (near `.sidebar-head`), then add:

```css
.sidebar-toolbar {
  display: flex;
  gap: 2px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
}
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/charliedudzik/repos/yapper && npm run check
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.svelte src/styles.css
git commit -m "feat: add sidebar toolbar with Open/Save/SaveAll/Run icon buttons"
```

---

### Task 3: Add Save and SaveAll buttons to collapsed rail

**Files:**
- Modify: `src/App.svelte` (template, collapsed-rail section ~lines 1494–1532)

- [ ] **Step 1: Insert Save and SaveAll buttons after the existing Play button in the collapsed rail**

Find the existing Play button block in the collapsed rail (around line 1505):

```svelte
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
```

Insert two new buttons between the Play button and the FolderOpen button:

```svelte
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
          on:click={saveDraft}
          disabled={!editingTest || !dirty || busy || !rootPath}
          aria-label="Save test"
          title="Save test"
        >
          <Save size={18} />
        </button>
        <button
          class="icon-button rail-button"
          on:click={saveAll}
          disabled={allDirtyTestKeys.size === 0 || busy || !rootPath}
          aria-label="Save all"
          title="Save all"
        >
          <SaveAll size={18} />
        </button>
        <button
          class="icon-button rail-button"
          on:click={chooseRoot}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/charliedudzik/repos/yapper && npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add Save and SaveAll icon buttons to collapsed sidebar rail"
```

---

### Task 4: Manual verification

- [ ] **Step 1: Run the app**

```bash
cd /Users/charliedudzik/repos/yapper && npm run tauri:dev
```

- [ ] **Step 2: Verify uncollapsed sidebar**

  - Toolbar row appears below header with 4 icon buttons (FolderOpen, Save, SaveAll, Play)
  - No "Open" text button exists in the sidebar body
  - Save is disabled when no test is selected or when the test is clean
  - Save All is disabled when there are no dirty tests
  - Clicking Save saves the current test and clears its dirty dot
  - Making two tests dirty and clicking Save All saves both and clears all dirty dots

- [ ] **Step 3: Verify collapsed rail**

  - Collapse the sidebar — rail shows Play, Save, SaveAll in order after the expand button
  - Disabled states match the uncollapsed toolbar behavior
