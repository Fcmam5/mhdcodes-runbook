<script lang="ts">
  import type { SessionState } from "../../../shared/types";

  // null: the notebook has no session yet.
  const { state }: { state: SessionState | null } = $props();

  // SPEC §9.3: grey = no session, green = ready, amber = busy, red = dead. A session
  // that is still starting can't run anything yet, so it shows as busy.
  const LOOKS: Record<SessionState | "none", { colour: string; label: string }> = {
    none: { colour: "bg-zinc-300 dark:bg-zinc-600", label: "No session" },
    starting: { colour: "bg-amber-500", label: "Session starting" },
    ready: { colour: "bg-green-500", label: "Session ready" },
    busy: { colour: "bg-amber-500", label: "Session busy" },
    dead: { colour: "bg-red-500", label: "Session ended" },
  };

  const look = $derived(LOOKS[state ?? "none"]);
</script>

<span class="flex items-center gap-1.5 text-xs text-zinc-500" title={look.label}>
  Session
  <span class={["inline-block size-2.5 rounded-full", look.colour]} role="img" aria-label={look.label}
  ></span>
</span>
