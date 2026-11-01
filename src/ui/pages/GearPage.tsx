import React, { useMemo, useState } from "react";
import { useForge } from "../state";
import { Busy, fmt, ItemBadge, NoAccount, Num, pct, Section, SetIcon, SlotIcon, SlotLabel, SortTh, statText, useSort } from "../components";
import { SETS, STAT_LABEL } from "../../engine/constants";
import { gearScore, reforgedSubs } from "../../engine/gear";
import { DEFAULT_TIERS, forecastItem, type RoiTiers } from "../../engine/roi";
import { GEAR_SLOTS, type Item, type StatType } from "../../engine/types";

/** One column per substat; values rounded like the game (.5 up). */
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
  const activeFilters = [slot, set, rank, mainF, enh, worn].filter(Boolean).length + (minGs != null ? 1 : 0) + Object.values(subMin).filter((v) => v != null).length;
  const RANK_ORDER: Record<string, number> = { Normal: 1, Good: 2, Rare: 3, Heroic: 4, Epic: 5 };
  const SLOT_ORDER: Record<string, number> = { Weapon: 1, Helmet: 2, Armor: 3, Necklace: 4, Ring: 5, Boots: 6 };
  const { sorted: sortedItems, sort, toggle } = useSort(items, {
    slot: (i) => SLOT_ORDER[i.gear], set: (i) => SETS[i.set]?.label ?? i.set, rank: (i) => RANK_ORDER[i.rank] ?? 0, enh: (i) => i.enhance * 1000 + (i.level || 0), lvl: (i) => i.level || 0,
    main: (i) => `${statText(i.main.type, 0).replace(/ 0%?$/, "")}${i.main.type.endsWith("Percent") ? "%" : ""} ${String(Math.round(i.main.value)).padStart(5, "0")}`,
    ...Object.fromEntries(SUB_COLS.map((c) => [c.t, (i: Item) => subVal(i, c.t)])), gs: (i) => i.gs ?? 0,
    worn: (i) => (i.equippedById ? heroById.get(i.equippedById)?.name ?? "" : ""),
  }, { key: "gs", dir: -1 });
  const shown = sortedItems.slice(0, 1500);
  const qSort = useSort(queue ?? [], {
    item: (q: any) => { const it = account?.items.find((x) => x.id === q.itemId); return it ? `${it.rank} ${SETS[it.set]?.label} ${it.gear}` : ""; },
    sa: (q: any) => q.f.pS + q.f.pA, sell: (q: any) => q.f.pSell, spd: (q: any) => q.f.speed.p15,
  }, { key: "sa", dir: -1 });
  const fc = useMemo(() => (sel ? forecastItem(sel, { trials: 4000, tiers, focus: FOCUS[focus] }) : null), [sel, tiers, focus]);
  if (!account) return <NoAccount />;
  const byId = new Map(account.items.map((i) => [i.id, i]));

  return (
    <div className="stack">
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
        <span className="muted">Tiers S/A/B ≥</span>
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
              <SortTh k="gs" label="GS" num sort={sort} onSort={toggle} /><SortTh k="worn" label="Worn by" text sort={sort} onSort={toggle} />
            </tr>
            <tr className="filter-row">
              <th colSpan={6} className="muted" style={{ fontWeight: 400 }}>Minimum substat ≥ (blank = any)</th>
              {SUB_COLS.map((c) => (
                <th key={c.t} className="num"><input type="number" className="mini" value={subMin[c.t] ?? ""} placeholder="–"
                  onChange={(e) => setSubMin({ ...subMin, [c.t]: e.target.value === "" ? undefined : Number(e.target.value) })} /></th>
              ))}
              <th colSpan={2} />
            </tr></thead>
            <tbody>{shown.length === 0 && (
              <tr><td colSpan={6 + SUB_COLS.length + 2} className="empty">No items match these filters. <a onClick={clearFilters}>Clear filters</a></td></tr>
            )}{shown.map((i) => (
              <tr key={i.id} className={sel?.id === i.id ? "sel" : ""} onClick={() => setSel(i)} style={{ cursor: "pointer" }}>
                <td><ItemBadge item={i} /></td>
                <td><SlotLabel slot={i.gear} /></td><td><span className="slot-label"><SetIcon set={i.set} />{SETS[i.set]?.label ?? i.set}</span></td><td>{i.rank}</td><td className="num muted">{i.level || "?"}</td>
                <td className="mono">{statText(i.main.type, i.main.value)}</td>
                {SUB_COLS.map((c) => { const v = subVal(i, c.t); const hit = v != null && subMin[c.t] != null; return (
                  <td key={c.t} className={"num sub" + (c.t === "Speed" && v != null ? " spd" : "") + (hit ? " hit" : "")}>{v ?? ""}</td>); })}
                <td className="num">{fmt(i.gs, 1)}</td><td className="muted worn" title={i.equippedById ? heroById.get(i.equippedById)?.name : ""}>{i.equippedById ? heroById.get(i.equippedById)?.name : ""}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="stack side-panel">
          <Section title="Forecast" right={<select value={focus} onChange={(e) => setFocus(e.target.value)}>{Object.keys(FOCUS).map((f) => <option key={f}>{f}</option>)}</select>}>
            {!sel || !fc ? <span className="muted">Select an item.</span> : (
              <div className="col">
                <div className="row"><span className="pill"><SetIcon set={sel.set} size={16} /><SlotIcon slot={sel.gear} size={16} />{sel.rank} {sel.gear} +{sel.enhance}</span><span className="pill">{fc.stepsLeft} enhancement steps left</span>
                  <span className={"pill " + (fc.risk === "low" ? "good" : fc.risk === "medium" ? "warn" : "bad")}>{fc.risk} risk</span></div>
                <div className="split">
                  <span style={{ width: pct(fc.pS), background: "var(--good)" }} /><span style={{ width: pct(fc.pA), background: "var(--info)" }} />
                  <span style={{ width: pct(fc.pB), background: "var(--warn)" }} /><span style={{ width: pct(fc.pSell), background: "#4a3333" }} />
                </div>
                <div className="row mono"><span style={{ color: "var(--good)" }}>S {pct(fc.pS)}</span><span style={{ color: "var(--info)" }}>A {pct(fc.pA)}</span><span style={{ color: "var(--warn)" }}>B {pct(fc.pB)}</span><span className="muted">Sell {pct(fc.pSell)}</span></div>
                <div className="mono">Score p10 {fc.p10} · median {fc.p50} · p90 {fc.p90}</div>
                <div className="mono">Speed: expected {fc.speed.expected} · P(≥12) {pct(fc.speed.p12)} · P(≥15) {pct(fc.speed.p15)} · P(≥18) {pct(fc.speed.p18)}</div>
                <div className="reason">{fc.recommendation}</div>
                {sel.level === 85 && sel.enhance >= 15 && <div className="muted">Reforge: GS {fmt(gearScore(sel.substats), 1)} → {fmt(gearScore(reforgedSubs(sel)), 1)}</div>}
              </div>
            )}
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
