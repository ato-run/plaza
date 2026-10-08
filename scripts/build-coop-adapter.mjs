import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Versioned app-owned artifact for the API's adapter registry. The source
// and its tests live in Plaza; never hand-edit the generated API copy.
const out = resolve(process.argv[2] ?? "dist-adapter");
await mkdir(out, { recursive: true });
await mkdir(".tmp/adapter-types", { recursive: true });
const result = await build({
  entryPoints: ["src/playground/coop/adapter.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: resolve(out, "plaza.generated.js"),
  metafile: true,
  banner: {
    js: "// Generated from ato-run/plaza by scripts/build-coop-adapter.mjs. Apache-2.0.",
  },
});
execFileSync(
  process.execPath,
  [
    "node_modules/typescript/bin/tsc",
    "--declaration",
    "--emitDeclarationOnly",
    "--skipLibCheck",
    "--target",
    "es2022",
    "--moduleResolution",
    "bundler",
    "--module",
    "esnext",
    "--outDir",
    ".tmp/adapter-types",
    "src/playground/coop/adapter.ts",
  ],
  { stdio: "inherit" },
);
await copyFile(
  ".tmp/adapter-types/coop/adapter.d.ts",
  resolve(out, "plaza.generated.d.ts"),
);
// The guide module (rule-based conversation + model knowledge), shared with
// the API's NPC conversation service.
const guideResult = await build({
  entryPoints: ["src/playground/guide/index.ts"],
  metafile: true,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: resolve(out, "plaza-guide.generated.js"),
  banner: {
    js: "// Generated from ato-run/plaza by scripts/build-coop-adapter.mjs. Apache-2.0.",
  },
});
execFileSync(
  process.execPath,
  [
    "node_modules/typescript/bin/tsc",
    "--declaration",
    "--emitDeclarationOnly",
    "--skipLibCheck",
    "--target",
    "es2022",
    "--moduleResolution",
    "bundler",
    "--module",
    "esnext",
    "--outDir",
    ".tmp/guide-types",
    "src/playground/guide/index.ts",
  ],
  { stdio: "inherit" },
);
// One self-contained declaration file for the API.
const guideTypes = [];
for (const name of ["nagi", "residents", "knowledge"]) {
  guideTypes.push(
    (await readFile(`.tmp/guide-types/${name}.d.ts`, "utf8"))
      .replace(/^import .*$/gm, "")
      .replace(/^export \* from .*$/gm, ""),
  );
}
await writeFile(resolve(out, "plaza-guide.generated.d.ts"), guideTypes.join("\n"));

const sources = {};
for (const path of [
  ...new Set([...Object.keys(result.metafile.inputs), ...Object.keys(guideResult.metafile.inputs)]),
].sort()) {
  sources[path] = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
await writeFile(
  resolve(out, "plaza.provenance.json"),
  JSON.stringify(
    {
      repository: "https://github.com/ato-run/plaza",
      adapter: "plaza.coop@1",
      sources,
      artifact_sha256: createHash("sha256")
        .update(await readFile(resolve(out, "plaza.generated.js")))
        .digest("hex"),
      guide: "plaza.guide@1",
      guide_artifact_sha256: createHash("sha256")
        .update(await readFile(resolve(out, "plaza-guide.generated.js")))
        .digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
