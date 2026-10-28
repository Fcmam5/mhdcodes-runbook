<script lang="ts">
  import { tick } from "svelte";
  import { messageOf } from "../state/errors";
  import {
    deleteCell,
    insertCell,
    setCellSource,
    setTags,
  } from "../state/runbook-edits";
  import { NO_RUNBOOK_RUNS } from "../state/run-store";
  import { editedLabel } from "../state/edited";
  import { startupExcerpt } from "../state/startup-excerpt";
  import type { CellType, Runbook } from "../../../shared/types";
  import { now, runbooks } from "../lib/runbooks";
  import { runs } from "../lib/runs";
  import AddCell from "./AddCell.svelte";
  import InlineEdit from "./InlineEdit.svelte";
  import MarkdownCell from "./MarkdownCell.svelte";
  import Icon from "./Icon.svelte";
  import SessionDot, { SESSION_LOOKS } from "./SessionDot.svelte";
  import SessionNotice from "./SessionNotice.svelte";
  import ShellCell from "./ShellCell.svelte";

  // onrename: the title also names the file, so editing it renames the runbook (SPEC §8).
  // mtime: when it was last saved, for "Edited …"; null while unknown.
  const {
    runbook,
    mtime,
    onrename,
  }: { runbook: Runbook; mtime: number | null; onrename: (title: string) => void } = $props();

  // The session state and its notice live in the run store, so they survive switching.
  const { session, end } = $derived($runs[runbook.path] ?? NO_RUNBOOK_RUNS);
  let restartError: string | null = $state(null);
  // The cell just added: a markdown cell opens in its editor, a shell cell's editor
  // takes the focus.
  let added: string | null = $state(null);

  // Every edit goes through the runbook store, which autosaves it (SPEC §8).
  function edit(change: (runbook: Runbook) => Runbook): void {
    runbooks.edit(runbook.path, change);
  }

  function add(type: CellType, index: number): void {
    edit((current) => {
      const result = insertCell(current, type, index);
      added = result.cell.id;
      return result.runbook;
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
    focusCell(Math.min(index, runbook.cells.length - 1));
  }

  // A markdown cell's top margin: 16 px after prose, none after a
  // shell card (its own margin is the gap), and 40 px before a heading, so a new
  // section starts with room above it.
  function markdownSpacing(index: number, source: string): string {
    if (index === 0) return "";
    if (/^\s*#{1,6}\s/.test(source)) return "mt-10";
    return runbook.cells[index - 1]?.type === "markdown" ? "mt-4" : "";
  }

  async function restart(): Promise<void> {
    restartError = null;
    try {
      await window.api.restartSession(runbook.path);
    } catch (cause) {
      restartError = messageOf(cause);
    }
  }
</script>

<!-- The note (SPEC §9.3): notices, then "Edited …" and the session, the title,
     the tags, and the cells. -->
<article
  class="mx-auto max-w-[776px] px-12 pt-12 pb-24 max-[1000px]:px-7 max-[1000px]:pt-7 max-[1000px]:pb-16"
  bind:this={article}
>
  {#if end}
    <SessionNotice
      details={end.type === "start-failed" ? startupExcerpt(end.output) : ""}
      ondismiss={() => runs.dismissEnd(runbook.path)}
    >
      {#if end.type === "start-failed"}
        <strong>Shell didn't start.</strong> Your <code>~/.bashrc</code> may exec another shell or
        wait for input.
      {:else}
        <strong>Shell session ended (exit {end.exitCode}).</strong> A <code>set -e</code> or
        <code>exit</code> in a cell ends the session. The next run starts a new one.
      {/if}
    </SessionNotice>
  {/if}
  {#if restartError}
    <SessionNotice details="" ondismiss={() => (restartError = null)}>
      <strong>Couldn't restart the session.</strong> {restartError}
    </SessionNotice>
  {/if}

  <div class="flex h-5 items-center gap-4 text-[13px] text-faint">
    {#if mtime !== null}<span>{editedLabel(mtime, $now)}</span>{/if}
    <span class="flex items-center gap-2 text-muted">
      <SessionDot state={session} />{SESSION_LOOKS[session ?? "none"].label}
      {#if session !== null}
        <button
          type="button"
          class="text-acc hover:underline hover:underline-offset-3"
          title="Restart the shell for this runbook"
          onclick={() => void restart()}>Restart</button
        >
      {/if}
    </span>
  </div>

  <div class="mt-3">
    <InlineEdit
      value={runbook.title}
      label="Title"
      textClass="text-[32px] leading-10 font-[650] tracking-[-0.02em] max-[1000px]:text-[26px] max-[1000px]:leading-8"
      oncommit={(title) => {
        if (title.trim() !== "" && title.trim() !== runbook.title) onrename(title);
      }}
    >
      <h1 class="truncate text-ink">{runbook.title}</h1>
    </InlineEdit>
  </div>
  <div class="mt-2 mb-8 max-[1000px]:mb-6">
    <InlineEdit
      value={runbook.tags.join(", ")}
      label="Tags"
      placeholder="Comma-separated, e.g. audio, pipewire"
      textClass="text-[14px] leading-5"
      oncommit={(text) => edit((current) => setTags(current, text))}
    >
      {#if runbook.tags.length > 0}
        <span class="flex flex-wrap gap-x-3 text-muted">
          {#each runbook.tags as tag (tag)}<span>#{tag}</span>{/each}
        </span>
      {:else}
        <span class="text-faint">Add tags</span>
      {/if}
    </InlineEdit>
  </div>

  {#each runbook.cells as cell, index (cell.id)}
    {#if index > 0}
      <AddCell between onadd={(type) => add(type, index)} />
    {/if}
    {#if cell.type === "shell"}
      <ShellCell
        runbookPath={runbook.path}
        {cell}
        autofocus={cell.id === added}
        onchange={(source) => edit((current) => setCellSource(current, cell.id, source))}
        ondelete={() => void removeCell(cell.id, index)}
        onfocusnext={() => focusCell(index + 1)}
      />
    {:else}
      <MarkdownCell
        source={cell.source}
        spacing={markdownSpacing(index, cell.source)}
        autoEdit={cell.id === added}
        onchange={(source) => edit((current) => setCellSource(current, cell.id, source))}
        ondelete={() => void removeCell(cell.id, index)}
      />
    {/if}
  {:else}
    <!-- An empty runbook says what a runbook is and offers the two kinds of cell. -->
    <div class="mt-24 flex flex-col items-center text-center max-[1000px]:mt-8">
      <span
        class="grid size-10 place-items-center rounded-menu bg-[color-mix(in_srgb,var(--color-acc)_18%,var(--color-block))] font-mono text-[15px] leading-none font-bold tracking-[-0.06em] text-ink"
        aria-hidden="true">&gt;_</span
      >
      <h2 class="mt-4 text-[16px] leading-6 font-semibold text-ink">This runbook is empty</h2>
      <p class="mt-1 max-w-[46ch] text-[14px] leading-[22px] text-balance text-muted">
        Write down what you're doing in markdown, and add the commands as shell cells. They all
        run in one bash, in order.
      </p>
      <div class="mt-5 flex gap-2">
        <button
          type="button"
          class="flex h-[34px] items-center gap-1.5 rounded-row bg-white/8 pr-3.5 pl-3 text-ui text-ink hover:bg-white/13"
          onclick={() => add("markdown", 0)}
        >
          <Icon name="plus" size={14} />Markdown
        </button>
        <button
          type="button"
          class="flex h-[34px] items-center gap-1.5 rounded-row bg-ink pr-3.5 pl-3 text-ui text-[#18181b] hover:bg-white"
          onclick={() => add("shell", 0)}
        >
          <Icon name="plus" size={14} />Shell
        </button>
      </div>
      <p class="mt-5 text-meta text-faint max-[1000px]:hidden">
        Shift+Enter runs a shell cell and moves to the next one.
      </p>
    </div>
  {/each}

  {#if runbook.cells.length > 0}
    <AddCell onadd={(type) => add(type, runbook.cells.length)} />
  {/if}
</article>
