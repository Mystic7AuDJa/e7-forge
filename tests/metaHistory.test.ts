import { describe, expect, it } from "vitest";
import { compareSnapshots, trendReport, type MetaSnapshot, type StatRow } from "../src/engine/metaHistory";

const row = (code: string, pct: number, win = 50): StatRow => ({ code, name: code, count: pct * 100, pct, win });
const snap = (picked: StatRow[], end: string): MetaSnapshot => ({
  source: "test", start: "2026-01-01", end, fetchedAt: end, games: 10000, picked,
  prebanned: [], banned: [], winRate: [], prebannedPairs: [], heroSets: [], heroArtifacts: [], firstPick: {}, secondPick: {},
});

describe("meta history", () => {
  it("flags new, dropped, rising and win-rate shifts", () => {
    const a = snap([row("A", 40), row("B", 20, 50), row("C", 10)], "2026-01-07");
    const b = snap([row("A", 44), row("B", 21, 53), row("D", 12)], "2026-01-14");
    const s = compareSnapshots(a, b);
    expect(s.find((x) => x.name === "D")?.kind).toBe("new");
    expect(s.find((x) => x.name === "C")?.kind).toBe("dropped");
    expect(s.find((x) => x.name === "A" && x.kind === "rising")?.delta).toBe(4);
    expect(s.find((x) => x.name === "B" && x.kind === "win")?.delta).toBe(3);
    expect(s.some((x) => x.name === "B" && x.kind === "rising")).toBe(false); // +1 is under the threshold
  });
  it("writes a plain-text report", () => {
    const t = trendReport(snap([row("A", 44)], "2026-01-14"), snap([row("A", 40)], "2026-01-07"));
    expect(t).toContain("Shifts since");
    expect(t).toContain("A 40.0% -> 44.0% (+4.0)");
  });
});
