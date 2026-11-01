// Imports Fribbels optimizer saves / scanner exports ({heroes, items}).
// The RexQian fork (v1.12.x-offline) writes the identical format.
import { gearScore, estimateRolls } from "./gear";
import { GEAR_SLOTS, STAT_TYPES, type Account, type GearSlot, type Hero, type HeroBonuses, type Item, type Rank, type StatType } from "./types";
import type { HeroImprint } from "./imprint";

const num = (v: unknown, d = 0) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(+v) ? +v : d);

const RANKS: Rank[] = ["Normal", "Good", "Rare", "Heroic", "Epic"];

export interface ImportReport { heroes: number; items: number; skippedItems: number; warnings: string[] }

function normStat(t: unknown): StatType | null {
  if (typeof t !== "string") return null;
  return (STAT_TYPES as string[]).includes(t) ? (t as StatType) : null;
}

export function normalizeItem(raw: any, warnings: string[]): Item | null {
  if (!raw || typeof raw !== "object") return null;
  const gear = raw.gear as GearSlot;
  if (!GEAR_SLOTS.includes(gear)) return null;
  const mainType = normStat(raw.main?.type);
  if (!mainType) return null;
  const rank = (RANKS.includes(raw.rank) ? raw.rank : "Epic") as Rank;
  const substats = (Array.isArray(raw.substats) ? raw.substats : [])
    .map((s: any) => ({ type: normStat(s?.type), value: num(s?.value), modified: !!s?.modified }))
    .filter((s: any) => s.type && s.value > 0) as Item["substats"];
  const item: Item = {
    id: String(raw.id ?? raw.ingameId ?? cryptoId()),
    gear, rank,
    set: String(raw.set ?? "Unknown"),
    level: num(raw.level, 85),
    enhance: num(raw.enhance, 0),
    main: { type: mainType, value: num(raw.main?.value) },
    substats,
    name: raw.name,
    locked: !!raw.locked,
    equippedById: raw.equippedById ? String(raw.equippedById) : null,
    ingameEquippedId: raw.ingameEquippedId ? String(raw.ingameEquippedId) : null,
  };
  if (substats.length !== (raw.substats?.length ?? 0)) warnings.push(`Item ${item.id}: dropped unknown substat types`);
  estimateRolls(item);
  item.gs = gearScore(item.substats);
  return item;
}

// Fribbels saves the self imprint as a number ("21.0") and already folds it into
// the aei* bonus fields, so it's marked inBonuses to avoid counting it twice.
// The grade is worked out later from the value (see gradeForValue).
function importedImprint(h: any): HeroImprint | undefined {
  if (h.imprint?.mode) return h.imprint as HeroImprint;
  const v = parseFloat(h.imprintNumber);
  if (!isFinite(v) || v <= 0) return undefined;
  return { grade: null, value: v, mode: "concentration", source: "import", inBonuses: true };
}

function bonusesFrom(h: any): HeroBonuses {
  return {
    atk: num(h.bonusAtk) + num(h.aeiAtk) + num(h.artifactAttack),
    hp: num(h.bonusHp) + num(h.aeiHp) + num(h.artifactHealth),
    def: num(h.bonusDef) + num(h.aeiDef) + num(h.artifactDefense),
    atkPct: num(h.bonusAtkPercent) + num(h.aeiAtkPercent),
    hpPct: num(h.bonusHpPercent) + num(h.aeiHpPercent),
    defPct: num(h.bonusDefPercent) + num(h.aeiDefPercent),
    spd: num(h.bonusSpeed) + num(h.aeiSpeed),
    cr: num(h.bonusCr) + num(h.aeiCr),
    cd: num(h.bonusCd) + num(h.aeiCd),
    eff: num(h.bonusEff) + num(h.aeiEff),
    res: num(h.bonusRes) + num(h.aeiRes),
    finalAtkMult: num(h.finalAtkMultiplier), finalHpMult: num(h.finalHpMultiplier), finalDefMult: num(h.finalDefMultiplier),
  };
}

export function importFribbels(json: unknown, source = "fribbels"): { account: Account; report: ImportReport } {
  const warnings: string[] = [];
  const data: any = typeof json === "string" ? JSON.parse(json) : json;
  if (!data || typeof data !== "object") throw new Error("Not a JSON object");
  const rawItems: any[] = Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : [];
  const rawHeroes: any[] = Array.isArray(data.heroes) ? data.heroes : [];
  if (!rawItems.length && !rawHeroes.length) throw new Error("No heroes or items found. Expected a Fribbels save/export with {heroes, items}.");

  const items: Item[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  const pushItem = (raw: any) => {
    const it = normalizeItem(raw, warnings);
    if (!it) { skipped++; return null; }
    if (seen.has(it.id)) return items.find((x) => x.id === it.id) ?? null;
    seen.add(it.id);
    items.push(it);
    return it;
  };
  rawItems.forEach(pushItem);

  const heroes: Hero[] = rawHeroes.map((h: any, i: number) => {
    const id = String(h.id ?? `hero-${i}`);
    const equipment: Hero["equipment"] = {};
    for (const slot of GEAR_SLOTS) {
      const eq = h.equipment?.[slot];
      if (!eq) continue;
      const ref = typeof eq === "string" ? items.find((x) => x.id === eq) : pushItem(eq);
      if (ref) { equipment[slot] = ref.id; ref.equippedById = id; }
    }
    return {
      id, name: String(h.name ?? "Unknown"), dataKey: String(h.name ?? ""),
      rarity: num(h.rarity, 5), attribute: String(h.attribute ?? ""), role: String(h.role ?? ""),
      stars: h.stars ? num(h.stars) : undefined,
      level: num(h.level ?? h.lv, 0) || undefined,
      awaken: h.awaken != null ? num(h.awaken) : undefined,
      bonuses: bonusesFrom(h), equipment, artifactName: h.artifactName,
      ...(importedImprint(h) ? { imprint: importedImprint(h) } : {}),
    };
  });

  // Reconcile equippedById pointers that reference unknown heroes.
  const heroIds = new Set(heroes.map((h) => h.id));
  for (const it of items) if (it.equippedById && !heroIds.has(it.equippedById)) it.equippedById = null;

  return {
    account: { heroes, items, importedAt: new Date().toISOString(), source },
    report: { heroes: heroes.length, items: items.length, skippedItems: skipped, warnings: warnings.slice(0, 50) },
  };
}

function cryptoId() {
  return "x" + Math.random().toString(36).slice(2, 12);
}
