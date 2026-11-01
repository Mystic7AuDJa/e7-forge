import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  benchmark, buildHeroDb, buildTeams, candidatesFrom, computeFor, currentBuildStats, deriveTags, estimateRolls, findHeroData,
  forecastItem, gearScore, importFribbels, optimizeAccount, optimizeHero, parseEpic7dbHeroPage, recommend, reforgedSubs,
  requiredSpeed, simulate, simulateEnhance, validateTune, winSpeedRace, GEAR_SLOTS, type Item, type Unit,
} from "../src/engine";

const herodata = JSON.parse(readFileSync("data/herodata.json", "utf8"));
const tags = JSON.parse(readFileSync("data/hero-tags.json", "utf8"));
const db = buildHeroDb(herodata, tags);
const rawExport = JSON.parse(readFileSync("data/sample-fribbels-export.json", "utf8"));
const { account, report } = importFribbels(rawExport);
const hd = (name: string) => findHeroData(db, name)!;
const heroByName = (n: string) => account.heroes.find((h) => h.name === n)!;

/** Seeded RNG for deterministic Monte Carlo tests. */
function rng(seed = 42) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe("import", () => {
  it("reads a Fribbels export (same format as the RexQian fork)", () => {
    expect(report.heroes).toBe(10);
    expect(report.items).toBe(772);
    expect(report.skippedItems).toBe(0);
    const ruele = heroByName("Ruele of Light");
    expect(Object.keys(ruele.equipment).length).toBe(6);
    for (const id of Object.values(ruele.equipment)) expect(account.items.find((i) => i.id === id)?.equippedById).toBe(ruele.id);
  });
  it("rejects files without heroes or items", () => {
    expect(() => importFribbels({ foo: 1 })).toThrow(/No heroes or items/);
  });
});

describe("gear math", () => {
  const item: Item = {
    id: "t", gear: "Weapon", rank: "Epic", set: "RageSet", level: 85, enhance: 15, main: { type: "Attack", value: 515 },
    substats: [
      { type: "AttackPercent", value: 10 }, { type: "Speed", value: 7 },
      { type: "CriticalHitChancePercent", value: 7 }, { type: "CriticalHitDamagePercent", value: 9 },
    ],
  };
  it("gear score uses Fribbels weights", () => {
    expect(gearScore(item.substats)).toBeCloseTo(10 + 14 + 7 * 1.6 + 9 * 8 / 7, 0);
  });
  it("estimates 9 total rolls on +15 epic gear", () => {
    const subs = estimateRolls(structuredClone(item));
    expect(subs.reduce((a, s) => a + (s.rolls ?? 0), 0)).toBe(9);
  });
  it("reforge adds roll-based bonuses", () => {
    const r = reforgedSubs(structuredClone(item));
    expect(r.find((s) => s.type === "Speed")!.value).toBeGreaterThanOrEqual(7);
    expect(gearScore(r)).toBeGreaterThan(gearScore(item.substats));
  });
});

describe("stat calculation", () => {
  it("matches Fribbels numbers for a hero whose base data hasn't changed (Cermia)", () => {
    const h = heroByName("Cermia");
    const s = currentBuildStats(h, hd("Cermia"), account.items).stats;
    const ref = rawExport.heroes.find((x: any) => x.name === "Cermia");
    for (const k of ["atk", "hp", "def", "spd", "cr", "cd", "eff", "res"] as const) expect(s[k]).toBe(ref[k]);
  });
});

describe("single-hero optimizer", () => {
  const hero = heroByName("Krau");
  const data = hd("Krau");
  // small pool for exhaustive comparison
  const pool = GEAR_SLOTS.flatMap((slot) => account.items.filter((i) => i.gear === slot).slice(0, 4));

  it("finds the same best build as brute force", () => {
    const weights = { ehp: 1, spd: 1 };
    const res = optimizeHero(hero, data, pool, { heroId: hero.id, weights, allowEquipped: true, limit: 3 });
    const bySlot = GEAR_SLOTS.map((s) => pool.filter((i) => i.gear === s));
    let best = -Infinity;
    const pick: Item[] = [];
    const refs = res.builds[0] ? undefined : undefined;
    void refs;
    const rec = (d: number) => {
      if (d === 6) {
        const st = computeFor(data, hero, pick);
        const sc = st.ehp / (Math.max(1, currentBuildStats(hero, data, pool).stats.ehp) * 0.03) + st.spd / 3;
        if (sc > best) best = sc;
        return;
      }
      for (const it of bySlot[d]) { pick.push(it); rec(d + 1); pick.pop(); }
    };
    rec(0);
    expect(res.truncated).toBe(false);
    expect(res.builds[0].score).toBeCloseTo(best, 1);
  });

  it("respects min stats and set requirements", () => {
    const res = optimizeHero(hero, data, account.items, {
      heroId: hero.id, allowEquipped: true, weights: { hp: 1, spd: 2 }, min: { spd: 180 }, sets: [["SpeedSet"]], limit: 10, topPerSlot: 25,
    });
    expect(res.builds.length).toBeGreaterThan(0);
    for (const b of res.builds) { expect(b.stats.spd).toBeGreaterThanOrEqual(180); expect(b.sets).toContain("SpeedSet"); }
  });

  it("respects max stats", () => {
    const res = optimizeHero(hero, data, account.items, { heroId: hero.id, allowEquipped: true, weights: { hp: 1 }, max: { spd: 150 }, limit: 5, topPerSlot: 15 });
    for (const b of res.builds) expect(b.stats.spd).toBeLessThanOrEqual(150);
  });
});

describe("account-wide optimizer", () => {
  it("assigns builds with no shared items and honors speed order", () => {
    const names = ["Krau", "Achates", "Cermia"];
    const heroes = names.map(heroByName);
    const res = optimizeAccount(account.heroes, (h) => findHeroData(db, h.name), account.items, {
      heroes: heroes.map((h, i) => ({ request: { heroId: h.id, weights: { cp: 1, spd: 1 }, topPerSlot: 18, limit: 20 }, priority: 3 - i })),
      speedOrder: [{ faster: heroes[1].id, slower: heroes[2].id, margin: 0 }],
      buildsPerHero: 20,
    }, { timeLimitMs: 8000 });
    const ids = res.assignments.flatMap((a) => Object.values(a.build?.items ?? {}));
    expect(new Set(ids).size).toBe(ids.length);
    expect(res.assignments.every((a) => a.build)).toBe(true);
    const sp = Object.fromEntries(res.assignments.map((a) => [a.heroId, a.build!.stats.spd]));
    expect(sp[heroes[1].id]).toBeGreaterThanOrEqual(sp[heroes[2].id]);
  }, 60000);
});

describe("speed tuning", () => {
  const units: Unit[] = [
    { id: "ran", name: "Ran", spd: 305, side: "ally" },
    { id: "peira", name: "Peira", spd: 294, side: "ally" },
    { id: "enemy", name: "Enemy", spd: 200, side: "enemy" },
  ];
  it("simulates the faster unit first with no RNG", () => {
    const ev = simulate(units, { rng: 0, turns: 3 });
    expect(ev.map((e) => e.unit)).toEqual(["ran", "peira", "enemy"]);
  });
  it("flags a cut-risk inside the 5% speed RNG window", () => {
    const rep = validateTune(units, { order: ["ran", "peira"] }, { trials: 2000, random: rng(1) });
    expect(rep.successRate).toBeLessThan(1);
    expect(rep.warnings[0]).toMatch(/Peira may cut Ran/);
    expect(rep.pairFailures[0].neededSpd).toBeGreaterThanOrEqual(305);
  });
  it("guarantees order beyond the RNG window", () => {
    const safe = units.map((u) => (u.id === "ran" ? { ...u, spd: 310 } : u));
    expect(validateTune(safe, { order: ["ran", "peira"] }, { trials: 2000 }).successRate).toBe(1);
  });
  it("CR push lets a slower unit act second", () => {
    const team: Unit[] = [
      { id: "a", name: "Pusher", spd: 300, side: "ally", effects: [{ target: "allies_except_self", cr: 50 }] },
      { id: "b", name: "DPS", spd: 200, side: "ally" },
      { id: "e", name: "Enemy", spd: 260, side: "enemy" },
    ];
    expect(simulate(team, { rng: 0, turns: 3 }).map((e) => e.unit)).toEqual(["a", "b", "e"]);
  });
  it("required speed is near the analytic 5% bound", () => {
    expect(requiredSpeed(units, "ran", "peira", { order: ["ran", "peira"] })).toBeGreaterThanOrEqual(306);
    expect(requiredSpeed(units, "ran", "peira", { order: ["ran", "peira"] })).toBeLessThanOrEqual(312);
  });
  it("speed race probability is monotone", () => {
    expect(winSpeedRace(300, 220, 280)).toBeGreaterThan(winSpeedRace(240, 220, 280));
  });
});

describe("upgrade ROI", () => {
  const plus0: Item = {
    id: "p0", gear: "Boots", rank: "Heroic", set: "SpeedSet", level: 85, enhance: 0, main: { type: "Speed", value: 8 },
    substats: [{ type: "CriticalHitChancePercent", value: 4 }, { type: "AttackPercent", value: 6 }, { type: "HealthPercent", value: 5 }],
  };
  it("reveals the 4th substat on heroic gear and rolls the rest", () => {
    const subs = simulateEnhance(plus0, rng(3));
    expect(subs.length).toBe(4);
    expect(subs.some((s) => s.type === "Speed")).toBe(false); // main stat can't be a sub
  });
  it("tier probabilities sum to 1", () => {
    const f = forecastItem(plus0, { trials: 1500, random: rng(9) });
    expect(f.pS + f.pA + f.pB + f.pSell).toBeCloseTo(1, 5);
    expect(f.stepsLeft).toBe(5);
  });
});

describe("benchmark", () => {
  it("computes top-percent", () => {
    const builds = Array.from({ length: 100 }, (_, i) => ({ atk: i, hp: i, def: i, spd: 100 + i, chc: i, chd: i, eff: i, efr: i, gs: i + 1 }));
    const r = benchmark({ spd: 190, hp: 0, atk: 0, def: 0, cr: 0, cd: 0, eff: 0, res: 0, gs: 0 }, builds);
    expect(r.topPct.spd).toBe(9);
    expect(r.sample).toBe(100);
  });
});

describe("tags", () => {
  it("parses epic7db skills and detects strip vs cleanse", () => {
    const html = `<div class="skill accordion open"><div class="title"><h3>Blade</h3></div>
      <img src="/images/status_effects/dispel.png" alt="Dispel"><div class="bottom"><p>Attacks all enemies, removing two buffs.</p></div></div>
      <div class="skill accordion"><div class="title"><h3>Grace</h3></div><div class="bottom"><p>Dispels all debuffs from all allies.</p></div></div></section>`;
    const skills = parseEpic7dbHeroPage(html);
    expect(skills.length).toBe(2);
    const t = deriveTags({ scraped: skills });
    expect(t).toEqual(expect.arrayContaining(["strip", "cleanse", "aoe"]));
  });
  it("bundled tags cover nearly all heroes", () => {
    const untagged = Object.values(tags as Record<string, string[]>).filter((x) => !x.length).length;
    expect(untagged).toBeLessThan(10);
  });
});

describe("recommendation + teams", () => {
  it("recommends a crit DPS with a crit floor and explains it", () => {
    const h = heroByName("Cermia");
    const r = recommend({ hero: h, hd: hd("Cermia"), items: account.items, roster: [], allowEquipped: true, options: { timeLimitMs: 6000 } });
    expect(r.reasons.length).toBeGreaterThan(2);
    if (r.build && !r.relaxed.some((x) => x.startsWith("CR"))) expect(r.build.stats.cr).toBeGreaterThanOrEqual(r.archetype === "crit_dps" ? 85 : 0);
  }, 60000);
  it("builds unique teams of the right size", () => {
    const c = candidatesFrom(account.heroes, (h) => findHeroData(db, h.name), account.items);
    const teams = buildTeams(c, "pve", { top: 3 });
    expect(teams.length).toBeGreaterThan(0);
    for (const t of teams) { expect(t.members.length).toBe(4); expect(new Set(t.members.map((m) => m.hero.id)).size).toBe(4); }
  });
});

import { eliteProfile, communitySets } from "../src/engine/benchmark";
import { targetMatch } from "../src/engine/optimizer";

describe("benchmark-driven optimizer", () => {
  it("builds a top-1% profile with set combos", () => {
    const builds = Array.from({ length: 1000 }, (_, i) => ({ atk: 3000 + i, hp: 10000, def: 900, spd: 200 + (i % 100), chc: 100, chd: 250 + i / 10, eff: 0, efr: 0, gs: i + 1, sets: (i % 2 ? { set_speed: "4", set_cri: "2" } : { set_cri_dmg: "4", set_cri: "2" }) as Record<string, string> }));
    const p = eliteProfile(builds, 0.01);
    expect(p.cohort).toBe(10);
    expect(p.targets.atk).toBeGreaterThan(3980);
    expect(p.setCombos[0].sets.length).toBe(2);
    expect(communitySets({ set_speed: "4", set_cri: "2" })).toEqual(["CriticalSet", "SpeedSet"]);
  });

  it("scores closeness to targets with priority weights and is monotone", () => {
    const t = { stats: { spd: 300, cr: 100, atk: 4000 }, priorities: ["spd" as const] };
    const base: any = { spd: 250, cr: 100, atk: 4000, hp: 0, def: 0, cd: 0, eff: 0, res: 0 };
    const a = targetMatch(base, t).score;
    const faster = targetMatch({ ...base, spd: 280 }, t).score;
    const stronger = targetMatch({ ...base, atk: 4400 }, t).score;
    expect(faster).toBeGreaterThan(a);
    expect(faster - a).toBeGreaterThan(stronger - a); // priority stat matters more
    expect(targetMatch({ ...base, spd: 300 }, t).score).toBeCloseTo(100, 5);
  });

  it("optimizer gets closer to targets than the current build", () => {
    const hero = heroByName("Cermia");
    const data = hd("Cermia");
    const cur = currentBuildStats(hero, data, account.items).stats;
    const targets = { stats: { spd: 230, cr: 100, cd: 320, atk: 4800 }, priorities: ["spd", "cr", "cd", "atk"] as any };
    const res = optimizeHero(hero, data, account.items, { heroId: hero.id, targets, allowEquipped: true, limit: 5 }, { timeLimitMs: 15000 });
    expect(res.builds.length).toBeGreaterThan(0);
    expect(res.builds[0].score).toBeGreaterThanOrEqual(targetMatch(cur, targets).score);
    expect(res.builds[0].score).toBeLessThanOrEqual(101);
  });
});

import { analyzeThreats, bandForPoints, counterTeams, estimateEnemy, speedRace } from "../src/engine/counters";

describe("counter planner", () => {
  const builds = Array.from({ length: 200 }, (_, i) => ({ atk: 3000 + i, hp: 9000 + i * 10, def: 800, spd: 180 + Math.floor(i / 2), chc: 100, chd: 280, eff: 0, efr: 0, gs: i + 1, sets: { set_speed: "4", set_cri: "2" } as Record<string, string> }));
  it("maps points to a gear band and estimates from that slice", () => {
    expect(bandForPoints(4100).from).toBe(3);
    expect(bandForPoints(1200).to).toBe(70);
    const top = estimateEnemy("Ran", hd("Ruele of Light"), builds, { from: 0, to: 10, label: "" });
    const low = estimateEnemy("Ran", hd("Ruele of Light"), builds, { from: 50, to: 80, label: "" });
    expect(top.bandSize).toBe(20);
    expect(top.stats.spd).toBeGreaterThan(low.stats.spd);
    expect(top.sets[0].sets).toEqual(["CriticalSet", "SpeedSet"]);
    const none = estimateEnemy("X", hd("Krau"), [], { from: 0, to: 10, label: "" });
    expect(none.bandSize).toBe(0);
    expect(none.stats.spd).toBeGreaterThan(hd("Krau").base.spd);
  });
  it("finds threats and builds unique counter teams of the right size", () => {
    const enemies = ["Krau", "Achates", "Ruele of Light", "Cermia"].map((n) => estimateEnemy(n, hd(n), builds, { from: 5, to: 15, label: "" }));
    const threats = analyzeThreats(enemies);
    expect(threats.length).toBeGreaterThan(0);
    const cands = candidatesFrom(account.heroes, (h) => findHeroData(db, h.name), account.items);
    const { teams } = counterTeams(cands, enemies, "arena", { top: 3 });
    expect(teams.length).toBeGreaterThan(0);
    for (const t of teams) {
      expect(t.heroIds.length).toBe(4);
      expect(new Set(t.heroIds).size).toBe(4);
      expect(t.outlook).toBeGreaterThanOrEqual(0); expect(t.outlook).toBeLessThanOrEqual(100);
    }
    const gw = counterTeams(cands, enemies.slice(0, 3), "gw", { top: 2 });
    expect(gw.teams[0].heroIds.length).toBe(3);
  });
  it("speed race favours the faster team", () => {
    const enemies = [estimateEnemy("Krau", hd("Krau"), builds, { from: 50, to: 60, label: "" })];
    const fast = speedRace([{ name: "A", spd: 300 }], enemies, 0.05, 800);
    const slow = speedRace([{ name: "A", spd: 150 }], enemies, 0.05, 800);
    expect(fast.firstTurn).toBeGreaterThan(0.95);
    expect(slow.firstTurn).toBeLessThan(0.05);
    expect(fast.needed).toBeGreaterThan(enemies[0].stats.spd);
  });
});
