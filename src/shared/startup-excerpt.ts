// The start of a shell's startup output, as plain text, for the "Shell didn't start"
// notice (SPEC §6.3.1). Pure, so it is unit tested.

// CSI sequences (colours, cursor moves), OSC sequences (titles), and other two-byte escapes.
// oxlint-disable-next-line no-control-regex -- matching escape sequences is the point
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-Z\\-_]/g;

export function startupExcerpt(output: string, maxLines = 10): string {
  const lines = output
    .replace(ESCAPES, "")
    .replaceAll("\r\n", "\n")
    .split("\n")
    // A bare \r returns to the start of the line: what follows overwrites it.
    .map((line) => (line.split("\r").at(-1) ?? "").trimEnd());
  const first = lines.findIndex((line) => line !== "");
  if (first === -1) return "";
  const shown = lines.slice(first, first + maxLines);
  while (shown.at(-1) === "") shown.pop();
  return shown.join("\n");
}
