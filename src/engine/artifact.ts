// Artifact Attack / Health / Defense by enhancement level. artifactdata.json
// holds the +0 values; each stat grows linearly to 13x at +30 (the same rule
// Fribbels uses, which matches the game once tenths are kept).
import type { Hero } from "./types";

export interface ArtifactBase { code: string; name: string; rarity: number; role: string; stats: { attack: number; health: number; defense: number } }
export interface HeroArtifact { name: string; level: number; atk: number; hp: number; def: number }

export const ARTIFACT_MAX_LEVEL = 30;
/** Levels offered in the picker: every limit break (+3). */
export const ARTIFACT_LEVELS = Array.from({ length: ARTIFACT_MAX_LEVEL / 3 + 1 }, (_, i) => i * 3);

const tenths = (x: number) => Math.round(x * 10) / 10;

export function artifactStats(a: ArtifactBase, level: number): HeroArtifact {
  const lv = Math.max(0, Math.min(ARTIFACT_MAX_LEVEL, Math.round(level)));
  const at = (base: number) => tenths(base + base * 12 * (lv / ARTIFACT_MAX_LEVEL));
  return { name: a.name, level: lv, atk: at(a.stats.attack), hp: at(a.stats.health), def: at(a.stats.defense) };
}

/** Flat stats the hero's artifact adds (0 when none is set). */
export function artifactBonus(hero: Pick<Hero, "artifact">) {
  return { atk: hero.artifact?.atk ?? 0, hp: hero.artifact?.hp ?? 0, def: hero.artifact?.def ?? 0 };
}
