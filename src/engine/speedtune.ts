// Speed-tuning assistant (feature #5): turn-order simulation with speed RNG,
// combat-readiness pushes/reductions and speed buffs/debuffs.
//
// Model: each unit's CR fills at a rate equal to its effective speed. At
// battle start each unit gets a random starting CR in [0, rng*100]. The unit
// whose CR reaches 100 first acts, then resets to 0 and applies its effects.
import { DEFAULT_SPEED_RNG } from "./constants";

export interface TurnEffect {
  /** CR change in percentage points applied to targets (+20 = push 20%). */
  cr?: number;
  /** Speed multiplier buff (+0.3 = Increase Speed) applied for `duration` of the target's own turns. */
  speedMod?: number;
  duration?: number;
  /** Who receives it. */
  target: "self" | "allies" | "allies_except_self" | "enemies" | "fastest_enemy";
  /** Only on this unit's first turn (openers), default true. */
  firstTurnOnly?: boolean;
}

export interface Unit {
  id: string;
  name: string;
  spd: number;
  side: "ally" | "enemy";
  effects?: TurnEffect[];
  /** Starting CR bonus (e.g. artifact/passive "start of battle CR +X%"). */
  startCr?: number;
}

export interface TurnEvent { unit: string; name: string; side: "ally" | "enemy"; time: number; turnNo: number }

export interface SimOptions { rng?: number; turns?: number; random?: () => number; fixedStart?: Record<string, number> }

export function simulate(units: Unit[], o: SimOptions = {}): TurnEvent[] {
  const rng = o.rng ?? DEFAULT_SPEED_RNG;
  const rand = o.random ?? Math.random;
  const maxTurns = o.turns ?? units.length * 2;
  const st = units.map((u) => ({
    u,
    cr: Math.min(100, (o.fixedStart?.[u.id] ?? rand() * rng * 100) + (u.startCr ?? 0)),
    mods: [] as { mod: number; left: number }[],
    turns: 0,
  }));
  const eff = (s: (typeof st)[number]) => Math.max(1, s.u.spd * (1 + s.mods.reduce((a, m) => a + m.mod, 0)));
  const events: TurnEvent[] = [];
  let time = 0;
  while (events.length < maxTurns) {
    let best = st[0], bestDt = Infinity;
    for (const s of st) {
      const dt = Math.max(0, 100 - s.cr) / eff(s);
      if (dt < bestDt - 1e-12 || (Math.abs(dt - bestDt) < 1e-12 && eff(s) > eff(best))) { best = s; bestDt = dt; }
    }
    for (const s of st) s.cr += eff(s) * bestDt;
    time += bestDt;
    best.turns++;
    best.cr = 0;
    events.push({ unit: best.u.id, name: best.u.name, side: best.u.side, time, turnNo: best.turns });
    for (const e of best.u.effects ?? []) {
      if ((e.firstTurnOnly ?? true) && best.turns > 1) continue;
      const targets = st.filter((s) => {
        if (e.target === "self") return s === best;
        if (e.target === "allies") return s.u.side === best.u.side;
        if (e.target === "allies_except_self") return s.u.side === best.u.side && s !== best;
        return s.u.side !== best.u.side;
      });
      const tg = e.target === "fastest_enemy" ? targets.sort((a, b) => b.cr - a.cr).slice(0, 1) : targets;
      for (const t of tg) {
        if (e.cr) t.cr = Math.max(0, Math.min(100, t.cr + e.cr));
        if (e.speedMod) t.mods.push({ mod: e.speedMod, left: e.duration ?? 2 });
      }
    }
    // tick buffs on the acting unit
    best.mods = best.mods.map((m) => ({ ...m, left: m.left - 1 })).filter((m) => m.left > 0);
  }
  return events;
}

export interface TuneCheck {
  /** Desired order of allied first turns by unit id. */
  order: string[];
  /** Also require that all listed allies act before any enemy (for openers). */
  beforeEnemies?: boolean;
}

export interface TuneReport {
  successRate: number;
  pairFailures: { first: string; second: string; failRate: number; neededSpd: number; currentSpd: number }[];
  enemyFirstRate: number;
  warnings: string[];
  sample: TurnEvent[];
}

/** Monte Carlo validation of a speed tune. */
export function validateTune(units: Unit[], check: TuneCheck, o: { rng?: number; trials?: number; random?: () => number } = {}): TuneReport {
  const trials = o.trials ?? 4000;
  const byId = new Map(units.map((u) => [u.id, u]));
  const rng = o.rng ?? DEFAULT_SPEED_RNG;
  let ok = 0, enemyFirst = 0;
  const pairFail = new Map<string, number>();
  let sample: TurnEvent[] = [];
  for (let t = 0; t < trials; t++) {
    const ev = simulate(units, { rng, random: o.random, turns: units.length * 2 });
    if (t === 0) sample = ev;
    const firstIdx = new Map<string, number>();
    ev.forEach((e, i) => { if (!firstIdx.has(e.unit)) firstIdx.set(e.unit, i); });
    const firstEnemy = ev.findIndex((e) => e.side === "enemy");
    let good = true;
    for (let i = 0; i + 1 < check.order.length; i++) {
      const a = firstIdx.get(check.order[i]) ?? Infinity, b = firstIdx.get(check.order[i + 1]) ?? Infinity;
      if (!(a < b)) { good = false; const k = `${check.order[i]}>${check.order[i + 1]}`; pairFail.set(k, (pairFail.get(k) ?? 0) + 1); }
    }
    if (check.beforeEnemies) {
      const lastAlly = Math.max(...check.order.map((id) => firstIdx.get(id) ?? Infinity));
      if (firstEnemy >= 0 && firstEnemy < lastAlly) { good = false; enemyFirst++; }
    }
    if (good) ok++;
  }
  const pairFailures = [...pairFail.entries()].map(([k, n]) => {
    const [a, b] = k.split(">");
    const ua = byId.get(a)!, ub = byId.get(b)!;
    return { first: ua.name, second: ub.name, failRate: n / trials, neededSpd: requiredSpeed(units, a, b, check, rng), currentSpd: ua.spd };
  }).sort((x, y) => y.failRate - x.failRate);

  const warnings: string[] = [];
  for (const p of pairFailures) {
    warnings.push(`${p.second} may cut ${p.first} after speed RNG (${pct(p.failRate)} of fights). ${p.first} needs ~${p.neededSpd} speed (now ${p.currentSpd}) to guarantee it.`);
  }
  if (check.beforeEnemies && enemyFirst) warnings.push(`An enemy acts before your opener sequence finishes in ${pct(enemyFirst / trials)} of fights.`);
  // Static margin warnings for adjacent pairs without pushes involved
  for (let i = 0; i + 1 < check.order.length; i++) {
    const a = byId.get(check.order[i])!, b = byId.get(check.order[i + 1])!;
    if (a && b && a.spd < b.spd) warnings.push(`${a.name} (${a.spd}) is slower than ${b.name} (${b.spd}); this order only works through CR pushes.`);
  }
  return { successRate: ok / trials, pairFailures, enemyFirstRate: enemyFirst / trials, warnings, sample };
}

/** Smallest speed for unit `a` so it acts before `b` in >= 99.5% of fights (Monte Carlo + binary search). */
export function requiredSpeed(units: Unit[], a: string, b: string, check: TuneCheck, rng = DEFAULT_SPEED_RNG): number {
  const ua = units.find((u) => u.id === a)!;
  const ub = units.find((u) => u.id === b)!;
  // analytic guarantee without pushes: a/(1) > b/(1-rng)
  let hi = Math.ceil(Math.max(ua.spd, ub.spd / (1 - rng)) + 2);
  let lo = Math.min(ua.spd, ub.spd) - 30;
  const rate = (spd: number) => {
    const us = units.map((u) => (u.id === a ? { ...u, spd } : u));
    let ok = 0;
    const n = 400;
    for (let t = 0; t < n; t++) {
      const ev = simulate(us, { rng, turns: us.length * 2 });
      const ia = ev.findIndex((e) => e.unit === a), ib = ev.findIndex((e) => e.unit === b);
      if (ia >= 0 && (ib < 0 || ia < ib)) ok++;
    }
    return ok / n;
  };
  if (rate(hi) < 0.995) return hi; // pushes interfere; report analytic bound
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (rate(mid) >= 0.995) hi = mid; else lo = mid;
  }
  void check;
  return hi;
}

/** Probability a unit with speed `spd` acts before an enemy with speed uniform in [min,max]. */
export function winSpeedRace(spd: number, enemyMin: number, enemyMax: number, rng = DEFAULT_SPEED_RNG, trials = 5000, random = Math.random): number {
  let w = 0;
  for (let i = 0; i < trials; i++) {
    const e = enemyMin + random() * (enemyMax - enemyMin);
    const ta = (100 - random() * rng * 100) / spd;
    const tb = (100 - random() * rng * 100) / e;
    if (ta < tb) w++;
  }
  return w / trials;
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
