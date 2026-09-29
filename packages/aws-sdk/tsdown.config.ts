import { defineConfig } from "tsdown"

export default defineConfig({
  entry: { cli: "src/cli/main.ts" },
  format: "esm",
  platform: "node",
  target: "node20",
  dts: false,
  clean: true,
  deps: {
    // `effect` is a peer dependency only because the *generated* code imports
    // it. The CLI bundles its own copy so it never runs against whatever Effect
    // version happens to be installed in the user's project.
    alwaysBundle: [/^effect(\/|$)/],
    // Fail the build if anything else ends up bundled by accident
    onlyBundle: [/^effect(\/|$)/]
  }
})
