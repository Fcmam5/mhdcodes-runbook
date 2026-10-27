<script lang="ts">
  import { untrack } from "svelte";
  import type { Attachment } from "svelte/attachments";
  import { isActive, NO_CELL_RUN } from "../../../shared/run-store";
  import { statusLine } from "../../../shared/status";
  import type { Cell } from "../../../shared/types";
  import { shellEditor } from "../lib/codemirror";
  import { existingPane, paneFor, runCell, runs, stopCell } from "../lib/runs";
  import CellMenu from "./CellMenu.svelte";

  interface Props {
    notebookPath: string;
    cell: Cell;
    autofocus?: boolean; // a new cell's editor takes the focus
    onchange: (source: string) => void;
    ondelete: () => void;
  }

  const { notebookPath, cell, autofocus = false, onchange, ondelete }: Props = $props();

  // Created once: it owns its document and reports edits, which come back as cell.source.
  const editor = shellEditor({
    initial: untrack(() => cell.source),
    onChange: (source) => onchange(source),
    autofocus: untrack(() => autofocus),
  });

  let runButton: HTMLButtonElement | undefined = $state();
  let paneSlot: HTMLElement | null = null;

  // Lives in the run store, so it survives switching notebooks (SPEC §6.6).
  const run = $derived($runs[notebookPath]?.cells[cell.id] ?? NO_CELL_RUN);
  const line = $derived(run.status ? statusLine(run.status) : null);
  const active = $derived(isActive(run));

  function start(): void {
    if (!paneSlot) return;
    // Created on the cell's first run, and attached before the run so the shell can
    // be sized to it.
    paneFor(notebookPath, cell.id).attach(paneSlot, runButton ?? null);
    // The editor's current contents: every edit has already reached cell.source.
    void runCell(notebookPath, cell.id, cell.source);
  }

  function remove(): void {
    if (active) stopCell(notebookPath, cell.id);
    ondelete();
  }

  // The pane, if the cell has run before, comes back with its output as it was.
  const attachPane: Attachment<HTMLElement> = (slot) => {
    paneSlot = slot;
    const pane = existingPane(notebookPath, cell.id);
    pane?.attach(slot, runButton ?? null);
    return () => {
      pane?.detach();
      paneSlot = null;
    };
  };
</script>

<div class="relative flex flex-col gap-1.5">
  <!-- No overflow-hidden: it would clip the ⋮ menu. -->
  <div class="rounded-lg border border-zinc-200 dark:border-zinc-800">
    <div
      class="flex items-center justify-between rounded-t-lg border-b border-zinc-200 bg-zinc-50 py-1 pr-1 pl-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <span class="font-mono text-xs text-zinc-500">{cell.info ?? "bash"}</span>
      <span class="flex items-center gap-0.5">
      <button
        bind:this={runButton}
        type="button"
        class="rounded px-2 py-0.5 text-sm text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
        title={active ? "Stop" : "Run"}
        aria-label={active ? "Stop" : "Run"}
        onclick={() => (active ? stopCell(notebookPath, cell.id) : start())}
      >
        {#if active}■{:else}▶&#xFE0E;{/if}
      </button>
      <CellMenu
        items={[
          { label: "Clear output", onselect: () => existingPane(notebookPath, cell.id)?.clear() },
          { label: "Delete cell", onselect: remove, danger: true },
        ]}
      />
      </span>
    </div>
    <div {@attach editor}></div>
  </div>

  {#if line}
    <p
      class={[
        "flex items-center gap-1.5 px-1 font-mono text-xs",
        line.tone === "success" && "text-green-700 dark:text-green-400",
        line.tone === "failure" && "text-red-700 dark:text-red-400",
        line.tone === "neutral" && "text-zinc-500",
      ]}
    >
      {#if line.icon === "spinner"}
        <span
          class="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        ></span>
      {:else if line.icon}
        <span aria-hidden="true">{line.icon}</span>
      {/if}
      {line.text}
    </p>
  {/if}
  {#if run.error}
    <p class="px-1 text-xs text-red-700 dark:text-red-400">{run.error}</p>
  {/if}

  <!-- The output pane goes here; `contents` keeps the slot itself out of the layout. -->
  <div class="contents" {@attach attachPane}></div>
</div>
