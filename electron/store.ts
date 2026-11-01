// SQLite persistence via sql.js (WASM, no native rebuild needed on Windows).
import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database } from "sql.js";
import type { Account, Hero, Item } from "../src/engine/types";

export class Store {
  private db!: Database;
  private file: string;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "e7forge.sqlite");
  }

  async open(wasmPath: string) {
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    const buf = fs.existsSync(this.file) ? fs.readFileSync(this.file) : undefined;
    this.db = buf ? new SQL.Database(buf) : new SQL.Database();
    this.db.run(`
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS heroes (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS community (hero TEXT PRIMARY KEY, fetched_at TEXT, json TEXT);
      CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, source TEXT, heroes INTEGER, items INTEGER, avg_gs REAL, json TEXT);
      CREATE TABLE IF NOT EXISTS hero_tags (hero TEXT PRIMARY KEY, tags TEXT, fetched_at TEXT);
    `);
  }

  private persist() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    const data = this.db.export();
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, Buffer.from(data));
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + ".bak");
    fs.renameSync(tmp, this.file);
  }

  get<T>(key: string, fallback: T): T {
    const r = this.db.exec("SELECT value FROM kv WHERE key = ?", [key]);
    if (!r.length) return fallback;
    try { return JSON.parse(String(r[0].values[0][0])) as T; } catch { return fallback; }
  }

  set(key: string, value: unknown) {
    this.db.run("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, JSON.stringify(value)]);
    this.persist();
  }

  loadAccount(): Account | null {
    const heroes = this.db.exec("SELECT json FROM heroes")[0]?.values.map((v) => JSON.parse(String(v[0])) as Hero) ?? [];
    const items = this.db.exec("SELECT json FROM items")[0]?.values.map((v) => JSON.parse(String(v[0])) as Item) ?? [];
    if (!heroes.length && !items.length) return null;
    const meta = this.get<{ importedAt: string; source: string }>("account_meta", { importedAt: "", source: "" });
    return { heroes, items, ...meta };
  }

  saveAccount(acc: Account, snapshot = true) {
    this.db.run("BEGIN");
    this.db.run("DELETE FROM heroes");
    this.db.run("DELETE FROM items");
    const sh = this.db.prepare("INSERT INTO heroes(id,json) VALUES(?,?)");
    for (const h of acc.heroes) sh.run([h.id, JSON.stringify(h)]);
    sh.free();
    const si = this.db.prepare("INSERT INTO items(id,json) VALUES(?,?)");
    for (const i of acc.items) si.run([i.id, JSON.stringify(i)]);
    si.free();
    this.db.run("COMMIT");
    this.set("account_meta", { importedAt: acc.importedAt, source: acc.source });
    if (snapshot) {
      const finished = acc.items.filter((i) => i.enhance >= 15);
      const avg = finished.length ? finished.reduce((a, i) => a + (i.gs ?? 0), 0) / finished.length : 0;
      this.db.run("INSERT INTO snapshots(at,source,heroes,items,avg_gs,json) VALUES(?,?,?,?,?,?)",
        [acc.importedAt, acc.source, acc.heroes.length, acc.items.length, Math.round(avg * 10) / 10, JSON.stringify(acc)]);
      // keep the 25 most recent full snapshots
      this.db.run("DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT 25)");
    }
    this.persist();
  }

  snapshots() {
    const r = this.db.exec("SELECT id, at, source, heroes, items, avg_gs FROM snapshots ORDER BY id DESC");
    return (r[0]?.values ?? []).map(([id, at, source, heroes, items, avgGs]) => ({ id, at, source, heroes, items, avgGs }));
  }

  restoreSnapshot(id: number): Account | null {
    const r = this.db.exec("SELECT json FROM snapshots WHERE id = ?", [id]);
    return r.length ? (JSON.parse(String(r[0].values[0][0])) as Account) : null;
  }

  community(hero: string): { fetchedAt: string; builds: unknown[] } | null {
    const r = this.db.exec("SELECT fetched_at, json FROM community WHERE hero = ?", [hero]);
    if (!r.length) return null;
    return { fetchedAt: String(r[0].values[0][0]), builds: JSON.parse(String(r[0].values[0][1])) };
  }

  saveCommunity(hero: string, builds: unknown[]) {
    this.db.run("INSERT INTO community(hero,fetched_at,json) VALUES(?,?,?) ON CONFLICT(hero) DO UPDATE SET fetched_at=excluded.fetched_at, json=excluded.json",
      [hero, new Date().toISOString(), JSON.stringify(builds)]);
    this.persist();
  }

  heroTags(): Record<string, string[]> {
    const r = this.db.exec("SELECT hero, tags FROM hero_tags");
    return Object.fromEntries((r[0]?.values ?? []).map(([h, t]) => [String(h), JSON.parse(String(t))]));
  }

  saveHeroTags(hero: string, tags: string[]) {
    this.db.run("INSERT INTO hero_tags(hero,tags,fetched_at) VALUES(?,?,?) ON CONFLICT(hero) DO UPDATE SET tags=excluded.tags, fetched_at=excluded.fetched_at",
      [hero, JSON.stringify(tags), new Date().toISOString()]);
    this.persist();
  }

  /** Import/merge a whole JSON backup. */
  exportAll() {
    return { account: this.loadAccount(), settings: this.get("settings", {}) };
  }
}
