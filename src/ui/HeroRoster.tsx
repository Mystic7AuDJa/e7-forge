import React, { useMemo, useState } from "react";
import { fmt, HeroIcon } from "./components";
import { useForge } from "./state";
import type { Hero } from "../engine/types";

const ELEMENTS = ["fire", "ice", "earth", "light", "dark"] as const;
const ROLES: { k: string; label: string }[] = [
  { k: "warrior", label: "Warrior" }, { k: "knight", label: "Knight" }, { k: "assassin", label: "Thief" },
  { k: "ranger", label: "Ranger" }, { k: "mage", label: "Mage" }, { k: "manauser", label: "Soul Weaver" },
];
const EL_COLOR: Record<string, string> = { fire: "#e8664d", ice: "#5aa8f0", earth: "#6cc56a", wind: "#6cc56a", light: "#e9c95b", dark: "#a674e0" };
// Game data calls Earth "wind".
const elKey = (a?: string) => (a === "wind" ? "earth" : a ?? "");

export function heroLevelText(h: Hero) {
  const parts: string[] = [];
  if (h.level) parts.push(`Lv ${h.level}`);
  if (h.stars) parts.push(`${h.stars}★`);
  if (h.awaken != null) parts.push(`A${h.awaken}`);
  return parts.join(" · ");
}

type SortKey = "cp" | "spd" | "name" | "level" | "gs";

export function HeroRoster(props: {
  mode: "single" | "multi";
  selected?: string | null;
  onSelect?: (id: string) => void;
  checked?: string[];
  onCheck?: (ids: string[]) => void;
  max?: number;
  height?: string;
  title?: string;
}) {
  const { account, stats, init, hd } = useForge();
  const [q, setQ] = useState("");
  const [el, setEl] = useState<string>("");
  const [role, setRole] = useState<string>("");
  const [sort, setSort] = useState<SortKey>("cp");
  const [onlyChecked, setOnlyChecked] = useState(false);
  const checked = props.checked ?? [];

  const rows = useMemo(() => {
    const list = (account?.heroes ?? []).map((h) => ({ h, s: stats(h) }))
      // Live Sync heroes carry no element/class, so fall back to game data.
      .filter(({ h }) => {
        const d = hd(h);
        return (!q || h.name.toLowerCase().includes(q.toLowerCase())) && (!el || elKey(h.attribute || d?.attribute) === el) && (!role || (h.role || d?.role) === role);
      })
      .filter(({ h }) => !onlyChecked || checked.includes(h.id));
    const key = (r: (typeof list)[number]): number | string =>
      sort === "name" ? r.h.name : sort === "level" ? (r.h.level ?? 0) * 100 + (r.h.stars ?? 0) * 10 + (r.h.awaken ?? 0) : ((r.s?.[sort] as number) ?? 0);
    return list.sort((a, b) => (sort === "name" ? String(key(a)).localeCompare(String(key(b))) : (key(b) as number) - (key(a) as number)));
  }, [account, stats, hd, q, el, role, sort, onlyChecked, checked]);

  const toggle = (id: string) => {
    if (!props.onCheck) return;
    if (checked.includes(id)) props.onCheck(checked.filter((x) => x !== id));
    else if (!props.max || checked.length < props.max) props.onCheck([...checked, id]);
  };

  return (
    <div className="roster card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{props.title ?? "Your heroes"}</h2>
        <span className="muted">{rows.length} of {account?.heroes.length ?? 0}</span>
      </div>
      <input placeholder="Search heroes…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%" }} />
      <div className="roster-filters">
        {ELEMENTS.map((x) => (
          <button key={x} type="button" className={"chip" + (el === x ? " on" : "")} onClick={() => setEl(el === x ? "" : x)} title={x}>
            <span className="el-dot" style={{ background: EL_COLOR[x] }} />{x[0].toUpperCase() + x.slice(1)}
          </button>
        ))}
      </div>
      <div className="roster-filters">
        {ROLES.map((r) => (
          <button key={r.k} type="button" className={"chip" + (role === r.k ? " on" : "")} onClick={() => setRole(role === r.k ? "" : r.k)}>{r.label}</button>
        ))}
      </div>
      <div className="row" style={{ gap: 6, margin: "4px 0 6px" }}>
        <span className="muted" style={{ fontSize: 12 }}>Sort</span>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ padding: "3px 6px" }}>
          <option value="cp">CP</option><option value="spd">Speed</option><option value="gs">Gear score</option><option value="level">Level / stars</option><option value="name">Name</option>
        </select>
        {props.mode === "multi" && (
          <>
            <span style={{ flex: 1 }} />
            <span className="muted" style={{ fontSize: 12 }}>{checked.length}{props.max ? `/${props.max}` : ""} selected</span>
            <button className="small ghost" onClick={() => setOnlyChecked(!onlyChecked)}>{onlyChecked ? "Show all" : "Selected only"}</button>
            <button className="small ghost" disabled={!checked.length} onClick={() => props.onCheck?.([])}>Clear</button>
          </>
        )}
      </div>
      <div className="roster-list" style={{ height: props.height ?? "calc(100vh - 360px)" }}>
        {rows.map(({ h, s }) => {
          const isSel = props.mode === "single" ? props.selected === h.id : checked.includes(h.id);
          const data = init.gameData.herodata[h.dataKey || h.name];
          return (
            <div key={h.id} className={"roster-row" + (isSel ? " sel" : "")}
              onClick={() => (props.mode === "single" ? props.onSelect?.(h.id) : toggle(h.id))}>
              {props.mode === "multi" && <input type="checkbox" checked={isSel} readOnly tabIndex={-1} />}
              <span className="roster-icon"><HeroIcon name={h.dataKey || h.name} /><span className="el-dot abs" style={{ background: EL_COLOR[h.attribute || data?.attribute] ?? "#777" }} /></span>
              <span className="roster-main">
                <span className="roster-name">{h.name}</span>
                <span className="muted roster-sub">{[heroLevelText(h), ROLES.find((r) => r.k === (h.role || data?.role))?.label ?? h.role].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="roster-stats mono">
                <span>{fmt(s?.spd)} <i>Spd</i></span>
                <span className="muted">{s?.cp ? `${Math.round(s.cp / 1000)}k` : "—"}</span>
              </span>
            </div>
          );
        })}
        {!rows.length && <div className="empty">No heroes match.</div>}
      </div>
    </div>
  );
}
