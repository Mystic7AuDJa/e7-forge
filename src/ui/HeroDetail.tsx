import React, { useState } from "react";
import { HeroIcon, ItemSummary, Num, Section, SlotLabel, StatLine } from "./components";
import { heroLevelText } from "./HeroRoster";
import { useForge } from "./state";
import { ARCHETYPE_LABEL, detectArchetype } from "../engine/recommend";
import { TAG_LABELS } from "../engine/tagger";
import { GEAR_SLOTS, type HeroBonuses } from "../engine/types";

const BONUS_FIELDS: { k: keyof HeroBonuses; label: string }[] = [
  { k: "atk", label: "Atk (flat)" }, { k: "hp", label: "HP (flat)" }, { k: "def", label: "Def (flat)" },
  { k: "atkPct", label: "Atk %" }, { k: "hpPct", label: "HP %" }, { k: "defPct", label: "Def %" },
  { k: "spd", label: "Speed" }, { k: "cr", label: "Crit %" }, { k: "cd", label: "Crit Dmg %" }, { k: "eff", label: "Eff %" }, { k: "res", label: "Res %" },
];
const ROLE_LABEL: Record<string, string> = { warrior: "Warrior", knight: "Knight", assassin: "Thief", ranger: "Ranger", mage: "Mage", manauser: "Soul Weaver" };

export function HeroHeader({ heroId, right }: { heroId: string; right?: React.ReactNode }) {
  const { heroById, hd, stats, itemById } = useForge();
  const [showGear, setShowGear] = useState(false);
  const [showBonus, setShowBonus] = useState(false);
  const hero = heroById.get(heroId);
  if (!hero) return null;
  const d = hd(hero);
  const s = stats(hero);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="hero-cell big"><HeroIcon name={hero.dataKey || hero.name} /></span>
          <div>
            <h2 style={{ margin: 0 }}>{hero.name}</h2>
            <div className="muted">{heroLevelText(hero)} · {d?.attribute} · {ROLE_LABEL[d?.role ?? hero.role] ?? hero.role}{d ? ` · ${ARCHETYPE_LABEL[detectArchetype(d).archetype]}` : ""}</div>
            <div style={{ marginTop: 4 }}>{(d?.tags ?? []).slice(0, 12).map((t) => <span key={t} className="tag">{TAG_LABELS[t] ?? t}</span>)}</div>
          </div>
        </div>
        {right}
      </div>
      <h3 style={{ marginTop: 10 }}>Current build</h3>
      <StatLine s={s} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="small ghost" onClick={() => setShowGear(!showGear)}>{showGear ? "Hide" : "Show"} equipped gear</button>
        <button className="small ghost" onClick={() => setShowBonus(!showBonus)}>{showBonus ? "Hide" : "Edit"} artifact / imprint / EE bonuses</button>
      </div>
      {showGear && <table style={{ marginTop: 8 }}><tbody>{GEAR_SLOTS.map((sl) => <tr key={sl}><td className="muted"><SlotLabel slot={sl} /></td><td><ItemSummary item={itemById.get(hero.equipment[sl] ?? "")} /></td></tr>)}</tbody></table>}
      {showBonus && <BonusEditor heroId={hero.id} key={hero.id} />}
    </div>
  );
}

function BonusEditor({ heroId }: { heroId: string }) {
  const { heroById, api, toast } = useForge();
  const hero = heroById.get(heroId)!;
  const [b, setB] = useState<HeroBonuses>({ ...hero.bonuses });
  return (
    <div style={{ marginTop: 10 }}>
      <div className="grid g4">
        {BONUS_FIELDS.map((f) => <label key={f.k} className="field">{f.label}<Num value={b[f.k]} onChange={(v) => setB({ ...b, [f.k]: v ?? 0 })} /></label>)}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="small primary" onClick={async () => { await api.updateHero({ heroId, bonuses: b }); toast("Bonuses saved"); }}>Save bonuses</button>
        <span className="muted" style={{ fontSize: 12 }}>Live capture doesn't include artifact or imprint values. Enter the totals once; they're kept across syncs.</span>
      </div>
    </div>
  );
}

export function AddPlanningHero() {
  const { api, toast, init } = useForge();
  const [name, setName] = useState("");
  return (
    <div className="row" style={{ gap: 6 }}>
      <select value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
        <option value="">Add hero for planning…</option>
        {Object.keys(init.gameData.herodata).sort().map((n) => <option key={n}>{n}</option>)}
      </select>
      <button className="small" disabled={!name} onClick={async () => { await api.addHero(name); setName(""); toast("Hero added"); }}>Add</button>
    </div>
  );
}

export { Section };
