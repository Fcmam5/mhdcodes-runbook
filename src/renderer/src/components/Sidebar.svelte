<script lang="ts">
  import type { RunbookSummary, SearchResult } from "../../../shared/types";
  import { runs } from "../lib/runs";
  import { aroundMatch, highlight } from "../state/highlight";
  import Icon from "./Icon.svelte";
  import Menu from "./Menu.svelte";
  import SessionDot from "./SessionDot.svelte";

  interface Props {
    runbooks: RunbookSummary[];
    folder: string; // the runbooks folder, shown at the bottom
    selected: string | null;
    onselect: (path: string) => void;
    // Each resolves false if it failed (the error is shown elsewhere), so the input stays.
    oncreate: (title: string) => Promise<boolean>;
    onrename: (path: string, title: string) => Promise<boolean>;
    ondelete: (path: string) => void;
    onreveal: (path: string) => void;
  }

  const { runbooks, folder, selected, onselect, oncreate, onrename, ondelete, onreveal }: Props =
    $props();

  // ~/Runbooks rather than /home/someone/Runbooks.
  const shownFolder = $derived(folder.replace(/^\/home\/[^/]+(?=\/|$)/, "~"));

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

  // Opens at the pointer or under the ⋮, kept inside the window (the menu is about
  // 210 × 120 px).
  function openMenu(path: string, x: number, y: number): void {
    menu = {
      path,
      x: Math.max(8, Math.min(x, window.innerWidth - 220)),
      y: Math.max(8, Math.min(y, window.innerHeight - 130)),
    };
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

{#snippet row(path: string, title: string, sub: string, highlightQuery: string | null)}
  {@const session = $runs[path]?.session ?? null}
  <div class="group relative">
    <button
      type="button"
      class={[
        "block w-full rounded-row py-2 pr-8 pl-2.5 text-left",
        path === selected ? "bg-sel" : "hover:bg-raise",
        menu?.path === path && path !== selected && "bg-raise",
      ]}
      aria-current={path === selected ? "page" : undefined}
      title={title}
      onclick={() => onselect(path)}
      oncontextmenu={(event) => {
        event.preventDefault();
        openMenu(path, event.clientX, event.clientY);
      }}
    >
      <span class="block truncate text-[14px] leading-5 font-medium text-ink">{title}</span>
      {#if sub !== "" || highlightQuery === null}
        <span
          class={[
            "block truncate text-meta leading-[18px] text-faint",
            highlightQuery === null && "max-[1000px]:hidden",
          ]}
        >
          {#if highlightQuery === null}
            {sub === "" ? "Empty" : sub}
          {:else}
            {#each highlight(aroundMatch(sub, highlightQuery), highlightQuery) as part, i (i)}
              {#if part.match}<mark class="rounded-[3px] bg-[color-mix(in_srgb,var(--color-acc)_24%,transparent)] px-px text-ink">{part.text}</mark>{:else}{part.text}{/if}
            {/each}
          {/if}
        </span>
      {/if}
    </button>
    <!-- A runbook with a live shell shows its dot, so a run in the background is visible. -->
    {#if session}
      <span
        class={[
          "pointer-events-none absolute top-[15px] right-[13px] group-focus-within:invisible group-hover:invisible",
          menu?.path === path && "invisible",
        ]}><SessionDot state={session} /></span
      >
    {/if}
    <button
      type="button"
      class={[
        "absolute top-[7px] right-1.5 grid size-6 place-items-center rounded-inset bg-raise text-muted group-focus-within:grid group-hover:grid hover:text-ink",
        menu?.path === path ? "grid" : "hidden",
      ]}
      title="More"
      aria-label={`More for ${title}`}
      aria-haspopup="menu"
      onclick={(event) => {
        // Under the row, right-aligned with it. The row, not this button: it always has
        // a size, even when the button was hidden a moment ago.
        const row = event.currentTarget.parentElement?.getBoundingClientRect();
        if (row) openMenu(path, row.right - 208, row.bottom + 4);
      }}
    >
      <Icon name="more" size={14} />
    </button>
  </div>
{/snippet}

<nav class="flex min-h-0 flex-col bg-side px-2 pt-2" onscroll={() => (menu = null)}>
  <label
    class="flex h-[34px] flex-none items-center gap-2 rounded-row bg-raise pr-2 pl-2.5 text-faint focus-within:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-acc)_55%,transparent)]"
  >
    <Icon name="search" size={14} />
    <input
      type="text"
      class="min-w-0 flex-1 bg-transparent text-ui text-ink outline-none placeholder:text-faint"
      placeholder="Search runbooks"
      aria-label="Search runbooks"
      bind:this={searchInput}
      value={query}
      oninput={(event) => search(event.currentTarget.value)}
      onkeydown={(event) => {
        if (event.key === "Escape") search("");
      }}
    />
    {#if query}
      <button
        type="button"
        class="grid size-[22px] place-items-center rounded-inset text-muted hover:bg-white/8 hover:text-ink"
        aria-label="Clear search"
        onclick={() => {
          search("");
          searchInput?.focus();
        }}
      >
        <Icon name="x" size={14} />
      </button>
    {:else}
      <kbd class="rounded bg-white/6 px-[5px] font-mono text-[11px] leading-[18px] text-faint">Ctrl K</kbd>
    {/if}
  </label>

  <div class="flex h-10 flex-none items-center justify-between pt-1 pr-1 pl-2.5 text-meta text-faint">
    <span>
      {#if results}{results.length === 0
          ? "No matches"
          : `${results.length} ${results.length === 1 ? "result" : "results"}`}{:else}Runbooks{/if}
    </span>
    <button
      type="button"
      class="grid size-7 place-items-center rounded-ctl text-muted hover:bg-raise hover:text-ink"
      title="New runbook (Ctrl+N)"
      aria-label="New runbook"
      onclick={startCreate}
    >
      <Icon name="plus" />
    </button>
  </div>

  <div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-2">
    {#if creating}
      <input
        class="h-[34px] flex-none rounded-row bg-raise px-2.5 text-ui text-ink outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-acc)_55%,transparent)]"
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
    {/if}

    {#if results}
      {#each results as result (result.path)}
        {@render row(
          result.path,
          runbooks.find((runbook) => runbook.path === result.path)?.title ?? result.title,
          result.snippet,
          query,
        )}
      {/each}
    {:else}
      {#each runbooks as runbook (runbook.path)}
        {#if renaming === runbook.path}
          <input
            class="h-[34px] flex-none rounded-row bg-raise px-2.5 text-[14px] font-medium text-ink outline-none focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-acc)_55%,transparent)]"
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
          {@render row(runbook.path, runbook.title, runbook.preview, null)}
        {/if}
      {/each}
    {/if}
  </div>

  <div
    class="-mx-2 flex h-10 flex-none items-center gap-2 border-t border-rule-soft pl-[18px] font-mono text-meta text-faint"
    title={folder}
  >
    <Icon name="folder" size={14} /><span class="truncate">{shownFolder}</span>
  </div>
</nav>

{#if menu}
  <div
    bind:this={menuElement}
    class="fixed z-30"
    style:left={`${menu.x}px`}
    style:top={`${menu.y}px`}
  >
    <Menu
      onchoose={() => (menu = null)}
      items={[
        { label: "Rename", icon: "pen", onselect: () => choose(startRename) },
        { label: "Show in folder", icon: "folder", onselect: () => choose(onreveal) },
        { label: "Delete…", icon: "trash", danger: true, onselect: () => choose(ondelete) },
      ]}
    />
  </div>
{/if}
