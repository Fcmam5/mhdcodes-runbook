<script module lang="ts">
  import type { IconName } from "./Icon.svelte";

  export interface MenuItem {
    label: string;
    icon: IconName;
    onselect: () => void;
    danger?: boolean; // shown in red, after a divider
    shortcut?: string;
  }
</script>

<script lang="ts">
  import Icon from "./Icon.svelte";

  // A popup menu (SPEC §9.2, §9.3): the cell's ⋮ and a runbook's ⋮ or right-click.
  // The owner places it and closes it: on a choice, Esc, or a click outside.
  const { items, onchoose }: { items: MenuItem[]; onchoose: () => void } = $props();

  const plain = $derived(items.filter((item) => !item.danger));
  const danger = $derived(items.filter((item) => item.danger));

  // The first item takes the focus, so the menu works from the keyboard.
  const focusFirst = (menu: HTMLElement): void => {
    menu.querySelector("button")?.focus();
  };

  // Up and Down move between the items.
  function onkeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll("button")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
  }

  // The action runs first: it may need what the owner clears when the menu closes.
  function choose(item: MenuItem): void {
    item.onselect();
    onchoose();
  }
</script>

{#snippet entry(item: MenuItem)}
  <button
    type="button"
    role="menuitem"
    class={[
      "flex h-8 w-full items-center gap-2.5 rounded-inset px-2.5 text-left text-ui whitespace-nowrap outline-none hover:bg-white/7 focus-visible:bg-white/7",
      item.danger ? "text-dead" : "text-body hover:text-ink focus-visible:text-ink",
    ]}
    onclick={() => choose(item)}
  >
    <span class={item.danger ? "text-dead" : "text-muted"}><Icon name={item.icon} size={14} /></span>
    {item.label}
    {#if item.shortcut}
      <kbd class="ml-auto pl-6 font-mono text-[11px] text-faint">{item.shortcut}</kbd>
    {/if}
  </button>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  role="menu"
  tabindex="-1"
  class="w-max min-w-52 rounded-menu border border-rule bg-raise p-1 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
  {onkeydown}
  {@attach focusFirst}
>
  {#each plain as item (item.label)}{@render entry(item)}{/each}
  {#if plain.length > 0 && danger.length > 0}
    <hr class="mx-1.5 my-1 border-rule" />
  {/if}
  {#each danger as item (item.label)}{@render entry(item)}{/each}
</div>
