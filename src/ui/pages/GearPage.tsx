import React, { useEffect, useMemo, useRef, useState } from "react";
import { useForge } from "../state";
import { Busy, fmt, ItemBadge, NoAccount, Num, pct, Section, SetIcon, SlotIcon, SlotLabel, SortTh, statText, useSort } from "../components";
import { SETS, STAT_LABEL } from "../../engine/constants";
import { gearScore, reforgedSubs } from "../../engine/gear";
import { DEFAULT_TIERS, editItem, FORECAST_TRIALS, forecastItem, itemRandom, outcomeKey, simulateScores, tierHelp, tierSplit, type RoiTiers, type TierSplit } from "../../engine/roi";
import { GEAR_SLOTS, STAT_TYPES, type Item, type StatType, type Substat } from "../../engine/types";

const SUB_COLS: { t: StatType; label: string }[] = [
  { t: "Speed", label: "Spd" }, { t: "CriticalHitChancePercent", label: "CR%" }, { t: "CriticalHitDamagePercent", label: "CD%" },
  { t: "AttackPercent", label: "Atk%" }, { t: "Attack", label: "Atk" }, { t: "HealthPercent", label: "HP%" }, { t: "Health", label: "HP" },
  { t: "DefensePercent", label: "Def%" }, { t: "Defense", label: "Def" }, { t: "EffectivenessPercent", label: "Eff%" }, { t: "EffectResistancePercent", label: "Res%" },
];
const subVal = (i: Item, t: StatType) => { const s = i.substats.find((x) => x.type === t); return s ? Math.floor(s.value + 0.5) : null; };
const MAIN_OPTIONS: StatType[] = ["Attack", "AttackPercent", "Health", "HealthPercent", "Defense", "DefensePercent", "Speed", "CriticalHitChancePercent", "CriticalHitDamagePercent", "EffectivenessPercent", "EffectResistancePercent"];

const FOCUS: Record<string, Partial<Record<StatType, number>> | undefined> = {
  "Balanced (gear score)": undefined,
  "Speed DPS": { Speed: 1, CriticalHitChancePercent: 1, CriticalHitDamagePercent: 1, AttackPercent: 1 },
  "Bruiser": { Speed: 1, HealthPercent: 1, CriticalHitChancePercent: 1, CriticalHitDamagePercent: 1, DefensePercent: 0.6 },
  "Support / debuffer": { Speed: 1, HealthPercent: 1, DefensePercent: 1, EffectivenessPercent: 1, EffectResistancePercent: 1 },
};

/**
 * Simulated +15 scores for every item, filled in small batches so the page
 * stays responsive. Keyed on the item and the forecast type; tier edits reuse
 * the cached scores and only re-bucket them.
 */
function useOutcomes(items: Item[], first: Item[], focusName: string) {
  const cache = useRef(new Map<string, Float64Array>());
  const [version, bump] = useState(0);
  useEffect(() => {
    const focus = FOCUS[focusName];
    const seen = new Set<string>();
    const todo = [...first, ...items].filter((i) => { const k = outcomeKey(i, focusName); if (seen.has(k) || cache.current.has(k)) return false; seen.add(k); return true; });
    if (!todo.length) return;
    let n = 0, timer = 0;
    const step = () => {
      const end = performance.now() + 30;
      while (n < todo.length && performance.now() < end) { const i = todo[n++]; cache.current.set(outcomeKey(i, focusName), simulateScores(i, focus)); }
      bump((v) => v + 1);
      if (n < todo.length) timer = window.setTimeout(step, 0);
    };
    timer = window.setTimeout(step, 0);
    return () => clearTimeout(timer);
  }, [items, first, focusName]);
  return { get: (i: Item) => cache.current.get(outcomeKey(i, focusName)), version };
}

const TIER_COLOR: Record<string, string> = { S: "var(--good)", A: "var(--info)", B: "var(--warn)", Sell: "var(--muted)" };
const EMPTY_ITEMS: Item[] = [];
// "Don't ask again this session": kept in memory only, so it resets when the app restarts.
let skipDeleteConfirm = false;

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />
  </svg>
);

function DeleteDialog({ item, wornBy, onCancel, onConfirm }: { item: Item; wornBy?: string; onCancel: () => void; onConfirm: (dontAsk: boolean) => void }) {
  const [dontAsk, setDontAsk] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onCancel]);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="del-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="del-title" style={{ marginTop: 0 }}>Delete this item?</h3>
        <p style={{ margin: "6px 0" }}>
          <span className="slot-label"><SetIcon set={item.set} /><SlotIcon slot={item.gear} />{item.rank} {SETS[item.set]?.label ?? item.set} {item.gear} +{item.enhance}</span>
          <span className="muted"> · {statText(item.main.type, item.main.value)} · GS {fmt(item.gs, 1)}</span>
        </p>
        {wornBy && <p className="warn" style={{ margin: "6px 0" }}>{wornBy} is wearing it; that slot will be empty.</p>}
        <p className="muted" style={{ fontSize: 12, margin: "6px 0 10px" }}>This removes it from E7 Forge only. If it's still in your game inventory, the next Live Sync or import adds it back.</p>
        <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />Don't ask again this session</label>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="small ghost" onClick={onCancel} autoFocus>Cancel</button>
          <button className="small danger" onClick={() => onConfirm(dontAsk)}>Delete</button>
        </div>
      </div>
    </div>
  );
}

const TIER_RANK: Record<string, number> = { S: 4, A: 3, B: 2, Sell: 1 };

function TierCell({ split, tiers }: { split?: TierSplit; tiers: RoiTiers }) {
  if (!split) return <td className="num muted">…</td>;
  const p = { S: split.pS, A: split.pA, B: split.pB, Sell: split.pSell }[split.likely];
  const title = split.finished
    ? `Finished: score ${fmt(split.median, 1)} is ${split.likely === "Sell" ? `below B (${tiers.B})` : `${split.likely} tier`}.`
    : `Forecast at +15: S ${pct(split.pS)} · A ${pct(split.pA)} · B ${pct(split.pB)} · Sell ${pct(split.pSell)}. Median score ${fmt(split.median, 1)}.`;
  return (
    <td className="num roi-tier" title={title + "\n\n" + tierHelp(tiers)} style={{ color: TIER_COLOR[split.likely] }}>
      <b>{split.likely}</b>{!split.finished && <span className="muted"> {pct(p)}</span>}
    </td>
  );
}

export default function GearPage() {
  const { account, heroById, api, toast } = useForge();
  const [slot, setSlot] = useState("");
  const [set, setSet] = useState("");
  const [rank, setRank] = useState("");
  const [mainF, setMainF] = useState("");
  const [enh, setEnh] = useState<"" | "15" | "unfinished">("");
  const [worn, setWorn] = useState(""); // "", "__none", "__any", or hero id
  const [minGs, setMinGs] = useState<number | undefined>();
  const [subMin, setSubMin] = useState<Partial<Record<StatType, number>>>({});
  const clearFilters = () => { setSlot(""); setSet(""); setRank(""); setMainF(""); setEnh(""); setWorn(""); setMinGs(undefined); setSubMin({}); };
  const [sel, setSel] = useState<Item | null>(null);
  const [focus, setFocus] = useState("Balanced (gear score)");
  const [tiers, setTiers] = useState<RoiTiers>(DEFAULT_TIERS);
  const [queue, setQueue] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Item | null>(null);
  const deleteItem = async (item: Item) => {
    try {
      if (!(await api.deleteItem({ itemId: item.id }))) throw new Error("Item not found.");
      if (sel?.id === item.id) setSel(null);
      setQueue((q) => q?.filter((x) => x.itemId !== item.id) ?? null);
      toast(`Deleted ${item.rank} ${item.gear} +${item.enhance}.`);
    } catch (e: any) { toast(e.message, true); }
  };
  const askDelete = (item: Item) => (skipDeleteConfirm ? deleteItem(item) : setConfirmDel(item));
  const items = useMemo(() => (account?.items ?? []).filter((i) => {
    if (slot && i.gear !== slot) return false;
    if (set && i.set !== set) return false;
    if (rank && i.rank !== rank) return false;
    if (mainF && i.main.type !== mainF) return false;
    if (enh === "15" && i.enhance < 15) return false;
    if (enh === "unfinished" && i.enhance >= 15) return false;
    if (worn === "__none" && i.equippedById) return false;
    if (worn === "__any" && !i.equippedById) return false;
    if (worn && !worn.startsWith("__") && i.equippedById !== worn) return false;
    if (minGs != null && (i.gs ?? 0) < minGs) return false;
    for (const [t, m] of Object.entries(subMin) as [StatType, number | undefined][]) {
      if (m == null) continue;
      const v = subVal(i, t);
      if (v == null || v < m) return false;
    }
    return true;
  }), [account, slot, set, rank, mainF, enh, worn, minGs, subMin]);
  const visibleFirst = useMemo(() => items.slice(0, 300), [items]);
  const outcomes = useOutcomes(account?.items ?? EMPTY_ITEMS, visibleFirst, focus);
  const splitOf = (i: Item) => { const sc = outcomes.get(i); return sc ? tierSplit(sc, tiers) : undefined; };
  const activeFilters = [slot, set, rank, mainF, enh, worn].filter(Boolean).length + (minGs != null ? 1 : 0) + Object.values(subMin).filter((v) => v != null).length;
  const RANK_ORDER: Record<string, number> = { Normal: 1, Good: 2, Rare: 3, Heroic: 4, Epic: 5 };
  const SLOT_ORDER: Record<string, number> = { Weapon: 1, Helmet: 2, Armor: 3, Necklace: 4, Ring: 5, Boots: 6 };
  const { sorted: sortedItems, sort, toggle } = useSort(items, {
    slot: (i) => SLOT_ORDER[i.gear], set: (i) => SETS[i.set]?.label ?? i.set, rank: (i) => RANK_ORDER[i.rank] ?? 0, enh: (i) => i.enhance * 1000 + (i.level || 0), lvl: (i) => i.level || 0,
    main: (i) => `${statText(i.main.type, 0).replace(/ 0%?$/, "")}${i.main.type.endsWith("Percent") ? "%" : ""} ${String(Math.round(i.main.value)).padStart(5, "0")}`,
    ...Object.fromEntries(SUB_COLS.map((c) => [c.t, (i: Item) => subVal(i, c.t)])), gs: (i) => i.gs ?? 0,
    worn: (i) => (i.equippedById ? heroById.get(i.equippedById)?.name ?? "" : ""),
    tier: (i) => { const sp = splitOf(i); return sp ? TIER_RANK[sp.likely] * 1000 + sp.median : -1; },
  }, { key: "gs", dir: -1 }, [tiers, focus, outcomes.version]);
  const shown = sortedItems.slice(0, 1500);
  const qSort = useSort(queue ?? [], {
    item: (q: any) => { const it = account?.items.find((x) => x.id === q.itemId); return it ? `${it.rank} ${SETS[it.set]?.label} ${it.gear}` : ""; },
    sa: (q: any) => q.f.pS + q.f.pA, sell: (q: any) => q.f.pSell, spd: (q: any) => q.f.speed.p15,
  }, { key: "sa", dir: -1 });
  if (!account) return <NoAccount />;
  const byId = new Map(account.items.map((i) => [i.id, i]));

  return (
    <div className="stack">
      {confirmDel && <DeleteDialog item={confirmDel} wornBy={confirmDel.equippedById ? heroById.get(confirmDel.equippedById)?.name : undefined}
        onCancel={() => setConfirmDel(null)} onConfirm={(dontAsk) => { if (dontAsk) skipDeleteConfirm = true; const it = confirmDel; setConfirmDel(null); deleteItem(it); }} />}
      <div><h1>Gear & Upgrade ROI</h1><p className="sub">Monte Carlo forecast of where unfinished gear lands at +15 (reforged for level-85 gear), so you know what to enhance, what to stop, and what to sell.</p></div>
      <div className="row">
        <select value={slot} onChange={(e) => setSlot(e.target.value)}><option value="">All slots</option>{GEAR_SLOTS.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={set} onChange={(e) => setSet(e.target.value)}><option value="">All sets</option>{Object.keys(SETS).map((s) => <option key={s} value={s}>{SETS[s].label}</option>)}</select>
        <select value={rank} onChange={(e) => setRank(e.target.value)}><option value="">All ranks</option>{["Epic", "Heroic", "Rare", "Good", "Normal"].map((r) => <option key={r}>{r}</option>)}</select>
        <select value={mainF} onChange={(e) => setMainF(e.target.value)}><option value="">Any main stat</option>{MAIN_OPTIONS.map((m) => <option key={m} value={m}>{statText(m, 0).replace(/ 0(%?)$/, "$1")}</option>)}</select>
        <select value={enh} onChange={(e) => setEnh(e.target.value as any)}><option value="">Any enhance</option><option value="15">+15 only</option><option value="unfinished">Unfinished (&lt;15)</option></select>
        <select value={worn} onChange={(e) => setWorn(e.target.value)}>
          <option value="">Worn by anyone / no one</option><option value="__none">Unequipped only</option><option value="__any">Equipped only</option>
          {[...account.heroes].sort((a, b) => a.name.localeCompare(b.name)).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <span className="muted">GS ≥</span><Num value={minGs} width={60} onChange={setMinGs} />
        <button className="small ghost" disabled={!activeFilters} onClick={clearFilters}>Clear filters{activeFilters ? ` (${activeFilters})` : ""}</button>
        <span className="muted">{fmt(items.length)} of {fmt(account.items.length)} items</span>
        <span style={{ flex: 1 }} />
        <span className="muted help" title={tierHelp(tiers)}>Tiers S/A/B ≥ ⓘ</span>
        <Num value={tiers.S} width={56} onChange={(v) => setTiers({ ...tiers, S: v ?? 70 })} />
        <Num value={tiers.A} width={56} onChange={(v) => setTiers({ ...tiers, A: v ?? 60 })} />
        <Num value={tiers.B} width={56} onChange={(v) => setTiers({ ...tiers, B: v ?? 50 })} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 400px" }}>
        <div className="card scroll fill" style={{ padding: 0 }}>
          <table className="gear-table">
            <thead><tr>
              <SortTh k="enh" label="+ / Lv" sort={sort} onSort={toggle} title="Enhancement (+0 to +15) over gear level; click again to sort by level" />
              <SortTh k="slot" label="Slot" text sort={sort} onSort={toggle} /><SortTh k="set" label="Set" text sort={sort} onSort={toggle} />
              <SortTh k="rank" label="Rank" sort={sort} onSort={toggle} /><SortTh k="lvl" label="Lv" num sort={sort} onSort={toggle} />
              <SortTh k="main" label="Main" text sort={sort} onSort={toggle} />
              {SUB_COLS.map((c) => <SortTh key={c.t} k={c.t} label={c.label} num sort={sort} onSort={toggle} title={`Sort by ${c.label} substat`} />)}
              <SortTh k="gs" label="GS" num sort={sort} onSort={toggle} />
              <SortTh k="tier" label="+15 tier" num sort={sort} onSort={toggle} title={"Monte Carlo rating at +15 for the forecast type and tiers set on this page. Finished gear is graded as it is; unfinished gear shows its most likely tier and that tier's chance.\n\n" + tierHelp(tiers)} />
              <SortTh k="worn" label="Worn by" text sort={sort} onSort={toggle} /><th style={{ width: 30 }} />
            </tr>
            <tr className="filter-row">
              <th colSpan={6} className="muted" style={{ fontWeight: 400 }}>Minimum substat ≥ (blank = any)</th>
              {SUB_COLS.map((c) => (
                <th key={c.t} className="num"><input type="number" className="mini" value={subMin[c.t] ?? ""} placeholder="–"
                  onChange={(e) => setSubMin({ ...subMin, [c.t]: e.target.value === "" ? undefined : Number(e.target.value) })} /></th>
              ))}
              <th colSpan={4} />
            </tr></thead>
            <tbody>{shown.length === 0 && (
              <tr><td colSpan={6 + SUB_COLS.length + 4} className="empty">No items match these filters. <a onClick={clearFilters}>Clear filters</a></td></tr>
            )}{shown.map((i) => (
              <tr key={i.id} className={sel?.id === i.id ? "sel" : ""} onClick={() => setSel(i)} style={{ cursor: "pointer" }}>
                <td><ItemBadge item={i} /></td>
                <td><SlotLabel slot={i.gear} /></td><td><span className="slot-label"><SetIcon set={i.set} />{SETS[i.set]?.label ?? i.set}</span></td><td>{i.rank}</td><td className="num muted">{i.level || "?"}</td>
                <td className="mono">{statText(i.main.type, i.main.value)}</td>
                {SUB_COLS.map((c) => { const v = subVal(i, c.t); const hit = v != null && subMin[c.t] != null; return (
                  <td key={c.t} className={"num sub" + (c.t === "Speed" && v != null ? " spd" : "") + (hit ? " hit" : "")}>{v ?? ""}</td>); })}
                <td className="num">{fmt(i.gs, 1)}</td><TierCell split={splitOf(i)} tiers={tiers} /><td className="muted worn" title={i.equippedById ? heroById.get(i.equippedById)?.name : ""}>{i.equippedById ? heroById.get(i.equippedById)?.name : ""}</td>
                <td><button className="icon-btn" title="Delete item" aria-label="Delete item" onClick={(e) => { e.stopPropagation(); askDelete(i); }}><TrashIcon /></button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="stack side-panel">
          <Section title="Forecast" right={<select value={focus} onChange={(e) => setFocus(e.target.value)}>{Object.keys(FOCUS).map((f) => <option key={f}>{f}</option>)}</select>}>
            {!sel ? <span className="muted">Select an item.</span> : <ForecastPanel key={sel.id + ":" + sel.enhance + ":" + sel.substats.map((x) => x.type + x.value).join()} item={sel} focus={FOCUS[focus]} tiers={tiers} onSaved={setSel} />}
          </Section>
          <Section title="Upgrade queue" right={busy ? <Busy label="Simulating…" /> : <button className="small" onClick={async () => { setBusy(true); try { setQueue(await api.upgradeQueue({ options: { tiers, focus: FOCUS[focus] }, max: 200 })); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } }}>Rank unfinished gear</button>}>
            {!queue ? <span className="muted">Ranks Epic/Heroic gear below +15 by expected outcome.</span> : (
              <div className="scroll" style={{ maxHeight: "max(260px, calc(100vh - 640px))" }}>
                <table><thead><tr><SortTh k="item" label="Item" text sort={qSort.sort} onSort={qSort.toggle} /><SortTh k="sa" label="S+A" num sort={qSort.sort} onSort={qSort.toggle} /><SortTh k="sell" label="Sell" num sort={qSort.sort} onSort={qSort.toggle} /><SortTh k="spd" label="P(spd≥15)" num sort={qSort.sort} onSort={qSort.toggle} /></tr></thead>
                  <tbody>{qSort.sorted.slice(0, 80).map((q) => { const it = byId.get(q.itemId)!; return (
                    <tr key={q.itemId} onClick={() => setSel(it)} style={{ cursor: "pointer" }}><td><span className="slot-label"><SetIcon set={it.set} /><SlotIcon slot={it.gear} />{it.rank} +{it.enhance}</span> <span className="muted">{STAT_LABEL[it.main.type]}</span></td>
                      <td className="num">{pct(q.f.pS + q.f.pA)}</td><td className="num">{pct(q.f.pSell)}</td><td className="num">{pct(q.f.speed.p15)}</td></tr>); })}</tbody></table>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}


function ForecastPanel({ item, focus, tiers, onSaved }: { item: Item; focus?: Partial<Record<StatType, number>>; tiers: RoiTiers; onSaved: (i: Item) => void }) {
  const { api, toast } = useForge();
  const [editing, setEditing] = useState(false);
  const [enhance, setEnhance] = useState(item.enhance);
  const [subs, setSubs] = useState<Substat[]>(() => [...item.substats.map((x) => ({ ...x })), ...Array(Math.max(0, 4 - item.substats.length)).fill(null).map(() => ({ type: "" as StatType, value: 0 }))]);
  const dirty = enhance !== item.enhance || subs.some((x, i) => x.type !== (item.substats[i]?.type ?? "") || x.value !== (item.substats[i]?.value ?? 0));
  const draft = useMemo(() => (dirty ? editItem(item, { enhance, substats: subs }) : item), [item, enhance, subs, dirty]);
  const fc = useMemo(() => forecastItem(draft, { trials: FORECAST_TRIALS, random: itemRandom(draft), tiers, focus }), [draft, tiers, focus]);
  const help = tierHelp(tiers);
  const setSub = (i: number, patch: Partial<Substat>) => setSubs(subs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async () => {
    const saved = await api.updateItem({ itemId: item.id, enhance, substats: subs.filter((x) => x.type && x.value > 0) });
    if (saved) { toast("Item updated"); onSaved(saved); setEditing(false); }
  };
  const subOptions = STAT_TYPES.filter((t) => t !== item.main.type);
  return (
    <div className="col">
      <div className="row">
        <span className="pill"><SetIcon set={draft.set} size={16} /><SlotIcon slot={draft.gear} size={16} />{draft.rank} {draft.gear} +{draft.enhance}</span>
        <span className="pill">{fc.stepsLeft ? `${fc.stepsLeft} enhancement step${fc.stepsLeft > 1 ? "s" : ""} left` : "Finished"}</span>
        <span className={"pill " + (fc.risk === "low" ? "good" : fc.risk === "medium" ? "warn" : "bad")}>{fc.risk} risk</span>
        {dirty && <span className="pill warn">edited, not saved</span>}
      </div>
      <div className="row" title={help} style={{ cursor: "help", alignItems: "baseline" }}>
        <span className="muted">Likely at +15:</span>
        <b style={{ fontSize: 22, color: TIER_COLOR[fc.likely] }}>{fc.likely === "Sell" ? "Sell" : `${fc.likely} tier`}</b>
        <span className="muted">score {fc.now} now → {fc.p50} expected (most results {fc.p10}–{fc.p90})</span>
      </div>
      <div className="split" title={help}>
        <span style={{ width: pct(fc.pS), background: "var(--good)" }} /><span style={{ width: pct(fc.pA), background: "var(--info)" }} />
        <span style={{ width: pct(fc.pB), background: "var(--warn)" }} /><span style={{ width: pct(fc.pSell), background: "#4a3333" }} />
      </div>
      <div className="row mono" title={help} style={{ cursor: "help" }}>
        <span style={{ color: "var(--good)" }}>S {pct(fc.pS)}</span><span style={{ color: "var(--info)" }}>A {pct(fc.pA)}</span>
        <span style={{ color: "var(--warn)" }}>B {pct(fc.pB)}</span><span className="muted">Sell {pct(fc.pSell)}</span>
        <span className="muted" style={{ fontSize: 11 }}>ⓘ hover for tiers</span>
      </div>
      <div className="muted">Speed substat at +15: {fc.speed.expected ? `about ${fc.speed.expected}, 15+ in ${pct(fc.speed.p15)} of rolls` : "none possible"}</div>
      <div className="reason">{fc.recommendation}</div>
      {draft.level === 85 && draft.enhance >= 15 && <div className="muted">Reforge: GS {fmt(gearScore(draft.substats), 1)} → {fmt(gearScore(reforgedSubs(draft)), 1)}</div>}

      <div className="row" style={{ marginTop: 6 }}>
        <button className="small ghost" onClick={() => setEditing(!editing)}>{editing ? "Hide editor" : "Update item manually"}</button>
        {dirty && <button className="small ghost" onClick={() => { setEnhance(item.enhance); setSubs(item.substats.map((x) => ({ ...x }))); }}>Reset</button>}
        {dirty && <button className="small primary" onClick={save}>Save to item</button>}
      </div>
      {editing && (
        <div className="col" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>Enhanced or rerolled in game without a sync? Enter the new values; the forecast updates as you type.</span>
          <label className="field">Enhance
            <select value={enhance} onChange={(e) => setEnhance(Number(e.target.value))}>
              {Array.from({ length: 16 }, (_, i) => <option key={i} value={i}>+{i}</option>)}
            </select>
          </label>
          {subs.map((x, i) => (
            <div key={i} className="row">
              <select value={x.type} onChange={(e) => setSub(i, { type: e.target.value as StatType })} style={{ flex: 1 }}>
                <option value="">— none —</option>
                {subOptions.filter((t) => t === x.type || !subs.some((y) => y.type === t)).map((t) => <option key={t} value={t}>{STAT_LABEL[t] ?? t}</option>)}
              </select>
              <Num value={x.value || undefined} width={70} onChange={(v) => setSub(i, { value: v ?? 0 })} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
