import React, { useEffect, useState } from "react";
import { useForge } from "../state";
import { HeroRoster } from "../HeroRoster";
import { AddPlanningHero, HeroHeader } from "../HeroDetail";
import { Busy, fmt, ItemSummary, NoAccount, Num, Section, SetPicker, StatLine, Toggle, SlotLabel, SetIcons, SortTh, useSort, statShort } from "../components";
import { SLOT_MAINS, STAT_LABEL } from "../../engine/constants";
import { baseRequest, detectArchetype, type Archetype } from "../../engine/recommend";
import { targetMatch, type StatKey } from "../../engine/optimizer";
import { benchmark, eliteProfile, type EliteProfile } from "../../engine/benchmark";
import { GEAR_SLOTS, type Build, type GearSlot, type OptimizeRequest, type StatType } from "../../engine/types";

const WEIGHT_KEYS: { k: StatKey; label: string }[] = [
  { k: "spd", label: "Speed" }, { k: "atk", label: "Attack" }, { k: "hp", label: "HP" }, { k: "def", label: "Defense" },
  { k: "cr", label: "Crit" }, { k: "cd", label: "Crit Dmg" }, { k: "eff", label: "Eff" }, { k: "res", label: "Res" },
  { k: "cp", label: "CP" }, { k: "ehp", label: "Eff. HP" }, { k: "dmg", label: "Avg dmg" }, { k: "s3", label: "S3 dmg" }, { k: "gs", label: "Gear score" },
];
const BOUND_KEYS: StatKey[] = ["spd", "atk", "hp", "def", "cr", "cd", "eff", "res", "ehp", "cp"];

const PRIORITY_STATS: { k: StatKey; label: string }[] = [
  { k: "spd", label: "Speed" }, { k: "atk", label: "Attack" }, { k: "hp", label: "Health" }, { k: "def", label: "Defense" },
  { k: "cr", label: "Crit Chance" }, { k: "cd", label: "Crit Damage" }, { k: "eff", label: "Effectiveness" }, { k: "res", label: "Effect Resist" },
];
const TARGET_KEYS: StatKey[] = ["spd", "atk", "hp", "def", "cr", "cd", "eff", "res"];
const DEFAULT_PRIORITIES: Record<Archetype, StatKey[]> = {
  crit_dps: ["spd", "cr", "cd", "atk"], speed_dps: ["spd", "cr", "cd", "atk"], hp_bruiser: ["spd", "hp", "cr", "cd"],
  def_bruiser: ["spd", "def", "cr", "cd"], debuffer: ["spd", "eff", "hp"], support: ["spd", "hp", "def", "res"], tank: ["hp", "def", "res", "spd"],
};

export default function OptimizerPage() {
  const { account, pageArg, heroById, hd, stats, api, toast, itemById, heroId, setHeroId } = useForge();
  const [weights, setWeights] = useState<Partial<Record<StatKey, number>>>({ spd: 1 });
  const [min, setMin] = useState<Partial<Record<StatKey, number>>>({});
  const [max, setMax] = useState<Partial<Record<StatKey, number>>>({});
  const [sets, setSets] = useState<string[][]>([]);
  const [mains, setMains] = useState<Partial<Record<GearSlot, StatType[]>>>({});
  const [allowEquipped, setAllowEquipped] = useState(false);
  const [predict, setPredict] = useState(false);
  const [minEnhance, setMinEnhance] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [res, setRes] = useState<any>(null);
  const [pick, setPick] = useState(0);
  const [mode, setMode] = useState<"bench" | "custom">(() => { try { return localStorage.getItem("optMode") === "custom" ? "custom" : "bench"; } catch { return "bench"; } });
  const [community, setCommunity] = useState<{ builds: any[]; fetchedAt: string; cached: boolean } | null>(null);
  const [commErr, setCommErr] = useState<string | null>(null);
  const [commBusy, setCommBusy] = useState(false);
  const [priorities, setPriorities] = useState<StatKey[]>([]);
  const [targetOverride, setTargetOverride] = useState<Partial<Record<StatKey, number>>>({});
  const [useSets, setUseSets] = useState(true);
  const [comboPick, setComboPick] = useState<number[]>([0]);
  const [ranMode, setRanMode] = useState<"bench" | "custom">("bench");

  useEffect(() => { if (typeof pageArg === "string") setHeroId(pageArg); }, [pageArg]);
  useEffect(() => api.on("job:progress", (p) => setProgress((x) => Math.max(x, p.nodes ?? 0))), [api]);
  const hero = heroId ? heroById.get(heroId) : undefined;
  const cur = hero ? stats(hero) : null;

  useEffect(() => { try { localStorage.setItem("optMode", mode); } catch { /* ignore */ } }, [mode]);
  const loadCommunity = async (refresh = false) => {
    if (!hero) return;
    setCommBusy(true); setCommErr(null);
    try { setCommunity(await api.community({ hero: hero.dataKey || hero.name, refresh })); }
    catch (e: any) { setCommunity(null); setCommErr(e.message); }
    finally { setCommBusy(false); }
  };
  useEffect(() => {
    setCommunity(null); setCommErr(null); setTargetOverride({}); setComboPick([0]);
    if (!hero) return;
    const d = hd(hero);
    setPriorities(d ? DEFAULT_PRIORITIES[detectArchetype(d).archetype] : ["spd"]);
    if (mode === "bench") loadCommunity();
  }, [heroId]);
  useEffect(() => { if (mode === "bench" && hero && !community && !commBusy && !commErr) loadCommunity(); }, [mode]);

  const profile: EliteProfile | null = community?.builds?.length ? eliteProfile(community.builds, 0.01) : null;
  const targets = profile ? Object.fromEntries(TARGET_KEYS.map((k) => [k, targetOverride[k] ?? profile.targets[k as keyof EliteProfile["targets"]]])) as Partial<Record<StatKey, number>> : null;
  const togglePriority = (k: StatKey) => setPriorities((p) => (p.includes(k) ? (p.length > 1 ? p.filter((x) => x !== k) : p) : p.length < 4 ? [...p, k] : p));

  const preset = () => {
    if (!hero) return;
    const d = hd(hero);
    if (!d || !cur) return;
    const r = baseRequest(hero, d, cur);
    setWeights(r.weights); setMin(r.min); setMax({});
    toast(`Preset: ${r.reasons[0]}`);
  };

  const run = async () => {
    if (!hero) return;
    setBusy(true); setRes(null); setProgress(0); setPick(0); setRanMode(mode);
    try {
      if (mode === "custom") {
        const request: OptimizeRequest = { heroId: hero.id, weights, min: clean(min), max: clean(max), sets, mains, allowEquipped, predictUpgrades: predict, minEnhance, limit: 50 };
        setRes(await api.optimize({ request }));
        return;
      }
      if (!targets) throw new Error("Community builds aren't loaded for this hero. Refresh, or switch to Custom.");
      const comboSets = useSets && profile ? comboPick.map((i) => profile.setCombos[i]?.sets).filter(Boolean) as string[][] : [];
      const request: OptimizeRequest = {
        heroId: hero.id, targets: { stats: targets, priorities }, sets: comboSets, mains, allowEquipped, predictUpgrades: predict, minEnhance, limit: 50,
      };
      let out = await api.optimize({ request });
      if (!out.builds.length && comboSets.length) {
        out = await api.optimize({ request: { ...request, sets: [] } });
        toast("No build with the top players' sets; showing the closest match with any sets.");
      }
      setRes(out);
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };

  const indexed = React.useMemo(() => (res?.builds ?? []).map((bb: Build, i: number) => ({ bb, i })), [res]);
  const rSort = useSort(indexed, {
    score: (r: any) => r.bb.score, sets: (r: any) => r.bb.sets.join(" "),
    ...Object.fromEntries(["spd", "atk", "hp", "def", "cr", "cd", "eff", "res", "gs"].map((k) => [k, (r: any) => r.bb.stats[k]])),
  }, { key: "score", dir: -1 });
  if (!account) return <NoAccount />;
  const b: Build | undefined = res?.builds?.[pick];

  return (
    <div className="with-roster">
    <div className="stack" style={{ gap: 8 }}>
      <HeroRoster mode="single" selected={heroId} onSelect={(id) => { setHeroId(id); setRes(null); }} height="calc(100vh - 400px)" />
      <AddPlanningHero />
    </div>
    <div className="stack">
      <div><h1>Hero Optimizer</h1><p className="sub">{mode === "bench"
        ? "Benchmark mode: matches your gear to the top 1% of community builds for this hero, weighted by the stats you prioritise."
        : `Custom mode: weights pick what “best” means; bounds are hard limits. Split over ${useForge().init.workers} threads.`}</p></div>
      <div className="row">
        {!hero && <span className="muted">Pick a hero from your roster on the left.</span>}
        <Toggle on={mode === "custom"} onChange={(v) => { setMode(v ? "custom" : "bench"); setRes(null); }} label="Custom" />
        {mode === "custom" && <button disabled={!hero} onClick={preset}>Suggested preset</button>}
        <span style={{ flex: 1 }} />
        {busy ? <Busy label={`Searching… ${fmt(progress)} nodes`} /> : <button className="primary" disabled={!hero} onClick={run}>Optimize</button>}
      </div>
      {hero && <HeroHeader heroId={hero.id} />}

      {mode === "bench" && hero && (
        <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)" }}>
          <Section title="Stat priorities" right={<span className="muted">{priorities.length} of 4</span>}>
            <div className="prio-grid">{PRIORITY_STATS.map(({ k, label }) => {
              const rank = priorities.indexOf(k);
              return (
                <button key={k} type="button" className={"prio-btn" + (rank >= 0 ? " on" : "") + (rank < 0 && priorities.length >= 4 ? " dim" : "")} onClick={() => togglePriority(k)}>
                  {rank >= 0 && <span className="prio-rank">{rank + 1}</span>}{label}
                </button>
              );
            })}</div>
            <p className="muted" style={{ fontSize: 12 }}>Pick 1–4 in order of importance (weights 4 / 3 / 2 / 1). Click again to remove. Unpicked stats still count a little so the rest of the build tracks the top 1% too.</p>
          </Section>
          <Section title="Top 1% targets" right={commBusy ? <Busy label="Loading builds…" /> : <button className="small ghost" onClick={() => loadCommunity(true)}>Refresh</button>}>
            {commErr && <div style={{ color: "var(--bad)" }}>{commErr} <a onClick={() => setMode("custom")}>Use Custom</a></div>}
            {profile && targets && (
              <>
                <table>
                  <thead><tr><th>Stat</th><th className="num">Top 1%</th><th className="num">Now</th><th className="num">Target</th></tr></thead>
                  <tbody>{TARGET_KEYS.map((k) => {
                    const pri = priorities.indexOf(k);
                    return (
                      <tr key={k} style={{ opacity: pri >= 0 || (targets[k] ?? 0) > 0 ? 1 : 0.5 }}>
                        <td>{pri >= 0 && <span className="prio-rank sm">{pri + 1}</span>}{PRIORITY_STATS.find((p) => p.k === k)!.label}</td>
                        <td className="num muted">{fmt(profile.targets[k as keyof EliteProfile["targets"]])}</td>
                        <td className="num">{fmt(cur?.[k] as number)}</td>
                        <td className="num"><Num value={targets[k]} width={92} onChange={(v) => setTargetOverride({ ...targetOverride, [k]: v })} /></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
                <p className="muted" style={{ fontSize: 12 }}>Median of the top {profile.cohort} of {profile.sample} recent builds by gear score · {community!.cached ? "cached" : "fresh"} {new Date(community!.fetchedAt).toLocaleDateString()}. Edit a target to override it.</p>
              </>
            )}
          </Section>
          <Section title="Sets & gear">
            <div className="col">
              <Toggle on={useSets} onChange={setUseSets} label="Use the top builds' sets" />
              {useSets && profile && (profile.setCombos.length ? profile.setCombos.slice(0, 4).map((c, i) => {
                const on = comboPick.includes(i);
                return (
                  <span key={i} className={"combo" + (on ? " on" : "")} style={{ cursor: "pointer" }}
                    onClick={() => setComboPick((p) => (on ? (p.length > 1 ? p.filter((x) => x !== i) : p) : [...p, i]))}>
                    <SetIcons sets={c.sets} size={18} /><span className="muted">{Math.round(c.share * 100)}% of top 1%</span>
                  </span>
                );
              }) : <span className="muted">No common set combo in the cohort.</span>)}
              <Toggle on={allowEquipped} onChange={setAllowEquipped} label="Use gear from other heroes" />
              <Toggle on={predict} onChange={setPredict} label="Predict unfinished gear at +15 (and reforge 85s)" />
            </div>
          </Section>
        </div>
      )}

      {mode === "custom" && <div className="grid g3">
        <Section title="Weights (what to maximize)">
          <div className="grid g2">{WEIGHT_KEYS.map(({ k, label }) => (
            <label key={k} className="field">{label}<Num value={weights[k]} step={0.1} onChange={(v) => setWeights({ ...weights, [k]: v })} /></label>
          ))}</div>
        </Section>
        <Section title="Bounds (min / max)">
          <table><tbody>{BOUND_KEYS.map((k) => (
            <tr key={k}><td>{statShort(k)}</td><td><Num value={min[k]} placeholder="min" onChange={(v) => setMin({ ...min, [k]: v })} /></td><td><Num value={max[k]} placeholder="max" onChange={(v) => setMax({ ...max, [k]: v })} /></td></tr>
          ))}</tbody></table>
        </Section>
        <Section title="Gear filters">
          <div className="col">
            <h3>Sets</h3><SetPicker value={sets} onChange={setSets} />
            <h3 style={{ marginTop: 8 }}>Main stats</h3>
            {(["Necklace", "Ring", "Boots"] as GearSlot[]).map((slot) => (
              <div key={slot} className="row"><span style={{ width: 96 }} className="muted"><SlotLabel slot={slot} /></span>
                {SLOT_MAINS[slot].map((m) => {
                  const on = mains[slot]?.includes(m) ?? false;
                  return <span key={m} className="tag" style={{ cursor: "pointer", background: on ? "#3a3220" : undefined, color: on ? "var(--accent)" : undefined }}
                    onClick={() => setMains({ ...mains, [slot]: on ? mains[slot]!.filter((x) => x !== m) : [...(mains[slot] ?? []), m] })}>{STAT_LABEL[m]}</span>;
                })}
              </div>
            ))}
            <Toggle on={allowEquipped} onChange={setAllowEquipped} label="Use gear from other heroes" />
            <Toggle on={predict} onChange={setPredict} label="Predict unfinished gear at +15 (and reforge 85s)" />
            <label className="field">Minimum enhance<Num value={minEnhance} onChange={(v) => setMinEnhance(v ?? 0)} /></label>
          </div>
        </Section>
      </div>}

      {res && (
        <Section title={`Results (${res.builds.length})`} right={<span className="muted">{fmt(res.nodes)} nodes · {fmt(res.ms / 1000, 1)} s · {res.workers} threads{res.truncated ? " · time limit hit (best found so far)" : ""}</span>}>
          {!res.builds.length ? <div className="empty">No build meets these bounds. Loosen a minimum or allow equipped gear.</div> : (
            <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)" }}>
              <div className="scroll">
                <table>
                  <thead><tr><SortTh k="score" label={ranMode === "bench" ? "Match %" : "Score"} num sort={rSort.sort} onSort={rSort.toggle} /><SortTh k="sets" label="Sets" text sort={rSort.sort} onSort={rSort.toggle} />{["spd", "atk", "hp", "def", "cr", "cd", "eff", "res", "gs"].map((k) => <SortTh key={k} k={k} label={k.toUpperCase()} num sort={rSort.sort} onSort={rSort.toggle} />)}</tr></thead>
                  <tbody>{rSort.sorted.map(({ bb, i }: { bb: Build; i: number }) => (
                    <tr key={i} className={i === pick ? "sel" : ""} onClick={() => setPick(i)} style={{ cursor: "pointer" }}>
                      <td className="num">{fmt(bb.score, 1)}</td><td><SetIcons sets={bb.sets} /></td>
                      {(["spd", "atk", "hp", "def", "cr", "cd", "eff", "res", "gs"] as const).map((k) => <td key={k} className="num">{fmt(bb.stats[k])}</td>)}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {b && (
                <div className="col">
                  <StatLine s={b.stats} compare={cur} />
                  {ranMode === "bench" && targets && <TargetCompare build={b.stats} current={cur} targets={targets} priorities={priorities} builds={community?.builds ?? []} />}
                  <table><tbody>{GEAR_SLOTS.map((s) => {
                    const it = itemById.get(b.items[s] ?? "");
                    const owner = it?.equippedById && it.equippedById !== hero!.id ? heroById.get(it.equippedById)?.name : null;
                    return <tr key={s}><td className="muted"><SlotLabel slot={s} /></td><td><ItemSummary item={it} />{owner && <span className="pill warn" style={{ marginLeft: 6 }}>from {owner}</span>}</td></tr>;
                  })}</tbody></table>
                  <div className="row"><button className="primary" onClick={async () => { await api.applyBuilds([b]); toast("Build saved to your plan (re-gear in game to match)"); }}>Save as planned build</button></div>
                </div>
              )}
            </div>
          )}
        </Section>
      )}
    </div>
    </div>
  );
}

function clean<T extends Record<string, number | undefined>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && !isNaN(v as number))) as T;
}

function TargetCompare({ build, current, targets, priorities, builds }: { build: any; current: any; targets: Partial<Record<StatKey, number>>; priorities: StatKey[]; builds: any[] }) {
  const m = targetMatch(build, { stats: targets, priorities });
  const top = builds.length ? benchmark(build, builds).topPct : null;
  return (
    <table className="compare">
      <thead><tr><th>Stat</th><th className="num">Target</th><th className="num">Build</th><th className="num">Now</th><th>Reached</th>{top && <th className="num">Community</th>}</tr></thead>
      <tbody>{TARGET_KEYS.filter((k) => (targets[k] ?? 0) > 0).map((k) => {
        const r = m.perStat[k] ?? 0; const pri = priorities.indexOf(k);
        return (
          <tr key={k}>
            <td>{pri >= 0 && <span className="prio-rank sm">{pri + 1}</span>}{statShort(k)}</td>
            <td className="num muted">{fmt(targets[k])}</td><td className="num">{fmt(build[k])}</td><td className="num muted">{fmt(current?.[k])}</td>
            <td style={{ width: "28%" }}><div className="bar"><span style={{ width: `${Math.min(100, r * 100)}%`, background: r >= 1 ? "var(--good)" : undefined }} /></div></td>
            {top && <td className="num">Top {top[k as keyof typeof top]}%</td>}
          </tr>
        );
      })}</tbody>
    </table>
  );
}
