// Small file-system helpers shared by the main process's modules.

export function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
