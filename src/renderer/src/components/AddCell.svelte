<script lang="ts">
  import type { CellType } from "../../../shared/types";
  import Icon from "./Icon.svelte";

  // "+ Markdown" / "+ Shell" (SPEC §9.3). Between cells it fills the gap between them
  // (`gap`, its height class), with a line and the two buttons shown on hover or keyboard
  // focus. The bar is taller than the gap, so only its buttons take the pointer, and only
  // while shown: the rest of it would cover the cells' edges, and keep itself shown over
  // them, so a one-line markdown cell could hardly be clicked. At the end (no `gap`) it
  // is the "Keep writing…" row.
  const { onadd, gap }: { onadd: (type: CellType) => void; gap?: string } = $props();
</script>

{#snippet add(type: CellType, label: string, classes: string)}
  <button type="button" class={classes} onclick={() => onadd(type)}>
    <Icon name="plus" size={14} />{label}
  </button>
{/snippet}

{#if gap}
  <div class={["group relative z-10", gap]}>
    <div
      class="pointer-events-none absolute inset-x-0 top-1/2 flex h-7 -translate-y-1/2 items-center justify-center gap-1.5 opacity-0 transition-opacity duration-100 before:absolute before:inset-x-0 before:top-1/2 before:border-t before:border-rule focus-within:opacity-100 group-hover:opacity-100"
    >
      {#each [["markdown", "Markdown"], ["shell", "Shell"]] as const as [type, label] (type)}
        {@render add(
          type,
          label,
          "relative flex h-[26px] items-center gap-1.5 rounded-ctl bg-page pr-2.5 pl-2 text-meta text-muted shadow-[inset_0_0_0_1px_var(--color-rule)] group-hover:pointer-events-auto hover:bg-raise hover:text-ink",
        )}
      {/each}
    </div>
  </div>
{:else}
  <div class="mt-8 flex items-center gap-1 text-[14px]">
    <button
      type="button"
      class="flex-1 rounded-ctl py-1 text-left text-faint hover:text-muted"
      onclick={() => onadd("markdown")}
    >
      Keep writing…
    </button>
    {#each [["markdown", "Markdown"], ["shell", "Shell"]] as const as [type, label] (type)}
      {@render add(
        type,
        label,
        "flex h-[30px] items-center gap-1.5 rounded-ctl pr-2.5 pl-2 text-muted hover:bg-raise hover:text-ink",
      )}
    {/each}
  </div>
{/if}
