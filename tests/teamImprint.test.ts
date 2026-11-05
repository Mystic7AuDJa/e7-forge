import { describe, expect, it } from "vitest";
import { teamImprintBonus } from "../src/engine/teamImprint";
import type { Hero, HeroData } from "../src/engine/types";

const hero = (id: string, name: string, imprint?: Hero["imprint"]): Hero => ({ id, name, stars: 6, bonuses: {} as any, equipment: {}, imprint } as Hero);
const release = (stat: string, label: string, position: string, sss: number) => ({ release: { stat, label, grades: { SSS: sss }, position } });

// teamImprintBonus reads imprint tables through imprintFor(hd); give each hero its own Release row.
const tables: Record<string, any> = {
  Me: release("cd", "Crit Damage", "all", 0),
  Ally: release("cr", "Crit Chance", "all", 12),
  Corner: release("atkPct", "Attack", "lb", 9),
};
const hdOf = (h: Hero) => ({ name: h.name, imprints: tables[h.name] } as unknown as HeroData);

describe("team imprints", () => {
  const me = hero("1", "Me");
  const ally = hero("2", "Ally", { grade: "SSS", mode: "release", source: "manual" });
  const corner = hero("3", "Corner", { grade: "SSS", mode: "release", source: "manual" });
  const byId = new Map([me, ally, corner].map((h) => [h.id, h]));
  it("adds teammates' all-ally auras and hand-entered buffs", () => {
    const r = teamImprintBonus(me, { mates: ["2"], manual: { cd: 10 } }, byId, hdOf);
    expect(r.bonus.cr).toBe(12);
    expect(r.bonus.cd).toBe(10);
    expect(r.total).toEqual(["Crit Chance +12%", "Crit Damage +10%"]);
  });
  it("counts slot-limited auras only when ticked", () => {
    expect(teamImprintBonus(me, { mates: ["3"] }, byId, hdOf).bonus.atkPct).toBeUndefined();
    expect(teamImprintBonus(me, { mates: ["3"], slotAuras: ["3"] }, byId, hdOf).bonus.atkPct).toBe(9);
  });
  it("is empty without a team", () => {
    expect(teamImprintBonus(me, undefined, byId, hdOf).any).toBe(false);
  });
});
