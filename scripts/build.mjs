import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const required = [
  "index.html",
  "manifest.webmanifest",
  "sw.js",
  "src/app.js",
  "src/core.js",
  "src/styles.css",
  "src/icon.svg"
];

const missing = required.filter((file) => !existsSync(resolve(root, file)));
if (missing.length) {
  console.error(`Missing required files: ${missing.join(", ")}`);
  process.exit(1);
}

const appSource = readFileSync(resolve(root, "src/app.js"), "utf8");
for (const token of ["loadBootstrap", "renderToday", "syncSession", "saveLocalState"]) {
  if (!appSource.includes(token)) {
    console.error(`Expected app token not found: ${token}`);
    process.exit(1);
  }
}

const dist = resolve(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const path of ["index.html", "manifest.webmanifest", "sw.js", "src"]) {
  await cp(resolve(root, path), resolve(dist, path), { recursive: true });
}

console.log("Build complete: dist/");
