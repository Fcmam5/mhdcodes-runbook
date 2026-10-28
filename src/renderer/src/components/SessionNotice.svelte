<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  // A notice at the top of the runbook about its shell session (SPEC §6.3, §9.3): what
  // happened and what happens next, with the first lines of output when there are some.
  const {
    details,
    ondismiss,
    children,
  }: { details: string; ondismiss: () => void; children: Snippet } = $props();
</script>

<div
  role="alert"
  class="mb-8 flex items-start gap-3 rounded-menu border border-[color-mix(in_srgb,var(--color-dead)_28%,var(--color-page))] bg-[color-mix(in_srgb,var(--color-dead)_8%,var(--color-page))] py-3 pr-2 pl-3.5"
>
  <span class="mt-[3px] text-dead"><Icon name="alert" /></span>
  <div
    class="min-w-0 flex-1 text-[14px] leading-[22px] text-pretty text-body [&_code]:rounded [&_code]:bg-white/7 [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-ink [&_strong]:font-semibold [&_strong]:text-ink"
  >
    <p>{@render children()}</p>
    {#if details}
      <pre
        class="mt-2 overflow-x-auto rounded-inset bg-out px-3 py-2 font-mono text-meta whitespace-pre text-[#d6d6da] shadow-[inset_0_0_0_1px_var(--color-rule-soft)]">{details}</pre>
    {/if}
  </div>
  <button
    type="button"
    class="grid size-7 flex-none place-items-center rounded-ctl text-muted hover:bg-white/7 hover:text-ink"
    title="Dismiss"
    aria-label="Dismiss"
    onclick={ondismiss}
  >
    <Icon name="x" size={14} />
  </button>
</div>
