<script lang="ts">
  import type { Snippet } from "svelte";

  // Text shown as-is until clicked, then edited in place (SPEC §9.3: title and tags).
  // Enter or clicking away keeps the change; Esc drops it.
  interface Props {
    value: string;
    label: string;
    placeholder?: string;
    inputClass?: string;
    oncommit: (value: string) => void;
    children: Snippet;
  }

  const { value, label, placeholder = "", inputClass = "", oncommit, children }: Props = $props();

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
      "w-full rounded-md border px-2 py-0.5 outline-none focus:border-blue-500 border-zinc-700 bg-zinc-900",
      inputClass,
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
    class="-mx-2 block w-[calc(100%+1rem)] cursor-text rounded-md px-2 py-0.5 text-left hover:bg-zinc-900"
    title={`Edit ${label.toLowerCase()}`}
    onclick={start}
  >
    {@render children()}
  </button>
{/if}
