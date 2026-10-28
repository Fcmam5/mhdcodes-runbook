<script lang="ts">
  import type { CellType } from "../../../shared/types";
  import Icon from "./Icon.svelte";

  // "+ Markdown" / "+ Shell" (SPEC §9.3). Between cells it is a line with the two
  // buttons, shown on hover or keyboard focus over the gap; it takes no space, so the
  // runbook doesn't move when it appears. At the end it is the "Keep writing…" row.
  const { onadd, between = false }: { onadd: (type: CellType) => void; between?: boolean } =
    $props();
</script>

{#snippet add(type: CellType, label: string, classes: string)}
  <button type="button" class={classes} onclick={() => onadd(type)}>
    <Icon name="plus" size={14} />{label}
  </button>
{/snippet}

{#if between}
  <div class="relative z-10 h-0">
    <div
      class="absolute inset-x-0 top-1/2 flex h-7 -translate-y-1/2 items-center justify-center gap-1.5 opacity-0 transition-opacity duration-100 before:absolute before:inset-x-0 before:top-1/2 before:border-t before:border-rule focus-within:opacity-100 hover:opacity-100"
    >
      {#each [["markdown", "Markdown"], ["shell", "Shell"]] as const as [type, label] (type)}
        {@render add(
          type,
          label,
          "relative flex h-[26px] items-center gap-1.5 rounded-ctl bg-page pr-2.5 pl-2 text-meta text-muted shadow-[inset_0_0_0_1px_var(--color-rule)] hover:bg-raise hover:text-ink",
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
