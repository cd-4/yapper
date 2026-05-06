<script context="module" lang="ts">
  export type SelectOption = {
    value: string;
    label: string;
  };
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { ChevronDown } from "lucide-svelte";

  export let value = "";
  export let options: SelectOption[] = [];
  export let ariaLabel = "";
  export let onSelect: () => void = () => {};

  let open = false;
  let activeIndex = 0;
  let root: HTMLDivElement;

  $: selected = options.find((option) => option.value === value) ?? (value ? { value, label: value } : options[0]);
  $: activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  function choose(option: SelectOption) {
    value = option.value;
    open = false;
    onSelect();
  }

  function move(delta: number) {
    if (!options.length) return;
    activeIndex = (activeIndex + delta + options.length) % options.length;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) open = true;
      else move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) open = true;
      else move(-1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open && options[activeIndex]) choose(options[activeIndex]);
      else open = true;
    } else if (event.key === "Escape") {
      open = false;
    }
  }

  onMount(() => {
    const close = (event: MouseEvent) => {
      if (root && !root.contains(event.target as Node)) open = false;
    };

    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  });
</script>

<div class="themed-select" bind:this={root}>
  <button
    type="button"
    class="themed-select-trigger"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={ariaLabel}
    on:click={() => (open = !open)}
    on:keydown={handleKeydown}
  >
    <span>{selected?.label ?? ""}</span>
    <ChevronDown size={16} />
  </button>

  {#if open}
    <div class="themed-select-menu" role="listbox" tabindex="-1">
      {#each options as option, index}
        <button
          type="button"
          class:active={index === activeIndex}
          class:selected={option.value === value}
          role="option"
          aria-selected={option.value === value}
          on:mouseenter={() => (activeIndex = index)}
          on:click={() => choose(option)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  {/if}
</div>
