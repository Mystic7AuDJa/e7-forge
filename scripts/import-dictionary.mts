// Import the Artifacts tab of the slendy.gg E7 Dictionary, saved as a PDF.
// Usage: npm run data:import-artifacts -- "path/to/E7 Dictionary artis.pdf"
// Needs pdftotext (poppler-utils). Writes data/artifact-dictionary.json.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArtifactDictionary } from "../src/engine/dictionary";

const pdf = process.argv[2];
if (!pdf || !fs.existsSync(pdf)) throw new Error("Give the path to the saved Artifacts PDF.");
const raw = execFileSync("pdftotext", ["-raw", pdf, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const names = Object.values(JSON.parse(fs.readFileSync(path.join("data", "artifactdata.json"), "utf8")) as Record<string, { name: string }>).map((a) => a.name);
const { dict, unknown } = parseArtifactDictionary(raw, names);
fs.writeFileSync(path.join("data", "artifact-dictionary.json"), JSON.stringify(dict, null, 1) + "\n");
const counts: Record<string, number> = {};
for (const a of Object.values(dict.artifacts)) counts[a.class] = (counts[a.class] ?? 0) + 1;
console.log(`Saved ${Object.keys(dict.artifacts).length} artifacts (game data ${dict.gameData}): ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
if (unknown.length) console.log(`Not in artifactdata.json (new or renamed): ${unknown.join(", ")}`);
