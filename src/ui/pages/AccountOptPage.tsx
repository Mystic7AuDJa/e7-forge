import React, { useEffect, useState } from "react";
import { HeroRoster } from "../HeroRoster";
import { useForge } from "../state";
import { Busy, fmt, HeroName, HeroSelect, ItemSummary, NoAccount, Num, Section, Toggle, SlotLabel, SetIcons } from "../components";
import { baseRequest } from "../../engine/recommend";
import type { OptimizeRequest } from "../../engine/types";
import { GEAR_SLOTS } from "../../engine/types";

interface Row { heroId: string; priority: number; request: OptimizeRequest; note: string }

export default function AccountOptPage() {
  const { account, heroById, hd, stats, api, toast, itemById, checked, setChecked, pageArg } = useForge();
  const [rows, setRows] = useState<Row[]>([]);
  const [objective, setObjective] = useState<"balanced" | "power" | "gs">("balanced");
  const [penalty, setPenalty] = useState(0.02);
  const [takeOutside, setTakeOutside] = useState(false);
  const [rules, setRules] = useState<{ faster: string; slower: string; margin: number }[]>([]);
  const [rf, setRf] = useState<string | null>(null);
  const [rs, setRs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);

  // Rows follow the checked heroes (shared with other pages, e.g. PvP "Open in Account-Wide Optimizer").
  useEffect(() => {
    setRows((prev) => {
      const keep = prev.filter((r) => checked.includes(r.heroId));
      const add: Row[] = [];
      for (const id of checked) {
        if (keep.some((r) => r.heroId === id)) continue;
        const h = heroById.get(id); const d = h && hd(h); const s = h && stats(h);
        if (!h || !d || !s) continue;
        const b = baseRequest(h, d, s);
        add.push({ heroId: id, priority: 0, request: { ...b.request, limit: 60 }, note: b.reasons[0] });
      }
      const mins: Record<string, Record<string, number>> = pageArg?.mins ?? {};
      const withMins = (r: Row): Row => mins[r.heroId] ? { ...r, request: { ...r.request, min: { ...r.request.min, ...mins[r.heroId] } }, note: "Breakpoints from the PvE guide applied. " + r.note } : r;
      const all = [...keep, ...add].map(withMins).sort((a, b) => checked.indexOf(a.heroId) - checked.indexOf(b.heroId));
      return all.map((r, i) => ({ ...r, priority: r.priority || Math.max(1, all.length - i) }));
    });
    setRes(null);
  }, [checked, heroById, pageArg]);
  useEffect(() => { if (pageArg?.fromTeam) toast(`Opened with ${pageArg.fromTeam.length} heroes pre-selected`); }, [pageArg]);
  if (!account) return <NoAccount />;

  const upd = (i: number, f: (r: Row) => Row) => setRows(rows.map((r, j) => (j === i ? f(r) : r)));

  const run = async () => {
    setBusy(true); setRes(null);
    try {
      const out = await api.optimizeAccount({ request: {
        heroes: rows.map((r) => ({ request: { ...r.request, allowEquipped: takeOutside }, priority: r.priority })),
        objective, movePenalty: penalty, speedOrder: rules, buildsPerHero: 60,
      } });
      setRes(out);
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };

  return (
    <div className="with-roster">
    <HeroRoster mode="multi" checked={checked} onCheck={setChecked} title="Heroes to Gear" height="calc(100vh - 330px)" />
    <div className="stack">
      <div><h1>Account-Wide Optimizer</h1><p className="sub">Gear multiple heroes at once so they don't fight over the same gear. Higher priority wins conflicts; speed rules keep your tuning intact.</p></div>
      <Section title="Selected heroes" right={<span className="muted">Priority decides who wins shared gear</span>}>
        {!rows.length ? <span className="muted">Select heroes on the left to gear them together (e.g. your RTA roster). PvP and PvE pages can pre-select heroes here.</span> : (
          <table>
            <thead><tr><th>Hero</th><th className="num">Priority</th><th className="num">Min Spd</th><th className="num">Max Spd</th><th className="num">Min CR</th><th className="num">Min Eff</th><th>Profile</th><th /></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={r.heroId}>
                <td><HeroName hero={heroById.get(r.heroId)!} /></td>
                <td className="num"><Num value={r.priority} width={60} onChange={(v) => upd(i, (x) => ({ ...x, priority: v ?? 1 }))} /></td>
                {(["spd", "spd", "cr", "eff"] as const).map((k, j) => {
                  const isMax = j === 1;
                  const bag = isMax ? r.request.max ?? {} : r.request.min ?? {};
                  return <td key={j} className="num"><Num value={bag[k]} width={64} onChange={(v) => upd(i, (x) => ({ ...x, request: { ...x.request, [isMax ? "max" : "min"]: { ...(isMax ? x.request.max : x.request.min), [k]: v } } }))} /></td>;
                })}
                <td className="muted" style={{ whiteSpace: "normal", maxWidth: 280 }}>{r.note}</td>
                <td><a onClick={() => setChecked(checked.filter((x) => x !== r.heroId))}>Remove</a></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Section>
      <div className="grid g2">
        <Section title="Objective">
          <div className="col">
            <label className="field">Optimize for
              <select value={objective} onChange={(e) => setObjective(e.target.value as any)}>
                <option value="balanced">Average score (each hero vs. its own best)</option>
                <option value="power">Team power (sum of CP)</option>
                <option value="gs">Average gear score</option>
              </select>
            </label>
            <label className="field">Gear-move penalty (per item pulled from another hero)<Num value={penalty} step={0.01} onChange={(v) => setPenalty(v ?? 0)} /></label>
            <Toggle on={takeOutside} onChange={setTakeOutside} label="Allow taking gear from heroes not selected" />
          </div>
        </Section>
        <Section title="Preserve speed tuning">
          <div className="row">
            <HeroSelect value={rf} onChange={setRf} placeholder="Faster…" />
            <span className="muted">acts before</span>
            <HeroSelect value={rs} onChange={setRs} placeholder="Slower…" />
            <button className="small" disabled={!rf || !rs || rf === rs} onClick={() => { setRules([...rules, { faster: rf!, slower: rs!, margin: 0.05 }]); setRf(null); setRs(null); }}>Add rule</button>
          </div>
          <div style={{ marginTop: 8 }}>{rules.map((r, i) => (
            <div key={i} className="row"><span>{heroById.get(r.faster)?.name} → {heroById.get(r.slower)?.name}</span>
              <span className="muted">margin</span><Num value={Math.round(r.margin * 100)} width={56} onChange={(v) => setRules(rules.map((x, j) => (j === i ? { ...x, margin: (v ?? 0) / 100 } : x)))} />%
              <a onClick={() => setRules(rules.filter((_, j) => j !== i))}>Remove</a></div>
          ))}</div>
          <p className="muted" style={{ fontSize: 12 }}>5% margin guarantees the order through speed RNG. Use 0% to only require “faster”.</p>
        </Section>
      </div>
      <div className="row">{busy ? <Busy label="Gearing heroes…" /> : <button className="primary" disabled={rows.length < 1} onClick={run}>Gear heroes</button>}</div>
      {res && (
        <Section title="Results" right={<div className="row">
          <span className="pill info">Team score {fmt(res.teamScore, 2)}</span><span className="pill">CP {fmt(res.totalCp)}</span><span className="pill">Avg GS {res.avgGs}</span>
          <span className="pill warn">{res.movedItems} items taken from other heroes</span><span className="muted">{fmt(res.ms / 1000, 1)} s</span>
          <button className="primary small" onClick={async () => { await api.applyBuilds(res.assignments.filter((a: any) => a.build).map((a: any) => a.build)); toast("All builds saved to your plan"); }}>Save all as planned</button>
        </div>}>
          {res.violations.length > 0 && <div className="card" style={{ borderColor: "#6b2f2f", marginBottom: 10 }}>{res.violations.map((v: string, i: number) => <div key={i} style={{ color: "var(--bad)" }}>{v}</div>)}</div>}
          <div className="grid g2">{res.assignments.map((a: any) => {
            const h = heroById.get(a.heroId)!;
            return (
              <div key={a.heroId} className="card" style={{ background: "var(--panel-2)" }}>
                <div className="row" style={{ justifyContent: "space-between" }}><HeroName hero={h} /><span className="pill">{fmt(a.normScore * 100)}% of solo best</span></div>
                {a.note && <p className="muted">{a.note}</p>}
                {a.build ? (
                  <>
                    <div className="mono" style={{ margin: "8px 0" }}>Spd {a.build.stats.spd} · Atk {fmt(a.build.stats.atk)} · HP {fmt(a.build.stats.hp)} · Def {fmt(a.build.stats.def)} · CR {a.build.stats.cr} · CD {a.build.stats.cd} · Eff {a.build.stats.eff} · Res {a.build.stats.res}</div>
                    <table><tbody>{GEAR_SLOTS.map((s) => {
                      const id = a.build.items[s]; const mv = a.movedIn.find((m: any) => m.itemId === id && m.fromHeroId);
                      return <tr key={s}><td className="muted"><SlotLabel slot={s} /></td><td><ItemSummary item={itemById.get(id)} />{mv && <span className="pill warn" style={{ marginLeft: 6 }}>from {heroById.get(mv.fromHeroId)?.name}</span>}</td></tr>;
                    })}</tbody></table>
                  </>
                ) : <span style={{ color: "var(--bad)" }}>No valid build</span>}
              </div>
            );
          })}</div>
        </Section>
      )}
    </div>
    </div>
  );
}
