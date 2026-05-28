<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { RunResult, TestResultItem } from "./types";

  export let runResult: RunResult | null;
  export let running: boolean;

  const dispatch = createEventDispatcher<{
    navigate: { filePath: string; testName: string };
  }>();

  let detailOpen = false;
  let expandedTests = new Set<string>();
  let failedOpen = true;
  let passedOpen = false;

  $: failedTests = runResult?.tests.filter((t) => !t.passed) ?? [];
  $: passedTests = runResult?.tests.filter((t) => t.passed) ?? [];

  $: if (runResult) {
    expandedTests = new Set();
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
      detailOpen = false;
      dispatch("navigate", { filePath: item.file_path, testName: item.name });
    }
  }
</script>

<div class="results-wrap">
  {#if detailOpen && runResult}
    <div class="results-detail">
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
                  <div class="test-row-header" on:click={() => toggleTest(test.name)}>
                    <span class="status-dot dot-fail"></span>
                    <span class="test-name">{test.name}</span>
                    {#if test.file_path}
                      <span class="test-meta">{test.file_path} · {test.duration_ms}ms</span>
                    {:else}
                      <span class="test-meta">{test.duration_ms}ms</span>
                    {/if}
                    {#if test.file_path}
                      <button class="test-nav" on:click|stopPropagation={() => navigate(test)}>↗</button>
                    {/if}
                  </div>
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
                <div class="test-row-header" on:click={() => toggleTest(test.name)}>
                  <span class="status-dot dot-pass"></span>
                  <span class="test-name">{test.name}</span>
                  {#if test.file_path}
                    <span class="test-meta">{test.file_path} · {test.duration_ms}ms</span>
                  {:else}
                    <span class="test-meta">{test.duration_ms}ms</span>
                  {/if}
                  {#if test.file_path}
                    <button class="test-nav" on:click|stopPropagation={() => navigate(test)}>↗</button>
                  {/if}
                </div>
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
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

    </div>
  {/if}

  <button
    class="results-bar"
    class:has-failures={runResult && failedTests.length > 0}
    class:all-passed={runResult && failedTests.length === 0}
    on:click={() => { if (runResult) detailOpen = !detailOpen; }}
    disabled={!runResult}
  >
    <span class="bar-chevron" class:open={detailOpen}>▶</span>
    <span class="bar-label">Run Output</span>
    {#if runResult}
      <span class="bar-command">{runResult.command}</span>
      <div class="bar-badges">
        {#if failedTests.length > 0}
          <span class="badge badge-fail">✗ {failedTests.length} failed</span>
        {/if}
        <span class="badge badge-pass">✓ {passedTests.length} passed</span>
        <span class="bar-duration">{runResult.elapsed_ms}ms</span>
      </div>
    {:else}
      <span class="bar-running">Running…</span>
    {/if}
  </button>
</div>

<style>
  .results-wrap {
    border-top: 1px solid #ddd6f0;
    background: #ffffff;
    flex-shrink: 0;
    position: relative;
    z-index: 1;
    box-shadow: 0 -6px 16px rgba(36, 23, 71, 0.14);
  }

  /* ── Detail panel (tree) ── */
  .results-detail {
    max-height: 55vh;
    overflow-y: auto;
    border-bottom: 1px solid #ede8f7;
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
    gap: 6px;
    width: 100%;
    padding: 4px 10px;
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

  .section-title { font-size: 12px; font-weight: 600; }
  .section-title.fail { color: #c2415d; }
  .section-title.pass { color: #217a63; }

  .section-count { font-size: 11px; color: #8b7aaa; margin-left: auto; }

  .test-row { border-bottom: 1px solid #f3eeff; }
  .test-row:last-child { border-bottom: none; }

  .test-row-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 1px 20px 1px 20px;
    cursor: pointer;
    user-select: none;
  }
  .test-row-header:hover { background: #faf8fd; }

  .status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .dot-pass { background: #217a63; }
  .dot-fail { background: #c2415d; }

  .test-name { font-size: 13px; color: #2e2252; flex: 1; text-align: left; }
  .test-meta { font-size: 11px; color: #a098c0; font-family: monospace; white-space: nowrap; }

  .test-nav {
    font-size: 13px;
    color: #a098c0;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 2px;
    flex-shrink: 0;
    line-height: 1;
  }
  .test-nav:hover { color: #4a3488; }

  .test-detail {
    padding: 4px 10px 6px 34px;
    background: #f8f5ff;
    border-top: 1px solid #ede8f7;
  }

  .assertion-list { display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px; }

  .assertion { display: flex; align-items: flex-start; gap: 5px; font-size: 11px; }

  .assertion-icon { flex-shrink: 0; margin-top: 1px; font-weight: 600; }
  .assertion-icon.pass { color: #217a63; }
  .assertion-icon.fail { color: #c2415d; }

  .assertion-body { display: flex; flex-direction: column; gap: 1px; }
  .assertion-name { color: #3d2f6e; }
  .assertion-msg { color: #c2415d; font-family: monospace; font-size: 11px; }

  /* ── Collapsed bar ── */
  .results-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 12px;
    background: #faf8fd;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .results-bar:hover:not(:disabled) { background: #f3eeff; }
  .results-bar:disabled { cursor: default; }
  .results-bar.has-failures { background: #fff5f7; }
  .results-bar.has-failures:hover { background: #ffe8ee; }

  .bar-chevron {
    font-size: 9px;
    color: #8b7aaa;
    transition: transform 0.15s;
    display: inline-block;
    flex-shrink: 0;
  }
  .bar-chevron.open { transform: rotate(-90deg); }

  .bar-label { font-size: 12px; font-weight: 500; color: #3d2f6e; }
  .has-failures .bar-label { color: #c2415d; }
  .all-passed .bar-label { color: #217a63; }

  .bar-command { font-size: 11px; font-family: monospace; color: #8b7aaa; flex: 1; }

  .bar-running { font-size: 11px; color: #8b7aaa; font-style: italic; flex: 1; }

  .bar-badges { display: flex; gap: 6px; align-items: center; margin-left: auto; }

  .bar-duration { font-size: 11px; color: #a098c0; font-family: monospace; }

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
</style>
