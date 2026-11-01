// Live-capture conversion: turns the decoder's raw `getItems` response
// (game-internal field names) into Fribbels-format {items, heroes}, then
// merges it into the current account. Field mapping follows Fribbels'
// scanner.js (RexQian fork v1.12.9).
import { importFribbels } from "./importer";
import type { Account, Hero, Item } from "./types";

export const DEFAULT_DECODER_URL = "https://krivpfvxi0.execute-api.us-west-2.amazonaws.com/dev/getItems";
export const DEFAULT_CAPTURE_PORTS = [3333, 5222];

const STAT_BY_INGAME: Record<string, string> = {
  att_rate: "AttackPercent", max_hp_rate: "HealthPercent", def_rate: "DefensePercent", att: "Attack", max_hp: "Health",
  def: "Defense", speed: "Speed", res: "EffectResistancePercent", cri: "CriticalHitChancePercent",
  cri_dmg: "CriticalHitDamagePercent", acc: "EffectivenessPercent", coop: "DualAttackChancePercent",
};
const FLAT = new Set(["max_hp", "speed", "att", "def"]);
const RANK_BY_GRADE = ["Unknown", "Normal", "Good", "Rare", "Heroic", "Epic"];
const COUNT_BY_RANK: Record<string, number> = { Normal: 5, Good: 6, Rare: 7, Heroic: 8, Epic: 9 };
const OFFSET_BY_RANK: Record<string, number> = { Normal: 0, Good: 1, Rare: 2, Heroic: 3, Epic: 4 };
const GEAR_BY_TYPE: Record<string, string> = { weapon: "Weapon", helm: "Helmet", armor: "Armor", neck: "Necklace", ring: "Ring", boot: "Boots" };
const GEAR_BY_LETTER: Record<string, string> = { w: "Weapon", h: "Helmet", a: "Armor", n: "Necklace", r: "Ring", b: "Boots" };
const SET_BY_INGAME: Record<string, string> = {
  set_acc: "HitSet", set_att: "AttackSet", set_coop: "UnitySet", set_counter: "CounterSet", set_cri_dmg: "DestructionSet",
  set_cri: "CriticalSet", set_def: "DefenseSet", set_immune: "ImmunitySet", set_max_hp: "HealthSet", set_penetrate: "PenetrationSet",
  set_rage: "RageSet", set_res: "ResistSet", set_revenge: "RevengeSet", set_scar: "InjurySet", set_speed: "SpeedSet",
  set_vampire: "LifestealSet", set_shield: "ProtectionSet", set_torrent: "TorrentSet", set_revenant: "ReversalSet",
  set_riposte: "RiposteSet", set_chase: "PursuitSet", set_opener: "WarfareSet", set_weak: "WeakeningSet", set_might: "FervorSet",
};

const r10 = (x: number) => Math.round(x * 10) / 10;

export interface DecoderResponse { status: string; data?: any[]; units?: any[][] }

export function convertRawItem(raw: any): any | null {
  if (!raw || !raw.f || !Array.isArray(raw.op) || !raw.op.length) return null;
  const rank = RANK_BY_GRADE[raw.g] ?? "Unknown";
  let gear = raw.type ? GEAR_BY_TYPE[raw.type] : undefined;
  if (!gear && typeof raw.code === "string") { const base = raw.code.split("_")[0]; gear = GEAR_BY_LETTER[base[base.length - 1]]; }
  const set = SET_BY_INGAME[raw.f];
  if (!gear || !set || rank === "Unknown") return null;
  const [mType] = raw.op[0];
  const mainType = STAT_BY_INGAME[mType];
  let mainValue = FLAT.has(mType) ? raw.mainStatValue : r10((raw.mainStatValue ?? 0) * 100);
  if (mainValue == null || isNaN(mainValue)) mainValue = 0;
  const acc: Record<string, { value: number; rolls: number; modified: boolean }> = {};
  for (let i = 1; i < raw.op.length; i++) {
    const [t, v, annotation] = raw.op[i];
    const type = STAT_BY_INGAME[t];
    if (!type) continue;
    const value = FLAT.has(t) ? v : r10(v * 100);
    if (acc[type]) {
      acc[type].value += value;
      if (annotation === "c") acc[type].modified = true;
      else if (annotation !== "u") acc[type].rolls++;
    } else acc[type] = { value, rolls: 1, modified: false };
  }
  const count = Math.min(raw.op.length - 1, COUNT_BY_RANK[rank]);
  const enhance = Math.max((count - OFFSET_BY_RANK[rank]) * 3, 0);
  return {
    id: String(raw.id), ingameId: String(raw.id), gear, rank, set, name: raw.name ?? "Unknown", level: raw.level ?? 0, enhance,
    main: { type: mainType, value: mainValue },
    substats: Object.entries(acc).map(([type, a]) => ({ type, value: r10(a.value), rolls: a.rolls, modified: a.modified })),
    locked: !!raw.l, ingameEquippedId: raw.p ? String(raw.p) : null,
  };
}

export interface ScanConvertOptions {
  /** Ignore gear below this enhance level (Fribbels default 6). */
  minEnhance?: number;
  /** Minimum hero stars to import (5 or 6). Heroes wearing gear are always kept. */
  minStars?: number;
}

/** Decoder response -> Fribbels-format export usable by importFribbels(). */
export function convertDecoderResponse(resp: DecoderResponse, o: ScanConvertOptions = {}) {
  if (resp.status !== "SUCCESS") throw new Error("Decoder could not read the captured data. Re-open the screens in game and try again.");
  const items = (resp.data ?? []).map(convertRawItem).filter((x) => x && x.enhance >= (o.minEnhance ?? 0));
  // Several unit lists can be captured; the longest is the full roster.
  const units = (resp.units ?? []).reduce<any[]>((best, u) => (Array.isArray(u) && u.length > best.length ? u : best), []);
  const wearing = new Set(items.map((i: any) => i.ingameEquippedId).filter(Boolean));
  const byName = new Map<string, any>();
  for (const u of units) {
    if (!u?.name || u.id == null) continue;
    const stars = u.g ?? 0;
    const id = String(u.id);
    if (stars < (o.minStars ?? 5) && !wearing.has(id)) continue;
    const prev = byName.get(u.name);
    // keep the copy that wears gear, else the higher-starred one
    const score = (x: any) => (wearing.has(String(x.id)) ? 100 : 0) + (x.g ?? 0);
    if (!prev || score(u) > score(prev)) byName.set(u.name, u);
  }
  const heroes = [...byName.values()].map((u) => {
    const id = String(u.id);
    const equipment: Record<string, any> = {};
    for (const it of items) if (it.ingameEquippedId === id) equipment[it.gear] = it.id;
    return { id, name: u.name, stars: u.g, awaken: u.z, level: u.lv ?? u.level ?? u.l, equipment };
  });
  for (const it of items) it.equippedById = it.ingameEquippedId ?? null;
  return { items, heroes };
}

export interface MergeReport { added: number; updated: number; removed: number; heroesAdded: number; heroesUpdated: number }

/**
 * Merge a fresh scan into an existing account.
 * - Gear-only scans (no units) replace the item list and keep hero records, re-linking equipment by in-game ID.
 * - Hero scans add/update heroes by name; existing bonuses (artifact, imprint) entered by hand are kept.
 */
export function mergeScan(existing: Account | null, scan: { items: any[]; heroes: any[] }): { account: Account; report: MergeReport } {
  const { account: incoming } = importFribbels({ items: scan.items, heroes: scan.heroes }, "live-capture");
  const report: MergeReport = { added: 0, updated: 0, removed: 0, heroesAdded: 0, heroesUpdated: 0 };
  if (!existing) {
    report.added = incoming.items.length; report.heroesAdded = incoming.heroes.length;
    return { account: incoming, report };
  }
  const oldIds = new Set(existing.items.map((i) => i.id));
  const items: Item[] = incoming.items.length ? incoming.items : existing.items;
  if (incoming.items.length) {
    for (const it of items) { if (oldIds.has(it.id)) report.updated++; else report.added++; }
    const newIds = new Set(items.map((i) => i.id));
    report.removed = existing.items.filter((i) => !newIds.has(i.id)).length;
  }
  const heroes: Hero[] = existing.heroes.map((h) => ({ ...h, equipment: { ...h.equipment } }));
  const byName = new Map(heroes.map((h) => [h.name, h]));
  const idRemap = new Map<string, string>(); // in-game hero id -> local hero id
  for (const nh of incoming.heroes) {
    const old = byName.get(nh.name);
    if (old) {
      old.stars = nh.stars ?? old.stars;
      old.level = nh.level ?? old.level;
      old.awaken = nh.awaken ?? old.awaken;
      idRemap.set(nh.id, old.id);
      report.heroesUpdated++;
    } else {
      heroes.push(nh);
      byName.set(nh.name, nh);
      idRemap.set(nh.id, nh.id);
      report.heroesAdded++;
    }
  }
  // Re-link equipment. In-game equipped IDs win; otherwise keep the previous assignment if the item still exists.
  const hasIngameLinks = items.some((i) => i.ingameEquippedId);
  if (incoming.items.length || (incoming.heroes.length && hasIngameLinks)) {
    const rawEquip = new Map<string, string | null>(items.map((i) => [i.id, i.ingameEquippedId ?? null]));
    const itemIds = new Set(items.map((i) => i.id));
    const prevOwner = new Map<string, string>();
    for (const h of heroes) for (const id of Object.values(h.equipment)) if (id) prevOwner.set(id, h.id);
    for (const h of heroes) h.equipment = {};
    for (const it of items) {
      const ig = rawEquip.get(it.id) ?? null;
      const prev = prevOwner.get(it.id) ?? null;
      let target: string | null;
      if (incoming.items.length) {
        // Fresh gear scan: the game is the source of truth (no id = unequipped),
        // except when the wearer simply wasn't part of this scan.
        target = ig ? idRemap.get(ig) ?? prev : null;
      } else {
        // Hero-only scan: use stored in-game links, else keep what we had.
        target = ig ? idRemap.get(ig) ?? prev : prev;
      }
      it.equippedById = target;
      if (target) { const h = heroes.find((x) => x.id === target); if (h) h.equipment[it.gear] = it.id; }
    }
    void itemIds;
  }
  return { account: { heroes, items, importedAt: new Date().toISOString(), source: "live-capture" }, report };
}
