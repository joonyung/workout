import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = resolve(root, "dist");
const required = [
  "index.html",
  "manifest.webmanifest",
  "sw.js",
  "src/app.ts",
  "src/core.ts",
  "src/types.ts",
  "src/styles.css",
  "src/icon.svg"
];

const missing = required.filter((file) => !existsSync(resolve(root, file)));
if (missing.length) throw new Error(`Missing required files: ${missing.join(", ")}`);

const appSource = readFileSync(resolve(root, "src/app.ts"), "utf8");
for (const token of ["loadBootstrap", "renderToday", "syncSession", "saveLocalState"]) {
  if (!appSource.includes(token)) throw new Error(`Expected app token not found: ${token}`);
}

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "assets"), { recursive: true });
await mkdir(resolve(dist, "server"), { recursive: true });

await Promise.all([
  cp(resolve(root, "manifest.webmanifest"), resolve(dist, "manifest.webmanifest")),
  cp(resolve(root, "sw.js"), resolve(dist, "sw.js")),
  cp(resolve(root, "src/styles.css"), resolve(dist, "assets/styles.css")),
  cp(resolve(root, "src/icon.svg"), resolve(dist, "assets/icon.svg"))
]);

const indexHtml = await readFile(resolve(root, "index.html"), "utf8");
await writeFile(resolve(dist, "index.html"), indexHtml, "utf8");

await build({
  entryPoints: [resolve(root, "src/app.ts")],
  outfile: resolve(dist, "assets/app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  sourcemap: true,
  legalComments: "none"
});

await build({
  entryPoints: {
    "dev-server": resolve(root, "scripts/dev-server.ts"),
    "validate-data": resolve(root, "scripts/validate-data.ts")
  },
  outdir: resolve(dist, "server"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node22"],
  sourcemap: true,
  packages: "external"
});

console.log("Build complete: typed client and production server in dist/");
