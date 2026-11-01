// Team score = role coverage for the content + pairwise synergies + element fit
// + how geared each hero already is. Weights below are hand-tuned, not fitted.
import { optimizeAccount, type AccountResult } from "./account";
import { currentBuildStats, type OptimizeOptions, type StatKey } from "./optimizer";
import { baseRequest, detectArchetype, type Archetype } from "./recommend";
import { TAG_LABELS } from "./tagger";
import type { DerivedStats, Hero, HeroData, Item } from "./types";
import { elementLabel } from "./labels";
import { auraBonuses, fmtImprint, teamAuras } from "./imprint";

export type Content = "arena" | "rta" | "gw_offense" | "gw_defense" | "pve";

export const CONTENT_LABEL: Record<Content, string> = {
  arena: "Arena (offense)", rta: "RTA draft core", gw_offense: "Guild War offense", gw_defense: "Guild War defense", pve: "PvE (raid / hunt / abyss)",
};

const TEAM_SIZE: Record<Content, number> = { arena: 4, rta: 5, gw_offense: 3, gw_defense: 3, pve: 4 };

/** Value of having at least one / a second hero with each tag. */
const NEEDS: Record<Content, Record<string, [number, number]>> = {
  arena: { def_break: [3, 0.5], atk_buff: [2, 0.3], cr_push: [2.5, 0.5], speed_buff: [1.5, 0.3], aoe: [2, 1.5], cr_reduce: [1.5, 0.5], extra_turn: [1, 0.5], strip: [1, 0.3], cleanse: [0.8, 0], unbuffable: [0.6, 0] },
  rta: { strip: [3, 0.8], cleanse: [3, 0.5], immunity: [2, 0.3], def_break: [2, 0.4], stun: [1.5, 0.5], sleep: [1, 0.4], heal: [1.5, 0.3], barrier: [1, 0.3], revive: [1.2, 0], nullifier: [1, 0.3], cr_reduce: [1.5, 0.5], cr_push: [1.2, 0.3], unbuffable: [1, 0.3], provoke: [0.6, 0], speed_down: [0.8, 0.2], silence: [0.8, 0.2] },
  gw_offense: { def_break: [2.5, 0.4], aoe: [2, 1.2], cleanse: [1.5, 0], strip: [1.5, 0.3], cr_push: [1.5, 0.3], atk_buff: [1.5, 0.3], immunity: [1, 0], stun: [1, 0.3] },
  gw_defense: { counter: [2, 1], immortal: [2, 0], nullifier: [1.5, 0.3], immunity: [1.5, 0], heal: [1.5, 0.3], revive: [1.5, 0], barrier: [1.5, 0.5], cr_reduce: [1.5, 0.5], provoke: [1.2, 0], invincible: [1.2, 0], stun: [1, 0.3] },
  pve: { def_break: [3, 0.3], atk_buff: [2, 0.3], heal: [2.5, 0.8], cleanse: [2, 0.3], barrier: [1.5, 0.4], immunity: [1.5, 0], provoke: [1, 0], revive: [1, 0], speed_buff: [0.8, 0], cr_push: [0.8, 0], aoe: [1, 0.5] },
};

const ARCH_VALUE: Record<Content, Partial<Record<Archetype, number>>> = {
  arena: { crit_dps: 2, speed_dps: 2, hp_bruiser: 1.5, debuffer: 1.2, support: 1 },
  rta: { support: 1.5, debuffer: 1.5, crit_dps: 1.2, hp_bruiser: 1.4, def_bruiser: 1.2, tank: 1, speed_dps: 1.2 },
  gw_offense: { crit_dps: 2, speed_dps: 1.8, hp_bruiser: 1.5, debuffer: 1, support: 1 },
  gw_defense: { tank: 1.6, hp_bruiser: 1.6, def_bruiser: 1.6, support: 1.4, debuffer: 1.2, crit_dps: 1 },
  pve: { crit_dps: 1.6, hp_bruiser: 1.6, def_bruiser: 1.4, support: 1.8, tank: 1.2, debuffer: 1 },
};

/** attacker element -> element it beats. herodata uses "wind" for Earth. */
const STAT_SHORT: Record<string, string> = { spd: "Spd", cr: "CR", eff: "Eff", res: "Res", hp: "HP", atk: "Atk", def: "Def" };

const ELEMENT_ADV: Record<string, string> = { fire: "wind", wind: "ice", ice: "fire", light: "dark", dark: "light" };
/** Normalizes guide spellings (earth, water, ...) to herodata elements. */
export function normElement(e?: string | null): string | undefined {
  if (!e) return undefined;
  const x = e.toLowerCase();
  return ({ earth: "wind", grass: "wind", nature: "wind", water: "ice", cold: "ice", red: "fire" } as Record<string, string>)[x] ?? x;
}

export interface TeamCandidate {
  hero: Hero; hd: HeroData; archetype: Archetype; current: DerivedStats; readiness: number;
}

export interface SynergyReport {
  coverage: { tag: string; label: string; count: number; heroes: string[] }[];
  missing: { tag: string; label: string; importance: number }[];
  synergies: string[];
  warnings: string[];
  score: number;
}

export function analyzeTeam(members: TeamCandidate[], content: Content, enemyElementRaw?: string): SynergyReport {
  const enemyElement = normElement(enemyElementRaw);
  const needs = NEEDS[content];
  const tagHeroes = new Map<string, string[]>();
  for (const m of members) for (const t of m.hd.tags) tagHeroes.set(t, [...(tagHeroes.get(t) ?? []), m.hero.name]);
  let score = 0;
  const coverage: SynergyReport["coverage"] = [];
  const missing: SynergyReport["missing"] = [];
  for (const [tag, [first, second]] of Object.entries(needs)) {
    const hs = tagHeroes.get(tag) ?? [];
    if (hs.length) score += first + (hs.length > 1 ? second : 0);
    else missing.push({ tag, label: TAG_LABELS[tag] ?? tag, importance: first });
    coverage.push({ tag, label: TAG_LABELS[tag] ?? tag, count: hs.length, heroes: hs });
  }
  missing.sort((a, b) => b.importance - a.importance);

  const synergies: string[] = [];
  const warnings: string[] = [];
  const has = (t: string) => tagHeroes.has(t);
  const archs = members.map((m) => m.archetype);
  const dps = archs.filter((a) => a === "crit_dps" || a === "speed_dps" || a === "hp_bruiser" || a === "def_bruiser").length;
  const bonus = (cond: boolean, pts: number, text: string) => { if (cond) { score += pts; synergies.push(text); } };
  bonus(has("def_break") && dps > 0, 1.5, "Defense Break sets up your damage dealers.");
  bonus(has("atk_buff") && archs.includes("crit_dps"), 1, "Attack buff amplifies Attack-scaling DPS.");
  bonus((has("cr_push") || has("speed_buff")) && dps > 0, 1, "CR push / speed buff lets DPS act before enemy cleanses.");
  bonus(has("strip") && (has("stun") || has("sleep") || has("unbuffable")), 1, "Strip into crowd control removes immunity before CC lands.");
  bonus(has("unbuffable") && has("strip"), 0.6, "Strip + Unbuffable keeps enemies stripped.");
  bonus(has("dual_attack") && dps > 0, 0.6, "Dual attacks give extra hits from your DPS.");
  bonus(has("cleanse") && content !== "arena", 0.6, "Cleanse covers enemy openers.");

  for (const m of members) score += (ARCH_VALUE[content][m.archetype] ?? 0.8) * 0.5;
  if (dps === 0 && content !== "gw_defense") { warnings.push("No damage dealer: fights will drag."); score -= 3; }
  if (dps >= 3 && content === "rta") { warnings.push("Three or more DPS leaves little room for utility in RTA."); score -= 1; }
  if (archs.filter((a) => a === "tank").length > 1) { warnings.push("Two tanks overlap; provoke/barrier effects stack poorly."); score -= 1; }
  if (members.filter((m) => m.hd.tags.includes("provoke")).length > 1) warnings.push("Multiple provokers: only one provoke can be active.");

  if (enemyElement) {
    const adv = members.filter((m) => ELEMENT_ADV[m.hd.attribute] === enemyElement).length;
    const disadv = members.filter((m) => ELEMENT_ADV[enemyElement] === m.hd.attribute).length;
    score += adv * 0.8 - disadv * 0.8;
    if (adv) synergies.push(`${adv} hero(es) with elemental advantage vs ${elementLabel(enemyElement)}.`);
    if (disadv) warnings.push(`${disadv} hero(es) at elemental disadvantage vs ${elementLabel(enemyElement)}.`);
  }
  // Imprint Release auras: small nudge, since a team is rarely picked for its imprints.
  for (const a of teamAuras(members)) {
    score += a.position === "all" ? 0.4 : 0.2;
    synergies.push(`Imprint Release: ${a.from} (${a.grade}) gives ${fmtImprint(a.stat, a.label, a.value)} to ${a.positionLabel}.`);
  }
  const readiness = members.reduce((a, m) => a + m.readiness, 0) / Math.max(1, members.length);
  score += readiness * 3;

  // Speed order sanity: pusher/opener should be faster than the DPS it supports.
  const pushers = members.filter((m) => m.hd.tags.includes("cr_push") || m.hd.tags.includes("speed_buff"));
  for (const p of pushers) for (const d of members.filter((m) => m.archetype === "crit_dps" && m !== p)) {
    if (d.current.spd > p.current.spd) warnings.push(`${d.hero.name} (${d.current.spd}) is faster than ${p.hero.name} (${p.current.spd}); the push/buff lands after the DPS turn.`);
  }
  return { coverage, missing, synergies, warnings, score: Math.round(score * 100) / 100 };
}

export function candidatesFrom(heroes: Hero[], heroData: (h: Hero) => HeroData | undefined, items: Item[]): TeamCandidate[] {
  const raw = heroes.map((hero) => {
    const hd = heroData(hero);
    if (!hd) return null;
    const current = currentBuildStats(hero, hd, items).stats;
    return { hero, hd, archetype: detectArchetype(hd).archetype, current, readiness: 0 };
  }).filter(Boolean) as TeamCandidate[];
  // readiness: current gear score relative to your best-geared hero (0..1)
  const maxGs = Math.max(1, ...raw.map((r) => r.current.gs));
  for (const r of raw) r.readiness = Math.min(1, r.current.gs / maxGs);
  return raw;
}

export interface TeamSuggestion { members: TeamCandidate[]; report: SynergyReport }

export function buildTeams(cands: TeamCandidate[], content: Content, o: { enemyElement?: string; mustInclude?: string[]; exclude?: string[]; top?: number; pool?: number } = {}): TeamSuggestion[] {
  const size = TEAM_SIZE[content];
  const must = cands.filter((c) => o.mustInclude?.includes(c.hero.id));
  let pool = cands.filter((c) => !o.exclude?.includes(c.hero.id) && !must.includes(c));
  // Pre-rank individuals by solo contribution to keep enumeration small.
  const solo = (c: TeamCandidate) => analyzeTeam([c], content, o.enemyElement).score;
  pool = pool.map((c) => ({ c, s: solo(c) })).sort((a, b) => b.s - a.s).slice(0, o.pool ?? 22).map((x) => x.c);
  const k = size - must.length;
  const results: TeamSuggestion[] = [];
  const top = o.top ?? 5;
  const combo: TeamCandidate[] = [];
  const names = (m: TeamCandidate[]) => new Set(m.map((x) => x.hero.name)).size === m.length;
  const rec = (start: number) => {
    if (combo.length === k) {
      const members = [...must, ...combo];
      if (!names(members)) return;
      const report = analyzeTeam(members, content, o.enemyElement);
      results.push({ members, report });
      if (results.length > top * 40) { results.sort((a, b) => b.report.score - a.report.score); results.length = top * 10; }
      return;
    }
    for (let i = start; i < pool.length; i++) { combo.push(pool[i]); rec(i + 1); combo.pop(); }
  };
  if (k <= 0) results.push({ members: must.slice(0, size), report: analyzeTeam(must.slice(0, size), content, o.enemyElement) });
  else rec(0);
  return results.sort((a, b) => b.report.score - a.report.score).slice(0, top);
}

export interface TeamPlan {
  account: AccountResult;
  perHero: { heroId: string; name: string; archetype: Archetype; missing: { stat: StatKey; target: number; current: number }[] }[];
  upgradePriority: { heroId: string; name: string; reason: string; gapScore: number }[];
}

/** Recommended builds for a team, solved together so heroes don't fight over gear. */
export function planTeam(team: TeamCandidate[], items: Item[], heroData: (h: Hero) => HeroData | undefined, opts: OptimizeOptions = {}, allowEquipped = true, minSpeed: Record<string, number> = {}): TeamPlan {
  const extra = auraBonuses(teamAuras(team));
  const hasAura = Object.keys(extra).length > 0;
  const reqs = team.map((m, i) => {
    const request = baseRequest(m.hero, m.hd, m.current, undefined, allowEquipped).request;
    if (hasAura) request.extraBonuses = extra;
    if (minSpeed[m.hero.id]) request.min = { ...(request.min ?? {}), spd: Math.max(request.min?.spd ?? 0, minSpeed[m.hero.id]) };
    return { request, priority: team.length - i };
  });
  const account = optimizeAccount(team.map((m) => m.hero), heroData, items, { heroes: reqs, objective: "balanced", speedOrder: speedRules(team) }, opts);
  const perHero = team.map((m) => {
    const a = account.assignments.find((x) => x.heroId === m.hero.id);
    const target = a?.build?.stats;
    const missing: TeamPlan["perHero"][number]["missing"] = [];
    if (target) for (const k of ["spd", "cr", "eff", "res", "hp", "atk", "def"] as StatKey[]) {
      const tv = target[k] as number, cv = m.current[k] as number;
      if (tv > cv * 1.03 + 1) missing.push({ stat: k, target: tv, current: cv });
    }
    return { heroId: m.hero.id, name: m.hero.name, archetype: m.archetype, missing };
  });
  const upgradePriority = perHero
    .map((p) => {
      const gap = p.missing.reduce((a, m) => a + (m.target - m.current) / Math.max(1, m.target), 0);
      const top = p.missing.sort((a, b) => (b.target - b.current) / b.target - (a.target - a.current) / a.target)[0];
      return { heroId: p.heroId, name: p.name, gapScore: Math.round(gap * 100) / 100, reason: top ? `${STAT_SHORT[top.stat] ?? top.stat} ${top.current} → ${top.target}` : "Already at target" };
    })
    .sort((a, b) => b.gapScore - a.gapScore);
  return { account, perHero, upgradePriority };
}

/** Pushers/buffers should act before the DPS they enable (5% margin for speed RNG). */
function speedRules(team: TeamCandidate[]) {
  const rules: { faster: string; slower: string; margin: number }[] = [];
  const pushers = team.filter((m) => m.hd.tags.includes("cr_push") || m.hd.tags.includes("speed_buff") || m.hd.tags.includes("def_break") && m.archetype !== "crit_dps");
  const dps = team.filter((m) => m.archetype === "crit_dps" || m.archetype === "speed_dps");
  for (const p of pushers) for (const d of dps) if (p !== d) rules.push({ faster: p.hero.id, slower: d.hero.id, margin: 0 });
  return rules;
}
