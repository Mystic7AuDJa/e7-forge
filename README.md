# E7 Forge

Gear optimizer for Epic Seven on Windows, built because Fribbels stopped getting updates. It reads gear and heroes from game traffic, so there's no export/import step.

Personal project. Version 0.1.2.

## Install (portable build)

1. Extract `E7-Forge-win-x64.zip` anywhere, e.g. `C:\Tools\E7 Forge`. For updates, delete the old folder and extract fresh. Your data is in `%APPDATA%\e7-forge`, not the app folder, so nothing is lost.
2. Run `E7 Forge.exe`.
3. Live Sync needs three things, once:
   - Python 3 from python.org, with "Add python.exe to PATH" ticked.
   - Npcap from npcap.com, with "WinPcap API-compatible mode" ticked.
   - scapy: *Account & Live Sync → Install scapy*, or `py -m pip install scapy==2.8.0`.
4. Turn on **Live Sync** (top right), start the game, open Inventory, then the Heroes list. Each screen imports about 4 s after it loads. **Sync now** forces it.
5. Memory Imprints, artifacts and EE aren't in the captured data. In Hero Optimizer, set each hero's **Memory Imprint** (Release or Concentration, and grade) and enter artifact / EE bonuses once. Later syncs keep them.

No Python or Npcap? Use *Import Fribbels / RexQian save…* instead. Fribbels, the RexQian fork and the Dodaca Linux fork all write the same format.

## Pages

Data
- **Account & Live Sync**: capture status, file import/export, snapshots.
- **Gear & Upgrade ROI**: every item with substats in columns and filters. Monte Carlo to +15 for each unfinished item (sub reveals by rank, reforge for 85s), and an upgrade queue.

Optimize
- **Hero Optimizer**: pick a hero from the roster on the left. Benchmark mode (default) targets the community's top 1% for that hero; you choose 1–4 priority stats. Custom mode is the old weights/bounds optimizer.
- **Account-Wide Optimizer**: select heroes, set priorities and speed-order rules, and it gears them together without sharing items.
- **Speed Tuning**: turn-order sim with 0–5% starting CR, pushes, speed buffs. Tells you the speed needed to guarantee an order.

Analyze
- **Compare Builds Against Community**: your hero vs. about 3,000 recent builds from the Fribbels hero library.
- **Stat Recommendations**: targets the community top 1% for the hero, weighted by what its kit needs, builds the closest match from your gear, and explains the gaps.

PvP
- **Offense (Counter Planner)**: enter an enemy defense, get estimated enemy builds, the threats in it, and counter teams from your roster.
- **Arena Defense, RTA Draft, Guild War Offense, Guild War Defense**: teams from your roster scored with epic7db's A–SS tiers and Champion+ RTA rates. Defense scoring favours anti-cleave tools. Guild War Offense builds cleave teams when you can field one and leaves pure healers out; otherwise bruiser teams.

PvE
- **Hunts**: stage 13 guide teams matched to what you own, with stat breakpoints checked against your current builds. The Otherworldly / Hell toggle reuses the 13 data.
- **Labyrinth & Azmakalis Raid, Dimensional Exploration**: teams ranked on camp morale (CeciliaBot Camp Simulator rules) and sustain.
- **Abyss**: pick a floor range and floor.

Team suggestions show the Imprint Release each team gives. Auras that cover all allies are added to every member when a team is geared together; slot-limited ones (e.g. left and right) are listed but not applied, since they depend on your formation. Concentration is added to that hero's own stats everywhere.

Every suggested team has a button that opens it in the Account-Wide Optimizer with those heroes pre-selected. For PvE it also carries the required breakpoints over as minimums.

Back / Home / Forward are in the top bar (also Alt+Left, Alt+Home, Alt+Right and the mouse side buttons).

## Live Sync details

- `capture/e7forge_sniffer.py` sniffs TCP ports 3333/5222 with scapy + Npcap and streams the payloads to the app. It never sends anything to the game.
- Decoding goes through Fribbels' public decoder (`…/dev/getItems`), same as Fribbels and every fork. To keep load on it low:
  - only new buffers are sent, never tiny keep-alives or ones already decoded;
  - auto-syncs are at least 20 s apart;
  - one keep-alive connection, closed normally when Live Sync stops;
  - Live Sync turns itself off after 10 min with no decoder traffic (Settings → Live Sync).
- Items match by in-game ID, heroes by name. Equipment is relinked from the game's "equipped by" IDs, so it doesn't matter which screen you open first. Every sync saves a snapshot; the last 25 can be restored.

## Data sources

App Info in the app lists every source, what it's used for, and its license.

- Hero stats and skill multipliers: RexQian fork v1.12.9-offline `herodata.json`. *Settings → Update hero data* pulls newer releases, falling back to Fribbels' S3.
- Role tags: EXCOFF E7 Builder `hero-effects.json` (MIT) plus epic7db skill pages.
- PvP: epic7db RTA tier list (bundled) and epic7rtastats.com Champion+ rates (fetched at most once a day). e7rtabot.com isn't used because its terms forbid automated access.
- PvE: `data/pve-presets.json`, summarised from epic7db, game8, Reddit and BlueStacks guides. Each line keeps its source, date and a confidence label.
- Memory Imprints: Release and Concentration values per hero from epic7db hero pages (`data/imprints.json`).
- Camping: CeciliaBot's camping data, fetched at runtime and cached for 7 days.
- Stat math follows Fribbels' `StatCalculator`; a test checks one hero against Fribbels' numbers.

## Known issues

- Steam client is untested. The sniffer filters by port, so it should work if Steam uses the same servers. If nothing syncs, find the port in Wireshark and add it under *Settings → Capture ports*.
- Hero level only shows when the capture includes it; otherwise you see stars and awakening.
- No site tracks Arena or Guild War teams, so those pages use RTA data as a stand-in.
- epic7rtastats publishes rates for the top 20 heroes per list only; everyone else shows a dash.
- Only Wyvern 13 and Azimanak 13 have sourced stat breakpoints. Raid bosses and Abyss 101–110 come from 2020 guides (labelled "legacy 2020"). Most Abyss floors and Dimensional Exploration have no guide data.
- Six hero names from the guides couldn't be matched to game data and were dropped (e.g. "SC Wanda").
- Not built yet: combat simulator, hero investment planner (needs material counts, which capture doesn't decode), history dashboard.

## Troubleshooting

- **"Npcap is not installed"**: reinstall Npcap with WinPcap compatibility mode ticked.
- **"No new game data"**: the screen loaded before Live Sync was on. Reopen Inventory or Heroes.
- **Nothing decodes**: VPNs and Hyper-V virtual switches can hide traffic, so try without them. If the decoder is down, use file import until it's back (the URL is in Settings).
- **"Time limit hit" in the optimizer**: you're seeing the best found so far. Narrow sets or main stats, or add bounds.
- On start, E7 Forge closes any previous E7 Forge window and leftover sniffer process. It only touches its own exe and Python processes running `e7forge_sniffer.py`, and tells you what it closed.

## Build from source

Node 20+. The first run downloads the Electron runtime (~120 MB).

```
setup.bat        :: npm install + pip install scapy
start.bat        :: build and run
build-exe.bat    :: portable build in release\win-unpacked
npm test         :: engine and capture tests
```

## Changelog

0.1.2
- Stat Recommendations aim at the community top 1% (median of the best-geared 1% of builds) with archetype priorities and the top 1%'s sets, and show Top 1% / Your best / Now.
- Counter Planner: 4000+ arena points now map to the top 1–12% gear band.

0.1.1
- Memory Imprints: set Release or Concentration and grade per hero; Release auras show on team suggestions and apply when gearing a team; Fribbels imports keep their imprint.
- Sidebar tier badges removed; wording and capitalization made consistent (Thief, Earth, Spd, Live Sync, Account-Wide Optimizer).
- PvP and PvE pages no longer show source links, confidence labels or guide names; App Info still lists every source.

0.1.0
- PvP and PvE sections replace Team Builder; Counter Planner moved to PvP → Offense.
- Hero roster list replaces the hero dropdown; Heroes page merged into Hero Optimizer.
- Back / Home / Forward navigation.
- +enhance and gear level shown left of each item.
- Gear substats in columns, with filters; sortable tables.
- Benchmark mode is the Hero Optimizer default.
- Counter Planner, App Info page, app icon.
- Live Sync over Npcap with auto-off; startup cleanup of old sessions.

## License

GPL-3.0-or-later, see `LICENSE`. You can use, change and share E7 Forge; if you
share a modified version, its source has to be available under the same license.

The bundled game data, icons and community data are not covered by the GPL and
keep their own terms. `THIRD_PARTY_NOTICES.md` lists each one.
