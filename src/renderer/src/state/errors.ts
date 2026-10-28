// A readable message for a failed call. Errors thrown in the main process reach the
// renderer as "Error invoking remote method 'cell:run': Error: <message>".
export function messageOf(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "");
}
