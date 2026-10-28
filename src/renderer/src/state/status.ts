// The status row in a shell cell, between its command and its output (SPEC §9.3),
// e.g. ✓ "exit 0" "· 1.2s". Pure, so it is unit tested.
import type { CellRunStatus } from "../../../shared/types";

export interface StatusLine {
  icon: "spinner" | "ok" | "bad" | "wait" | "halt";
  text: string; // "exit 0", "running…", "queued", "interrupted"
  detail: string | null; // the duration, shown fainter: "· 1.2s"
  tone: "ok" | "bad" | "run" | "idle";
  hint: string | null; // what the user can do next, shown on the right
}

export function statusLine(status: CellRunStatus): StatusLine | null {
  switch (status.state) {
    case "idle":
      return null;
    case "queued":
      return line("wait", "queued", null, "idle", "Runs when the command above ends.");
    case "running":
      return line("spinner", "running…", null, "run", "Click the output to type. Ctrl+. stops.");
    case "interrupted":
      return line("halt", "interrupted", null, "idle", null);
    case "success":
    case "failed":
      return line(
        status.state === "success" ? "ok" : "bad",
        `exit ${status.exitCode ?? "?"}`,
        duration(status),
        status.state === "success" ? "ok" : "bad",
        null,
      );
  }
}

function line(
  icon: StatusLine["icon"],
  text: string,
  detail: string | null,
  tone: StatusLine["tone"],
  hint: string | null,
): StatusLine {
  return { icon, text, detail, tone, hint };
}

function duration({ startedAt, endedAt }: CellRunStatus): string | null {
  if (startedAt === undefined || endedAt === undefined) return null;
  return `· ${formatDuration(endedAt - startedAt)}`;
}

// 0.3s, 1.2s, 59.9s, then 1m 5s.
export function formatDuration(ms: number): string {
  const tenths = Math.round(Math.max(0, ms) / 100);
  if (tenths < 600) return `${(tenths / 10).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
