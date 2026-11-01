// Usage: tsx scripts/build-tags.ts scripts/cache/epic7db-skills.json (scrape cache, not shipped)
import { readFileSync, writeFileSync } from "node:fs";
import { deriveTags } from "../src/engine/tagger";
const scrape = JSON.parse(readFileSync(process.argv[2], "utf8"));
const effects = JSON.parse(readFileSync("data/hero-effects.json", "utf8"));
const heroes = JSON.parse(readFileSync("data/herodata.json", "utf8"));
const out: Record<string, string[]> = {};
for (const name of Object.keys(heroes)) {
  out[name] = deriveTags({ effectCodes: effects[name], scraped: scrape[name]?.ok ? scrape[name].skills : [] });
}
writeFileSync("data/hero-tags.json", JSON.stringify(out));
const none = Object.entries(out).filter(([, t]) => !t.length).map(([k]) => k);
console.log("heroes", Object.keys(out).length, "untagged", none.length, none.slice(0, 20));
for (const n of ["Arbiter Vildred", "Ran", "Peira", "Tenebria", "Achates", "Krau", "Harsetti", "Nahkwol", "Senya", "Lisette", "Boss Arunka", "Ml Piera", "Belian", "Ruele of Light"]) console.log(n, out[n]?.join(","));
