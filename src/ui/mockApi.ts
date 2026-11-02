/// <reference types="vite/client" />
// Browser preview backend: same engine, no Electron. Live capture is simulated
// (it can't sniff from a browser), everything else runs for real on the sample export.
import herodata from "../../data/herodata.json";
import heroTags from "../../data/hero-tags.json";
import imprintsJson from "../../data/imprints.json";
import artifactJson from "../../data/artifactdata.json";
import artifactDict from "../../data/artifact-dictionary.json";
import sample from "../../data/sample-fribbels-export.json";
import { buildHeroDb, findHeroData } from "../engine/data";
import { importFribbels } from "../engine/importer";
import { currentBuildStats, optimizeHero } from "../engine/optimizer";
import { optimizeAccount } from "../engine/account";
import { recommend } from "../engine/recommend";
import { buildTeams, candidatesFrom, planTeam } from "../engine/teams";
import { editItem, upgradeQueue } from "../engine/roi";
import { counterTeams, estimateEnemy } from "../engine/counters";
import { parseRtaMeta } from "../engine/meta";
import { mapCamping } from "../engine/camping";
import tiersJson from "../../data/epic7db-tiers.json";
import presetsJson from "../../data/pve-presets.json";
import topicsJson from "../../data/camping-topics.json";
import { preferredSnapshot } from "../engine/e7analyzer";
import { removeItem } from "../engine/inventory";
import analyzerIndex from "../../data/meta-history/e7analyzer/index.json";
import weekIndex from "../../data/meta-history/index.json";
import { DEFAULT_CAPTURE_PORTS, DEFAULT_DECODER_URL } from "../engine/scan";
import type { Account, Hero } from "../engine/types";
import type { ForgeApi, Settings } from "./api";

export function createMockApi(): ForgeApi {
  const db = buildHeroDb(herodata as any, heroTags as any, imprintsJson as any);
  const hdOf = (h: Hero) => findHeroData(db, h.dataKey || h.name);
  let account: Account | null = importFribbels(sample, "sample-fribbels-export.json").account;
  let settings: Settings = {
    capture: { pythonPath: "", ports: DEFAULT_CAPTURE_PORTS, decoderUrl: DEFAULT_DECODER_URL, autoSync: true, minBytes: 100000, idleMs: 4000, iface: "", minEnhance: 0, minStars: 5, autoOffMinutes: 10, minAutoIntervalSec: 20 },
    penDefense: 1500, enemySpeed: [220, 290], speedRng: 0.05,
  };
  const listeners = new Map<string, Set<(p: any) => void>>();
  const emit = (c: string, p: any) => listeners.get(c)?.forEach((f) => f(p));
  const need = () => { if (!account) throw new Error("No account loaded"); return account; };
  const later = <T,>(f: () => T) => new Promise<T>((res, rej) => setTimeout(() => { try { res(f()); } catch (e) { rej(e); } }, 10));
  let captureOn = false;

  return {
    init: async () => ({
      version: "0.1.0-preview", workers: 1, runtime: { electron: "preview", chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? "?", node: "n/a" }, platform: "browser", settings, account,
      gameData: { herodata: herodata as any, tags: heroTags as any, imprints: imprintsJson as any, artifacts: artifactJson as any, artifactInfo: artifactDict.artifacts as any, source: "bundled (RexQian fork v1.12.9-offline)", heroCount: Object.keys(herodata).length },
      capture: { state: "off", error: null },
    }),
    setSettings: async (s) => (settings = { ...settings, ...s, capture: { ...settings.capture, ...(s.capture ?? {}) } }),
    importFile: async () => { throw new Error("File dialogs need the desktop app. Paste JSON instead."); },
    importText: async (text) => { const r = importFribbels(text, "pasted"); account = r.account; emit("account:changed", {}); return r.report; },
    exportFile: async () => null,
    updateHero: async ({ heroId, bonuses, imprint }) => { const h = need().heroes.find((x) => x.id === heroId)!; h.bonuses = { ...h.bonuses, ...bonuses }; if (imprint !== undefined) { if (imprint) h.imprint = imprint; else delete h.imprint; } emit("account:changed", {}); return h; },
    updateItem: async ({ itemId, enhance, substats, level, mainValue }) => {
      const acc = need(); const i = acc.items.findIndex((x) => x.id === itemId);
      if (i < 0) return null;
      acc.items[i] = editItem(acc.items[i], { enhance, substats, level, mainValue }); emit("account:changed", {}); return acc.items[i];
    },
    deleteItem: async ({ itemId }) => { const ok = removeItem(need(), itemId); if (ok) emit("account:changed", {}); return ok; },
    applyBuilds: async (builds) => {
      const acc = need();
      for (const b of builds) { const h = acc.heroes.find((x) => x.id === b.heroId)!; for (const [s, id] of Object.entries(b.items)) { for (const o of acc.heroes) if (o.equipment[s as keyof Hero["equipment"]] === id) delete o.equipment[s as keyof Hero["equipment"]]; (h.equipment as any)[s] = id; const it = acc.items.find((i) => i.id === id); if (it) it.equippedById = h.id; } }
      emit("account:changed", {}); return true;
    },
    addHero: async () => true,
    snapshots: async () => [{ id: 1, at: account?.importedAt, source: "sample", heroes: account?.heroes.length, items: account?.items.length, avgGs: 0 }],
    restoreSnapshot: async () => true,
    captureDiagnostics: async () => ({ python: null, pythonVersion: null, scapy: null, npcap: null, platform: "browser", admin: null }),
    installScapy: async () => ({ ok: false, output: "Desktop app only" }),
    captureStart: async () => {
      captureOn = true;
      emit("capture:status", { state: "starting" });
      setTimeout(() => captureOn && emit("capture:status", { state: "listening", ifaces: ["preview"] }), 500);
      let b = 0;
      const t = setInterval(() => { if (!captureOn) return clearInterval(t); b += 40000 + Math.random() * 30000; emit("capture:activity", { bytes: Math.round(b), packets: Math.round(b / 1200), streams: 3 }); }, 1000);
      return "starting";
    },
    captureStop: async () => { captureOn = false; emit("capture:status", { state: "off" }); return "off"; },
    captureSync: async () => {
      emit("capture:status", { state: "decoding" });
      setTimeout(() => {
        emit("capture:syncError", { trigger: "manual", error: "Preview mode: Live Sync needs the desktop app (Npcap + Python)." });
        emit("capture:status", { state: captureOn ? "listening" : "off" });
      }, 700);
      return true;
    },
    optimize: (p) => later(() => {
      const acc = need(); const h = acc.heroes.find((x) => x.id === p.request.heroId)!;
      return { ...optimizeHero(h, hdOf(h)!, acc.items, p.request, { timeLimitMs: 15000, mode: p.mode }), workers: 1 };
    }),
    optimizeAccount: (p) => later(() => optimizeAccount(need().heroes, hdOf, need().items, p.request, { timeLimitMs: 5000 })),
    recommend: (p) => later(() => {
      const acc = need(); const h = acc.heroes.find((x) => x.id === p.heroId)!;
      return recommend({ hero: h, hd: hdOf(h)!, items: acc.items, roster: acc.heroes.map((x) => ({ hero: x, spd: p.rosterSpeeds?.[x.id] ?? 0 })), community: p.community, enemySpeed: p.enemySpeed, allowEquipped: p.allowEquipped, options: { timeLimitMs: 6000 } });
    }),
    teams: (p) => later(() => buildTeams(candidatesFrom(need().heroes, hdOf, need().items), p.content, p.options).map((t) => ({ heroIds: t.members.map((m) => m.hero.id), archetypes: t.members.map((m) => m.archetype), report: t.report }))),
    planTeam: (p) => later(() => {
      const c = candidatesFrom(need().heroes.filter((h) => p.heroIds.includes(h.id)), hdOf, need().items);
      return planTeam(p.heroIds.map((id: string) => c.find((x) => x.hero.id === id)!), need().items, hdOf, { timeLimitMs: 4000 }, p.allowEquipped ?? true, p.minSpeed ?? {});
    }),
    counters: (p) => later(() => {
      const estimates = p.enemies.map((e: any) => estimateEnemy(e.name, findHeroData(db, e.name), e.builds ?? [], e.band));
      const { threats, teams } = counterTeams(candidatesFrom(need().heroes, hdOf, need().items), estimates, p.mode, { top: 5, mustInclude: p.mustInclude });
      return { estimates: estimates.map(({ hd, ...e }: any) => ({ ...e, tags: hd?.tags ?? [], attribute: hd?.attribute, role: hd?.role })), threats, teams };
    }),
    upgradeQueue: (p) => later(() => upgradeQueue(need().items, p.options ?? {}, p.max ?? 150).map((x) => ({ itemId: x.item.id, f: x.f }))),
    community: async ({ hero }) => {
      // Preview only: synthetic builds around the hero's current stats (the desktop app fetches real ones).
      const h = need().heroes.find((x) => x.name === hero);
      const d = h ? hdOf(h)! : findHeroData(db, hero);
      if (!d) throw new Error("Unknown hero");
      const base = h ? currentBuildStats(h, d, need().items).stats
        : { atk: d.base.atk * 2.6, hp: d.base.hp * 2.2, def: d.base.def * 1.7, spd: d.base.spd * 1.85, cr: 85, cd: 240, eff: 60, res: 60, gs: 380 } as any;
      let seed = 7; const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
      const builds = Array.from({ length: 600 }, () => {
        const q = 0.85 + r() * 0.35;
        return { atk: Math.round(base.atk * q), hp: Math.round(base.hp * q), def: Math.round(base.def * q), spd: Math.round(base.spd * (0.9 + r() * 0.3)),
          chc: Math.min(100, Math.round(base.cr * q)), chd: Math.round(base.cd * q), eff: Math.round(base.eff * q), efr: Math.round(base.res * q), gs: Math.round(base.gs * q),
          sets: (r() > 0.4 ? { set_speed: "4", set_cri: "2" } : { set_cri_dmg: "4", set_cri: "2" }) as Record<string, string> };
      });
      return { fetchedAt: new Date().toISOString(), builds, cached: true };
    },
    meta: async () => {
      const errors: string[] = [];
      let rta: any = null, camping: any = null;
      try { const r = await fetch("https://www.epic7rtastats.com/meta"); rta = parseRtaMeta(await r.text()); } catch (e: any) { errors.push(`RTA stats: ${e.message}`); }
      try {
        const [c, h] = await Promise.all([fetch("https://ceciliabot.github.io/data/CampingData.json").then((r) => r.json()), fetch("https://ceciliabot.github.io/data/HeroDatabase.json").then((r) => r.json())]);
        camping = { fetchedAt: new Date().toISOString(), heroes: mapCamping(c, h, [...db.keys()]) };
      } catch (e: any) { errors.push(`Camping data: ${e.message}`); }
      const analyzerFiles = import.meta.glob("../../data/meta-history/e7analyzer/20*.json", { eager: true, import: "default" });
      const weekFiles = import.meta.glob("../../data/meta-history/20*.json", { eager: true, import: "default" });
      const analyzer: any = analyzerFiles[`../../data/meta-history/e7analyzer/${preferredSnapshot(analyzerIndex as string[])}`] ?? null;
      const week: any = weekFiles[`../../data/meta-history/${(weekIndex as string[]).at(-1)}`] ?? null;
      return { tiers: tiersJson as any, presets: presetsJson, campingTopics: topicsJson as any, rta, camping, analyzer, week, errors };
    },
    updateData: async () => { throw new Error("Desktop app only"); },
    refreshTags: async () => ({}),
    openExternal: async (url) => { window.open(url, "_blank"); },
    on: (c, cb) => { if (!listeners.has(c)) listeners.set(c, new Set()); listeners.get(c)!.add(cb); return () => listeners.get(c)!.delete(cb); },
  };
}
