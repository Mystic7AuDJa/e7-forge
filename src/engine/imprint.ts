// Memory Imprint. Each hero picks one mode in game:
// - Release: the stat goes to allies in the hero's formation positions (team aura).
// - Concentration: a (usually different) stat goes to the hero only.
// Values come from epic7db hero pages (data/imprints.json, built by
// scripts/build-imprints.mjs); Fribbels' herodata only has the self value
// (self_devotion), used as a fallback for Concentration.
import type { Hero, HeroBonuses, HeroData } from "./types";

export const GRADES = ["D", "C", "B", "A", "S", "SS", "SSS"] as const;
export type Grade = (typeof GRADES)[number];
export type ImprintMode = "release" | "concentration";

export interface ImprintStat {
  stat: keyof HeroBonuses;
  label: string;
  /** Per grade, in the units the bonus field uses (whole % for percent stats). */
  grades: Partial<Record<Grade, number>>;
  /** Release only: epic7db position code ("all", "lr", ...). */
  position?: string;
}

export interface ImprintData { release?: ImprintStat; concentration?: ImprintStat }

export interface HeroImprint {
  /** null when only a value is known (Fribbels import); see gradeForValue. */
  grade: Grade | null;
  value?: number;
  mode: ImprintMode;
  source: "capture" | "import" | "manual";
  /** Concentration value is already part of hero.bonuses (Fribbels exports fold it in). */
  inBonuses?: boolean;
}

const TEXT_STAT: [RegExp, keyof HeroBonuses, keyof HeroBonuses, string][] = [
  [/^Attack/i, "atkPct", "atk", "Attack"],
  [/^Health/i, "hpPct", "hp", "Health"],
  [/^Defense/i, "defPct", "def", "Defense"],
  [/^Speed/i, "spd", "spd", "Speed"],
  [/^Critical Hit Chance/i, "cr", "cr", "Crit Chance"],
  [/^Critical Hit Damage/i, "cd", "cd", "Crit Damage"],
  [/^Effectiveness/i, "eff", "eff", "Effectiveness"],
  [/^Effect Resistance/i, "res", "res", "Effect Resistance"],
];

/** "Attack 12.9%" / "Speed +4" -> stat + value. Returns null for stats we don't model (e.g. Dual Attack). */
export function parseImprintText(text: string): { stat: keyof HeroBonuses; label: string; value: number } | null {
  const m = text.trim().match(/^(.*?)\s*\+?(-?\d+(?:\.\d+)?)\s*(%?)$/);
  if (!m) return null;
  const [, name, num, pct] = m;
  for (const [re, pctKey, flatKey, label] of TEXT_STAT) {
    if (!re.test(name)) continue;
    const isPctStat = pctKey !== flatKey;
    return { stat: isPctStat && !pct ? flatKey : pctKey, label, value: Number(num) };
  }
  return null;
}

const SELF_DEVOTION: Record<string, [keyof HeroBonuses, string, number]> = {
  att_rate: ["atkPct", "Attack", 100], max_hp_rate: ["hpPct", "Health", 100], def_rate: ["defPct", "Defense", 100],
  att: ["atk", "Attack", 1], max_hp: ["hp", "Health", 1], def: ["def", "Defense", 1],
  cri: ["cr", "Crit Chance", 100], acc: ["eff", "Effectiveness", 100], res: ["res", "Effect Resistance", 100],
  speed: ["spd", "Speed", 1],
};

/** Imprint info for a hero: epic7db data first, herodata self value as a Concentration fallback. */
export function imprintFor(hd: HeroData | undefined): ImprintData {
  if (!hd) return {};
  const fromTable = hd.imprints ?? {};
  if (fromTable.concentration || !hd.imprint) return fromTable;
  const map = SELF_DEVOTION[hd.imprint.type];
  if (!map) return fromTable;
  const grades: Partial<Record<Grade, number>> = {};
  for (const [g, v] of Object.entries(hd.imprint.grades)) grades[g as Grade] = Math.round(v * map[2] * 10) / 10;
  return { ...fromTable, concentration: { stat: map[0], label: map[1], grades } };
}

/** Hero bonuses plus the hero's own Concentration and any team auras passed in. */
export function effectiveBonuses(hero: Hero, hd: HeroData, extra?: Partial<HeroBonuses>): HeroBonuses {
  const b = { ...hero.bonuses };
  if (hero.artifact) { b.atk += hero.artifact.atk; b.hp += hero.artifact.hp; b.def += hero.artifact.def; }
  const imp = hero.imprint;
  if (imp?.mode === "concentration" && !imp.inBonuses) {
    const c = imprintFor(hd).concentration;
    const v = imp.grade ? c?.grades[imp.grade] : imp.value;
    if (c && v) b[c.stat] += v;
  }
  if (extra) for (const [k, v] of Object.entries(extra)) b[k as keyof HeroBonuses] += v ?? 0;
  return b;
}

// epic7db position icons: the formation diamond's top / bottom / left / right slots.
const SLOT: Record<string, string> = { t: "top", b: "bottom", l: "left", r: "right" };
export function positionLabel(code: string) {
  if (code === "all") return "all allies";
  const slots = [...code].map((c) => SLOT[c]).filter(Boolean);
  return slots.length ? `allies in the ${slots.join(" and ")} slot${slots.length > 1 ? "s" : ""}` : `positions "${code}"`;
}

export interface TeamAura { from: string; grade: Grade; stat: keyof HeroBonuses; label: string; value: number; position: string; positionLabel: string }

/** Release auras a team gives. Position-limited auras are listed but only "all" is applied automatically. */
export function teamAuras(members: { hero: Hero; hd: HeroData }[]): TeamAura[] {
  const out: TeamAura[] = [];
  for (const m of members) {
    const imp = m.hero.imprint;
    if (!imp || imp.mode !== "release") continue;
    const r = imprintFor(m.hd).release;
    const v = imp.grade ? r?.grades[imp.grade] : undefined;
    if (!r || !v) continue;
    const position = r.position ?? "all";
    out.push({ from: m.hero.name, grade: imp.grade!, stat: r.stat, label: r.label, value: v, position, positionLabel: positionLabel(position) });
  }
  return out;
}

/** Bonus every member (giver included) gets from "all allies" auras. Slot-limited auras depend on formation, so they're left to the player. */
export function auraBonuses(auras: TeamAura[]): Partial<HeroBonuses> {
  const b: Partial<HeroBonuses> = {};
  for (const a of auras) if (a.position === "all") b[a.stat] = (b[a.stat] ?? 0) + a.value;
  return b;
}

export function fmtImprint(stat: keyof HeroBonuses, label: string, v: number) {
  const pct = ["atkPct", "hpPct", "defPct", "cr", "cd", "eff", "res"].includes(stat);
  return `${label} +${v}${pct ? "%" : ""}`;
}

/** Fribbels stores a value, not a grade; match it against the hero's self imprint (herodata) values. */
export function gradeForValue(hd: HeroData | undefined, value: number): Grade | null {
  const sd = hd?.imprint;
  if (!sd) return null;
  const scale = ["att", "max_hp", "def", "speed"].includes(sd.type) ? 1 : 100;
  for (const [g, v] of Object.entries(sd.grades)) if (Math.abs(v * scale - value) < 0.06) return g as Grade;
  return null;
}
