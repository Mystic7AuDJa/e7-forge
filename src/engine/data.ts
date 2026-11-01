import type { HeroData, Stats } from "./types";

export type HeroDb = Map<string, HeroData>;

interface RawHero {
  name: string; code: string; rarity: number; attribute: string; role: string;
  calculatedStatus?: { lv60SixStarFullyAwakened?: Record<string, number>; lv50FiveStarFullyAwakened?: Record<string, number> };
  self_devotion?: { type: string; grades: Record<string, number> };
  ex_equip?: { stat: { type: string; value: number } }[];
  skills?: Record<string, Record<string, unknown>>;
}

export function toStats(raw: Record<string, number> | undefined): Stats {
  const r = raw ?? {};
  return {
    atk: r.atk ?? 0, hp: r.hp ?? 0, def: r.def ?? 0, spd: r.spd ?? 0,
    cr: Math.round((r.chc ?? 0.15) * 100), cd: Math.round((r.chd ?? 1.5) * 100),
    eff: Math.round((r.eff ?? 0) * 100), res: Math.round((r.efr ?? 0) * 100), dac: Math.round((r.dac ?? 0) * 100),
  };
}

export function buildHeroDb(herodata: Record<string, RawHero>, tags: Record<string, string[]> = {}): HeroDb {
  const db: HeroDb = new Map();
  for (const [key, h] of Object.entries(herodata)) {
    if (!h || !h.calculatedStatus) continue;
    db.set(key, {
      name: h.name ?? key,
      code: h.code,
      rarity: h.rarity,
      attribute: h.attribute,
      role: h.role,
      base: toStats(h.calculatedStatus.lv60SixStarFullyAwakened ?? h.calculatedStatus.lv50FiveStarFullyAwakened),
      imprint: h.self_devotion,
      exEquip: (h.ex_equip ?? []).map((e) => ({ type: e.stat.type, value: e.stat.value })),
      skills: (h.skills ?? {}) as HeroData["skills"],
      tags: tags[key] ?? [],
    });
  }
  return db;
}

/** Case/punctuation-insensitive hero lookup (exports occasionally differ in apostrophes). */
export function findHeroData(db: HeroDb, name: string): HeroData | undefined {
  const direct = db.get(name);
  if (direct) return direct;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const n = norm(name);
  for (const [k, v] of db) if (norm(k) === n) return v;
  return undefined;
}
