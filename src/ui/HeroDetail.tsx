import React, { useState } from "react";
import { HeroIcon, ItemSummary, Num, Section, SlotLabel, StatLine } from "./components";
import { heroLevelText } from "./HeroRoster";
import { useForge } from "./state";
import { ARCHETYPE_LABEL, detectArchetype } from "../engine/recommend";
import { TAG_LABELS } from "../engine/tagger";
import { GEAR_SLOTS, type HeroBonuses } from "../engine/types";
import { classLabel, elementLabel } from "../engine/labels";
import { artifactFits } from "../engine/dictionary";
import { ARTIFACT_LEVELS, artifactStats } from "../engine/artifact";
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
  const [showArtifact, setShowArtifact] = useState(false);
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
      {hero.artifactName && <ArtifactLine name={hero.artifactName} level={hero.artifact?.level} stats={hero.artifact} role={d?.role ?? hero.role} info={init.gameData.artifactInfo?.[hero.artifactName]} />}
      <h3 style={{ marginTop: 10 }}>Current build</h3>
      <StatLine s={s} />
      {hero.gameCp != null && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>In-game Combat Power: <b>{hero.gameCp.toLocaleString("en-US")}</b> (from the last Live Sync; it counts more than stats, so it runs higher than E7 Forge's CP).</div>}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="small ghost" onClick={() => setShowGear(!showGear)}>{showGear ? "Hide" : "Show"} equipped gear</button>
        <button className="small ghost" onClick={() => setShowImprint(!showImprint)}>Memory Imprint: {imprintText(hero.imprint, d)}</button>
        <button className="small ghost" onClick={() => setShowArtifact(!showArtifact)}>Artifact: {hero.artifact ? `${hero.artifact.name} +${hero.artifact.level}` : "not set"}</button>
        <button className="small ghost" onClick={() => setShowBonus(!showBonus)}>{showBonus ? "Hide" : "Edit"} EE / other bonuses</button>
      </div>
      {showImprint && <ImprintEditor heroId={hero.id} key={"imp" + hero.id} />}
      {showArtifact && <ArtifactEditor heroId={hero.id} key={"art" + hero.id} onDone={() => setShowArtifact(false)} />}
      {showGear && <table style={{ marginTop: 8 }}><tbody>{GEAR_SLOTS.map((sl) => <tr key={sl}><td className="muted"><SlotLabel slot={sl} /></td><td><ItemSummary item={itemById.get(hero.equipment[sl] ?? "")} /></td></tr>)}</tbody></table>}
      {showBonus && <BonusEditor heroId={hero.id} key={hero.id} />}
    </div>
  );
}

function ArtifactLine({ name, level, stats, role, info }: { name: string; level?: number; stats?: { atk: number; hp: number; def: number }; role?: string; info?: import("../engine/dictionary").ArtifactInfo }) {
  const fits = artifactFits(info, role);
  return (
    <div style={{ marginTop: 8, fontSize: 13 }}>
      <b>Artifact:</b> {name}{level != null && ` +${level}`}{info && <span className="muted"> ({info.class}, {info.stars}★)</span>}
      {stats && <span className="muted"> · {artifactStatText(stats)}</span>}
      {info && <div className="muted" style={{ fontSize: 12 }}>{info.effect}</div>}
      {!fits && <div className="warn" style={{ fontSize: 12 }}>This artifact is for {info!.class} heroes: only its stats apply, not its effect.</div>}
    </div>
  );
}

const ARTIFACT_MAX = ARTIFACT_LEVELS[ARTIFACT_LEVELS.length - 1];
const artifactStatText = (s: { atk: number; hp: number; def: number }) =>
  [s.atk && `Atk +${Math.floor(s.atk)}`, s.hp && `HP +${Math.floor(s.hp)}`, s.def && `Def +${Math.floor(s.def)}`].filter(Boolean).join(", ") || "no flat stats";

const ROLE_CLASS: Record<string, string> = { knight: "Knight", warrior: "Warrior", assassin: "Thief", ranger: "Ranger", mage: "Mage", manauser: "Soul Weaver" };

/** Pick an artifact and its level; its Atk / HP / Def are worked out and added to the hero's stats. */
function ArtifactEditor({ heroId, onDone }: { heroId: string; onDone: () => void }) {
  const { heroById, hd, api, toast, init } = useForge();
  const hero = heroById.get(heroId)!;
  const role = hd(hero)?.role ?? hero.role;
  const all = init.gameData.artifacts ?? {};
  const info = init.gameData.artifactInfo ?? {};
  const [name, setName] = useState(hero.artifact?.name ?? hero.artifactName ?? "");
  const [level, setLevel] = useState(hero.artifact?.level ?? ARTIFACT_MAX);
  const [showAll, setShowAll] = useState(false);
  // Usable artifacts first: this class's own, then "any class"; others only on request (their effect wouldn't apply).
  const options = Object.values(all).filter((a) => showAll || !a.role || a.role === role || a.name === name)
    .sort((a, b) => b.rarity - a.rarity || Number(a.role !== role) - Number(b.role !== role) || a.name.localeCompare(b.name));
  const base = all[name];
  const preview = base ? artifactStats(base, level) : null;
  // A level from an import that isn't a multiple of 3 (e.g. +22) stays selectable.
  const levels = [...new Set([...ARTIFACT_LEVELS, level])].sort((a, b) => a - b);
  const save = async (clear = false) => {
    await api.updateHero({ heroId, artifact: clear ? null : preview });
    toast(clear ? "Artifact removed" : `Artifact saved: ${preview!.name} +${preview!.level}`);
    onDone();
  };
  return (
    <div className="card" style={{ marginTop: 10, background: "var(--panel-2)" }}>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ flex: 1, minWidth: 240 }}>Artifact
          <input list={"artifacts-" + heroId} value={name} placeholder="Type to search…" onChange={(e) => setName(e.target.value)} />
          <datalist id={"artifacts-" + heroId}>{options.map((a) => <option key={a.code} value={a.name}>{"★".repeat(a.rarity)} {a.role ? ROLE_CLASS[a.role] : "Any class"}</option>)}</datalist>
        </label>
        <label className="field">Level
          <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>{levels.map((l) => <option key={l} value={l}>+{l}</option>)}</select>
        </label>
        <label className="row" style={{ gap: 6, fontSize: 12 }}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Show other classes</label>
      </div>
      {!hero.artifact && (hero.bonuses.atk || hero.bonuses.hp || hero.bonuses.def) ? <div className="warn" style={{ fontSize: 12, marginTop: 6 }}>This hero has flat Atk/HP/Def under EE / other bonuses. If that was this artifact, clear it there so it isn't counted twice.</div> : null}
      {name && !base && <div className="warn" style={{ fontSize: 12, marginTop: 6 }}>No artifact called “{name}” in the game data.</div>}
      {preview && (
        <div style={{ fontSize: 13, marginTop: 8 }}>
          <b>{preview.name} +{preview.level}</b>: {artifactStatText(preview)}
          {info[preview.name] && <div className="muted" style={{ fontSize: 12 }}>{info[preview.name].effect}</div>}
          {!artifactFits(info[preview.name], role) && <div className="warn" style={{ fontSize: 12 }}>Locked to {info[preview.name]!.class}: only its stats apply on this hero.</div>}
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="small primary" disabled={!preview} onClick={() => save()}>Save artifact</button>
        {hero.artifact && <button className="small ghost" onClick={() => save(true)}>Remove</button>}
        <button className="small ghost" onClick={onDone}>Cancel</button>
        <span className="muted" style={{ fontSize: 12 }}>Atk / HP / Def are worked out from the level and added to the hero's stats. Live Sync doesn't change it.</span>
      </div>
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
        <span className="muted" style={{ fontSize: 12 }}>Exclusive Equipment and any other flat bonuses. The artifact is set with the Artifact button, so don't include it here. Kept across syncs.</span>
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
