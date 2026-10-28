<script lang="ts">
  import type { Snippet } from "svelte";

  // Text shown as-is until clicked, then edited in place (SPEC §9.3: title and tags).
  // Enter or clicking away keeps the change; Esc drops it. The field takes the shown
  // text's size, so nothing moves when editing starts.
  interface Props {
    value: string;
    label: string;
    placeholder?: string;
    textClass?: string; // the size and weight of both the text and the field
    oncommit: (value: string) => void;
    children: Snippet;
  }

  const { value, label, placeholder = "", textClass = "", oncommit, children }: Props = $props();

  let editing = $state(false);
  let draft = $state("");

  function start(): void {
    draft = value;
    editing = true;
  }

  function finish(keep: boolean): void {
    if (!editing) return;
    editing = false;
    if (keep && draft !== value) oncommit(draft);
  }

  const focusAndSelect = (input: HTMLInputElement): void => {
    input.focus();
    input.select();
  };
</script>

{#if editing}
  <input
    class={[
      "-mx-2 block w-[calc(100%+1rem)] rounded-row bg-raise px-2 text-ink outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-acc)_55%,transparent)]",
      textClass,
    ]}
    aria-label={label}
    {placeholder}
    bind:value={draft}
    {@attach focusAndSelect}
    onblur={() => finish(true)}
    onkeydown={(event) => {
      if (event.key === "Enter") finish(true);
      if (event.key === "Escape") finish(false);
    }}
  />
{:else}
  <button
    type="button"
    class={[
      "-mx-2 block w-[calc(100%+1rem)] cursor-text rounded-row px-2 text-left hover:bg-white/4",
      textClass,
    ]}
    title={`Edit ${label.toLowerCase()}`}
    onclick={start}
  >
    {@render children()}
  </button>
{/if}
