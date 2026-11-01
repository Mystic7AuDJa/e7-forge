// Weekly RTA meta snapshots (Champion+, from epic7rtastats.com/meta) and the
// week-over-week comparison that flags meta shifts. The site publishes per-hero
// stats, pre-banned pairs, set and artifact choices, but no full 5-hero teams.

export interface StatRow {
  code: string; name: string; count: number; pct: number; win: number;
  /** The site's own change vs. the previous week, in points. */
  weekPct?: number; weekWin?: number;
}
export interface MetaSnapshot {
  source: string;
  start: string;
  end: string;
  fetchedAt: string;
  /** Games in the window, derived from count / count_pct. */
  games: number;
  picked: StatRow[];
  prebanned: StatRow[];
  banned: StatRow[];
  winRate: StatRow[];
  prebannedPairs: StatRow[];
  heroSets: StatRow[];
  heroArtifacts: StatRow[];
  /** Pick share by draft slot: firstPick["1"] = heroes taken with the first pick. */
  firstPick: Record<string, StatRow[]>;
  secondPick: Record<string, StatRow[]>;
}

function flight(page: string) {
  const chunks = [...page.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);
  return chunks.join("");
}

function jsonAt(big: string, start: number) {
  const open = big[start], close = open === "[" ? "]" : "}";
  let depth = 0, inStr = false;
  for (let j = start; j < big.length; j++) {
    const c = big[j];
    if (inStr) { if (c === "\\") j++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(big.slice(start, j + 1));
  }
  throw new Error("unterminated JSON");
}

function valueOf(big: string, key: string): any {
  const i = big.indexOf(`"${key}":`);
  if (i < 0) return undefined;
  const s = i + key.length + 3;
  return jsonAt(big, s);
}

function rows(raw: any): StatRow[] {
  const list: any[] = Array.isArray(raw) ? raw : raw?.count ?? [];
  return list.filter(Boolean).map((r) => ({
    code: String(r.hero_code ?? r.hero_set_code ?? r.hero_artifact_code ?? ""),
    name: String(r.hero_name ?? r.hero_set_name ?? r.hero_artifact_name ?? ""),
    count: Number(r.count) || 0, pct: Number(r.count_pct) || 0, win: Number(r.win_rate) || 0,
    weekPct: r.week_count_delta != null ? Number(r.week_count_delta) : undefined,
    weekWin: r.week_win_rate_delta != null ? Number(r.week_win_rate_delta) : undefined,
  }));
}

function bySlot(raw: any): Record<string, StatRow[]> {
  const out: Record<string, StatRow[]> = {};
  for (const [slot, v] of Object.entries(raw ?? {})) out[slot] = rows(v);
  return out;
}

export function parseMetaSnapshot(page: string, fetchedAt = new Date().toISOString()): MetaSnapshot {
  const big = flight(page);
  const picked = rows(valueOf(big, "picked_heroes"));
  if (picked.length < 10) throw new Error("Meta page layout changed: picked heroes not found");
  const date = (k: string) => (big.match(new RegExp(`"${k}":"\\$D([^"]+)"`))?.[1] ?? "").slice(0, 10);
  const top = picked[0];
  const games = top.pct > 0 ? Math.round(top.count / (top.pct / 100)) : 0;
  const order = valueOf(big, "pick_order_heroes") ?? {};
  return {
    source: "https://www.epic7rtastats.com/meta",
    start: date("start_date"), end: date("end_date"), fetchedAt, games,
    picked,
    prebanned: rows(valueOf(big, "prebanned_heroes")),
    banned: rows(valueOf(big, "banned_heroes")),
    winRate: rows(valueOf(big, "win_rate_heroes")),
    prebannedPairs: rows(valueOf(big, "prebanned_pairs")),
    heroSets: rows(valueOf(big, "hero_sets")),
    heroArtifacts: rows(valueOf(big, "hero_artifacts")),
    firstPick: bySlot(order.first_pick),
    secondPick: bySlot(order.second_pick),
  };
}

export interface Shift {
  kind: "new" | "dropped" | "rising" | "falling" | "win";
  list: string;
  name: string;
  before?: number;
  after?: number;
  delta?: number;
}

/** Thresholds: a 3-point pick/preban swing, a new top-20 entry, or a 2-point win-rate move with real volume. */
export const SHIFT_PCT = 3;
export const SHIFT_WIN = 2;

export function compareSnapshots(prev: MetaSnapshot, cur: MetaSnapshot): Shift[] {
  const out: Shift[] = [];
  const lists: [string, keyof MetaSnapshot][] = [["Picks", "picked"], ["Pre-bans", "prebanned"], ["Bans", "banned"], ["Pre-banned pairs", "prebannedPairs"], ["Hero sets", "heroSets"], ["Hero artifacts", "heroArtifacts"]];
  for (const [label, key] of lists) {
    const a = new Map((prev[key] as StatRow[]).map((r) => [r.code, r]));
    const b = new Map((cur[key] as StatRow[]).map((r) => [r.code, r]));
    for (const [code, r] of b) {
      const p = a.get(code);
      if (!p) { out.push({ kind: "new", list: label, name: r.name, after: r.pct }); continue; }
      const d = Math.round((r.pct - p.pct) * 100) / 100;
      if (Math.abs(d) >= SHIFT_PCT) out.push({ kind: d > 0 ? "rising" : "falling", list: label, name: r.name, before: p.pct, after: r.pct, delta: d });
      const w = Math.round((r.win - p.win) * 100) / 100;
      if (key === "picked" && Math.abs(w) >= SHIFT_WIN && r.pct >= 5) out.push({ kind: "win", list: label, name: r.name, before: p.win, after: r.win, delta: w });
    }
    for (const [code, p] of a) if (!b.has(code)) out.push({ kind: "dropped", list: label, name: p.name, before: p.pct });
  }
  const weight = (s: Shift) => (s.kind === "new" || s.kind === "dropped" ? 100 : 0) + Math.abs(s.delta ?? 0);
  return out.sort((x, y) => weight(y) - weight(x));
}

const pct = (v?: number) => (v == null ? "-" : `${v.toFixed(1)}%`);

/** Plain-text weekly report. */
export function trendReport(cur: MetaSnapshot, prev: MetaSnapshot | null): string {
  const lines: string[] = [];
  lines.push(`RTA meta, Champion+ (${cur.start} to ${cur.end}), about ${cur.games.toLocaleString("en-US")} games`);
  lines.push(`Source: ${cur.source}`);
  lines.push("");
  lines.push("Most picked");
  cur.picked.slice(0, 20).forEach((r, i) => lines.push(`${String(i + 1).padStart(2)}. ${r.name.padEnd(34)} ${pct(r.pct).padStart(6)} picked  ${pct(r.win).padStart(6)} win`));
  lines.push("");
  lines.push("Most pre-banned pairs");
  cur.prebannedPairs.slice(0, 10).forEach((r, i) => lines.push(`${String(i + 1).padStart(2)}. ${r.name.replace("+", " + ").padEnd(50)} ${pct(r.pct).padStart(6)}`));
  lines.push("");
  if (!prev) {
    // First snapshot: use the site's own week-over-week deltas instead.
    const moves = (["picked", "prebanned", "prebannedPairs"] as const).flatMap((k) =>
      cur[k].filter((r) => Math.abs(r.weekPct ?? 0) >= 1).map((r) => ({ list: k === "picked" ? "Picks" : k === "prebanned" ? "Pre-bans" : "Pre-banned pairs", r })))
      .sort((a, b) => Math.abs(b.r.weekPct!) - Math.abs(a.r.weekPct!));
    lines.push("Change vs. the previous week (from the site's own deltas; 1+ point moves)");
    if (!moves.length) lines.push("None.");
    for (const { list, r } of moves) lines.push(`${r.weekPct! > 0 ? "^" : "v"} ${list}: ${r.name.replace("+", " + ")} ${pct(r.pct - r.weekPct!)} -> ${pct(r.pct)} (${r.weekPct! > 0 ? "+" : ""}${r.weekPct!.toFixed(1)})`);
    return lines.join("\n") + "\n";
  }
  const shifts = compareSnapshots(prev, cur);
  lines.push(`Shifts since ${prev.start} to ${prev.end}`);
  if (!shifts.length) lines.push("None above the thresholds (3 points of pick/pre-ban share, 2 points of win rate).");
  for (const s of shifts) {
    if (s.kind === "new") lines.push(`+ ${s.list}: ${s.name} entered the top list at ${pct(s.after)}`);
    else if (s.kind === "dropped") lines.push(`- ${s.list}: ${s.name} left the top list (was ${pct(s.before)})`);
    else if (s.kind === "win") lines.push(`~ ${s.list}: ${s.name} win rate ${pct(s.before)} -> ${pct(s.after)}`);
    else lines.push(`${s.kind === "rising" ? "^" : "v"} ${s.list}: ${s.name} ${pct(s.before)} -> ${pct(s.after)} (${s.delta! > 0 ? "+" : ""}${s.delta!.toFixed(1)})`);
  }
  return lines.join("\n") + "\n";
}
