import { describe, expect, it } from "vitest";
import { artifactFits, parseArtifactDictionary } from "../src/engine/dictionary";

const raw = `slendy.gg E7 Dictionary Game data from 2026-10-10
Heroes Artifacts Buffs & Debuffs
Search artifacts by name or effect Any class Knight Warrior Thief Ranger Mage Soul Weaver 3 artifacts
3F
Knight ★★★★★
After attacking, has a 50-100% chance to
inflict additional damage.
A Symbol of Unity
Any class ★★★★★
When attacking, increases Hit Chance by 10-
20%.
Ruby Essence
Any class ★★★
Recovers 0.03-0.05% of max Health.`;

describe("artifact dictionary", () => {
  const { dict, unknown } = parseArtifactDictionary(raw, ["3F", "A Symbol of Unity"]);
  it("reads class, stars and effect", () => {
    expect(dict.gameData).toBe("2026-10-10");
    expect(dict.artifacts["3F"]).toEqual({ class: "Knight", stars: 5, effect: "After attacking, has a 50-100% chance to inflict additional damage." });
    expect(dict.artifacts["A Symbol of Unity"].effect).toBe("When attacking, increases Hit Chance by 10-20%.");
  });
  it("keeps artifacts hero data doesn't know yet", () => {
    expect(unknown).toEqual(["Ruby Essence"]);
    expect(dict.artifacts["Ruby Essence"].stars).toBe(3);
  });
  it("checks class locks", () => {
    expect(artifactFits(dict.artifacts["3F"], "knight")).toBe(true);
    expect(artifactFits(dict.artifacts["3F"], "manauser")).toBe(false);
    expect(artifactFits(dict.artifacts["A Symbol of Unity"], "assassin")).toBe(true);
  });
});
