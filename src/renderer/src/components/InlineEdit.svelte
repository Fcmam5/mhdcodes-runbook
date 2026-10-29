<script lang="ts">
  import type { Snippet } from "svelte";

  // Text shown as-is until clicked, then edited in place (SPEC §9.3: title and tags).
  // Enter or clicking away keeps the change; Esc drops it. The field takes the shown
  // text's size, so nothing moves when editing starts. After Enter or Esc the keyboard
  // is back on the text; `focusKey` marks it for whoever has to put it back later.
  interface Props {
    value: string;
    label: string;
    placeholder?: string;
    textClass?: string; // the size and weight of both the text and the field
    oncommit: (value: string) => void;
    focusKey?: string;
    children: Snippet;
  }

  const { value, label, placeholder = "", textClass = "", oncommit, focusKey, children }: Props =
    $props();

  let editing = $state(false);
  let draft = $state("");
  // Left from the keyboard: the text takes the focus back when it is shown again.
  let refocus = false;

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

  const focusIfLeftByKeyboard = (button: HTMLButtonElement): void => {
    if (refocus) button.focus();
    refocus = false;
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
      if (event.key !== "Enter" && event.key !== "Escape") return;
      // The text takes the focus back at once: unprevented, this Enter would go on to
      // click it and start editing again.
      event.preventDefault();
      refocus = true;
      finish(event.key === "Enter");
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
    data-focus-key={focusKey}
    {@attach focusIfLeftByKeyboard}
    onclick={start}
  >
    {@render children()}
  </button>
{/if}
