import { contextBridge, ipcRenderer } from "electron";

const invoke = (ch: string) => (arg?: unknown) => ipcRenderer.invoke(ch, arg);

const api = {
  init: invoke("app:init"),
  setSettings: invoke("settings:set"),
  importFile: invoke("account:importFile"),
  importText: invoke("account:importText"),
  exportFile: invoke("account:exportFile"),
  updateHero: invoke("account:updateHero"),
  applyBuilds: invoke("account:applyBuilds"),
  updateItem: invoke("account:updateItem"),
  addHero: invoke("account:addHero"),
  snapshots: invoke("snapshots:list"),
  restoreSnapshot: invoke("snapshots:restore"),
  captureDiagnostics: invoke("capture:diagnostics"),
  installScapy: invoke("capture:installScapy"),
  captureStart: invoke("capture:start"),
  captureStop: invoke("capture:stop"),
  captureSync: invoke("capture:sync"),
  optimize: invoke("job:optimize"),
  optimizeAccount: invoke("job:account"),
  recommend: invoke("job:recommend"),
  teams: invoke("job:teams"),
  planTeam: invoke("job:planTeam"),
  upgradeQueue: invoke("job:upgradeQueue"),
  counters: invoke("job:counters"),
  community: invoke("community:get"),
  meta: invoke("meta:get"),
  updateData: invoke("data:update"),
  refreshTags: invoke("data:refreshTags"),
  openExternal: invoke("shell:open"),
  on: (channel: string, cb: (payload: any) => void) => {
    const allowed = ["account:changed", "capture:status", "capture:activity", "capture:synced", "capture:syncError", "capture:autoOff", "job:progress"];
    if (!allowed.includes(channel)) throw new Error("bad channel");
    const fn = (_e: unknown, p: any) => cb(p);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
};

contextBridge.exposeInMainWorld("forge", api);
export type ForgeApi = typeof api;
