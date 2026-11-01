import React, { useEffect, useMemo } from "react";
import { useForge } from "../state";
import { HeroIcon } from "../components";
import { candidatesFrom, type TeamCandidate } from "../../engine/teams";
import type { Hero } from "../../engine/types";

export function useCandidates(): TeamCandidate[] {
  const { account, hd } = useForge();
  return useMemo(() => (account ? candidatesFrom(account.heroes, hd, account.items) : []), [account, hd]);
}

export function useMeta() {
  const { meta, metaBusy, loadMeta } = useForge();
  useEffect(() => { if (!meta && !metaBusy) loadMeta(); }, [meta, metaBusy]);
  return { meta, metaBusy, loadMeta };
}

// Duplicates of a hero are common; guides should match the copy you actually gear.
export function useOwnedByName(cands: TeamCandidate[]) {
  return useMemo(() => {
    const m = new Map<string, TeamCandidate>();
    for (const c of cands) for (const k of [c.hero.name, c.hero.dataKey, c.hd.name]) {
      if (!k) continue;
      const prev = m.get(k);
      if (!prev || c.readiness > prev.readiness) m.set(k, c);
    }
    return m;
  }, [cands]);
}

const CONF_CLASS: Record<string, string> = { sourced: "ok", "undated-guide": "warn", inferred: "warn", "legacy-2020": "legacy", "player-report": "warn", unsourced: "bad" };

export function Conf({ c }: { c?: string | null }) {
  if (!c) return null;
  return <span className={"conf " + (CONF_CLASS[c] ?? "warn")} title="How much to trust this line">{c}</span>;
}

export function SourceLine({ source, date, confidence }: { source?: string; date?: string; confidence?: string }) {
  const { api } = useForge();
  if (!source && !date && !confidence) return null;
  let host = "";
  try { host = source ? new URL(source).hostname.replace(/^www\./, "") : ""; } catch { host = source ?? ""; }
  return (
    <span className="srcline">
      <Conf c={confidence} />
      {date && <span className="muted">{date}</span>}
      {source && <a onClick={() => api.openExternal(source)} title={source}>{host}</a>}
    </span>
  );
}

export function TeamHeroes({ heroes, sub }: { heroes: { hero?: Hero; name: string; note?: React.ReactNode; missing?: boolean }[]; sub?: (i: number) => React.ReactNode }) {
  return (
    <div className="team-heroes">
      {heroes.map((h, i) => (
        <div key={i} className={"team-hero" + (h.missing ? " missing" : "")}>
          <HeroIcon name={h.name} />
          <div>
            <div>{h.name}</div>
            {h.note && <div className="muted" style={{ fontSize: 11 }}>{h.note}</div>}
            {sub?.(i)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function OpenInAccountOpt({ ids, mins, label = "Open in Account-wide Optimizer" }: { ids: string[]; mins?: Record<string, Record<string, number>>; label?: string }) {
  const { openInAccountOptimizer } = useForge();
  return <button className="small primary" disabled={!ids.length} onClick={() => openInAccountOptimizer(ids, mins)}>{label} ▸</button>;
}
