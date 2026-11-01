import type { TeamCandidate } from "./teams";
import { analyzeTeam } from "./teams";
import { tagList } from "./labels";
// Camping (morale) for Labyrinth / Azmakalis, matching CeciliaBot's Camp
// Simulator: a hero's reaction to a topic = max(0, v[p1]) + max(0, v[p2]) from
// its two personalities. A topic held by one hero scores the reactions of the
// OTHER three members; the camp uses the two best options with different topics.

export interface TopicRow { name: string; values: (number | null)[] }
export interface HeroCamp { topics: string[]; personalities: number[] }

export function reactions(p: number[], table: TopicRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of table) out[t.name] = Math.max(t.values[p[0]] ?? 0, 0) + Math.max(t.values[p[1]] ?? 0, 0);
  return out;
}

export interface MoraleResult { morale: number; topics: [string, string]; holders: [string, string]; parts: [number, number] }

export function teamMorale(team: { name: string; camp?: HeroCamp }[], table: TopicRow[]): MoraleResult | null {
  const r = team.map((m) => (m.camp ? reactions(m.camp.personalities, table) : null));
  const opts: { hero: string; topic: string; morale: number }[] = [];
  team.forEach((m, i) => {
    for (const topic of m.camp?.topics ?? []) {
      let morale = 0;
      team.forEach((_, j) => { if (j !== i) morale += r[j]?.[topic] ?? 0; });
      opts.push({ hero: m.name, topic, morale });
    }
  });
  if (opts.length < 2) return null;
  opts.sort((a, b) => b.morale - a.morale);
  const first = opts[0];
  const second = opts.find((o) => o.topic !== first.topic);
  if (!second) return null;
  return { morale: first.morale + second.morale, topics: [first.topic, second.topic], holders: [first.hero, second.hero], parts: [first.morale, second.morale] };
}

/** Maps CeciliaBot camping data (keyed by slug) onto herodata names. */
export function mapCamping(data: Record<string, any>, heroDb: Record<string, { name?: string }>, names: string[]): Record<string, HeroCamp> {
  const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
  const byName = new Map<string, string>();
  for (const [slug, h] of Object.entries(heroDb)) if (h?.name) byName.set(norm(h.name), slug);
  const out: Record<string, HeroCamp> = {};
  for (const n of names) {
    const slug = byName.get(norm(n)) ?? n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const c = data[slug]?.camping;
    if (c && Array.isArray(c.personalities) && Array.isArray(c.topics)) out[n] = { topics: c.topics.map(String), personalities: c.personalities.map(Number) };
  }
  return out;
}

const SUSTAIN: Record<string, number> = { heal: 2, barrier: 1.5, cleanse: 1.2, revive: 1.2, immunity: 1, immortal: 0.8, invincible: 0.8, def_buff: 0.6, provoke: 0.4 };

export interface CampTeam {
  heroIds: string[]; names: string[]; morale: MoraleResult | null; sustain: number; sustainTags: string[];
  readiness: number; score: number; reasons: string[]; warnings: string[];
}

export function campTeams(cands: TeamCandidate[], camp: Record<string, HeroCamp>, table: TopicRow[], o: {
  size?: number; needTags?: string[]; enemyElement?: string; mustInclude?: string[]; exclude?: string[]; top?: number; pool?: number;
  moraleWeight?: number; sustainWeight?: number; minMorale?: number;
} = {}): CampTeam[] {
  const size = o.size ?? 4;
  const campOf = (c: TeamCandidate) => camp[c.hero.dataKey || c.hero.name] ?? camp[c.hd.name];
  const mw = o.moraleWeight ?? 1, sw = o.sustainWeight ?? 1;
  const must = cands.filter((c) => o.mustInclude?.includes(c.hero.id));
  // Pre-rank: readiness + sustain + needed tags + how much this hero's topics please others on average.
  const avgReact: Record<string, number> = {};
  const all = cands.filter((c) => campOf(c));
  for (const c of all) { const r = reactions(campOf(c)!.personalities, table); for (const [k, v] of Object.entries(r)) avgReact[k] = (avgReact[k] ?? 0) + v / Math.max(1, all.length); }
  const solo = (c: TeamCandidate) => {
    const sus = c.hd.tags.reduce((a, t) => a + (SUSTAIN[t] ?? 0), 0);
    const need = (o.needTags ?? []).filter((t) => c.hd.tags.includes(t)).length;
    const topicPull = (campOf(c)?.topics ?? []).reduce((a, t) => Math.max(a, avgReact[t] ?? 0), 0);
    return c.readiness * 4 + sus * sw * 0.7 + need * 1.5 + topicPull * mw * 0.5;
  };
  const pool = cands.filter((c) => !must.includes(c) && !o.exclude?.includes(c.hero.id))
    .map((c) => ({ c, v: solo(c) })).sort((a, b) => b.v - a.v).slice(0, o.pool ?? 22).map((x) => x.c);
  const k = size - must.length;
  const out: CampTeam[] = [];
  const cur: TeamCandidate[] = [];
  const evalTeam = (team: TeamCandidate[]) => {
    if (new Set(team.map((m) => m.hero.name)).size !== team.length) return;
    const morale = teamMorale(team.map((m) => ({ name: m.hero.name, camp: campOf(m) })), table);
    const tags = new Set(team.flatMap((m) => m.hd.tags));
    const sustainTags = Object.keys(SUSTAIN).filter((t) => tags.has(t));
    const healers = team.filter((m) => m.hd.tags.includes("heal")).length;
    const sustain = sustainTags.reduce((a, t) => a + SUSTAIN[t], 0) + (healers >= 2 ? 1 : 0);
    const readiness = team.reduce((a, m) => a + m.readiness, 0) / team.length;
    const syn = analyzeTeam(team, "pve", o.enemyElement);
    const need = (o.needTags ?? []).filter((t) => tags.has(t));
    const m = morale?.morale ?? 0;
    let score = Math.min(m, 80) / 10 * 2 * mw + sustain * sw + readiness * 5 + syn.score * 0.25 + need.length * 1.5;
    if (o.minMorale && m < o.minMorale) score -= 4;
    const reasons: string[] = [];
    const warnings: string[] = [];
    if (morale) reasons.push(`Camp morale ${m}: ${morale.holders[0]} talks “${morale.topics[0]}” (+${morale.parts[0]}), ${morale.holders[1]} talks “${morale.topics[1]}” (+${morale.parts[1]}).`);
    else warnings.push("No camping data for enough of these heroes to score morale.");
    if (sustainTags.length) reasons.push(`Sustain: ${tagList(sustainTags)}${healers >= 2 ? " (two healers)" : ""}.`);
    else warnings.push("No healing, barrier, cleanse or revive: long runs will drain HP.");
    if (need.length) reasons.push(`Covers boss needs: ${tagList(need)}.`);
    const missing = (o.needTags ?? []).filter((t) => !tags.has(t));
    if (missing.length) warnings.push(`Missing for this boss: ${tagList(missing)}.`);
    for (const s of syn.synergies.slice(0, 1)) reasons.push(s);
    for (const w of syn.warnings.slice(0, 1)) warnings.push(w);
    out.push({ heroIds: team.map((x) => x.hero.id), names: team.map((x) => x.hero.name), morale, sustain: Math.round(sustain * 10) / 10, sustainTags, readiness: Math.round(readiness * 100) / 100, score, reasons, warnings });
  };
  const rec = (s: number) => {
    if (cur.length === k) { evalTeam([...must, ...cur]); return; }
    for (let i = s; i < pool.length; i++) { cur.push(pool[i]); rec(i + 1); cur.pop(); }
  };
  if (k <= 0) evalTeam(must.slice(0, size)); else rec(0);
  out.sort((a, b) => b.score - a.score);
  const picked: CampTeam[] = [];
  for (const t of out) {
    // variety: skip a team sharing 3+ heroes with an already picked one
    if (picked.some((p) => p.heroIds.filter((id) => t.heroIds.includes(id)).length >= size - 1)) continue;
    picked.push(t);
    if (picked.length >= (o.top ?? 6)) break;
  }
  return picked;
}
