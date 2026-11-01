// Community data: Fribbels hero library (`getBuilds`), ~3000 recent builds per
// hero. The data has no player-rank field, so "Emperor/Legend/tournament"
// tiers are approximated by gear-score cohorts (top 10% / top 1%).
import type { DerivedStats } from "./types";

export interface CommunityBuild {
  atk: number; hp: number; def: number; spd: number; chc: number; chd: number; eff: number; efr: number; gs: number;
  sets?: Record<string, string>; artifactCode?: string; createDate?: string;
}

export const BENCH_STATS = ["spd", "hp", "atk", "def", "cr", "cd", "eff", "res", "gs"] as const;
export type BenchStat = (typeof BENCH_STATS)[number];

const field: Record<BenchStat, keyof CommunityBuild> = {
  spd: "spd", hp: "hp", atk: "atk", def: "def", cr: "chc", cd: "chd", eff: "eff", res: "efr", gs: "gs",
};

export interface BenchmarkResult {
  sample: number;
  /** "Top X%" per stat: share of community builds with a strictly higher value. */
  topPct: Record<BenchStat, number>;
  median: Record<BenchStat, number>;
  topCohortMedian: Record<BenchStat, number>; // top 10% by GS
  eliteCohortMedian: Record<BenchStat, number>; // top 1% by GS
  commonSets: { sets: string; share: number }[];
  commonArtifacts: { code: string; share: number }[];
}

const SET_CODE: Record<string, string> = {
  set_speed: "Speed", set_cri: "Critical", set_cri_dmg: "Destruction", set_att: "Attack", set_max_hp: "Health",
  set_def: "Defense", set_acc: "Hit", set_res: "Resist", set_immune: "Immunity", set_vampire: "Lifesteal",
  set_counter: "Counter", set_rage: "Rage", set_penetrate: "Penetration", set_revenge: "Revenge", set_coop: "Unity",
  set_scar: "Injury", set_shield: "Protection", set_torrent: "Torrent", set_reversal: "Reversal", set_riposte: "Riposte",
  set_opener: "Warfare", set_chase: "Pursuit", set_weakening: "Weakening", set_fervor: "Fervor",
};

export function setsLabel(sets?: Record<string, string>) {
  if (!sets) return "—";
  return Object.entries(sets).filter(([, n]) => +n >= 2).map(([k, n]) => `${SET_CODE[k] ?? k}${+n >= 4 ? "" : " x" + Math.floor(+n / 2)}`).sort().join(" + ") || "Broken";
}

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function benchmark(stats: Pick<DerivedStats, BenchStat>, builds: CommunityBuild[]): BenchmarkResult {
  const valid = builds.filter((b) => b && b.gs > 0);
  const n = valid.length || 1;
  const byGs = [...valid].sort((a, b) => b.gs - a.gs);
  const top = byGs.slice(0, Math.max(1, Math.floor(n * 0.1)));
  const elite = byGs.slice(0, Math.max(1, Math.floor(n * 0.01)));
  const out = { sample: valid.length, topPct: {}, median: {}, topCohortMedian: {}, eliteCohortMedian: {} } as BenchmarkResult;
  for (const k of BENCH_STATS) {
    const f = field[k];
    const vals = valid.map((b) => Number(b[f]) || 0);
    const mine = stats[k];
    out.topPct[k] = valid.length ? Math.max(0.1, Math.round((vals.filter((v) => v > mine).length / n) * 1000) / 10) : 100;
    out.median[k] = median(vals);
    out.topCohortMedian[k] = median(top.map((b) => Number(b[f]) || 0));
    out.eliteCohortMedian[k] = median(elite.map((b) => Number(b[f]) || 0));
  }
  const setCounts = new Map<string, number>();
  const artCounts = new Map<string, number>();
  for (const b of valid) {
    const s = setsLabel(b.sets);
    setCounts.set(s, (setCounts.get(s) ?? 0) + 1);
    if (b.artifactCode) artCounts.set(b.artifactCode, (artCounts.get(b.artifactCode) ?? 0) + 1);
  }
  out.commonSets = [...setCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([sets, c]) => ({ sets, share: c / n }));
  out.commonArtifacts = [...artCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([code, c]) => ({ code, share: c / n }));
  return out;
}

/** Percentile of a value within your own account's possible builds / gear (local benchmark). */
export function topPercentLocal(value: number, population: number[]): number {
  if (!population.length) return 100;
  return Math.max(0.1, Math.round((population.filter((v) => v > value).length / population.length) * 1000) / 10);
}

/** Community set code -> E7 Forge set name. */
export const SET_FROM_CODE: Record<string, string> = {
  set_speed: "SpeedSet", set_cri: "CriticalSet", set_cri_dmg: "DestructionSet", set_att: "AttackSet", set_max_hp: "HealthSet",
  set_def: "DefenseSet", set_acc: "HitSet", set_res: "ResistSet", set_immune: "ImmunitySet", set_vampire: "LifestealSet",
  set_counter: "CounterSet", set_rage: "RageSet", set_penetrate: "PenetrationSet", set_revenge: "RevengeSet", set_coop: "UnitySet",
  set_scar: "InjurySet", set_shield: "ProtectionSet", set_torrent: "TorrentSet", set_revenant: "ReversalSet", set_reversal: "ReversalSet",
  set_riposte: "RiposteSet", set_opener: "WarfareSet", set_chase: "PursuitSet", set_weak: "WeakeningSet", set_weakening: "WeakeningSet",
  set_might: "FervorSet", set_fervor: "FervorSet",
};
const FOUR = new Set(["SpeedSet", "AttackSet", "DestructionSet", "LifestealSet", "CounterSet", "RageSet", "RevengeSet", "InjurySet", "ProtectionSet", "ReversalSet", "RiposteSet", "WarfareSet", "WeakeningSet"]);

/** Completed sets of a community build, e.g. ["CriticalSet","SpeedSet"]. */
export function communitySets(sets?: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [code, n] of Object.entries(sets ?? {})) {
    const name = SET_FROM_CODE[code];
    if (!name) continue;
    const per = FOUR.has(name) ? 4 : 2;
    for (let i = 0; i < Math.floor(+n / per); i++) out.push(name);
  }
  return out.sort();
}

export interface EliteProfile {
  sample: number;
  cohort: number;
  /** Median stats of the top `pct` builds by gear score. */
  targets: Record<BenchStat, number>;
  /** Most common completed-set combos in the cohort. */
  setCombos: { sets: string[]; share: number }[];
}

export function eliteProfile(builds: CommunityBuild[], pct = 0.01, minCohort = 10): EliteProfile {
  const valid = builds.filter((b) => b && b.gs > 0).sort((a, b) => b.gs - a.gs);
  const cohort = valid.slice(0, Math.max(Math.min(minCohort, valid.length), Math.floor(valid.length * pct)));
  const targets = {} as Record<BenchStat, number>;
  for (const k of BENCH_STATS) targets[k] = median(cohort.map((b) => Number(b[field[k]]) || 0));
  const counts = new Map<string, number>();
  for (const b of cohort) { const s = communitySets(b.sets); if (s.length) counts.set(s.join("|"), (counts.get(s.join("|")) ?? 0) + 1); }
  const setCombos = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, c]) => ({ sets: k.split("|"), share: c / Math.max(1, cohort.length) }));
  return { sample: valid.length, cohort: cohort.length, targets, setCombos };
}
