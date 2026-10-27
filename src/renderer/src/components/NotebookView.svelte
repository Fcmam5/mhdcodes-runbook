<script lang="ts">
  import { messageOf } from "../../../shared/errors";
  import { startupExcerpt } from "../../../shared/startup-excerpt";
  import type { Notebook, SessionEnd, SessionState } from "../../../shared/types";
  import MarkdownCell from "./MarkdownCell.svelte";
  import SessionDot from "./SessionDot.svelte";
  import SessionNotice from "./SessionNotice.svelte";
  import ShellCell from "./ShellCell.svelte";

  const { notebook }: { notebook: Notebook } = $props();

  // null until the notebook's first run starts a session.
  let session: SessionState | null = $state(null);
  // Why the session died on its own, until the next session starts (SPEC §9.3).
  let end: SessionEnd | null = $state(null);
  let restartError: string | null = $state(null);

  $effect(() =>
    window.api.onSessionState((event) => {
      if (event.notebookPath !== notebook.path) return;
      session = event.state;
      if (event.state === "starting") end = null;
      if (event.end) end = event.end;
    }),
  );

  async function restart(): Promise<void> {
    restartError = null;
    try {
      await window.api.restartSession(notebook.path);
    } catch (cause) {
      restartError = messageOf(cause);
    }
  }
</script>

<article class="mx-auto flex max-w-3xl flex-col gap-4 px-8 py-6">
  <header class="border-b border-zinc-200 pb-4 dark:border-zinc-800">
    <div class="flex items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold tracking-tight">{notebook.title}</h1>
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
    {#if notebook.tags.length > 0}
      <p class="mt-1 text-sm text-zinc-500">tags: {notebook.tags.join(", ")}</p>
    {/if}
  </header>

  {#if end}
    <SessionNotice
      details={end.type === "start-failed" ? startupExcerpt(end.output) : ""}
      ondismiss={() => (end = null)}
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
