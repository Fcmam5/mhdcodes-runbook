// Keeps the keyboard's place when the focused element goes away: an inline field that
// closes, a menu, a deleted row. Elements that can take the focus back carry a
// `data-focus-key`; this focuses one once the page has updated.

import { tick } from "svelte";

// Focuses the element marked `key` after the next update, if the focus fell to the
// page meanwhile (its element was removed). With `force`, even if it didn't.
export async function refocus(key: string, { force = false } = {}): Promise<void> {
  await tick();
  const active = document.activeElement;
  if (!force && active !== null && active !== document.body) return;
  document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`)?.focus();
}

// The key of a runbook's row in the sidebar.
export const rowKey = (path: string): string => `row:${path}`;
