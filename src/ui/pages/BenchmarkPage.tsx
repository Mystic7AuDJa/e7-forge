import React, { useEffect, useMemo, useState } from "react";
import { useForge } from "../state";
import { HeroRoster } from "../HeroRoster";
import { HeroHeader } from "../HeroDetail";
import { Busy, fmt, NoAccount, pct, Section } from "../components";
import { benchmark, BENCH_STATS, type BenchmarkResult } from "../../engine/benchmark";

const LABEL: Record<string, string> = { spd: "Speed", hp: "HP", atk: "Attack", def: "Defense", cr: "Crit %", cd: "Crit Dmg %", eff: "Effectiveness", res: "Effect Res", gs: "Gear Score" };

export default function BenchmarkPage() {
  const { account, pageArg, heroById, stats, api, toast, heroId, setHeroId, init } = useForge();
  const byCode = useMemo(() => new Map(Object.values(init.gameData.artifacts ?? {}).map((a) => [a.code, a.name])), [init.gameData.artifacts]);
  const artifactName = (code: string) => byCode.get(code) ?? code;
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<{ fetchedAt: string; builds: any[]; cached: boolean; stale?: boolean } | null>(null);
  const hero = heroId ? heroById.get(heroId) : undefined;
  const cur = hero ? stats(hero) : null;

  const load = async (refresh = false) => {
    if (!hero) return;
    setBusy(true);
    try { setData(await api.community({ hero: hero.dataKey || hero.name, refresh })); } catch (e: any) { toast(e.message, true); setData(null); } finally { setBusy(false); }
  };
  useEffect(() => { setData(null); if (hero) load(); }, [heroId]);
  if (!account) return <NoAccount />;
  const r: BenchmarkResult | null = data && cur ? benchmark(cur, data.builds) : null;
  const tone = (top: number) => (top <= 10 ? "good" : top <= 35 ? "info" : top <= 65 ? "warn" : "bad");

  // local: rank vs your own roster
  const roster = account.heroes.map((h) => stats(h)).filter(Boolean);
  const localTop = (k: "spd" | "gs") => cur ? Math.max(1, Math.round((roster.filter((s) => (s![k] as number) > (cur[k] as number)).length / Math.max(1, roster.length)) * 100)) : 0;

  return (
    <div className="with-roster">
    <HeroRoster mode="single" selected={heroId} onSelect={(id) => setHeroId(id)} />
    <div className="stack">
      <div><h1>Compare Builds Against Community</h1><p className="sub">Compares your build with recent community builds for the same hero (Fribbels hero library, up to 3,000 builds). Rank labels aren't in that data, so high-end play is approximated by the top 10% and top 1% of builds by gear score.</p></div>
      <div className="row">
        {!hero && <span className="muted">Pick a hero from your roster on the left.</span>}
        {busy ? <Busy label="Fetching community builds…" /> : <button disabled={!hero} onClick={() => load(true)}>Refresh</button>}
        {data && <span className="muted">{data.builds.length} builds · {data.cached ? "cached" : "fresh"} {new Date(data.fetchedAt).toLocaleDateString()}{data.stale ? " (offline, stale)" : ""}</span>}
      </div>
      {r && cur && (
        <>
          <div className="grid g3">
            {(["spd", "hp", "gs"] as const).map((k) => (
              <div key={k} className="card kpi"><span className="label">{LABEL[k]}</span><span className="big">Top {r.topPct[k]}%</span><span className="muted">{fmt(cur[k])} vs median {fmt(r.median[k])}</span></div>
            ))}
          </div>
          <Section title="Stat by stat">
            <table>
              <thead><tr><th>Stat</th><th className="num">You</th><th>Standing</th><th className="num">Median</th><th className="num">Top 10% (GS)</th><th className="num">Top 1% (GS)</th></tr></thead>
              <tbody>{BENCH_STATS.map((k) => (
                <tr key={k}><td>{LABEL[k]}</td><td className="num">{fmt(cur[k])}</td>
                  <td><span className={"pill " + tone(r.topPct[k])}>Top {r.topPct[k]}%</span></td>
                  <td className="num">{fmt(r.median[k])}</td><td className="num">{fmt(r.topCohortMedian[k])}</td><td className="num">{fmt(r.eliteCohortMedian[k])}</td></tr>
              ))}</tbody>
            </table>
          </Section>
          <div className="grid g2">
            <Section title="Most common sets">
              <table><tbody>{r.commonSets.map((s) => <tr key={s.sets}><td>{s.sets}</td><td style={{ width: "45%" }}><div className="bar"><span style={{ width: pct(s.share) }} /></div></td><td className="num">{pct(s.share)}</td></tr>)}</tbody></table>
            </Section>
            <Section title="Within your account">
              <p>Speed: faster than {100 - localTop("spd")}% of your heroes' current builds.</p>
              <p>Gear score: higher than {100 - localTop("gs")}% of your heroes.</p>
              <p className="muted" style={{ fontSize: 12 }}>Most common artifacts: {r.commonArtifacts.length ? r.commonArtifacts.map((a, i) => {
                const name = artifactName(a.code);
                return <span key={a.code} title={init.gameData.artifactInfo?.[name]?.effect}>{i ? ", " : ""}{name} ({pct(a.share)})</span>;
              }) : "—"}</p>
            </Section>
          </div>
        </>
      )}
      {!r && !busy && hero && <div className="card empty">No community data loaded for {hero.name}.</div>}
    </div>
    </div>
  );
}
