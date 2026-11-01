import React, { useEffect, useMemo, useState } from "react";
import { useForge } from "../state";
import { fmt, Section } from "../components";

export default function AccountPage() {
  const { api, account, capture, toast, init } = useForge();
  const [diag, setDiag] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [paste, setPaste] = useState("");
  const [snaps, setSnaps] = useState<any[]>([]);

  const check = async () => { setChecking(true); try { setDiag(await api.captureDiagnostics()); } finally { setChecking(false); } };
  useEffect(() => { check(); api.snapshots().then(setSnaps); }, [account?.importedAt]);

  const kpis = useMemo(() => {
    if (!account) return null;
    const done = account.items.filter((i) => i.enhance >= 15);
    const spd = account.items.map((i) => i.substats.find((s) => s.type === "Speed")?.value ?? 0);
    return {
      heroes: account.heroes.length, items: account.items.length, finished: done.length,
      avgGs: done.length ? done.reduce((a, i) => a + (i.gs ?? 0), 0) / done.length : 0,
      spd15: spd.filter((s) => s >= 15).length, spd18: spd.filter((s) => s >= 18).length,
      equipped: account.items.filter((i) => i.equippedById).length,
    };
  }, [account]);

  const isWin = init.platform === "win32";
  const ok = (v: any) => <span className={"pill " + (v ? "good" : "bad")}>{v ? "OK" : "Missing"}</span>;

  return (
    <div className="stack">
      <div>
        <h1>Account & Live Sync</h1>
        <p className="sub">Live sync sniffs Epic Seven traffic on this PC and imports your full gear and hero list directly. No export/import step.</p>
      </div>

      {kpis && (
        <div className="grid g4">
          <div className="card kpi"><span className="label">Heroes</span><span className="big">{kpis.heroes}</span></div>
          <div className="card kpi"><span className="label">Items (finished +15)</span><span className="big">{fmt(kpis.items)} <span className="muted" style={{ fontSize: 14 }}>({fmt(kpis.finished)})</span></span></div>
          <div className="card kpi"><span className="label">Avg gear score of +15 gear</span><span className="big">{fmt(kpis.avgGs, 1)}</span></div>
          <div className="card kpi"><span className="label">Speed subs 15+ / 18+</span><span className="big">{kpis.spd15} / {kpis.spd18}</span></div>
        </div>
      )}

      <div className="grid g2">
        <Section title="Live capture setup" right={<button className="small" onClick={check} disabled={checking}>{checking ? "Checking…" : "Re-check"}</button>}>
          {diag ? (
            <table>
              <tbody>
                <tr><td>Python 3</td><td>{ok(diag.python)}</td><td className="muted">{diag.python ? `${diag.python} (${diag.pythonVersion})` : <a onClick={() => api.openExternal("https://www.python.org/downloads/windows/")}>Get Python</a>}</td></tr>
                <tr><td>scapy</td><td>{ok(diag.scapy)}</td><td className="muted">{diag.scapy ?? <button className="small" disabled={!diag.python || installing} onClick={async () => { setInstalling(true); const r = await api.installScapy(); setInstalling(false); toast(r.ok ? "scapy installed" : `pip failed: ${r.output.slice(-300)}`, !r.ok); check(); }}>{installing ? "Installing…" : "Install scapy"}</button>}</td></tr>
                {isWin && <tr><td>Npcap</td><td>{ok(diag.npcap)}</td><td className="muted">{diag.npcap ? "Driver found" : <a onClick={() => api.openExternal("https://npcap.com/#download")}>Get Npcap</a>}</td></tr>}
                {!isWin && diag.platform !== "browser" && <tr><td>Root / capture rights</td><td>{ok(diag.admin)}</td><td className="muted">libpcap needs root or CAP_NET_RAW</td></tr>}
              </tbody>
            </table>
          ) : <span className="muted">Checking…</span>}
          <h3 style={{ marginTop: 14 }}>Steps</h3>
          <ol className="steps">
            <li>Install <b>Python 3</b> (tick “Add python.exe to PATH”).</li>
            <li>Install <b>Npcap</b> with “WinPcap API-compatible mode” ticked.</li>
            <li>Click <b>Install scapy</b> above (or run <span className="mono">py -m pip install scapy</span>).</li>
            <li>Flip <b>Live sync</b> on (top right), then start Epic Seven (emulator, Google Play Games or Steam).</li>
            <li>In game open the <b>Inventory</b> (gear) screen, then the <b>Heroes</b> list. Each screen syncs automatically ~4 s after it loads; <b>Sync now</b> forces it.</li>
          </ol>
          <p className="muted" style={{ fontSize: 12 }}>Capture is passive (read-only). Captured traffic is decoded by Fribbels' public decoder service, same as Fribbels' scanner. Ports and decoder URL are in Settings.</p>
        </Section>

        <Section title="Live sync status">
          <table>
            <tbody>
              <tr><td>State</td><td><span className={"dot " + capture.state} style={{ display: "inline-block", marginRight: 6 }} />{capture.state}</td></tr>
              <tr><td>Captured since last sync</td><td className="mono">{fmt((capture.bytes ?? 0) / 1024)} KB · {fmt(capture.packets ?? 0)} packets · {capture.streams ?? 0} streams</td></tr>
              <tr><td>Interfaces</td><td className="muted">{capture.ifaces?.join(", ") || "—"}</td></tr>
              <tr><td>Last sync</td><td>{capture.lastSync ? `${new Date(capture.lastSync.at).toLocaleTimeString()} (${capture.lastSync.trigger})` : "—"}</td></tr>
              {capture.lastSync && <tr><td>Result</td><td>{capture.lastSync.report.added} new · {capture.lastSync.report.updated} updated · {capture.lastSync.report.removed} removed items; {capture.lastSync.report.heroesAdded} new heroes</td></tr>}
              {capture.error && <tr><td>Error</td><td style={{ color: "var(--bad)", whiteSpace: "normal" }}>{capture.error}</td></tr>}
            </tbody>
          </table>
          <h3 style={{ marginTop: 16 }}>Fallback: import a file</h3>
          <div className="row">
            <button onClick={async () => { try { const r = await api.importFile(); if (r) toast(`Imported ${r.heroes} heroes, ${r.items} items`); } catch (e: any) { toast(e.message, true); } }}>Import Fribbels / RexQian save…</button>
            <button className="ghost" disabled={!account} onClick={async () => { const p = await api.exportFile(); if (p) toast(`Saved ${p}`); }}>Export (Fribbels format)</button>
          </div>
          <details style={{ marginTop: 10 }}>
            <summary className="muted">Paste JSON instead</summary>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder='{"heroes":[...],"items":[...]}' />
            <button className="small" disabled={!paste} onClick={async () => { try { const r = await api.importText(paste); toast(`Imported ${r.heroes} heroes, ${r.items} items`); setPaste(""); } catch (e: any) { toast(e.message, true); } }}>Import pasted JSON</button>
          </details>
        </Section>
      </div>

      <Section title="History (snapshots)">
        {snaps.length ? (
          <div className="scroll" style={{ maxHeight: "max(260px, calc(100vh - 720px))" }}>
            <table>
              <thead><tr><th>When</th><th>Source</th><th className="num">Heroes</th><th className="num">Items</th><th className="num">Avg +15 GS</th><th /></tr></thead>
              <tbody>{snaps.map((s) => (
                <tr key={s.id}><td>{s.at ? new Date(s.at).toLocaleString() : "—"}</td><td>{s.source}</td><td className="num">{s.heroes}</td><td className="num">{s.items}</td><td className="num">{fmt(s.avgGs, 1)}</td>
                  <td><button className="small ghost" onClick={async () => { await api.restoreSnapshot(s.id); toast("Snapshot restored"); }}>Restore</button></td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <span className="muted">Each sync or import saves a snapshot here (last 25).</span>}
      </Section>
    </div>
  );
}
