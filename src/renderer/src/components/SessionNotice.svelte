<script lang="ts">
  import type { Snippet } from "svelte";

  // A notice at the top of the notebook about its shell session (SPEC §6.3, §9.3).
  const {
    details,
    ondismiss,
    children,
  }: { details: string; ondismiss: () => void; children: Snippet } = $props();
</script>

<div
  role="alert"
  class="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
>
  <div class="min-w-0 flex-1 [&_code]:font-mono">
    <p>{@render children()}</p>
    {#if details}
      <pre
        class="mt-2 overflow-x-auto rounded bg-amber-100 px-3 py-2 font-mono text-xs whitespace-pre dark:bg-amber-900/50">{details}</pre>
    {/if}
  </div>
  <button
    type="button"
    class="rounded px-1 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900"
    title="Dismiss"
    aria-label="Dismiss"
    onclick={ondismiss}
  >
    ×
  </button>
</div>
