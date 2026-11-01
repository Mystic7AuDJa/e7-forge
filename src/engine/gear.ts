import { GS_WEIGHTS, PLAIN_STATS, RANK_POWER, REFORGE_BONUS, ROLL_RANGES_85, ROLL_RANGES_88, SLOT_MAINS, START_SUBS } from "./constants";
import type { Item, Rank, StatType, Substat } from "./types";

export function rollRanges(item: Pick<Item, "level">) {
  return item.level >= 88 ? ROLL_RANGES_88 : ROLL_RANGES_85;
}

/** Fribbels-style gear score over substats only. */
export function gearScore(subs: Substat[]): number {
  let s = 0;
  for (const sub of subs) s += sub.value * (GS_WEIGHTS[sub.type] ?? 0);
  return Math.round(s * 10) / 10;
}

/** Number of "rolls" (initial value + each enhancement hit) gear has received so far. */
export function totalRolls(rank: Rank, enhance: number): number {
  return START_SUBS[rank] + Math.floor(Math.min(enhance, 15) / 3);
}

/** Estimate how many rolls went into each substat. Mutates and returns subs. */
export function estimateRolls(item: Item): Substat[] {
  const ranges = rollRanges(item);
  const power = RANK_POWER[item.rank] ?? 1;
  const subs = item.substats;
  if (!subs.length) return subs;
  const total = Math.max(subs.length, totalRolls(item.rank, item.enhance));
  const maxOf = (t: StatType) => ranges[t][1] * (t === "Attack" || t === "Health" || t === "Defense" ? power : 1) + (item.level >= 90 ? 1 : 0);
  for (const s of subs) s.rolls = Math.max(1, Math.ceil(s.value / Math.max(1, maxOf(s.type)) - 1e-9));
  let sum = subs.reduce((a, s) => a + (s.rolls ?? 1), 0);
  // Distribute any unaccounted rolls to subs whose value-per-roll is highest relative to their average.
  while (sum < total) {
    let best = subs[0];
    let bestRatio = -Infinity;
    for (const s of subs) {
      const [lo, hi] = ranges[s.type];
      const ratio = s.value / ((s.rolls ?? 1) + 1) / ((lo + hi) / 2);
      if (ratio > bestRatio) { bestRatio = ratio; best = s; }
    }
    best.rolls = (best.rolls ?? 1) + 1;
    sum++;
  }
  // If we over-counted (high rolls), trim from the most "thin" substats.
  while (sum > total) {
    const cand = subs.filter((s) => (s.rolls ?? 1) > 1);
    if (!cand.length) break;
    cand.sort((a, b) => a.value / (a.rolls ?? 1) - b.value / (b.rolls ?? 1));
    cand[0].rolls = (cand[0].rolls ?? 1) - 1;
    sum--;
  }
  return subs;
}

/** Substats after reforging a level-85 +15 item to level 90. */
export function reforgedSubs(item: Item): Substat[] {
  if (item.level !== 85 || item.enhance < 15) return item.substats.map((s) => ({ ...s }));
  estimateRolls(item);
  return item.substats.map((s) => {
    const r = Math.min(6, s.rolls ?? 1);
    let add = 0;
    if (PLAIN_STATS.includes(s.type)) add = REFORGE_BONUS.plain[r];
    else if (s.type === "CriticalHitChancePercent") add = REFORGE_BONUS.cr[r];
    else if (s.type === "CriticalHitDamagePercent") add = REFORGE_BONUS.cd[r];
    else if (s.type === "Speed") add = REFORGE_BONUS.spd[r];
    else if (s.type === "Attack") add = REFORGE_BONUS.atk * r;
    else if (s.type === "Defense") add = REFORGE_BONUS.def * r;
    else if (s.type === "Health") add = REFORGE_BONUS.hp * r;
    return { ...s, value: s.value + add };
  });
}

/**
 * Expected substats at +15 for unfinished gear: remaining enhancement hits are
 * spread evenly over existing substats at the average roll. Unknown new substats are ignored
 * (conservative).
 */
export function projectedSubs(item: Item): Substat[] {
  if (item.enhance >= 15 || !item.substats.length) return item.substats.map((s) => ({ ...s }));
  const ranges = rollRanges(item);
  const hits = 5 - Math.floor(item.enhance / 3);
  const missing = Math.max(0, 4 - item.substats.length);
  const rollHits = Math.max(0, hits - missing);
  const per = rollHits / item.substats.length;
  return item.substats.map((s) => {
    const [lo, hi] = ranges[s.type];
    return { ...s, value: Math.round(s.value + per * (lo + hi) / 2) };
  });
}

export function isValidMain(slot: string, main: StatType) {
  return (SLOT_MAINS[slot] ?? []).includes(main);
}

export function subValue(item: Pick<Item, "substats">, type: StatType) {
  return item.substats.find((s) => s.type === type)?.value ?? 0;
}
