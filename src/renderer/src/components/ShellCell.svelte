<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import { messageOf } from "../../../shared/errors";
  import { statusLine } from "../../../shared/status";
  import type { Cell, CellRunStatus } from "../../../shared/types";
  import { shellEditor } from "../lib/codemirror";
  import { OutputPane } from "../lib/output-pane";

  const { notebookPath, cell }: { notebookPath: string; cell: Cell } = $props();

  let status = $state<CellRunStatus | null>(null);
  let requested = $state(false); // between the click and the run's end
  // Stop clicked before the run request was sent; main has nothing to cancel yet.
  let stoppedEarly = false;
  let error: string | null = $state(null);
  let paneElement: HTMLElement | null = null;
  let runButton: HTMLButtonElement | undefined = $state();
  // Created on the cell's first run.
  let pane: OutputPane | null = null;

  const line = $derived(status ? statusLine(status) : null);
  const running = $derived(status?.state === "running");
  const active = $derived(requested || running || status?.state === "queued");

  async function run(): Promise<void> {
    requested = true;
    stoppedEarly = false;
    error = null;
    try {
      // Every pane in a notebook has the same width, so sizing the shell to this one
      // is right even if another cell is still running ahead of it.
      const { cols, rows } = openPane().size;
      await window.api.resizeSession(notebookPath, cols, rows);
      if (stoppedEarly) return;
      await window.api.runCell(notebookPath, cell.id, cell.source);
    } catch (cause) {
      error = messageOf(cause);
    } finally {
      requested = false;
    }
  }

  function stop(): void {
    stoppedEarly = true;
    window.api.cancelCell(notebookPath, cell.id).catch((cause: unknown) => {
      error = messageOf(cause);
    });
  }

  function openPane(): OutputPane {
    if (pane) return pane;
    if (!paneElement) throw new Error("The output pane isn't mounted");
    pane = new OutputPane(paneElement, {
      // Only the running cell's pane types into the shell (SPEC §6.3.6).
      onInput: (data) => {
        if (running) void window.api.sendInput(notebookPath, data);
      },
      onResize: ({ cols, rows }) => {
        if (running) void window.api.resizeSession(notebookPath, cols, rows);
      },
    });
    return pane;
  }

  // Focus is on nothing in particular, or still on this cell's Run/Stop button.
  function focusIsFree(): boolean {
    const focused = document.activeElement;
    return focused === null || focused === document.body || focused === runButton;
  }

  function isMine(event: { notebookPath: string; cellId: string }): boolean {
    return event.notebookPath === notebookPath && event.cellId === cell.id;
  }

  $effect(() => {
    const offStatus = window.api.onCellStatus((event) => {
      if (!isMine({ notebookPath: event.notebookPath, cellId: event.status.cellId })) return;
      const { state } = event.status;
      if (state === "running" && paneElement) openPane().clear();
      if (state === "success" || state === "failed" || state === "interrupted") pane?.hideCursor();
      status = event.status;
    });
    const offOutput = window.api.onCellOutput((event) => {
      if (!isMine(event)) return;
      pane?.write(event.data);
      // A running cell may be waiting for input (a password, [Y/n]), so have its pane
      // take the keyboard, unless the user has put focus somewhere else meanwhile.
      if (running && focusIsFree()) pane?.focus();
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

<div class="relative flex flex-col gap-1.5">
  <div class="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
    <div
      class="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 py-1 pr-1 pl-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <span class="font-mono text-xs text-zinc-500">{cell.info ?? "bash"}</span>
      <button
        bind:this={runButton}
        type="button"
        class="rounded px-2 py-0.5 text-sm text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
        title={active ? "Stop" : "Run"}
        aria-label={active ? "Stop" : "Run"}
        onclick={() => (active ? stop() : void run())}
      >
        {#if active}■{:else}▶&#xFE0E;{/if}
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
    data-running={running}
    class="output-collapsed overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 p-2 data-[running=true]:focus-within:border-blue-500 data-[running=true]:focus-within:ring-2 data-[running=true]:focus-within:ring-blue-500/30 dark:border-zinc-800 dark:bg-zinc-900"
    {@attach outputPane}
  ></div>
</div>
