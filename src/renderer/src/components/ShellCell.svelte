<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import type { Cell, CellRunStatus } from "../../../shared/types";
  import { shellEditor } from "../lib/codemirror";
  import { messageOf } from "../../../shared/errors";
  import { OutputPane } from "../lib/output-pane";
  import { statusLine } from "../../../shared/status";

  const { notebookPath, cell }: { notebookPath: string; cell: Cell } = $props();

  let status = $state<CellRunStatus | null>(null);
  let requested = $state(false); // between the click and the run's end
  let error: string | null = $state(null);
  let paneElement: HTMLElement | null = null;
  // Created on the cell's first run.
  let pane: OutputPane | null = null;

  const line = $derived(status ? statusLine(status) : null);
  const active = $derived(requested || status?.state === "running" || status?.state === "queued");

  async function run(): Promise<void> {
    requested = true;
    error = null;
    try {
      await window.api.runCell(notebookPath, cell.id, cell.source);
    } catch (cause) {
      error = messageOf(cause);
    } finally {
      requested = false;
    }
  }

  function isMine(event: { notebookPath: string; cellId: string }): boolean {
    return event.notebookPath === notebookPath && event.cellId === cell.id;
  }

  $effect(() => {
    const offStatus = window.api.onCellStatus((event) => {
      if (!isMine({ notebookPath: event.notebookPath, cellId: event.status.cellId })) return;
      if (event.status.state === "running" && paneElement) {
        pane ??= new OutputPane(paneElement);
        pane.clear();
      }
      status = event.status;
    });
    const offOutput = window.api.onCellOutput((event) => {
      if (isMine(event)) pane?.write(event.data);
    });
    return () => {
      offStatus();
      offOutput();
      pane?.dispose();
      pane = null;
    };
  });

  const outputPane: Attachment<HTMLElement> = (element) => {
    paneElement = element;
  };
</script>

<div class="flex flex-col gap-1.5">
  <div class="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
    <div
      class="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 py-1 pr-1 pl-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <span class="font-mono text-xs text-zinc-500">{cell.info ?? "bash"}</span>
      <button
        type="button"
        class="rounded px-2 py-0.5 text-sm text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-300 dark:hover:bg-zinc-800"
        title="Run"
        aria-label="Run"
        disabled={active}
        onclick={() => void run()}
      >
        ▶&#xFE0E;
      </button>
    </div>
    <div {@attach shellEditor(cell.source)}></div>
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
  {#if error}
    <p class="px-1 text-xs text-red-700 dark:text-red-400">{error}</p>
  {/if}

  <div
    hidden
    class="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900"
    {@attach outputPane}
  ></div>
</div>
