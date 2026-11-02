import { describe, expect, it } from "vitest";
import { convertDecoderResponse, convertRawItem, mergeScan } from "../src/engine/scan";

// Shapes match what the Fribbels decoder returns (fields used by scanner.js).
const rawSword = {
  id: 111, code: "ecw6w_1", f: "set_speed", g: 5, level: 85, name: "Speed Sword", mainStatValue: 515, p: 9001,
  op: [["att", 103], ["speed", 4], ["cri", 0.04], ["speed", 3], ["cri", 0.05, "c"], ["att_rate", 0.07], ["cri_dmg", 0.06], ["speed", 2], ["att_rate", 0.05], ["speed", 0, "u"]],
};
const rawRing = { id: 222, type: "ring", f: "set_cri", g: 4, level: 85, mainStatValue: 0.65, p: 0, op: [["att_rate", 0.13], ["cri", 0.05], ["speed", 4], ["max_hp", 180]] };

describe("live capture conversion", () => {
  it("converts decoder items like Fribbels' scanner.js", () => {
    const s = convertRawItem(rawSword)!;
    expect(s.gear).toBe("Weapon");
    expect(s.rank).toBe("Epic");
    expect(s.set).toBe("SpeedSet");
    expect(s.enhance).toBe(15);
    expect(s.main).toEqual({ type: "Attack", value: 515 });
    const spd = s.substats.find((x: any) => x.type === "Speed");
    expect(spd.value).toBe(9);
    expect(s.substats.find((x: any) => x.type === "CriticalHitChancePercent").modified).toBe(true);
    const r = convertRawItem(rawRing)!;
    expect(r.gear).toBe("Ring");
    expect(r.rank).toBe("Heroic");
    expect(r.enhance).toBe(0);
    expect(r.main.value).toBe(65);
  });

  it("links gear to captured heroes and dedupes units by name", () => {
    const scan = convertDecoderResponse({
      status: "SUCCESS", data: [rawSword, rawRing],
      units: [[{ id: 9001, name: "Krau", g: 6 }, { id: 9002, name: "Krau", g: 3 }, { id: 9003, name: "Fodder", g: 2 }]],
    });
    expect(scan.heroes.map((h) => h.name)).toEqual(["Krau"]);
    expect(scan.heroes[0].equipment.Weapon).toBe("111");
    const { account, report } = mergeScan(null, scan);
    expect(report.added).toBe(2);
    const krau = account.heroes[0];
    expect(krau.equipment.Weapon).toBe("111");
    expect(account.items.find((i) => i.id === "111")!.equippedById).toBe(krau.id);
  });

  it("merges a later gear scan into an existing account without losing manual hero bonuses", () => {
    const first = mergeScan(null, convertDecoderResponse({ status: "SUCCESS", data: [rawSword], units: [[{ id: 9001, name: "Krau", g: 6 }]] })).account;
    first.heroes[0].bonuses.hp = 999; // e.g. artifact entered by hand
    const moved = { ...rawSword, p: 0 };
    const { account, report } = mergeScan(first, convertDecoderResponse({ status: "SUCCESS", data: [moved, rawRing], units: [] }));
    expect(report.updated).toBe(1);
    expect(report.added).toBe(1);
    expect(account.heroes[0].bonuses.hp).toBe(999);
    expect(account.heroes[0].equipment.Weapon).toBeUndefined();
  });

  it("relinks gear when the hero list is captured after the inventory", () => {
    const gearOnly = mergeScan(null, convertDecoderResponse({ status: "SUCCESS", data: [rawSword], units: [] })).account;
    const { account } = mergeScan(gearOnly, { items: [], heroes: [{ id: "9001", name: "Krau", stars: 6, equipment: {} }] });
    expect(account.heroes[0].equipment.Weapon).toBe("111");
  });

  it("reports decoder failure", () => {
    expect(() => convertDecoderResponse({ status: "FAIL" })).toThrow(/Decoder/);
  });
});

describe("gear the decoder doesn't know yet (new level-88 pieces)", () => {
  // As captured: no level and no main value, base main roll in op[0].
  const rawChoker = { id: 333, type: "neck", f: "set_max_hp", g: 5, p: 0,
    op: [["max_hp_rate", 0.13], ["def_rate", 0.04], ["speed", 4], ["acc", 0.05], ["res", 0.04], ["speed", 4], ["acc", 0.06], ["speed", 4], ["def_rate", 0.04], ["speed", 3]] };
  it("fills the +15 main value from the base roll and leaves the level unknown", () => {
    const c = convertRawItem(rawChoker)!;
    expect(c.enhance).toBe(15);
    expect(c.main).toEqual({ type: "HealthPercent", value: 65 });
    expect(c.level).toBe(0);
  });
  it("keeps a level entered by hand across later scans", () => {
    const first = mergeScan(null, convertDecoderResponse({ status: "SUCCESS", data: [rawChoker], units: [] })).account;
    first.items[0].level = 88;
    const again = mergeScan(first, convertDecoderResponse({ status: "SUCCESS", data: [rawChoker], units: [] })).account;
    expect(again.items[0].level).toBe(88);
    expect(again.items[0].main.value).toBe(65);
  });
});
