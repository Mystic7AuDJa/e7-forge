// Worker thread: runs the heavy engine jobs off the main process.
import { parentPort, workerData } from "node:worker_threads";
import { buildHeroDb, findHeroData, type HeroDb } from "../src/engine/data";
import { optimizeHero } from "../src/engine/optimizer";
import { accountCandidates, optimizeAccount } from "../src/engine/account";
import { recommend } from "../src/engine/recommend";
import { buildTeams, candidatesFrom, planTeam } from "../src/engine/teams";
import { upgradeQueue } from "../src/engine/roi";
import { counterTeams, estimateEnemy } from "../src/engine/counters";
import type { Account, Hero } from "../src/engine/types";

let db: HeroDb = buildHeroDb(workerData.herodata, workerData.tags, workerData.imprints);
let account: Account | null = null;
const hdOf = (h: Hero) => findHeroData(db, h.dataKey || h.name);

parentPort!.on("message", (msg: any) => {
  const { id, type, payload } = msg;
  const reply = (result: unknown) => parentPort!.postMessage({ id, ok: true, result });
  const fail = (e: unknown) => parentPort!.postMessage({ id, ok: false, error: (e as Error)?.message ?? String(e) });
  try {
    switch (type) {
      case "setData": db = buildHeroDb(payload.herodata, payload.tags, payload.imprints); return reply(true);
      case "setAccount": account = payload; return reply(true);
      case "optimize": {
        const acc = need();
        const hero = acc.heroes.find((h) => h.id === payload.request.heroId);
        if (!hero) throw new Error("Hero not found");
        const hd = hdOf(hero);
        if (!hd) throw new Error(`No game data for ${hero.name}. Update game data in Settings.`);
        const res = optimizeHero(hero, hd, acc.items, payload.request, {
          shard: payload.shard, timeLimitMs: payload.timeLimitMs ?? 30000, mode: payload.mode,
          onProgress: (p) => parentPort!.postMessage({ id, progress: p }),
        });
        return reply(res);
      }
      case "accountCandidates": {
        const acc = need();
        const e = payload.request.heroes[payload.index];
        const hero = acc.heroes.find((h) => h.id === e.request.heroId);
        const hd = hero && hdOf(hero);
        if (!hero || !hd) return reply([]);
        return reply(accountCandidates(hero, hd, acc.items, payload.request, payload.index, { timeLimitMs: payload.timeLimitMs ?? 10000 }));
      }
      case "account": {
        const acc = need();
        return reply(optimizeAccount(acc.heroes, hdOf, acc.items, payload.request, { timeLimitMs: payload.timeLimitMs ?? 8000, precomputed: payload.precomputed }));
      }
      case "recommend": {
        const acc = need();
        const hero = acc.heroes.find((h) => h.id === payload.heroId)!;
        const hd = hdOf(hero);
        if (!hd) throw new Error(`No game data for ${hero.name}.`);
        const roster = acc.heroes.map((h) => ({ hero: h, spd: payload.rosterSpeeds?.[h.id] ?? 0 }));
        return reply(recommend({ hero, hd, items: acc.items, roster, community: payload.community, enemySpeed: payload.enemySpeed, allowEquipped: payload.allowEquipped, options: { timeLimitMs: 8000 } }));
      }
      case "teams": {
        const acc = need();
        const cands = candidatesFrom(acc.heroes, hdOf, acc.items);
        const teams = buildTeams(cands, payload.content, payload.options);
        return reply(teams.map((t) => ({ heroIds: t.members.map((m) => m.hero.id), archetypes: t.members.map((m) => m.archetype), report: t.report })));
      }
      case "planTeam": {
        const acc = need();
        const cands = candidatesFrom(acc.heroes.filter((h) => payload.heroIds.includes(h.id)), hdOf, acc.items);
        const ordered = payload.heroIds.map((id: string) => cands.find((c) => c.hero.id === id)).filter(Boolean);
        return reply(planTeam(ordered, acc.items, hdOf, { timeLimitMs: 6000 }, payload.allowEquipped ?? true, payload.minSpeed ?? {}));
      }
      case "counters": {
        const acc = need();
        const estimates = payload.enemies.map((e: any) => estimateEnemy(e.name, findHeroData(db, e.name), e.builds ?? [], e.band));
        const cands = candidatesFrom(acc.heroes, hdOf, acc.items);
        const { threats, teams } = counterTeams(cands, estimates, payload.mode, { top: 5, mustInclude: payload.mustInclude, rng: payload.rng });
        return reply({ estimates: estimates.map(({ hd, ...e }: any) => ({ ...e, tags: hd?.tags ?? [], attribute: hd?.attribute, role: hd?.role })), threats, teams });
      }
      case "upgradeQueue": {
        const acc = need();
        return reply(upgradeQueue(acc.items, payload.options ?? {}, payload.max ?? 150).map((x) => ({ itemId: x.item.id, f: x.f })));
      }
      default: throw new Error(`Unknown job ${type}`);
    }
  } catch (e) { fail(e); }
});

function need(): Account {
  if (!account) throw new Error("No account loaded. Import a file or turn on Live Sync first.");
  return account;
}
