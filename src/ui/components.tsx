import React, { useMemo, useState } from "react";
import { SETS, STAT_LABEL } from "../engine/constants";
import type { DerivedStats, Hero, Item } from "../engine/types";
import { useForge } from "./state";

export const fmt = (n: number | undefined | null, d = 0) => (n == null || isNaN(n as number) ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

export const STAT_COLS: { k: keyof DerivedStats; label: string }[] = [
  { k: "atk", label: "Atk" }, { k: "hp", label: "HP" }, { k: "def", label: "Def" }, { k: "spd", label: "Spd" },
  { k: "cr", label: "CR" }, { k: "cd", label: "CD" }, { k: "eff", label: "Eff" }, { k: "res", label: "Res" },
  { k: "cp", label: "CP" }, { k: "ehp", label: "EHP" }, { k: "dmg", label: "Dmg" }, { k: "gs", label: "GS" },
];

const ICON_BASE = "./icons";

export function SetIcon({ set, size = 20 }: { set: string; size?: number }) {
  const label = SETS[set]?.label ?? set;
  return <img className="set-icon" src={`${ICON_BASE}/sets/${set}.png`} width={size} height={size} alt={label} title={`${label} Set (${SETS[set]?.pieces ?? "?"}pc)`} />;
}

export function SetIcons({ sets, size = 20 }: { sets: string[]; size?: number }) {
  if (!sets.length) return <span className="muted">Broken</span>;
  return <span className="set-icons">{sets.map((s, i) => <SetIcon key={i} set={s} size={size} />)}</span>;
}

export function SlotIcon({ slot, size = 18 }: { slot: string; size?: number }) {
  return <img className="slot-icon" src={`${ICON_BASE}/slots/${slot}.png`} width={size} height={size} alt={slot} />;
}

export function SlotLabel({ slot }: { slot: string }) {
  return <span className="slot-label"><SlotIcon slot={slot} />{slot}</span>;
}

export function HeroIcon({ name }: { name: string }) {
  const { init } = useForge();
  const src = init.gameData.herodata[name]?.assets?.icon;
  return src ? <img src={src} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} /> : <img alt="" />;
}

export function HeroName({ hero }: { hero: Hero }) {
  return <span className="hero-cell"><HeroIcon name={hero.dataKey || hero.name} />{hero.name}</span>;
}

export function HeroSelect({ value, onChange, placeholder = "Choose hero…", exclude = [] }: { value: string | null; onChange: (id: string) => void; placeholder?: string; exclude?: string[] }) {
  const { account } = useForge();
  const heroes = useMemo(() => [...(account?.heroes ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [account]);
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>{placeholder}</option>
      {heroes.filter((h) => !exclude.includes(h.id) || h.id === value).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
    </select>
  );
}

export function StatLine({ s, compare }: { s: DerivedStats | null; compare?: DerivedStats | null }) {
  if (!s) return <span className="muted">no data</span>;
  return (
    <div className="row" style={{ gap: 14 }}>
      {STAT_COLS.map(({ k, label }) => {
        const v = s[k] as number;
        const c = compare ? (compare[k] as number) : null;
        const d = c != null ? v - c : 0;
        return (
          <div key={k} className="kpi" style={{ minWidth: 58 }}>
            <span className="label">{label}</span>
            <span className="mono">{fmt(v)}{c != null && d !== 0 && <span style={{ color: d > 0 ? "var(--good)" : "var(--bad)", fontSize: 11 }}> {d > 0 ? "+" : ""}{fmt(d)}</span>}</span>
          </div>
        );
      })}
    </div>
  );
}

const SHORT: Record<string, string> = {
  Attack: "Atk", AttackPercent: "Atk", Health: "HP", HealthPercent: "HP", Defense: "Def", DefensePercent: "Def",
  Speed: "Spd", CriticalHitChancePercent: "CR", CriticalHitDamagePercent: "CD", EffectivenessPercent: "Eff", EffectResistancePercent: "Res",
};
const FLAT = new Set(["Attack", "Health", "Defense", "Speed"]);

/** Whole-number stat value, .5 rounds up (7.5 -> 8, 7.4 -> 7), with % for percent stats. */
export function statText(type: string, value: number) {
  const v = Math.floor(value + 0.5);
  return `${SHORT[type] ?? type} ${v}${FLAT.has(type) ? "" : "%"}`;
}

const RANK_CLASS: Record<string, string> = { Epic: "epic", Heroic: "heroic", Rare: "rare", Good: "good", Normal: "normal" };

export function ItemBadge({ item }: { item: Item }) {
  return (
    <span className={"item-badge " + (RANK_CLASS[item.rank] ?? "")} title={`${item.rank} · level ${item.level || "?"} · +${item.enhance}`}>
      <span className="ib-enh">+{item.enhance}</span>
      <span className="ib-lv">{item.level || "?"}</span>
    </span>
  );
}

export function ItemSummary({ item }: { item?: Item }) {
  if (!item) return <span className="muted">—</span>;
  return (
    <span className="item-row" title={item.substats.map((s) => `${statText(s.type, s.value)}${s.rolls ? ` (${s.rolls} roll${s.rolls > 1 ? "s" : ""})` : ""}`).join("\n")}>
      <ItemBadge item={item} />
      <span className="item-sum">
        <span className="item-head">
          <SetIcon set={item.set} />
          <span className="mono"><b>{statText(item.main.type, item.main.value)}</b></span>
          <span className="muted"> · GS {fmt(item.gs)}</span>
        </span>
        <span className="item-subs">
          {item.substats.map((s, i) => (
            <span key={i} className={s.type === "Speed" ? "spd" : undefined}>{statText(s.type, s.value)}</span>
          ))}
        </span>
      </span>
    </span>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <span className="chk" onClick={() => onChange(!on)}><span className={"switch" + (on ? " on" : "")} />{label}</span>;
}

export function Num({ value, onChange, step = 1, width = 84, placeholder }: { value: number | undefined; onChange: (v: number | undefined) => void; step?: number; width?: number; placeholder?: string }) {
  return <input type="number" style={{ width }} step={step} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />;
}

export function SetPicker({ value, onChange }: { value: string[][]; onChange: (v: string[][]) => void }) {
  const [pending, setPending] = useState<string[]>([]);
  const names = Object.keys(SETS);
  const used = pending.reduce((n, x) => n + SETS[x].pieces, 0);
  const toggle = (set: string) => setPending((cur) => {
    const total = cur.reduce((n, x) => n + SETS[x].pieces, 0);
    const i = cur.lastIndexOf(set);
    if (i >= 0 && (SETS[set].pieces === 4 || total + 2 > 6)) return cur.filter((_, j) => j !== i);
    return total + SETS[set].pieces <= 6 ? [...cur, set] : cur;
  });
  return (
    <div className="col">
      <div className="set-grid">
        {names.map((s) => {
          const n = pending.filter((x) => x === s).length;
          const fits = used + SETS[s].pieces <= 6;
          return (
            <button key={s} type="button" className={"set-btn" + (n ? " on" : "") + (!n && !fits ? " dim" : "")} onClick={() => toggle(s)} title={`${SETS[s].label} (${SETS[s].pieces}pc)`}>
              <SetIcon set={s} size={26} />{n > 1 && <span className="set-count">×{n}</span>}
            </button>
          );
        })}
      </div>
      <div className="row">
        <span className="muted">{pending.length ? <SetIcons sets={pending} size={18} /> : "Click icons to build a combo (up to 6 pieces)"}</span>
        <button className="small" disabled={!pending.length} onClick={() => { onChange([...value, pending]); setPending([]); }}>Add combo</button>
        {pending.length > 0 && <a onClick={() => setPending([])}>clear</a>}
      </div>
      <div className="row" style={{ gap: 6 }}>{value.length ? value.map((c, i) => (
        <span key={i} className="combo"><SetIcons sets={c} size={18} /><a onClick={() => onChange(value.filter((_, j) => j !== i))}>×</a></span>
      )) : <span className="muted">Any sets</span>}</div>
    </div>
  );
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return <div className="card"><div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}><h2 style={{ margin: 0 }}>{title}</h2>{right}</div>{children}</div>;
}

export function NoAccount() {
  const { go } = useForge();
  return <div className="card empty">No account data yet. <a onClick={() => go("account")}>Turn on Live sync or import a file</a>.</div>;
}

export function Busy({ label }: { label: string }) {
  return <span className="pill info"><span className="dot decoding" /> {label}</span>;
}

export type SortState = { key: string; dir: 1 | -1 };
type Getter<T> = (row: T) => number | string | null | undefined;

/** Sorts rows by a column getter. Empty values always sort last. */
export function useSort<T>(rows: T[], getters: Record<string, Getter<T>>, initial: SortState) {
  const [sort, setSort] = useState<SortState>(initial);
  const sorted = useMemo(() => {
    const g = getters[sort.key];
    if (!g) return rows;
    return rows.map((r) => ({ r, v: g(r) })).sort((a, b) => {
      const ea = a.v == null || a.v === "", eb = b.v == null || b.v === "";
      if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
      const c = typeof a.v === "string" || typeof b.v === "string"
        ? String(a.v).localeCompare(String(b.v), undefined, { numeric: true, sensitivity: "base" })
        : (a.v as number) - (b.v as number);
      return c * sort.dir;
    }).map((x) => x.r);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  /** First click: text columns A→Z, number columns high→low. Clicking again reverses. */
  const toggle = (key: string, text = false) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: text ? 1 : -1 }));
  return { sorted, sort, toggle };
}

export function SortTh({ k, label, sort, onSort, num, text, title }: {
  k: string; label: React.ReactNode; sort: SortState; onSort: (k: string, text?: boolean) => void; num?: boolean; text?: boolean; title?: string;
}) {
  const active = sort.key === k;
  return (
    <th className={(num ? "num " : "") + "sortable" + (active ? " active" : "")} onClick={() => onSort(k, text)} title={title ?? "Click to sort"} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      {label}<span className="sort-arrow">{active ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
    </th>
  );
}
