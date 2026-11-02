import React from "react";
import { useForge } from "../state";
import { Section } from "../components";

interface Src { name: string; url?: string; license: string; tone: "good" | "warn" | "info"; use: string; shipped: string }

const SOFTWARE: Src[] = [
  { name: "Electron", url: "https://github.com/electron/electron", license: "MIT", tone: "good", use: "Desktop shell (bundles Chromium and Node.js).", shipped: "Yes, runtime" },
  { name: "Chromium", url: "https://www.chromium.org/", license: "BSD-3-Clause + third-party (see LICENSES.chromium.html in the app folder)", tone: "good", use: "Renderer inside Electron.", shipped: "Yes, runtime" },
  { name: "Node.js", url: "https://nodejs.org/", license: "MIT", tone: "good", use: "Main process, worker threads.", shipped: "Yes, runtime" },
  { name: "React / React DOM", url: "https://react.dev/", license: "MIT", tone: "good", use: "User interface.", shipped: "Yes, bundled" },
  { name: "sql.js (SQLite → WebAssembly)", url: "https://github.com/sql-js/sql.js", license: "MIT (SQLite: public domain)", tone: "good", use: "Local database for gear, heroes, snapshots, caches.", shipped: "Yes, bundled" },
  { name: "Vite, esbuild, TypeScript, Vitest", url: "https://vitejs.dev/", license: "MIT (TypeScript: Apache-2.0)", tone: "good", use: "Build and test tools.", shipped: "No, build only" },
  { name: "electron-builder, resedit", url: "https://www.electron.build/", license: "MIT", tone: "good", use: "Packaging the Windows build and embedding the icon.", shipped: "No, build only" },
  { name: "scapy", url: "https://scapy.net/", license: "GPL-2.0", tone: "info", use: "Packet capture for Live Sync. Runs as a separate Python process.", shipped: "No, you install it (pip)" },
  { name: "Npcap", url: "https://npcap.com/", license: "Npcap License (free edition for personal use)", tone: "info", use: "Windows capture driver used by scapy.", shipped: "No, you install it" },
  { name: "Python 3", url: "https://www.python.org/", license: "PSF License", tone: "good", use: "Runs the capture sidecar.", shipped: "No, you install it" },
];

const DATA: Src[] = [
  { name: "Fribbels Epic 7 Optimizer", url: "https://github.com/fribbels/Fribbels-Epic-7-Optimizer", license: "No license declared (all rights reserved by default)", tone: "warn",
    use: "Reference for stat formulas, gear score weights, reforge tables, export format and decoder field mapping. Re-implemented, not copied wholesale. Hero portraits load from its public image cache.", shipped: "Formulas (re-implemented)" },
  { name: "RexQian fork (v1.12.9-offline)", url: "https://github.com/RexQian/Fribbels-Epic-7-Optimizer", license: "No license declared (all rights reserved by default)", tone: "warn",
    use: "Bundled herodata.json and artifactdata.json (hero base stats, skill multipliers) and the sample export used by the preview. 'Update hero data' pulls its latest release.", shipped: "Yes, data files" },
  { name: "Dodaca Linux fork", url: "https://github.com/Dodaca/Fribbels-Epic-7-Optimizer-linux", license: "No license declared (all rights reserved by default)", tone: "warn",
    use: "Reviewed for scanner behaviour and Steam support. Nothing taken.", shipped: "No" },
  { name: "Fribbels online services", url: "https://fribbels.github.io/e7/hero-library.html", license: "No published terms", tone: "warn",
    use: "Hero library (community builds for benchmarks/targets, cached 3 days), Live Sync decoder (captured game traffic is sent here to be decoded), S3 hero-data fallback.", shipped: "No, online only" },
  { name: "EXCOFF E7 Builder and Guides", url: "https://github.com/EXCOFFee/EXCOFF-E7-Builder-and-Guides", license: "MIT, © 2024 EXCOFFee", tone: "good",
    use: "Bundled hero-effects.json and effects.json (buffs/debuffs per skill) for role tags and team synergy.", shipped: "Yes, data files" },
  { name: "epic7db.com", url: "https://epic7db.com", license: "No open license (site content)", tone: "warn",
    use: "Skill pages read to derive role tags (strip, cleanse, CR push…). Only the derived tags ship; 'Fetch missing role tags' reads pages on demand at 1 request per 1.2 s.", shipped: "Derived tags only" },
  { name: "epic7db.com tier lists", url: "https://epic7db.com/tierlists/epic-seven-rta-tier-list", license: "No open license (site content)", tone: "warn",
    use: "RTA and PvE tier placements (SS to D) bundled as epic7db-tiers.json for the PvP pages, and Memory Imprint values per hero (imprints.json). Also epic7db hunt guides (Wyvern 13 setup, 3-star hunts) for PvE teams and breakpoints.", shipped: "Derived lists only" },
  { name: "epic7rtastats.com", url: "https://www.epic7rtastats.com/meta", license: "No published license; robots.txt allows crawling", tone: "warn",
    use: "Champion+ RTA pick, win and pre-ban rates for the top 20 heroes, with the date window shown on each PvP page. Fetched at most once a day; the last good copy is kept.", shipped: "No, online only" },
  { name: "CeciliaBot Camp Simulator", url: "https://ceciliabot.github.io/camping-simulator/", license: "No license declared (all rights reserved by default)", tone: "warn",
    use: "Hero camping personalities and topics (CampingData.json, HeroDatabase.json) fetched at runtime and cached 7 days. The topic reaction table and the morale rules were read from the simulator and bundled as camping-topics.json.", shipped: "Topic table only" },
  { name: "PvE guides (game8, Reddit r/EpicSeven, BlueStacks)", url: "https://game8.co/games/Epic-Seven", license: "Site content, no open license", tone: "warn",
    use: "Raid (2020), Abyss 101-110 (2020) and hunt notes summarised into pve-presets.json. Each line keeps its source link, date and a confidence label; 2020 data is marked legacy.", shipped: "Summaries with links" },
  { name: "E7 Analyzer (slendymang)", url: "https://e7-analyzer-slendymang.vercel.app/meta-dashboard/", license: "No published license or terms", tone: "warn",
    use: "Top-player RTA figures (hero win and pick/ban rates, best pairs and trios, pre-banned pairs, heroes taken at each draft pick) read from dashboard PDFs you save, kept in data/meta-history/e7analyzer. Player names are not stored.", shipped: "Saved figures" },
  { name: "slendy.gg E7 Dictionary", url: "https://slendy.gg", license: "No published license; game text is Smilegate's", tone: "warn",
    use: "Artifact class locks, stars and effect text from a saved copy of the Artifacts tab, bundled as artifact-dictionary.json.", shipped: "Yes, data file" },
  { name: "e7rtabot.com", url: "https://e7rtabot.com", license: "Terms forbid automated access", tone: "warn",
    use: "Reviewed and deliberately not used.", shipped: "No" },
  { name: "CeciliaBot EpicSevenAssetRipper", url: "https://github.com/CeciliaBot/EpicSevenAssetRipper", license: "n/a", tone: "info",
    use: "Suggested as a data source; reviewed, not used.", shipped: "No" },
];

const GAME: Src[] = [
  { name: "Epic Seven game content", url: "https://epic7.onstove.com/", license: "© Smilegate Megaport / Super Creative. All rights reserved.", tone: "warn",
    use: "Hero names, stats and skill data (via the sources above), hero portraits, and the set and gear-slot icons (cropped from your own screenshots).", shipped: "Icons + data, personal use" },
  { name: "E7 Forge app icon", license: "Provided by you", tone: "good", use: "Taskbar, window and executable icon.", shipped: "Yes" },
];

export default function AppInfoPage() {
  const { init, api } = useForge();
  const rt = init.runtime;
  const Table = ({ rows }: { rows: Src[] }) => (
    <table className="info-table">
      <thead><tr><th>Source</th><th>License</th><th>How E7 Forge uses it</th><th>Shipped</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.name}>
          <td>{r.url ? <a onClick={() => api.openExternal(r.url!)}>{r.name}</a> : r.name}</td>
          <td><span className={"pill " + r.tone}>{r.license}</span></td>
          <td className="wrap">{r.use}</td>
          <td className="muted">{r.shipped}</td>
        </tr>
      ))}</tbody>
    </table>
  );
  return (
    <div className="stack">
      <div className="row" style={{ gap: 18, alignItems: "center" }}>
        <img src="./logo.png" width={84} height={84} alt="" />
        <div>
          <h1>E7 Forge {init.version}</h1>
          <p className="sub" style={{ margin: 0 }}>Personal Epic Seven gear optimizer. Not affiliated with or endorsed by Smilegate, Super Creative, Fribbels or any source below.</p>
          <p className="muted mono" style={{ margin: "6px 0 0", fontSize: 12 }}>
            {rt ? `Electron ${rt.electron} · Chromium ${rt.chrome} · Node ${rt.node} · ` : ""}{init.workers} optimizer threads · game data: {init.gameData.source} ({init.gameData.heroCount} heroes)
          </p>
        </div>
      </div>
      <Section title="Software"><Table rows={SOFTWARE} /></Section>
      <Section title="Data, code references and online services"><Table rows={DATA} /></Section>
      <Section title="Game content and artwork"><Table rows={GAME} /></Section>
      <Section title="Notes">
        <ul className="steps">
          <li>E7 Forge itself is licensed GPL-3.0-or-later (LICENSE in the app folder). Bundled data and icons are not; THIRD_PARTY_NOTICES.txt lists their terms.</li>
          <li>"No license declared" means the authors haven't granted reuse rights. Those sources are credited here and used for personal, non-commercial use only. Don't redistribute E7 Forge with their data without asking them.</li>
          <li>Live Sync sends captured game traffic only to the decoder URL in Settings, and only new buffers, over one connection that closes when Live Sync stops.</li>
          <li>Your account data stays on this PC (%APPDATA%\e7-forge). Community lookups send only the hero's name.</li>
        </ul>
      </Section>
    </div>
  );
}
