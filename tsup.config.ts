import { defineConfig } from "tsup";

export default defineConfig([
  // Library entry
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2020",
    treeshake: true,
    splitting: false,
  },
  // CLI binary
  {
    entry: { bin: "src/bin.ts" },
    format: ["esm"],
    sourcemap: true,
    clean: false,
    target: "node18",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
