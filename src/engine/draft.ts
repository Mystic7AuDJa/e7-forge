// RTA draft data and the live draft assistant.
//
// Data: E7 Analyzer exports (top-player season stats: per-hero win rate,
// games and pick/ban rate, best pairs and trios) and the weekly
// epic7rtastats snapshot (Champion+ picks by draft slot, pre-bans, bans).
// Neither source has hero-vs-hero results, so "answers the enemy" is judged
// from kits (the Counter Planner's threat table), not from match data.
import type { AnalyzerSnapshot, Combo, TableRow } from "./e7analyzer";
import type { MetaSnapshot, StatRow } from "./metaHistory";
import { THREATS } from "./counters";
import type { TeamCandidate } from "./teams";
import type { HeroData } from "./types";
import { TIER_SCORE, type TierFile } from "./meta";

export interface HeroPower {
  name: string;
  /** Win rate shrunk toward the pool average, minus that average, in points. */
  edge: number;
  win?: number;
  games: number;
  pickBan: number;
  tier?: string;
  /** "data" when top-player games back it, "tier" when only the tier list does. */
  basis: "data" | "tier" | "none";
}

export interface DraftData {
  mean: number;
  power: Map<string, HeroPower>;
  pairs: Map<string, Combo>;
  trios: Combo[];
  /** Side-relative slot ("1", "2", "3", "4+5" for first pick; "1+2", "3", "4", "5" for second) -> hero -> share %. */
  slots: { first: Record<string, Map<string, number>>; second: Record<string, Map<string, number>> };
  /**
   * E7 Analyzer draft-position tables: [side pick 1..5 - 1] -> hero -> games and win rate
   * at that pick. Only the most-taken heroes per pick survive the PDF export.
   */
  slotStats: { first: Map<string, TableRow>[]; second: Map<string, TableRow>[] } | null;
  /** Average win rate when the tracked player picks first / second (they run above 50%). */
  sideMean: { first: number; second: number };
  /** Approximate drafts per side (matches / 2), the denominator for slot shares. */
  sideDrafts: number;
  banRate: Map<string, number>;
  prebanRate: Map<string, number>;
  sources: string[];
}

/** Games of evidence that count as much as the pool average when shrinking win rates. */
export const SHRINK_GAMES = 400;

const pairKey = (a: string, b: string) => [a, b].sort().join(" + ");

export function buildDraftData(analyzer: AnalyzerSnapshot | null, week: MetaSnapshot | null, tiers: TierFile | null): DraftData {
  const heroes = analyzer?.heroes ?? [];
  const totalGames = heroes.reduce((a, h) => a + h.games, 0);
  const mean = totalGames ? heroes.reduce((a, h) => a + h.win * h.games, 0) / totalGames : 50;
  const power = new Map<string, HeroPower>();
  // The pick-side pool lists heroes under the main pool's 100-game cut; shrinking keeps their few games honest.
  const rare = (analyzer?.pickSide ?? []).filter((p) => !heroes.some((h) => h.name === p.name));
  for (const h of [...heroes, ...rare]) {
    const shrunk = (h.win * h.games + mean * SHRINK_GAMES) / (h.games + SHRINK_GAMES);
    power.set(h.name, { name: h.name, edge: Math.round((shrunk - mean) * 100) / 100, win: h.win, games: h.games, pickBan: h.pickBan, basis: "data" });
  }
  for (const [tier, names] of Object.entries(tiers?.rta?.tiers ?? {})) {
    for (const n of names) {
      const p = power.get(n);
      if (p) { p.tier = tier; continue; }
      // Not played by top players at all: assume below average (that is usually why), less so for high tiers.
      const edge = Math.round((-2 + ((TIER_SCORE[tier] ?? 0) - 2.5) * 0.6) * 100) / 100;
      power.set(n, { name: n, edge, games: 0, pickBan: 0, tier, basis: "tier" });
    }
  }
  const pairs = new Map<string, Combo>();
  for (const c of analyzer?.synergies ?? []) if (c.heroes.length === 2 && !c.heroes.some((h) => h.startsWith("("))) pairs.set(pairKey(c.heroes[0], c.heroes[1]), c);
  const slotMap = (rows: Record<string, StatRow[]> | undefined) => Object.fromEntries(Object.entries(rows ?? {}).map(([k, v]) => [k, new Map(v.map((r) => [r.name, r.pct]))]));
  const sources: string[] = [];
  if (analyzer) sources.push(`E7 Analyzer ${analyzer.generatedAt.slice(0, 10)}, ${analyzer.window.split(", ").slice(1).join(", ") || "all ranks"} (${analyzer.matches.toLocaleString("en-US")} top-player matches)`);
  if (week) sources.push(`epic7rtastats Champion+ ${week.start} to ${week.end}`);
  return {
    mean, power, pairs, trios: (analyzer?.trios ?? []).filter((t) => !t.heroes.some((h) => h.startsWith("("))),
    slots: { first: slotMap(week?.firstPick), second: slotMap(week?.secondPick) },
    slotStats: analyzer?.draftSlots ? {
      first: analyzer.draftSlots.first.map((rows) => new Map(rows.map((r) => [r.name, r]))),
      second: analyzer.draftSlots.second.map((rows) => new Map(rows.map((r) => [r.name, r]))),
    } : null,
    sideMean: { first: analyzer?.firstPickWin || mean, second: analyzer?.secondPickWin || mean },
    sideDrafts: (analyzer?.matches ?? 0) / 2,
    banRate: new Map((week?.banned ?? []).map((r) => [r.name, r.pct])),
    prebanRate: new Map((week?.prebanned ?? []).map((r) => [r.name, r.pct])),
    sources,
  };
}

/** Pair bonus in win-rate points above the pool average, damped for small samples. */
export function pairBonus(d: DraftData, a: string, b: string): { pts: number; combo?: Combo } {
  const c = d.pairs.get(pairKey(a, b));
  if (!c) return { pts: 0 };
  const conf = c.games / (c.games + 200);
  return { pts: Math.round((c.win - d.mean) * conf * 100) / 100, combo: c };
}

export function trioBonus(d: DraftData, hero: string, team: string[]): { pts: number; combo?: Combo } {
  let best: { pts: number; combo?: Combo } = { pts: 0 };
  for (const t of d.trios) {
    if (!t.heroes.includes(hero) || t.heroes.filter((h) => h !== hero).some((h) => !team.includes(h))) continue;
    const pts = (t.win - d.mean) * (t.games / (t.games + 200));
    if (pts > best.pts) best = { pts: Math.round(pts * 100) / 100, combo: t };
  }
  return best;
}

// ---- draft state ----------------------------------------------------------

export type Side = "me" | "enemy";
export interface DraftState {
  firstPick: Side;
  myPrebans: string[];
  enemyPrebans: string[];
  myPicks: string[];
  enemyPicks: string[];
}

/** E7 RTA pick order: first pick 1, second pick 2, then 2 each, last pick 1. */
const ORDER: ("F" | "S")[] = ["F", "S", "S", "F", "F", "S", "S", "F", "F", "S"];

export function nextTurn(s: DraftState): { side: Side; mySlot: number; overall: number } | null {
  const done = s.myPicks.length + s.enemyPicks.length;
  if (done >= 10) return null;
  const who = ORDER[done];
  const side: Side = (who === "F") === (s.firstPick === "me") ? "me" : "enemy";
  return { side, mySlot: s.myPicks.length + 1, overall: done + 1 };
}

/** epic7rtastats groups some slots ("4+5", "1+2"). */
export function slotKey(firstPick: boolean, n: number) {
  if (firstPick) return n >= 4 ? "4+5" : String(n);
  return n <= 2 ? "1+2" : String(n);
}

export interface PickAdvice {
  heroId: string;
  name: string;
  score: number;
  parts: { label: string; pts: number }[];
  notes: string[];
}

const TAG_ANSWERS = THREATS.map((t) => ({ id: t.id, label: t.label, enemyTags: t.enemyTags, answers: t.answers, severity: t.severity }));

/** How much a hero's kit answers what the enemy has shown so far (kit-based, not match data). */
export function answersEnemy(hd: HeroData, enemy: (HeroData | undefined)[]): { pts: number; covered: string[] } {
  let pts = 0;
  const covered: string[] = [];
  for (const t of TAG_ANSWERS) {
    const facing = enemy.filter((e) => e?.tags.some((x) => t.enemyTags.includes(x))).length;
    if (!facing) continue;
    if (hd.tags.some((x) => t.answers.includes(x))) { pts += t.severity * 0.35 * Math.min(2, facing); covered.push(t.label.split(" (")[0]); }
  }
  return { pts: Math.round(pts * 100) / 100, covered };
}

/** Rank your heroes for your next pick. */
export function recommendPicks(s: DraftState, cands: TeamCandidate[], d: DraftData, heroData: (name: string) => HeroData | undefined, top = 10): PickAdvice[] {
  const turn = nextTurn(s);
  const mySlot = turn?.side === "me" ? turn.mySlot : s.myPicks.length + 1;
  const taken = new Set([...s.myPrebans, ...s.enemyPrebans, ...s.myPicks, ...s.enemyPicks]);
  const enemyHd = s.enemyPicks.map(heroData);
  const side = s.firstPick === "me" ? "first" : "second";
  const slot = d.slots[side][slotKey(s.firstPick === "me", mySlot)];
  const slotStats = d.slotStats?.[side][mySlot - 1];
  const seen = new Set<string>();
  const out: PickAdvice[] = [];
  for (const c of [...cands].sort((a, b) => b.readiness - a.readiness)) {
    const name = c.hd.name;
    if (taken.has(name) || seen.has(name)) continue;
    seen.add(name);
    const parts: PickAdvice["parts"] = [];
    const notes: string[] = [];
    const p = d.power.get(name);
    parts.push({ label: p?.basis === "data" ? `Top-player win rate ${p.win?.toFixed(1)}% over ${p.games.toLocaleString("en-US")} games` : p?.basis === "tier" ? `Not played by top players; tier ${p.tier}` : "Not played by top players", pts: p?.edge ?? -3 });
    let syn = 0;
    for (const m of s.myPicks) {
      const b = pairBonus(d, name, m);
      if (b.combo) { syn += b.pts; notes.push(`With ${m}: ${b.combo.win}% over ${b.combo.games} games`); }
    }
    const t = trioBonus(d, name, s.myPicks);
    if (t.combo) { syn += t.pts; notes.push(`Trio ${t.combo.heroes.join(" + ")}: ${t.combo.win}% over ${t.combo.games} games`); }
    if (syn) parts.push({ label: "Proven pairs / trios with your picks", pts: Math.round(syn * 100) / 100 });
    if (enemyHd.length) {
      const a = answersEnemy(c.hd, enemyHd);
      if (a.pts) { parts.push({ label: `Answers ${a.covered.join(", ")}`, pts: a.pts }); }
    }
    const st = slotStats?.get(name);
    const share = slot?.get(name);
    if (st && d.sideDrafts) {
      // How often top players take it at exactly this pick, and how those drafts went (shrunk like hero win rates).
      const pct = (st.games / d.sideDrafts) * 100;
      const sm = d.sideMean[side];
      const slotEdge = ((st.win * st.games + sm * SHRINK_GAMES) / (st.games + SHRINK_GAMES) - sm) * 0.5;
      parts.push({ label: `Top players take it at their pick ${mySlot} in about ${pct.toFixed(1)}% of drafts and win ${st.win.toFixed(1)}% of those`, pts: Math.round((Math.log1p(pct) * 0.5 + slotEdge) * 100) / 100 });
    } else if (share) parts.push({ label: `Picked at this slot in ${share.toFixed(1)}% of Champion+ drafts`, pts: Math.round(Math.log1p(share) * 0.5 * 100) / 100 });
    parts.push({ label: `Your gear (${Math.round(c.readiness * 100)}% of your best-geared hero)`, pts: Math.round((c.readiness - 0.6) * 4 * 100) / 100 });
    const ban = d.banRate.get(name);
    if (ban && ban >= 5) notes.push(`Often banned in the final ban (${ban.toFixed(1)}%): pairs well with another must-ban threat`);
    if (mySlot === 1 && (p?.pickBan ?? 0) >= 40) notes.push("High-presence hero: taking it first denies it to the opponent");
    const score = Math.round(parts.reduce((a, x) => a + x.pts, 0) * 100) / 100;
    out.push({ heroId: c.hero.id, name, score, parts, notes });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, top);
}

export interface BanAdvice { name: string; score: number; why: string[] }

/** After picks: which enemy hero to ban, and which of yours they'll likely ban. */
export function banAdvice(s: DraftState, d: DraftData, heroData: (name: string) => HeroData | undefined) {
  const mine = s.myPicks.map(heroData);
  const rank = (names: string[], against: (HeroData | undefined)[]) => names.map((n) => {
    const hd = heroData(n);
    const p = d.power.get(n);
    const why: string[] = [];
    let score = (p?.edge ?? 0) + (d.banRate.get(n) ?? 0) / 10;
    if (p?.basis === "data") why.push(`top-player win rate ${p.win?.toFixed(1)}%`);
    const ban = d.banRate.get(n);
    if (ban) why.push(`banned in ${ban.toFixed(1)}% of Champion+ games`);
    if (hd) {
      const a = answersEnemy(hd, against);
      if (a.pts) { score += a.pts; why.push(`answers ${a.covered.join(", ")}`); }
    }
    return { name: n, score: Math.round(score * 100) / 100, why };
  }).sort((a, b) => b.score - a.score);
  return { banTheirs: rank(s.enemyPicks, mine), theyBan: rank(s.myPicks, s.enemyPicks.map(heroData)) };
}
