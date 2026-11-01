import { describe, expect, it } from "vitest";
import herodata from "../data/herodata.json";
import tags from "../data/hero-tags.json";
import imprints from "../data/imprints.json";
import { buildHeroDb } from "../src/engine/data";
import { auraBonuses, effectiveBonuses, gradeForValue, parseImprintText, positionLabel, teamAuras } from "../src/engine/imprint";
import { importFribbels } from "../src/engine/importer";
import { computeFor } from "../src/engine/optimizer";
import type { Hero } from "../src/engine/types";

const db = buildHeroDb(herodata as any, tags as any, imprints as any);
const zero = { atk: 0, hp: 0, def: 0, atkPct: 0, hpPct: 0, defPct: 0, spd: 0, cr: 0, cd: 0, eff: 0, res: 0, finalAtkMult: 0, finalHpMult: 0, finalDefMult: 0 };
const hero = (name: string, imprint?: Hero["imprint"]): Hero => ({ id: name, name, dataKey: name, rarity: 5, attribute: "", role: "", bonuses: { ...zero }, equipment: {}, imprint });

describe("memory imprint", () => {
  it("parses epic7db imprint text", () => {
    expect(parseImprintText("Attack 12.9%")).toEqual({ stat: "atkPct", label: "Attack", value: 12.9 });
    expect(parseImprintText("Health +18%")).toMatchObject({ stat: "hpPct", value: 18 });
    expect(parseImprintText("Speed 4")).toMatchObject({ stat: "spd", value: 4 });
    expect(parseImprintText("Dual Attack Chance 2.1%")).toBeNull();
  });

  it("labels formation slots", () => {
    expect(positionLabel("all")).toBe("all allies");
    expect(positionLabel("lr")).toBe("allies in the left and right slots");
  });

  it("adds Concentration to the hero's own stats unless it's already in the bonuses", () => {
    const hd = db.get("Tamarinne")!;
    const conc = hd.imprints!.concentration!;
    const v = conc.grades.SSS!;
    expect(effectiveBonuses(hero("Tamarinne", { grade: "SSS", mode: "concentration", source: "manual" }), hd)[conc.stat]).toBe(v);
    expect(effectiveBonuses(hero("Tamarinne", { grade: "SSS", mode: "concentration", source: "import", inBonuses: true }), hd)[conc.stat]).toBe(0);
    expect(effectiveBonuses(hero("Tamarinne", { grade: "SSS", mode: "release", source: "manual" }), hd)[conc.stat]).toBe(0);
    const base = computeFor(hd, hero("Tamarinne"), []);
    const withConc = computeFor(hd, hero("Tamarinne", { grade: "SSS", mode: "concentration", source: "manual" }), []);
    expect(withConc.hp).toBeGreaterThan(base.hp);
  });

  it("gives Release auras to the team", () => {
    const tam = { hero: hero("Tamarinne", { grade: "SSS", mode: "release", source: "manual" }), hd: db.get("Tamarinne")! };
    const av = { hero: hero("Arbiter Vildred", { grade: "SSS", mode: "release", source: "manual" }), hd: db.get("Arbiter Vildred")! };
    const auras = teamAuras([tam, av]);
    expect(auras).toHaveLength(2);
    const extra = auraBonuses(auras);
    expect(extra.atkPct).toBe(12.9); // Tamarinne: all allies
    expect(extra.eff).toBeUndefined(); // Arbiter Vildred: left/right slots only, depends on formation
  });

  it("reads Fribbels imprintNumber as an imported Concentration", () => {
    const { account } = importFribbels({ heroes: [{ id: "1", name: "Tamarinne", imprintNumber: "21.0", equipment: {} }], items: [] });
    const imp = account.heroes[0].imprint!;
    expect(imp).toMatchObject({ mode: "concentration", source: "import", inBonuses: true, value: 21 });
    expect(gradeForValue(db.get("Tamarinne"), 21)).toBe("SSS");
  });
});
