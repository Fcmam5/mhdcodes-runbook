<script lang="ts">
  import type { NotebookSummary } from "../../../shared/types";
  import { runs } from "../lib/runs";
  import SessionDot from "./SessionDot.svelte";

  interface Props {
    notebooks: NotebookSummary[];
    selected: string | null;
    onselect: (path: string) => void;
  }

  const { notebooks, selected, onselect }: Props = $props();
</script>

<nav
  class="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-zinc-200 p-3 dark:border-zinc-800"
>
  {#each notebooks as notebook (notebook.path)}
    <button
      type="button"
      class={[
        "flex items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm",
        notebook.path === selected
          ? "bg-zinc-200 font-medium dark:bg-zinc-800"
          : "hover:bg-zinc-100 dark:hover:bg-zinc-900",
      ]}
      aria-current={notebook.path === selected ? "page" : undefined}
      title={notebook.title}
      onclick={() => onselect(notebook.path)}
    >
      <span class="min-w-0 flex-1 truncate">{notebook.title}</span>
      <!-- Notebooks with a session show its dot, so a cell running in the background is visible. -->
      {#if $runs[notebook.path]?.session}
        <SessionDot state={$runs[notebook.path]?.session ?? null} compact />
      {/if}
    </button>
  {/each}
</nav>
