// Rule-based on purpose so every target can be explained in the UI:
// archetype from skill scaling + tags, targets from community cohorts when we
// have them, and the optimizer decides what's actually reachable.
import { benchmark, type CommunityBuild } from "./benchmark";
import { optimizeHero, currentBuildStats, type StatKey, type OptimizeOptions } from "./optimizer";
import { winSpeedRace } from "./speedtune";
import type { Build, DerivedStats, Hero, HeroData, Item, OptimizeRequest } from "./types";

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
  reasons.push(`${hd.role} with Attack-scaling skills (rate ${rateSum.toFixed(2)}).`);
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
    if (target > 0) { min.res = target; reasons.push(`Effect resistance ${target}% to resist enemy openers.`); }
  }
  const request: OptimizeRequest = { heroId: hero.id, weights, min, allowEquipped, limit: 30 };
  return { info, reasons, request, min, weights, bench };
}

export function recommend(inp: RecommendInput): Recommendation {
  const { hero, hd, items } = inp;
  const current = currentBuildStats(hero, hd, items).stats;
  const { info, reasons, request, min, weights, bench } = baseRequest(hero, hd, current, inp.community, inp.allowEquipped ?? false);
  const relaxed: string[] = [];
  let res = optimizeHero(hero, hd, items, request, inp.options);
  // Progressive relaxation if constraints cannot be met with your gear.
  const steps: [StatKey, number][] = [["eff", 0.85], ["res", 0.6], ["cr", 0.9], ["eff", 0.7], ["res", 0]];
  for (const [k, f] of steps) {
    if (res.builds.length || min[k] == null) continue;
    const before = min[k]!;
    min[k] = Math.round(before * f) || undefined;
    if (!min[k]) delete min[k];
    relaxed.push(`${k.toUpperCase()} ${before} → ${min[k] ?? "none"} (not reachable with your gear)`);
    res = optimizeHero(hero, hd, items, request, inp.options);
  }
  const build = res.builds[0] ?? null;
  const targets: Partial<Record<StatKey, number>> = {};
  if (build) {
    const s = build.stats;
    targets.spd = s.spd;
    for (const k of Object.keys(min) as StatKey[]) targets[k] = min[k];
    if (weights.dmg) targets.atk = s.atk;
    if (weights.hp) targets.hp = s.hp;
    if (weights.def) targets.def = s.def;
    if (weights.ehp) targets.ehp = s.ehp;
    if (weights.cd) targets.cd = s.cd;

    const speeds = res.builds.map((b) => b.stats.spd);
    const rosterFaster = inp.roster.filter((r) => r.hero.id !== hero.id && r.spd < s.spd).length;
    reasons.push(`Suggested speed ${s.spd}: best of your gear for this archetype (top results range ${Math.min(...speeds)}–${Math.max(...speeds)}).`);
    if (inp.roster.length > 1) reasons.push(`Outspeeds ${rosterFaster} of ${inp.roster.length - 1} other heroes on your account at their current builds.`);
    const [lo, hi] = inp.enemySpeed ?? [220, 290];
    reasons.push(`Wins the opening speed race vs. enemies at ${lo}–${hi} speed in ${Math.round(winSpeedRace(s.spd, lo, hi) * 100)}% of fights (5% speed RNG).`);
    if (bench) {
      const b2 = benchmark(s, inp.community!);
      reasons.push(`Against ${bench.sample} community builds: speed top ${b2.topPct.spd}%, HP top ${b2.topPct.hp}%, GS top ${b2.topPct.gs}%.`);
      if (bench.commonSets[0]) reasons.push(`Most common community sets: ${bench.commonSets.slice(0, 2).map((x) => `${x.sets} (${Math.round(x.share * 100)}%)`).join(", ")}.`);
    }
  } else {
    reasons.push("No complete build found with the current gear pool. Try allowing equipped gear or loosening sets.");
  }

  const missing = (Object.entries(targets) as [StatKey, number][])
    .map(([stat, target]) => ({ stat, target, current: current[stat] as number, gap: target - (current[stat] as number) }))
    .filter((m) => m.gap > 0)
    .sort((a, b) => b.gap / Math.max(1, b.target) - a.gap / Math.max(1, a.target));

  return { archetype: info.archetype, archetypeLabel: ARCHETYPE_LABEL[info.archetype], request, build, current, targets, reasons, relaxed, missing };
}
