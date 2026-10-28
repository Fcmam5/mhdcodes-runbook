// The status line under a shell cell (SPEC §9.3), e.g. "✓ exit 0 · 1.2s". Pure, so it is unit tested.
import type { CellRunStatus } from "../../../shared/types";

export interface StatusLine {
  icon: "spinner" | "✓" | "✗" | "■" | null;
  text: string;
  tone: "neutral" | "success" | "failure";
}

export function statusLine(status: CellRunStatus): StatusLine | null {
  switch (status.state) {
    case "idle":
      return null;
    case "queued":
      return { icon: null, text: "queued", tone: "neutral" };
    case "running":
      return { icon: "spinner", text: "running…", tone: "neutral" };
    case "interrupted":
      return { icon: "■", text: withDuration("interrupted", status), tone: "neutral" };
    case "success":
    case "failed":
      return {
        icon: status.state === "success" ? "✓" : "✗",
        text: withDuration(`exit ${status.exitCode ?? "?"}`, status),
        tone: status.state === "success" ? "success" : "failure",
      };
  }
}

function withDuration(text: string, { startedAt, endedAt }: CellRunStatus): string {
  if (startedAt === undefined || endedAt === undefined) return text;
  return `${text} · ${formatDuration(endedAt - startedAt)}`;
}

// 0.3s, 1.2s, 59.9s, then 1m 5s.
export function formatDuration(ms: number): string {
  const tenths = Math.round(Math.max(0, ms) / 100);
  if (tenths < 600) return `${(tenths / 10).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
