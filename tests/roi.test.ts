import { describe, expect, it } from "vitest";
import { editItem, forecastItem, tierOf } from "../src/engine/roi";
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
