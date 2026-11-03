import { describe, expect, it } from "vitest";
import artifacts from "../data/artifactdata.json";
import { ARTIFACT_LEVELS, artifactStats } from "../src/engine/artifact";
import { importFribbels } from "../src/engine/importer";
import { effectiveBonuses } from "../src/engine/imprint";

const unity = (artifacts as any)["A Symbol of Unity"];

describe("artifact stats", () => {
  it("grows linearly from +0 to 13x at +30", () => {
    expect(artifactStats(unity, 0)).toMatchObject({ atk: 21, hp: 32, def: 0 });
    expect(artifactStats(unity, 30)).toMatchObject({ atk: 273, hp: 416 });
    expect(artifactStats(unity, 15).atk).toBeCloseTo(147);
  });
  it("offers every limit break", () => {
    expect(ARTIFACT_LEVELS).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30]);
  });
});

describe("Fribbels artifact import", () => {
  // Fribbels' aei* totals already include the artifact; artifactAttack is a copy.
  const hero = { id: "h1", name: "Krau", aeiAtk: 300, aeiHp: 500, artifactName: "A Symbol of Unity", artifactLevel: "30", artifactAttack: 273, artifactHealth: 416, artifactDefense: 0 };
  it("keeps the artifact separate and counts it once", () => {
    const h = importFribbels({ heroes: [hero], items: [] }).account.heroes[0];
    expect(h.artifact).toMatchObject({ name: "A Symbol of Unity", level: 30, atk: 273, hp: 416 });
    expect(h.bonuses.atk).toBeCloseTo(27);
    const b = effectiveBonuses(h, { imprint: undefined } as any);
    expect(b.atk).toBeCloseTo(300);
    expect(b.hp).toBeCloseTo(500);
  });
});
