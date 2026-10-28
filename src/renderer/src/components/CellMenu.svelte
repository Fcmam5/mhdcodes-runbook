<script module lang="ts">
  export interface MenuItem {
    label: string;
    onselect: () => void;
    danger?: boolean;
  }
</script>

<script lang="ts">
  // A cell's ⋮ menu (SPEC §9.3). Closes on a choice, Esc, or a click outside it.
  const { items }: { items: MenuItem[] } = $props();

  let open = $state(false);
  let root: HTMLElement | undefined = $state();

  function choose(item: MenuItem): void {
    open = false;
    item.onselect();
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }
</script>

<svelte:window
  onpointerdown={onWindowPointerDown}
  onkeydown={(event) => {
    if (open && event.key === "Escape") open = false;
  }}
/>

<div class="relative" bind:this={root}>
  <button
    type="button"
    class="rounded px-1.5 py-0.5 text-sm text-zinc-500 hover:bg-zinc-800"
    title="More"
    aria-label="More"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    ⋮
  </button>
  {#if open}
    <div
      role="menu"
      class="absolute right-0 z-10 mt-1 min-w-36 rounded-md border py-1 text-sm shadow-lg border-zinc-700 bg-zinc-900"
    >
      {#each items as item (item.label)}
        <button
          type="button"
          role="menuitem"
          class={[
            "block w-full px-3 py-1.5 text-left hover:bg-zinc-800",
            item.danger && "text-red-400",
          ]}
          onclick={() => choose(item)}
        >
          {item.label}
        </button>
      {/each}
    </div>
  {/if}
</div>
