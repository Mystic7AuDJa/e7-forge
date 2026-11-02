import { describe, expect, it } from "vitest";
import herodata from "../data/herodata.json";
import tags from "../data/hero-tags.json";
import tiers from "../data/epic7db-tiers.json";
import sample from "../data/sample-fribbels-export.json";
import analyzerIndex from "../data/meta-history/e7analyzer/index.json";
import { buildHeroDb } from "../src/engine/data";
import { importFribbels } from "../src/engine/importer";
import { candidatesFrom } from "../src/engine/teams";
import { banAdvice, buildDraftData, nextTurn, pairBonus, recommendPicks, slotKey, type DraftState } from "../src/engine/draft";
import { buildMeta, suggestPvp } from "../src/engine/meta";
import fs from "node:fs";

const analyzer = JSON.parse(fs.readFileSync(`data/meta-history/e7analyzer/${(analyzerIndex as string[]).at(-1)}`, "utf8"));
const db = buildHeroDb(herodata as any, tags as any);
const acc = importFribbels(sample as any).account;
const cands = candidatesFrom(acc.heroes, (h) => db.get(h.dataKey || h.name), acc.items);
const d = buildDraftData(analyzer, null, tiers as any);
const hd = (n: string) => db.get(n);
const base: DraftState = { firstPick: "me", myPrebans: [], enemyPrebans: [], myPicks: [], enemyPicks: [] };

describe("draft data", () => {
  it("shrinks win rates toward the pool average", () => {
    const lisette = d.power.get("Lisette")!;
    expect(lisette.basis).toBe("data");
    expect(lisette.edge).toBeGreaterThan(0);
    expect(lisette.edge).toBeLessThan(lisette.win! - d.mean); // 30k games: shrunk a little
    const rare = [...d.power.values()].find((p) => p.basis === "data" && p.games < 150 && p.win! > 60);
    if (rare) expect(rare.edge).toBeLessThan((rare.win! - d.mean) / 2);
  });
  it("knows proven pairs, including the corrected cut-off one", () => {
    expect(pairBonus(d, "Lisette", "Shepherd of the Dark Diene").combo?.games).toBe(3234);
    expect(pairBonus(d, "Lisette", "Shepherd of the Dark Diene").pts).toBeGreaterThan(0);
  });
});

describe("draft order", () => {
  it("follows 1-2-2-2-2-1", () => {
    const sides: string[] = [];
    const s = { ...base, firstPick: "me" as const, myPicks: [] as string[], enemyPicks: [] as string[] };
    for (let i = 0; i < 10; i++) { const t = nextTurn(s)!; sides.push(t.side === "me" ? "F" : "S"); (t.side === "me" ? s.myPicks : s.enemyPicks).push("x" + i); }
    expect(sides.join("")).toBe("FSSFFSSFFS");
    expect(nextTurn(s)).toBeNull();
  });
  it("maps side-relative slots to the site's groups", () => {
    expect([1, 2, 3, 4, 5].map((n) => slotKey(true, n))).toEqual(["1", "2", "3", "4+5", "4+5"]);
    expect([1, 2, 3, 4, 5].map((n) => slotKey(false, n))).toEqual(["1+2", "1+2", "3", "4", "5"]);
  });
});

describe("live recommendations", () => {
  it("never suggests a pre-banned or already picked hero", () => {
    const first = recommendPicks(base, cands, d, hd, 3).map((r) => r.name);
    const s: DraftState = { ...base, myPrebans: [first[0]], enemyPicks: [first[1]] };
    const next = recommendPicks(s, cands, d, hd, 20).map((r) => r.name);
    expect(next).not.toContain(first[0]);
    expect(next).not.toContain(first[1]);
  });
  it("explains each score", () => {
    const [r] = recommendPicks({ ...base, enemyPicks: ["Lisette"] }, cands, d, hd, 1);
    expect(r.parts.length).toBeGreaterThan(1);
    expect(Math.abs(r.score - r.parts.reduce((a, p) => a + p.pts, 0))).toBeLessThan(0.05);
  });
  it("ranks bans once both teams are in", () => {
    const mine = recommendPicks(base, cands, d, hd, 5).map((r) => r.name);
    const b = banAdvice({ ...base, myPicks: mine, enemyPicks: ["Lisette", "Notos", "Estelle", "Arbiter Vildred", "Boss Arunka"] }, d, hd);
    expect(b.banTheirs).toHaveLength(5);
    expect(b.theyBan.map((x) => x.name).sort()).toEqual([...mine].sort());
  });
});

describe("draft cores use top-player data", () => {
  it("fills top-player stats into the meta map and cores", () => {
    const meta = buildMeta(tiers as any, "rta", null, db, d);
    expect(meta.get("Lisette")?.topWin).toBe(66.6);
    const r = suggestPvp(cands, meta, "rta", { draft: d });
    expect(r.teams.length).toBeGreaterThan(0);
    expect(r.teams.some((t) => t.reasons.some((x) => x.startsWith("Top-player win rates")))).toBe(true);
  });
});
