import React, { useState } from "react";
import { HeroIcon, ItemSummary, Num, Section, SlotLabel, StatLine } from "./components";
import { heroLevelText } from "./HeroRoster";
import { useForge } from "./state";
import { ARCHETYPE_LABEL, detectArchetype } from "../engine/recommend";
import { TAG_LABELS } from "../engine/tagger";
import { GEAR_SLOTS, type HeroBonuses } from "../engine/types";
import { classLabel, elementLabel } from "../engine/labels";
import { artifactFits } from "../engine/dictionary";
import { fmtImprint, gradeForValue, GRADES, imprintFor, positionLabel, type Grade, type HeroImprint, type ImprintMode } from "../engine/imprint";

const BONUS_FIELDS: { k: keyof HeroBonuses; label: string }[] = [
  { k: "atk", label: "Atk (flat)" }, { k: "hp", label: "HP (flat)" }, { k: "def", label: "Def (flat)" },
  { k: "atkPct", label: "Atk %" }, { k: "hpPct", label: "HP %" }, { k: "defPct", label: "Def %" },
  { k: "spd", label: "Speed" }, { k: "cr", label: "Crit %" }, { k: "cd", label: "Crit Dmg %" }, { k: "eff", label: "Eff %" }, { k: "res", label: "Res %" },
];

export function HeroHeader({ heroId, right }: { heroId: string; right?: React.ReactNode }) {
  const { heroById, hd, stats, itemById, init } = useForge();
  const [showGear, setShowGear] = useState(false);
  const [showBonus, setShowBonus] = useState(false);
  const [showImprint, setShowImprint] = useState(false);
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
            <div className="muted">{[heroLevelText(hero), elementLabel(d?.attribute), classLabel(d?.role ?? hero.role), d && ARCHETYPE_LABEL[detectArchetype(d).archetype]].filter(Boolean).join(" · ")}</div>
            <div style={{ marginTop: 4 }}>{(d?.tags ?? []).slice(0, 12).map((t) => <span key={t} className="tag">{TAG_LABELS[t] ?? t}</span>)}</div>
          </div>
        </div>
        {right}
      </div>
      {hero.artifactName && <ArtifactLine name={hero.artifactName} role={d?.role ?? hero.role} info={init.gameData.artifactInfo?.[hero.artifactName]} />}
      <h3 style={{ marginTop: 10 }}>Current build</h3>
      <StatLine s={s} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="small ghost" onClick={() => setShowGear(!showGear)}>{showGear ? "Hide" : "Show"} equipped gear</button>
        <button className="small ghost" onClick={() => setShowImprint(!showImprint)}>Memory Imprint: {imprintText(hero.imprint, d)}</button>
        <button className="small ghost" onClick={() => setShowBonus(!showBonus)}>{showBonus ? "Hide" : "Edit"} artifact / EE bonuses</button>
      </div>
      {showImprint && <ImprintEditor heroId={hero.id} key={"imp" + hero.id} />}
      {showGear && <table style={{ marginTop: 8 }}><tbody>{GEAR_SLOTS.map((sl) => <tr key={sl}><td className="muted"><SlotLabel slot={sl} /></td><td><ItemSummary item={itemById.get(hero.equipment[sl] ?? "")} /></td></tr>)}</tbody></table>}
      {showBonus && <BonusEditor heroId={hero.id} key={hero.id} />}
    </div>
  );
}

function ArtifactLine({ name, role, info }: { name: string; role?: string; info?: import("../engine/dictionary").ArtifactInfo }) {
  const fits = artifactFits(info, role);
  return (
    <div style={{ marginTop: 8, fontSize: 13 }}>
      <b>Artifact:</b> {name}{info && <span className="muted"> ({info.class}, {info.stars}★)</span>}
      {info && <div className="muted" style={{ fontSize: 12 }}>{info.effect}</div>}
      {!fits && <div className="warn" style={{ fontSize: 12 }}>This artifact is for {info!.class} heroes: only its stats apply, not its effect.</div>}
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
        <span className="muted" style={{ fontSize: 12 }}>Live Sync doesn't include artifact or EE values. Enter the totals once; they're kept across syncs.</span>
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

function imprintText(imp: HeroImprint | undefined, d: ReturnType<ReturnType<typeof useForge>["hd"]>) {
  if (!imp) return "not set";
  const grade = imp.grade ?? (imp.value != null ? gradeForValue(d, imp.value) : null);
  return `${grade ?? "?"} ${imp.mode === "release" ? "Release" : "Concentration"}`;
}

function ImprintEditor({ heroId }: { heroId: string }) {
  const { heroById, hd, api, toast } = useForge();
  const hero = heroById.get(heroId)!;
  const d = hd(hero);
  const info = imprintFor(d);
  const cur = hero.imprint;
  const [mode, setMode] = useState<ImprintMode | "">(cur?.mode ?? "");
  const [grade, setGrade] = useState<Grade | "">(cur?.grade ?? (cur?.value != null ? gradeForValue(d, cur.value) ?? "" : ""));
  const [inBonuses, setInBonuses] = useState(!!cur?.inBonuses);
  const stat = mode ? info[mode] : undefined;
  const save = async () => {
    const imprint: HeroImprint | null = mode && grade ? { mode, grade, source: "manual", inBonuses: mode === "concentration" && inBonuses } : null;
    await api.updateHero({ heroId, imprint });
    toast(imprint ? "Memory Imprint saved" : "Memory Imprint cleared");
  };
  return (
    <div style={{ marginTop: 10 }}>
      <div className="row">
        <label className="field">Mode
          <select value={mode} onChange={(e) => setMode(e.target.value as ImprintMode | "")}>
            <option value="">Not set</option>
            <option value="release" disabled={!info.release}>Release (team)</option>
            <option value="concentration" disabled={!info.concentration}>Concentration (self)</option>
          </select>
        </label>
        <label className="field">Grade
          <select value={grade} onChange={(e) => setGrade(e.target.value as Grade | "")} disabled={!mode}>
            <option value="">—</option>
            {GRADES.map((g) => { const v = stat?.grades[g]; return <option key={g} value={g} disabled={v == null}>{g}{v != null && stat ? ` · ${fmtImprint(stat.stat, stat.label, v)}` : ""}</option>; })}
          </select>
        </label>
        {mode === "concentration" && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={inBonuses} onChange={(e) => setInBonuses(e.target.checked)} /> Already added to the bonus fields</label>}
        <button className="small primary" onClick={save}>Save</button>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        {info.release && <>Release gives {info.release.label} to {positionLabel(info.release.position ?? "all")}. </>}
        {info.concentration && <>Concentration gives this hero {info.concentration.label}. </>}
        Live Sync doesn't read imprints, so set them here. Team suggestions use Release auras; Concentration is added to this hero's stats.
      </p>
    </div>
  );
}
