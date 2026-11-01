// Embeds build/icon.ico and version info into the packaged Windows exe.
// Pure JS (resedit), so it works on any OS without Wine/rcedit.
// Usage: node scripts/set-exe-icon.mjs "release/win-unpacked/E7 Forge.exe"
import fs from "node:fs";
import * as ResEdit from "resedit";

const exePath = process.argv[2] ?? "release/win-unpacked/E7 Forge.exe";
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync("build/icon.ico"));

// Replace every existing icon group (Electron ships id 1) with ours.
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const targets = groups.length ? groups : [{ id: 1, lang: 1033 }];
for (const g of targets) {
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, ico.icons.map((i) => i.data));
}

const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
if (vi) {
  const [maj, min, pat] = pkg.version.split(".").map(Number);
  vi.setFileVersion(maj, min, pat, 0);
  vi.setProductVersion(maj, min, pat, 0);
  for (const lang of vi.getAllLanguagesForStringValues()) {
    vi.setStringValues(lang, {
      ProductName: "E7 Forge", FileDescription: "E7 Forge", CompanyName: "E7 Forge",
      InternalName: "E7 Forge", OriginalFilename: "E7 Forge.exe", LegalCopyright: "Personal use",
    });
  }
  vi.outputToResourceEntries(res.entries);
}
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log(`Icon + version info embedded in ${exePath} (${groups.length} icon group(s) replaced)`);
