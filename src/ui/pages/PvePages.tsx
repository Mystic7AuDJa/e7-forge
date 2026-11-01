import React, { useMemo, useState } from "react";
import { useForge } from "../state";
import { Busy, fmt, HeroSelect, NoAccount, Section } from "../components";
import { buildTeams, normElement, type TeamCandidate } from "../../engine/teams";
import { campTeams, type CampTeam } from "../../engine/camping";
import { Conf, OpenInAccountOpt, SourceLine, TeamHeroes, useCandidates, useMeta, useOwnedByName } from "./metaShared";

interface Mech { text: string; source?: string; date?: string; confidence?: string }
interface Bp { stat: string; op: string; value: number; appliesTo: string; required: boolean; note?: string; source?: string; date?: string; confidence?: string }
interface PresetHero { name: string; role: string; alternatives?: string[] }
interface PresetTeam { name: string; heroes: PresetHero[]; source?: string; date?: string; confidence?: string; notes?: string; difficulty?: string }
interface Encounter { id?: string; name?: string; element?: { value: string | null; confidence?: string; note?: string }; advantage?: string | null; needTags?: string[]; mechanics?: Mech[]; breakpoints?: Bp[]; relative?: any[]; thresholds?: Mech[]; teams?: PresetTeam[] }

const STAT_LABEL: Record<string, string> = { spd: "Speed", eff: "Effectiveness", res: "Effect Resistance", cr: "Crit Chance", cd: "Crit Damage", hp: "HP", atk: "Attack", def: "Defense" };
const DEBUFF_ROLES = ["debuffer", "def_breaker", "def breaker", "dispel", "dps/dispel"];

function ElementLine({ e }: { e: Encounter }) {
  const el = e.element;
  return (
    <div className="row" style={{ gap: 14 }}>
      <span>Boss element: <b>{el?.value ?? "unknown"}</b> <Conf c={el?.confidence} /></span>
      <span>Bring: <b>{e.advantage ?? "any"}</b></span>
      {!!e.needTags?.length && <span>Needs: {e.needTags.map((t) => <span key={t} className="tag">{t.replace(/_/g, " ")}</span>)}</span>}
      {el?.note && <span className="muted" style={{ fontSize: 12 }}>{el.note}</span>}
    </div>
  );
}

function Mechanics({ items, title = "Mechanics" }: { items?: Mech[]; title?: string }) {
  if (!items?.length) return null;
  return (
    <div>
      <h3>{title}</h3>
      <ul className="mech">{items.map((m, i) => <li key={i}>{m.text} <SourceLine source={m.source} date={m.date} confidence={m.confidence} /></li>)}</ul>
    </div>
  );
}

/** Resolves a guide slot to your best owned hero (main pick first, then alternatives). */
function resolveSlot(slot: PresetHero, owned: Map<string, TeamCandidate>, used: Set<string>) {
  for (const n of [slot.name, ...(slot.alternatives ?? [])]) {
    const c = owned.get(n);
    if (c && !used.has(c.hero.id)) return { c, alt: n !== slot.name ? n : undefined };
  }
  return null;
}

function bpTargets(bp: Bp, members: { c?: TeamCandidate; slot: PresetHero }[]) {
  const a = bp.appliesTo;
  if (a === "team") return members;
  if (a === "debuffers") return members.filter((m) => DEBUFF_ROLES.includes(m.slot.role) || m.c?.archetype === "debuffer");
  if (a === "healers") return members.filter((m) => m.slot.role === "healer" || m.c?.hd.tags.includes("heal"));
  return members.filter((m) => m.slot.name === a || m.c?.hero.name === a || m.slot.alternatives?.includes(a));
}

function PresetTeamCard({ t, owned, bps }: { t: PresetTeam; owned: Map<string, TeamCandidate>; bps: Bp[] }) {
  const used = new Set<string>();
  const members = t.heroes.map((slot) => { const r = resolveSlot(slot, owned, used); if (r) used.add(r.c.hero.id); return { slot, c: r?.c, alt: r?.alt }; });
  const have = members.filter((m) => m.c).length;
  const checks: { label: string; ok: boolean; required: boolean; heroId: string; stat: string; value: number }[] = [];
  const mins: Record<string, Record<string, number>> = {};
  for (const bp of bps) {
    if (bp.op !== ">=") continue;
    for (const m of bpTargets(bp, members)) {
      if (!m.c) continue;
      const cur = (m.c.current as any)[bp.stat] ?? 0;
      checks.push({ label: `${m.c.hero.name} ${STAT_LABEL[bp.stat] ?? bp.stat} ${cur} / ${bp.value}`, ok: cur >= bp.value, required: bp.required, heroId: m.c.hero.id, stat: bp.stat, value: bp.value });
      if (bp.required) mins[m.c.hero.id] = { ...mins[m.c.hero.id], [bp.stat]: Math.max(bp.value, mins[m.c.hero.id]?.[bp.stat] ?? 0) };
    }
  }
  const ids = members.filter((m) => m.c).map((m) => m.c!.hero.id);
  return (
    <div className="card" style={{ background: "var(--panel-2)" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>{t.name}{t.difficulty ? ` · ${t.difficulty}` : ""}</b>
        <span className={have === members.length ? "ok" : "muted"}>{have === members.length ? "You can run this" : `You have ${have} of ${members.length}`}</span>
      </div>
      <TeamHeroes heroes={members.map((m) => ({
        name: m.c ? m.c.hero.name : m.slot.name, missing: !m.c,
        note: <>{m.slot.role}{m.alt ? ` · as alternative for ${m.slot.name}` : ""}{!m.c && m.slot.alternatives?.length ? ` · alt: ${m.slot.alternatives.join(", ")}` : ""}{m.c ? ` · ${m.c.current.spd} spd` : ""}</>,
      }))} />
      {checks.length > 0 && (
        <ul className="bpchecks">{checks.map((c, i) => <li key={i} className={c.ok ? "ok" : c.required ? "bad" : "warn"}>{c.ok ? "✓" : "✗"} {c.label}{c.required ? "" : " (optional)"}</li>)}</ul>
      )}
      {t.notes && <p className="muted" style={{ fontSize: 12 }}>{t.notes}</p>}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <SourceLine source={t.source} date={t.date} confidence={t.confidence} />
        <OpenInAccountOpt ids={ids} mins={Object.keys(mins).length ? mins : undefined} label={Object.keys(mins).length ? "Gear to breakpoints in Account-wide Optimizer" : undefined} />
      </div>
    </div>
  );
}

function BuiltTeams({ cands, element, need, must }: { cands: TeamCandidate[]; element?: string | null; need?: string[]; must: string[] }) {
  const { heroById } = useForge();
  const teams = useMemo(() => buildTeams(cands, "pve", { enemyElement: normElement(element), mustInclude: must, top: 4 }), [cands, element, must]);
  return (
    <div className="grid g2">{teams.map((t, i) => {
      const tags = new Set(t.members.flatMap((m) => m.hd.tags));
      const missing = (need ?? []).filter((x) => !tags.has(x));
      return (
        <div key={i} className="card" style={{ background: "var(--panel-2)" }}>
          <div className="row" style={{ justifyContent: "space-between" }}><b>#{i + 1} from your roster</b><span className="muted">score {fmt(t.report.score, 1)}</span></div>
          <TeamHeroes heroes={t.members.map((m) => ({ hero: heroById.get(m.hero.id), name: m.hero.name, note: `${m.hd.attribute} · ${m.current.spd} spd · GS ${m.current.gs}` }))} />
          <ul className="reasons">{t.report.synergies.slice(0, 3).map((s, j) => <li key={j}>{s}</li>)}</ul>
          {(missing.length > 0 || t.report.warnings.length > 0) && <ul className="warnings">
            {missing.length > 0 && <li>Missing for this fight: {missing.join(", ").replace(/_/g, " ")}</li>}
            {t.report.warnings.slice(0, 2).map((s, j) => <li key={j}>{s}</li>)}
          </ul>}
          <div className="row" style={{ justifyContent: "flex-end" }}><OpenInAccountOpt ids={t.members.map((m) => m.hero.id)} /></div>
        </div>
      );
    })}</div>
  );
}

function MustInclude({ must, setMust, max = 3 }: { must: string[]; setMust: (v: string[]) => void; max?: number }) {
  const { heroById } = useForge();
  return <>
    <HeroSelect value={null} onChange={(id) => setMust([...new Set([...must, id])].slice(0, max))} placeholder="Must include…" />
    {must.map((id) => <span key={id} className="tag">{heroById.get(id)?.name} <a onClick={() => setMust(must.filter((x) => x !== id))}>×</a></span>)}
  </>;
}

function EncounterBody({ e, cands, owned, must, extraNote }: { e: Encounter; cands: TeamCandidate[]; owned: Map<string, TeamCandidate>; must: string[]; extraNote?: React.ReactNode }) {
  const bps = e.breakpoints ?? [];
  return <>
    <Section title={e.name ?? "Encounter"}>
      <ElementLine e={e} />
      {extraNote}
      <Mechanics items={e.mechanics} />
      <Mechanics items={e.thresholds} title="Limits" />
      {bps.length > 0 && <>
        <h3>Stat breakpoints from guides</h3>
        <table><thead><tr><th>Who</th><th>Stat</th><th className="num">Target</th><th>Required?</th><th>Why</th><th>Source</th></tr></thead>
          <tbody>{bps.map((b, i) => <tr key={i}><td>{b.appliesTo}</td><td>{STAT_LABEL[b.stat] ?? b.stat}</td><td className="num">{b.op} {b.value}</td><td>{b.required ? "yes" : <span className="muted">optional</span>}</td><td className="muted" style={{ whiteSpace: "normal" }}>{b.note}</td><td><SourceLine source={b.source} date={b.date} confidence={b.confidence} /></td></tr>)}</tbody></table>
      </>}
      {!!e.relative?.length && <ul className="mech">{e.relative.map((r: any, i: number) => <li key={i}>{r.text} <SourceLine source={r.source} confidence={r.confidence} /></li>)}</ul>}
    </Section>
    {!!e.teams?.length && (
      <Section title="Guide teams vs. what you own" right={<span className="muted">Your best owned copy fills each slot; alternatives are used when you lack the main pick</span>}>
        <div className="grid g2">{e.teams.map((t, i) => <PresetTeamCard key={i} t={t} owned={owned} bps={bps} />)}</div>
      </Section>
    )}
    <Section title="Teams built from your roster" right={<span className="muted">Role coverage, element and gear readiness</span>}>
      <BuiltTeams cands={cands} element={e.element?.value} need={e.needTags} must={must} />
    </Section>
  </>;
}

export function HuntsPage() {
  const { account } = useForge();
  const { meta } = useMeta();
  const cands = useCandidates();
  const owned = useOwnedByName(cands);
  const [hunt, setHunt] = useState("wyvern");
  const [tier, setTier] = useState<"13" | "hell">("13");
  const [must, setMust] = useState<string[]>([]);
  if (!account) return <NoAccount />;
  if (!meta) return <Busy label="Loading PvE data…" />;
  const hunts: Encounter[] = meta.presets.hunts ?? [];
  const e = hunts.find((h) => h.id === hunt) ?? hunts[0];
  return (
    <div className="stack">
      <div><h1>Hunts</h1><p className="sub">Guide teams and stat breakpoints for stage 13, checked against your heroes, plus teams built from your own roster. Otherworldly / Hell hunts reuse the stage 13 data.</p></div>
      <div className="row">
        <div className="seg">{hunts.map((h) => <button key={h.id} className={hunt === h.id ? "on" : ""} onClick={() => setHunt(h.id!)}>{h.name?.replace(" Hunt", "")}</button>)}</div>
        <div className="seg">
          <button className={tier === "13" ? "on" : ""} onClick={() => setTier("13")}>Stage 13</button>
          <button className={tier === "hell" ? "on" : ""} onClick={() => setTier("hell")}>Otherworldly / Hell</button>
        </div>
        <MustInclude must={must} setMust={setMust} />
      </div>
      <EncounterBody e={e} cands={cands} owned={owned} must={must} extraNote={tier === "hell" ? <p className="callout">No public Otherworldly / Hell guide was found, so this shows the stage 13 teams and breakpoints as a baseline. Expect higher boss stats: treat the breakpoints as minimums and aim higher. {meta.presets.otherworldly?.note}</p> : null} />
    </div>
  );
}

export function AbyssPage() {
  const { account } = useForge();
  const { meta } = useMeta();
  const cands = useCandidates();
  const owned = useOwnedByName(cands);
  const [group, setGroup] = useState("101-110");
  const [floor, setFloor] = useState<number | null>(null);
  const [element, setElement] = useState("");
  const [must, setMust] = useState<string[]>([]);
  if (!account) return <NoAccount />;
  if (!meta) return <Busy label="Loading PvE data…" />;
  const groups: { id: string; label: string; floors: any[] }[] = meta.presets.abyss?.groups ?? [];
  const g = groups.find((x) => x.id === group) ?? groups[0];
  const f = g.floors.find((x) => x.floor === floor) ?? g.floors[0];
  return (
    <div className="stack">
      <div><h1>Abyss</h1><p className="sub">Pick a floor range, then a floor. Shows the floor's mechanics and limits, the guide teams you can field, and teams built from your roster.</p></div>
      <p className="callout">{meta.presets.abyss?.note}</p>
      <div className="row">
        <div className="seg">{groups.map((x) => <button key={x.id} className={g.id === x.id ? "on" : ""} onClick={() => { setGroup(x.id); setFloor(null); }}>{x.id}{x.floors.length ? "" : " ·"}</button>)}</div>
        {g.floors.length > 0 && <select value={f?.floor} onChange={(e) => setFloor(Number(e.target.value))}>{g.floors.map((x) => <option key={x.floor} value={x.floor}>Floor {x.floor}</option>)}</select>}
        <MustInclude must={must} setMust={setMust} />
      </div>
      {f ? <EncounterBody e={{ ...f, name: `Floor ${f.floor}` }} cands={cands} owned={owned} must={must} /> : <>
        <Section title={g.label}>
          <p className="muted">No guide data exists for these floors. Choose the enemy element to build a team from your roster.</p>
          <select value={element} onChange={(e) => setElement(e.target.value)}><option value="">Any element</option>{["fire", "ice", "earth", "light", "dark"].map((x) => <option key={x}>{x}</option>)}</select>
        </Section>
        <Section title="Teams built from your roster"><BuiltTeams cands={cands} element={element || null} must={must} /></Section>
      </>}
    </div>
  );
}

function CampResults({ teams, moraleOk }: { teams: CampTeam[]; moraleOk: boolean }) {
  const { heroById } = useForge();
  if (!teams.length) return <span className="muted">Not enough heroes to build a team.</span>;
  return (
    <div className="grid g2">{teams.map((t, i) => (
      <div key={i} className="card" style={{ background: "var(--panel-2)" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>#{i + 1}</b>
          <span className="muted">{moraleOk ? <>morale <b className="mono">{t.morale?.morale ?? "—"}</b> · </> : null}sustain {fmt(t.sustain, 1)} · geared {fmt(t.readiness * 100, 0)}%</span>
        </div>
        <TeamHeroes heroes={t.heroIds.map((id) => { const h = heroById.get(id)!; return { hero: h, name: h.name }; })} />
        <ul className="reasons">{t.reasons.map((r, j) => <li key={j}>{r}</li>)}</ul>
        {t.warnings.length > 0 && <ul className="warnings">{t.warnings.map((r, j) => <li key={j}>{r}</li>)}</ul>}
        <div className="row" style={{ justifyContent: "flex-end" }}><OpenInAccountOpt ids={t.heroIds} /></div>
      </div>
    ))}</div>
  );
}

function useCamp(cands: TeamCandidate[], o: Parameters<typeof campTeams>[3]) {
  const { meta } = useForge();
  const key = JSON.stringify(o);
  return useMemo(() => (meta ? campTeams(cands, meta.camping?.heroes ?? {}, meta.campingTopics, o) : []), [meta, cands, key]);
}

function CampingCredit() {
  const { meta, api } = useForge();
  return (
    <p className="muted" style={{ fontSize: 12 }}>
      Morale is scored the way <a onClick={() => api.openExternal("https://ceciliabot.github.io/camping-simulator/")}>CeciliaBot's Camp Simulator</a> does it: each hero has two personalities and two topics; a topic's morale is how much the other three heroes like it, and the camp uses the two best topics.
      {meta?.camping ? ` Camping data for ${Object.keys(meta.camping.heroes).length} heroes, fetched ${new Date(meta.camping.fetchedAt).toLocaleDateString()}.` : " Camping data isn't loaded, so morale is skipped."}
    </p>
  );
}

export function LabyrinthPage() {
  const { account } = useForge();
  const { meta } = useMeta();
  const cands = useCandidates();
  const owned = useOwnedByName(cands);
  const [boss, setBoss] = useState<string>("explore");
  const [diff, setDiff] = useState<"normal" | "hell">("normal");
  const [must, setMust] = useState<string[]>([]);
  const bosses: Encounter[] = meta?.presets.azmakalis?.bosses ?? [];
  const b = bosses.find((x) => x.id === boss);
  const teams = useCamp(cands, { size: 4, mustInclude: must, needTags: b?.needTags, enemyElement: normElement(b?.element?.value), sustainWeight: diff === "hell" ? 1.4 : 1, top: 6 });
  if (!account) return <NoAccount />;
  if (!meta) return <Busy label="Loading PvE data…" />;
  const presetTeams = (b?.teams ?? []).filter((t) => !t.difficulty || t.difficulty === diff);
  return (
    <div className="stack">
      <div><h1>Labyrinth & Azmakalis Raid</h1><p className="sub">Long runs come down to camp morale and team sustain. Teams are ranked by camp morale, healing / barrier / cleanse / revive, the boss's needs and how well each hero is geared.</p></div>
      <p className="callout">{meta.presets.azmakalis?.note} {meta.presets.labyrinth?.note}</p>
      <div className="row">
        <select value={boss} onChange={(e) => setBoss(e.target.value)}>
          <option value="explore">Exploration (no boss)</option>
          {bosses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <div className="seg">
          <button className={diff === "normal" ? "on" : ""} onClick={() => setDiff("normal")}>Normal</button>
          <button className={diff === "hell" ? "on" : ""} onClick={() => setDiff("hell")}>Hell</button>
        </div>
        <MustInclude must={must} setMust={setMust} />
      </div>
      {b && (
        <Section title={`${b.name} (legacy 2020 raid boss)`}>
          <ElementLine e={b} />
          <Mechanics items={b.mechanics} />
          {presetTeams.length > 0 && <>
            <h3>Heroes the 2020 guide used ({diff})</h3>
            {presetTeams.map((t, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <b>{t.name}:</b>{" "}
                {t.heroes.map((h) => <span key={h.name} className={"tag" + (owned.has(h.name) ? " owned" : " dim")}>{owned.has(h.name) ? "✓ " : ""}{h.name}</span>)}
                {" "}<SourceLine source={t.source} date={t.date} confidence={t.confidence} />
              </div>
            ))}
          </>}
        </Section>
      )}
      <Section title="Best camps from your roster"><CampingCredit /><CampResults teams={teams} moraleOk={!!meta.camping} /></Section>
    </div>
  );
}

export function DimensionalPage() {
  const { account, api } = useForge();
  const { meta } = useMeta();
  const cands = useCandidates();
  const [focus, setFocus] = useState<"balanced" | "sustain" | "morale">("balanced");
  const [must, setMust] = useState<string[]>([]);
  const w = { balanced: [1, 1], sustain: [0.5, 1.8], morale: [1.8, 0.6] }[focus];
  const teams = useCamp(cands, { size: 4, mustInclude: must, moraleWeight: w[0], sustainWeight: w[1], top: 6 });
  if (!account) return <NoAccount />;
  if (!meta) return <Busy label="Loading PvE data…" />;
  const de = meta.presets.dimensionalExploration;
  return (
    <div className="stack">
      <div><h1>Dimensional Exploration</h1><p className="sub">Roguelike runs where the same team carries through many fights, so sustain and morale matter more than burst. Teams are ranked on both, plus how well each hero is geared.</p></div>
      <p className="callout">{de?.note} No team or stat guides exist yet, so these teams come from your roster only. {de?.sources?.[0] && <a onClick={() => api.openExternal(de.sources[0])}>Source</a>}</p>
      <div className="row">
        <div className="seg">
          {(["balanced", "sustain", "morale"] as const).map((f) => <button key={f} className={focus === f ? "on" : ""} onClick={() => setFocus(f)}>{f === "balanced" ? "Balanced" : f === "sustain" ? "Sustain first" : "Morale first"}</button>)}
        </div>
        <MustInclude must={must} setMust={setMust} />
      </div>
      <Section title="Best teams from your roster"><CampingCredit /><CampResults teams={teams} moraleOk={!!meta.camping} /></Section>
    </div>
  );
}
