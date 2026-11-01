// Monte Carlo: roll the remaining enhances many times instead of trying to
// get a closed form (sub reveals and reforge make the math messy).
import { GS_WEIGHTS, SLOT_MAINS, START_SUBS } from "./constants";
import { gearScore, reforgedSubs, rollRanges } from "./gear";
import { STAT_TYPES, type Item, type StatType, type Substat } from "./types";

export interface RoiTiers { S: number; A: number; B: number } // GS thresholds at +15 (reforged if 85)
export const DEFAULT_TIERS: RoiTiers = { S: 70, A: 60, B: 50 };

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
  return { itemId: item.id, trials, pS, pA, pB, pSell, expectedGs, p10: q(0.1), p50: q(0.5), p90: q(0.9), speed, risk, recommendation, stepsLeft };
}

/** Ranks unfinished items by expected value so you know where to spend charms/gold first. */
export function upgradeQueue(items: Item[], o: RoiOptions = {}, maxItems = 200) {
  return items
    .filter((i) => i.enhance < 15 && (i.rank === "Epic" || i.rank === "Heroic"))
    .slice(0, maxItems)
    .map((i) => ({ item: i, f: forecastItem(i, { ...o, trials: o.trials ?? 800 }) }))
    .sort((a, b) => (b.f.pS * 3 + b.f.pA * 2 + b.f.pB) - (a.f.pS * 3 + a.f.pA * 2 + a.f.pB));
}
