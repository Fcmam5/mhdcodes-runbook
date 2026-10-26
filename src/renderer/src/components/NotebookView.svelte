<script lang="ts">
  import type { Notebook } from "../../../shared/types";
  import MarkdownCell from "./MarkdownCell.svelte";
  import ShellCell from "./ShellCell.svelte";

  const { notebook }: { notebook: Notebook } = $props();
</script>

<article class="mx-auto flex max-w-3xl flex-col gap-4 px-8 py-6">
  <header class="border-b border-zinc-200 pb-4 dark:border-zinc-800">
    <h1 class="text-2xl font-semibold tracking-tight">{notebook.title}</h1>
    {#if notebook.tags.length > 0}
      <p class="mt-1 text-sm text-zinc-500">tags: {notebook.tags.join(", ")}</p>
    {/if}
  </header>

  {#each notebook.cells as cell (cell.id)}
    {#if cell.type === "shell"}
      <ShellCell source={cell.source} info={cell.info ?? "bash"} />
    {:else}
      <MarkdownCell source={cell.source} />
    {/if}
  {:else}
    <p class="py-12 text-center text-zinc-500">This runbook is empty</p>
  {/each}
</article>
