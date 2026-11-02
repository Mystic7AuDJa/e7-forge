import { describe, expect, it } from "vitest";
import { preferredSnapshot, snapshotFile } from "../src/engine/e7analyzer";

describe("E7 Analyzer snapshot files", () => {
  it("names files by date and rank filter", () => {
    expect(snapshotFile({ generatedAt: "2026-11-02T20:43:56Z", window: "Season Start -> Now, Champion+" })).toBe("2026-11-02-champion-plus.json");
    expect(snapshotFile({ generatedAt: "2026-11-02T08:36:55Z", window: "Season Start -> Now, All Ranks" })).toBe("2026-11-02-all-ranks.json");
  });
  it("prefers the newest export, Champion+ on a tie", () => {
    expect(preferredSnapshot(["2026-11-02-champion-plus.json", "2026-11-02-all-ranks.json"])).toBe("2026-11-02-champion-plus.json");
    expect(preferredSnapshot(["2026-11-02-champion-plus.json", "2026-11-09-all-ranks.json"])).toBe("2026-11-09-all-ranks.json");
  });
});
