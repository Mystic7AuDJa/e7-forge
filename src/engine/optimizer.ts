// Single-hero optimizer: per-slot pruning + branch-and-bound over 6 slots.
// Bounds are valid because every final stat is monotone non-decreasing in the
// accumulated gear stats, so "partial + best remaining" is an upper bound.
import { SETS } from "./constants";
import { A, ACC_LEN, accumulate, finalize, gearView, makeEvaluator, SET_INDEX, SET_NAMES, type GearMode, type CalcSettings, DEFAULT_CALC } from "./stats";
import { GEAR_SLOTS, type Build, type DerivedStats, type GearSlot, type Hero, type HeroData, type Item, type OptimizeRequest } from "./types";

export type StatKey = keyof DerivedStats;
export const STAT_KEYS: StatKey[] = ["atk", "hp", "def", "spd", "cr", "cd", "eff", "res", "dac", "cp", "ehp", "dmg", "mcdmg", "dmgps", "ehpps", "s1", "s2", "s3", "gs"];

export interface OptimizeOptions {
  mode?: GearMode;
  calc?: CalcSettings;
  /** Hard cap on visited nodes (default 30M). */
  maxNodes?: number;
  /** Time limit in ms (default 20s). */
  timeLimitMs?: number;
  /** Items owned by other heroes in an account-wide solve. */
  reserved?: Set<string>;
  /** Only explore this slice of the first-level candidates (for parallel workers). */
  shard?: { index: number; count: number };
  onProgress?: (p: { nodes: number; results: number }) => void;
}

export interface OptimizeResult {
  builds: Build[];
  nodes: number;
  candidates: Record<GearSlot, number>;
  truncated: boolean;
  ms: number;
}

/** Scale (≈ one average substat roll) used to normalise objective terms. */
export function statRefs(hd: HeroData, current?: DerivedStats): Record<StatKey, number> {
  const b = hd.base;
  const d = (k: StatKey, fallback: number) => Math.max(1, (current?.[k] as number) || fallback) * 0.03;
  return {
    atk: b.atk * 0.06, hp: b.hp * 0.06, def: b.def * 0.06, spd: 3, cr: 4, cd: 5.5, eff: 6, res: 6, dac: 4, gs: 6,
    cp: d("cp", 40000), ehp: d("ehp", 60000), dmg: d("dmg", 3000), mcdmg: d("mcdmg", 4000), dmgps: d("dmgps", 600),
    ehpps: d("ehpps", 10000), s1: d("s1", 8000), s2: d("s2", 8000), s3: d("s3", 12000),
  };
}

export function objective(stats: DerivedStats, weights: Partial<Record<StatKey, number>>, refs: Record<StatKey, number>): number {
  let s = 0;
  for (const k in weights) {
    const w = weights[k as StatKey]!;
    if (!w) continue;
    let v = stats[k as StatKey] as number;
    if (k === "cr") v = Math.min(v, 100);
    if (k === "cd") v = Math.min(v, 350);
    s += (w * v) / refs[k as StatKey];
  }
  return s;
}

export const PRIORITY_WEIGHTS = [4, 3, 2, 1];
export const NON_PRIORITY_WEIGHT = 0.25;

/** Weight of each target stat: priorities 4/3/2/1 in order, everything else in the profile 0.25. */
export function targetWeights(t: NonNullable<OptimizeRequest["targets"]>): Partial<Record<StatKey, number>> {
  const w: Partial<Record<StatKey, number>> = {};
  for (const [k, v] of Object.entries(t.stats) as [StatKey, number][]) if (v && v > 0) w[k] = NON_PRIORITY_WEIGHT;
  t.priorities.slice(0, 4).forEach((k, i) => { if ((t.stats[k] ?? 0) > 0) w[k] = PRIORITY_WEIGHTS[i]; });
  return w;
}

/**
 * Closeness to targets, 0..100 (100 = every target reached). Overshooting adds a
 * tiny bonus so ties still prefer more; the function is monotone, which keeps
 * branch-and-bound pruning valid.
 */
export function targetMatch(stats: DerivedStats, t: NonNullable<OptimizeRequest["targets"]>) {
  const w = targetWeights(t);
  let sum = 0, wsum = 0;
  const perStat: Partial<Record<StatKey, number>> = {};
  for (const [k, wk] of Object.entries(w) as [StatKey, number][]) {
    let v = stats[k] as number, target = t.stats[k]!;
    if (k === "cr") { v = Math.min(v, 100); target = Math.min(target, 100); }
    const r = target > 0 ? v / target : 1;
    perStat[k] = r;
    sum += wk * (Math.min(r, 1) + 0.05 * Math.max(r - 1, 0));
    wsum += wk;
  }
  return { score: wsum ? (100 * sum) / wsum : 0, perStat };
}

function meetsBounds(stats: DerivedStats, req: OptimizeRequest): boolean {
  for (const k in req.min ?? {}) { const m = req.min![k as StatKey]; if (m != null && (stats[k as StatKey] as number) < m) return false; }
  for (const k in req.max ?? {}) { const m = req.max![k as StatKey]; if (m != null && (stats[k as StatKey] as number) > m) return false; }
  return true;
}

/** Remaining pieces needed to satisfy the cheapest allowed set combo (0 if satisfiable already or no requirement). */
function setDeficit(counts: Int32Array, combos: number[][] | null): number {
  if (!combos) return 0;
  let best = Infinity;
  for (const combo of combos) {
    // combo: list of set indices (repeats allowed)
    const need = new Map<number, number>();
    for (const si of combo) need.set(si, (need.get(si) ?? 0) + SETS[SET_NAMES[si]].pieces);
    let d = 0;
    for (const [si, n] of need) d += Math.max(0, n - counts[si]);
    if (d < best) best = d;
  }
  return best;
}

export function candidateItems(hero: Hero, items: Item[], req: OptimizeRequest, reserved?: Set<string>): Record<GearSlot, Item[]> {
  const ex = new Set(req.exclude ?? []);
  const out = Object.fromEntries(GEAR_SLOTS.map((s) => [s, [] as Item[]])) as Record<GearSlot, Item[]>;
  for (const it of items) {
    if (ex.has(it.id) || reserved?.has(it.id)) continue;
    if ((req.minEnhance ?? 0) > it.enhance) continue;
    if (!req.allowEquipped && it.equippedById && it.equippedById !== hero.id) continue;
    const mains = req.mains?.[it.gear];
    if (mains && mains.length && !mains.includes(it.main.type)) continue;
    out[it.gear].push(it);
  }
  return out;
}

export function optimizeHero(hero: Hero, hd: HeroData, items: Item[], req: OptimizeRequest, opts: OptimizeOptions = {}): OptimizeResult {
  const t0 = Date.now();
  const mode = opts.mode ?? (req.predictUpgrades ? "projected" : "current");
  const calc = opts.calc ?? DEFAULT_CALC;
  const weights = req.targets ? targetWeights(req.targets) : req.weights && Object.values(req.weights).some((w) => w) ? req.weights : { gs: 1 };
  for (const k in weights) if ((weights[k as StatKey] ?? 0) < 0) throw new Error("Weights must be non-negative; use min/max bounds instead.");
  const limit = req.limit ?? 50;
  // Non-linear objectives (CP, EHP, damage) bound poorly, so keep fewer candidates per slot by default;
  // in testing 15-20 per slot found the same best build as 40 in a fraction of the time.
  const nonLinear = ["cp", "ehp", "dmg", "mcdmg", "dmgps", "ehpps", "s1", "s2", "s3"].some((k) => (weights as any)[k]);
  const topPerSlot = req.topPerSlot ?? (req.targets ? 25 : nonLinear ? 20 : 40);
  const maxNodes = opts.maxNodes ?? 30_000_000;
  const timeLimit = opts.timeLimitMs ?? 20_000;
  const combos = req.sets && req.sets.length ? req.sets.map((c) => c.map((s) => SET_INDEX[s]).filter((x) => x != null)) : null;
  const requiredSets = new Set((req.sets ?? []).flat());

  const equippedNow = GEAR_SLOTS.map((s) => items.find((i) => i.id === hero.equipment[s])).filter(Boolean) as Item[];
  const currentStats = computeFor(hd, hero, equippedNow, mode, calc);
  const refs = statRefs(hd, currentStats);
  const score = req.targets ? (st: DerivedStats) => targetMatch(st, req.targets!).score : (st: DerivedStats) => objective(st, weights, refs);

  const pools = candidateItems(hero, items, req, opts.reserved);
  type Cand = { item: Item; acc: Float64Array; set: number; h: number };
  const slotCands: Cand[][] = [];
  const minNeeds: [number, number][] = []; // [acc index, needed amount] rough, for heuristic
  const accKey: Partial<Record<StatKey, number>> = { atk: A.atk, hp: A.hp, def: A.def, spd: A.spd, cr: A.cr, cd: A.cd, eff: A.eff, res: A.res, gs: A.gs };
  for (const k in req.min ?? {}) { const ai = accKey[k as StatKey]; if (ai != null) minNeeds.push([ai, 1]); }
  // Heuristic weights per accumulator dimension derived from objective weights.
  const hw = new Float64Array(ACC_LEN);
  const accRef = [refs.atk, refs.hp, refs.def, refs.spd, refs.cr, refs.cd, refs.eff, refs.res, refs.gs];
  const addHw = (ai: number, w: number) => { hw[ai] += w; };
  for (const k in weights) {
    const w = weights[k as StatKey] ?? 0;
    if (!w) continue;
    const ai = accKey[k as StatKey];
    if (ai != null) { addHw(ai, w); continue; }
    // derived stats: spread weight over the stats they depend on
    const dep: Record<string, number[]> = {
      cp: [A.atk, A.hp, A.def, A.spd, A.cr, A.cd], ehp: [A.hp, A.def], dmg: [A.atk, A.cr, A.cd], mcdmg: [A.atk, A.cd],
      dmgps: [A.atk, A.cr, A.cd, A.spd], ehpps: [A.hp, A.def, A.spd], s1: [A.atk, A.cr, A.cd, A.hp, A.def], s2: [A.atk, A.cr, A.cd, A.hp, A.def],
      s3: [A.atk, A.cr, A.cd, A.hp, A.def], dac: [],
    };
    for (const d of dep[k] ?? []) addHw(d, w / Math.max(1, (dep[k] ?? []).length));
  }
  for (const [ai] of minNeeds) hw[ai] += 0.5;

  const hasMax = Object.keys(req.max ?? {}).length > 0;
  const relevantDims: number[] = [];
  for (let i = 0; i < ACC_LEN; i++) if (hw[i] > 0) relevantDims.push(i);
  const candCounts = {} as Record<GearSlot, number>;
  for (const slot of GEAR_SLOTS) {
    const list: Cand[] = pools[slot].map((item) => {
      const acc = accumulate(gearView(item, mode), hd.base);
      let h = 0;
      for (let i = 0; i < ACC_LEN; i++) h += (hw[i] * acc[i]) / accRef[i];
      if (requiredSets.has(item.set)) h *= 1.15;
      return { item, acc, set: SET_INDEX[item.set] ?? -1, h };
    });
    list.sort((a, b) => b.h - a.h);
    // keep top N overall + top few of each required set + any item currently on the hero
    const keep = new Set<Cand>(list.slice(0, topPerSlot));
    for (const s of requiredSets) list.filter((c) => c.item.set === s).slice(0, Math.ceil(topPerSlot / 3)).forEach((c) => keep.add(c));
    list.filter((c) => c.item.id === hero.equipment[slot]).forEach((c) => keep.add(c));
    slotCands.push(pruneDominated([...keep].sort((a, b) => b.h - a.h), relevantDims, limit, hasMax));
    candCounts[slot] = slotCands[slotCands.length - 1].length;
  }

  // Order slots: smallest pools first improves pruning.
  const order = GEAR_SLOTS.map((_, i) => i).sort((a, b) => slotCands[a].length - slotCands[b].length);
  const ordered = order.map((i) => slotCands[i]);
  if (ordered.some((l) => l.length === 0)) {
    return { builds: [], nodes: 0, candidates: candCounts, truncated: false, ms: Date.now() - t0 };
  }

  // suffix max per accumulator dim
  const suffixMax: Float64Array[] = [];
  for (let d = 6; d >= 0; d--) {
    const v = new Float64Array(ACC_LEN);
    if (d < 6) {
      const next = suffixMax[0];
      for (let i = 0; i < ACC_LEN; i++) {
        let m = 0;
        for (const c of ordered[d]) if (c.acc[i] > m) m = c.acc[i];
        v[i] = next[i] + m;
      }
    }
    suffixMax.unshift(v);
  }

  const needSkills = ["s1", "s2", "s3"].some((k) => (weights as any)[k] || (req.min as any)?.[k] != null || (req.max as any)?.[k] != null);
  const evalFast = makeEvaluator(hd, hero.bonuses, calc, needSkills);
  const scratch = {} as DerivedStats;
  // max-bound check needs minimum remaining (0 is safe lower bound)
  const maxB = req.max ?? {};
  const minB = req.min ?? {};

  const heap: { score: number; ids: number[]; stats: DerivedStats }[] = [];
  const pushResult = (score: number, picks: number[], stats: DerivedStats) => {
    if (heap.length < limit) {
      heap.push({ score, ids: picks.slice(), stats });
      heap.sort((a, b) => a.score - b.score);
    } else if (score > heap[0].score) {
      heap[0] = { score, ids: picks.slice(), stats };
      heap.sort((a, b) => a.score - b.score);
    }
  };

  const accStack = Array.from({ length: 7 }, () => new Float64Array(ACC_LEN));
  const setCounts = new Int32Array(SET_NAMES.length);
  const optSets = new Int32Array(SET_NAMES.length);
  const tmpAcc = new Float64Array(ACC_LEN);
  const picks = new Array(6).fill(0);
  let nodes = 0;
  let truncated = false;

  const recurse = (depth: number): void => {
    if (truncated) return;
    nodes++;
    if ((nodes & 0xffff) === 0) {
      if (nodes > maxNodes || Date.now() - t0 > timeLimit) { truncated = true; return; }
      opts.onProgress?.({ nodes, results: heap.length });
    }
    const acc = accStack[depth];
    const remaining = 6 - depth;
    if (setDeficit(setCounts, combos) > remaining) return;

    if (depth === 6) {
      const stats = evalFast(acc, setCounts, scratch);
      if (!meetsBounds(stats, req)) return;
      if (combos && setDeficit(setCounts, combos) > 0) return;
      const sc = score(stats);
      if (heap.length < limit || sc > heap[0].score) pushResult(sc, picks, { ...stats });
      return;
    }

    if (depth > 0) {
      // Optimistic bound: partial + best remaining, with every set allowed +remaining pieces.
      const rem = suffixMax[depth];
      for (let i = 0; i < ACC_LEN; i++) tmpAcc[i] = acc[i] + rem[i];
      for (let i = 0; i < optSets.length; i++) optSets[i] = setCounts[i] + remaining;
      const opt = evalFast(tmpAcc, optSets, scratch);
      for (const k in minB) { const m = minB[k as StatKey]; if (m != null && (opt[k as StatKey] as number) < m) return; }
      if (heap.length >= limit && score(opt) <= heap[0].score) return;
      // Pessimistic for max-bounds: current partial with current sets only.
      if (Object.keys(maxB).length) {
        const pes = evalFast(acc, setCounts, scratch);
        for (const k in maxB) { const m = maxB[k as StatKey]; if (m != null && k !== "cp" && (pes[k as StatKey] as number) > m) return; }
      }
    }

    const next = accStack[depth + 1];
    const list = ordered[depth];
    const sh = depth === 0 ? opts.shard : undefined;
    for (let ci = 0; ci < list.length; ci++) {
      if (sh && ci % sh.count !== sh.index) continue;
      const c = list[ci];
      for (let i = 0; i < ACC_LEN; i++) next[i] = acc[i] + c.acc[i];
      if (c.set >= 0) setCounts[c.set]++;
      picks[depth] = ci;
      recurse(depth + 1);
      if (c.set >= 0) setCounts[c.set]--;
      if (truncated) return;
    }
  };
  recurse(0);

  const builds: Build[] = heap
    .sort((a, b) => b.score - a.score)
    .map((r) => {
      const chosen: Partial<Record<GearSlot, string>> = {};
      const its: Item[] = [];
      r.ids.forEach((ci, d) => { const it = ordered[d][ci].item; chosen[it.gear] = it.id; its.push(it); });
      return { heroId: hero.id, items: chosen, stats: r.stats, sets: setsOf(its), score: Math.round(r.score * 100) / 100 };
    });

  return { builds, nodes, candidates: candCounts, truncated, ms: Date.now() - t0 };
}

/**
 * Drops items that are dominated (>= in every relevant dimension) by at least
 * `k` other items of the same set in the same slot. Safe for monotone
 * objectives when there are no max bounds: swapping in a dominating item never
 * lowers any stat, so a dominated item cannot appear in the top-k.
 */
export function pruneDominated<T extends { acc: Float64Array; set: number; item: Item }>(list: T[], dims: number[], k: number, hasMax: boolean): T[] {
  if (hasMax || !dims.length || list.length <= k + 1) return list;
  const out: T[] = [];
  for (const c of list) {
    let dominators = 0;
    for (const o of list) {
      if (o === c || o.set !== c.set) continue;
      let ge = true, gt = false;
      for (const d of dims) { if (o.acc[d] < c.acc[d]) { ge = false; break; } if (o.acc[d] > c.acc[d]) gt = true; }
      if (ge && (gt || o.item.id < c.item.id)) { dominators++; if (dominators >= k) break; }
    }
    if (dominators < k) out.push(c);
  }
  return out;
}

function setsOf(items: Item[]): string[] {
  const c: Record<string, number> = {};
  for (const i of items) c[i.set] = (c[i.set] ?? 0) + 1;
  const out: string[] = [];
  for (const [k, n] of Object.entries(c)) for (let j = 0; j < Math.floor(n / (SETS[k]?.pieces ?? 99)); j++) out.push(k);
  return out.sort();
}

export function computeFor(hd: HeroData, hero: Hero, items: Item[], mode: GearMode = "current", calc = DEFAULT_CALC): DerivedStats {
  const acc = new Float64Array(ACC_LEN);
  const sets = new Int32Array(SET_NAMES.length);
  for (const it of items) {
    accumulate(gearView(it, mode), hd.base, acc);
    const si = SET_INDEX[it.set];
    if (si != null) sets[si]++;
  }
  return finalize(hd, hero.bonuses, acc, sets, calc);
}

export function currentBuildStats(hero: Hero, hd: HeroData, items: Item[], mode: GearMode = "current") {
  const byId = new Map(items.map((i) => [i.id, i]));
  const eq = GEAR_SLOTS.map((s) => byId.get(hero.equipment[s] ?? "")).filter(Boolean) as Item[];
  return { stats: computeFor(hd, hero, eq, mode), items: eq };
}
