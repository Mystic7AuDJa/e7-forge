import React, { useMemo, useState } from "react";
import { useForge } from "../state";
import { Busy, fmt, HeroIcon, HeroName, HeroSelect, ItemSummary, NoAccount, Num, pct, Section, SetIcons, SlotLabel } from "../components";
import { ARENA_BANDS, bandForPoints, COUNTER_TEAM_SIZE, GW_BANDS, type Band, type CounterMode } from "../../engine/counters";
import { TAG_LABELS } from "../../engine/tagger";
import { GEAR_SLOTS } from "../../engine/types";
import { classLabel, elementLabel } from "../../engine/labels";
import { ImprintAuras } from "./metaShared";

export default function CountersPage() {
  const { account, api, toast, init, heroById, itemById } = useForge();
  const [mode, setMode] = useState<CounterMode>("arena");
  const [enemy, setEnemy] = useState<string[]>(["", "", "", ""]);
  const [points, setPoints] = useState<number | undefined>(4000);
  const [gwTier, setGwTier] = useState("Mid ranks");
  const [bandOverride, setBandOverride] = useState<Band | null>(null);
  const [must, setMust] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [res, setRes] = useState<any>(null);
  const [plan, setPlan] = useState<{ teamIdx: number; data: any } | null>(null);
  const names = useMemo(() => Object.keys(init.gameData.herodata).sort(), [init.gameData.herodata]);
  const nameSet = useMemo(() => new Set(names), [names]);
  if (!account) return <NoAccount />;

  const size = COUNTER_TEAM_SIZE[mode];
  const autoBand: Band = mode === "arena" ? bandForPoints(points ?? 0) : GW_BANDS[gwTier];
  const band = bandOverride ?? autoBand;
  const picked = enemy.slice(0, size).filter((n) => nameSet.has(n));

  const setMode2 = (m: CounterMode) => { setMode(m); setEnemy((e) => [...e, "", "", "", ""].slice(0, 4)); setRes(null); setPlan(null); setBandOverride(null); };

  const analyze = async () => {
    if (picked.length < size) { toast(`Enter all ${size} enemy heroes (names from the list).`, true); return; }
    setRes(null); setPlan(null);
    setBusy("Pulling community builds for the enemy team…");
    const enemies = await Promise.all(picked.map(async (name) => {
      try { return { name, band, builds: (await api.community({ hero: name })).builds }; }
      catch { return { name, band, builds: [] }; }
    }));
    const missing = enemies.filter((e) => !e.builds.length).map((e) => e.name);
    if (missing.length) toast(`No community builds for ${missing.join(", ")}: using base-stat estimates for them.`, true);
    setBusy("Scoring counter teams from your roster…");
    try { setRes(await api.counters({ mode, enemies, mustInclude: must, rng: 0.05 })); }
    catch (e: any) { toast(e.message, true); }
    finally { setBusy(""); }
  };

  const planGear = async (i: number) => {
    const t = res.teams[i];
    // Give your fastest hero a speed floor that beats the enemy's fastest through speed RNG.
    const fastest = t.race.perHero.reduce((a: any, b: any) => (b.spd > a.spd ? b : a), t.race.perHero[0]);
    const idx = t.race.perHero.indexOf(fastest);
    const minSpeed = { [t.heroIds[idx]]: t.race.needed };
    setBusy("Building gear for the counter team…");
    try {
      let data = await api.planTeam({ heroIds: t.heroIds, allowEquipped: true, minSpeed });
      if (!data.account.assignments.find((x: any) => x.heroId === t.heroIds[idx])?.build) {
        toast(`No gear gets ${fastest.name} to ${t.race.needed} speed; showing the best build without the speed floor.`, true);
        data = await api.planTeam({ heroIds: t.heroIds, allowEquipped: true });
      }
      setPlan({ teamIdx: i, data });
    }
    catch (e: any) { toast(e.message, true); } finally { setBusy(""); }
  };

  return (
    <div className="stack">
      <div>
        <h1>Offense (Counter Planner)</h1>
        <p className="sub">Enter an enemy defense. Their builds are estimated from community builds in the gear-score band that matches their arena points, then teams from your roster are ranked by how well they answer the enemy kit, take the first turn and match elements.</p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)" }}>
        <Section title="Enemy defense" right={<div className="row">
          <select value={mode} onChange={(e) => setMode2(e.target.value as CounterMode)}>
            <option value="arena">Arena (4 heroes)</option><option value="gw">Guild War (3 heroes)</option>
          </select>
        </div>}>
          <datalist id="all-heroes">{names.map((n) => <option key={n} value={n} />)}</datalist>
          <div className="enemy-grid" style={{ gridTemplateColumns: `repeat(${size}, minmax(0,1fr))` }}>
            {Array.from({ length: size }, (_, i) => {
              const v = enemy[i] ?? "";
              const ok = nameSet.has(v);
              return (
                <div key={i} className={"enemy-slot" + (ok ? " ok" : "")}>
                  {ok ? <span className="hero-cell big"><HeroIcon name={v} /></span> : <span className="enemy-empty">{i + 1}</span>}
                  <input list="all-heroes" placeholder="Type a hero…" value={v} onChange={(e) => { const a = [...enemy]; a[i] = e.target.value; setEnemy(a); }} />
                  {ok && <span className="muted" style={{ fontSize: 11 }}>{elementLabel(init.gameData.herodata[v]?.attribute)} · {classLabel(init.gameData.herodata[v]?.role)}</span>}
                </div>
              );
            })}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            {mode === "arena" ? (
              <label className="field">Their arena points<Num value={points} width={100} onChange={(v) => { setPoints(v); setBandOverride(null); }} /></label>
            ) : (
              <label className="field">Guild War bracket
                <select value={gwTier} onChange={(e) => { setGwTier(e.target.value); setBandOverride(null); }}>{Object.keys(GW_BANDS).map((k) => <option key={k}>{k}</option>)}</select>
              </label>
            )}
            <label className="field">Estimated gear band (top %)
              <span className="row" style={{ gap: 4 }}>
                <Num value={band.from} width={60} onChange={(v) => setBandOverride({ ...band, from: Math.max(0, v ?? 0), label: "custom" })} />–
                <Num value={band.to} width={60} onChange={(v) => setBandOverride({ ...band, to: Math.min(100, v ?? 100), label: "custom" })} />%
              </span>
            </label>
            <label className="field">Must include (yours)<HeroSelect value={null} onChange={(id) => setMust([...new Set([...must, id])].slice(0, size - 1))} placeholder="Optional…" /></label>
            {must.map((id) => <span key={id} className="tag">{heroById.get(id)?.name} <a onClick={() => setMust(must.filter((x) => x !== id))}>×</a></span>)}
            <span style={{ flex: 1 }} />
            {busy ? <Busy label={busy} /> : <button className="primary" onClick={analyze}>Find counters</button>}
          </div>
          {mode === "arena" && (
            <p className="muted" style={{ fontSize: 12 }}>Community builds have no rank field, so points map to a gear-score band: {ARENA_BANDS.map((b) => `${b.minPts}+ → ${b.band.label}`).join(" · ")}. Adjust the band if your experience differs.</p>
          )}
        </Section>

        <Section title="Threat breakdown">
          {!res ? <span className="muted">Run “Find counters” to see what the enemy kit does and what beats it.</span> : res.threats.length === 0
            ? <span className="muted">No notable threats detected from the enemy's skill tags.</span>
            : res.threats.map((t: any) => (
              <div key={t.id} className="threat">
                <div className="row" style={{ justifyContent: "space-between" }}><b>{t.label}</b><span className="muted">{t.heroes.join(", ")}</span></div>
                <div className="muted" style={{ fontSize: 12.5 }}>{t.advice}</div>
                <div style={{ marginTop: 4 }}>Answered by: {t.answers.map((a: string) => <span key={a} className="tag">{TAG_LABELS[a] ?? a}</span>)}</div>
              </div>
            ))}
        </Section>
      </div>

      {res && (
        <Section title="Estimated enemy builds" right={<span className="muted">Band: top {band.from}–{band.to}% of community builds by gear score · estimate</span>}>
          <table>
            <thead><tr><th>Hero</th><th className="num">Spd</th><th className="num">Spd range</th><th className="num">Atk</th><th className="num">HP</th><th className="num">Def</th><th className="num">CR</th><th className="num">CD</th><th className="num">Eff</th><th className="num">Res</th><th>Common sets</th><th className="num">Builds in band</th></tr></thead>
            <tbody>{res.estimates.map((e: any) => (
              <tr key={e.name}>
                <td><span className="hero-cell"><HeroIcon name={e.name} />{e.name}</span></td>
                <td className="num" style={{ color: "var(--accent)" }}>{fmt(e.stats.spd)}</td><td className="num muted">{e.spdRange[0]}–{e.spdRange[1]}</td>
                <td className="num">{fmt(e.stats.atk)}</td><td className="num">{fmt(e.stats.hp)}</td><td className="num">{fmt(e.stats.def)}</td>
                <td className="num">{e.stats.cr}</td><td className="num">{e.stats.cd}</td><td className="num">{e.stats.eff}</td><td className="num">{e.stats.res}</td>
                <td>{e.sets[0] ? <SetIcons sets={e.sets[0].sets} /> : <span className="muted">—</span>}</td>
                <td className="num muted">{e.bandSize ? `${e.bandSize} of ${e.sample}` : "base stats"}</td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      )}

      {res && (
        <div className="grid g2">{res.teams.length === 0 ? <div className="card empty">No team found. Add more heroes to your roster or remove “must include”.</div> : res.teams.map((t: any, i: number) => (
          <div key={i} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>#{i + 1}</h2>
              <span className={"pill " + (t.outlook >= 70 ? "good" : t.outlook >= 50 ? "info" : "warn")} title="Heuristic from threat coverage, first-turn odds, gear readiness and elements. Not a win rate.">Outlook {t.outlook}/100 (estimate)</span>
            </div>
            <div className="col" style={{ margin: "10px 0" }}>{t.heroIds.map((id: string, k: number) => (
              <div key={id} className="row" style={{ justifyContent: "space-between" }}>
                <HeroName hero={heroById.get(id)!} />
                <span className="muted mono">Spd {t.race.perHero[k].spd} · beats {t.race.enemyFastest.name} {pct(t.race.perHero[k].beatsFastest)}</span>
              </div>
            ))}</div>
            <div className="row mono" style={{ gap: 16, fontSize: 12.5 }}>
              <span>First turn: <b style={{ color: t.race.firstTurn >= 0.6 ? "var(--good)" : "var(--warn)" }}>{pct(t.race.firstTurn)}</b></span>
              <span>All act before enemy: {pct(t.race.allBeforeEnemy)}</span>
              <span>Elements: +{t.elementAdv} / −{t.elementDisadv}</span>
            </div>
            <div className="timeline" style={{ margin: "8px 0" }}>{t.race.sample.slice(0, 8).map((e: any, k: number) => <div key={k} className={"t" + (e.side === "enemy" ? " enemy" : "")}>{k + 1}. {e.name}</div>)}</div>
            {t.reasons.map((r: string, k: number) => <div key={k} className="reason">{r}</div>)}
            {t.unanswered.length > 0 && <div className="reason" style={{ borderColor: "var(--bad)" }}>Not answered: {t.unanswered.join("; ")}</div>}
            <ImprintAuras ids={t.heroIds} />
            <button className="small primary" style={{ marginTop: 10 }} disabled={!!busy} onClick={() => planGear(i)}>Plan gear for this team</button>
          </div>
        ))}</div>
      )}

      {plan && res && (
        <Section title={`Gear plan for #${plan.teamIdx + 1}`} right={<button className="small primary" onClick={async () => { await api.applyBuilds(plan.data.account.assignments.filter((a: any) => a.build).map((a: any) => a.build)); toast("Counter team builds saved to your plan"); }}>Save all as planned</button>}>
          <p className="muted" style={{ marginTop: 0 }}>Your fastest hero was given a speed floor of {res.teams[plan.teamIdx].race.needed} to outspeed {res.teams[plan.teamIdx].race.enemyFastest.name} (est. {res.teams[plan.teamIdx].race.enemyFastest.spd}) through speed RNG. If no gear reaches it, the best available build is used.</p>
          <table><thead><tr><th>#</th><th>Hero</th><th>Biggest gap</th></tr></thead>
            <tbody>{plan.data.upgradePriority.map((p: any, i: number) => <tr key={p.heroId}><td>{i + 1}</td><td>{p.name}</td><td>{p.reason}</td></tr>)}</tbody></table>
          <div className="grid g2" style={{ marginTop: 12 }}>{plan.data.account.assignments.map((a: any) => (
            <div key={a.heroId} className="card" style={{ background: "var(--panel-2)" }}>
              <HeroName hero={heroById.get(a.heroId)!} />
              {a.build ? <>
                <div className="mono" style={{ margin: "6px 0" }}>SPD {a.build.stats.spd} · CR {a.build.stats.cr} · CD {a.build.stats.cd} · EFF {a.build.stats.eff} · RES {a.build.stats.res} · HP {fmt(a.build.stats.hp)}</div>
                <table><tbody>{GEAR_SLOTS.map((s) => <tr key={s}><td className="muted"><SlotLabel slot={s} /></td><td><ItemSummary item={itemById.get(a.build.items[s])} /></td></tr>)}</tbody></table>
              </> : <span style={{ color: "var(--bad)" }}>{a.note}</span>}
            </div>
          ))}</div>
          {plan.data.account.violations.map((v: string, i: number) => <div key={i} className="reason" style={{ borderColor: "var(--warn)" }}>{v}</div>)}
        </Section>
      )}
    </div>
  );
}
