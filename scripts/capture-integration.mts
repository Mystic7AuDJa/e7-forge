// Integration check (Linux, root): sniffer sidecar -> CaptureService -> mock decoder -> scan, then auto-off.
import http from "node:http";
import net from "node:net";
import { CaptureService } from "../electron/capture.ts";

const sockets = new Set<net.Socket>();
let closed = 0, requests = 0, lastBody: any = null;
const decoder = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    requests++; lastBody = JSON.parse(b);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: "SUCCESS", data: [{ id: 1, type: "ring", f: "set_speed", g: 5, level: 85, mainStatValue: 0.65, p: 7, op: [["att_rate", 0.13], ["speed", 4], ["speed", 3], ["cri", 0.05], ["max_hp", 180], ["speed", 4], ["cri", 0.04], ["att_rate", 0.05], ["speed", 2]] }], units: [[{ id: 7, name: "Krau", g: 6 }]] }));
  });
});
decoder.on("connection", (s) => { sockets.add(s); s.on("close", () => closed++); });
await new Promise<void>((r) => decoder.listen(18080, r));

const game = net.createServer((c) => { c.on("data", () => c.end(Buffer.alloc(20000, 7))); });
await new Promise<void>((r) => game.listen(3333, "127.0.0.1", r));

const settings = { pythonPath: "", ports: [3333], decoderUrl: "http://127.0.0.1:18080/getItems", autoSync: false, minBytes: 1, idleMs: 500, iface: "lo", minEnhance: 0, minStars: 5, autoOffMinutes: 0.05, minAutoIntervalSec: 0 };
const cap = new CaptureService(new URL("../capture/e7forge_sniffer.py", import.meta.url).pathname, () => settings);
const events: string[] = [];
cap.on("status", (s) => events.push("status:" + s.state));
cap.on("scan", (s) => events.push(`scan:${s.scan.items.length}items/${s.scan.heroes.length}heroes`));
cap.on("syncError", (e) => events.push("syncError:" + e.error));
cap.on("autoOff", () => events.push("autoOff"));
cap.start();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 30 && cap.state !== "listening"; i++) await wait(200);
const c = net.connect(3333, "127.0.0.1"); c.write("hi"); c.on("data", () => undefined); await wait(1500);
await cap.sync("manual");
const sentCount = lastBody?.data?.length;
// second sync with no new data must NOT contact the decoder
await cap.sync("manual");
const reqAfterSecond = requests;
await wait(4500); // auto-off after 3s of no decoder exchange
console.log(JSON.stringify({ events, requests, reqAfterSecond, sentCount, decoderSocketsOpened: sockets.size, decoderSocketsClosed: closed, state: cap.state }, null, 1));
game.close(); decoder.close(); process.exit(0);
