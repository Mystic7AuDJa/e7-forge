// 1) Each hero is optimized against the shared pool to get its top-K builds.
// 2) A branch-and-bound assignment picks one build per hero with no shared
//    items, maximizing the team objective minus a gear-move penalty, while
//    honoring cross-hero speed-order constraints (speed tuning preservation).
// 3) Heroes left without a conflict-free build are re-optimized greedily with
//    the already-assigned items reserved.
import { optimizeHero, type OptimizeOptions } from "./optimizer";
import { GEAR_SLOTS, type Build, type Hero, type HeroData, type Item, type OptimizeRequest } from "./types";

export type TeamObjective = "balanced" | "power" | "gs";

export interface SpeedOrderRule {
  /** Hero that must act first. */
  faster: string;
  /** Hero that must act after. */
  slower: string;
  /** Required margin as a fraction (0.05 = 5% faster, guarantees vs. 5% speed RNG). */
  margin?: number;
}

export interface AccountRequest {
  heroes: { request: OptimizeRequest; priority?: number }[];
  objective?: TeamObjective;
  /** Penalty per item moved off another hero (in normalized score points, default 0.02). */
  movePenalty?: number;
  speedOrder?: SpeedOrderRule[];
  /** Candidate builds kept per hero (default 60). */
  buildsPerHero?: number;
}

export interface AccountAssignment {
  heroId: string;
  build: Build | null;
  normScore: number;
  movedIn: { itemId: string; fromHeroId: string | null }[];
  note?: string;
}

export interface AccountResult {
  assignments: AccountAssignment[];
  teamScore: number;
  totalCp: number;
  avgGs: number;
  movedItems: number;
  violations: string[];
  ms: number;
}

/** Items worn by heroes outside the selection (they stay put unless a hero's request allows taking equipped gear). */
export function lockedOutsideSet(items: Item[], req: AccountRequest): Set<string> {
  const selected = new Set(req.heroes.map((e) => e.request.heroId));
  return new Set(items.filter((i) => i.equippedById && !selected.has(i.equippedById)).map((i) => i.id));
}

/** Top-K builds for one hero of an account request (can run in parallel per hero). */
export function accountCandidates(hero: Hero, hd: HeroData, items: Item[], req: AccountRequest, heroIndex: number, opts: OptimizeOptions = {}): Build[] {
  const e = req.heroes[heroIndex];
  const K = req.buildsPerHero ?? 60;
  const r = optimizeHero(hero, hd, items, { topPerSlot: 16, ...e.request, allowEquipped: true, limit: K }, {
    ...opts, reserved: e.request.allowEquipped ? undefined : lockedOutsideSet(items, req),
  });
  return r.builds;
}

export function optimizeAccount(
  heroes: Hero[], heroData: (h: Hero) => HeroData | undefined, items: Item[], req: AccountRequest,
  opts: OptimizeOptions & { precomputed?: Record<string, Build[]> } = {},
): AccountResult {
  const t0 = Date.now();
  const lambda = req.movePenalty ?? 0.02;
  const objective = req.objective ?? "balanced";
  const byId = new Map(heroes.map((h) => [h.id, h]));
  const entries = req.heroes
    .map((e, i) => ({ ...e, hero: byId.get(e.request.heroId)!, prio: e.priority ?? req.heroes.length - i }))
    .filter((e) => e.hero && heroData(e.hero));
  const selectedIds = new Set(entries.map((e) => e.hero.id));
  const itemOwner = new Map(items.map((i) => [i.id, i.equippedById ?? null]));

  void selectedIds;
  const lockedOutside = lockedOutsideSet(items, req);

  // 1) candidate builds per hero
  const cands = entries.map((e) => {
    const hd = heroData(e.hero)!;
    const builds = opts.precomputed?.[e.hero.id] ?? accountCandidates(e.hero, hd, items, req, req.heroes.indexOf(req.heroes.find((x) => x.request.heroId === e.hero.id)!), opts);
    const best = builds[0]?.score ?? 1;
    return { e, hd, builds, best: best > 0 ? best : 1 };
  });

  const value = (c: (typeof cands)[number], b: Build) => {
    const norm = b.score / c.best;
    const moves = movesFor(b, c.e.hero.id, itemOwner).filter((m) => m.fromHeroId).length;
    const base = objective === "power" ? b.stats.cp / 100000 : objective === "gs" ? b.stats.gs / 400 : norm;
    return c.e.prio * base - lambda * moves;
  };

  // Order heroes by priority (desc) for search; precompute candidate values sorted desc.
  const order = cands.map((c, i) => i).sort((a, b) => cands[b].e.prio - cands[a].e.prio);
  const lists = order.map((i) => cands[i].builds.map((b) => ({ b, v: value(cands[i], b) })).sort((x, y) => y.v - x.v));
  const bestRemaining: number[] = new Array(order.length + 1).fill(0);
  for (let d = order.length - 1; d >= 0; d--) bestRemaining[d] = bestRemaining[d + 1] + Math.max(0, lists[d][0]?.v ?? 0);

  const rules = req.speedOrder ?? [];
  let bestTotal = -Infinity;
  let bestPick: (number | -1)[] = order.map(() => -1);
  const pick: (number | -1)[] = order.map(() => -1);
  const used = new Set<string>();
  const spdOf = new Map<string, number>();
  let nodes = 0;
  const nodeCap = 2_000_000;

  const rulesOk = () => {
    for (const r of rules) {
      const a = spdOf.get(r.faster), b = spdOf.get(r.slower);
      if (a == null || b == null) continue;
      if (a < b * (1 + (r.margin ?? 0))) return false;
    }
    return true;
  };

  const dfs = (d: number, total: number) => {
    if (++nodes > nodeCap) return;
    if (d === order.length) {
      if (total > bestTotal) { bestTotal = total; bestPick = pick.slice(); }
      return;
    }
    if (total + bestRemaining[d] <= bestTotal) return;
    const heroId = cands[order[d]].e.hero.id;
    for (let i = 0; i < lists[d].length; i++) {
      const { b, v } = lists[d][i];
      if (total + v + bestRemaining[d + 1] <= bestTotal) break; // sorted desc
      const ids = Object.values(b.items) as string[];
      if (ids.some((x) => used.has(x))) continue;
      spdOf.set(heroId, b.stats.spd);
      if (!rulesOk()) { spdOf.delete(heroId); continue; }
      ids.forEach((x) => used.add(x));
      pick[d] = i;
      dfs(d + 1, total + v);
      ids.forEach((x) => used.delete(x));
      spdOf.delete(heroId);
      pick[d] = -1;
    }
    // Allow leaving this hero unassigned (fallback handled later) so others can still be solved.
    dfs(d + 1, total);
  };
  dfs(0, 0);

  // 3) greedy fallback for unassigned heroes
  const assignments: AccountAssignment[] = [];
  const reserved = new Set<string>(lockedOutside);
  order.forEach((ci, d) => { const p = bestPick[d]; if (p >= 0) Object.values(lists[d][p].b.items).forEach((x) => reserved.add(x as string)); });
  const violations: string[] = [];
  const assignedSpd = new Map<string, number>();
  order.forEach((ci, d) => { const p = bestPick[d]; if (p >= 0) assignedSpd.set(cands[ci].e.hero.id, lists[d][p].b.stats.spd); });
  order.forEach((ci, d) => {
    const c = cands[ci];
    let build: Build | null = bestPick[d] >= 0 ? lists[d][bestPick[d]].b : null;
    let note: string | undefined;
    if (!build) {
      // Keep speed-order rules against heroes that already have builds.
      const min = { ...(c.e.request.min ?? {}) }, max = { ...(c.e.request.max ?? {}) };
      for (const r of rules) {
        const m = 1 + (r.margin ?? 0);
        if (r.faster === c.e.hero.id) { const o = assignedSpd.get(r.slower); if (o != null) min.spd = Math.max(min.spd ?? 0, Math.ceil(o * m)); }
        if (r.slower === c.e.hero.id) { const o = assignedSpd.get(r.faster); if (o != null) max.spd = Math.min(max.spd ?? Infinity, Math.floor(o / m)); }
      }
      let r = optimizeHero(c.e.hero, c.hd, items, { ...c.e.request, min, max, allowEquipped: true, limit: 1 }, { ...opts, reserved });
      if (!r.builds.length && (min.spd != null || max.spd != null)) r = optimizeHero(c.e.hero, c.hd, items, { ...c.e.request, allowEquipped: true, limit: 1 }, { ...opts, reserved });
      build = r.builds[0] ?? null;
      note = build ? "Solved after higher-priority heroes (top builds conflicted)." : "No build meets this hero's constraints with the remaining gear.";
      if (build) Object.values(build.items).forEach((x) => reserved.add(x as string));
      else violations.push(`${c.e.hero.name}: no valid build`);
    }
    if (build) assignedSpd.set(c.e.hero.id, build.stats.spd);
    assignments.push({
      heroId: c.e.hero.id, build, normScore: build ? Math.round((build.score / c.best) * 1000) / 1000 : 0,
      movedIn: build ? movesFor(build, c.e.hero.id, itemOwner) : [], note,
    });
  });

  // Report speed-rule violations in the final result (fallback builds may break them).
  const spd = new Map(assignments.filter((a) => a.build).map((a) => [a.heroId, a.build!.stats.spd]));
  for (const r of rules) {
    const a = spd.get(r.faster), b = spd.get(r.slower);
    if (a != null && b != null && a < b * (1 + (r.margin ?? 0))) {
      violations.push(`${byId.get(r.faster)?.name} (${a}) should outspeed ${byId.get(r.slower)?.name} (${b}) by ${Math.round((r.margin ?? 0) * 100)}%`);
    }
  }

  const built = assignments.filter((a) => a.build);
  return {
    assignments,
    teamScore: Math.round(built.reduce((s, a) => s + a.normScore, 0) * 1000) / 1000,
    totalCp: built.reduce((s, a) => s + a.build!.stats.cp, 0),
    avgGs: built.length ? Math.round(built.reduce((s, a) => s + a.build!.stats.gs, 0) / built.length) : 0,
    movedItems: built.reduce((s, a) => s + a.movedIn.filter((m) => m.fromHeroId).length, 0),
    violations,
    ms: Date.now() - t0,
  };
}

function movesFor(b: Build, heroId: string, owner: Map<string, string | null>) {
  const out: { itemId: string; fromHeroId: string | null }[] = [];
  for (const slot of GEAR_SLOTS) {
    const id = b.items[slot];
    if (!id) continue;
    const o = owner.get(id) ?? null;
    if (o !== heroId) out.push({ itemId: id, fromHeroId: o });
  }
  return out;
}
