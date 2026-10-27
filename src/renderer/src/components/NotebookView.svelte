<script lang="ts">
  import { tick } from "svelte";
  import { messageOf } from "../../../shared/errors";
  import {
    deleteCell,
    insertCell,
    setCellSource,
    setTags,
  } from "../../../shared/notebook-edits";
  import { NO_NOTEBOOK_RUNS } from "../../../shared/run-store";
  import { startupExcerpt } from "../../../shared/startup-excerpt";
  import type { CellType, Notebook } from "../../../shared/types";
  import { notebooks } from "../lib/notebooks";
  import { runs } from "../lib/runs";
  import AddCell from "./AddCell.svelte";
  import InlineEdit from "./InlineEdit.svelte";
  import MarkdownCell from "./MarkdownCell.svelte";
  import SessionDot from "./SessionDot.svelte";
  import SessionNotice from "./SessionNotice.svelte";
  import ShellCell from "./ShellCell.svelte";

  // onrename: the title also names the file, so editing it renames the notebook (SPEC §8).
  const { notebook, onrename }: { notebook: Notebook; onrename: (title: string) => void } =
    $props();

  // The session state and its notice live in the run store, so they survive switching.
  const { session, end } = $derived($runs[notebook.path] ?? NO_NOTEBOOK_RUNS);
  let restartError: string | null = $state(null);
  // The cell just added: a markdown cell opens in its editor, a shell cell's editor
  // takes the focus.
  let added: string | null = $state(null);

  // Every edit goes through the notebook store, which autosaves it (SPEC §8).
  function edit(change: (notebook: Notebook) => Notebook): void {
    notebooks.edit(notebook.path, change);
  }

  function add(type: CellType, index: number): void {
    edit((current) => {
      const result = insertCell(current, type, index);
      added = result.cell.id;
      return result.notebook;
    });
  }

  let article: HTMLElement | undefined = $state();

  // Puts the keyboard on the cell at `index`: a shell cell's editor, or a markdown cell
  // as rendered (or its editor while editing). Nothing past the last cell.
  function focusCell(index: number): void {
    const cell = article?.querySelectorAll<HTMLElement>("[data-cell]")[index];
    cell?.querySelector<HTMLElement>("[data-focus-target], .cm-content")?.focus();
  }

  // From the keyboard, the cell that takes a deleted one's place gets the focus, so
  // several can be deleted in a row.
  async function removeCell(cellId: string, index: number): Promise<void> {
    const focused = article?.querySelectorAll("[data-cell]")[index]?.contains(document.activeElement);
    edit((current) => deleteCell(current, cellId));
    if (!focused) return;
    await tick();
    focusCell(Math.min(index, notebook.cells.length - 1));
  }

  async function restart(): Promise<void> {
    restartError = null;
    try {
      await window.api.restartSession(notebook.path);
    } catch (cause) {
      restartError = messageOf(cause);
    }
  }
</script>

<article class="mx-auto flex max-w-3xl flex-col gap-4 px-8 py-6" bind:this={article}>
  <header class="border-b border-zinc-200 pb-4 dark:border-zinc-800">
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0 flex-1">
        <InlineEdit
          value={notebook.title}
          label="Title"
          inputClass="text-2xl font-semibold tracking-tight"
          oncommit={(title) => {
            if (title.trim() !== "" && title.trim() !== notebook.title) onrename(title);
          }}
        >
          <h1 class="truncate text-2xl font-semibold tracking-tight">{notebook.title}</h1>
        </InlineEdit>
      </div>
      <span class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title="Restart session"
          aria-label="Restart session"
          onclick={() => void restart()}
        >
          ⟳
        </button>
        <SessionDot state={session} />
      </span>
    </div>
    <div class="mt-1 text-sm text-zinc-500">
      <InlineEdit
        value={notebook.tags.join(", ")}
        label="Tags"
        placeholder="Comma-separated, e.g. audio, pipewire"
        oncommit={(text) => edit((current) => setTags(current, text))}
      >
        {#if notebook.tags.length > 0}
          tags: {notebook.tags.join(", ")}
        {:else}
          <span class="text-zinc-400">Add tags</span>
        {/if}
      </InlineEdit>
    </div>
  </header>

  {#if end}
    <SessionNotice
      details={end.type === "start-failed" ? startupExcerpt(end.output) : ""}
      ondismiss={() => runs.dismissEnd(notebook.path)}
    >
      {#if end.type === "start-failed"}
        Shell didn't start. Your <code>~/.bashrc</code> may exec another shell or wait for input.
      {:else}
        Shell session ended (exit {end.exitCode}). A <code>set -e</code> or <code>exit</code> in a
        cell ends the session. Next run will start a new session.
      {/if}
    </SessionNotice>
  {/if}
  {#if restartError}
    <SessionNotice details="" ondismiss={() => (restartError = null)}>
      Couldn't restart the session: {restartError}
    </SessionNotice>
  {/if}

  {#each notebook.cells as cell, index (cell.id)}
    {#if cell.type === "shell"}
      <ShellCell
        notebookPath={notebook.path}
        {cell}
        autofocus={cell.id === added}
        onchange={(source) => edit((current) => setCellSource(current, cell.id, source))}
        ondelete={() => void removeCell(cell.id, index)}
        onfocusnext={() => focusCell(index + 1)}
      />
    {:else}
      <MarkdownCell
        source={cell.source}
        autoEdit={cell.id === added}
        onchange={(source) => edit((current) => setCellSource(current, cell.id, source))}
        ondelete={() => void removeCell(cell.id, index)}
      />
    {/if}
    {#if index < notebook.cells.length - 1}
      <AddCell subtle onadd={(type) => add(type, index + 1)} />
    {/if}
  {:else}
    <p class="pt-12 text-center text-zinc-500">This runbook is empty</p>
  {/each}

  <AddCell onadd={(type) => add(type, notebook.cells.length)} />
</article>
