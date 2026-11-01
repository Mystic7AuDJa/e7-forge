// Weekly RTA meta snapshot. Usage: npx tsx scripts/meta-snapshot.mts [saved-page.html]
// Writes data/meta-history/<end-date>.json, updates index.json and TRENDS.txt.
// One request to epic7rtastats.com/meta per run; skips the write if that week is already saved.
import fs from "node:fs";
import path from "node:path";
import { parseMetaSnapshot, trendReport, type MetaSnapshot } from "../src/engine/metaHistory";

const dir = path.join(process.cwd(), "data", "meta-history");
fs.mkdirSync(dir, { recursive: true });

async function load(): Promise<string> {
  const file = process.argv[2];
  if (file) return fs.readFileSync(file, "utf8");
  const res = await fetch("https://www.epic7rtastats.com/meta", { headers: { "User-Agent": "e7-forge meta snapshot (weekly, github.com/Mystic7AuDJa/e7-forge)" } });
  if (!res.ok) throw new Error(`epic7rtastats.com/meta returned HTTP ${res.status}`);
  return res.text();
}

const snap = parseMetaSnapshot(await load());
if (!snap.end) throw new Error("Meta page has no date window; layout may have changed");
const indexFile = path.join(dir, "index.json");
const index: string[] = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : [];
const name = `${snap.end}.json`;
if (index.includes(name)) {
  console.log(`Week ending ${snap.end} already saved; nothing to do.`);
  process.exit(0);
}
fs.writeFileSync(path.join(dir, name), JSON.stringify(snap));
index.push(name);
index.sort();
fs.writeFileSync(indexFile, JSON.stringify(index, null, 1) + "\n");

const prevName = index[index.indexOf(name) - 1];
const prev: MetaSnapshot | null = prevName ? JSON.parse(fs.readFileSync(path.join(dir, prevName), "utf8")) : null;
fs.writeFileSync(path.join(dir, "TRENDS.txt"), trendReport(snap, prev));
console.log(`Saved ${name} (${snap.picked.length} heroes, ${snap.prebannedPairs.length} pairs, ~${snap.games} games)${prev ? `, compared with ${prevName}` : ""}.`);
