import React, { useMemo, useState } from "react";
import { useForge } from "../state";
import { Busy, fmt, HeroIcon, HeroSelect, NoAccount, Section, Toggle } from "../components";
import { buildMeta, PVP_SIZE, suggestPvp, type PvpMode, type PvpTeam, type TeamStyle } from "../../engine/meta";
import { OpenInAccountOpt, TeamHeroes, useCandidates, useMeta, useOwnedByName } from "./metaShared";

const INFO: Record<PvpMode, { title: string; sub: string }> = {
  arena_def: {
    title: "Arena Defense",
    sub: "Four-hero defenses built from heroes you own. Most arena attacks are cleaves (fast AoE burst), so the score rewards tools that stop them: counter, immortality, barriers, revive, skill nullifier, provoke and turn-gauge reduction.",
  },
  rta: {
    title: "RTA Draft",
    sub: "A five-hero draft core from your roster, ranked against what Champion+ players pick, win with and pre-ban, plus the RTA tier list.",
  },
  gw_off: {
    title: "Guild War Offense",
    sub: "Three-hero attack teams. When you have the heroes for a cleave, pure sustain supports (Tamarinne-type healers) are left out; otherwise it builds bruiser teams that win longer fights.",
  },
  gw_def: {
    title: "Guild War Defense",
    sub: "Three-hero defenses focused on surviving and punishing cleave attacks: counters, immortality, barriers, revive, nullifiers, provoke and turn-gauge reduction.",
  },
};

export const ArenaDefensePage = () => <PvpPage mode="arena_def" />;
export const RtaDraftPage = () => <PvpPage mode="rta" />;
export const GwOffensePage = () => <PvpPage mode="gw_off" />;
export const GwDefensePage = () => <PvpPage mode="gw_def" />;

function PvpPage({ mode }: { mode: PvpMode }) {
  const { account, db, heroById, api } = useForge();
  const { meta, metaBusy, loadMeta } = useMeta();
  const cands = useCandidates();
  const owned = useOwnedByName(cands);
  const [style, setStyle] = useState<TeamStyle>("auto");
  const [must, setMust] = useState<string[]>([]);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const metaMap = useMemo(() => (meta ? buildMeta(meta.tiers, "rta", meta.rta, db) : null), [meta, db]);
  const result = useMemo(() => (metaMap && cands.length ? suggestPvp(cands, metaMap, mode, { style, mustInclude: must, top: 6 }) : null), [metaMap, cands, mode, style, must]);
  if (!account) return <NoAccount />;
  const info = INFO[mode];

  const pool = metaMap ? [...metaMap.values()].filter((m) => m.meta && db.has(m.name)).sort((a, b) => b.score - a.score) : [];
  const ownedPool = pool.filter((m) => owned.has(m.name));
  const shown = (ownedOnly ? ownedPool : pool).slice(0, 60);
  const rta = meta?.rta;

  return (
    <div className="stack">
      <div><h1>{info.title}</h1><p className="sub">{info.sub}</p></div>

      {!meta ? <Busy label="Loading tier lists and RTA rates…" /> : <>
        <div className="row">
          {mode === "gw_off" && (
            <select value={style} onChange={(e) => setStyle(e.target.value as TeamStyle)}>
              <option value="auto">Style: auto (cleave if viable)</option>
              <option value="cleave">Style: cleave</option>
              <option value="bruiser">Style: bruiser</option>
            </select>
          )}
          <HeroSelect value={null} onChange={(id) => setMust([...new Set([...must, id])].slice(0, PVP_SIZE[mode] - 1))} placeholder="Must include…" />
          {must.map((id) => <span key={id} className="tag">{heroById.get(id)?.name} <a onClick={() => setMust(must.filter((x) => x !== id))}>×</a></span>)}
          <span style={{ flex: 1 }} />
          <span className="muted">You own {ownedPool.length} of {pool.length} heroes in the top-player pool</span>
          {metaBusy ? <Busy label="Refreshing…" /> : <button className="small" onClick={() => loadMeta(true)}>Refresh</button>}
        </div>

        {mode === "gw_off" && result && (
          <div className="muted">
            {result.cleaveViable ? "Your roster can field a cleave (two or more AoE damage dealers plus an enabler)." : "Your roster can't field a full cleave yet, so bruiser teams are shown."}
            {result.style === "cleave" && result.excluded.length > 0 && <> Left out as pure sustain: {result.excluded.slice(0, 8).join(", ")}{result.excluded.length > 8 ? "…" : ""}.</>}
          </div>
        )}

        <Section title={mode === "rta" ? "Draft cores you can field" : "Teams you can field"} right={<span className="muted">Pick one to open it in the Account-Wide Optimizer with these heroes checked</span>}>
          {!result?.teams.length ? <span className="muted">Not enough geared heroes to build a team.</span> : (
            <div className="grid g2">{result.teams.map((t, i) => <PvpTeamCard key={i} rank={i + 1} team={t} mode={mode} metaMap={metaMap!} />)}</div>
          )}
        </Section>

        <Section title="Top-player hero pool" right={<Toggle on={ownedOnly} onChange={setOwnedOnly} label="Owned only" />}>
          <table>
            <thead><tr><th>Hero</th><th>Tier</th><th className="num">RTA pick %</th><th className="num">RTA win %</th><th className="num">Pre-ban %</th><th className="num">Meta score</th><th>Yours</th><th className="num">Your GS</th></tr></thead>
            <tbody>{shown.map((m) => {
              const c = owned.get(m.name);
              return (
                <tr key={m.name} className={c ? "" : "dim"}>
                  <td><span className="row" style={{ gap: 6 }}><HeroIcon name={m.name} />{m.name}</span></td>
                  <td>{m.tier ? <span className={"tierchip t" + m.tier}>{m.tier}</span> : <span className="muted">—</span>}</td>
                  <td className="num">{m.rtaPick != null ? fmt(m.rtaPick, 1) : "—"}</td>
                  <td className="num">{m.rtaWin != null ? fmt(m.rtaWin, 1) : "—"}</td>
                  <td className="num">{m.rtaPreban != null ? fmt(m.rtaPreban, 1) : "—"}</td>
                  <td className="num">{fmt(m.score, 1)}</td>
                  <td>{c ? <span className="ok">✓ owned</span> : <span className="muted">not owned</span>}</td>
                  <td className="num">{c ? fmt(c.current.gs) : ""}</td>
                </tr>
              );
            })}</tbody>
          </table>
          <p className="muted" style={{ fontSize: 12 }}>Pick, win and pre-ban rates are per game at Champion and above in RTA, and are only available for the 20 most-picked heroes. Pre-ban rate is per side, so ~50% means one of the two players bans it in about half of games.</p>
        </Section>
      </>}
    </div>
  );
}

function PvpTeamCard({ rank, team, mode, metaMap }: { rank: number; team: PvpTeam; mode: PvpMode; metaMap: ReturnType<typeof buildMeta> }) {
  const { heroById } = useForge();
  return (
    <div className="card" style={{ background: "var(--panel-2)" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>#{rank} · {team.style === "draft" ? "Draft core" : team.style[0].toUpperCase() + team.style.slice(1)}</b>
        <span className="muted">fit {fmt(team.score, 0)} · meta {fmt(team.metaAvg, 1)} · geared {fmt(team.readiness * 100, 0)}%</span>
      </div>
      <TeamHeroes heroes={team.heroIds.map((id, i) => {
        const h = heroById.get(id)!; const m = metaMap.get(h.dataKey || h.name);
        return { hero: h, name: h.name, note: [team.tiers[i] && `Tier ${team.tiers[i]}`, m?.rtaPick != null && `${fmt(m.rtaPick, 1)}% RTA picks`].filter(Boolean).join(" · ") };
      })} />
      <ul className="reasons">{team.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      {team.warnings.length > 0 && <ul className="warnings">{team.warnings.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      {mode === "rta" && <p className="muted" style={{ fontSize: 12 }}>In draft you pick five and play four. Treat this as a core to build around; expect at least one to be banned.</p>}
      <div className="row" style={{ justifyContent: "flex-end" }}><OpenInAccountOpt ids={team.heroIds} /></div>
    </div>
  );
}
