// Core domain types. Gear/hero shapes follow the Fribbels optimizer export
// (identical in the RexQian fork), normalized for the engine.

export type GearSlot = "Weapon" | "Helmet" | "Armor" | "Necklace" | "Ring" | "Boots";
export const GEAR_SLOTS: GearSlot[] = ["Weapon", "Helmet", "Armor", "Necklace", "Ring", "Boots"];
export const FIXED_MAIN_SLOTS: GearSlot[] = ["Weapon", "Helmet", "Armor"];

export type StatType =
  | "Attack" | "AttackPercent"
  | "Health" | "HealthPercent"
  | "Defense" | "DefensePercent"
  | "Speed"
  | "CriticalHitChancePercent" | "CriticalHitDamagePercent"
  | "EffectivenessPercent" | "EffectResistancePercent";

export const STAT_TYPES: StatType[] = [
  "Attack", "AttackPercent", "Health", "HealthPercent", "Defense", "DefensePercent",
  "Speed", "CriticalHitChancePercent", "CriticalHitDamagePercent",
  "EffectivenessPercent", "EffectResistancePercent",
];

export type Rank = "Normal" | "Good" | "Rare" | "Heroic" | "Epic";

export interface Substat { type: StatType; value: number; rolls?: number; modified?: boolean }

export interface Item {
  id: string;
  gear: GearSlot;
  rank: Rank;
  set: string;
  level: number;
  enhance: number;
  main: { type: StatType; value: number };
  substats: Substat[];
  name?: string;
  locked?: boolean;
  equippedById?: string | null;
  /** In-game hero id wearing this item (from live capture). */
  ingameEquippedId?: string | null;
  /** Gear score (Fribbels WSS-style), computed on import. */
  gs?: number;
}

/** Final in-game stats. cr/cd/eff/res in whole percent. */
export interface Stats {
  atk: number; hp: number; def: number; spd: number;
  cr: number; cd: number; eff: number; res: number; dac: number;
}

export interface DerivedStats extends Stats {
  cp: number; ehp: number; dmg: number; mcdmg: number; dmgps: number; ehpps: number;
  s1: number; s2: number; s3: number; gs: number;
}

/** Flat bonuses from artifact, imprint, EE, etc. Mirrors Fribbels' hero bonus fields. */
export interface HeroBonuses {
  atk: number; hp: number; def: number;
  atkPct: number; hpPct: number; defPct: number;
  spd: number; cr: number; cd: number; eff: number; res: number;
  finalAtkMult: number; finalHpMult: number; finalDefMult: number;
}

export interface Hero {
  id: string;
  name: string;
  /** herodata key; usually equals name. */
  dataKey: string;
  rarity: number;
  attribute: string;
  role: string;
  stars?: number;
  /** Hero level (1-60) when the source provides it. */
  level?: number;
  awaken?: number;
  bonuses: HeroBonuses;
  equipment: Partial<Record<GearSlot, string>>; // slot -> item id
  artifactName?: string;
}

export interface SkillData {
  pow?: number; rate?: number; targets?: number;
  selfHpScaling?: number; selfDefScaling?: number; selfSpdScaling?: number; selfAtkScaling?: number;
  penetration?: number; increasedValue?: number; cdmgIncrease?: number;
  extraSelfAtkScaling?: number; extraSelfDefScaling?: number; extraSelfHpScaling?: number;
}

export interface HeroData {
  name: string;
  code: string;
  rarity: number;
  attribute: string;
  role: string;
  base: Stats; // lv60 6* fully awakened
  imprint?: { type: string; grades: Record<string, number> };
  exEquip?: { type: string; value: number }[];
  skills: { S1?: SkillData; S2?: SkillData; S3?: SkillData };
  tags: string[]; // functional tags (strip, cleanse, cr_push, def_break...)
}

export interface Account {
  heroes: Hero[];
  items: Item[];
  importedAt: string;
  source: string;
}

/** Optimization request for one hero. */
export interface OptimizeRequest {
  heroId: string;
  /** Stat floors/ceilings in final-stat units (cr/cd/eff/res as whole %). */
  min?: Partial<Record<keyof DerivedStats, number>>;
  max?: Partial<Record<keyof DerivedStats, number>>;
  /** Allowed set combos; each entry is a list of required sets (e.g. ["SpeedSet","CriticalSet"]). Empty = any. */
  sets?: string[][];
  /** Weights for the objective; keys are DerivedStats fields. */
  weights?: Partial<Record<keyof DerivedStats, number>>;
  /** Allowed main stats per slot for Necklace/Ring/Boots. */
  mains?: Partial<Record<GearSlot, StatType[]>>;
  /** Item ids that may not be used. */
  exclude?: string[];
  /** Whether gear equipped on other heroes may be taken. */
  allowEquipped?: boolean;
  /** Keep only items at +N or higher (default 0). */
  minEnhance?: number;
  /** Max candidates kept per slot after pruning (default 40). */
  topPerSlot?: number;
  /** Max results returned (default 50). */
  limit?: number;
  /** Project unfinished gear to +15 using expected rolls. */
  predictUpgrades?: boolean;
  /**
   * Benchmark mode: get as close as possible to target stats (e.g. community top-1%).
   * Priorities (1-4, in order) weigh most; other target stats act as tie-breakers.
   */
  targets?: { stats: Partial<Record<keyof DerivedStats, number>>; priorities: (keyof DerivedStats)[] };
}

export interface Build {
  heroId: string;
  items: Partial<Record<GearSlot, string>>;
  stats: DerivedStats;
  sets: string[];
  score: number;
}
