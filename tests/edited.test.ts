import { describe, expect, it } from "vitest";
import { editedLabel } from "../src/renderer/src/state/edited";

// Local times, so "yesterday" follows the calendar wherever the tests run.
const at = (day: number, hour: number, minute = 0): number =>
  new Date(2026, 9, day, hour, minute).getTime();
const NOW = at(28, 15, 30);

describe("editedLabel", () => {
  it("says just now under a minute, then minutes", () => {
    expect(editedLabel(NOW - 20_000, NOW)).toBe("Edited just now");
    expect(editedLabel(NOW + 5_000, NOW)).toBe("Edited just now");
    expect(editedLabel(at(28, 15, 29), NOW)).toBe("Edited 1 minute ago");
    expect(editedLabel(at(28, 15, 28), NOW)).toBe("Edited 2 minutes ago");
  });

  it("uses hours for earlier today", () => {
    expect(editedLabel(at(28, 14, 0), NOW)).toBe("Edited 1 hour ago");
    expect(editedLabel(at(28, 1, 0), NOW)).toBe("Edited 14 hours ago");
  });

  it("follows the calendar for yesterday and the days before", () => {
    // Under an hour stays in minutes, even across midnight.
    expect(editedLabel(at(27, 23, 50), at(28, 0, 30))).toBe("Edited 40 minutes ago");
    expect(editedLabel(at(27, 22, 0), at(28, 0, 30))).toBe("Edited yesterday");
    expect(editedLabel(at(27, 9, 0), NOW)).toBe("Edited yesterday");
    expect(editedLabel(at(24, 9, 0), NOW)).toBe("Edited 4 days ago");
  });

  it("shows a date after a week, with the year only when it differs", () => {
    expect(editedLabel(at(12, 9, 0), NOW)).toBe("Edited 12 Oct");
    expect(editedLabel(new Date(2025, 11, 3).getTime(), NOW)).toBe("Edited 3 Dec 2025");
  });
});
