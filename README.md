# E7 Forge

Personal Epic Seven gear optimizer for Windows. It reads your gear and heroes straight from game traffic (Live sync), optimizes single heroes or whole rosters, checks speed tunes, forecasts upgrade value, benchmarks builds against the community, recommends target stats with reasons, and builds teams.

Version 0.1.0 · October 2026 · personal use.

## Quick start (portable build)

1. Extract `E7-Forge-win-x64.zip` anywhere (e.g. `C:\Tools\E7 Forge`). Re-extract over the old folder for updates; your data lives in `%APPDATA%\e7-forge`, not in the app folder.
2. Run **`E7 Forge.exe`**.
3. Live sync needs, once:
   - **Python 3** from python.org, with "Add python.exe to PATH" ticked.
   - **Npcap** from npcap.com, with "WinPcap API-compatible mode" ticked.
   - **scapy**: in E7 Forge go to *Account & Live Sync → Install scapy* (or run `py -m pip install scapy==2.8.0`).
4. Flip **Live sync** on (top right), start Epic Seven, open the **Inventory**, then the **Heroes** list. Each screen imports ~4 s after it loads; **Sync now** forces it.
5. On *Heroes*, enter artifact/imprint/EE bonuses per hero once (capture doesn't include them). They survive later syncs.

No Python/Npcap? Use *Import Fribbels / RexQian save…* instead. Exports from Fribbels, the RexQian fork and the Dodaca Linux fork share one format.

## Live sync

- `capture/e7forge_sniffer.py` passively sniffs TCP ports 3333/5222 on all interfaces (Npcap), reassembles payloads the same way Fribbels' scanner does, and streams them to the app. It sends nothing itself.
- Decoding uses **Fribbels' public decoder** (`…/dev/getItems`), the same service Fribbels and every fork use. No fork decodes locally.
- **Decoder etiquette:**
  - Only new captured game buffers are sent.
  - Already-decoded and tiny keep-alive buffers are skipped.
  - No request is made when there's nothing new.
  - Auto-syncs are spaced ≥ 20 s apart.
  - One keep-alive connection is used and closed normally when Live sync stops.
  - After **10 min** with no decoder exchange, Live sync **turns itself off** (Settings → Live capture).
- Merge rules:
  - Items match by in-game ID.
  - Heroes match by name; your hand-entered bonuses are kept.
  - Equipment is relinked from in-game "equipped by" IDs, so the order you open Inventory/Heroes doesn't matter.
  - Every sync saves a snapshot (last 25, restorable).
- **Steam client:** untested. The sniffer filters by port, not by client, so it should work if Steam uses the same game servers. If nothing syncs, open the inventory with Wireshark running, find the port, and add it in *Settings → Capture ports*.

## Features vs. your list

| # | Feature | Where | Notes |
|---|---|---|---|
| 1 | Account-wide optimization | Account-wide Optimizer | Per-hero top-K builds (parallel), then branch-and-bound assignment with no shared items. Objectives: average score / team CP / average GS. Gear-move penalty, priorities, speed-order rules (preserve tuning). |
| 2 | AI team builder | PvP and PvE sections | **PvP:** Offense (Counter Planner), Arena Defense (4), RTA Draft (5-hero core), Guild War Offense (3; cleave when your roster can field one, with pure sustain supports like Tamarinne left out; otherwise bruiser), Guild War Defense (3). Each uses epic7db's A–SS RTA tiers plus Champion+ RTA pick/win/pre-ban rates (epic7rtastats.com, date window shown), shows the top-player hero pool against what you own, and defenses score anti-cleave tools. **PvE:** Hunts (stage 13, with an Otherworldly/Hell toggle that reuses the 13 data), Labyrinth & Azmakalis Raid (boss select, Normal/Hell), Dimensional Exploration, Abyss (floor-range toggle). Guide teams are matched to your heroes (with alternatives), stat breakpoints are checked against current builds, and Labyrinth/Dimensional teams are ranked on camp morale (CeciliaBot Camp Simulator rules) plus sustain. Every team has **Open in Account-wide Optimizer**, which pre-checks the heroes (and, for PvE, applies required breakpoints as minimums). |
| 3 | Gear recommendation AI | Stat Recommendations | Archetype from skill scaling + tags, targets from community top-10% cohort, crit threshold, effectiveness targets. Builds it from your gear and explains: speed rank in your roster, speed-race odds, community percentile. Relaxes targets your gear can't hit and says so. |
| 4 | Build benchmark DB | Compare Builds Against Community | Fribbels hero library (≈3,000 recent builds per hero, cached 3 days): "Top X%" per stat, median, top-10% and top-1% GS cohorts, common sets/artifacts. Player ranks aren't in that data, so Emperor/Legend is approximated by GS cohorts. |
| — | Counter planner | PvP → Offense | Arena (4) or Guild War (3) enemy defense → estimated enemy builds (median of the community gear-score band matching their arena points; editable, labelled as estimate), threat breakdown (survival buffs, CC, revive, counterattack…) with what answers each, ranked counter teams from your roster with first-turn odds vs. estimated enemy speeds, an Outlook score (heuristic, not a win rate), and a team gear plan that targets outspeeding their fastest unit. |
| 5 | Speed-tuning assistant | Speed Tuning | Turn-order sim with 0–5% start-CR RNG, CR push/reduce, speed buff/down. Monte Carlo success rate, "X may cut Y" warnings, exact speed needed to guarantee order, speed-race odds vs. an enemy band. |
| 8 | Gear upgrade ROI | Gear & Upgrade ROI | Monte Carlo to +15 (sub reveals by rank, reforge for 85s): S/A/B/sell odds, p10/median/p90, speed-roll odds, risk, recommendation, ranked upgrade queue. Focus presets (speed DPS, bruiser, support). |
| — | Hero optimizer | Hero Optimizer | **Benchmark mode (default):** loads the hero's community builds, targets the top-1% cohort (median stats + most common set combos), and you pick 1–4 priority stats (weights 4/3/2/1). Builds are ranked by Match % to those targets, with a stat-by-stat "Reached" view. **Custom** toggle keeps the original weights/bounds optimizer. Fribbels-equivalent stat math, split across CPU threads. |
| — | Hero picker | Hero Optimizer, Stat Recommendations, Compare, Account-wide | One roster list replaces the old dropdown: every owned hero with level/stars/awakening, search, element and role filters, sort. Picking a hero shows its current build stats; the selection is shared across pages. The Account-wide Optimizer uses checkboxes. |
| — | Navigation | Top bar | Back / Home / Forward buttons (also Alt+Left, Alt+Home, Alt+Right and mouse side buttons). Gear shows +enhance and item level to the left of each item. |
| 10 | Modernization | — | Electron + React + TypeScript, SQLite (sql.js) with snapshots, worker-thread engine, pure TS engine with tests. |

**Not built yet (Tier 3):** Monte Carlo combat simulator (#7), hero investment planner (#9, needs material inventory, which capture doesn't decode), plugin API/marketplace, history analytics dashboard. Snapshots are already stored for the dashboard.

## Data sources

The full list of sources, what each is used for, and its license is in the app under **App Info**.


- Hero base stats and skill multipliers: RexQian fork v1.12.9-offline `herodata.json` (393 heroes). *Settings → Update hero data* pulls the fork's latest release, falling back to Fribbels' S3.
- Role tags (strip, cleanse, CR push…): EXCOFF E7 Builder `hero-effects.json` (MIT) + epic7db.com skill pages. *Fetch missing role tags* fills in new heroes (1 request/1.2 s).
- PvP meta: epic7db RTA tier list (bundled, A–SS used) and epic7rtastats.com Champion+ rates (fetched at most once a day, last good copy kept). e7rtabot.com is not used: its terms forbid automated access. No public site tracks Arena or Guild War teams, so those pages use the same RTA-based meta.
- PvE: `pve-presets.json`, summarised from epic7db hunt guides, game8, Reddit and BlueStacks, with each line's source, date and confidence. Only Wyvern 13 and Azimanak 13 have sourced stat breakpoints. The Raid bosses and Abyss 101-110 data are from 2020 and are labelled legacy.
- Camping morale: CeciliaBot Camp Simulator data, fetched at runtime and cached 7 days.
- Stat formulas: Fribbels `StatCalculator` (fork v1.12.9). The test suite checks a hero against Fribbels' numbers.

## Build from source

Requires Node 20+. The first `start.bat` run downloads the Electron runtime (~120 MB).

```
setup.bat            :: npm install + pip install scapy
start.bat            :: build and run
build-exe.bat        :: portable Windows build in release\win-unpacked (downloads electron-builder on demand)
npm test             :: 28 engine + capture tests
```

## Startup cleanup

Starting E7 Forge first stops any previous session and its leftovers:
- the previous E7 Forge window and helper processes (including older versions run from another folder),
- any live-capture sniffer still running.

Only E7 Forge's own executable and Python processes running `e7forge_sniffer.py` are touched. A notice in the app lists what was closed.

## Troubleshooting

- **"Npcap is not installed"**: reinstall Npcap with WinPcap compatibility mode ticked.
- **Sync says "no new game data"**: the screen loaded before Live sync was on. Re-open the Inventory/Heroes screen.
- **Decoder errors / nothing decodes**: VPNs and Hyper-V virtual switches can hide traffic; try without the VPN. If the decoder service is down, use file import until it's back (the URL is configurable).
- **Optimizer "time limit hit"**: results are the best found. Narrow sets/mains or add bounds for an exhaustive search.
