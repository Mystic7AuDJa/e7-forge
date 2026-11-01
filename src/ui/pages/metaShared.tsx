import React, { useEffect, useMemo } from "react";
import { useForge } from "../state";
import { HeroIcon } from "../components";
import { candidatesFrom, type TeamCandidate } from "../../engine/teams";
import type { Hero, HeroData } from "../../engine/types";
import { fmtImprint, teamAuras } from "../../engine/imprint";

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

export function OpenInAccountOpt({ ids, mins, label = "Open in Account-Wide Optimizer" }: { ids: string[]; mins?: Record<string, Record<string, number>>; label?: string }) {
  const { openInAccountOptimizer } = useForge();
  return <button className="small primary" disabled={!ids.length} onClick={() => openInAccountOptimizer(ids, mins)}>{label} ▸</button>;
}

export function ImprintAuras({ ids }: { ids: string[] }) {
  const { heroById, hd } = useForge();
  const members = ids.map((id) => heroById.get(id)).filter(Boolean).map((h) => ({ hero: h!, hd: hd(h!) })).filter((m) => m.hd) as { hero: Hero; hd: HeroData }[];
  const auras = teamAuras(members);
  const unset = members.filter((m) => !m.hero.imprint).length;
  if (!auras.length && !unset) return null;
  return (
    <div className="muted" style={{ fontSize: 12, margin: "4px 0" }}>
      {auras.length > 0 && <>Imprint Release: {auras.map((a) => `${a.from} ${a.grade} → ${fmtImprint(a.stat, a.label, a.value)} to ${a.positionLabel}`).join("; ")}. </>}
      {unset > 0 && <>{unset} hero{unset > 1 ? "es have" : " has"} no Memory Imprint set (Hero Optimizer).</>}
    </div>
  );
}
