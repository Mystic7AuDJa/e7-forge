import { describe, expect, it } from "vitest";
import { parseRtaMeta, buildMeta, suggestPvp, cleaveViable } from "../src/engine/meta";
import { teamMorale, reactions, mapCamping } from "../src/engine/camping";
import { buildHeroDb } from "../src/engine/data";
import { candidatesFrom } from "../src/engine/teams";
import { importFribbels } from "../src/engine/importer";
import herodata from "../data/herodata.json";
import tags from "../data/hero-tags.json";
import tiers from "../data/epic7db-tiers.json";
import topics from "../data/camping-topics.json";
import sample from "../data/sample-fribbels-export.json";

const payload = (obj: unknown) => `<script>self.__next_f.push([1,${JSON.stringify(JSON.stringify(obj).slice(0, 40))}])</script><script>self.__next_f.push([1,${JSON.stringify(JSON.stringify(obj).slice(40))}])</script>`;
const row = (code: string, name: string, pct: number, wr: number) => ({ count: 10, win_rate: wr, count_pct: pct, hero_code: code, hero_name: name });

describe("RTA meta parsing", () => {
  it("reads picks, pre-bans, win rates and dates across split chunks", () => {
    const page = payload({ start_date: "$D2026-10-23T00:00:00.000Z", end_date: "$D2026-10-29T00:00:00.000Z",
      picked_heroes: { count: [row("c1", "Arbiter Vildred", 30, 52)] }, prebanned_heroes: { count: [row("c2", "Lisette", 51, 50)] }, win_rate_heroes: { count: [row("c1", "Arbiter Vildred", 30, 52)] } });
    const m = parseRtaMeta(page, "2026-11-01T00:00:00Z");
    expect(m.picked[0]).toMatchObject({ name: "Arbiter Vildred", pct: 30, winRate: 52 });
    expect(m.prebanned[0].name).toBe("Lisette");
    expect(m.start).toContain("2026-10-23");
  });
  it("throws when the layout changes", () => {
    expect(() => parseRtaMeta("<html></html>")).toThrow(/not found/);
  });
});

describe("camping morale", () => {
  const table = [{ name: "A", values: [3, 0, -2] }, { name: "B", values: [0, 5, 1] }];
  it("adds both personalities, ignoring dislikes", () => {
    expect(reactions([0, 2], table)).toEqual({ A: 3, B: 1 });
  });
  it("uses the two best options with different topics, scored by the other three", () => {
    const team = [
      { name: "h1", camp: { topics: ["A", "B"], personalities: [0, 1] } },
      { name: "h2", camp: { topics: ["A"], personalities: [0, 0] } },
      { name: "h3", camp: { topics: [], personalities: [1, 1] } },
      { name: "h4", camp: { topics: [], personalities: [2, 2] } },
    ];
    // h1 A: h2 6 + h3 0 + h4 0 = 6; h1 B: h2 0 + h3 10 + h4 2 = 12; h2 A: h1 3 + 0 + 0 = 3
    const r = teamMorale(team, table)!;
    expect(r.morale).toBe(18);
    expect(new Set(r.topics)).toEqual(new Set(["A", "B"]));
  });
  it("maps camping slugs to hero names", () => {
    const m = mapCamping({ "arbiter-vildred": { camping: { topics: ["X", "Y"], personalities: [1, 2] } } }, {}, ["Arbiter Vildred"]);
    expect(m["Arbiter Vildred"].topics).toEqual(["X", "Y"]);
  });
  it("topic table is complete", () => { expect((topics as any[]).length).toBeGreaterThanOrEqual(20); });
});

describe("PvP suggestions", () => {
  const db = buildHeroDb(herodata as any, tags as any);
  const acc = importFribbels(sample as any).account;
  const cands = candidatesFrom(acc.heroes, (h) => db.get(h.dataKey || h.name), acc.items);
  const meta = buildMeta(tiers as any, "rta", null, db);
  it("tier names all exist in hero data", () => {
    const missing = Object.values((tiers as any).rta.tiers).flat().filter((n: any) => !db.has(n));
    expect(missing).toEqual([]);
  });
  for (const mode of ["arena_def", "rta", "gw_off", "gw_def"] as const) {
    it(`builds ${mode} teams of the right size`, () => {
      const r = suggestPvp(cands, meta, mode);
      const size = { arena_def: 4, rta: 5, gw_off: 3, gw_def: 3 }[mode];
      expect(r.teams.length).toBeGreaterThan(0);
      for (const t of r.teams) expect(new Set(t.heroIds).size).toBe(size);
    });
  }
  it("cleave GW offense leaves out pure sustain healers", () => {
    const r = suggestPvp(cands, meta, "gw_off", { style: "cleave" });
    const names = r.teams.flatMap((t) => t.names);
    expect(names).not.toContain("Tamarinne");
    expect(typeof cleaveViable(cands)).toBe("boolean");
  });
});
