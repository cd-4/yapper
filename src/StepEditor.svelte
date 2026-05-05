<script lang="ts">
  import {
    ChevronDown,
    ChevronRight,
    Eye,
    EyeOff,
    GripVertical,
    Plus,
    Trash2,
  } from "lucide-svelte";
  import type { StepDraft } from "./types";

  type SuggestionMenu = {
    key: string;
    index: number;
    left: number;
    top: number;
    items: string[];
  };

  export let step: StepDraft;
  export let index: number;
  export let stepCount: number;
  export let stepSets: string[] = [];
  export let suggestionMenu: SuggestionMenu;
  export let keyPrefix = "";
  export let nested = false;
  export let draggable = false;
  export let draggingStepUid = "";
  export let dragOverStepUid = "";
  export let onChange: () => void = () => {};
  export let onToggleStep: (step: StepDraft) => void;
  export let onToggleSection: (
    step: StepDraft,
    field: "headersCollapsed" | "bodyCollapsed" | "assertionsCollapsed" | "optionsCollapsed",
  ) => void;
  export let onAddHeader: (step: StepDraft) => void;
  export let onRemoveHeader: (step: StepDraft, id: string) => void;
  export let onAddAssertionHeader: (step: StepDraft) => void;
  export let onRemoveAssertionHeader: (step: StepDraft, id: string) => void;
  export let onRemoveStep: (uid: string) => void;
  export let onDragStart: (event: DragEvent, uid: string) => void = () => {};
  export let onDragOver: (event: DragEvent, uid: string) => void = () => {};
  export let onDrop: (event: DragEvent, uid: string) => void = () => {};
  export let onDragEnd: () => void = () => {};
  export let updateSuggestionMenu: (event: Event, key: string) => void;
  export let handleSuggestionKeydown: (
    event: KeyboardEvent,
    key: string,
    insert: (suggestion: string) => void,
  ) => void;
  export let insertStepSuggestion: (step: StepDraft, field: "path" | "body" | "url", value: string) => void;
  export let insertHeaderSuggestion: (header: { value: string }, value: string) => void;
  export let insertResponseBodySuggestion: (step: StepDraft, value: string) => void;

  const fieldKey = (field: string) => (keyPrefix ? `${step.uid}:${keyPrefix}-${field}` : `${step.uid}:${field}`);
  const headerKey = (id: string, field: string) => (keyPrefix ? `${id}:${keyPrefix}-${field}` : `${id}:${field}`);
</script>

<section
  class="step-card"
  class:nested-step={nested}
  class:dragging={draggingStepUid === step.uid}
  class:drag-over={dragOverStepUid === step.uid && draggingStepUid !== step.uid}
  role="listitem"
  on:dragover={(event) => draggable && onDragOver(event, step.uid)}
  on:drop={(event) => draggable && onDrop(event, step.uid)}
>
  <div class="step-title" class:config-step-title={!draggable}>
    {#if draggable}
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
    {/if}
    <button
      class="icon-button"
      on:click={() => onToggleStep(step)}
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
    <select bind:value={step.type} on:change={onChange}>
      <option value="request">Request</option>
      <option value="reference">Config step set</option>
    </select>
    <button
      class="icon-button danger-button"
      on:click={() => onRemoveStep(step.uid)}
      disabled={stepCount === 1}
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
        <select bind:value={step.referenceName} on:change={onChange}>
          <option value="">Select step set</option>
          {#each stepSets as stepSet}
            <option value={stepSet}>{stepSet}</option>
          {/each}
        </select>
      </label>
    </div>
  {:else}
    <div class="request-line">
      <select bind:value={step.method} on:change={onChange}>
        {#each ["GET", "POST", "PUT", "PATCH", "DELETE"] as method}
          <option>{method}</option>
        {/each}
      </select>
      <div class="suggest-wrap">
        <input
          bind:value={step.path}
          on:focus={(event) => updateSuggestionMenu(event, fieldKey("path"))}
          on:click={(event) => updateSuggestionMenu(event, fieldKey("path"))}
          on:input={(event) => {
            onChange();
            updateSuggestionMenu(event, fieldKey("path"));
          }}
          on:keydown={(event) =>
            handleSuggestionKeydown(event, fieldKey("path"), (suggestion) =>
              insertStepSuggestion(step, "path", suggestion),
            )}
          placeholder="/api/resource"
        />
        {#if suggestionMenu.key === fieldKey("path")}
          <div class="suggestions" style:left={`${suggestionMenu.left}px`} style:top={`${suggestionMenu.top}px`}>
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
        <input bind:value={step.stepId} on:input={onChange} />
      </label>
    </div>

    <section class="step-section" class:collapsed-section={step.optionsCollapsed}>
      <div class="section-head">
        <button
          class="icon-button"
          on:click={() => onToggleSection(step, "optionsCollapsed")}
          aria-label={step.optionsCollapsed ? "Show options" : "Hide options"}
          title={step.optionsCollapsed ? "Show options" : "Hide options"}
        >
          {#if step.optionsCollapsed}
            <ChevronRight size={18} />
          {:else}
            <ChevronDown size={18} />
          {/if}
        </button>
        <span>Options</span>
      </div>
      {#if !step.optionsCollapsed}
        <div class="grid step-options-grid">
          <label class="field">
            <span>URL</span>
            <div class="suggest-wrap">
              <input
                bind:value={step.url}
                on:focus={(event) => updateSuggestionMenu(event, fieldKey("url"))}
                on:click={(event) => updateSuggestionMenu(event, fieldKey("url"))}
                on:input={(event) => {
                  onChange();
                  updateSuggestionMenu(event, fieldKey("url"));
                }}
                on:keydown={(event) =>
                  handleSuggestionKeydown(event, fieldKey("url"), (suggestion) =>
                    insertStepSuggestion(step, "url", suggestion),
                  )}
                placeholder="$urls.base"
              />
              {#if suggestionMenu.key === fieldKey("url")}
                <div class="suggestions" style:left={`${suggestionMenu.left}px`} style:top={`${suggestionMenu.top}px`}>
                  {#each suggestionMenu.items as suggestion, suggestionIndex}
                    <button
                      class:active={suggestionMenu.index === suggestionIndex}
                      on:mousedown|preventDefault={() => insertStepSuggestion(step, "url", suggestion)}
                    >
                      {suggestion}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </label>
          <label class="field">
            <span>Wait before</span>
            <input bind:value={step.waitBefore} on:input={onChange} placeholder="500ms" />
          </label>
          <label class="field">
            <span>Wait after</span>
            <input bind:value={step.waitAfter} on:input={onChange} placeholder="2s" />
          </label>
          <label class="field">
            <span>Retry</span>
            <input type="number" min="0" step="1" bind:value={step.retry} on:input={onChange} placeholder="0" />
          </label>
        </div>
      {/if}
    </section>

    <section class="step-section" class:collapsed-section={step.headersCollapsed}>
      <div class="section-head">
        <button
          class="icon-button"
          on:click={() => onToggleSection(step, "headersCollapsed")}
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
          on:click={() => onAddHeader(step)}
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
            <input bind:value={header.name} on:input={onChange} placeholder="Name" />
            <div class="suggest-wrap">
              <input
                bind:value={header.value}
                on:focus={(event) => updateSuggestionMenu(event, headerKey(header.id, "value"))}
                on:click={(event) => updateSuggestionMenu(event, headerKey(header.id, "value"))}
                on:input={(event) => {
                  onChange();
                  updateSuggestionMenu(event, headerKey(header.id, "value"));
                }}
                on:keydown={(event) =>
                  handleSuggestionKeydown(event, headerKey(header.id, "value"), (suggestion) =>
                    insertHeaderSuggestion(header, suggestion),
                  )}
                placeholder="Value"
              />
              {#if suggestionMenu.key === headerKey(header.id, "value")}
                <div class="suggestions" style:left={`${suggestionMenu.left}px`} style:top={`${suggestionMenu.top}px`}>
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
              on:click={() => onRemoveHeader(step, header.id)}
              aria-label="Remove header"
              title="Remove header"
            >
              <Trash2 size={18} />
            </button>
          </div>
        {/each}
      {/if}
    </section>

    <section class="step-section" class:collapsed-section={step.bodyCollapsed}>
      <div class="section-head">
        <button
          class="icon-button"
          on:click={() => onToggleSection(step, "bodyCollapsed")}
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
            on:focus={(event) => updateSuggestionMenu(event, fieldKey("body"))}
            on:click={(event) => updateSuggestionMenu(event, fieldKey("body"))}
            on:input={(event) => {
              onChange();
              updateSuggestionMenu(event, fieldKey("body"));
            }}
            on:keydown={(event) =>
              handleSuggestionKeydown(event, fieldKey("body"), (suggestion) =>
                insertStepSuggestion(step, "body", suggestion),
              )}
            spellcheck="false"
            placeholder="title: Example"
          ></textarea>
          {#if suggestionMenu.key === fieldKey("body")}
            <div class="suggestions" style:left={`${suggestionMenu.left}px`} style:top={`${suggestionMenu.top}px`}>
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

    <section class="step-section" class:collapsed-section={step.assertionsCollapsed}>
      <div class="section-head">
        <button
          class="icon-button"
          on:click={() => onToggleSection(step, "assertionsCollapsed")}
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
            <input bind:value={step.statusCode} on:input={onChange} />
          </label>
        </div>
        <div class="assertion-subsection">
          <div class="assertion-subsection-head">
            <span>Header Assertions</span>
            <button
              class="icon-button"
              on:click={() => onAddAssertionHeader(step)}
              aria-label="Add header assertion"
              title="Add header assertion"
            >
              <Plus size={18} />
            </button>
          </div>
          {#each step.assertionHeaders as header (header.id)}
            <div class="header-row">
              <input bind:value={header.name} on:input={onChange} placeholder="Name" />
              <div class="suggest-wrap">
                <input
                  bind:value={header.value}
                  on:focus={(event) => updateSuggestionMenu(event, headerKey(header.id, "assertion-value"))}
                  on:click={(event) => updateSuggestionMenu(event, headerKey(header.id, "assertion-value"))}
                  on:input={(event) => {
                    onChange();
                    updateSuggestionMenu(event, headerKey(header.id, "assertion-value"));
                  }}
                  on:keydown={(event) =>
                    handleSuggestionKeydown(event, headerKey(header.id, "assertion-value"), (suggestion) =>
                      insertHeaderSuggestion(header, suggestion),
                    )}
                  placeholder="Value"
                />
                {#if suggestionMenu.key === headerKey(header.id, "assertion-value")}
                  <div class="suggestions" style:left={`${suggestionMenu.left}px`} style:top={`${suggestionMenu.top}px`}>
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
                on:click={() => onRemoveAssertionHeader(step, header.id)}
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
              on:focus={(event) => updateSuggestionMenu(event, fieldKey("response-body"))}
              on:click={(event) => updateSuggestionMenu(event, fieldKey("response-body"))}
              on:input={(event) => {
                onChange();
                updateSuggestionMenu(event, fieldKey("response-body"));
              }}
              on:keydown={(event) =>
                handleSuggestionKeydown(event, fieldKey("response-body"), (suggestion) =>
                  insertResponseBodySuggestion(step, suggestion),
                )}
              spellcheck="false"
              placeholder={"title: Example\nid: $create-user.response.id"}
            ></textarea>
            {#if suggestionMenu.key === fieldKey("response-body")}
              <div class="suggestions" style:left={`${suggestionMenu.left}px`} style:top={`${suggestionMenu.top}px`}>
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
