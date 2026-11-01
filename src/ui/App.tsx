import React from "react";
import { useForge } from "./state";
import { fmt } from "./components";
import AccountPage from "./pages/AccountPage";
import OptimizerPage from "./pages/OptimizerPage";
import AccountOptPage from "./pages/AccountOptPage";
import SpeedTunePage from "./pages/SpeedTunePage";
import GearPage from "./pages/GearPage";
import BenchmarkPage from "./pages/BenchmarkPage";
import RecommendPage from "./pages/RecommendPage";
import { ArenaDefensePage, GwDefensePage, GwOffensePage, RtaDraftPage } from "./pages/PvpPages";
import { AbyssPage, DimensionalPage, HuntsPage, LabyrinthPage } from "./pages/PvePages";
import SettingsPage from "./pages/SettingsPage";
import AppInfoPage from "./pages/AppInfoPage";
import CountersPage from "./pages/CountersPage";

const NAV: { id: string; label: string; group: string; tier?: string }[] = [
  { id: "account", label: "Account & Live Sync", group: "Data" },
  { id: "gear", label: "Gear & Upgrade ROI", group: "Data", tier: "T1" },
  { id: "optimizer", label: "Hero Optimizer", group: "Optimize" },
  { id: "accountopt", label: "Account-wide Optimizer", group: "Optimize", tier: "T1" },
  { id: "speed", label: "Speed Tuning", group: "Optimize", tier: "T1" },
  { id: "bench", label: "Compare Builds Against Community", group: "Analyze", tier: "T1" },
  { id: "recommend", label: "Stat Recommendations", group: "Analyze", tier: "T2" },
  { id: "counters", label: "Offense (Counter Planner)", group: "PvP" },
  { id: "arenadef", label: "Arena Defense", group: "PvP" },
  { id: "rta", label: "RTA Draft", group: "PvP" },
  { id: "gwoff", label: "Guild War Offense", group: "PvP" },
  { id: "gwdef", label: "Guild War Defense", group: "PvP" },
  { id: "hunts", label: "Hunts", group: "PvE" },
  { id: "labyrinth", label: "Labyrinth & Azmakalis Raid", group: "PvE" },
  { id: "dimensional", label: "Dimensional Exploration", group: "PvE" },
  { id: "abyss", label: "Abyss", group: "PvE" },
  { id: "settings", label: "Settings", group: "App" },
  { id: "info", label: "App Info", group: "App" },
];

function LiveSync() {
  const { api, capture, toast, go } = useForge();
  const on = capture.state !== "off" && capture.state !== "error";
  const toggle = async () => {
    try {
      if (on) await api.captureStop();
      else await api.captureStart();
    } catch (e: any) { toast(e.message, true); }
  };
  const label: Record<string, string> = { off: "Live sync off", starting: "Starting sniffer…", listening: "Listening", decoding: "Decoding…", error: "Capture error" };
  return (
    <div className="live" title={capture.error ?? "Sniffs Epic Seven traffic (Npcap) and imports gear + heroes automatically"}>
      <span className={"switch" + (on ? " on" : "")} onClick={toggle} role="switch" aria-checked={on} />
      <span className={"dot " + capture.state} />
      <span>{label[capture.state] ?? capture.state}</span>
      {on && <span className="muted mono">{fmt((capture.bytes ?? 0) / 1024)} KB</span>}
      {on && <button className="small" disabled={capture.state !== "listening"} onClick={() => api.captureSync().catch((e) => toast(e.message, true))}>Sync now</button>}
      {capture.state === "error" && <a onClick={() => go("account")}>Fix</a>}
    </div>
  );
}

function NavButtons() {
  const { back, forward, home, canBack, canForward } = useForge();
  return (
    <div className="navbtns">
      <button className="small ghost" disabled={!canBack} onClick={back} title="Back (Alt+Left)">◀ Back</button>
      <button className="small ghost" onClick={home} title="Home: Account & Live Sync (Alt+Home)">⌂ Home</button>
      <button className="small ghost" disabled={!canForward} onClick={forward} title="Forward (Alt+Right)">Forward ▶</button>
    </div>
  );
}

export default function App() {
  const { page, go, account, init, back, forward, home } = useForge();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
      if (e.key === "ArrowRight") { e.preventDefault(); forward(); }
      if (e.key === "Home") { e.preventDefault(); home(); }
    };
    const onMouse = (e: MouseEvent) => { if (e.button === 3) back(); if (e.button === 4) forward(); };
    window.addEventListener("keydown", onKey); window.addEventListener("mouseup", onMouse);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mouseup", onMouse); };
  });
  const groups = [...new Set(NAV.map((n) => n.group))];
  const Page = {
    account: AccountPage, heroes: OptimizerPage, optimizer: OptimizerPage, accountopt: AccountOptPage, speed: SpeedTunePage,
    gear: GearPage, bench: BenchmarkPage, recommend: RecommendPage, settings: SettingsPage, info: AppInfoPage, counters: CountersPage,
    arenadef: ArenaDefensePage, rta: RtaDraftPage, gwoff: GwOffensePage, gwdef: GwDefensePage, teams: ArenaDefensePage,
    hunts: HuntsPage, labyrinth: LabyrinthPage, dimensional: DimensionalPage, abyss: AbyssPage,
  }[page] ?? AccountPage;
  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand"><img className="brand-logo" src="./logo.png" alt="" /> E7 Forge</div>
        <NavButtons />
        <span className="muted">{account ? `${account.heroes.length} heroes · ${account.items.length} items` : "No account loaded"}</span>
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 12 }}>{init.gameData.heroCount} heroes in game data · {init.workers} optimizer threads</span>
        <LiveSync />
      </div>
      <nav className="side">
        {groups.map((g) => (
          <div key={g}>
            <div className="group">{g}</div>
            {NAV.filter((n) => n.group === g).map((n) => (
              <div key={n.id} className={"nav" + (page === n.id ? " active" : "")} onClick={() => go(n.id)}>
                {n.label}{n.tier && <span className="tier">{n.tier}</span>}
              </div>
            ))}
          </div>
        ))}
      </nav>
      <main className="main"><Page /></main>
    </div>
  );
}
