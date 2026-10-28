// "Edited 2 minutes ago" over a runbook's title, from its file's modification time.
// Pure: `now` is passed in, so it is unit tested.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function editedLabel(mtime: number, now: number): string {
  const ago = Math.max(0, now - mtime);
  if (ago < MINUTE) return "Edited just now";
  if (ago < HOUR) return `Edited ${plural(Math.floor(ago / MINUTE), "minute")} ago`;

  const then = new Date(mtime);
  const today = startOfDay(new Date(now));
  const days = Math.round((today - startOfDay(then)) / (24 * HOUR));
  if (days === 0) return `Edited ${plural(Math.floor(ago / HOUR), "hour")} ago`;
  if (days === 1) return "Edited yesterday";
  if (days < 7) return `Edited ${days} days ago`;

  const sameYear = then.getFullYear() === new Date(now).getFullYear();
  const date = then.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `Edited ${date}`;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

// Local midnight, so "yesterday" follows the calendar rather than 24 hours.
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
