// Rule-based on purpose so every target can be explained in the UI:
// archetype from skill scaling + tags, targets from community cohorts when we
// have them, and the optimizer decides what's actually reachable.
import { benchmark, eliteProfile, type CommunityBuild, type EliteProfile } from "./benchmark";
import { optimizeHero, currentBuildStats, type StatKey, type OptimizeOptions } from "./optimizer";
import { winSpeedRace } from "./speedtune";
import type { Build, DerivedStats, Hero, HeroData, Item, OptimizeRequest } from "./types";
import { classLabel } from "./labels";

export type Archetype = "crit_dps" | "hp_bruiser" | "def_bruiser" | "speed_dps" | "debuffer" | "support" | "tank";

export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  crit_dps: "Crit DPS (Attack scaling)", hp_bruiser: "Bruiser (HP scaling)", def_bruiser: "Bruiser (Defense scaling)",
  speed_dps: "Speed-scaling DPS", debuffer: "Debuffer / Controller", support: "Support", tank: "Tank",
};

const DEBUFF_TAGS = ["def_break", "stun", "sleep", "unbuffable", "silence", "speed_down", "cr_reduce", "restrict", "hit_down", "atk_down", "unhealable", "seal", "provoke"];
const SUPPORT_TAGS = ["heal", "cleanse", "cr_push", "revive", "barrier", "atk_buff", "speed_buff", "immunity", "cd_reduce", "invincible"];

export interface ArchetypeInfo { archetype: Archetype; reasons: string[]; critReliant: boolean }

export function detectArchetype(hd: HeroData): ArchetypeInfo {
  const sk = [hd.skills.S1, hd.skills.S2, hd.skills.S3].filter(Boolean);
  const dmgSkills = sk.filter((s) => (s!.rate ?? 0) > 0 && (s!.pow ?? 0) > 0);
  const sum = (k: "selfHpScaling" | "selfDefScaling" | "selfSpdScaling") => sk.reduce((a, s) => a + ((s as any)[k] ?? 0), 0);
  const hpS = sum("selfHpScaling"), defS = sum("selfDefScaling"), spdS = sum("selfSpdScaling");
  const tags = new Set(hd.tags);
  const debuffs = DEBUFF_TAGS.filter((t) => tags.has(t));
  const supports = SUPPORT_TAGS.filter((t) => tags.has(t));
  const reasons: string[] = [];
  const rateSum = dmgSkills.reduce((a, s) => a + (s!.rate ?? 0), 0);
  const offensiveRole = ["warrior", "assassin", "mage", "ranger"].includes(hd.role);

  if (hd.role === "knight" && (tags.has("provoke") || tags.has("barrier") || tags.has("def_buff")) && !hpS && !defS) {
    reasons.push(`Knight with ${["provoke", "barrier", "def_buff"].filter((t) => tags.has(t)).join("/")}: built to absorb damage.`);
    return { archetype: "tank", reasons, critReliant: false };
  }
  if (hpS >= 0.15 && hpS * 10 >= rateSum) { reasons.push(`Skills scale with max HP (${Math.round(hpS * 100)}% combined).`); return { archetype: "hp_bruiser", reasons, critReliant: offensiveRole }; }
  if (defS >= 0.3) { reasons.push(`Skills scale with Defense (${Math.round(defS * 100)}% combined).`); return { archetype: "def_bruiser", reasons, critReliant: offensiveRole }; }
  if (spdS > 0) { reasons.push("Damage increases with the caster's Speed."); return { archetype: "speed_dps", reasons, critReliant: true }; }
  if (hd.role === "manauser" || (supports.length >= 2 && !offensiveRole)) {
    reasons.push(`Utility kit: ${supports.join(", ") || "support role"}.`);
    return { archetype: debuffs.length >= 2 && !supports.length ? "debuffer" : "support", reasons, critReliant: false };
  }
  if (debuffs.length >= 2 && (hd.role === "mage" || hd.role === "ranger" || hd.role === "knight" || rateSum < 1.4)) {
    reasons.push(`Applies ${debuffs.slice(0, 4).join(", ")}: effectiveness and speed decide whether it lands.`);
    return { archetype: "debuffer", reasons, critReliant: false };
  }
  reasons.push(`${classLabel(hd.role)} with Attack-scaling skills (rate ${rateSum.toFixed(2)}).`);
  return { archetype: "crit_dps", reasons, critReliant: true };
}

const ARCH_WEIGHTS: Record<Archetype, Partial<Record<StatKey, number>>> = {
  crit_dps: { dmg: 3, spd: 1.2, ehp: 0.4 },
  hp_bruiser: { hp: 2, ehp: 1, cd: 0.6, spd: 1 },
  def_bruiser: { def: 2, ehp: 1, cd: 0.6, spd: 1 },
  speed_dps: { spd: 2.5, dmg: 2 },
  debuffer: { spd: 3, ehp: 1.5 },
  support: { spd: 3, ehp: 2, res: 0.4 },
  tank: { ehp: 3, res: 1, spd: 1 },
};

export interface RecommendInput {
  hero: Hero; hd: HeroData; items: Item[]; roster: { hero: Hero; spd: number }[];
  community?: CommunityBuild[];
  /** Enemy speed band to evaluate speed races against (default RTA-ish 220–290). */
  enemySpeed?: [number, number];
  allowEquipped?: boolean;
  options?: OptimizeOptions;
}

export interface Recommendation {
  archetype: Archetype;
  /** Top 1% community profile used as the target, when community builds were loaded. */
  elite: { sample: number; cohort: number; setCombos: EliteProfile["setCombos"] } | null;
  /** Stats in priority order (first = most important). */
  priorities: StatKey[];
  /** Your best build's value for each target stat. */
  best: Partial<Record<StatKey, number>>;
  archetypeLabel: string;
  request: OptimizeRequest;
  build: Build | null;
  current: DerivedStats;
  targets: Partial<Record<StatKey, number>>;
  reasons: string[];
  relaxed: string[];
  missing: { stat: StatKey; target: number; current: number; gap: number }[];
}

/** Archetype weights + minimums for a hero (shared by the recommender and team planner). */
export function baseRequest(hero: Hero, hd: HeroData, current: DerivedStats, community?: CommunityBuild[], allowEquipped = false) {
  const info = detectArchetype(hd);
  const reasons = [...info.reasons];
  const weights = { ...ARCH_WEIGHTS[info.archetype] };
  const min: Partial<Record<StatKey, number>> = {};
  const bench = community?.length ? benchmark(current, community) : null;
  const crBuffed = hd.tags.includes("crit_buff");

  if (info.critReliant) {
    min.cr = crBuffed ? 85 : 100;
    reasons.push(crBuffed ? "Crit threshold set to 85%: the kit grants a crit chance buff." : "Holds the 100% crit threshold so damage is consistent.");
  }
  if (info.archetype === "debuffer" || (DEBUFF_TAGS.some((t) => hd.tags.includes(t)) && info.archetype === "support")) {
    const target = bench ? Math.round(Math.max(80, bench.topCohortMedian.eff * 0.95)) : 120;
    min.eff = target;
    reasons.push(bench ? `Effectiveness ${target}%: ~95% of the top-10% community cohort median (${bench.topCohortMedian.eff}%).` : "Effectiveness 120% default (no community data loaded).");
  }
  if (info.archetype === "tank" || info.archetype === "support") {
    const target = bench ? Math.round(Math.max(0, bench.topCohortMedian.res * 0.8)) : 80;
    if (target > 0) { min.res = target; reasons.push(`Effect Resistance ${target}% to resist enemy openers.`); }
  }
  const request: OptimizeRequest = { heroId: hero.id, weights, min, allowEquipped, limit: 30 };
  return { info, reasons, request, min, weights, bench };
}

const STAT_NAME: Partial<Record<StatKey, string>> = { spd: "Speed", atk: "Attack", hp: "Health", def: "Defense", cr: "Crit Chance", cd: "Crit Damage", eff: "Effectiveness", res: "Effect Resistance", ehp: "EHP" };

// Which top-1% stats matter most for each archetype, in order.
const ARCH_PRIORITIES: Record<Archetype, StatKey[]> = {
  crit_dps: ["cr", "cd", "atk", "spd"],
  speed_dps: ["spd", "cr", "cd", "atk"],
  hp_bruiser: ["hp", "spd", "cr", "cd"],
  def_bruiser: ["def", "spd", "cr", "cd"],
  debuffer: ["spd", "eff", "hp", "def"],
  support: ["spd", "hp", "res", "def"],
  tank: ["hp", "def", "res", "spd"],
};

export function recommend(inp: RecommendInput): Recommendation {
  const { hero, hd, items } = inp;
  const current = currentBuildStats(hero, hd, items).stats;
  const { info, reasons, request, min, weights, bench } = baseRequest(hero, hd, current, inp.community, inp.allowEquipped ?? false);
  const relaxed: string[] = [];
  const elite = inp.community?.length ? eliteProfile(inp.community, 0.01) : null;
  const priorities = ARCH_PRIORITIES[info.archetype];
  if (elite) {
    // Aim at the community's top 1% (median of the best-geared 1% of builds), like Hero Optimizer's Benchmark mode.
    const stats: Partial<Record<StatKey, number>> = {};
    for (const k of ["spd", "atk", "hp", "def", "cr", "cd", "eff", "res"] as StatKey[]) {
      const v = elite.targets[k as keyof typeof elite.targets];
      if (v > 0) stats[k] = Math.round(v);
    }
    request.targets = { stats, priorities };
    // Floors follow the top 1% too (baseRequest used the top 10%).
    const dropReason = (prefix: string) => { const i = reasons.findIndex((r) => r.startsWith(prefix)); if (i >= 0) reasons.splice(i, 1); };
    if (min.eff != null && stats.eff) {
      min.eff = Math.round(Math.max(80, stats.eff * 0.95));
      dropReason("Effectiveness"); reasons.push(`Effectiveness floor ${min.eff}%: ~95% of the top 1% median (${stats.eff}%).`);
    }
    if (min.res != null && stats.res != null) {
      min.res = Math.round(stats.res * 0.8) || undefined;
      dropReason("Effect Resistance");
      if (min.res) reasons.push(`Effect Resistance floor ${min.res}%: 80% of the top 1% median (${stats.res}%), to resist openers.`);
    }
    if (!min.res) delete min.res;
    const combos = elite.setCombos.filter((c) => c.share >= 0.15).slice(0, 2).map((c) => c.sets);
    if (combos.length) request.sets = combos;
    reasons.push(`Targets are the median of the top 1% of ${elite.sample} community builds by gear score (${elite.cohort} builds). Priorities: ${priorities.map((k) => STAT_NAME[k]).join(" > ")}.`);
  }
  let res = optimizeHero(hero, hd, items, request, inp.options);
  if (!res.builds.length && request.sets?.length) {
    relaxed.push(`Sets ${request.sets.map((c) => c.map((n) => n.replace(/Set$/, "")).join(" + ")).join(" / ")} → any (not buildable with your gear)`);
    delete request.sets;
    res = optimizeHero(hero, hd, items, request, inp.options);
  }
  // Progressive relaxation if constraints cannot be met with your gear.
  const steps: [StatKey, number][] = [["eff", 0.85], ["res", 0.6], ["cr", 0.9], ["eff", 0.7], ["res", 0]];
  for (const [k, f] of steps) {
    if (res.builds.length || min[k] == null) continue;
    const before = min[k]!;
    min[k] = Math.round(before * f) || undefined;
    if (!min[k]) delete min[k];
    relaxed.push(`${STAT_NAME[k]} ${before} → ${min[k] ?? "none"} (not reachable with your gear)`);
    res = optimizeHero(hero, hd, items, request, inp.options);
  }
  const build = res.builds[0] ?? null;
  const targets: Partial<Record<StatKey, number>> = {};
  const best: Partial<Record<StatKey, number>> = {};
  if (build && request.targets) {
    for (const k of priorities) if (request.targets.stats[k] != null) targets[k] = request.targets.stats[k];
    for (const k of Object.keys(min) as StatKey[]) if (targets[k] == null) targets[k] = min[k];
    for (const k of Object.keys(targets) as StatKey[]) best[k] = build.stats[k] as number;
    const reached = priorities.filter((k) => targets[k] != null && (build.stats[k] as number) >= (targets[k] as number));
    reasons.push(`Your best build reaches ${reached.length} of ${priorities.filter((k) => targets[k] != null).length} top-1% priority targets${reached.length ? ` (${reached.map((k) => STAT_NAME[k]).join(", ")})` : ""}.`);
  }
  if (build) {
    const s = build.stats;
    if (!request.targets) {
      targets.spd = s.spd;
    for (const k of Object.keys(min) as StatKey[]) targets[k] = min[k];
    if (weights.dmg) targets.atk = s.atk;
    if (weights.hp) targets.hp = s.hp;
    if (weights.def) targets.def = s.def;
    if (weights.ehp) targets.ehp = s.ehp;
    if (weights.cd) targets.cd = s.cd;
    for (const k of Object.keys(targets) as StatKey[]) best[k] = s[k] as number;
    }

    const speeds = res.builds.map((b) => b.stats.spd);
    const rosterFaster = inp.roster.filter((r) => r.hero.id !== hero.id && r.spd < s.spd).length;
    if (!request.targets) reasons.push(`Suggested speed ${s.spd}: best of your gear for this archetype (top results range ${Math.min(...speeds)}–${Math.max(...speeds)}).`);
    if (inp.roster.length > 1) reasons.push(`Outspeeds ${rosterFaster} of ${inp.roster.length - 1} other heroes on your account at their current builds.`);
    const [lo, hi] = inp.enemySpeed ?? [220, 290];
    reasons.push(`Wins the opening speed race vs. enemies at ${lo}–${hi} speed in ${Math.round(winSpeedRace(s.spd, lo, hi) * 100)}% of fights (5% speed RNG).`);
    if (bench) {
      const b2 = benchmark(s, inp.community!);
      reasons.push(`Your best build against ${bench.sample} community builds: Speed top ${b2.topPct.spd}%, HP top ${b2.topPct.hp}%, GS top ${b2.topPct.gs}%.`);
      if (elite?.setCombos[0]) reasons.push(`Most common sets in the top 1%: ${elite.setCombos.slice(0, 2).map((x) => `${x.sets.map((n) => n.replace(/Set$/, "")).join(" + ")} (${Math.round(x.share * 100)}%)`).join(", ")}.`);
      else if (bench.commonSets[0]) reasons.push(`Most common community sets: ${bench.commonSets.slice(0, 2).map((x) => `${x.sets} (${Math.round(x.share * 100)}%)`).join(", ")}.`);
    }
  } else {
    reasons.push("No complete build found with the current gear pool. Try allowing equipped gear or loosening sets.");
  }

  const missing = (Object.entries(targets) as [StatKey, number][])
    .map(([stat, target]) => ({ stat, target, current: current[stat] as number, gap: target - (current[stat] as number) }))
    .filter((m) => m.gap > 0)
    .sort((a, b) => b.gap / Math.max(1, b.target) - a.gap / Math.max(1, a.target));

  return {
    archetype: info.archetype, archetypeLabel: ARCHETYPE_LABEL[info.archetype], request, build, current, targets, reasons, relaxed, missing,
    elite: elite ? { sample: elite.sample, cohort: elite.cohort, setCombos: elite.setCombos } : null, priorities, best,
  };
}
