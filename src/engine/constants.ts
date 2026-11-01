import type { Rank, StatType } from "./types";

export interface SetDef { pieces: 2 | 4; label: string; }

// Piece counts and stat effects match Fribbels' StatCalculator (fork v1.12.9).
export const SETS: Record<string, SetDef> = {
  HealthSet: { pieces: 2, label: "Health" },
  DefenseSet: { pieces: 2, label: "Defense" },
  AttackSet: { pieces: 4, label: "Attack" },
  SpeedSet: { pieces: 4, label: "Speed" },
  CriticalSet: { pieces: 2, label: "Critical" },
  HitSet: { pieces: 2, label: "Hit" },
  DestructionSet: { pieces: 4, label: "Destruction" },
  LifestealSet: { pieces: 4, label: "Lifesteal" },
  CounterSet: { pieces: 4, label: "Counter" },
  ResistSet: { pieces: 2, label: "Resist" },
  UnitySet: { pieces: 2, label: "Unity" },
  RageSet: { pieces: 4, label: "Rage" },
  ImmunitySet: { pieces: 2, label: "Immunity" },
  PenetrationSet: { pieces: 2, label: "Penetration" },
  RevengeSet: { pieces: 4, label: "Revenge" },
  InjurySet: { pieces: 4, label: "Injury" },
  ProtectionSet: { pieces: 4, label: "Protection" },
  TorrentSet: { pieces: 2, label: "Torrent" },
  ReversalSet: { pieces: 4, label: "Reversal" },
  RiposteSet: { pieces: 4, label: "Riposte" },
  WarfareSet: { pieces: 4, label: "Warfare" },
  PursuitSet: { pieces: 2, label: "Pursuit" },
  WeakeningSet: { pieces: 4, label: "Weakening" },
  FervorSet: { pieces: 2, label: "Fervor" },
};

/** Gear score weight per point of each substat (Fribbels WSS). */
export const GS_WEIGHTS: Record<StatType, number> = {
  AttackPercent: 1, DefensePercent: 1, HealthPercent: 1,
  EffectivenessPercent: 1, EffectResistancePercent: 1,
  Attack: 3.46 / 39, Health: 3.09 / 174, Defense: 4.99 / 31,
  CriticalHitDamagePercent: 8 / 7, CriticalHitChancePercent: 8 / 5, Speed: 2,
};

/** Substat roll ranges for level 85 gear (Epic power = 1). */
export const ROLL_RANGES_85: Record<StatType, [number, number]> = {
  AttackPercent: [4, 8], HealthPercent: [4, 8], DefensePercent: [4, 8],
  EffectivenessPercent: [4, 8], EffectResistancePercent: [4, 8],
  CriticalHitChancePercent: [3, 5], CriticalHitDamagePercent: [4, 7], Speed: [2, 4],
  Attack: [33, 46], Health: [157, 202], Defense: [28, 35],
};

/** Level 88 gear rolls slightly higher. */
export const ROLL_RANGES_88: Record<StatType, [number, number]> = {
  ...ROLL_RANGES_85,
  AttackPercent: [5, 9], HealthPercent: [5, 9], DefensePercent: [5, 9],
  EffectivenessPercent: [5, 9], EffectResistancePercent: [5, 9],
  CriticalHitChancePercent: [3, 6], CriticalHitDamagePercent: [4, 8], Speed: [3, 5],
};

export const RANK_POWER: Record<Rank, number> = { Normal: 0.8, Good: 0.85, Rare: 0.9, Heroic: 0.95, Epic: 1 };

/** Starting substat count by rank. */
export const START_SUBS: Record<Rank, number> = { Normal: 0, Good: 1, Rare: 2, Heroic: 3, Epic: 4 };

/** Reforge (85 -> 90) bonus by number of times a substat was rolled (1 = initial only). */
export const REFORGE_BONUS = {
  plain: [0, 1, 3, 4, 5, 7, 8],
  cr: [0, 1, 2, 3, 4, 5, 6],
  cd: [0, 1, 2, 3, 4, 6, 7],
  spd: [0, 0, 1, 2, 3, 4, 4],
  atk: 11, def: 9, hp: 56,
};

export const PLAIN_STATS: StatType[] = [
  "AttackPercent", "DefensePercent", "HealthPercent", "EffectivenessPercent", "EffectResistancePercent",
];

/** Main stat options per slot. */
export const SLOT_MAINS: Record<string, StatType[]> = {
  Weapon: ["Attack"],
  Helmet: ["Health"],
  Armor: ["Defense"],
  Necklace: ["Attack", "AttackPercent", "Health", "HealthPercent", "Defense", "DefensePercent", "CriticalHitChancePercent", "CriticalHitDamagePercent"],
  Ring: ["Attack", "AttackPercent", "Health", "HealthPercent", "Defense", "DefensePercent", "EffectivenessPercent", "EffectResistancePercent"],
  Boots: ["Attack", "AttackPercent", "Health", "HealthPercent", "Defense", "DefensePercent", "Speed"],
};

export const STAT_LABEL: Record<StatType, string> = {
  Attack: "Atk", AttackPercent: "Atk%", Health: "HP", HealthPercent: "HP%",
  Defense: "Def", DefensePercent: "Def%", Speed: "Spd",
  CriticalHitChancePercent: "CR%", CriticalHitDamagePercent: "CD%",
  EffectivenessPercent: "Eff%", EffectResistancePercent: "Res%",
};

/** Default turn-order speed RNG: units start with 0..5% CR. */
export const DEFAULT_SPEED_RNG = 0.05;
