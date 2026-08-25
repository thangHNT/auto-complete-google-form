import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const manifestPath = path.join(rootDir, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (manifest.manifest_version !== 3) {
  throw new Error("manifest.json phải sử dụng Manifest V3.");
}

const requiredFiles = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  ...manifest.content_scripts.flatMap((entry) => entry.js),
  "src/workspace/workspace.html",
  "src/workspace/workspace.js"
];

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Thiếu tệp bắt buộc: ${relativePath}`);
  }
}

const classicScripts = [
  "src/shared/core.js",
  "src/background.js",
  "src/content.js",
  "src/popup/popup.js",
  "src/workspace/workspace.js"
];

for (const relativePath of classicScripts) {
  const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath });
  if (/\beval\s*\(/.test(source)) {
    throw new Error(`Không cho phép eval trong ${relativePath}`);
  }
}

console.log(`Manifest V${manifest.manifest_version} hợp lệ; đã kiểm tra ${classicScripts.length} tệp JavaScript.`);
