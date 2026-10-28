<script lang="ts">
  import type { Snippet } from "svelte";

  // A notice at the top of the runbook about its shell session (SPEC §6.3, §9.3).
  const {
    details,
    ondismiss,
    children,
  }: { details: string; ondismiss: () => void; children: Snippet } = $props();
</script>

<div
  role="alert"
  class="flex items-start gap-3 rounded-lg border px-4 py-3 text-sm border-amber-800 bg-amber-950 text-amber-200"
>
  <div class="min-w-0 flex-1 [&_code]:font-mono">
    <p>{@render children()}</p>
    {#if details}
      <pre
        class="mt-2 overflow-x-auto rounded px-3 py-2 font-mono text-xs whitespace-pre bg-amber-900/50">{details}</pre>
    {/if}
  </div>
  <button
    type="button"
    class="rounded px-1 text-amber-300 hover:bg-amber-900"
    title="Dismiss"
    aria-label="Dismiss"
    onclick={ondismiss}
  >
    ×
  </button>
</div>
