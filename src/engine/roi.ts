// Monte Carlo: roll the remaining enhances many times instead of trying to
// get a closed form (sub reveals and reforge make the math messy).
import { GS_WEIGHTS, SLOT_MAINS, START_SUBS } from "./constants";
import { estimateRolls, gearScore, reforgedSubs, rollRanges } from "./gear";
import { STAT_TYPES, type Item, type StatType, type Substat } from "./types";

export interface RoiTiers { S: number; A: number; B: number } // GS thresholds at +15 (reforged if 85)
export const DEFAULT_TIERS: RoiTiers = { S: 70, A: 60, B: 50 };
export type Tier = "S" | "A" | "B" | "Sell";

export function tierOf(score: number, t: RoiTiers = DEFAULT_TIERS): Tier {
  return score >= t.S ? "S" : score >= t.A ? "A" : score >= t.B ? "B" : "Sell";
}

/** Hover text for the tier thresholds. */
export function tierHelp(t: RoiTiers = DEFAULT_TIERS) {
  return [
    "Tiers grade the item's score at +15 (after reforging, for level 85 gear).",
    `S ≥ ${t.S}: endgame piece. A ≥ ${t.A}: solid, keep. B ≥ ${t.B}: usable filler. Below ${t.B}: sell or extract.`,
    "Score = gear score: each % stat point counts 1, Speed 2, Crit Chance 1.6, Crit Damage 1.14, flat Atk/HP/Def scaled down.",
    "Focus modes count only the stats that role uses (other substats score 0), on the same scale, so the same tiers apply.",
  ].join("\n");
}

/** Apply a manual edit (enhance level and substats) and recompute rolls and gear score. */
export function editItem(item: Item, edit: { enhance?: number; substats?: Substat[] }): Item {
  const next: Item = {
    ...item,
    enhance: Math.max(0, Math.min(15, edit.enhance ?? item.enhance)),
    substats: (edit.substats ?? item.substats).filter((x) => x.type && x.value > 0).map((x) => ({ ...x, rolls: undefined, modified: x.modified })),
  };
  estimateRolls(next);
  next.gs = gearScore(next.substats);
  return next;
}

export interface RoiOptions {
  trials?: number;
  tiers?: RoiTiers;
  /** Optional per-stat weights (e.g. speed-focused). Default: Fribbels GS weights. */
  focus?: Partial<Record<StatType, number>>;
  random?: () => number;
}

export interface RoiResult {
  itemId: string;
  trials: number;
  pS: number; pA: number; pB: number; pSell: number;
  expectedGs: number; p10: number; p50: number; p90: number;
  /** Probability distribution of final speed substat. */
  speed: { p12: number; p15: number; p18: number; expected: number };
  risk: "low" | "medium" | "high";
  /** Most likely tier at +15. */
  likely: Tier;
  /** Score now (reforged if finished 85 gear). */
  now: number;
  recommendation: string;
  stepsLeft: number;
}

/** Stats a new substat can be (anything not already present and not the main stat). */
function newSubOptions(item: Item, subs: Substat[]): StatType[] {
  const taken = new Set(subs.map((s) => s.type));
  return STAT_TYPES.filter((t) => !taken.has(t) && t !== item.main.type && !(SLOT_MAINS[item.gear]?.length === 1 && t === item.main.type));
}

function rollValue(item: Item, t: StatType, rand: () => number) {
  const [lo, hi] = rollRanges(item)[t];
  return lo + Math.floor(rand() * (hi - lo + 1));
}

export function simulateEnhance(item: Item, rand: () => number = Math.random): Substat[] {
  const subs = item.substats.map((s) => ({ ...s, rolls: s.rolls ?? 1 }));
  const startSubs = START_SUBS[item.rank] ?? 4;
  for (let lvl = Math.floor(item.enhance / 3) * 3 + 3; lvl <= 15; lvl += 3) {
    // Missing substats are revealed on the last enhancement steps up to +12:
    // Heroic (3 subs) at +12, Rare (2) at +9/+12, Good (1) at +6/+9/+12.
    const reveal = lvl <= 12 && lvl > 12 - 3 * (4 - startSubs);
    if (subs.length < 4 && reveal) {
      const opts = newSubOptions(item, subs);
      const t = opts[Math.floor(rand() * opts.length)];
      subs.push({ type: t, value: rollValue(item, t, rand), rolls: 1 });
    } else if (subs.length) {
      const s = subs[Math.floor(rand() * subs.length)];
      s.value += rollValue(item, s.type, rand);
      s.rolls = (s.rolls ?? 1) + 1;
    }
  }
  return subs;
}

function score(subs: Substat[], focus?: Partial<Record<StatType, number>>) {
  if (!focus) return gearScore(subs);
  let s = 0;
  for (const x of subs) s += x.value * (GS_WEIGHTS[x.type] ?? 0) * (focus[x.type] ?? 0);
  return s;
}

export function forecastItem(item: Item, o: RoiOptions = {}): RoiResult {
  const trials = o.trials ?? 3000;
  const tiers = o.tiers ?? DEFAULT_TIERS;
  const rand = o.random ?? Math.random;
  const scores: number[] = [];
  const speeds: number[] = [];
  for (let i = 0; i < trials; i++) {
    let subs = simulateEnhance(item, rand);
    if (item.level === 85) subs = reforgedSubs({ ...item, enhance: 15, substats: subs });
    scores.push(score(subs, o.focus));
    speeds.push(subs.find((s) => s.type === "Speed")?.value ?? 0);
  }
  scores.sort((a, b) => a - b);
  const q = (p: number) => Math.round(scores[Math.min(scores.length - 1, Math.floor(p * scores.length))] * 10) / 10;
  const frac = (f: (x: number) => boolean, arr: number[]) => arr.filter(f).length / arr.length;
  const pS = frac((x) => x >= tiers.S, scores);
  const pA = frac((x) => x >= tiers.A && x < tiers.S, scores);
  const pB = frac((x) => x >= tiers.B && x < tiers.A, scores);
  const pSell = 1 - pS - pA - pB;
  const expectedGs = Math.round((scores.reduce((a, b) => a + b, 0) / trials) * 10) / 10;
  const spread = q(0.9) - q(0.1);
  const risk = pSell > 0.6 ? "high" : pSell > 0.3 || spread > 25 ? "medium" : "low";
  const stepsLeft = Math.max(0, 5 - Math.floor(item.enhance / 3));
  const speed = {
    p12: frac((x) => x >= 12, speeds), p15: frac((x) => x >= 15, speeds), p18: frac((x) => x >= 18, speeds),
    expected: Math.round((speeds.reduce((a, b) => a + b, 0) / trials) * 10) / 10,
  };
  let recommendation: string;
  if (stepsLeft === 0) recommendation = item.level === 85 && item.enhance >= 15 ? "Finished. Reforge to lock in the shown value." : "Finished.";
  else if (pS + pA >= 0.5) recommendation = "Upgrade: more likely than not to become A-tier or better.";
  else if (speed.p15 >= 0.35) recommendation = "Upgrade for speed: solid chance at a 15+ speed substat.";
  else if (pSell >= 0.65) recommendation = "Sell/extract: most outcomes land below B-tier.";
  else recommendation = "Optional: upgrade in steps (+3/+6) and re-check after each reveal.";
  const likely = ([["S", pS], ["A", pA], ["B", pB], ["Sell", pSell]] as [Tier, number][]).sort((a, b) => b[1] - a[1])[0][0];
  const nowSubs = item.level === 85 && item.enhance >= 15 ? reforgedSubs(item) : item.substats;
  const now = Math.round(score(nowSubs, o.focus) * 10) / 10;
  return { itemId: item.id, trials, pS, pA, pB, pSell, expectedGs, p10: q(0.1), p50: q(0.5), p90: q(0.9), speed, risk, recommendation, stepsLeft, likely, now };
}

/** Small seeded generator (mulberry32) so a column of forecasts doesn't change on every render. */
export function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/** Trials for the table column and the forecast panel; the same seed and count make the two agree. */
export const FORECAST_TRIALS = 1000;
/** Seeded generator for an item, so its forecast is the same every time it is shown. */
export const itemRandom = (item: Item) => seeded(hash(outcomeKey(item, "")));

/** Cache key for an item's simulated outcomes: changes when the item or the focus does, not the tiers. */
export const outcomeKey = (item: Item, focusName: string) => `${item.id}:${item.level}:${item.enhance}:${item.substats.map((x) => x.type + x.value).join(",")}:${focusName}`;

/**
 * Sorted +15 scores for an item (reforged for level 85). Finished items have
 * one outcome. Tiers aren't involved, so changing them only re-buckets.
 */
export function simulateScores(item: Item, focus: Partial<Record<StatType, number>> | undefined, trials = FORECAST_TRIALS): Float64Array {
  if (item.enhance >= 15) return Float64Array.of(score(item.level === 85 ? reforgedSubs(item) : item.substats, focus));
  const rand = itemRandom(item);
  const out = new Float64Array(trials);
  for (let i = 0; i < trials; i++) {
    let subs = simulateEnhance(item, rand);
    if (item.level === 85) subs = reforgedSubs({ ...item, enhance: 15, substats: subs });
    out[i] = score(subs, focus);
  }
  return out.sort();
}

export interface TierSplit { pS: number; pA: number; pB: number; pSell: number; likely: Tier; median: number; finished: boolean }

/** Buckets sorted scores into tiers, using the same "most likely tier" rule as the forecast panel. */
export function tierSplit(scores: Float64Array, t: RoiTiers = DEFAULT_TIERS): TierSplit {
  const below = (x: number) => { let lo = 0, hi = scores.length; while (lo < hi) { const m = (lo + hi) >> 1; if (scores[m] < x) lo = m + 1; else hi = m; } return lo / scores.length; };
  const bS = below(t.S), bA = below(t.A), bB = below(t.B);
  const pS = 1 - bS, pA = Math.max(0, bS - bA), pB = Math.max(0, bA - bB), pSell = bB;
  const likely = ([["S", pS], ["A", pA], ["B", pB], ["Sell", pSell]] as [Tier, number][]).sort((a, b) => b[1] - a[1])[0][0];
  return { pS, pA, pB, pSell, likely, median: scores[Math.floor(scores.length / 2)], finished: scores.length === 1 };
}

/** Ranks unfinished items by expected value so you know where to spend charms/gold first. */
export function upgradeQueue(items: Item[], o: RoiOptions = {}, maxItems = 200) {
  return items
    .filter((i) => i.enhance < 15 && (i.rank === "Epic" || i.rank === "Heroic"))
    .slice(0, maxItems)
    .map((i) => ({ item: i, f: forecastItem(i, { ...o, trials: o.trials ?? 800 }) }))
    .sort((a, b) => (b.f.pS * 3 + b.f.pA * 2 + b.f.pB) - (a.f.pS * 3 + a.f.pA * 2 + a.f.pB));
}
