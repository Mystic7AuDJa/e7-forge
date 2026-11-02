import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { importFribbels } from "../src/engine/importer";
import { mergeScan, DEFAULT_CAPTURE_PORTS, DEFAULT_DECODER_URL } from "../src/engine/scan";
import { parseRtaMeta } from "../src/engine/meta";
import { parseMetaSnapshot } from "../src/engine/metaHistory";
import { editItem } from "../src/engine/roi";
import { mapCamping } from "../src/engine/camping";
import { deriveTags, epic7dbSlug, parseEpic7dbHeroPage } from "../src/engine/tagger";
import type { Account, Build, GearSlot } from "../src/engine/types";
import { CaptureService, type CaptureSettings } from "./capture";
import { Store } from "./store";
import { SessionGuard } from "./singleton";

const isDev = !!process.env.VITE_DEV;
// Smoke-test mode (CI/dev only): isolated profile, scripted run, screenshot, exit.
const SMOKE = process.env.E7FORGE_SMOKE_DIR;
if (SMOKE) app.setPath("userData", path.join(SMOKE, "profile"));

// Stop any previous E7 Forge session (and its sniffer) before this one starts.
const guard = new SessionGuard(app.getPath("userData"), process.execPath, app.isPackaged);
const killedPrior = guard.killPrior();
if (killedPrior.length) console.log("Stopped prior E7 Forge resources:", killedPrior.join(", "));
const appRoot = app.getAppPath();
const unpacked = (p: string) => (app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked", p) : path.join(appRoot, p));
const bundledData = unpacked("data");
const userData = app.getPath("userData");
const userDataDir = path.join(userData, "data");

interface Settings {
  capture: CaptureSettings;
  penDefense: number;
  enemySpeed: [number, number];
  speedRng: number;
}
const DEFAULT_SETTINGS: Settings = {
  capture: {
    pythonPath: "", ports: DEFAULT_CAPTURE_PORTS, decoderUrl: DEFAULT_DECODER_URL, autoSync: true,
    minBytes: 100_000, idleMs: 4000, iface: "", minEnhance: 0, minStars: 5, autoOffMinutes: 10, minAutoIntervalSec: 20,
  },
  penDefense: 1500, enemySpeed: [220, 290], speedRng: 0.05,
};

let win: BrowserWindow | null = null;
let store: Store;
let account: Account | null = null;
let settings: Settings = DEFAULT_SETTINGS;
let gameData: { herodata: Record<string, any>; tags: Record<string, string[]>; imprints: Record<string, any>; artifacts: Record<string, any>; source: string; heroCount: number };
let capture: CaptureService;

function readJson(file: string) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function dataFile(name: string) {
  const user = path.join(userDataDir, name);
  return fs.existsSync(user) ? user : path.join(bundledData, name);
}
function loadGameData() {
  const herodata = readJson(dataFile("herodata.json"));
  const tags = { ...readJson(dataFile("hero-tags.json")), ...store.heroTags() };
  const artifacts = readJson(dataFile("artifactdata.json"));
  const imprints = readJson(dataFile("imprints.json"));
  const source = fs.existsSync(path.join(userDataDir, "herodata.json")) ? store.get("data_source", "updated") : "bundled (RexQian fork v1.12.9-offline)";
  gameData = { herodata, tags, imprints, artifacts, source, heroCount: Object.keys(herodata).length };
}

const POOL = Math.max(1, Math.min(os.cpus().length - 2, 12));
const workers: Worker[] = [];
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (p: any) => void }>();

function startWorkers() {
  // worker_threads and sql.js need real files, so these live outside the asar archive when packaged.
  const file = path.join(__dirname, "worker.js").replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
  for (let i = 0; i < POOL; i++) {
    const w = new Worker(file, { workerData: { herodata: gameData.herodata, tags: gameData.tags, imprints: gameData.imprints } });
    w.on("message", (m) => {
      const p = pending.get(m.id);
      if (!p) return;
      if (m.progress) { p.onProgress?.(m.progress); return; }
      pending.delete(m.id);
      m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
    });
    w.on("error", (e) => console.error("worker error", e));
    workers.push(w);
  }
}
function run(worker: Worker, type: string, payload: unknown, onProgress?: (p: any) => void): Promise<any> {
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject, onProgress }); worker.postMessage({ id, type, payload }); });
}
let rr = 0;
const any = (type: string, payload: unknown) => run(workers[rr++ % workers.length], type, payload);
const broadcast = (type: string, payload: unknown) => Promise.all(workers.map((w) => run(w, type, payload)));

function setAccount(acc: Account | null, persist = true) {
  account = acc;
  if (acc && persist) store.saveAccount(acc);
  broadcast("setAccount", acc).catch(() => undefined);
  send("account:changed", summary());
}
function summary() {
  if (!account) return null;
  return { heroes: account.heroes.length, items: account.items.length, importedAt: account.importedAt, source: account.source };
}
function send(channel: string, payload: unknown) {
  // The window can already be gone during shutdown; never message a destroyed window.
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1100, minHeight: 700, backgroundColor: "#0e1116", title: "E7 Forge",
    icon: path.join(__dirname, process.platform === "win32" ? "icon.ico" : "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.setMenuBarVisibility(false);
  win.on("closed", () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
  if (isDev) await win.loadURL("http://localhost:5173");
  else await win.loadFile(path.join(appRoot, "dist", "index.html"));
  if (SMOKE) runSmoke(win, SMOKE).catch((e) => { console.log("SMOKE FAIL", e); app.exit(1); });
}

async function runSmoke(w: BrowserWindow, dir: string) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const js = (code: string) => w.webContents.executeJavaScript(code);
  const shot = async (name: string) => fs.writeFileSync(path.join(dir, name + ".png"), (await w.webContents.capturePage()).toPNG());
  await wait(1500);
  if (process.env.E7FORGE_SMOKE_HOLD) {
    settings.capture.iface = "lo";
    await js("window.forge.captureStart()");
    for (let i = 0; i < 40 && capture.state !== "listening"; i++) await wait(250);
    console.log("SMOKE holding with capture", capture.state);
    return;
  }
  if (process.env.E7FORGE_SMOKE_CLOSE) {
    // Reproduce "close the window while Live Sync is on".
    settings.capture.iface = "lo";
    await js("window.forge.captureStart()");
    for (let i = 0; i < 40 && capture.state !== "listening"; i++) await wait(250);
    console.log("SMOKE capture state before close:", capture.state);
    process.on("exit", (code) => console.log("SMOKE exited cleanly, code", code));
    w.close();
    return;
  }
  const sample = fs.readFileSync(path.join(bundledData, "sample-fribbels-export.json"), "utf8");
  const rep = await js(`window.forge.importText(${JSON.stringify(sample)})`);
  console.log("SMOKE import", JSON.stringify(rep));
  const diag = await js("window.forge.captureDiagnostics()");
  console.log("SMOKE diagnostics", JSON.stringify(diag));
  const init = await js("window.forge.init()");
  const cermia = init.account.heroes.find((h: any) => h.name === "Cermia");
  const opt = await js(`window.forge.optimize({ request: { heroId: ${JSON.stringify(cermia.id)}, weights: { dmg: 3, spd: 1.2 }, min: { cr: 100 }, allowEquipped: true, limit: 10 } })`);
  console.log("SMOKE optimize", JSON.stringify({ n: opt.builds.length, best: opt.builds[0]?.score, spd: opt.builds[0]?.stats.spd, cr: opt.builds[0]?.stats.cr, nodes: opt.nodes, ms: opt.ms, workers: opt.workers, truncated: opt.truncated }));
  const ids = init.account.heroes.slice(0, 3).map((h: any) => h.id);
  const acc = await js(`window.forge.optimizeAccount({ request: { heroes: ${JSON.stringify(ids)}.map((id, i) => ({ request: { heroId: id, weights: { cp: 1, spd: 1 }, limit: 20 }, priority: 3 - i })), buildsPerHero: 20 } })`);
  console.log("SMOKE account", JSON.stringify({ assigned: acc.assignments.filter((a: any) => a.build).length, moved: acc.movedItems, ms: acc.ms }));
  const teams = await js(`window.forge.teams({ content: "rta", options: { top: 2 } })`);
  console.log("SMOKE teams", teams.length, teams[0]?.report.score);
  await js(`[...document.querySelectorAll(".nav")].find(n => n.textContent.startsWith("Heroes")).click()`);
  await wait(1200); await shot("smoke-heroes");
  console.log("SMOKE snapshots", (await js("window.forge.snapshots()")).length);
  store.flush();
  console.log("SMOKE OK");
  app.exit(0);
}

// Own taskbar identity (icon/grouping) instead of the generic Electron one.
if (process.platform === "win32") app.setAppUserModelId("app.e7forge.desktop");

app.whenReady().then(async () => {
  store = new Store(userData);
  await store.open(path.join(__dirname, "sql-wasm.wasm").replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep));
  settings = deepMerge(DEFAULT_SETTINGS, store.get("settings", {}));
  loadGameData();
  startWorkers();
  account = store.loadAccount();
  await broadcast("setAccount", account);
  capture = new CaptureService(unpacked("capture/e7forge_sniffer.py"), () => settings.capture);
  capture.on("pid", (p: { pid: number | null; previous?: number | null }) => guard.setSniffer(p.pid, p.previous));
  capture.on("status", (s) => send("capture:status", s));
  capture.on("activity", (a) => send("capture:activity", a));
  capture.on("syncError", (e) => send("capture:syncError", e));
  capture.on("autoOff", (e) => send("capture:autoOff", e));
  capture.on("scan", ({ scan, trigger }) => {
    const { account: merged, report } = mergeScan(account, scan);
    setAccount(merged);
    send("capture:synced", { trigger, report, at: new Date().toISOString() });
  });
  registerIpc();
  await createWindow();
});
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  capture?.removeAllListeners(); // no UI to notify any more
  try { capture?.stop(); } catch (e) { console.error("capture stop", e); }
  try { store?.flush(); } catch (e) { console.error("store flush", e); }
  guard.release();
  for (const w of workers) w.terminate().catch(() => undefined);
}
app.on("before-quit", shutdown);
app.on("window-all-closed", () => { shutdown(); app.quit(); });

function registerIpc() {
  ipcMain.handle("app:init", () => ({
    version: app.getVersion(), workers: POOL, killedPrior, runtime: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node }, platform: process.platform, settings, account,
    gameData: { herodata: gameData.herodata, tags: gameData.tags, imprints: gameData.imprints, source: gameData.source, heroCount: gameData.heroCount },
    capture: { state: capture.state, error: capture.lastError },
  }));

  ipcMain.handle("settings:set", (_e, s: Partial<Settings>) => {
    settings = deepMerge(settings, s);
    store.set("settings", settings);
    return settings;
  });

  ipcMain.handle("account:importFile", async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Import Fribbels optimizer save or export", properties: ["openFile"],
      filters: [{ name: "Fribbels save / export", extensions: ["json", "txt"] }],
      defaultPath: path.join(os.homedir(), "Documents", "FribbelsOptimizerSaves"),
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const { account: acc, report } = importFribbels(fs.readFileSync(r.filePaths[0], "utf8"), path.basename(r.filePaths[0]));
    setAccount(acc);
    return report;
  });
  ipcMain.handle("account:importText", (_e, text: string) => {
    const { account: acc, report } = importFribbels(text, "pasted");
    setAccount(acc);
    return report;
  });
  ipcMain.handle("account:exportFile", async () => {
    if (!account) return null;
    const r = await dialog.showSaveDialog(win!, { defaultPath: `e7forge-${new Date().toISOString().slice(0, 10)}.json` });
    if (r.canceled || !r.filePath) return null;
    // Fribbels-compatible shape so the file round-trips into Fribbels too
    const items = account.items.map((i) => ({ ...i }));
    const heroes = account.heroes.map((h) => ({
      id: h.id, name: h.name, rarity: h.rarity, attribute: h.attribute, role: h.role, stars: h.stars,
      bonusAtk: h.bonuses.atk, bonusHp: h.bonuses.hp, bonusDef: h.bonuses.def, bonusAtkPercent: h.bonuses.atkPct,
      bonusHpPercent: h.bonuses.hpPct, bonusDefPercent: h.bonuses.defPct, bonusSpeed: h.bonuses.spd, bonusCr: h.bonuses.cr,
      bonusCd: h.bonuses.cd, bonusEff: h.bonuses.eff, bonusRes: h.bonuses.res,
      equipment: Object.fromEntries(Object.entries(h.equipment).map(([s, id]) => [s, items.find((i) => i.id === id)])),
    }));
    fs.writeFileSync(r.filePath, JSON.stringify({ heroes, items }));
    return r.filePath;
  });
  // Manual item edit from the Forecast panel (e.g. after enhancing in game without a sync).
  ipcMain.handle("account:updateItem", (_e, { itemId, enhance, substats }) => {
    if (!account) return null;
    const i = account.items.findIndex((x) => x.id === itemId);
    if (i < 0) return null;
    account.items[i] = editItem(account.items[i], { enhance, substats });
    setAccount(account, true);
    return account.items[i];
  });

  ipcMain.handle("account:updateHero", (_e, { heroId, bonuses, dataKey, imprint }) => {
    if (!account) return null;
    const h = account.heroes.find((x) => x.id === heroId);
    if (!h) return null;
    if (bonuses) h.bonuses = { ...h.bonuses, ...bonuses };
    if (dataKey) h.dataKey = dataKey;
    if (imprint !== undefined) { if (imprint) h.imprint = imprint; else delete h.imprint; }
    setAccount(account, true);
    return h;
  });
  ipcMain.handle("account:applyBuilds", (_e, builds: Build[]) => {
    // Updates the plan inside E7 Forge (it never touches the game).
    if (!account) return null;
    const byId = new Map(account.items.map((i) => [i.id, i]));
    for (const b of builds) {
      const hero = account.heroes.find((h) => h.id === b.heroId);
      if (!hero) continue;
      for (const [slot, itemId] of Object.entries(b.items) as [GearSlot, string][]) {
        const item = byId.get(itemId);
        if (!item) continue;
        if (item.equippedById && item.equippedById !== hero.id) {
          const prev = account.heroes.find((h) => h.id === item.equippedById);
          if (prev && prev.equipment[slot] === itemId) delete prev.equipment[slot];
        }
        const old = hero.equipment[slot] ? byId.get(hero.equipment[slot]!) : undefined;
        if (old && old.id !== itemId) old.equippedById = null;
        hero.equipment[slot] = itemId;
        item.equippedById = hero.id;
      }
    }
    setAccount(account, true);
    return summary();
  });
  ipcMain.handle("account:addHero", (_e, name: string) => {
    if (!gameData.herodata[name]) throw new Error("Unknown hero");
    const acc: Account = account ?? { heroes: [], items: [], importedAt: new Date().toISOString(), source: "manual" };
    const h = gameData.herodata[name];
    acc.heroes.push({
      id: `local-${Date.now()}`, name, dataKey: name, rarity: h.rarity, attribute: h.attribute, role: h.role,
      bonuses: { atk: 0, hp: 0, def: 0, atkPct: 0, hpPct: 0, defPct: 0, spd: 0, cr: 0, cd: 0, eff: 0, res: 0, finalAtkMult: 0, finalHpMult: 0, finalDefMult: 0 },
      equipment: {},
    });
    setAccount(acc, true);
    return true;
  });
  ipcMain.handle("snapshots:list", () => store.snapshots());
  ipcMain.handle("snapshots:restore", (_e, id: number) => { const a = store.restoreSnapshot(id); if (a) setAccount(a, false); return !!a; });

  ipcMain.handle("capture:diagnostics", () => capture.diagnostics());
  ipcMain.handle("capture:installScapy", () => capture.installScapy());
  ipcMain.handle("capture:start", () => { capture.start(); return capture.state; });
  ipcMain.handle("capture:stop", () => { capture.stop(); return capture.state; });
  ipcMain.handle("capture:sync", async () => { await capture.sync("manual"); return true; });

  ipcMain.handle("job:optimize", async (_e, payload) => {
    const shards = workers.length;
    let nodes = 0;
    const parts = await Promise.all(workers.map((w, i) => run(w, "optimize", { ...payload, shard: { index: i, count: shards } }, (p) => {
      nodes += 0; send("job:progress", { kind: "optimize", worker: i, ...p });
    })));
    const limit = payload.request.limit ?? 50;
    const builds = parts.flatMap((p) => p.builds).sort((a, b) => b.score - a.score).slice(0, limit);
    nodes = parts.reduce((a, p) => a + p.nodes, 0);
    return { builds, nodes, candidates: parts[0].candidates, truncated: parts.some((p) => p.truncated), ms: Math.max(...parts.map((p) => p.ms)), workers: shards };
  });
  ipcMain.handle("job:account", async (_e, payload) => {
    // Per-hero candidate searches run in parallel across the pool, then one worker solves the assignment.
    const t0 = Date.now();
    const reqs = payload.request.heroes as { request: { heroId: string } }[];
    const lists = await Promise.all(reqs.map((_, index) => run(workers[index % workers.length], "accountCandidates", { request: payload.request, index })));
    const precomputed = Object.fromEntries(reqs.map((r, i) => [r.request.heroId, lists[i]]));
    const res = await any("account", { ...payload, precomputed });
    return { ...res, ms: Date.now() - t0 };
  });
  ipcMain.handle("job:recommend", (_e, payload) => any("recommend", payload));
  ipcMain.handle("job:teams", (_e, payload) => any("teams", payload));
  ipcMain.handle("job:planTeam", (_e, payload) => any("planTeam", payload));
  ipcMain.handle("job:upgradeQueue", (_e, payload) => any("upgradeQueue", payload));
  ipcMain.handle("job:counters", (_e, payload) => any("counters", payload));

  // community benchmark data (Fribbels hero library)
  ipcMain.handle("community:get", async (_e, { hero, refresh }) => {
    const cached = store.community(hero);
    const fresh = cached && Date.now() - Date.parse(cached.fetchedAt) < 3 * 86400_000;
    if (cached && fresh && !refresh) return { ...cached, cached: true };
    const res = await fetch("https://krivpfvxi0.execute-api.us-west-2.amazonaws.com/dev/getBuilds", { method: "POST", body: hero, headers: { "Content-Type": "text/plain" } });
    if (!res.ok) { if (cached) return { ...cached, cached: true, stale: true }; throw new Error(`Community data HTTP ${res.status}`); }
    const json = (await res.json()) as { data?: unknown[] };
    const builds = json.data ?? [];
    store.saveCommunity(hero, builds);
    return { fetchedAt: new Date().toISOString(), builds, cached: false };
  });

  // PvP / PvE meta: bundled epic7db tier lists + PvE presets, RTA Champion+ rates
  // (epic7rtastats.com, fetched at most once a day, last good copy kept) and
  // CeciliaBot camping data (fetched at runtime, not redistributed).
  ipcMain.handle("meta:get", async (_e, { refresh }: { refresh?: boolean } = {}) => {
    const tiers = readJson(dataFile("epic7db-tiers.json"));
    const presets = readJson(dataFile("pve-presets.json"));
    const campingTopics = readJson(dataFile("camping-topics.json"));
    const errors: string[] = [];
    const DAY = 86400_000;
    const ua = { "User-Agent": "e7-forge/0.1 (personal use)" };
    let rta = store.get<any>("meta_rta", null);
    let week = store.get<any>("meta_rta_week", null);
    const rtaAge = rta ? Date.now() - Date.parse(rta.fetchedAt) : Infinity;
    // Even "refresh" is limited to one request an hour to be polite.
    if (rtaAge > DAY || (refresh && rtaAge > 3600_000)) {
      try {
        const res = await fetch("https://www.epic7rtastats.com/meta", { headers: ua });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const page = await res.text();
        const parsed = parseRtaMeta(page);
        if (parsed.picked.length < 10) throw new Error("too few heroes in response");
        rta = parsed; store.set("meta_rta", rta);
        // Same page, fuller parse (pick order by slot, bans) for the draft assistant.
        try { week = parseMetaSnapshot(page); store.set("meta_rta_week", week); } catch { /* keep the bundled week */ }
      } catch (e: any) { errors.push(`RTA stats: ${e.message}${rta ? " (showing last good copy)" : ""}`); }
    }
    let camping = store.get<any>("meta_camping", null);
    const campAge = camping ? Date.now() - Date.parse(camping.fetchedAt) : Infinity;
    if (campAge > 7 * DAY || (refresh && campAge > 3600_000)) {
      try {
        const [c, h] = await Promise.all([
          fetch("https://ceciliabot.github.io/data/CampingData.json", { headers: ua }),
          fetch("https://ceciliabot.github.io/data/HeroDatabase.json", { headers: ua }),
        ]);
        if (!c.ok || !h.ok) throw new Error(`HTTP ${c.status}/${h.status}`);
        camping = { fetchedAt: new Date().toISOString(), heroes: mapCamping(await c.json(), await h.json(), Object.keys(gameData.herodata)) };
        if (Object.keys(camping.heroes).length < 100) throw new Error("too few heroes matched");
        store.set("meta_camping", camping);
      } catch (e: any) { errors.push(`Camping data: ${e.message}${camping ? " (showing last good copy)" : ""}`); }
    }
    // Bundled history (data/meta-history): latest E7 Analyzer export, and the latest weekly snapshot as a fallback.
    const latest = (dir: string) => {
      try {
        const base = path.join(bundledData, "meta-history", dir);
        const index: string[] = readJson(path.join(base, "index.json"));
        return index.length ? readJson(path.join(base, index[index.length - 1])) : null;
      } catch { return null; }
    };
    const analyzer = latest("e7analyzer");
    week ??= latest("");
    return { tiers, presets, campingTopics, rta, camping, analyzer, week, errors };
  });

  // game data updates
  ipcMain.handle("data:update", async () => {
    const tried: string[] = [];
    let herodata: any = null, artifacts: any = null, source = "";
    try {
      const rel = await (await fetch("https://api.github.com/repos/RexQian/Fribbels-Epic-7-Optimizer/releases/latest", { headers: { "User-Agent": "e7-forge" } })).json() as { tag_name?: string };
      const tag = rel.tag_name;
      if (tag) {
        const base = `https://raw.githubusercontent.com/RexQian/Fribbels-Epic-7-Optimizer/${tag}/data/cache/`;
        tried.push(base);
        const [h, a] = await Promise.all([fetch(base + "herodata.json"), fetch(base + "artifactdata.json")]);
        if (h.ok) { herodata = await h.json(); source = `RexQian fork ${tag}`; }
        if (a.ok) artifacts = await a.json();
      }
    } catch (e) { tried.push(`GitHub: ${(e as Error).message}`); }
    if (!herodata) {
      const s3 = "https://e7-optimizer-game-data.s3-accelerate.amazonaws.com/";
      tried.push(s3);
      const h = await fetch(s3 + "herodata.json");
      if (h.ok) { herodata = await h.json(); source = "Fribbels S3"; }
      const a = await fetch(s3 + "artifactdata.json"); if (a.ok) artifacts = await a.json();
    }
    if (!herodata || Object.keys(herodata).length < 300) throw new Error(`No valid hero data found (${tried.join("; ")})`);
    const before = gameData.heroCount;
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(path.join(userDataDir, "herodata.json"), JSON.stringify(herodata));
    if (artifacts) fs.writeFileSync(path.join(userDataDir, "artifactdata.json"), JSON.stringify(artifacts));
    store.set("data_source", `${source} (${new Date().toISOString().slice(0, 10)})`);
    loadGameData();
    await broadcast("setData", { herodata: gameData.herodata, tags: gameData.tags, imprints: gameData.imprints });
    const newHeroes = Object.keys(herodata).filter((k) => !gameData.tags[k] || !gameData.tags[k].length);
    return { source, heroes: gameData.heroCount, added: gameData.heroCount - before, untagged: newHeroes };
  });

  ipcMain.handle("data:refreshTags", async (_e, names: string[]) => {
    const done: Record<string, string[]> = {};
    const effects = readJson(dataFile("hero-effects.json"));
    for (const name of names.slice(0, 40)) {
      try {
        const res = await fetch(`https://epic7db.com/heroes/${epic7dbSlug(name)}`, { headers: { "User-Agent": "e7-forge/0.1 (personal use)" } });
        const skills = res.ok ? parseEpic7dbHeroPage(await res.text()) : [];
        const tags = deriveTags({ effectCodes: effects[name], scraped: skills });
        if (tags.length) { store.saveHeroTags(name, tags); done[name] = tags; }
      } catch { /* skip */ }
      await new Promise((r) => setTimeout(r, 1200)); // be polite to epic7db
    }
    loadGameData();
    await broadcast("setData", { herodata: gameData.herodata, tags: gameData.tags, imprints: gameData.imprints });
    return done;
  });

  ipcMain.handle("shell:open", (_e, url: string) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
}

function deepMerge<T>(a: T, b: any): T {
  if (!b || typeof b !== "object" || Array.isArray(b)) return (b ?? a) as T;
  const out: any = Array.isArray(a) ? [...(a as any)] : { ...(a as any) };
  for (const k of Object.keys(b)) {
    out[k] = a && typeof (a as any)[k] === "object" && !Array.isArray((a as any)[k]) && (a as any)[k] !== null ? deepMerge((a as any)[k], b[k]) : b[k];
  }
  return out;
}
