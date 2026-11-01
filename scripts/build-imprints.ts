// Usage: tsx scripts/build-imprints.ts scripts/cache/epic7db-imprints.json data/imprints.json
// The input is the raw scrape of epic7db hero pages ({ hero: { release: { position, grades: { SSS: "Attack 12.9%" } } } }).
import fs from "node:fs";
import { parseImprintText, type Grade, type ImprintData, type ImprintStat } from "../src/engine/imprint";

const [src, dest] = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync(src, "utf8")) as Record<string, Record<string, { position: string; grades: Record<string, string> }>>;
const out: Record<string, ImprintData> = {};
const skipped: string[] = [];
for (const [hero, rec] of Object.entries(raw)) {
  const data: ImprintData = {};
  for (const mode of ["release", "concentration"] as const) {
    const r = rec[mode];
    if (!r) continue;
    let stat: ImprintStat | undefined;
    for (const [g, text] of Object.entries(r.grades)) {
      const p = parseImprintText(text);
      if (!p) { skipped.push(`${hero} ${mode}: ${text}`); break; }
      stat ??= { stat: p.stat, label: p.label, grades: {}, ...(mode === "release" ? { position: r.position } : {}) };
      stat.grades[g as Grade] = p.value;
    }
    if (stat) data[mode] = stat;
  }
  if (data.release || data.concentration) out[hero] = data;
}
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`${Object.keys(out).length} heroes, ${skipped.length} unmodeled stats (e.g. ${skipped.slice(0, 3).join("; ")})`);
