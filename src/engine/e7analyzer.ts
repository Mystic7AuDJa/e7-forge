// Parses a saved copy (Print -> PDF, run through pdftotext) of the E7 Analyzer
// meta dashboard (e7-analyzer-slendymang.vercel.app/meta-dashboard/) into a
// dataset. The dashboard covers top-player RTA matches; win rates are from the
// tracked player's side, so they run above 50%.
//
// The leaderboard (player names) is deliberately not kept.

export interface PoolHero { name: string; win: number; games: number; pickBan: number }
export interface Combo { heroes: string[]; win: number; games: number; firstPick?: { win: number; games: number }; secondPick?: { win: number; games: number } }
export interface Mover { name: string; value: number; change: number }

export interface AnalyzerSnapshot {
  source: string;
  generatedAt: string;
  /** Dashboard filter as exported, e.g. "Season Start -> Now, All Ranks". */
  window: string;
  matches: number;
  players: number;
  firstPickWin: number;
  secondPickWin: number;
  heroes: PoolHero[];
  /** "Hero Pool by Pick Side" as exported (the tab that was open: First Pick by default). */
  pickSide: PoolHero[];
  movers: { from: string; to: string; winRising: Mover[]; winFalling: Mover[]; pickRising: Mover[]; pickFalling: Mover[] } | null;
  prebanPairs: Combo[];
  synergies: Combo[];
  trios: Combo[];
  servers: { server: string; win: number; games: number }[];
  /** Names the parser couldn't match to hero data (kept as printed). */
  unmatched: string[];
}

const num = (s: string) => Number(s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0] ?? NaN);

/** Resolves full or truncated ("Shepherd of t…") names to hero-data names. */
export function nameResolver(known: string[]) {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9&… ]+/g, "").replace(/\s+/g, " ").trim();
  const exact = new Map(known.map((n) => [norm(n), n]));
  const unmatched = new Set<string>();
  const resolve = (raw: string) => {
    const s = raw.replace(/\s+/g, " ").trim();
    const full = exact.get(norm(s));
    if (full) return full;
    if (s.endsWith("…")) {
      const prefix = norm(s.slice(0, -1));
      const hits = known.filter((n) => norm(n).startsWith(prefix));
      if (hits.length === 1) return hits[0];
      // Several heroes share the prefix: prefer the shortest, which is what a truncated label most often is.
      if (hits.length > 1) return hits.sort((a, b) => a.length - b.length)[0];
    }
    unmatched.add(s);
    return s;
  };
  return { resolve, unmatched };
}

/** The hero grids only survive pdftotext's -layout mode: rows of names, win %, games, P/B. */
function parsePool(layout: string, startMarker: string, resolve: (s: string) => string): PoolHero[] {
  const start = layout.indexOf(startMarker);
  if (start < 0) return [];
  const end = layout.indexOf("Show less", start);
  const lines = layout.slice(start, end < 0 ? undefined : end).split("\n").map((l) => l.trim()).filter(Boolean);
  const out: PoolHero[] = [];
  for (let i = 0; i + 3 < lines.length; i++) {
    const cells = (l: string) => l.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    const pcts = cells(lines[i + 1]), games = cells(lines[i + 2]), pb = cells(lines[i + 3]);
    if (!pcts.length || !pcts.every((c) => /^\d+(\.\d+)?%$/.test(c))) continue;
    if (!games.every((c) => /games$/.test(c)) || !pb.every((c) => /P\/B$/.test(c))) continue;
    const names = cells(lines[i]);
    if (names.length !== pcts.length || games.length !== pcts.length) continue;
    names.forEach((n, j) => out.push({ name: resolve(n), win: num(pcts[j]), games: num(games[j]), pickBan: num(pb[j]) }));
    i += 3;
  }
  return out;
}

/** Records in -raw mode: name line(s), "56.6%", "179285 games", optional "1st: 76% (50)" / "2nd: …". */
/** A label cut off before the second hero ("Shepherd of the Dark Diene …") can't be recovered; it's marked, not guessed. */
export const CUT_OFF = "(cut off in export)";

function parseCombos(raw: string, startMarker: string, endMarker: string, resolve: (s: string) => string, size: number): Combo[] {
  const start = raw.indexOf(startMarker);
  if (start < 0) return [];
  const end = raw.indexOf(endMarker, start + startMarker.length);
  const lines = raw.slice(start, end < 0 ? undefined : end).split("\n").slice(1).map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^(Min games:|Search hero|Combined First Pick)/.test(l));
  const out: Combo[] = [];
  let nameBuf: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\d+(\.\d+)?%$/.test(l) && /^\d+ games$/.test(lines[i + 1] ?? "")) {
      const text = nameBuf.join(" ").replace(/\s+\+\s*/g, " + ").replace(/\s+/g, " ").trim();
      const parts = text.split(" + ");
      // A trailing "…" that swallowed the "+ partner" leaves fewer names than the combo has.
      const heroes = parts.length < size && /…$/.test(text)
        ? [...parts.map((x) => resolve(x.replace(/\s*…$/, ""))), ...Array(size - parts.length).fill(CUT_OFF)]
        : parts.map(resolve);
      const c: Combo = { heroes, win: num(l), games: num(lines[i + 1]) };
      i++;
      for (const side of ["1st", "2nd"] as const) {
        const m = (lines[i + 1] ?? "").match(new RegExp(`^${side}: (\\d+(?:\\.\\d+)?)% \\((\\d+)\\)$`));
        if (m) { c[side === "1st" ? "firstPick" : "secondPick"] = { win: Number(m[1]), games: Number(m[2]) }; i++; }
      }
      out.push(c);
      nameBuf = [];
    } else {
      nameBuf.push(l);
    }
  }
  return out;
}

function parseMovers(raw: string, resolve: (s: string) => string): AnalyzerSnapshot["movers"] {
  const m = raw.match(/Movers and Shifters (\d{4}-\d{2}-\d{2}) → (\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  const block = raw.slice(m.index!, raw.indexOf("Hero Performance", m.index!));
  const lists: Mover[][] = [];
  let cur: Mover[] | null = null;
  for (const l of block.split("\n").map((x) => x.trim())) {
    if (/^[▲▼] (RISING|FALLING)$/.test(l)) { cur = []; lists.push(cur); continue; }
    const r = l.match(/^(.+?) (\d+(?:\.\d+)?)% ([▲▼]) (\d+(?:\.\d+)?)%$/);
    if (r && cur) cur.push({ name: resolve(r[1]), value: Number(r[2]), change: (r[3] === "▼" ? -1 : 1) * Number(r[4]) });
  }
  return { from: m[1], to: m[2], winRising: lists[0] ?? [], winFalling: lists[1] ?? [], pickRising: lists[2] ?? [], pickFalling: lists[3] ?? [] };
}

export function parseAnalyzer(raw: string, layout: string, knownHeroes: string[]): AnalyzerSnapshot {
  const { resolve, unmatched } = nameResolver(knownHeroes);
  const after = (label: string) => raw.match(new RegExp(`${label}\\n([\\d.,]+)%?`))?.[1] ?? "";
  const gen = raw.match(/Generated (\S+) \| (\d+) matches from (\d+) players/);
  if (!gen) throw new Error("Not an E7 Analyzer meta dashboard export (no 'Generated … matches from … players' footer).");
  const win = layout.match(/FROM\s+TO\s+RANK\s*\n\s*(.+?)\s{2,}→\s{2,}(.+?)\s{2,}(.+?)\s*\n/);
  const snap: AnalyzerSnapshot = {
    source: "https://e7-analyzer-slendymang.vercel.app/meta-dashboard/",
    generatedAt: gen[1],
    window: win ? `${win[1].trim()} -> ${win[2].trim()}, ${win[3].trim()}` : "unknown",
    matches: Number(gen[2]),
    players: Number(gen[3]),
    firstPickWin: num(after("First Pick WR")),
    secondPickWin: num(after("Second Pick WR")),
    heroes: parsePool(layout, "Meta Hero Pool", resolve),
    pickSide: parsePool(layout, "Hero Pool by Pick Side", resolve),
    movers: parseMovers(raw, resolve),
    prebanPairs: parseCombos(raw, "Most Popular Preban Pairs", "Best Synergies", resolve, 2),
    synergies: parseCombos(raw, "Best Synergies", "Best Trios", resolve, 2),
    trios: parseCombos(raw, "Best Trios", "Draft Position", resolve, 3),
    servers: [...raw.matchAll(/^(Global|Korea|Asia|Europe|Japan) (\d+(?:\.\d+)?)% \((\d+) games\)$/gm)].map((m) => ({ server: m[1], win: Number(m[2]), games: Number(m[3]) })),
    unmatched: [],
  };
  if (snap.heroes.length < 20) throw new Error("Hero pool not found; expand 'Meta Hero Pool' (click 'show more') before saving the PDF.");
  snap.unmatched = [...unmatched];
  return snap;
}

export interface Correction { section: "prebanPairs" | "synergies" | "trios"; known: string; games: number; win: number; partner: string; note?: string }

/** Fills names that were cut off in an export, matched on the visible hero plus games and win rate. */
export function applyCorrections(snap: AnalyzerSnapshot, fixes: Correction[]): number {
  let n = 0;
  for (const f of fixes) {
    for (const c of snap[f.section]) {
      if (c.games !== f.games || c.win !== f.win || !c.heroes.includes(f.known)) continue;
      const i = c.heroes.indexOf(CUT_OFF);
      if (i >= 0) { c.heroes[i] = f.partner; n++; }
    }
  }
  return n;
}

/**
 * Weekly numbers from two season-to-date snapshots: games and wins played
 * between them. Cumulative season win rates barely move week to week, so
 * this is what shows a meta shift.
 */
export function heroWindowStats(prev: AnalyzerSnapshot, cur: AnalyzerSnapshot) {
  const before = new Map(prev.heroes.map((h) => [h.name, h]));
  return cur.heroes.map((h) => {
    const p = before.get(h.name);
    const games = h.games - (p?.games ?? 0);
    const wins = (h.win / 100) * h.games - ((p?.win ?? 0) / 100) * (p?.games ?? 0);
    return { name: h.name, games, win: games > 0 ? Math.round((wins / games) * 1000) / 10 : null, seasonWin: h.win, seasonGames: h.games };
  }).filter((x) => x.games > 0).sort((a, b) => b.games - a.games);
}

const pct = (v: number | null | undefined) => (v == null ? "-" : `${v.toFixed(1)}%`);
const fmt = (n: number) => n.toLocaleString("en-US");

export function analyzerReport(cur: AnalyzerSnapshot, prev: AnalyzerSnapshot | null): string {
  const L: string[] = [];
  L.push(`E7 Analyzer top-player RTA data, generated ${cur.generatedAt.slice(0, 10)}`);
  L.push(`Window: ${cur.window}. ${fmt(cur.matches)} matches from ${fmt(cur.players)} players.`);
  L.push(`Win rates are from the tracked player's side. First pick ${pct(cur.firstPickWin)}, second pick ${pct(cur.secondPickWin)}.`);
  L.push("");
  L.push("Most played heroes (season)");
  [...cur.heroes].sort((a, b) => b.games - a.games).slice(0, 25).forEach((h, i) =>
    L.push(`${String(i + 1).padStart(2)}. ${h.name.padEnd(34)} ${fmt(h.games).padStart(8)} games  ${pct(h.win).padStart(6)} win  ${pct(h.pickBan).padStart(6)} pick/ban`));
  L.push("");
  L.push("Best trios (win rate, min 50 games)");
  cur.trios.forEach((t) => L.push(`- ${t.heroes.join(" + ")}: ${pct(t.win)} over ${fmt(t.games)} games`));
  L.push("");
  L.push("Best pairs");
  cur.synergies.forEach((t) => L.push(`- ${t.heroes.join(" + ")}: ${pct(t.win)} over ${fmt(t.games)} games${t.firstPick ? ` (first pick ${pct(t.firstPick.win)}, second pick ${pct(t.secondPick?.win)})` : ""}`));
  L.push("");
  L.push("Most pre-banned pairs");
  cur.prebanPairs.slice(0, 10).forEach((t) => L.push(`- ${t.heroes.join(" + ")}: ${fmt(t.games)} games`));
  if (cur.movers) {
    L.push("");
    L.push(`Movers ${cur.movers.from} to ${cur.movers.to} (dashboard's own week-over-week)`);
    for (const [label, list] of [["Win rate up", cur.movers.winRising], ["Win rate down", cur.movers.winFalling], ["Pick rate up", cur.movers.pickRising], ["Pick rate down", cur.movers.pickFalling]] as const)
      L.push(`${label}: ${list.map((m) => `${m.name} ${m.change > 0 ? "+" : ""}${m.change.toFixed(1)}`).join(", ") || "-"}`);
  }
  if (prev) {
    const w = heroWindowStats(prev, cur);
    L.push("");
    L.push(`Since the previous export (${prev.generatedAt.slice(0, 10)}): ${fmt(cur.matches - prev.matches)} new matches`);
    w.slice(0, 25).forEach((h, i) => L.push(`${String(i + 1).padStart(2)}. ${h.name.padEnd(34)} ${fmt(h.games).padStart(7)} games  ${pct(h.win).padStart(6)} win (season ${pct(h.seasonWin)})`));
  }
  if (cur.unmatched.length) {
    L.push("");
    L.push(`Names not matched to hero data: ${cur.unmatched.join(", ")}`);
  }
  return L.join("\n") + "\n";
}
