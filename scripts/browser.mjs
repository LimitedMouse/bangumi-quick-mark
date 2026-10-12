import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2] || "test";
if (!["test", "inject"].includes(mode)) throw Error("模式应为 test 或 inject");
const source = await readFile(
  path.join(root, "bangumi-quick-mark.user.js"),
  "utf8",
);
const version = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
).version;
const artifactDir = path.join(
  root,
  ".local",
  mode === "test" ? "test" : "browser",
);
await mkdir(artifactDir, { recursive: true });
let body;
if (mode === "inject") {
  body = `await page.waitForFunction(()=>{const h=document.getElementById('bqm-launch');return !h||(!h.shadowRoot.getElementById('jump')?.disabled&&!Number(h.shadowRoot.getElementById('queue')?.textContent.match(/(\\d+) 部待完成/)?.[1]));},null,{timeout:60000}); await page.evaluate(()=>{const h=document.getElementById('bqm-launch');if(h)h.dataset.version='updating';}); await page.evaluate(source); await page.waitForFunction(()=>document.getElementById('bqm-launch')?.dataset.version===${JSON.stringify(version)},null,{timeout:60000}); await page.locator('#bqm-launch #launch').click(); return ${JSON.stringify("已加载 " + version)};`;
} else {
  body = (
    await Promise.all(
      ["fixture", "workflow", "independent"].map((name) =>
        readFile(path.join(root, "tests", "browser", name + ".js"), "utf8"),
      ),
    )
  ).join("\n");
  body +=
    "\nreturn [...await runIndependent(page,source),...await runWorkflow(page,source,artifactDir)];";
}
const filename = path.join(artifactDir, mode + ".js");
await writeFile(
  filename,
  `async page => {const source=${JSON.stringify(source)};const artifactDir=${JSON.stringify(artifactDir)};${body}\n}`,
);
const session = mode === "test" ? "bqm-tests" : "bangumi";
function cli(...args) {
  const command = [
    "--yes",
    "--package",
    "@playwright/cli",
    "playwright-cli",
    "-s=" + session,
    ...args,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "cmd.exe" : "npx",
      process.platform === "win32"
        ? [
            "/d",
            "/s",
            "/c",
            "npx " +
              command
                .map((value) => '"' + value.replaceAll('"', "") + '"')
                .join(" "),
          ]
        : command,
      {
        cwd: process.env.BQM_CLI_CWD || artifactDir,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        windowsVerbatimArguments: process.platform === "win32",
      },
    );
    let output = "";
    child.stdout.on("data", (value) => (output += value));
    child.stderr.on("data", (value) => (output += value));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code || /### Error/.test(output)) reject(Error(output));
      else resolve(output);
    });
  });
}
try {
  if (mode === "test") await cli("open", "about:blank");
  const output = await cli("run-code", "--filename", filename);
  await writeFile(path.join(artifactDir, mode + ".log"), output);
  const summary = output.split("### Ran Playwright code")[0];
  if (mode === "test")
    console.log(
      `Browser checks passed: ${(summary.match(/PASS /g) || []).length} assertions. Log: ${path.join(artifactDir, mode + ".log")}`,
    );
  else console.log(summary);
} catch (error) {
  await writeFile(path.join(artifactDir, mode + ".log"), error.message);
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (mode === "test")
    await cli("close").catch((error) => console.error(error.message));
}
