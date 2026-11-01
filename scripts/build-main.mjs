import { build } from "esbuild";
import fs from "node:fs";
fs.mkdirSync("dist-electron", { recursive: true });
const common = { bundle: true, platform: "node", target: "node20", format: "cjs", external: ["electron"], sourcemap: false, logLevel: "warning" };
await build({ ...common, entryPoints: { main: "electron/main.ts", preload: "electron/preload.ts", worker: "electron/worker.ts" }, outdir: "dist-electron" });
fs.copyFileSync("node_modules/sql.js/dist/sql-wasm.wasm", "dist-electron/sql-wasm.wasm");
fs.copyFileSync("build/icon.ico", "dist-electron/icon.ico");
fs.copyFileSync("build/icon.png", "dist-electron/icon.png");
console.log("main process built");
