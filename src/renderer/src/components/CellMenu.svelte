<script lang="ts">
  import Icon from "./Icon.svelte";
  import Menu, { type MenuItem } from "./Menu.svelte";

  // A cell's ⋮ button and its menu. Closes on a choice, Esc, or a click
  // outside it; a choice or Esc gives the focus back to the button (a deleted cell's
  // place is then taken by the next cell, see RunbookView).
  const { items }: { items: MenuItem[] } = $props();

  let open = $state(false);
  let root: HTMLElement | undefined = $state();
  let button: HTMLButtonElement | undefined = $state();

  function onWindowPointerDown(event: PointerEvent): void {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }
</script>

<svelte:window
  onpointerdown={onWindowPointerDown}
  onkeydown={(event) => {
    if (open && event.key === "Escape") {
      event.preventDefault();
      open = false;
      button?.focus();
    }
  }}
/>

<div class="relative" bind:this={root}>
  <button
    bind:this={button}
    type="button"
    class={[
      "grid size-7 place-items-center rounded-ctl",
      open ? "bg-white/7 text-ink" : "text-muted hover:bg-white/7 hover:text-ink",
    ]}
    title="More"
    aria-label="Cell menu"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <Icon name="more" />
  </button>
  {#if open}
    <div class="absolute top-[34px] right-0 z-20">
      <Menu
        {items}
        onchoose={() => {
          open = false;
          button?.focus();
        }}
      />
    </div>
  {/if}
</div>
