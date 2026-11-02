import { describe, expect, it } from "vitest";
import sample from "../data/sample-fribbels-export.json";
import { importFribbels } from "../src/engine/importer";
import { removeItem } from "../src/engine/inventory";

describe("removeItem", () => {
  it("removes the item and empties the slot of the hero wearing it", () => {
    const acc = importFribbels(sample as any).account;
    const worn = acc.items.find((i) => i.equippedById)!;
    const hero = acc.heroes.find((h) => h.id === worn.equippedById)!;
    expect(removeItem(acc, worn.id)).toBe(true);
    expect(acc.items.some((i) => i.id === worn.id)).toBe(false);
    expect(Object.values(hero.equipment)).not.toContain(worn.id);
    expect(removeItem(acc, worn.id)).toBe(false);
  });
});
