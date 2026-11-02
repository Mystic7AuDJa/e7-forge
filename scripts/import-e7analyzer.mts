// Import a saved E7 Analyzer meta dashboard PDF.
// Usage: npm run meta:import-e7analyzer -- "path/to/E7 Meta Dashboard.pdf"
// Needs pdftotext (poppler-utils). Writes data/meta-history/e7analyzer/<date>.json,
// updates its index.json and REPORT.txt.
//
// Before saving the PDF in the browser: leave the window on "Season Start -> Now",
// pick the rank (Champion+ is what the draft assistant prefers), click "show more"
// on both hero pools and "Expand as Table" on Hero Performance and every Draft
// Position card.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { analyzerReport, applyCorrections, parseAnalyzer, sameWindow, snapshotFile, type AnalyzerSnapshot, type Correction } from "../src/engine/e7analyzer";

const pdf = process.argv[2];
if (!pdf || !fs.existsSync(pdf)) throw new Error("Give the path to the saved dashboard PDF.");
const text = (mode: string) => execFileSync("pdftotext", [mode, pdf, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const heroes = Object.keys(JSON.parse(fs.readFileSync(path.join("data", "herodata.json"), "utf8")));
const snap = parseAnalyzer(text("-raw"), text("-layout"), heroes);

const dir = path.join("data", "meta-history", "e7analyzer");
fs.mkdirSync(dir, { recursive: true });
// Names cut off in an export ("Shepherd of the Dark Diene …") and confirmed by hand on the dashboard.
const fixFile = path.join(dir, "corrections.json");
const fixed = fs.existsSync(fixFile) ? applyCorrections(snap, JSON.parse(fs.readFileSync(fixFile, "utf8")) as Correction[]) : 0;
const indexFile = path.join(dir, "index.json");
const index: string[] = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : [];
const name = snapshotFile(snap);
fs.writeFileSync(path.join(dir, name), JSON.stringify(snap));
if (!index.includes(name)) index.push(name);
index.sort();
fs.writeFileSync(indexFile, JSON.stringify(index, null, 1) + "\n");
// Compare only with an earlier export of the same filter; season totals for different ranks can't be subtracted.
const load = (f: string): AnalyzerSnapshot => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const prevName = index.slice(0, index.indexOf(name)).reverse().find((f) => sameWindow(load(f), snap));
const prev = prevName ? load(prevName) : null;
fs.writeFileSync(path.join(dir, "REPORT.txt"), analyzerReport(snap, prev));
console.log(`Saved ${name}: ${snap.heroes.length} heroes, ${snap.pickSide.length} pick-side rows, ${snap.trios.length} trios, ${snap.synergies.length} pairs, ${snap.prebanPairs.length} preban pairs, ${snap.matches} matches (${snap.window})${snap.draftSlots ? ", draft-position tables" : ""}${snap.performance ? ", performance tables" : ""}${prev ? `; compared with ${prevName}` : ""}.`);
if (fixed) console.log(`Filled ${fixed} cut-off name(s) from corrections.json.`);
const stillCut = [...snap.prebanPairs, ...snap.synergies, ...snap.trios].filter((c) => c.heroes.some((h) => h.startsWith("(cut off")));
if (stillCut.length) console.log(`Still cut off (add to corrections.json): ${stillCut.map((c) => `${c.heroes.join(" + ")} ${c.win}% / ${c.games} games`).join("; ")}`);
if (snap.unmatched.length) console.log(`Unmatched names: ${snap.unmatched.join(", ")}`);
