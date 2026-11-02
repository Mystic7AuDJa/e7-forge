// PvP meta: epic7db tier lists (A–SS) + RTA Champion+ rates (epic7rtastats.com)
// used to rank heroes you own and build mode-specific teams.
//
// Arena and Guild War have no public team-usage data, so they use the same
// meta model (tier + RTA) as a proxy, plus each mode's role needs.
import { analyzeTeam, type Content, type TeamCandidate } from "./teams";
import type { HeroDb } from "./data";
import { tagList } from "./labels";
import { pairBonus, type DraftData } from "./draft";

export interface RtaHeroStat { code: string; name: string; pct: number; winRate: number; count: number }
export interface RtaMeta {
  source: string; rankLabel: string; start: string; end: string; fetchedAt: string;
  picked: RtaHeroStat[]; prebanned: RtaHeroStat[]; winRate: RtaHeroStat[];
}

/** Parses the Next.js payload of https://www.epic7rtastats.com/meta. Throws if the shape changed. */
export function parseRtaMeta(page: string, fetchedAt = new Date().toISOString()): RtaMeta {
  const chunks = [...page.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);
  const big = chunks.join("");
  const arrayAfter = (key: string): RtaHeroStat[] => {
    const i = big.indexOf(`"${key}":{"count":[`);
    if (i < 0) throw new Error(`RTA meta: "${key}" not found (site layout changed)`);
    const start = big.indexOf("[", i);
    let depth = 0, j = start;
    for (; j < big.length; j++) { const c = big[j]; if (c === "[") depth++; else if (c === "]" && --depth === 0) break; }
    const raw = JSON.parse(big.slice(start, j + 1)) as any[];
    const out = raw.filter((r) => r && typeof r.hero_name === "string").map((r) => ({
      code: String(r.hero_code), name: String(r.hero_name), pct: Number(r.count_pct) || 0, winRate: Number(r.win_rate) || 0, count: Number(r.count) || 0,
    }));
    if (!out.length) throw new Error(`RTA meta: "${key}" is empty`);
    return out;
  };
  const date = (k: string) => { const m = big.match(new RegExp(`"${k}":"\\$D([^"]+)"`)); return m ? m[1] : ""; };
  return {
    source: "https://www.epic7rtastats.com/meta", rankLabel: "Champion+", start: date("start_date"), end: date("end_date"), fetchedAt,
    picked: arrayAfter("picked_heroes"), prebanned: arrayAfter("prebanned_heroes"), winRate: arrayAfter("win_rate_heroes"),
  };
}

export interface TierFile { [list: string]: { created: string | null; url: string; tiers: Record<string, string[]> } }
export const TIER_SCORE: Record<string, number> = { SS: 5, "S+": 4.5, S: 4, A: 3, B: 1.5, C: 0.5, D: 0 };

export interface MetaInfo {
  name: string; tier?: string; tierScore: number;
  rtaPick?: number; rtaWin?: number; rtaPreban?: number;
  /** Top-player season stats (E7 Analyzer): win %, games, pick/ban %, and win edge over the pool average. */
  topWin?: number; topGames?: number; topPickBan?: number; topEdge?: number;
  /** Combined 0–10-ish score: tier + RTA popularity + win-rate edge. */
  score: number;
  /** True for A–SS tier or a top RTA pick: the "top player" pool. */
  meta: boolean;
}

export function buildMeta(tiers: TierFile | null, list: "rta" | "pve", rta: RtaMeta | null, db: HeroDb, draft?: DraftData | null): Map<string, MetaInfo> {
  const out = new Map<string, MetaInfo>();
  const codeToName = new Map<string, string>();
  for (const [name, h] of db) codeToName.set(h.code, name);
  const get = (name: string) => {
    let m = out.get(name);
    if (!m) { m = { name, tierScore: 0, score: 0, meta: false }; out.set(name, m); }
    return m;
  };
  const t = tiers?.[list]?.tiers ?? {};
  for (const [tier, names] of Object.entries(t)) for (const n of names) { const m = get(n); m.tier = tier; m.tierScore = TIER_SCORE[tier] ?? 0; }
  if (rta && list === "rta") {
    const nameOf = (r: RtaHeroStat) => codeToName.get(r.code) ?? r.name;
    for (const r of rta.picked) { const m = get(nameOf(r)); m.rtaPick = r.pct; m.rtaWin = r.winRate; }
    for (const r of rta.prebanned) get(nameOf(r)).rtaPreban = r.pct;
    for (const r of rta.winRate) { const m = get(nameOf(r)); if (m.rtaWin == null) m.rtaWin = r.winRate; }
  }
  if (draft && list === "rta") {
    for (const p of draft.power.values()) {
      if (p.basis !== "data" || !db.has(p.name)) continue;
      const m = get(p.name);
      m.topWin = p.win; m.topGames = p.games; m.topPickBan = p.pickBan; m.topEdge = p.edge;
    }
  }
  const topPick = Math.max(1, ...[...out.values()].map((m) => m.rtaPick ?? 0));
  for (const m of out.values()) {
    const pick = m.rtaPick ? 3 * Math.log1p(m.rtaPick) / Math.log1p(topPick) : 0;
    const win = m.rtaWin != null && (m.rtaPick ?? 0) >= 2 ? Math.max(-1.5, Math.min(1.5, (m.rtaWin - 50) / 4)) : 0;
    const preban = m.rtaPreban ? Math.min(1.5, m.rtaPreban / 40) : 0;
    // With top-player data, results replace the tier list: 2.5 is roughly an A-tier baseline,
    // each point of win edge is worth 0.6, and presence (pick/ban) adds up to ~2.
    const base = m.topEdge != null ? 2.5 + m.topEdge * 0.6 + Math.log1p(m.topPickBan ?? 0) * 0.45 : m.tierScore;
    m.score = Math.round((base + pick + win + preban) * 100) / 100;
    m.meta = m.tierScore >= TIER_SCORE.A || (m.rtaPick ?? 0) >= 5 || (m.topPickBan ?? 0) >= 5;
  }
  return out;
}

export type PvpMode = "arena_def" | "rta" | "gw_off" | "gw_def";
export type TeamStyle = "auto" | "cleave" | "bruiser";
export const PVP_SIZE: Record<PvpMode, number> = { arena_def: 4, rta: 5, gw_off: 3, gw_def: 3 };
const CONTENT: Record<PvpMode, Content> = { arena_def: "gw_defense", rta: "rta", gw_off: "gw_offense", gw_def: "gw_defense" };

/** Tags that stop a cleave (fast AoE burst) team. Defense modes reward them. */
export const ANTI_CLEAVE = ["counter", "immortal", "invincible", "barrier", "revive", "nullifier", "provoke", "immunity", "cr_reduce", "def_buff", "speed_down", "stun"];
const DPS = new Set(["crit_dps", "speed_dps", "hp_bruiser", "def_bruiser"]);

export interface PvpTeam {
  heroIds: string[]; names: string[]; style: "cleave" | "bruiser" | "control" | "defense" | "draft";
  score: number; metaAvg: number; readiness: number;
  tiers: (string | undefined)[];
  reasons: string[]; warnings: string[];
}

function isCleaveDps(c: TeamCandidate) { return DPS.has(c.archetype) && c.hd.tags.includes("aoe"); }
function isCleaveEnabler(c: TeamCandidate) { return ["def_break", "atk_buff", "cr_push", "speed_buff", "extra_turn"].some((t) => c.hd.tags.includes(t)); }
/** Healers/cleansers that only sustain: not wanted when a cleave is viable (e.g. Tamarinne). */
function isPureSustain(c: TeamCandidate) {
  const t = c.hd.tags;
  return (t.includes("heal") || t.includes("cleanse")) && !isCleaveDps(c) && !["def_break", "atk_buff", "cr_push", "speed_buff"].some((x) => t.includes(x) && c.archetype !== "support");
}

export function cleaveViable(cands: TeamCandidate[]) {
  const dps = cands.filter((c) => isCleaveDps(c) && c.readiness >= 0.45);
  const enablers = cands.filter((c) => isCleaveEnabler(c) && c.readiness >= 0.35);
  return dps.length >= 2 && enablers.length >= 1;
}

export function suggestPvp(cands: TeamCandidate[], meta: Map<string, MetaInfo>, mode: PvpMode, o: { style?: TeamStyle; top?: number; pool?: number; mustInclude?: string[]; draft?: DraftData | null } = {}) {
  const size = PVP_SIZE[mode];
  const content = CONTENT[mode];
  const mi = (c: TeamCandidate) => meta.get(c.hero.dataKey || c.hero.name) ?? meta.get(c.hd.name);
  let style: TeamStyle = o.style ?? "auto";
  const viable = cleaveViable(cands);
  if (mode === "gw_off" && style === "auto") style = viable ? "cleave" : "bruiser";

  let pool = cands.slice();
  const excluded: string[] = [];
  if (mode === "gw_off" && style === "cleave") {
    for (const c of pool) if (isPureSustain(c)) excluded.push(c.hero.name);
    pool = pool.filter((c) => !isPureSustain(c));
  }

  const solo = (c: TeamCandidate) => {
    const m = mi(c);
    let v = (m?.score ?? 0) * 1.2 + c.readiness * 3;
    if (mode === "arena_def" || mode === "gw_def") v += ANTI_CLEAVE.filter((t) => c.hd.tags.includes(t)).length * 0.6;
    if (mode === "gw_off" && style === "cleave") v += (isCleaveDps(c) ? 3 : 0) + (isCleaveEnabler(c) ? 1.5 : 0);
    return v;
  };
  const must = pool.filter((c) => o.mustInclude?.includes(c.hero.id));
  const ranked = pool.filter((c) => !must.includes(c)).map((c) => ({ c, v: solo(c) })).sort((a, b) => b.v - a.v).slice(0, o.pool ?? (size >= 5 ? 16 : 20)).map((x) => x.c);
  const k = size - must.length;
  const combos: TeamCandidate[][] = [];
  const cur: TeamCandidate[] = [];
  const rec = (s: number) => {
    if (cur.length === k) { combos.push([...must, ...cur]); return; }
    for (let i = s; i < ranked.length; i++) { cur.push(ranked[i]); rec(i + 1); cur.pop(); }
  };
  if (k <= 0) combos.push(must.slice(0, size)); else rec(0);

  const scored: PvpTeam[] = [];
  for (const team of combos) {
    if (new Set(team.map((m) => m.hero.name)).size !== team.length) continue;
    const syn = analyzeTeam(team, content);
    const metas = team.map((m) => mi(m));
    const metaAvg = metas.reduce((a, m) => a + (m?.score ?? 0), 0) / team.length;
    const readiness = team.reduce((a, m) => a + m.readiness, 0) / team.length;
    let s = syn.score * 0.5 + metaAvg * 2 + readiness * 4;
    const reasons: string[] = [];
    const warnings: string[] = [...syn.warnings.slice(0, 2)];
    let teamStyle: PvpTeam["style"] = mode === "rta" ? "draft" : mode === "gw_off" ? "bruiser" : "defense";

    if (mode === "gw_off" && style === "cleave") {
      const dps = team.filter(isCleaveDps).length, en = team.filter(isCleaveEnabler).length;
      s += dps * 2.5 + Math.min(1, en) * 2 - (dps < 2 ? 6 : 0);
      teamStyle = "cleave";
      reasons.push(`Cleave: ${dps} AoE damage dealer${dps === 1 ? "" : "s"}${en ? " with a defense-break / buff / push enabler" : ""}.`);
    } else if (mode === "gw_off" && style === "bruiser") {
      const bruisers = team.filter((m) => m.archetype === "hp_bruiser" || m.archetype === "def_bruiser").length;
      const sustain = team.filter((m) => m.hd.tags.includes("heal") || m.hd.tags.includes("cleanse")).length;
      s += bruisers * 1.5 + Math.min(1, sustain) * 1.5;
      if (bruisers) reasons.push(`Bruiser: ${bruisers} durable damage dealer${bruisers === 1 ? "" : "s"}${sustain ? " plus sustain" : ""}.`);
      else warnings.push("No HP or Defense-scaling damage dealer: this team wins on tools, not durability.");
    }
    if (mode === "arena_def" || mode === "gw_def") {
      const anti = [...new Set(team.flatMap((m) => m.hd.tags.filter((t) => ANTI_CLEAVE.includes(t))))];
      s += anti.length * 0.9;
      if (anti.length) reasons.push(`Anti-cleave tools: ${tagList(anti.slice(0, 6))}.`);
      const avgRes = team.reduce((a, m) => a + m.current.res, 0) / team.length;
      if (avgRes < 60) warnings.push(`Low average Effect Resistance (${Math.round(avgRes)}%): openers will land their debuffs.`);
    }
    if (mode === "rta" && o.draft) {
      // Proven pairs and trios among top players.
      const names = team.map((m) => m.hd.name);
      let syn = 0; const found: string[] = [];
      for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++) {
        const pb = pairBonus(o.draft, names[a], names[b]);
        if (pb.combo) { syn += pb.pts; found.push(`${names[a]} + ${names[b]} ${pb.combo.win}%`); }
      }
      for (const t of o.draft.trios) if (t.heroes.every((h) => names.includes(h))) { syn += (t.win - o.draft.mean) * (t.games / (t.games + 200)); found.push(`${t.heroes.join(" + ")} ${t.win}%`); }
      s += syn * 0.4;
      if (found.length) reasons.push(`Proven together among top players: ${found.join("; ")}.`);
      const withData = team.filter((_, i) => metas[i]?.topWin != null);
      if (withData.length) reasons.push(`Top-player win rates: ${withData.map((m) => `${m.hero.name} ${mi(m)!.topWin!.toFixed(1)}%`).join(", ")}.`);
    }
    if (mode === "rta") {
      const banned = team.filter((m, i) => (metas[i]?.rtaPreban ?? 0) >= 30);
      if (banned.length) warnings.push(`Often pre-banned at Champion+: ${banned.map((m) => m.hero.name).join(", ")}. Have a backup.`);
    }
    const strong = team.filter((_, i) => (metas[i]?.tierScore ?? 0) >= TIER_SCORE.A);
    if (strong.length) reasons.push(`${strong.length} of ${team.length} rated A–SS in the tier list (${strong.map((m) => `${m.hero.name} ${mi(m)?.tier}`).join(", ")}).`);
    const popular = team.filter((_, i) => (metas[i]?.rtaPick ?? 0) >= 5);
    if (popular.length) reasons.push(`Picked often by Champion+ RTA players: ${popular.map((m) => `${m.hero.name} ${mi(m)?.rtaPick?.toFixed(1)}%`).join(", ")}.`);
    for (const x of syn.synergies.filter((s) => !s.startsWith("Imprint Release")).slice(0, 2)) reasons.push(x);
    if (readiness < 0.5) warnings.push("Several of these heroes are lightly geared on your account.");
    scored.push({
      heroIds: team.map((m) => m.hero.id), names: team.map((m) => m.hero.name), style: teamStyle,
      score: s, metaAvg: Math.round(metaAvg * 100) / 100, readiness: Math.round(readiness * 100) / 100,
      tiers: metas.map((m) => m?.tier), reasons, warnings,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  // Keep variety: at most two teams sharing the same core of size-1 heroes.
  const out: PvpTeam[] = [];
  const seen = new Map<string, number>();
  for (const t of scored) {
    const core = [...t.heroIds].sort().slice(0, Math.max(2, t.heroIds.length - 1)).join("|");
    if ((seen.get(core) ?? 0) >= 1) continue;
    seen.set(core, (seen.get(core) ?? 0) + 1);
    out.push(t);
    if (out.length >= (o.top ?? 6)) break;
  }
  const best = out[0]?.score ?? 1;
  for (const t of out) t.score = Math.round((t.score / best) * 1000) / 10;
  return { teams: out, style, cleaveViable: viable, excluded };
}
