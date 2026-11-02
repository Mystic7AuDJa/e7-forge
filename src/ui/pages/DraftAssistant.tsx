import React, { useMemo, useState } from "react";
import { useForge } from "../state";
import { fmt, HeroIcon, Section } from "../components";
import { banAdvice, nextTurn, recommendPicks, type DraftData, type DraftState, type Side } from "../../engine/draft";
import type { TeamCandidate } from "../../engine/teams";

const EMPTY: DraftState = { firstPick: "me", myPrebans: [], enemyPrebans: [], myPicks: [], enemyPicks: [] };
// Overall pick numbers for each side, in E7's order (1, 2-3, 4-5, 6-7, 8-9, 10).
const FIRST_SLOTS = [1, 4, 5, 8, 9];
const SECOND_SLOTS = [2, 3, 6, 7, 10];

function HeroInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const { init } = useForge();
  const known = !!init.gameData.herodata[value];
  return (
    <span className={"draft-input" + (known ? " ok" : "")}>
      {known && <HeroIcon name={value} />}
      <input list="draft-heroes" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {value && <a onClick={() => onChange("")} title="Clear">×</a>}
    </span>
  );
}

export function DraftAssistant({ cands, data }: { cands: TeamCandidate[]; data: DraftData }) {
  const { init, db } = useForge();
  const [s, setS] = useState<DraftState>(EMPTY);
  const names = useMemo(() => Object.keys(init.gameData.herodata).sort(), [init.gameData.herodata]);
  const known = (n: string) => !!init.gameData.herodata[n];
  const clean = (arr: string[]) => arr.filter(known);
  const state: DraftState = { ...s, myPrebans: clean(s.myPrebans), enemyPrebans: clean(s.enemyPrebans), myPicks: clean(s.myPicks), enemyPicks: clean(s.enemyPicks) };
  const heroData = (n: string) => db.get(n);
  const turn = nextTurn(state);
  const recs = useMemo(() => recommendPicks(state, cands, data, heroData, 8), [JSON.stringify(state), cands, data]);
  const bans = state.myPicks.length === 5 && state.enemyPicks.length === 5 ? banAdvice(state, data, heroData) : null;

  const setList = (key: keyof Omit<DraftState, "firstPick">, i: number, v: string) => setS((x) => { const a = [...(x[key] as string[])]; a[i] = v; return { ...x, [key]: a }; });
  const myFirst = s.firstPick === "me";
  const mySlots = myFirst ? FIRST_SLOTS : SECOND_SLOTS, enemySlots = myFirst ? SECOND_SLOTS : FIRST_SLOTS;
  const pickNow = (name: string) => setS((x) => { const a = clean(x.myPicks); a.push(name); return { ...x, myPicks: a }; });

  const column = (side: Side) => {
    const key = side === "me" ? "myPicks" : "enemyPicks";
    const slots = side === "me" ? mySlots : enemySlots;
    return (
      <div className="draft-col">
        <h3>{side === "me" ? "Your picks" : "Opponent's picks"}</h3>
        {slots.map((overall, i) => {
          const active = turn?.overall === overall;
          return (
            <div key={i} className={"draft-slot" + (active ? " active" : "")}>
              <span className="muted mono">#{overall}</span>
              <HeroInput value={(s[key] as string[])[i] ?? ""} onChange={(v) => setList(key, i, v)} placeholder={active ? (side === "me" ? "your pick…" : "their pick…") : ""} />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Section title="Live draft assistant" right={<div className="row">
      <div className="seg">
        <button className={myFirst ? "on" : ""} onClick={() => setS({ ...s, firstPick: "me" })}>You pick first</button>
        <button className={!myFirst ? "on" : ""} onClick={() => setS({ ...s, firstPick: "enemy" })}>Opponent picks first</button>
      </div>
      <button className="small ghost" onClick={() => setS({ ...EMPTY, firstPick: s.firstPick })}>Reset</button>
    </div>}>
      <datalist id="draft-heroes">{names.map((n) => <option key={n} value={n} />)}</datalist>
      <p className="muted" style={{ marginTop: 0 }}>Enter the draft as it happens. Recommendations come from your own heroes and update after every pick.</p>
      <div className="draft-board">
        <div className="draft-col">
          <h3>Pre-bans</h3>
          <div className="draft-slot"><span className="muted">You</span>{[0, 1].map((i) => <HeroInput key={i} value={s.myPrebans[i] ?? ""} onChange={(v) => setList("myPrebans", i, v)} placeholder="pre-ban…" />)}</div>
          <div className="draft-slot"><span className="muted">Them</span>{[0, 1].map((i) => <HeroInput key={i} value={s.enemyPrebans[i] ?? ""} onChange={(v) => setList("enemyPrebans", i, v)} placeholder="pre-ban…" />)}</div>
          <p className="muted" style={{ fontSize: 12 }}>
            {turn ? <>Pick #{turn.overall}: <b>{turn.side === "me" ? "your turn" : "opponent's turn"}</b>.</> : "Picks done: choose your final ban below."}
          </p>
        </div>
        {column("me")}
        {column("enemy")}
      </div>

      {turn && (
        <>
          <h3 style={{ marginTop: 14 }}>{turn.side === "me" ? `Best picks for you now (your pick ${turn.mySlot})` : `Your best options for your next pick (pick ${state.myPicks.length + 1})`}</h3>
          {!recs.length ? <span className="muted">No available heroes.</span> : (
            <table>
              <thead><tr><th>Hero</th><th className="num">Score</th><th>Why</th><th /></tr></thead>
              <tbody>{recs.map((r) => (
                <tr key={r.heroId}>
                  <td><span className="row" style={{ gap: 6 }}><HeroIcon name={r.name} />{r.name}</span></td>
                  <td className="num">{fmt(r.score, 1)}</td>
                  <td style={{ whiteSpace: "normal" }}>
                    {r.parts.map((p, i) => <div key={i} className="muted" style={{ fontSize: 12 }}><span className={p.pts >= 0 ? "ok" : "bad"}>{p.pts >= 0 ? "+" : ""}{fmt(p.pts, 1)}</span> {p.label}</div>)}
                    {r.notes.map((n, i) => <div key={"n" + i} style={{ fontSize: 12 }}>{n}</div>)}
                  </td>
                  <td>{turn.side === "me" && <button className="small primary" onClick={() => pickNow(r.name)}>Pick</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </>
      )}

      {bans && (
        <div className="grid g2" style={{ marginTop: 14 }}>
          <div>
            <h3>Ban one of theirs</h3>
            {bans.banTheirs.map((b, i) => <div key={b.name} className={"row" + (i === 0 ? " ok" : "")} style={{ gap: 6, marginBottom: 4 }}><HeroIcon name={b.name} /><b>{b.name}</b><span className="muted" style={{ fontSize: 12 }}>{b.why.join(" · ") || "—"}</span></div>)}
          </div>
          <div>
            <h3>They will likely ban</h3>
            {bans.theyBan.map((b, i) => <div key={b.name} className="row" style={{ gap: 6, marginBottom: 4 }}><HeroIcon name={b.name} /><span className={i === 0 ? "warn" : ""}>{b.name}</span><span className="muted" style={{ fontSize: 12 }}>{b.why.join(" · ") || "—"}</span></div>)}
            <p className="muted" style={{ fontSize: 12 }}>Plan your fight around the four that remain if the top one is banned.</p>
          </div>
        </div>
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        Score adds: top-player win edge over the average hero, proven pairs and trios with your picks, how well the kit answers what they've shown,
        how often Champion+ players take the hero at this pick slot, and your gear. Answers to the enemy are judged from kits, since no source publishes hero-vs-hero results.
        {data.sources.length ? ` Data: ${data.sources.join("; ")}.` : " No draft data loaded."}
      </p>
    </Section>
  );
}
