// Minimal, polite client for the Fribbels decoder.
// - One dedicated keep-alive connection, reused while syncing.
// - Only captured game buffers are ever sent; nothing else uses this client.
// - Buffers already decoded this session are never resent; tiny buffers
//   (TCP keep-alives / control chatter) are dropped.
// - close() ends the connection normally (socket FIN via agent.destroy()).
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";

export const MIN_BUFFER_HEX = 128; // 64 bytes

export class DecoderClient {
  private agent: http.Agent | https.Agent | null = null;
  private sent = new Set<string>();
  lastExchange = 0;
  requests = 0;

  /** Filters out buffers that are too small or were already decoded. Returns what would be sent. */
  select(buffers: string[]): string[] {
    const out: string[] = [];
    for (const b of buffers) {
      if (!b || b.length < MIN_BUFFER_HEX) continue;
      const h = crypto.createHash("sha1").update(b).digest("hex");
      if (this.sent.has(h)) continue;
      out.push(b);
    }
    return out;
  }

  async decode(url: string, buffers: string[]): Promise<any> {
    const u = new URL(url);
    const mod = u.protocol === "http:" ? http : https;
    if (!this.agent) this.agent = new mod.Agent({ keepAlive: true, maxSockets: 1 });
    const body = JSON.stringify({ data: buffers });
    const res = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = mod.request(u, {
        method: "POST", agent: this.agent!, timeout: 60_000,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "User-Agent": "e7-forge/0.1 (personal use)" },
      }, (r) => {
        let text = "";
        r.setEncoding("utf8");
        r.on("data", (d) => (text += d));
        r.on("end", () => resolve({ status: r.statusCode ?? 0, text }));
      });
      req.on("timeout", () => req.destroy(new Error("Decoder timed out")));
      req.on("error", reject);
      req.end(body);
    });
    this.lastExchange = Date.now();
    this.requests++;
    if (res.status < 200 || res.status >= 300) throw new Error(`Decoder HTTP ${res.status}`);
    for (const b of buffers) this.sent.add(crypto.createHash("sha1").update(b).digest("hex"));
    return JSON.parse(res.text);
  }

  /** Close the connection normally and forget session state. */
  close() {
    this.agent?.destroy();
    this.agent = null;
    this.sent.clear();
  }

  get open() { return !!this.agent; }
}
