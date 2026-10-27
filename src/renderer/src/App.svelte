<script lang="ts">
  import type { Notebook, NotebookSummary } from "../../shared/types";
  import { messageOf } from "../../shared/errors";
  import NotebookView from "./components/NotebookView.svelte";
  import Sidebar from "./components/Sidebar.svelte";

  let notebooks: NotebookSummary[] = $state([]);
  let notebooksDir = $state("");
  let selected: string | null = $state(null);
  let notebook: Notebook | null = $state(null);
  let error: string | null = $state(null);

  async function open(path: string): Promise<void> {
    selected = path;
    try {
      const opened = await window.api.readNotebook(path);
      // A slower earlier read must not replace the notebook clicked last.
      if (selected !== path) return;
      notebook = opened;
      error = null;
    } catch (cause) {
      if (selected !== path) return;
      // Don't leave the previous notebook on screen under the new selection.
      notebook = null;
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
  <Sidebar {notebooks} {selected} onselect={(path) => void open(path)} />

  <main class="flex-1 overflow-y-auto">
    {#if error}
      <p class="m-6 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
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
