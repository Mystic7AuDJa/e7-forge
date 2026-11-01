import React, { useState } from "react";
import { useForge } from "../state";
import { Busy, Num, Section, Toggle } from "../components";
import { DEFAULT_CAPTURE_PORTS, DEFAULT_DECODER_URL } from "../../engine/scan";

export default function SettingsPage() {
  const { settings, setSettings, api, toast, init, reload } = useForge();
  const c = settings.capture;
  const [busy, setBusy] = useState("");
  const setC = (p: Partial<typeof c>) => setSettings({ capture: { ...c, ...p } });
  const untagged = Object.keys(init.gameData.herodata).filter((k) => !(init.gameData.tags[k]?.length));

  return (
    <div className="stack">
      <h1>Settings</h1>
      <div className="grid g2">
        <Section title="Live capture">
          <div className="grid g2">
            <label className="field">Python command (blank = auto: py -3 / python)<input value={c.pythonPath} placeholder="auto" onChange={(e) => setC({ pythonPath: e.target.value })} /></label>
            <label className="field">Capture ports (comma separated)<input value={c.ports.join(",")} onChange={(e) => setC({ ports: e.target.value.split(",").map((x) => parseInt(x.trim(), 10)).filter((x) => x > 0 && x < 65536) })} /></label>
            <label className="field">Interface (blank = all)<input value={c.iface} placeholder="all working interfaces" onChange={(e) => setC({ iface: e.target.value })} /></label>
            <label className="field">Ignore gear below +<Num value={c.minEnhance} onChange={(v) => setC({ minEnhance: v ?? 0 })} /></label>
            <label className="field">Import heroes with ≥ stars<Num value={c.minStars} onChange={(v) => setC({ minStars: v ?? 5 })} /></label>
            <label className="field">Auto-sync after quiet period (ms)<Num value={c.idleMs} step={500} onChange={(v) => setC({ idleMs: v ?? 4000 })} /></label>
            <label className="field">…and at least this much new traffic (KB)<Num value={Math.round(c.minBytes / 1024)} onChange={(v) => setC({ minBytes: (v ?? 100) * 1024 })} /></label>
            <label className="field">Turn Live sync off after N idle minutes (0 = never)<Num value={c.autoOffMinutes} onChange={(v) => setC({ autoOffMinutes: v ?? 10 })} /></label>
            <label className="field">Min seconds between auto decodes<Num value={c.minAutoIntervalSec} onChange={(v) => setC({ minAutoIntervalSec: v ?? 20 })} /></label>
          </div>
          <div className="col" style={{ marginTop: 10 }}>
            <Toggle on={c.autoSync} onChange={(v) => setC({ autoSync: v })} label="Auto-sync when a burst of game traffic settles" />
            <label className="field">Decoder URL<input value={c.decoderUrl} onChange={(e) => setC({ decoderUrl: e.target.value })} /></label>
            <div className="row"><button className="small ghost" onClick={() => setC({ decoderUrl: DEFAULT_DECODER_URL, ports: DEFAULT_CAPTURE_PORTS })}>Reset ports & decoder to defaults</button></div>
            <p className="muted" style={{ fontSize: 12 }}>Decoder etiquette: only new captured game buffers are sent (already-decoded and tiny keep-alive buffers are skipped), over one connection that is closed when Live sync turns off. With no decoder exchange for the idle period, Live sync switches itself off.</p>
            <p className="muted" style={{ fontSize: 12 }}>Default ports 3333/5222 are what Fribbels and its forks use. If the Steam client syncs nothing, watch it in Wireshark while opening the inventory and add its port here. Changes apply the next time you turn Live sync on.</p>
          </div>
        </Section>
        <div className="stack">
          <Section title="Combat assumptions">
            <div className="grid g2">
              <label className="field">Enemy speed band (low)<Num value={settings.enemySpeed[0]} onChange={(v) => setSettings({ enemySpeed: [v ?? 220, settings.enemySpeed[1]] })} /></label>
              <label className="field">Enemy speed band (high)<Num value={settings.enemySpeed[1]} onChange={(v) => setSettings({ enemySpeed: [settings.enemySpeed[0], v ?? 290] })} /></label>
              <label className="field">Speed RNG (% starting CR)<Num value={Math.round(settings.speedRng * 100)} onChange={(v) => setSettings({ speedRng: (v ?? 5) / 100 })} /></label>
            </div>
          </Section>
          <Section title="Game data" right={busy ? <Busy label={busy} /> : null}>
            <p>Source: <b>{init.gameData.source}</b> · {init.gameData.heroCount} heroes · {untagged.length} without role tags</p>
            <div className="row">
              <button disabled={!!busy} onClick={async () => {
                setBusy("Updating hero data…");
                try { const r = await api.updateData(); toast(`Hero data: ${r.source}, ${r.heroes} heroes (${r.added >= 0 ? "+" : ""}${r.added})`); await reload(); }
                catch (e: any) { toast(e.message, true); } finally { setBusy(""); }
              }}>Update hero data</button>
              <button disabled={!!busy || !untagged.length} onClick={async () => {
                setBusy(`Tagging ${Math.min(40, untagged.length)} heroes from epic7db…`);
                try { const r = await api.refreshTags(untagged); toast(`Tagged ${Object.keys(r).length} heroes`); await reload(); }
                catch (e: any) { toast(e.message, true); } finally { setBusy(""); }
              }}>Fetch missing role tags</button>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>Hero data comes from the latest RexQian fork release (falls back to Fribbels' S3). Role tags (strip, cleanse, CR push…) come from EXCOFF's effect data plus epic7db skill pages.</p>
          </Section>
          <Section title="About">
            <p className="muted" style={{ marginTop: 0 }}>E7 Forge {init.version} · personal use. Stat math follows Fribbels' StatCalculator. Credits: Fribbels Epic 7 Optimizer and the RexQian/Dodaca forks (data, scanner protocol, decoder, hero library), EXCOFF E7 Builder (effects data, MIT), epic7db.com (skill text).</p>
          </Section>
        </div>
      </div>
    </div>
  );
}
