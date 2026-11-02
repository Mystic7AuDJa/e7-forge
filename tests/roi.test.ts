import { describe, expect, it } from "vitest";
import { editItem, FORECAST_TRIALS, forecastItem, itemRandom, simulateScores, tierOf, tierSplit } from "../src/engine/roi";
import sampleExport from "../data/sample-fribbels-export.json";
import { importFribbels as importSample } from "../src/engine/importer";
import type { Item } from "../src/engine/types";

const boots: Item = {
  id: "b1", gear: "Boots", rank: "Epic", set: "SpeedSet", level: 88, enhance: 0, name: "Boots",
  main: { type: "Speed", value: 8 }, substats: [
    { type: "Speed", value: 4 }, { type: "CriticalHitChancePercent", value: 4 },
    { type: "AttackPercent", value: 6 }, { type: "HealthPercent", value: 6 },
  ],
} as Item;

describe("gear forecast", () => {
  it("grades scores into tiers", () => {
    expect(tierOf(72)).toBe("S"); expect(tierOf(65)).toBe("A"); expect(tierOf(55)).toBe("B"); expect(tierOf(40)).toBe("Sell");
  });
  it("applies a manual edit and recomputes rolls and gear score", () => {
    const e = editItem(boots, { enhance: 6, substats: [{ type: "Speed", value: 12 }, ...boots.substats.slice(1)] });
    expect(e.enhance).toBe(6);
    expect(e.substats[0].value).toBe(12);
    expect(e.substats[0].rolls).toBeGreaterThan(1);
    expect(e.substats.reduce((a, x) => a + (x.rolls ?? 1), 0)).toBe(6); // 4 starting subs + 2 enhance hits
    expect(e.gs).toBeGreaterThan(boots.gs ?? 0);
    expect(editItem(boots, { enhance: 20 }).enhance).toBe(15);
  });
  it("reports the most likely tier and current score", () => {
    let seed = 1; const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const f = forecastItem(editItem(boots, {}), { trials: 500, random });
    expect(["S", "A", "B", "Sell"]).toContain(f.likely);
    expect(f.now).toBeGreaterThan(0);
    expect(f.p50).toBeGreaterThanOrEqual(f.now);
  });
});


describe("+15 tier column", () => {
  const items = importSample(sampleExport as any).account.items;
  const unfinished = items.filter((i) => i.enhance < 15 && i.rank === "Epic").slice(0, 25);
  it("agrees with the forecast panel for the same item and focus", () => {
    for (const it of unfinished) {
      const col = tierSplit(simulateScores(it, undefined));
      const panel = forecastItem(it, { trials: FORECAST_TRIALS, random: itemRandom(it) });
      expect(col.likely).toBe(panel.likely);
      expect(col.pSell).toBeCloseTo(panel.pSell, 6);
    }
  });
  it("re-buckets cached scores when the tiers change", () => {
    const sc = simulateScores(unfinished[0], undefined);
    expect(tierSplit(sc, { S: 0, A: 0, B: 0 }).likely).toBe("S");
    expect(tierSplit(sc, { S: 999, A: 998, B: 997 }).likely).toBe("Sell");
  });
  it("grades finished gear as it is", () => {
    const done = items.find((i) => i.enhance >= 15 && i.level !== 85)!;
    const sp = tierSplit(simulateScores(done, undefined));
    expect(sp.finished).toBe(true);
    expect(sp.pS + sp.pA + sp.pB + sp.pSell).toBeCloseTo(1);
  });
});

describe("manual item edit", () => {
  it("sets gear level and main value", () => {
    const e = editItem({ ...boots, level: 0, main: { ...boots.main, value: 0 } }, { level: 88, mainValue: 45 });
    expect(e.level).toBe(88);
    expect(e.main.value).toBe(45);
    expect(editItem(e, { level: undefined }).level).toBe(88);
  });
});
