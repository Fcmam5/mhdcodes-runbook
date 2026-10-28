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
      class="rounded-md border px-2.5 py-1 border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
      onclick={() => onadd(type)}
    >
      {label}
    </button>
  {/each}
</div>
