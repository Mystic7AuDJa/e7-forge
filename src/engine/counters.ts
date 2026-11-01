// Counter planner: Arena (vs AI defense, 4 heroes) and Guild War defense (3).
//
// Enemy builds: community builds carry no rank/points, so an enemy's build is
// ESTIMATED as the median of a gear-score band of community builds for that
// hero. The band comes from the enemy's arena points (editable mapping) or a
// band you pick. Everything here is labelled as an estimate in the UI.
import { communitySets, type CommunityBuild } from "./benchmark";
import { simulate, type TurnEffect, type Unit } from "./speedtune";
import { analyzeTeam, type TeamCandidate } from "./teams";
import { TAG_LABELS } from "./tagger";
import type { HeroData } from "./types";

export type CounterMode = "arena" | "gw";
export const COUNTER_TEAM_SIZE: Record<CounterMode, number> = { arena: 4, gw: 3 };

/** A slice of community builds ranked by gear score: top `hi`% .. top `lo`% (e.g. 10..25). */
export interface Band { from: number; to: number; label: string }

/** Default arena points -> community gear-score band. Rough, editable; there is no official mapping. */
export const ARENA_BANDS: { minPts: number; band: Band }[] = [
  { minPts: 4000, band: { from: 1, to: 12, label: "top 1–12%" } },
  { minPts: 3500, band: { from: 8, to: 20, label: "top 8–20%" } },
  { minPts: 3000, band: { from: 15, to: 30, label: "top 15–30%" } },
  { minPts: 2500, band: { from: 25, to: 45, label: "top 25–45%" } },
  { minPts: 0, band: { from: 40, to: 70, label: "top 40–70%" } },
];

export const GW_BANDS: Record<string, Band> = {
  "Top guilds": { from: 3, to: 12, label: "top 3–12%" },
  "Mid ranks": { from: 15, to: 35, label: "top 15–35%" },
  "Lower ranks": { from: 35, to: 65, label: "top 35–65%" },
};

export function bandForPoints(points: number): Band {
  return (ARENA_BANDS.find((b) => points >= b.minPts) ?? ARENA_BANDS[ARENA_BANDS.length - 1]).band;
}

export interface EnemyEstimate {
  name: string;
  hd?: HeroData;
  sample: number;
  bandSize: number;
  stats: { spd: number; atk: number; hp: number; def: number; cr: number; cd: number; eff: number; res: number; gs: number };
  spdRange: [number, number];
  sets: { sets: string[]; share: number }[];
}

const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

/** Median build of the gear-score band, plus the speed spread (p20..p80) inside it. */
export function estimateEnemy(name: string, hd: HeroData | undefined, builds: CommunityBuild[], band: Band): EnemyEstimate {
  const valid = builds.filter((b) => b && b.gs > 0).sort((a, b) => b.gs - a.gs);
  const n = valid.length;
  const a = Math.floor((band.from / 100) * n), z = Math.max(a + 1, Math.ceil((band.to / 100) * n));
  const slice = valid.slice(a, z);
  const pick = (f: (b: CommunityBuild) => number) => med(slice.map(f));
  const counts = new Map<string, number>();
  for (const b of slice) { const s = communitySets(b.sets); if (s.length) counts.set(s.join("|"), (counts.get(s.join("|")) ?? 0) + 1); }
  const spds = slice.map((b) => b.spd);
  // Fallback when no community data: base stats (lv60 6* awakened) with a typical +60% speed from gear.
  const fb = hd?.base;
  return {
    name, hd, sample: n, bandSize: slice.length,
    stats: slice.length ? {
      spd: pick((b) => b.spd), atk: pick((b) => b.atk), hp: pick((b) => b.hp), def: pick((b) => b.def),
      cr: pick((b) => b.chc), cd: pick((b) => b.chd), eff: pick((b) => b.eff), res: pick((b) => b.efr), gs: pick((b) => b.gs),
    } : { spd: Math.round((fb?.spd ?? 110) * 1.6), atk: fb?.atk ?? 1000, hp: fb?.hp ?? 6000, def: fb?.def ?? 600, cr: fb?.cr ?? 15, cd: fb?.cd ?? 150, eff: 0, res: 0, gs: 0 },
    spdRange: slice.length ? [q(spds, 0.2), q(spds, 0.8)] : [Math.round((fb?.spd ?? 110) * 1.45), Math.round((fb?.spd ?? 110) * 1.75)],
    sets: [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, c]) => ({ sets: k.split("|"), share: c / Math.max(1, slice.length) })),
  };
}

export interface Threat { id: string; label: string; heroes: string[]; severity: number; answers: string[]; advice: string }

/** Enemy kit features and which of YOUR tags answer them. */
const THREATS: { id: string; label: string; enemyTags: string[]; answers: string[]; severity: number; advice: string }[] = [
  { id: "survival", label: "Survival buffs (immortal / invincible / barrier)", enemyTags: ["immortal", "invincible", "barrier"], answers: ["strip", "unbuffable", "extinction"], severity: 3, advice: "Strip or Unbuffable before your burst; otherwise the kill turn gets wasted." },
  { id: "revive", label: "Revive", enemyTags: ["revive"], answers: ["extinction", "strip", "unhealable"], severity: 2.5, advice: "Extinction stops revives; otherwise kill the reviver first." },
  { id: "cc", label: "Crowd control (stun / sleep / silence / provoke)", enemyTags: ["stun", "sleep", "silence", "provoke", "seal"], answers: ["immunity", "cleanse"], severity: 3, advice: "Bring Immunity or a cleanser, or build Effect Resistance on key units." },
  { id: "cr_control", label: "CR reduction / speed control", enemyTags: ["cr_reduce", "speed_down", "restrict"], answers: ["cr_push", "speed_buff", "immunity"], severity: 2, advice: "Outspeed their opener or bring CR push / speed buffs to recover tempo." },
  { id: "counter", label: "Counterattack", enemyTags: ["counter"], answers: ["unbuffable", "strip", "stun", "sleep"], severity: 2, advice: "Counterattack punishes multi-hit AoE. Strip or CC the counter unit first, or use fewer, bigger hits." },
  { id: "sustain", label: "Healing / sustain", enemyTags: ["heal"], answers: ["unhealable", "def_break"], severity: 1.5, advice: "Unhealable plus focused burst beats sustain." },
  { id: "debuff_wall", label: "Immunity / cleanse (blocks your debuffs)", enemyTags: ["immunity", "cleanse"], answers: ["strip", "dual_attack", "fixed_dmg"], severity: 2, advice: "Strip their Immunity before debuffing, or lean on raw damage." },
  { id: "burst", label: "Enemy burst (defense break / attack buffs)", enemyTags: ["def_break", "atk_buff", "extra_turn"], answers: ["barrier", "def_buff", "invincible", "atk_down", "immunity"], severity: 2, advice: "Barrier, Defense buffs or Attack Down blunt their burst; act first if you can." },
  { id: "nullifier", label: "Skill Nullifier", enemyTags: ["nullifier"], answers: ["dual_attack", "aoe", "strip"], severity: 1, advice: "Pop the nullifier with a cheap hit (S1 or dual attack) before your big skill." },
];

export function analyzeThreats(enemies: EnemyEstimate[]): Threat[] {
  const out: Threat[] = [];
  for (const t of THREATS) {
    const heroes = enemies.filter((e) => e.hd?.tags.some((x) => t.enemyTags.includes(x))).map((e) => e.name);
    if (heroes.length) out.push({ id: t.id, label: t.label, heroes, severity: t.severity * (1 + 0.25 * (heroes.length - 1)), answers: t.answers, advice: t.advice });
  }
  return out.sort((a, b) => b.severity - a.severity);
}

function effectsOf(hd?: HeroData): TurnEffect[] {
  const t = new Set(hd?.tags ?? []);
  const e: TurnEffect[] = [];
  if (t.has("cr_push")) e.push({ target: "allies_except_self", cr: 20 });
  if (t.has("speed_buff")) e.push({ target: "allies", speedMod: 0.3, duration: 2 });
  if (t.has("cr_reduce")) e.push({ target: "enemies", cr: -20 });
  if (t.has("speed_down")) e.push({ target: "enemies", speedMod: -0.3, duration: 2 });
  return e;
}

export interface SpeedRace {
  /** Probability one of your heroes takes the first turn of the fight. */
  firstTurn: number;
  /** Probability all your heroes act before any enemy. */
  allBeforeEnemy: number;
  /** Per-hero chance of acting before the fastest enemy. */
  perHero: { name: string; spd: number; beatsFastest: number }[];
  enemyFastest: { name: string; spd: number };
  /** Speed your fastest hero needs to beat the fastest enemy through speed RNG (5%). */
  needed: number;
  sample: { name: string; side: "ally" | "enemy" }[];
}

export function speedRace(mine: { name: string; spd: number; hd?: HeroData }[], enemies: EnemyEstimate[], rng = 0.05, trials = 3000, random = Math.random): SpeedRace {
  const units: Unit[] = [
    ...mine.map((m, i) => ({ id: `a${i}`, name: m.name, spd: m.spd, side: "ally" as const, effects: effectsOf(m.hd) })),
    ...enemies.map((e, i) => ({ id: `e${i}`, name: e.name, spd: e.stats.spd, side: "enemy" as const, effects: effectsOf(e.hd) })),
  ];
  let first = 0, all = 0;
  const beats = mine.map(() => 0);
  const fastestEnemy = enemies.reduce((a, b) => (b.stats.spd > a.stats.spd ? b : a), enemies[0]);
  const fe = `e${enemies.indexOf(fastestEnemy)}`;
  let sample: SpeedRace["sample"] = [];
  for (let t = 0; t < trials; t++) {
    const ev = simulate(units, { rng, random, turns: units.length + 2 });
    if (t === 0) sample = ev.map((x) => ({ name: x.name, side: x.side }));
    if (ev[0]?.side === "ally") first++;
    const firstEnemy = ev.findIndex((x) => x.side === "enemy");
    const allyIdx = mine.map((_, i) => ev.findIndex((x) => x.unit === `a${i}`));
    if (allyIdx.every((i) => i >= 0 && (firstEnemy < 0 || i < firstEnemy))) all++;
    const feIdx = ev.findIndex((x) => x.unit === fe);
    allyIdx.forEach((i, k) => { if (i >= 0 && (feIdx < 0 || i < feIdx)) beats[k]++; });
  }
  return {
    firstTurn: first / trials, allBeforeEnemy: all / trials,
    perHero: mine.map((m, i) => ({ name: m.name, spd: m.spd, beatsFastest: beats[i] / trials })),
    enemyFastest: { name: fastestEnemy?.name ?? "?", spd: fastestEnemy?.stats.spd ?? 0 },
    needed: Math.ceil((fastestEnemy?.stats.spd ?? 0) / (1 - rng)) + 1,
    sample,
  };
}

const ELEMENT_ADV: Record<string, string> = { fire: "earth", earth: "ice", ice: "fire", light: "dark", dark: "light" };

export interface CounterTeam {
  heroIds: string[];
  names: string[];
  score: number;
  /** 0..100 heuristic "favourability"; NOT a win rate. */
  outlook: number;
  answered: { threat: string; by: string[] }[];
  unanswered: string[];
  elementAdv: number;
  elementDisadv: number;
  race: SpeedRace;
  reasons: string[];
}

export function counterTeams(cands: TeamCandidate[], enemies: EnemyEstimate[], mode: CounterMode, o: { top?: number; pool?: number; mustInclude?: string[]; rng?: number } = {}): { threats: Threat[]; teams: CounterTeam[] } {
  const size = COUNTER_TEAM_SIZE[mode];
  const threats = analyzeThreats(enemies);
  const enemyEls = enemies.map((e) => e.hd?.attribute).filter(Boolean) as string[];
  const content = mode === "arena" ? "arena" : "gw_offense";

  const soloValue = (c: TeamCandidate) => {
    let v = c.readiness * 3;
    for (const t of threats) if (c.hd.tags.some((x) => t.answers.includes(x))) v += t.severity;
    v += enemyEls.filter((el) => ELEMENT_ADV[c.hd.attribute] === el).length * 0.8 - enemyEls.filter((el) => ELEMENT_ADV[el] === c.hd.attribute).length * 0.8;
    return v;
  };
  const must = cands.filter((c) => o.mustInclude?.includes(c.hero.id));
  const pool = cands.filter((c) => !must.includes(c)).map((c) => ({ c, v: soloValue(c) })).sort((a, b) => b.v - a.v).slice(0, o.pool ?? 18).map((x) => x.c);
  const k = size - must.length;
  const combos: TeamCandidate[][] = [];
  const cur: TeamCandidate[] = [];
  const rec = (s: number) => {
    if (cur.length === k) { combos.push([...must, ...cur]); return; }
    for (let i = s; i < pool.length; i++) { cur.push(pool[i]); rec(i + 1); cur.pop(); }
  };
  if (k <= 0) combos.push(must.slice(0, size)); else rec(0);

  const scoreTeam = (team: TeamCandidate[]) => {
    const names = new Set(team.map((m) => m.hero.name));
    if (names.size !== team.length) return null;
    const syn = analyzeTeam(team, content);
    const answered: CounterTeam["answered"] = [];
    const unanswered: string[] = [];
    let s = syn.score * 0.6;
    for (const t of threats) {
      const by = team.filter((m) => m.hd.tags.some((x) => t.answers.includes(x))).map((m) => m.hero.name);
      if (by.length) { answered.push({ threat: t.label, by }); s += t.severity * 1.6; } else { unanswered.push(t.label); s -= t.severity * 0.8; }
    }
    let adv = 0, dis = 0;
    for (const m of team) for (const el of enemyEls) { if (ELEMENT_ADV[m.hd.attribute] === el) adv++; if (ELEMENT_ADV[el] === m.hd.attribute) dis++; }
    s += adv * 0.5 - dis * 0.6;
    return { team, s, answered, unanswered, adv, dis, syn };
  };

  const scored = combos.map(scoreTeam).filter(Boolean) as NonNullable<ReturnType<typeof scoreTeam>>[];
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, Math.max((o.top ?? 5) * 3, 12));
  const best = top[0]?.s ?? 1;

  const teams: CounterTeam[] = top.map((t) => {
    const race = speedRace(t.team.map((m) => ({ name: m.hero.name, spd: m.current.spd, hd: m.hd })), enemies, o.rng ?? 0.05, 1500);
    const answeredShare = threats.length ? t.answered.length / threats.length : 1;
    const readiness = t.team.reduce((a, m) => a + m.readiness, 0) / t.team.length;
    // Heuristic outlook: threat coverage, tempo, gear readiness, elements. Labelled as an estimate, not a win rate.
    const outlook = Math.round(Math.max(0, Math.min(100,
      35 * answeredShare + 30 * race.firstTurn + 20 * readiness + 15 * Math.max(0, Math.min(1, 0.5 + (t.adv - t.dis) / (2 * size))))));
    const reasons: string[] = [];
    for (const a of t.answered.slice(0, 4)) reasons.push(`${a.by.join(" & ")} answer${a.by.length === 1 ? "s" : ""} ${a.threat.toLowerCase()}.`);
    if (t.adv) reasons.push(`${t.adv} elemental advantage match-up${t.adv > 1 ? "s" : ""}.`);
    if (t.dis) reasons.push(`${t.dis} elemental disadvantage match-up${t.dis > 1 ? "s" : ""}.`);
    reasons.push(race.firstTurn >= 0.6 ? `Likely takes the first turn (${Math.round(race.firstTurn * 100)}%).`
      : `Enemy likely moves first (${Math.round((1 - race.firstTurn) * 100)}%); your fastest needs ~${race.needed} speed to beat ${race.enemyFastest.name}.`);
    for (const w of t.syn.warnings.slice(0, 2)) reasons.push(w);
    return {
      heroIds: t.team.map((m) => m.hero.id), names: t.team.map((m) => m.hero.name),
      score: Math.round((t.s / best) * 1000) / 10, outlook, answered: t.answered, unanswered: t.unanswered,
      elementAdv: t.adv, elementDisadv: t.dis, race, reasons,
    };
  });
  // Present in Outlook order (the number shown), detailed score as tie-break.
  teams.sort((a, b) => b.outlook - a.outlook || b.score - a.score);
  return { threats, teams: teams.slice(0, o.top ?? 5) };
}

export const THREAT_TAG_LABEL = (tag: string) => TAG_LABELS[tag] ?? tag;
