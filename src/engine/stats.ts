// Stat math mirrors Fribbels' StatCalculator (fork v1.12.9) so numbers line up
// with what you see in Fribbels.
import { SETS } from "./constants";
import { gearScore, projectedSubs, reforgedSubs } from "./gear";
import type { DerivedStats, HeroBonuses, HeroData, Item, Stats, Substat } from "./types";

export const SET_NAMES = Object.keys(SETS);
export const SET_INDEX: Record<string, number> = Object.fromEntries(SET_NAMES.map((s, i) => [s, i]));

// Accumulator layout
export const A = { atk: 0, hp: 1, def: 2, spd: 3, cr: 4, cd: 5, eff: 6, res: 7, gs: 8 } as const;
export const ACC_LEN = 9;

export interface GearView { subs: Substat[]; main: Item["main"]; set: string }

export type GearMode = "current" | "reforged" | "projected";

export function gearView(item: Item, mode: GearMode = "current"): GearView {
  let subs = item.substats;
  if (mode === "reforged" && item.level === 85 && item.enhance >= 15) subs = reforgedSubs(item);
  else if (mode === "projected") subs = item.enhance < 15 ? projectedSubs(item) : item.level === 85 ? reforgedSubs(item) : item.substats;
  let main = item.main;
  if ((mode === "reforged" || mode === "projected") && item.level === 85) main = { ...main, value: reforgedMain(main) };
  return { subs, main, set: item.set };
}

/** Level-85 +15 main stat -> level-90 reforged main stat. */
function reforgedMain(m: Item["main"]): number {
  const map: Record<string, Record<number, number>> = {
    Attack: { 515: 525 }, Health: { 2765: 2835 }, Defense: { 310: 310 },
  };
  const exact = map[m.type]?.[m.value];
  if (exact) return exact;
  if (m.type === "Speed") return m.value >= 45 ? 45 : m.value;
  return m.value; // percent mains are unchanged at 65% / 60% / 70%
}

/** Converts one gear piece into the additive stat vector for a hero's base stats. */
export function accumulate(view: GearView, base: Stats, out = new Float64Array(ACC_LEN)): Float64Array {
  const add = (t: string, v: number) => {
    switch (t) {
      case "Attack": out[A.atk] += v; break;
      case "AttackPercent": out[A.atk] += (v / 100) * base.atk; break;
      case "Health": out[A.hp] += v; break;
      case "HealthPercent": out[A.hp] += (v / 100) * base.hp; break;
      case "Defense": out[A.def] += v; break;
      case "DefensePercent": out[A.def] += (v / 100) * base.def; break;
      case "Speed": out[A.spd] += v; break;
      case "CriticalHitChancePercent": out[A.cr] += v; break;
      case "CriticalHitDamagePercent": out[A.cd] += v; break;
      case "EffectivenessPercent": out[A.eff] += v; break;
      case "EffectResistancePercent": out[A.res] += v; break;
    }
  };
  for (const s of view.subs) add(s.type, s.value);
  add(view.main.type, view.main.value);
  out[A.gs] += gearScore(view.subs);
  return out;
}

export const ZERO_BONUSES: HeroBonuses = {
  atk: 0, hp: 0, def: 0, atkPct: 0, hpPct: 0, defPct: 0, spd: 0, cr: 0, cd: 0, eff: 0, res: 0,
  finalAtkMult: 0, finalHpMult: 0, finalDefMult: 0,
};

export interface CalcSettings { penDefense: number; rageSet: boolean; penSet: boolean }
export const DEFAULT_CALC: CalcSettings = { penDefense: 1500, rageSet: true, penSet: true };

/**
 * Final stats from a summed accumulator and set counts (indexed by SET_INDEX).
 */
export function finalize(hd: HeroData, bonuses: HeroBonuses, acc: ArrayLike<number>, sets: ArrayLike<number>, calc = DEFAULT_CALC): DerivedStats {
  const base = hd.base;
  const s = (name: string) => sets[SET_INDEX[name]] ?? 0;
  const pairs = (name: string) => Math.floor(s(name) / 2);
  const four = (name: string) => s(name) >= 4;

  const baseAtk = base.atk + (base.atk * bonuses.atkPct) / 100 + bonuses.atk;
  const baseHp = base.hp + (base.hp * bonuses.hpPct) / 100 + bonuses.hp;
  const baseDef = base.def + (base.def * bonuses.defPct) / 100 + bonuses.def;

  const atk = (baseAtk + acc[A.atk] + (four("AttackSet") ? 0.45 * base.atk : 0)) * (1 + bonuses.finalAtkMult / 100);
  const hp = (baseHp + acc[A.hp] + pairs("HealthSet") * 0.2 * base.hp + (four("WarfareSet") ? 0.2 * base.hp : 0)
    - pairs("TorrentSet") * 0.1 * base.hp) * (1 + bonuses.finalHpMult / 100);
  const def = (baseDef + acc[A.def] + pairs("DefenseSet") * 0.2 * base.def) * (1 + bonuses.finalDefMult / 100);
  const cr = base.cr + acc[A.cr] + pairs("CriticalSet") * 12 + bonuses.cr;
  const cd = base.cd + acc[A.cd] + (four("DestructionSet") ? 60 : 0) + bonuses.cd;
  const eff = base.eff + acc[A.eff] + pairs("HitSet") * 20 + bonuses.eff;
  const res = base.res + acc[A.res] + pairs("ResistSet") * 20 + bonuses.res;
  const spd = base.spd + acc[A.spd] + (four("SpeedSet") ? 0.25 * base.spd : 0) + (four("RevengeSet") ? 0.12 * base.spd : 0)
    + (four("ReversalSet") ? 0.15 * base.spd : 0) + (four("WeakeningSet") ? 0.15 * base.spd : 0) + bonuses.spd;
  const dac = base.dac + pairs("UnitySet") * 4;

  const critRate = Math.min(cr, 100) / 100;
  const critDmg = Math.min(cd, 350) / 100;
  const cp = ((atk * 1.6 + atk * 1.6 * critRate * critDmg) * (1 + (spd - 45) * 0.02) + hp + def * 9.3) * (1 + (res / 100 + eff / 100) / 4);
  const penSetDmg = (calc.penDefense / 300 + 1) / (0.00283333 * calc.penDefense + 1);
  const rage = calc.rageSet && four("RageSet") ? 0.3 : 0;
  const pen = calc.penSet && s("PenetrationSet") >= 2 ? penSetDmg : 1;
  const torrent = pairs("TorrentSet") * 0.1;
  const pctDmg = 1 + rage + torrent;
  const ehp = hp * (def / 300 + 1);
  const dmg = (critRate * atk * critDmg + (1 - critRate) * atk) * pen * pctDmg;
  const mcdmg = atk * critDmg * pen * pctDmg;

  const skill = (k: "S1" | "S2" | "S3") => skillDamage(hd.skills[k], { atk, hp, def, spd, critDmg, pctDmg, penOn: s("PenetrationSet") >= 2 }, calc);

  return {
    atk: Math.floor(atk), hp: Math.floor(hp), def: Math.floor(def), spd: Math.floor(spd),
    cr: Math.floor(cr), cd: Math.floor(cd), eff: Math.floor(eff), res: Math.floor(res), dac,
    cp: Math.floor(cp), ehp: Math.floor(ehp), dmg: Math.floor(dmg), mcdmg: Math.floor(mcdmg),
    dmgps: Math.floor(dmg * spd / 1000), ehpps: Math.floor(ehp * spd / 1000),
    s1: skill("S1"), s2: skill("S2"), s3: skill("S3"), gs: Math.round(acc[A.gs]),
  };
}

/**
 * Fast evaluator used in the optimizer's inner loop. Same math as finalize(),
 * with set indices and constants precomputed and an optional reusable output object.
 */
export function makeEvaluator(hd: HeroData, bonuses: HeroBonuses, calc = DEFAULT_CALC, withSkills = true) {
  const b = hd.base;
  const I = (n: string) => SET_INDEX[n];
  const iHp = I("HealthSet"), iDef = I("DefenseSet"), iAtk = I("AttackSet"), iSpd = I("SpeedSet"), iCri = I("CriticalSet"),
    iHit = I("HitSet"), iDes = I("DestructionSet"), iRes = I("ResistSet"), iUni = I("UnitySet"), iRage = I("RageSet"),
    iPen = I("PenetrationSet"), iRev = I("RevengeSet"), iTor = I("TorrentSet"), iRevs = I("ReversalSet"),
    iWar = I("WarfareSet"), iWeak = I("WeakeningSet");
  const baseAtk = b.atk + (b.atk * bonuses.atkPct) / 100 + bonuses.atk;
  const baseHp = b.hp + (b.hp * bonuses.hpPct) / 100 + bonuses.hp;
  const baseDef = b.def + (b.def * bonuses.defPct) / 100 + bonuses.def;
  const mAtk = 1 + bonuses.finalAtkMult / 100, mHp = 1 + bonuses.finalHpMult / 100, mDef = 1 + bonuses.finalDefMult / 100;
  const penSetDmg = (calc.penDefense / 300 + 1) / (0.00283333 * calc.penDefense + 1);
  const sk = hd.skills;
  return (acc: ArrayLike<number>, sets: ArrayLike<number>, out?: DerivedStats): DerivedStats => {
    const tor = (sets[iTor] >> 1);
    const atk = (baseAtk + acc[0] + (sets[iAtk] >= 4 ? 0.45 * b.atk : 0)) * mAtk;
    const hp = (baseHp + acc[1] + (sets[iHp] >> 1) * 0.2 * b.hp + (sets[iWar] >= 4 ? 0.2 * b.hp : 0) - tor * 0.1 * b.hp) * mHp;
    const def = (baseDef + acc[2] + (sets[iDef] >> 1) * 0.2 * b.def) * mDef;
    const spd = b.spd + acc[3] + (sets[iSpd] >= 4 ? 0.25 * b.spd : 0) + (sets[iRev] >= 4 ? 0.12 * b.spd : 0)
      + (sets[iRevs] >= 4 ? 0.15 * b.spd : 0) + (sets[iWeak] >= 4 ? 0.15 * b.spd : 0) + bonuses.spd;
    const cr = b.cr + acc[4] + (sets[iCri] >> 1) * 12 + bonuses.cr;
    const cd = b.cd + acc[5] + (sets[iDes] >= 4 ? 60 : 0) + bonuses.cd;
    const eff = b.eff + acc[6] + (sets[iHit] >> 1) * 20 + bonuses.eff;
    const res = b.res + acc[7] + (sets[iRes] >> 1) * 20 + bonuses.res;
    const critRate = (cr > 100 ? 100 : cr) / 100;
    const critDmg = (cd > 350 ? 350 : cd) / 100;
    const penOn = sets[iPen] >= 2;
    const pctDmg = 1 + (calc.rageSet && sets[iRage] >= 4 ? 0.3 : 0) + tor * 0.1;
    const pen = calc.penSet && penOn ? penSetDmg : 1;
    const ehp = hp * (def / 300 + 1);
    const dmg = (critRate * atk * critDmg + (1 - critRate) * atk) * pen * pctDmg;
    const o = out ?? ({} as DerivedStats);
    o.atk = Math.floor(atk); o.hp = Math.floor(hp); o.def = Math.floor(def); o.spd = Math.floor(spd);
    o.cr = Math.floor(cr); o.cd = Math.floor(cd); o.eff = Math.floor(eff); o.res = Math.floor(res);
    o.dac = b.dac + (sets[iUni] >> 1) * 4;
    o.cp = Math.floor(((atk * 1.6 + atk * 1.6 * critRate * critDmg) * (1 + (spd - 45) * 0.02) + hp + def * 9.3) * (1 + (res / 100 + eff / 100) / 4));
    o.ehp = Math.floor(ehp); o.dmg = Math.floor(dmg); o.mcdmg = Math.floor(atk * critDmg * pen * pctDmg);
    o.dmgps = Math.floor(dmg * spd / 1000); o.ehpps = Math.floor(ehp * spd / 1000);
    if (withSkills) {
      const v = { atk, hp, def, spd, critDmg, pctDmg, penOn };
      o.s1 = skillDamage(sk.S1, v, calc); o.s2 = skillDamage(sk.S2, v, calc); o.s3 = skillDamage(sk.S3, v, calc);
    } else { o.s1 = 0; o.s2 = 0; o.s3 = 0; }
    o.gs = Math.round(acc[8]);
    return o;
  };
}

function skillDamage(sk: HeroData["skills"]["S1"], v: { atk: number; hp: number; def: number; spd: number; critDmg: number; pctDmg: number; penOn: boolean }, calc: CalcSettings): number {
  if (!sk || sk.pow == null || sk.rate == null) return 0;
  const singleTarget = sk.targets === 1 ? 1 : 0;
  const realPen = (1 - (sk.penetration ?? 0)) * (1 - (v.penOn ? 0.15 * singleTarget : 0));
  const scal = (sk.selfHpScaling ?? 0) * v.hp + (sk.selfAtkScaling ?? 0) * v.atk + (sk.selfDefScaling ?? 0) * v.def + (sk.selfSpdScaling ?? 0) * v.spd;
  const hit = v.critDmg + (sk.cdmgIncrease ?? 0);
  const dmgUp = 1 + (sk.selfSpdScaling ?? 0) * v.spd;
  const extra = ((sk.extraSelfHpScaling ?? 0) * v.hp + (sk.extraSelfAtkScaling ?? 0) * v.atk + (sk.extraSelfDefScaling ?? 0) * v.def)
    * 1.871 / (calc.penDefense * 0.3 / 300 + 1);
  const offensive = (v.atk * sk.rate + scal) * 1.871 * sk.pow * (1 + (sk.increasedValue ?? 0)) * hit * dmgUp * v.pctDmg;
  const defensive = 1 / (calc.penDefense * Math.max(0, realPen) / 300 + 1);
  return Math.floor(offensive * defensive + extra);
}

/** Convenience: stats for a hero wearing a specific set of items. */
export function computeStats(hd: HeroData, bonuses: HeroBonuses, items: Item[], mode: GearMode = "current", calc = DEFAULT_CALC): DerivedStats {
  const acc = new Float64Array(ACC_LEN);
  const sets = new Array(SET_NAMES.length).fill(0);
  for (const it of items) {
    accumulate(gearView(it, mode), hd.base, acc);
    const si = SET_INDEX[it.set];
    if (si != null) sets[si]++;
  }
  return finalize(hd, bonuses, acc, sets, calc);
}

/** Names of fully-completed sets, e.g. ["SpeedSet", "CriticalSet"]. */
export function completedSets(items: Pick<Item, "set">[]): string[] {
  const counts: Record<string, number> = {};
  for (const it of items) counts[it.set] = (counts[it.set] ?? 0) + 1;
  const out: string[] = [];
  for (const [name, c] of Object.entries(counts)) {
    const p = SETS[name]?.pieces;
    if (!p) continue;
    for (let i = 0; i < Math.floor(c / p); i++) out.push(name);
  }
  return out.sort();
}
