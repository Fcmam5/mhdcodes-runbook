<script module lang="ts">
  import type { SessionState } from "../../../shared/types";

  // grey = no session yet, green = ready, amber = busy, red = dead. A session
  // that is still starting can't run anything yet, so it shows as busy.
  export const SESSION_LOOKS: Record<SessionState | "none", { colour: string; label: string }> = {
    none: { colour: "bg-idle", label: "No session yet" },
    starting: { colour: "bg-busy", label: "Shell starting" },
    ready: { colour: "bg-ok", label: "Shell ready" },
    busy: { colour: "bg-busy", label: "Shell busy" },
    dead: { colour: "bg-dead", label: "Shell ended" },
  };
</script>

<script lang="ts">
  // The dot alone; its label is the tooltip and the accessible name.
  const { state }: { state: SessionState | null } = $props();
  const look = $derived(SESSION_LOOKS[state ?? "none"]);
</script>

<span
  class={["inline-block size-[7px] flex-none rounded-full", look.colour]}
  role="img"
  aria-label={look.label}
  title={look.label}
></span>
