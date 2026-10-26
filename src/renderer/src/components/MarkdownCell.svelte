<script lang="ts">
  import { renderMarkdown } from "../lib/markdown";

  const { source }: { source: string } = $props();
  const html = $derived(renderMarkdown(source));
</script>

<!-- Safe: markdown-it runs with html: false, so the output contains no raw HTML. -->
<div class="markdown">{@html html}</div>
