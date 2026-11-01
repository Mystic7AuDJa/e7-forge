import React, { useEffect, useState } from "react";
import { useForge } from "../state";
import { HeroRoster } from "../HeroRoster";
import { HeroHeader } from "../HeroDetail";
import { Busy, fmt, ItemSummary, NoAccount, Section, StatLine, Toggle, SlotLabel, SetIcons, statShort } from "../components";
import { GEAR_SLOTS } from "../../engine/types";

export default function RecommendPage() {
  const { account, pageArg, heroById, stats, api, toast, settings, itemById, go , heroId, setHeroId } = useForge();
  const [useCommunity, setUseCommunity] = useState(true);
  const [allowEquipped, setAllowEquipped] = useState(false);
  const [busy, setBusy] = useState("");
  const [rec, setRec] = useState<any>(null);
  useEffect(() => { if (typeof pageArg === "string") setHeroId(pageArg); }, [pageArg]);
  if (!account) return <NoAccount />;
  const hero = heroId ? heroById.get(heroId) : undefined;

  const run = async () => {
    if (!hero) return;
    setRec(null);
    let community: any[] | undefined;
    if (useCommunity) {
      setBusy("Fetching community builds…");
      try { community = (await api.community({ hero: hero.dataKey || hero.name })).builds; } catch (e: any) { toast(`Community data unavailable: ${e.message}`, true); }
    }
    setBusy("Building recommendation…");
    const rosterSpeeds = Object.fromEntries(account.heroes.map((h) => [h.id, stats(h)?.spd ?? 0]));
    try { setRec(await api.recommend({ heroId: hero.id, community, enemySpeed: settings.enemySpeed, allowEquipped, rosterSpeeds })); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(""); }
  };

  return (
    <div className="with-roster">
    <HeroRoster mode="single" selected={heroId} onSelect={(id) => setHeroId(id)} />
    <div className="stack">
      <div><h1>Stat Recommendations</h1><p className="sub">Suggests target stats for a hero from its kit and the community, builds it from your gear, and explains why.</p></div>
      <div className="row">
        {!hero && <span className="muted">Pick a hero from your roster on the left.</span>}
        <Toggle on={useCommunity} onChange={setUseCommunity} label="Use community builds" />
        <Toggle on={allowEquipped} onChange={setAllowEquipped} label="Use gear from other heroes" />
        <span style={{ flex: 1 }} />
        {busy ? <Busy label={busy} /> : <button className="primary" disabled={!hero} onClick={run}>Recommend</button>}
      </div>
      {rec && hero && (
        <div className="grid g2">
          <Section title={`Suggested: ${rec.archetypeLabel}`}>
            <table>
              <thead><tr><th>Stat</th><th className="num">Target</th><th className="num">Now</th><th className="num">Gap</th></tr></thead>
              <tbody>{Object.entries(rec.targets).map(([k, v]) => {
                const now = rec.current[k] as number; const gap = (v as number) - now;
                return <tr key={k}><td>{statShort(k)}</td><td className="num" style={{ color: "var(--accent)" }}>{fmt(v as number)}</td><td className="num">{fmt(now)}</td><td className="num" style={{ color: gap > 0 ? "var(--warn)" : "var(--good)" }}>{gap > 0 ? "+" + fmt(gap) : "✓"}</td></tr>;
              })}</tbody>
            </table>
            <h3 style={{ marginTop: 14 }}>Reasoning</h3>
            {rec.reasons.map((r: string, i: number) => <div key={i} className="reason">{r}</div>)}
            {rec.relaxed.length > 0 && <><h3 style={{ marginTop: 12 }}>Relaxed to fit your gear</h3>{rec.relaxed.map((r: string, i: number) => <div key={i} className="reason" style={{ borderColor: "var(--warn)" }}>{r}</div>)}</>}
          </Section>
          <Section title="Build from your gear" right={rec.build && <div className="row">
            <button className="small" onClick={() => go("optimizer", hero.id)}>Open in Hero Optimizer</button>
            <button className="small primary" onClick={async () => { await api.applyBuilds([rec.build]); toast("Saved as planned build"); }}>Save as planned</button></div>}>
            {rec.build ? (
              <div className="col">
                <StatLine s={rec.build.stats} compare={rec.current} />
                <table><tbody>{GEAR_SLOTS.map((s) => <tr key={s}><td className="muted"><SlotLabel slot={s} /></td><td><ItemSummary item={itemById.get(rec.build.items[s])} /></td></tr>)}</tbody></table>
                <div className="row muted">Sets: <SetIcons sets={rec.build.sets} /></div>
              </div>
            ) : <div className="empty">No complete build with the current gear pool.</div>}
          </Section>
        </div>
      )}
    </div>
    </div>
  );
}
