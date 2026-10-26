<script lang="ts">
  import { shellEditor } from "../lib/codemirror";

  const { source, info }: { source: string; info: string } = $props();
</script>

<div class="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
  <div
    class="border-b border-zinc-200 bg-zinc-50 px-3 py-1 font-mono text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"
  >
    {info}
  </div>
  <div {@attach shellEditor(source)}></div>
</div>
