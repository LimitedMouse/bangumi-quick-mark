import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const files = ["bangumi-quick-mark.user.js"];
for (const folder of ["src", "scripts", "tests"]) {
  for (const file of await readdir(path.join(root, folder), {
    recursive: true,
  }))
    if (/\.m?js$/.test(file)) files.push(folder + "/" + file);
}
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
const result = spawnSync(process.execPath, ["scripts/build.mjs", "--check"], {
  cwd: root,
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status || 1);
console.log(
  `Checked ${files.length} JavaScript files and generated artifacts.`,
);
