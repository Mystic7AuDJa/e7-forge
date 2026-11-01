import React, { useMemo, useState } from "react";
import { useForge } from "../state";
import { fmt, HeroSelect, Num, pct, Section, Toggle } from "../components";
import { validateTune, winSpeedRace, type TurnEffect, type Unit } from "../../engine/speedtune";

interface UnitRow extends Unit { push?: number; speedBuff?: boolean; crReduce?: number; speedDown?: boolean }

const toEffects = (u: UnitRow): TurnEffect[] => {
  const e: TurnEffect[] = [];
  if (u.push) e.push({ target: "allies_except_self", cr: u.push });
  if (u.speedBuff) e.push({ target: "allies", speedMod: 0.3, duration: 2 });
  if (u.crReduce) e.push({ target: "enemies", cr: -u.crReduce });
  if (u.speedDown) e.push({ target: "enemies", speedMod: -0.3, duration: 2 });
  return e;
};

export default function SpeedTunePage() {
  const { heroById, stats, settings, hd } = useForge();
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [pickHero, setPickHero] = useState<string | null>(null);
  const [enemyName, setEnemyName] = useState("Enemy");
  const [enemySpd, setEnemySpd] = useState<number | undefined>(250);
  const [rng, setRng] = useState(Math.round(settings.speedRng * 100));
  const [beforeEnemies, setBeforeEnemies] = useState(false);
  const [report, setReport] = useState<ReturnType<typeof validateTune> | null>(null);
  const allies = units.filter((u) => u.side === "ally");

  const addHero = (id: string) => {
    const h = heroById.get(id); if (!h) return;
    const s = stats(h); const d = hd(h);
    const tags = d?.tags ?? [];
    setUnits([...units, { id: h.id, name: h.name, spd: s?.spd ?? 200, side: "ally",
      push: tags.includes("cr_push") ? 20 : undefined, speedBuff: tags.includes("speed_buff") || undefined, crReduce: tags.includes("cr_reduce") ? 20 : undefined }]);
    setPickHero(null); setReport(null);
  };
  const upd = (i: number, p: Partial<UnitRow>) => { setUnits(units.map((u, j) => (j === i ? { ...u, ...p } : u))); setReport(null); };
  const move = (i: number, d: number) => { const a = [...units]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x); setUnits(a); setReport(null); };

  const run = () => {
    const us: Unit[] = units.map((u) => ({ id: u.id, name: u.name, spd: u.spd, side: u.side, effects: toEffects(u) }));
    setReport(validateTune(us, { order: allies.map((u) => u.id), beforeEnemies }, { rng: rng / 100, trials: 4000 }));
  };
  const [lo, hi] = settings.enemySpeed;
  const races = useMemo(() => allies.map((u) => ({ name: u.name, p: winSpeedRace(u.spd, lo, hi, rng / 100, 3000) })), [units, lo, hi, rng]);

  return (
    <div className="stack">
      <div><h1>Speed Tuning</h1><p className="sub">Models turn order with speed RNG (random 0–{rng}% starting CR), CR pushes, CR reductions and speed buffs/debuffs, then checks your intended opener order over thousands of fights.</p></div>
      <Section title="Units" right={<div className="row">
        <HeroSelect value={pickHero} onChange={addHero} placeholder="Add ally…" exclude={units.map((u) => u.id)} />
        <input style={{ width: 110 }} value={enemyName} onChange={(e) => setEnemyName(e.target.value)} />
        <Num value={enemySpd} width={70} onChange={setEnemySpd} />
        <button className="small" onClick={() => { setUnits([...units, { id: `e${Date.now()}`, name: enemyName, spd: enemySpd ?? 250, side: "enemy" }]); setReport(null); }}>Add enemy</button>
      </div>}>
        {!units.length ? <span className="muted">Add allies in the order you want them to act (opener first), and enemies you want to beat.</span> : (
          <table>
            <thead><tr><th>Order</th><th>Unit</th><th className="num">Speed</th><th className="num">Push allies %</th><th>Speed buff</th><th className="num">CR reduce %</th><th>Speed down</th><th /></tr></thead>
            <tbody>{units.map((u, i) => (
              <tr key={u.id}>
                <td>{u.side === "ally" ? <span className="pill info">#{allies.indexOf(u) + 1}</span> : <span className="pill bad">enemy</span>}</td>
                <td>{u.name}</td>
                <td className="num"><Num value={u.spd} width={70} onChange={(v) => upd(i, { spd: v ?? 0 })} /></td>
                <td className="num"><Num value={u.push} width={60} onChange={(v) => upd(i, { push: v })} /></td>
                <td><Toggle on={!!u.speedBuff} onChange={(v) => upd(i, { speedBuff: v })} /></td>
                <td className="num"><Num value={u.crReduce} width={60} onChange={(v) => upd(i, { crReduce: v })} /></td>
                <td><Toggle on={!!u.speedDown} onChange={(v) => upd(i, { speedDown: v })} /></td>
                <td className="row"><button className="small ghost" disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button className="small ghost" disabled={i === units.length - 1} onClick={() => move(i, 1)}>↓</button><a onClick={() => { setUnits(units.filter((_, j) => j !== i)); setReport(null); }}>×</a></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <span className="muted">Speed RNG</span><Num value={rng} width={56} onChange={(v) => setRng(v ?? 5)} />%
          <Toggle on={beforeEnemies} onChange={setBeforeEnemies} label="All allies must act before any enemy" />
          <span style={{ flex: 1 }} />
          <button className="primary" disabled={allies.length < 1} onClick={run}>Validate tune</button>
        </div>
      </Section>

      {report && (
        <div className="grid g2">
          <Section title="Results">
            <div className="big" style={{ color: report.successRate > 0.995 ? "var(--good)" : report.successRate > 0.9 ? "var(--warn)" : "var(--bad)" }}>{pct(report.successRate, 1)}</div>
            <p className="muted">of simulated fights follow your order</p>
            {report.warnings.length ? report.warnings.map((w, i) => <div key={i} className="reason" style={{ borderColor: "var(--warn)" }}>{w}</div>) : <div className="reason" style={{ borderColor: "var(--good)" }}>Order holds in every simulated fight.</div>}
            {report.pairFailures.length > 0 && (
              <table style={{ marginTop: 10 }}><thead><tr><th>Must act first</th><th>Cut by</th><th className="num">Fail rate</th><th className="num">Now</th><th className="num">Needed</th></tr></thead>
                <tbody>{report.pairFailures.map((p, i) => <tr key={i}><td>{p.first}</td><td>{p.second}</td><td className="num">{pct(p.failRate, 1)}</td><td className="num">{p.currentSpd}</td><td className="num" style={{ color: "var(--accent)" }}>{p.neededSpd}</td></tr>)}</tbody></table>
            )}
          </Section>
          <Section title="Sample fight (first turns)">
            <div className="timeline">{report.sample.map((e, i) => <div key={i} className={"t" + (e.side === "enemy" ? " enemy" : "")}>{i + 1}. {e.name}{e.turnNo > 1 ? ` (T${e.turnNo})` : ""}</div>)}</div>
          </Section>
        </div>
      )}

      {allies.length > 0 && (
        <Section title={`Opening speed race vs. enemies at ${lo}–${hi} speed`}>
          <table><tbody>{races.map((r) => <tr key={r.name}><td>{r.name}</td><td style={{ width: "60%" }}><div className="bar"><span style={{ width: pct(r.p) }} /></div></td><td className="num">{pct(r.p)}</td></tr>)}</tbody></table>
          <p className="muted" style={{ fontSize: 12 }}>Enemy speed band is set in Settings. Probability includes speed RNG on both sides.</p>
        </Section>
      )}
    </div>
  );
}
