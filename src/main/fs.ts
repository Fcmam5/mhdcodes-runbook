// Small file-system helpers shared by the main process's modules.

// The error is a Node system error with this code, e.g. "ENOENT".
export function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function isNotFound(error: unknown): boolean {
  return isCode(error, "ENOENT");
}
