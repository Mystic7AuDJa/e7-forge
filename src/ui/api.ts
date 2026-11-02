// Renderer-side API. In Electron this is window.forge (preload). When opened
// in a plain browser (preview/dev), a mock backed by the same engine is used.
import type { Account, Build } from "../engine/types";
import type { ArtifactInfo } from "../engine/dictionary";

export interface Settings {
  capture: {
    pythonPath: string; ports: number[]; decoderUrl: string; autoSync: boolean; minBytes: number; idleMs: number;
    iface: string; minEnhance: number; minStars: number; autoOffMinutes: number; minAutoIntervalSec: number;
  };
  penDefense: number; enemySpeed: [number, number]; speedRng: number;
}

export interface InitData {
  version: string; workers: number; platform: string; killedPrior?: string[]; runtime?: { electron: string; chrome: string; node: string }; settings: Settings; account: Account | null;
  gameData: { herodata: Record<string, any>; tags: Record<string, string[]>; imprints?: Record<string, any>; /** Keyed by artifact name. */ artifacts?: Record<string, { code: string; name: string }>; artifactInfo?: Record<string, ArtifactInfo>; source: string; heroCount: number };
  capture: { state: string; error: string | null };
}

export interface ForgeApi {
  init(): Promise<InitData>;
  setSettings(s: Partial<Settings>): Promise<Settings>;
  importFile(): Promise<any>;
  importText(text: string): Promise<any>;
  exportFile(): Promise<string | null>;
  updateHero(a: { heroId: string; bonuses?: any; dataKey?: string; imprint?: import("../engine/imprint").HeroImprint | null }): Promise<any>;
  applyBuilds(b: Build[]): Promise<any>;
  /** Removes the item from E7 Forge (not from the game) and unequips it. */
  deleteItem(a: { itemId: string }): Promise<boolean>;
  updateItem(a: { itemId: string; enhance?: number; substats?: import("../engine/types").Substat[] }): Promise<import("../engine/types").Item | null>;
  addHero(name: string): Promise<any>;
  snapshots(): Promise<any[]>;
  restoreSnapshot(id: number): Promise<boolean>;
  captureDiagnostics(): Promise<any>;
  installScapy(): Promise<{ ok: boolean; output: string }>;
  captureStart(): Promise<string>;
  captureStop(): Promise<string>;
  captureSync(): Promise<boolean>;
  optimize(p: any): Promise<any>;
  optimizeAccount(p: any): Promise<any>;
  recommend(p: any): Promise<any>;
  teams(p: any): Promise<any>;
  planTeam(p: any): Promise<any>;
  upgradeQueue(p: any): Promise<any>;
  counters(p: any): Promise<any>;
  meta(p?: { refresh?: boolean }): Promise<MetaBundle>;
  community(p: { hero: string; refresh?: boolean }): Promise<{ fetchedAt: string; builds: any[]; cached: boolean; stale?: boolean }>;
  updateData(): Promise<any>;
  refreshTags(names: string[]): Promise<Record<string, string[]>>;
  openExternal(url: string): Promise<void>;
  on(channel: string, cb: (p: any) => void): () => void;
}

declare global { interface Window { forge?: ForgeApi } }

let apiPromise: Promise<ForgeApi> | null = null;
export interface MetaBundle {
  tiers: import("../engine/meta").TierFile;
  presets: any;
  campingTopics: import("../engine/camping").TopicRow[];
  rta: import("../engine/meta").RtaMeta | null;
  camping: { fetchedAt: string; heroes: Record<string, import("../engine/camping").HeroCamp> } | null;
  analyzer: import("../engine/e7analyzer").AnalyzerSnapshot | null;
  week: import("../engine/metaHistory").MetaSnapshot | null;
  errors: string[];
}

export function getApi(): Promise<ForgeApi> {
  if (!apiPromise) apiPromise = window.forge ? Promise.resolve(window.forge) : import("./mockApi").then((m) => m.createMockApi());
  return apiPromise;
}
