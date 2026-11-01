import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { buildHeroDb, findHeroData, type HeroDb } from "../engine/data";
import { currentBuildStats } from "../engine/optimizer";
import type { Account, DerivedStats, Hero, HeroData, Item } from "../engine/types";
import { getApi, type ForgeApi, type InitData, type MetaBundle, type Settings } from "./api";

export interface CaptureStatus { state: string; error?: string | null; bytes?: number; packets?: number; streams?: number; ifaces?: string[]; lastSync?: any }

interface Ctx {
  api: ForgeApi;
  init: InitData;
  account: Account | null;
  db: HeroDb;
  settings: Settings;
  setSettings: (s: Partial<Settings>) => Promise<void>;
  reload: () => Promise<void>;
  capture: CaptureStatus;
  toast: (msg: string, err?: boolean) => void;
  hd: (h: Hero) => HeroData | undefined;
  stats: (h: Hero) => DerivedStats | null;
  itemById: Map<string, Item>;
  heroById: Map<string, Hero>;
  page: string;
  go: (p: string, arg?: any) => void;
  pageArg: any;
  back: () => void; forward: () => void; home: () => void; canBack: boolean; canForward: boolean;
  /** Hero picked in the roster; shared by Hero Optimizer, Recommendations and Compare. */
  heroId: string | null;
  setHeroId: (id: string | null) => void;
  /** Heroes checked for the Account-wide Optimizer; other pages can pre-check them. */
  checked: string[];
  setChecked: (ids: string[]) => void;
  /** Open the Account-wide Optimizer with these heroes checked. */
  openInAccountOptimizer: (ids: string[], mins?: Record<string, Record<string, number>>) => void;
  /** Tier lists, RTA rates, camping data and PvE presets (loaded on first use). */
  meta: MetaBundle | null;
  metaBusy: boolean;
  loadMeta: (refresh?: boolean) => Promise<void>;
}

const C = createContext<Ctx | null>(null);
export const useForge = () => useContext(C)!;

export function ForgeProvider({ children }: { children: React.ReactNode }) {
  const [api, setApi] = useState<ForgeApi | null>(null);
  const [init, setInit] = useState<InitData | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [capture, setCapture] = useState<CaptureStatus>({ state: "off" });
  const [toasts, setToasts] = useState<{ id: number; msg: string; err?: boolean }[]>([]);
  const [page, setPage] = useState("account");
  const [pageArg, setPageArg] = useState<any>(null);
  const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
  const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
  const [heroId, setHeroIdState] = useState<string | null>(() => load("sel.hero", null));
  const [checked, setCheckedState] = useState<string[]>(() => load("sel.checked", []));
  const setHeroId = useCallback((id: string | null) => { setHeroIdState(id); save("sel.hero", id); }, []);
  const setChecked = useCallback((ids: string[]) => { setCheckedState(ids); save("sel.checked", ids); }, []);
  const [error, setError] = useState<string | null>(null);
  const [hist, setHist] = useState<{ stack: { page: string; arg: any }[]; i: number }>({ stack: [{ page: "account", arg: null }], i: 0 });
  const [meta, setMeta] = useState<MetaBundle | null>(null);
  const [metaBusy, setMetaBusy] = useState(false);

  const toast = useCallback((msg: string, err?: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), err ? 9000 : 5000);
  }, []);

  const reload = useCallback(async () => {
    const a = api ?? (await getApi());
    const d = await a.init();
    setInit(d); setAccount(d.account ? { ...d.account } : null); setSettingsState(d.settings);
    setCapture((c) => ({ ...c, state: d.capture.state, error: d.capture.error }));
  }, [api]);

  useEffect(() => {
    getApi().then(async (a) => {
      setApi(a);
      try {
        const d = await a.init();
        setInit(d); setAccount(d.account); setSettingsState(d.settings);
        setCapture({ state: d.capture.state, error: d.capture.error });
        if (d.killedPrior?.length) toast(`Closed previous E7 Forge session: ${d.killedPrior.join(", ")}`);
      } catch (e: any) { setError(e.message); }
      a.on("account:changed", async () => { const d = await a.init(); setInit(d); setAccount(d.account ? { ...d.account } : null); });
      a.on("capture:status", (s) => setCapture((c) => ({ ...c, ...s })));
      a.on("capture:activity", (s) => setCapture((c) => ({ ...c, ...s })));
      a.on("capture:synced", (s) => {
        setCapture((c) => ({ ...c, lastSync: s }));
        const r = s.report;
        toast(`Live sync: ${r.added} new, ${r.updated} updated, ${r.removed} removed items · ${r.heroesAdded} new / ${r.heroesUpdated} updated heroes`);
      });
      a.on("capture:syncError", (s) => toast(`Sync: ${s.error}`, true));
      a.on("capture:autoOff", (s) => toast(`Live sync turned off: no decoder activity for ${s.minutes} min. Connection closed.`));
    }).catch((e) => setError(String(e)));
  }, [toast]);

  const db = useMemo(() => buildHeroDb(init?.gameData.herodata ?? {}, init?.gameData.tags ?? {}), [init?.gameData]);
  const hd = useCallback((h: Hero) => findHeroData(db, h.dataKey || h.name), [db]);
  const statsCache = useMemo(() => new Map<string, DerivedStats | null>(), [account, db]);
  const stats = useCallback((h: Hero) => {
    if (!account) return null;
    if (statsCache.has(h.id)) return statsCache.get(h.id)!;
    const d = hd(h);
    const s = d ? currentBuildStats(h, d, account.items).stats : null;
    statsCache.set(h.id, s);
    return s;
  }, [account, hd, statsCache]);
  const itemById = useMemo(() => new Map((account?.items ?? []).map((i) => [i.id, i])), [account]);
  const heroById = useMemo(() => new Map((account?.heroes ?? []).map((h) => [h.id, h])), [account]);

  const setSettings = useCallback(async (s: Partial<Settings>) => {
    if (!api) return;
    setSettingsState(await api.setSettings(s));
  }, [api]);

  if (error) return <div className="empty">Failed to start: {error}</div>;
  if (!api || !init || !settings) return <div className="empty">Loading E7 Forge…</div>;

  // Page history for Back / Forward.
  const show = (e: { page: string; arg: any }) => { setPage(e.page); setPageArg(e.arg); };
  const go = (p: string, arg?: any) => {
    setHist((h) => {
      const cur = h.stack[h.i];
      if (cur && cur.page === p && cur.arg === (arg ?? null)) return h;
      const stack = [...h.stack.slice(0, h.i + 1), { page: p, arg: arg ?? null }].slice(-50);
      return { stack, i: stack.length - 1 };
    });
    setPage(p); setPageArg(arg ?? null);
  };
  const back = () => setHist((h) => { if (h.i <= 0) return h; const i = h.i - 1; show(h.stack[i]); return { ...h, i }; });
  const forward = () => setHist((h) => { if (h.i >= h.stack.length - 1) return h; const i = h.i + 1; show(h.stack[i]); return { ...h, i }; });
  const home = () => go("account");
  const canBack = hist.i > 0, canForward = hist.i < hist.stack.length - 1;
  const openInAccountOptimizer = (ids: string[], mins?: Record<string, Record<string, number>>) => { setChecked(ids); go("accountopt", { fromTeam: ids, mins }); };
  const loadMeta = async (refresh = false) => {
    if (metaBusy || (meta && !refresh)) return;
    setMetaBusy(true);
    try { const m = await api.meta({ refresh }); setMeta(m); for (const e of m.errors) toast(e, true); }
    catch (e: any) { toast(`Meta data: ${e.message}`, true); }
    finally { setMetaBusy(false); }
  };
  return (
    <C.Provider value={{ api, init, account, db, settings, setSettings, reload, capture, toast, hd, stats, itemById, heroById, page, go, pageArg, heroId, setHeroId, checked, setChecked, openInAccountOptimizer, meta, metaBusy, loadMeta, back, forward, home, canBack, canForward }}>
      {children}
      <div className="toast">{toasts.map((t) => <div key={t.id} className={t.err ? "err" : ""}>{t.msg}</div>)}</div>
    </C.Provider>
  );
}
