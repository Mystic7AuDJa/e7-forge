import { describe, expect, it } from "vitest";
import { CUT_OFF, heroWindowStats, nameResolver, parseAnalyzer, type AnalyzerSnapshot } from "../src/engine/e7analyzer";

const known = ["Lisette", "Lady of the Scales", "Shepherd of the Dark Diene", "Rhianna and Luciella", "Jack-O", "Aube", "Notos"];

const layout = `
 Analysis Window      FROM                TO           RANK
                      Season Start    →   Now          All Ranks
 Meta Hero Pool (click for deep dive)
     Lisette          Shepherd of t…        Jack-O'
     66.6%            62.6%                 51.5%
     30819 games      72874 games           103 games
     76.1% P/B        38.6% P/B             0% P/B
 Show less
`.replace(/^\n/, "");
const pool = Array.from({ length: 20 }, (_, i) => `     Lisette          Notos\n     50%              51%\n     ${100 + i} games        200 games\n     1% P/B           2% P/B`).join("\n");

const raw = `First Pick WR
57.6%
Second Pick WR
55.6%
Movers and Shifters 2026-10-26 → 2026-11-01
▲ RISING
Lisette 61.8% ▲ 5.0%
▼ FALLING
Notos 54.1% ▼ 6.5%
Hero Performance
Most Popular Preban Pairs
Combined First Pick Second Pick
Lisette + Lady of the Scales
56.6%
179285 games
Best Synergies
Min games: 50
Shepherd of the Dark Diene …
74.1%
3234 games
1st: 73.6% (2554)
2nd: 76% (680)
Best Trios
Min games: 50
Rhianna and
Luciella + Lisette + Aube
84%
94 games
Draft Position
Global 58.7% (187275 games)
Generated 2026-11-02T08:36:55Z | 660550 matches from 1788 players`;

describe("E7 Analyzer import", () => {
  it("resolves truncated and punctuated names", () => {
    const { resolve, unmatched } = nameResolver(known);
    expect(resolve("Shepherd of t…")).toBe("Shepherd of the Dark Diene");
    expect(resolve("Jack-O'")).toBe("Jack-O");
    expect(resolve("Nobody")).toBe("Nobody");
    expect([...unmatched]).toEqual(["Nobody"]);
  });
  it("parses the dashboard sections and drops nothing silently", () => {
    const s = parseAnalyzer(raw, layout.replace("Show less", pool + "\n Show less"), known);
    expect(s.window).toBe("Season Start -> Now, All Ranks");
    expect(s.matches).toBe(660550);
    expect(s.firstPickWin).toBe(57.6);
    expect(s.heroes[0]).toEqual({ name: "Lisette", win: 66.6, games: 30819, pickBan: 76.1 });
    expect(s.heroes[1].name).toBe("Shepherd of the Dark Diene");
    expect(s.prebanPairs[0]).toMatchObject({ heroes: ["Lisette", "Lady of the Scales"], games: 179285 });
    expect(s.synergies[0].heroes).toEqual(["Shepherd of the Dark Diene", CUT_OFF]);
    expect(s.synergies[0].firstPick).toEqual({ win: 73.6, games: 2554 });
    expect(s.trios[0].heroes).toEqual(["Rhianna and Luciella", "Lisette", "Aube"]);
    expect(s.movers?.winFalling[0]).toEqual({ name: "Notos", value: 54.1, change: -6.5 });
    expect(s.servers[0]).toEqual({ server: "Global", win: 58.7, games: 187275 });
  });
  it("rejects a page that isn't the dashboard", () => {
    expect(() => parseAnalyzer("hello", "", known)).toThrow(/Not an E7 Analyzer/);
  });
  it("turns two season-to-date exports into the games played between them", () => {
    const snap = (games: number, win: number) => ({ heroes: [{ name: "Lisette", games, win, pickBan: 0 }] }) as unknown as AnalyzerSnapshot;
    const [h] = heroWindowStats(snap(1000, 60), snap(1500, 62));
    expect(h.games).toBe(500);
    expect(h.win).toBe(66); // (930 - 600) / 500
  });
});

import { applyCorrections } from "../src/engine/e7analyzer";
describe("corrections", () => {
  it("fills a cut-off partner matched on hero, games and win rate", () => {
    const snap = { prebanPairs: [], trios: [], synergies: [{ heroes: ["Shepherd of the Dark Diene", CUT_OFF], win: 74.1, games: 3234 }, { heroes: ["Shepherd of the Dark Diene", CUT_OFF], win: 70.5, games: 244 }] } as unknown as AnalyzerSnapshot;
    expect(applyCorrections(snap, [{ section: "synergies", known: "Shepherd of the Dark Diene", games: 3234, win: 74.1, partner: "Lisette" }])).toBe(1);
    expect(snap.synergies[0].heroes).toEqual(["Shepherd of the Dark Diene", "Lisette"]);
    expect(snap.synergies[1].heroes[1]).toBe(CUT_OFF);
  });
});
