E7 Forge
========

Gear optimizer for Epic Seven on Windows, built because Fribbels stopped
getting updates. It reads gear and heroes from game traffic, so there's no
export/import step.

Version 0.1.6.

Install (portable build)
------------------------

1. Extract E7-Forge-win-x64.zip anywhere, e.g. C:\Tools\E7 Forge. For updates,
   delete the old folder and extract fresh. Your data is in
   %APPDATA%\e7-forge, not the app folder, so nothing is lost.
2. Run E7 Forge.exe.
3. Live Sync needs three things, once:
   - Python 3 from python.org, with "Add python.exe to PATH" ticked.
   - Npcap from npcap.com, with "WinPcap API-compatible mode" ticked.
   - scapy: Account & Live Sync -> Install scapy, or py -m pip install
     scapy==2.8.0.
4. Turn on Live Sync (top right), start the game, open Inventory, then the
   Heroes list. Each screen imports about 4 s after it loads. Sync now forces
   it.
5. Memory Imprints, artifacts and EE aren't in the captured data. In Hero
   Optimizer, set each hero's Memory Imprint (Release or Concentration, and
   grade) and enter artifact / EE bonuses once. Later syncs keep them.

No Python or Npcap? Use Import Fribbels / RexQian save… instead. Fribbels, the
RexQian fork and the Dodaca Linux fork all write the same format.

Pages
-----

Data
- Account & Live Sync: capture status, file import/export, snapshots.
- Gear & Upgrade ROI: every item with substats in columns and filters. The
  Forecast simulates each unfinished item to +15 (sub reveals by rank, reforge
  for 85s) and gives its likely tier; hover the tiers for what they mean. If
  you enhanced or rerolled in game without syncing, update the item by hand
  there. Upgrade queue ranks what to enhance next.

Optimize
- Hero Optimizer: pick a hero from the roster on the left. Benchmark mode
  (default) targets the community's top 1% for that hero; you choose 1–4
  priority stats. Custom mode is the old weights/bounds optimizer.
- Account-Wide Optimizer: select heroes, set priorities and speed-order rules,
  and it gears them together without sharing items.
- Speed Tuning: turn-order sim with 0–5% starting CR, pushes, speed buffs.
  Tells you the speed needed to guarantee an order.

Analyze
- Compare Builds Against Community: your hero vs. about 3,000 recent builds
  from the Fribbels hero library.
- Stat Recommendations: targets the community top 1% for the hero, weighted by
  what its kit needs, builds the closest match from your gear, and explains
  the gaps.

PvP
- Offense (Counter Planner): enter an enemy defense, get estimated enemy
  builds, the threats in it, and counter teams from your roster.
- RTA Draft: a live draft assistant. Set who picks first, enter pre-bans and
  picks as they happen, and it ranks your own heroes for your next pick:
  top-player win rate (shrunk toward the average so small samples don't
  dominate), proven pairs and trios with what you've picked, how well the kit
  answers the enemy's picks so far, how often Champion+ players take the hero
  at that pick slot, and your gear. Each score shows its parts. When both
  teams are in, it ranks which enemy hero to ban and which of yours they'll
  likely ban. Draft cores below it use the same top-player data.
- Arena Defense, RTA Draft, Guild War Offense, Guild War Defense: teams from
  your roster scored with epic7db's A–SS tiers and Champion+ RTA rates.
  Defense scoring favours anti-cleave tools. Guild War Offense builds cleave
  teams when you can field one and leaves pure healers out; otherwise bruiser
  teams.

PvE
- Hunts: stage 13 guide teams matched to what you own, with stat breakpoints
  checked against your current builds. The Otherworldly / Hell toggle reuses
  the 13 data.
- Labyrinth & Azmakalis Raid, Dimensional Exploration: teams ranked on camp
  morale (CeciliaBot Camp Simulator rules) and sustain.
- Abyss: pick a floor range and floor.

Team suggestions show the Imprint Release each team gives. Auras that cover
all allies are added to every member when a team is geared together;
slot-limited ones (e.g. left and right) are listed but not applied, since they
depend on your formation. Concentration is added to that hero's own stats
everywhere.

Every suggested team has a button that opens it in the Account-Wide Optimizer
with those heroes pre-selected. For PvE it also carries the required
breakpoints over as minimums.

Back / Home / Forward are in the top bar (also Alt+Left, Alt+Home, Alt+Right
and the mouse side buttons).

Live Sync details
-----------------

- capture/e7forge_sniffer.py sniffs TCP ports 3333/5222 with scapy + Npcap and
  streams the payloads to the app. It never sends anything to the game.
- Decoding goes through Fribbels' public decoder (…/dev/getItems), same as
  Fribbels and every fork. To keep load on it low:
  - only new buffers are sent, never tiny keep-alives or ones already decoded;
  - auto-syncs are at least 20 s apart;
  - one keep-alive connection, closed normally when Live Sync stops;
  - Live Sync turns itself off after 10 min with no decoder traffic (Settings
    -> Live Sync).
- Items match by in-game ID, heroes by name. Equipment is relinked from the
  game's "equipped by" IDs, so it doesn't matter which screen you open first.
  Every sync saves a snapshot; the last 25 can be restored.

Data sources
------------

App Info in the app lists every source, what it's used for, and its license.

- Hero stats and skill multipliers: RexQian fork v1.12.9-offline
  herodata.json. Settings -> Update hero data pulls newer releases, falling
  back to Fribbels' S3.
- Role tags: EXCOFF E7 Builder hero-effects.json (MIT) plus epic7db skill
  pages.
- PvP: epic7db RTA tier list (bundled) and epic7rtastats.com Champion+ rates
  (fetched at most once a day). e7rtabot.com isn't used because its terms
  forbid automated access.
- PvE: data/pve-presets.json, summarised from epic7db, game8, Reddit and
  BlueStacks guides. Each line keeps its source, date and a confidence label.
- Memory Imprints: Release and Concentration values per hero from epic7db hero
  pages (data/imprints.json).
- Camping: CeciliaBot's camping data, fetched at runtime and cached for 7
  days.
- Stat math follows Fribbels' StatCalculator; a test checks one hero against
  Fribbels' numbers.

Weekly meta history
-------------------

data/meta-history/ keeps one snapshot per week of the Champion+ RTA meta from
epic7rtastats.com/meta: top picks, pre-bans, bans, win rates, pick order,
pre-banned pairs, and the most used sets and artifacts per hero. TRENDS.txt
lists the latest week and what moved since the week before: anything that
entered or left a top list, picks or pre-bans that moved 3+ points, and win
rates that moved 2+ points on heroes picked in at least 5% of games.

Run it by hand with: npm run meta:snapshot (one request; it skips a week that
is already saved). A scheduled task runs it every Monday and pushes the result.

The site publishes per-hero numbers, not full 5-hero teams, so the history
tracks heroes, pairs, sets and artifacts rather than whole teams.

Top-player data from E7 Analyzer (manual export)

data/meta-history/e7analyzer/ holds saved copies of the E7 Analyzer meta
dashboard (e7-analyzer-slendymang.vercel.app/meta-dashboard/): over 600,000
top-player matches this season, with win rate, games and pick/ban rate for
every hero, the best pairs and trios, the most pre-banned pairs, the
dashboard's week-over-week movers, and (when the tables are expanded) which
heroes top players take at each of their five picks and how those drafts went.
Files are named by date and rank filter (2026-11-02-champion-plus.json); the
app uses the newest, and a Champion+ export over All Ranks on the same day. REPORT.txt summarises the latest export and,
from the second export on, the games and win rates in the week between the
two exports (season totals hardly move, the weekly slice does).

To add a week:
1. Open the dashboard. Leave the window on Season Start -> Now and set the
   rank to Champion+ (keep the same rank each week so weeks compare).
2. Click "show more" on both hero pools, and "Expand as Table" on Hero
   Performance, First / Second Pick Performance and all ten Draft Position
   cards.
3. Print -> Save as PDF.
4. Run: npm run meta:import-e7analyzer -- "path/to/the.pdf" (needs pdftotext
   from poppler), or send the PDF to have it imported.

Artifact effects and class locks come from the Artifacts tab of the slendy.gg
E7 Dictionary, saved as a PDF and imported with:
npm run data:import-artifacts -- "path/to/the.pdf"

Win rates are from the tracked top player's side, so they sit above 50%;
compare heroes with each other, not with 50%. Player names on the dashboard's
leaderboard are not stored.

Known issues
------------

- Hero level only shows when the capture includes it; otherwise you see stars
  and awakening.
- Not built yet: combat simulator, hero investment planner (needs material
  counts, which capture doesn't decode), history dashboard.

Troubleshooting
---------------

- "Npcap is not installed": reinstall Npcap with WinPcap compatibility mode
  ticked.
- "No new game data": the screen loaded before Live Sync was on. Reopen
  Inventory or Heroes.
- Nothing decodes: VPNs and Hyper-V virtual switches can hide traffic, so try
  without them. If the decoder is down, use file import until it's back (the
  URL is in Settings).
- "Time limit hit" in the optimizer: you're seeing the best found so far.
  Narrow sets or main stats, or add bounds.
- On start, E7 Forge closes any previous E7 Forge window and leftover sniffer
  process. It only touches its own exe and Python processes running
  e7forge_sniffer.py, and tells you what it closed.

Build from source
-----------------

Node 20+. The first run downloads the Electron runtime (~120 MB).

    setup.bat        :: npm install + pip install scapy
    start.bat        :: build and run
    build-exe.bat    :: portable build in release\win-unpacked
    npm test         :: engine and capture tests

Changelog
---------

0.1.6
- Gear & Upgrade ROI: new "+15 tier" column with each item's Monte Carlo rating (S, A, B or Sell, plus that tier's chance for unfinished gear). It follows the tier thresholds and forecast type you set, matches the Forecast panel, and can be sorted.

0.1.5
- RTA Draft: each recommendation is scored for the exact pick you're on (your 1st to 5th, first or second pick), from how often top players take that hero there and how those drafts went.
- Top-player data now comes from a Champion+ export; exports are kept per rank filter and only compared with the same filter.
- Hero header shows the equipped artifact's effect and warns when it's locked to another class. Benchmark lists artifacts by name, with the effect on hover.

0.1.4
- RTA Draft: live draft assistant (pre-bans, picks in E7's 1-2-2-2-2-1 order, next-pick ranking with reasons, final ban advice).
- RTA scoring uses top-player data from E7 Analyzer exports (win rates, pick/ban, pairs, trios) and Champion+ pick-by-slot data; heroes top players don't play rank below those they do.
- Hero pool table shows top-player win rate, games and pick/ban rate.

0.1.3
- Counter Planner: Reset button clears the enemy defense.
- Hero list: element and class filters work for Live Sync heroes (they carry
  no element/class, so game data is used) and Earth matches.
- Gear Forecast: shows the likely tier at +15 with score now -> expected;
  hover explains the tiers. "Update item manually" edits enhance level (+0 to
  +15) and substats, re-forecasts as you type, and saves to the item.

0.1.2
- Stat Recommendations aim at the community top 1% (median of the best-geared
  1% of builds) with archetype priorities and the top 1%'s sets, and show Top
  1% / Your best / Now.
- Counter Planner: 4000+ arena points now map to the top 1–12% gear band.

0.1.1
- Memory Imprints: set Release or Concentration and grade per hero; Release
  auras show on team suggestions and apply when gearing a team; Fribbels
  imports keep their imprint.
- Sidebar tier badges removed; wording and capitalization made consistent
  (Thief, Earth, Spd, Live Sync, Account-Wide Optimizer).

0.1.0
- PvP and PvE sections replace Team Builder; Counter Planner moved to PvP ->
  Offense.
- Hero roster list replaces the hero dropdown; Heroes page merged into Hero
  Optimizer.
- Back / Home / Forward navigation.
- +enhance and gear level shown left of each item.
- Gear substats in columns, with filters; sortable tables.
- Benchmark mode is the Hero Optimizer default.
- Counter Planner, App Info page, app icon.
- Live Sync over Npcap with auto-off; startup cleanup of old sessions.

License
-------

GPL-3.0-or-later, see LICENSE. You can use, change and share E7 Forge; if you
share a modified version, its source has to be available under the same
license.

The bundled game data, icons and community data are not covered by the GPL and
keep their own terms. THIRD_PARTY_NOTICES.txt lists each one.
