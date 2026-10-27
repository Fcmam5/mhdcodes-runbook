<script lang="ts">
  import { untrack } from "svelte";
  import { markdownEditor } from "../lib/codemirror";
  import { renderMarkdown } from "../lib/markdown";
  import CellMenu from "./CellMenu.svelte";

  interface Props {
    source: string;
    autoEdit?: boolean; // a new cell starts in the editor
    onchange: (source: string) => void;
    ondelete: () => void;
  }

  const { source, autoEdit = false, onchange, ondelete }: Props = $props();

  // Rendered by default; click or Enter edits, Esc or clicking outside renders again (SPEC §9.3).
  let editing = $state(untrack(() => autoEdit));
  const html = $derived(renderMarkdown(source));

  function edit(event: MouseEvent | KeyboardEvent): void {
    // Links keep working: they open in the browser instead of starting an edit.
    if (event.target instanceof Element && event.target.closest("a")) return;
    editing = true;
  }

  // Created when editing starts, from the source at that moment.
  function editor(): ReturnType<typeof markdownEditor> {
    return markdownEditor({
      initial: untrack(() => source),
      onChange: onchange,
      onExit: () => (editing = false),
      autofocus: true,
    });
  }
</script>

<div class="group relative">
  <div class="absolute -top-1 right-0 z-10 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
    <CellMenu items={[{ label: "Delete cell", onselect: ondelete, danger: true }]} />
  </div>
  {#if editing}
    <div
      class="rounded-lg border border-zinc-300 dark:border-zinc-700"
      {@attach editor()}
    ></div>
  {:else}
    <!-- Safe: markdown-it runs with html: false, so the output contains no raw HTML. -->
    <div
      class="markdown min-h-6 cursor-text rounded-lg focus-visible:outline-2 focus-visible:outline-blue-500"
      role="button"
      tabindex="0"
      aria-label="Edit markdown cell"
      onclick={edit}
      onkeydown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) {
          event.preventDefault();
          edit(event);
        }
      }}
    >
      {#if source.trim() === ""}
        <p class="text-zinc-400 italic">Empty markdown cell. Click to write.</p>
      {:else}
        {@html html}
      {/if}
    </div>
  {/if}
</div>
