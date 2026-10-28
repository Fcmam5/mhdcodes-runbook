<script lang="ts">
  import type { Runbook, RunbookSummary } from "../../shared/types";
  import { messageOf } from "./state/errors";
  import RunbookView from "./components/RunbookView.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import { runbooks as openRunbooks } from "./lib/runbooks";
  import { claimPath, forgetRuns, renameRuns } from "./lib/runs";

  const saveErrors = openRunbooks.errors;

  let runbooks: RunbookSummary[] = $state([]);
  let runbooksDir = $state("");
  let selected: string | null = $state(null);
  let shown: string | null = $state(null); // the path of the runbook on screen
  let error: string | null = $state(null);
  let sidebar: ReturnType<typeof Sidebar> | undefined = $state();

  // Window-wide shortcuts (SPEC §9.5). Not inside an output pane: there Ctrl+N and
  // Ctrl+K are bash's own keys (previous command, kill to end of line).
  function onkeydown(event: KeyboardEvent): void {
    const ctrl = event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
    if (!ctrl || (event.target instanceof Element && event.target.closest(".xterm"))) return;
    const key = event.key.toLowerCase();
    if (key === "n") sidebar?.startCreate();
    else if (key === "k") sidebar?.focusSearch();
    else return;
    event.preventDefault();
  }
  // The runbook on screen, with every edit so far: the store is the source of truth
  // for open runbooks.
  const runbook: Runbook | null = $derived(shown === null ? null : ($openRunbooks[shown] ?? null));
  // The sidebar shows titles as edited, before the file is listed again.
  const listed = $derived(
    runbooks.map((summary) => ({
      ...summary,
      title: $openRunbooks[summary.path]?.title ?? summary.title,
    })),
  );

  async function open(path: string): Promise<void> {
    // Save the runbook being left now, rather than in up to 500 ms (SPEC §8).
    if (selected !== null && selected !== path) void openRunbooks.flush(selected).catch(() => {});
    selected = path;
    // Each runbook is kept as first opened and reused on return. Cells without an
    // {id=…} in the file get fresh IDs on every read, and the run store and output
    // panes are keyed by cell ID: a re-read would cut a cell off from its output and
    // from a run still going in the background.
    if (openRunbooks.get(path)) {
      shown = path;
      error = null;
      return;
    }
    try {
      const opened = await window.api.readRunbook(path);
      openRunbooks.open(opened);
      // A slower earlier read must not replace the runbook clicked last.
      if (selected !== path) return;
      shown = path;
      error = null;
    } catch (cause) {
      if (selected !== path) return;
      // Don't leave the previous runbook on screen under the new selection.
      shown = null;
      error = messageOf(cause);
    }
  }

  function compareText(a: string, b: string): number {
    return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  }

  // Sorted like listRunbooks: by title, then path.
  function sorted(list: RunbookSummary[]): RunbookSummary[] {
    return list.toSorted((a, b) => compareText(a.title, b.title) || compareText(a.path, b.path));
  }

  async function create(title: string): Promise<boolean> {
    try {
      const created = await window.api.createRunbook(title);
      claimPath(created.path);
      openRunbooks.open(created);
      runbooks = sorted([
        ...runbooks,
        { path: created.path, title: created.title, tags: created.tags, mtime: Date.now() },
      ]);
      error = null;
      await open(created.path);
      return true;
    } catch (cause) {
      error = messageOf(cause);
      return false;
    }
  }

  // Renames the file after the title and updates the title (SPEC §8); from the sidebar
  // and from the runbook's own title.
  async function rename(path: string, title: string): Promise<boolean> {
    try {
      const moved = await openRunbooks.rename(path, () => window.api.renameRunbook(path, title));
      // Right away, before awaiting anything: main has already moved the session, and
      // its events now name the new path.
      renameRuns(path, moved.path);
      runbooks = sorted(
        runbooks.map((summary) =>
          summary.path === path ? { ...summary, path: moved.path, title: moved.title } : summary,
        ),
      );
      if (selected === path) selected = moved.path;
      if (shown === path) shown = moved.path;
      error = null;
      return true;
    } catch (cause) {
      error = messageOf(cause);
      return false;
    }
  }

  async function remove(path: string): Promise<void> {
    const title = runbooks.find((summary) => summary.path === path)?.title ?? path;
    if (!window.confirm(`Delete “${title}”? It goes to the trash, and its shell session is closed.`)) {
      return;
    }
    try {
      await openRunbooks.remove(path, () => window.api.deleteRunbook(path));
      forgetRuns(path);
      runbooks = runbooks.filter((summary) => summary.path !== path);
      error = null;
      if (selected === path || shown === path) {
        selected = null;
        shown = null;
        const [next] = runbooks;
        if (next) await open(next.path);
      }
    } catch (cause) {
      error = messageOf(cause);
    }
  }

  function reveal(path: string): void {
    window.api.showRunbookInFolder(path).catch((cause: unknown) => {
      error = messageOf(cause);
    });
  }

  async function load(): Promise<void> {
    try {
      const [settings, list] = await Promise.all([
        window.api.getSettings(),
        window.api.listRunbooks(),
      ]);
      runbooksDir = settings.runbooksDir;
      runbooks = list;
      const [first] = runbooks;
      if (first) await open(first.path);
    } catch (cause) {
      error = messageOf(cause);
    }
  }

  void load();
</script>

<svelte:window {onkeydown} />

<div class="flex h-screen bg-zinc-950 text-zinc-100">
  <Sidebar
    bind:this={sidebar}
    runbooks={listed}
    {selected}
    onselect={(path) => void open(path)}
    oncreate={create}
    onrename={rename}
    ondelete={(path) => void remove(path)}
    onreveal={reveal}
  />

  <main class="flex-1 overflow-y-auto">
    {#if error}
      <p class="m-6 rounded-md p-3 text-sm bg-red-950 text-red-300">
        {error}
      </p>
    {/if}
    {#if shown && $saveErrors[shown]}
      <p class="m-6 mb-0 rounded-md p-3 text-sm bg-red-950 text-red-300">
        Couldn't save this runbook: {$saveErrors[shown]}. Your changes are kept; the next
        edit tries again.
      </p>
    {/if}
    {#if runbook}
      {#key runbook.path}
        <RunbookView {runbook} onrename={(title) => void rename(runbook.path, title)} />
      {/key}
    {:else if runbooks.length === 0 && runbooksDir}
      <p class="py-12 text-center text-zinc-500">No runbooks in {runbooksDir}</p>
    {/if}
  </main>
</div>
