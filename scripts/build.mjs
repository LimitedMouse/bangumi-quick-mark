import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const metadata = `// ==UserScript==
// @name         Bangumi 快速补标
// @namespace    local.bangumi.quickmark
// @version      ${pkg.version}
// @description  支持榜单和他人时间胶囊顺序补标、数字键评分、异步保存及进度恢复。
// @author       © 复旦沸点技术组-风吟雨
// @license      MIT
// @homepageURL  https://github.com/LimitedMouse/bangumi-quick-mark
// @supportURL   https://github.com/LimitedMouse/bangumi-quick-mark/issues
// @updateURL    https://raw.githubusercontent.com/LimitedMouse/bangumi-quick-mark/main/bangumi-quick-mark.user.js
// @downloadURL  https://raw.githubusercontent.com/LimitedMouse/bangumi-quick-mark/main/bangumi-quick-mark.user.js
// @match        https://bgm.tv/*
// @match        https://bangumi.tv/*
// @match        https://chii.in/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @run-at       document-end
// @noframes
// ==/UserScript==
`;
const modules = ["config", "storage", "editor", "site", "queue", "ui", "app"];
const normalizeLines = (text) => text.replaceAll("\r\n", "\n");
const license = normalizeLines(await readFile(path.join(root, "LICENSE"), "utf8"));
const source =
  metadata +
  "/*\n" +
  license +
  '*/\n(() => {\n"use strict";\nconst VERSION = ' +
  JSON.stringify(pkg.version) +
  ";\n" +
  (
    await Promise.all(
      modules.map(
        async (m) =>
          "\n// Module: " +
          m +
          "\n" +
          normalizeLines(await readFile(path.join(root, "src", m + ".js"), "utf8")),
      ),
    )
  ).join("\n") +
  "\n})();\n";
const scriptFile = path.join(root, "bangumi-quick-mark.user.js");
const installFile = path.join(root, "install.html");
const install = await readFile(installFile, "utf8");
const updatedInstall = install.replace(
  /(<span data-version>)[^<]*(<\/span>)/,
  `$1${pkg.version}$2`,
);
if (
  updatedInstall === install &&
  !install.includes(`<span data-version>${pkg.version}</span>`)
)
  throw Error("安装页缺少版本标记");
if (process.argv.includes("--check")) {
  if (
    normalizeLines(await readFile(scriptFile, "utf8")) !== source ||
    install !== updatedInstall
  )
    throw Error("构建产物或安装页版本已过期，请运行 npm run build");
} else {
  await writeFile(scriptFile, source);
  await writeFile(installFile, updatedInstall);
}
if (process.argv.includes("--release")) {
  const dest = path.join(
    root,
    ".local",
    "release",
    "bangumi-quick-mark-" + pkg.version,
  );
  const distribution = [
    "bangumi-quick-mark.user.js",
    "README.md",
    "CHANGELOG.md",
    "PRIVACY.md",
    "LICENSE",
    "install.html",
    "docs",
  ];
  const sources = [
    ...distribution,
    "package.json",
    ".gitignore",
    "RELEASING.md",
    "src",
    "scripts",
    "tests",
    ".github",
  ];
  async function copyFiles(files, target) {
    await mkdir(target, { recursive: true });
    for (const file of files)
      await cp(path.join(root, file), path.join(target, file), {
        recursive: true,
      });
  }
  await copyFiles(distribution, dest);
  // Publishable sources use the same metadata and tests, never local working copies.
  await copyFiles(sources, path.join(dest, "source"));
  console.log("Release: " + dest);
}
console.log(
  "Built v" + pkg.version + " (" + Buffer.byteLength(source) + " bytes)",
);
