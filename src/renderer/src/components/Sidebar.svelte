<script lang="ts">
  import type { RunbookSummary, SearchResult } from "../../../shared/types";
  import { runs } from "../lib/runs";
  import SessionDot from "./SessionDot.svelte";

  interface Props {
    runbooks: RunbookSummary[];
    selected: string | null;
    onselect: (path: string) => void;
    // Each resolves false if it failed (the error is shown elsewhere), so the input stays.
    oncreate: (title: string) => Promise<boolean>;
    onrename: (path: string, title: string) => Promise<boolean>;
    ondelete: (path: string) => void;
    onreveal: (path: string) => void;
  }

  const { runbooks, selected, onselect, oncreate, onrename, ondelete, onreveal }: Props =
    $props();

  // Search (SPEC §9.2): an empty query shows every runbook; otherwise the results,
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
      window.api.searchRunbooks(text).then(
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

  let searchInput: HTMLInputElement | undefined = $state();

  // Ctrl+K (SPEC §9.5).
  export function focusSearch(): void {
    searchInput?.focus();
    searchInput?.select();
  }

  // Ctrl+N: the same inline input as "+ New". It takes the focus when it appears.
  export function startCreate(): void {
    search("");
    creating = true;
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
    const runbook = runbooks.find((summary) => summary.path === path);
    if (!runbook) return;
    renaming = runbook.path;
    renameTitle = runbook.title;
  }

  async function submitRename(runbook: RunbookSummary): Promise<void> {
    const title = renameTitle.trim();
    if (renaming !== runbook.path) return;
    if (title === "" || title === runbook.title) {
      renaming = null;
      return;
    }
    if (busy) return;
    busy = true;
    try {
      if (await onrename(runbook.path, title)) renaming = null;
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
  class="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r p-3 border-zinc-800"
  onscroll={() => (menu = null)}
>
  <input
    type="search"
    class="mb-2 rounded-md border px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-blue-500 border-zinc-800 bg-zinc-900"
    placeholder="Search…"
    aria-label="Search runbooks"
    bind:this={searchInput}
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
            ? "bg-zinc-800"
            : "hover:bg-zinc-900",
        ]}
        title={result.title}
        onclick={() => onselect(result.path)}
      >
        <span class="truncate font-medium">
          {runbooks.find((runbook) => runbook.path === result.path)?.title ?? result.title}
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
      class="mb-1 rounded-md border px-3 py-1.5 text-sm outline-none focus:border-blue-500 border-zinc-700 bg-zinc-900"
      aria-label="New runbook title"
      placeholder="Title of the new runbook"
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
      class="mb-1 rounded-md px-3 py-1.5 text-left text-sm text-zinc-400 hover:bg-zinc-900"
      onclick={() => (creating = true)}
    >
      + New
    </button>
  {/if}

  {#if !results}
  {#each runbooks as runbook (runbook.path)}
    {#if renaming === runbook.path}
      <input
        class="rounded-md border px-3 py-1.5 text-sm outline-none focus:border-blue-500 border-zinc-700 bg-zinc-900"
        aria-label="New title"
        bind:value={renameTitle}
        {@attach focusAndSelect}
        onkeydown={(event) => {
          if (event.key === "Enter") void submitRename(runbook);
          if (event.key === "Escape") renaming = null;
        }}
        onblur={() => void submitRename(runbook)}
      />
    {:else}
      <div class="group relative">
        <button
          type="button"
          class={[
            "flex w-full items-center gap-2 rounded-md py-1.5 pr-8 pl-3 text-left text-sm",
            runbook.path === selected
              ? "font-medium bg-zinc-800"
              : "hover:bg-zinc-900",
          ]}
          aria-current={runbook.path === selected ? "page" : undefined}
          title={runbook.title}
          onclick={() => onselect(runbook.path)}
          oncontextmenu={(event) => {
            event.preventDefault();
            openMenu(runbook.path, event.clientX, event.clientY);
          }}
        >
          <span class="min-w-0 flex-1 truncate">{runbook.title}</span>
          <!-- Runbooks with a session show its dot, so a cell running in the background is visible. -->
          {#if $runs[runbook.path]?.session}
            <SessionDot state={$runs[runbook.path]?.session ?? null} compact />
          {/if}
        </button>
        <button
          type="button"
          class="absolute top-1/2 right-1 -translate-y-1/2 rounded px-1.5 text-sm text-zinc-500 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-zinc-700"
          title="More"
          aria-label={`More for ${runbook.title}`}
          aria-haspopup="menu"
          onclick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            openMenu(runbook.path, box.left, box.bottom + 4);
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
    class="fixed z-20 min-w-40 rounded-md border py-1 text-sm shadow-lg border-zinc-700 bg-zinc-900"
    style:left={`${menu.x}px`}
    style:top={`${menu.y}px`}
  >
    {#each [["Rename", startRename], ["Show in folder", onreveal], ["Delete…", ondelete]] as const as [label, action] (label)}
      <button
        type="button"
        role="menuitem"
        class={[
          "block w-full px-3 py-1.5 text-left hover:bg-zinc-800",
          label === "Delete…" && "text-red-400",
        ]}
        onclick={() => choose(action)}
      >
        {label}
      </button>
    {/each}
  </div>
{/if}
