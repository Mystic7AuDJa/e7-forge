// Import a saved E7 Analyzer meta dashboard PDF.
// Usage: npm run meta:import-e7analyzer -- "path/to/E7 Meta Dashboard.pdf"
// Needs pdftotext (poppler-utils). Writes data/meta-history/e7analyzer/<date>.json,
// updates its index.json and REPORT.txt.
//
// Before saving the PDF in the browser: leave the window on "Season Start -> Now"
// and "All Ranks", and click "show more" on Meta Hero Pool so every hero is in it.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { analyzerReport, parseAnalyzer, type AnalyzerSnapshot } from "../src/engine/e7analyzer";

const pdf = process.argv[2];
if (!pdf || !fs.existsSync(pdf)) throw new Error("Give the path to the saved dashboard PDF.");
const text = (mode: string) => execFileSync("pdftotext", [mode, pdf, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const heroes = Object.keys(JSON.parse(fs.readFileSync(path.join("data", "herodata.json"), "utf8")));
const snap = parseAnalyzer(text("-raw"), text("-layout"), heroes);

const dir = path.join("data", "meta-history", "e7analyzer");
fs.mkdirSync(dir, { recursive: true });
const indexFile = path.join(dir, "index.json");
const index: string[] = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : [];
const name = `${snap.generatedAt.slice(0, 10)}.json`;
fs.writeFileSync(path.join(dir, name), JSON.stringify(snap));
if (!index.includes(name)) index.push(name);
index.sort();
fs.writeFileSync(indexFile, JSON.stringify(index, null, 1) + "\n");
const prevName = index[index.indexOf(name) - 1];
const prev: AnalyzerSnapshot | null = prevName ? JSON.parse(fs.readFileSync(path.join(dir, prevName), "utf8")) : null;
fs.writeFileSync(path.join(dir, "REPORT.txt"), analyzerReport(snap, prev));
console.log(`Saved ${name}: ${snap.heroes.length} heroes, ${snap.pickSide.length} pick-side rows, ${snap.trios.length} trios, ${snap.synergies.length} pairs, ${snap.prebanPairs.length} preban pairs, ${snap.matches} matches${prev ? `; compared with ${prevName}` : ""}.`);
if (snap.unmatched.length) console.log(`Unmatched names: ${snap.unmatched.join(", ")}`);
