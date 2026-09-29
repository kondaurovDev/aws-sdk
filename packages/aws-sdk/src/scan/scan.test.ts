import * as path from "node:path"
import { rm } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { Effect } from "effect"

import { installAcmeSdk, makeTempDir, writeTree } from "../testing/fixtures.ts"
import { findPackageDir, ScanError, scanClient } from "./scan.ts"

describe("scanClient", () => {
  it("extracts the client model", async () => {
    const root = await makeTempDir()
    await installAcmeSdk(root)

    const model = await Effect.runPromise(scanClient("acme", root))

    expect(model).toEqual({
      client: "acme",
      packageName: "@aws-sdk/client-acme",
      clientClassName: "AcmeClient",
      configInterfaceName: "AcmeClientConfig",
      serviceExceptionName: "AcmeServiceException",
      exceptions: ["AccessDeniedException", "ThingNotFound"],
      commands: [
        { name: "GetSAMLConfig", method: "get_saml_config", errors: [] },
        // Deduplicated, sorted, restricted to modeled exceptions (no base one)
        { name: "GetThing", method: "get_thing", errors: ["AccessDeniedException", "ThingNotFound"] },
        { name: "ListThings", method: "list_things", errors: [] }
      ]
    })
  })

  it("finds a package hoisted to a parent node_modules", async () => {
    const workspace = await makeTempDir()
    await installAcmeSdk(workspace)
    const app = path.join(workspace, "packages", "app")
    await writeTree(app, { "package.json": "{}" })

    expect(findPackageDir(app, "@aws-sdk/client-acme")).toBe(
      path.join(workspace, "node_modules", "@aws-sdk", "client-acme")
    )
    const model = await Effect.runPromise(scanClient("acme", app))
    expect(model.commands).toHaveLength(3)
  })

  it("fails when the package is not installed", async () => {
    const root = await makeTempDir()

    const error = await Effect.runPromise(Effect.flip(scanClient("acme", root)))

    expect(error).toBeInstanceOf(ScanError)
    expect(error.client).toBe("acme")
    expect(error.message).toContain("@aws-sdk/client-acme is not installed")
  })

  it.each([
    ["dist-types/AcmeClient.d.ts", "client class not found"],
    ["dist-types/models/AcmeServiceException.d.ts", "service exception class not found"],
    ["dist-types/commands", "no commands found"]
  ])("fails without %s", async (file, message) => {
    const root = await makeTempDir()
    await installAcmeSdk(root)
    await rm(path.join(root, "node_modules/@aws-sdk/client-acme", file), { recursive: true })

    const error = await Effect.runPromise(Effect.flip(scanClient("acme", root)))

    expect(error.message).toBe(`@aws-sdk/client-acme: ${message}`)
  })
})
