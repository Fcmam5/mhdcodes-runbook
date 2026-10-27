<script lang="ts">
  import type { CellType } from "../../../shared/types";

  // "+ Markdown" / "+ Shell". Between cells it only shows on hover or keyboard focus.
  const { onadd, subtle = false }: { onadd: (type: CellType) => void; subtle?: boolean } =
    $props();
</script>

<div
  class={[
    "flex justify-center gap-2 text-xs",
    subtle &&
      "-my-3 h-6 items-center opacity-0 transition-opacity focus-within:opacity-100 hover:opacity-100",
  ]}
>
  {#each [["markdown", "+ Markdown"], ["shell", "+ Shell"]] as const as [type, label] (type)}
    <button
      type="button"
      class="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-100"
      onclick={() => onadd(type)}
    >
      {label}
    </button>
  {/each}
</div>
