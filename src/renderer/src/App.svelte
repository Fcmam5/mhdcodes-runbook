<script lang="ts">
  import type { Notebook, NotebookSummary } from "../../shared/types";
  import { messageOf } from "../../shared/errors";
  import NotebookView from "./components/NotebookView.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import { notebooks as openNotebooks } from "./lib/notebooks";

  const saveErrors = openNotebooks.errors;

  let notebooks: NotebookSummary[] = $state([]);
  let notebooksDir = $state("");
  let selected: string | null = $state(null);
  let shown: string | null = $state(null); // the path of the notebook on screen
  let error: string | null = $state(null);
  // The notebook on screen, with every edit so far: the store is the source of truth
  // for open notebooks.
  const notebook: Notebook | null = $derived(shown === null ? null : ($openNotebooks[shown] ?? null));
  // The sidebar shows titles as edited, before the file is listed again.
  const listed = $derived(
    notebooks.map((summary) => ({
      ...summary,
      title: $openNotebooks[summary.path]?.title ?? summary.title,
    })),
  );

  async function open(path: string): Promise<void> {
    // Save the notebook being left now, rather than in up to 500 ms (SPEC §8).
    if (selected !== null && selected !== path) void openNotebooks.flush(selected).catch(() => {});
    selected = path;
    // Each notebook is kept as first opened and reused on return. Cells without an
    // {id=…} in the file get fresh IDs on every read, and the run store and output
    // panes are keyed by cell ID: a re-read would cut a cell off from its output and
    // from a run still going in the background.
    if (openNotebooks.get(path)) {
      shown = path;
      error = null;
      return;
    }
    try {
      const opened = await window.api.readNotebook(path);
      openNotebooks.open(opened);
      // A slower earlier read must not replace the notebook clicked last.
      if (selected !== path) return;
      shown = path;
      error = null;
    } catch (cause) {
      if (selected !== path) return;
      // Don't leave the previous notebook on screen under the new selection.
      shown = null;
      error = messageOf(cause);
    }
  }

  async function load(): Promise<void> {
    try {
      const [settings, list] = await Promise.all([
        window.api.getSettings(),
        window.api.listNotebooks(),
      ]);
      notebooksDir = settings.notebooksDir;
      notebooks = list;
      const [first] = notebooks;
      if (first) await open(first.path);
    } catch (cause) {
      error = messageOf(cause);
    }
  }

  void load();
</script>

<div class="flex h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
  <Sidebar notebooks={listed} {selected} onselect={(path) => void open(path)} />

  <main class="flex-1 overflow-y-auto">
    {#if error}
      <p class="m-6 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
      </p>
    {/if}
    {#if shown && $saveErrors[shown]}
      <p class="m-6 mb-0 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        Couldn't save this notebook: {$saveErrors[shown]}. Your changes are kept; the next
        edit tries again.
      </p>
    {/if}
    {#if notebook}
      {#key notebook.path}
        <NotebookView {notebook} />
      {/key}
    {:else if notebooks.length === 0 && notebooksDir}
      <p class="py-12 text-center text-zinc-500">No notebooks in {notebooksDir}</p>
    {/if}
  </main>
</div>
