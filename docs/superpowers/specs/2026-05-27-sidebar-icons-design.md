# Sidebar Icon Buttons Design

## Summary

Replace the text "Open" button in the sidebar with icon buttons, and add Save, Save All, and Run icon buttons to both the collapsed and uncollapsed sidebar.

## Changes

### Uncollapsed sidebar

- Keep the existing `sidebar-head` (Yapper branding + PanelLeftClose) unchanged.
- Add a new `sidebar-toolbar` row directly below the header containing four icon buttons:
  - `FolderOpen` — open project (`chooseRoot()`, disabled when `busy`)
  - `Save` — save current test (`saveDraft()`, disabled when `!editingTest || !dirty || busy || !rootPath`)
  - `SaveAll` — save all dirty tests (`saveAll()`, disabled when `allDirtyTestKeys.size === 0 || busy || !rootPath`)
  - `Play` — run current test (`runCurrentTest()` on click, `openRunMenu()` on right-click, disabled when `busy || !rootPath`)
- Remove the existing `<button class="open-root-button">Open</button>` from the sidebar body.

### Collapsed rail

- Add `Save` and `SaveAll` icon buttons to the existing vertical strip, positioned after the existing `Play` button and before `FolderTree`.
  - Same disabled states as uncollapsed versions.

### New `saveAll()` function

Groups all dirty tests (from `dirtyDrafts` + the currently active dirty test if `editingTest && dirty`) by file path. For each file:
1. Read file contents.
2. Apply `replaceTestDraft()` for each dirty test in that file (using the key's test name as the original name).
3. Write updated contents back.

After all files are written:
- Clear `dirtyDrafts = {}`.
- If the active test was dirty, reset `original = buildTestYaml(draft)` and `editor = original`.
- Call `scan()` to refresh the tree.
- Set `message = "Saved all"`.

## Files Changed

- `src/App.svelte` — only file affected.
