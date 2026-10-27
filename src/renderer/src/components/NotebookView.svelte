<script lang="ts">
  import type { Notebook, SessionState } from "../../../shared/types";
  import MarkdownCell from "./MarkdownCell.svelte";
  import SessionDot from "./SessionDot.svelte";
  import ShellCell from "./ShellCell.svelte";

  const { notebook }: { notebook: Notebook } = $props();

  // null until the notebook's first run starts a session.
  let session: SessionState | null = $state(null);

  $effect(() =>
    window.api.onSessionState((event) => {
      if (event.notebookPath === notebook.path) session = event.state;
    }),
  );
</script>

<article class="mx-auto flex max-w-3xl flex-col gap-4 px-8 py-6">
  <header class="border-b border-zinc-200 pb-4 dark:border-zinc-800">
    <div class="flex items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold tracking-tight">{notebook.title}</h1>
      <SessionDot state={session} />
    </div>
    {#if notebook.tags.length > 0}
      <p class="mt-1 text-sm text-zinc-500">tags: {notebook.tags.join(", ")}</p>
    {/if}
  </header>

  {#each notebook.cells as cell (cell.id)}
    {#if cell.type === "shell"}
      <ShellCell notebookPath={notebook.path} {cell} />
    {:else}
      <MarkdownCell source={cell.source} />
    {/if}
  {:else}
    <p class="py-12 text-center text-zinc-500">This runbook is empty</p>
  {/each}
</article>
