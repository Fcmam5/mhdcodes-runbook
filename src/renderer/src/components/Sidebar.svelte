<script lang="ts">
  import type { NotebookSummary, SearchResult } from "../../../shared/types";
  import { runs } from "../lib/runs";
  import SessionDot from "./SessionDot.svelte";

  interface Props {
    notebooks: NotebookSummary[];
    selected: string | null;
    onselect: (path: string) => void;
    // Each resolves false if it failed (the error is shown elsewhere), so the input stays.
    oncreate: (title: string) => Promise<boolean>;
    onrename: (path: string, title: string) => Promise<boolean>;
    ondelete: (path: string) => void;
    onreveal: (path: string) => void;
  }

  const { notebooks, selected, onselect, oncreate, onrename, ondelete, onreveal }: Props =
    $props();

  // Search (SPEC §9.2): an empty query shows every notebook; otherwise the results,
  // each with a one-line snippet. Queries wait 150 ms after the last keystroke.
  let query = $state("");
  let results: SearchResult[] | null = $state(null);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchSeq = 0;

  function search(text: string): void {
    query = text;
    clearTimeout(searchTimer);
    const seq = ++searchSeq;
    if (text.trim() === "") {
      results = null;
      return;
    }
    searchTimer = setTimeout(() => {
      window.api.searchNotebooks(text).then(
        (found) => {
          // An older query answering late must not replace a newer one's results.
          if (seq === searchSeq) results = found;
        },
        () => {
          if (seq === searchSeq) results = [];
        },
      );
    }, 150);
  }

  // "+ New" shows an inline title input (SPEC §9.2).
  let creating = $state(false);
  let newTitle = $state("");
  // The item whose title is being renamed inline.
  let renaming: string | null = $state(null);
  let renameTitle = $state("");
  // A create or rename on its way: Enter, then the blur it may cause, must not send it twice.
  let busy = false;
  // The item menu, opened by right-click (at the pointer) or by the item's ⋮.
  let menu: { path: string; x: number; y: number } | null = $state(null);
  let menuElement: HTMLElement | undefined = $state();

  async function submitNew(): Promise<void> {
    const title = newTitle.trim();
    if (title === "") {
      creating = false;
      return;
    }
    if (busy) return;
    busy = true;
    try {
      if (await oncreate(title)) {
        creating = false;
        newTitle = "";
      }
    } finally {
      busy = false;
    }
  }

  function startRename(path: string): void {
    const notebook = notebooks.find((summary) => summary.path === path);
    if (!notebook) return;
    renaming = notebook.path;
    renameTitle = notebook.title;
  }

  async function submitRename(notebook: NotebookSummary): Promise<void> {
    const title = renameTitle.trim();
    if (renaming !== notebook.path) return;
    if (title === "" || title === notebook.title) {
      renaming = null;
      return;
    }
    if (busy) return;
    busy = true;
    try {
      if (await onrename(notebook.path, title)) renaming = null;
    } finally {
      busy = false;
    }
  }

  function openMenu(path: string, x: number, y: number): void {
    menu = { path, x, y };
  }

  function choose(action: (path: string) => void): void {
    if (!menu) return;
    const { path } = menu;
    menu = null;
    action(path);
  }

  const focusAndSelect = (input: HTMLInputElement): void => {
    input.focus();
    input.select();
  };
</script>

<svelte:window
  onpointerdown={(event) => {
    if (menu && !menuElement?.contains(event.target as Node)) menu = null;
  }}
  onkeydown={(event) => {
    if (menu && event.key === "Escape") menu = null;
  }}
  onblur={() => (menu = null)}
/>

<nav
  class="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-zinc-200 p-3 dark:border-zinc-800"
  onscroll={() => (menu = null)}
>
  <input
    type="search"
    class="mb-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-blue-500 dark:border-zinc-800 dark:bg-zinc-900"
    placeholder="Search…"
    aria-label="Search notebooks"
    value={query}
    oninput={(event) => search(event.currentTarget.value)}
    onkeydown={(event) => {
      if (event.key === "Escape") search("");
    }}
  />

  {#if results}
    {#each results as result (result.path)}
      <button
        type="button"
        class={[
          "flex flex-col rounded-md px-3 py-1.5 text-left text-sm",
          result.path === selected
            ? "bg-zinc-200 dark:bg-zinc-800"
            : "hover:bg-zinc-100 dark:hover:bg-zinc-900",
        ]}
        title={result.title}
        onclick={() => onselect(result.path)}
      >
        <span class="truncate font-medium">
          {notebooks.find((notebook) => notebook.path === result.path)?.title ?? result.title}
        </span>
        {#if result.snippet}
          <span class="truncate text-xs text-zinc-500">{result.snippet}</span>
        {/if}
      </button>
    {:else}
      <p class="px-3 py-1.5 text-sm text-zinc-500">No matches</p>
    {/each}
  {:else if creating}
    <input
      class="mb-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
      aria-label="New notebook title"
      placeholder="Title of the new notebook"
      bind:value={newTitle}
      {@attach focusAndSelect}
      onkeydown={(event) => {
        if (event.key === "Enter") void submitNew();
        if (event.key === "Escape") {
          creating = false;
          newTitle = "";
        }
      }}
      onblur={() => {
        if (newTitle.trim() === "") creating = false;
      }}
    />
  {:else}
    <button
      type="button"
      class="mb-1 rounded-md px-3 py-1.5 text-left text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
      onclick={() => (creating = true)}
    >
      + New
    </button>
  {/if}

  {#if !results}
  {#each notebooks as notebook (notebook.path)}
    {#if renaming === notebook.path}
      <input
        class="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        aria-label="New title"
        bind:value={renameTitle}
        {@attach focusAndSelect}
        onkeydown={(event) => {
          if (event.key === "Enter") void submitRename(notebook);
          if (event.key === "Escape") renaming = null;
        }}
        onblur={() => void submitRename(notebook)}
      />
    {:else}
      <div class="group relative">
        <button
          type="button"
          class={[
            "flex w-full items-center gap-2 rounded-md py-1.5 pr-8 pl-3 text-left text-sm",
            notebook.path === selected
              ? "bg-zinc-200 font-medium dark:bg-zinc-800"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-900",
          ]}
          aria-current={notebook.path === selected ? "page" : undefined}
          title={notebook.title}
          onclick={() => onselect(notebook.path)}
          oncontextmenu={(event) => {
            event.preventDefault();
            openMenu(notebook.path, event.clientX, event.clientY);
          }}
        >
          <span class="min-w-0 flex-1 truncate">{notebook.title}</span>
          <!-- Notebooks with a session show its dot, so a cell running in the background is visible. -->
          {#if $runs[notebook.path]?.session}
            <SessionDot state={$runs[notebook.path]?.session ?? null} compact />
          {/if}
        </button>
        <button
          type="button"
          class="absolute top-1/2 right-1 -translate-y-1/2 rounded px-1.5 text-sm text-zinc-500 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          title="More"
          aria-label={`More for ${notebook.title}`}
          aria-haspopup="menu"
          onclick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            openMenu(notebook.path, box.left, box.bottom + 4);
          }}
        >
          ⋮
        </button>
      </div>
    {/if}
  {/each}
  {/if}
</nav>

{#if menu}
  <div
    bind:this={menuElement}
    role="menu"
    class="fixed z-20 min-w-40 rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    style:left={`${menu.x}px`}
    style:top={`${menu.y}px`}
  >
    {#each [["Rename", startRename], ["Show in folder", onreveal], ["Delete…", ondelete]] as const as [label, action] (label)}
      <button
        type="button"
        role="menuitem"
        class={[
          "block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800",
          label === "Delete…" && "text-red-700 dark:text-red-400",
        ]}
        onclick={() => choose(action)}
      >
        {label}
      </button>
    {/each}
  </div>
{/if}
