// Live capture service: runs the Python/scapy sniffer sidecar, watches for a
// burst of game traffic to settle, decodes it and hands the result back.
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import readline from "node:readline";
import { convertDecoderResponse, RELOAD_HINT, type DecoderResponse, type ScanConvertOptions } from "../src/engine/scan";
import { DecoderClient } from "./decoder";

export interface CaptureSettings {
  pythonPath: string; // "" = auto-detect
  ports: number[];
  decoderUrl: string;
  autoSync: boolean;
  /** Bytes of new traffic needed before an auto-sync is considered. */
  minBytes: number;
  /** Quiet period (ms) after the last packet before auto-syncing. */
  idleMs: number;
  iface: string;
  minEnhance: number;
  minStars: number;
  /** Turn Live Sync off after this many minutes without a decoder exchange (0 = never). */
  autoOffMinutes: number;
  /** Minimum seconds between automatic decoder requests. */
  minAutoIntervalSec: number;
}

export type CaptureState = "off" | "starting" | "listening" | "decoding" | "error";

export interface Diagnostics {
  python: string | null; pythonVersion: string | null; scapy: string | null; npcap: boolean | null; platform: string; admin: boolean | null;
}

export class CaptureService extends EventEmitter {
  state: CaptureState = "off";
  private child: ChildProcessWithoutNullStreams | null = null;
  private bytes = 0;
  private lastChange = 0;
  private lastSyncedBytes = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private pendingFlush: ((bufs: string[]) => void) | null = null;
  private autoOffTimer: NodeJS.Timeout | null = null;
  private lastAuto = 0;
  private decoder = new DecoderClient();
  lastError: string | null = null;

  constructor(private scriptPath: string, private getSettings: () => CaptureSettings) { super(); }

  private setState(s: CaptureState, extra: Record<string, unknown> = {}) {
    this.state = s;
    this.emit("status", { state: s, bytes: this.bytes, error: this.lastError, decoderOpen: this.decoder.open, decoderRequests: this.decoder.requests, ...extra });
  }

  static findPython(preferred: string): string[] | null {
    const candidates: string[][] = preferred ? [preferred.split(" ")] : process.platform === "win32"
      ? [["py", "-3"], ["python"], ["python3"]]
      : [["python3"], ["python"]];
    for (const c of candidates) {
      const r = spawnSync(c[0], [...c.slice(1), "-c", "import sys;print(sys.version.split()[0])"], { encoding: "utf8", timeout: 8000, windowsHide: true });
      if (!r.error && r.status === 0 && r.stdout.trim().startsWith("3")) return c;
    }
    return null;
  }

  diagnostics(): Diagnostics {
    const py = CaptureService.findPython(this.getSettings().pythonPath);
    let pythonVersion: string | null = null, scapy: string | null = null;
    if (py) {
      pythonVersion = spawnSync(py[0], [...py.slice(1), "-c", "import sys;print(sys.version.split()[0])"], { encoding: "utf8", windowsHide: true }).stdout.trim();
      const s = spawnSync(py[0], [...py.slice(1), "-c", "import scapy;print(scapy.__version__)"], { encoding: "utf8", windowsHide: true });
      scapy = s.status === 0 ? s.stdout.trim() : null;
    }
    let npcap: boolean | null = null;
    if (process.platform === "win32") {
      const sys32 = process.env.SystemRoot ? `${process.env.SystemRoot}\\System32` : "C:\\Windows\\System32";
      npcap = fs.existsSync(`${sys32}\\Npcap\\wpcap.dll`) || fs.existsSync(`${sys32}\\wpcap.dll`);
    }
    let admin: boolean | null = null;
    if (process.platform !== "win32") admin = typeof process.getuid === "function" ? process.getuid() === 0 : null;
    return { python: py ? py.join(" ") : null, pythonVersion, scapy, npcap, platform: process.platform, admin };
  }

  installScapy(): Promise<{ ok: boolean; output: string }> {
    const py = CaptureService.findPython(this.getSettings().pythonPath);
    if (!py) return Promise.resolve({ ok: false, output: "Python 3 was not found. Install it from python.org (tick 'Add to PATH')." });
    return new Promise((resolve) => {
      const p = spawn(py[0], [...py.slice(1), "-m", "pip", "install", "--user", "--upgrade", "--disable-pip-version-check", "--no-warn-script-location", "scapy==2.8.0"], { windowsHide: true });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (out += d));
      p.on("close", (code) => resolve({ ok: code === 0, output: out.slice(-4000) }));
      p.on("error", (e) => resolve({ ok: false, output: String(e) }));
    });
  }

  start() {
    if (this.child) return;
    const s = this.getSettings();
    const py = CaptureService.findPython(s.pythonPath);
    this.lastError = null;
    if (!py) { this.lastError = "Python 3 not found. See Account & Live Sync → Live Sync setup."; this.setState("error"); return; }
    const args = [...py.slice(1), this.scriptPath, "--ports", s.ports.join(",")];
    if (s.iface) args.push("--iface", s.iface);
    this.bytes = 0; this.lastSyncedBytes = 0;
    this.armAutoOff();
    this.setState("starting");
    const child = spawn(py[0], args, { windowsHide: true });
    this.child = child;
    const pid = child.pid ?? null;
    if (pid) this.emit("pid", { pid });
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => this.onLine(line));
    let errBuf = "";
    child.stderr.on("data", (d) => { errBuf = (errBuf + d).slice(-4000); });
    child.on("close", (code) => {
      if (pid) this.emit("pid", { pid: null, previous: pid });
      if (this.child === child) this.child = null;
      if (this.state !== "off") {
        if (code && !this.lastError) this.lastError = `Sniffer exited (${code}). ${errBuf.trim().split("\n").slice(-3).join(" ")}`;
        this.setState(this.lastError ? "error" : "off");
      }
    });
    child.on("error", (e) => { this.lastError = String(e); this.setState("error"); });
  }

  /** (Re)starts the inactivity timer: no decoder exchange for N minutes -> Live Sync off. */
  private armAutoOff() {
    if (this.autoOffTimer) clearTimeout(this.autoOffTimer);
    const min = this.getSettings().autoOffMinutes;
    if (!min || min <= 0) return;
    this.autoOffTimer = setTimeout(() => {
      if (this.state === "decoding") { this.armAutoOff(); return; }
      this.emit("autoOff", { minutes: min, requests: this.decoder.requests });
      this.stop();
    }, min * 60_000);
  }

  stop() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.autoOffTimer) clearTimeout(this.autoOffTimer);
    this.autoOffTimer = null;
    this.decoder.close(); // end the decoder connection normally
    this.setState("off");
    if (this.child) {
      try { this.child.stdin.write("QUIT\n"); } catch { /* ignore */ }
      const c = this.child;
      setTimeout(() => { try { c.kill(); } catch { /* ignore */ } }, 1500);
      this.child = null;
    }
  }

  private onLine(line: string) {
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
    switch (msg.type) {
      case "ready": this.setState("listening", { ifaces: msg.ifaces, filter: msg.filter }); break;
      case "activity":
        if (msg.bytes !== this.bytes) { this.bytes = msg.bytes; this.lastChange = Date.now(); this.scheduleAutoSync(); }
        this.emit("activity", { bytes: msg.bytes, packets: msg.packets, streams: msg.streams, capped: msg.capped });
        break;
      case "buffers": { const cb = this.pendingFlush; this.pendingFlush = null; cb?.(msg.data ?? []); break; }
      case "error": this.lastError = humanError(msg.code, msg.message); this.setState("error"); break;
      case "log": this.emit("log", msg.message); break;
    }
  }

  private scheduleAutoSync() {
    const s = this.getSettings();
    if (!s.autoSync) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.state !== "listening") return;
      const spaced = Date.now() - this.lastAuto >= (s.minAutoIntervalSec ?? 20) * 1000;
      if (this.bytes - this.lastSyncedBytes >= s.minBytes && Date.now() - this.lastChange >= s.idleMs - 50) {
        if (!spaced) { this.scheduleAutoSync(); return; }
        this.lastAuto = Date.now();
        this.sync("auto").catch(() => undefined);
      }
    }, s.idleMs);
  }

  /** Flush captured buffers, decode and emit a converted scan. */
  async sync(trigger: "auto" | "manual") {
    if (!this.child || this.state === "decoding") throw new Error(this.child ? "Already decoding" : "Live Sync is off");
    const s = this.getSettings();
    this.setState("decoding", { trigger });
    let sent = { buffers: 0, kb: 0 };
    try {
      const bufs = await new Promise<string[]>((resolve, reject) => {
        this.pendingFlush = resolve;
        this.child!.stdin.write("FLUSH\n");
        setTimeout(() => { if (this.pendingFlush) { this.pendingFlush = null; reject(new Error("Sniffer did not respond")); } }, 15000);
      });
      this.lastSyncedBytes = 0; this.bytes = 0;
      // Only new, non-trivial game buffers go to the decoder; nothing is sent if there's nothing to decode.
      const nonEmpty = this.decoder.select(bufs);
      sent = { buffers: nonEmpty.length, kb: Math.round(nonEmpty.reduce((a, b) => a + b.length / 2, 0) / 1024) };
      if (!nonEmpty.length) throw new Error(`No new game data to decode. ${RELOAD_HINT}`);
      const json = (await this.decoder.decode(s.decoderUrl, nonEmpty)) as DecoderResponse;
      this.armAutoOff();
      const opts: ScanConvertOptions = { minEnhance: s.minEnhance, minStars: s.minStars };
      const scan = convertDecoderResponse(json, opts);
      if (!scan.items.length && !scan.heroes.length) throw new Error(`The decoder found no gear or heroes in this traffic. ${RELOAD_HINT}`);
      this.emit("scan", { scan, trigger, ...sent, raw: json });
      this.lastError = null;
    } catch (e: any) {
      if (this.decoder.lastExchange && Date.now() - this.decoder.lastExchange < 5000) this.armAutoOff();
      this.lastError = e?.message ?? String(e);
      this.emit("syncError", { trigger, error: this.lastError, ...sent, at: new Date().toISOString() });
    } finally {
      if (this.child) this.setState("listening");
    }
  }
}

function humanError(code: string, message: string) {
  switch (code) {
    case "no_scapy": return "scapy is not installed for this Python. Use 'Install scapy' in Settings.";
    case "no_pcap": return process.platform === "win32"
      ? "Npcap is not installed (or WinPcap compatibility mode is off). Install Npcap from npcap.com, tick 'WinPcap API-compatible mode', then retry."
      : `libpcap is not available: ${message}`;
    case "permission": return "Packet capture needs elevated rights. On Windows, Npcap normally allows non-admin capture; otherwise run E7 Forge as administrator.";
    default: return message || code;
  }
}
