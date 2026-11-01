// Startup cleanup: stop any previous E7 Forge session and its resources
// (main process tree, live-capture sniffer) before this one starts.
//
// Sources, in order:
//  1. PID file written by the previous session (main pid + sniffer pids).
//  2. Packaged builds on Windows: any other "E7 Forge.exe" main process
//     (catches older versions that never wrote a PID file).
//  3. Any orphaned e7forge_sniffer.py Python process.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface PidFile { main: number; exe: string; sniffers: number[]; started: string }

export class SessionGuard {
  private file: string;
  private sniffers = new Set<number>();

  constructor(userDataDir: string, private exePath: string, private packaged: boolean) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.file = path.join(userDataDir, "e7forge.session.json");
  }

  /** Kill prior sessions; returns a short description of what was stopped. */
  killPrior(): string[] {
    const killed: string[] = [];
    const me = process.pid;
    let prev: PidFile | null = null;
    try { prev = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { /* none */ }

    if (prev && prev.main !== me && isAlive(prev.main) && looksLikeExe(prev.main, prev.exe)) {
      killTree(prev.main);
      killed.push(`previous session (pid ${prev.main})`);
    }
    for (const pid of prev?.sniffers ?? []) {
      if (pid !== me && isAlive(pid) && isSniffer(pid)) { killTree(pid); killed.push(`sniffer (pid ${pid})`); }
    }
    if (process.platform === "win32" && this.packaged) {
      for (const pid of otherMainProcesses(path.basename(this.exePath), me)) { killTree(pid); killed.push(`E7 Forge (pid ${pid})`); }
    }
    for (const pid of orphanSniffers()) { killTree(pid); killed.push(`orphaned sniffer (pid ${pid})`); }
    this.write();
    return [...new Set(killed)];
  }

  setSniffer(pid: number | null, previous?: number | null) {
    if (previous) this.sniffers.delete(previous);
    if (pid) this.sniffers.add(pid);
    this.write();
  }

  /** Clean exit: nothing left to clean up next time. */
  release() {
    try { fs.unlinkSync(this.file); } catch { /* ignore */ }
  }

  private write() {
    const data: PidFile = { main: process.pid, exe: this.exePath, sniffers: [...this.sniffers], started: new Date().toISOString() };
    try { fs.writeFileSync(this.file, JSON.stringify(data)); } catch { /* best effort */ }
  }
}

function isAlive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; }
}

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  return r.status === 0 ? r.stdout : "";
}

function commandLine(pid: number): string {
  if (process.platform === "win32") {
    return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`]).trim();
  }
  try { return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " "); } catch { return run("ps", ["-o", "command=", "-p", String(pid)]).trim(); }
}

/** Guards against PID reuse: only kill a process that is still our executable. */
function looksLikeExe(pid: number, exe: string) {
  const cl = commandLine(pid).toLowerCase();
  return !!cl && cl.includes(path.basename(exe).toLowerCase().replace(/\.exe$/, ""));
}

/** A Python interpreter actually running our sniffer script (not an editor or shell that mentions it). */
function isSniffer(pid: number) {
  const cl = commandLine(pid).trim();
  if (!cl.includes("e7forge_sniffer.py")) return false;
  const exe = (cl.startsWith('"') ? cl.slice(1, cl.indexOf('"', 1)) : cl.split(/\s+/)[0]).toLowerCase();
  return /(^|[\\/])(python[\d.]*w?|py)(\.exe)?$/.test(exe);
}

function killTree(pid: number) {
  if (process.platform === "win32") run("taskkill", ["/PID", String(pid), "/T", "/F"]);
  else { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
}

/** Other E7 Forge main processes (helpers carry --type=..., the main process doesn't). */
function otherMainProcesses(exeName: string, me: number): number[] {
  const ps = `Get-CimInstance Win32_Process -Filter "Name='${exeName.replace(/'/g, "''")}'" | Where-Object { $_.CommandLine -notmatch '--type=' -and $_.ProcessId -ne ${me} -and $_.ParentProcessId -ne ${me} } | ForEach-Object { $_.ProcessId }`;
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps]).split(/\s+/).map(Number).filter((n) => n > 0 && n !== me);
}

function orphanSniffers(): number[] {
  if (process.platform === "win32") {
    const ps = `Get-CimInstance Win32_Process -Filter "CommandLine like '%e7forge_sniffer.py%'" | Where-Object { $_.Name -match '^(pythonw?[0-9.]*|py)\.exe$' } | ForEach-Object { $_.ProcessId }`;
    return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps]).split(/\s+/).map(Number).filter((n) => n > 0);
  }
  return run("pgrep", ["-f", "e7forge_sniffer[.]py"]).split(/\s+/).map(Number).filter((n) => n > 0 && n !== process.pid && isSniffer(n));
}
