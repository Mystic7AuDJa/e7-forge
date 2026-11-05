// Team imprints for a single hero's build: the Memory Imprint Release auras
// of the teammates it will play with (plus any other team buffs entered by
// hand), added to its stats while optimizing. Without them a build chases
// crit chance the team already provides and ends up far over 100%.
import { auraBonuses, fmtImprint, teamAuras, type TeamAura } from "./imprint";
import type { Hero, HeroBonuses, HeroData } from "./types";

export type TeamStat = "cr" | "cd" | "atkPct" | "hpPct" | "defPct" | "spd" | "eff" | "res";
export const TEAM_STATS: { k: TeamStat; label: string }[] = [
  { k: "cr", label: "Crit Chance" }, { k: "cd", label: "Crit Damage" }, { k: "atkPct", label: "Attack" }, { k: "hpPct", label: "Health" },
  { k: "defPct", label: "Defense" }, { k: "spd", label: "Speed" }, { k: "eff", label: "Effectiveness" }, { k: "res", label: "Effect Resist" },
];

// Some Release auras are flat (Attack +96, Health +480).
const FLAT_LABEL: Record<string, string> = { atk: "Attack", hp: "Health", def: "Defense" };

export interface HeroTeamSetup {
  /** Up to three teammates (hero ids). The hero's own Release aura counts too. */
  mates: string[];
  /** Teammates whose slot-limited aura reaches this hero in your formation. */
  slotAuras?: string[];
  /** Other team buffs entered by hand. */
  manual?: Partial<Record<TeamStat, number>>;
}

export interface TeamImprintLine { aura: TeamAura; giverId: string; applied: boolean; text: string }

export function teamImprintBonus(hero: Hero, setup: HeroTeamSetup | undefined, heroById: Map<string, Hero>, hdOf: (h: Hero) => HeroData | undefined) {
  const members = [hero.id, ...(setup?.mates ?? [])].map((id) => heroById.get(id)).filter((h): h is Hero => !!h);
  const lines: TeamImprintLine[] = [];
  const applied: TeamAura[] = [];
  for (const m of members) {
    const d = hdOf(m);
    if (!d) continue;
    for (const aura of teamAuras([{ hero: m, hd: d }])) {
      const on = aura.position === "all" || !!setup?.slotAuras?.includes(m.id);
      if (on) applied.push({ ...aura, position: "all" });
      lines.push({ aura, giverId: m.id, applied: on, text: `${aura.from} ${aura.grade}: ${fmtImprint(aura.stat, aura.label, aura.value)} to ${aura.positionLabel}` });
    }
  }
  const bonus: Partial<HeroBonuses> = auraBonuses(applied);
  for (const [k, v] of Object.entries(setup?.manual ?? {})) if (v) bonus[k as TeamStat] = (bonus[k as TeamStat] ?? 0) + v;
  const total = Object.entries(bonus).filter(([, v]) => v).map(([k, v]) => {
    const flat = FLAT_LABEL[k];
    const t = TEAM_STATS.find((s) => s.k === k);
    return `${flat ?? t?.label ?? k} +${Math.round(v! * 10) / 10}${flat || k === "spd" ? "" : "%"}`;
  });
  return { bonus, lines, total, any: total.length > 0 };
}
