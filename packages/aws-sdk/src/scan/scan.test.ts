import * as path from "node:path"
import { rm } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { Effect } from "effect"

import { installAcmeDocumentSdk, installAcmeSdk, makeTempDir, writeTree } from "../testing/fixtures.ts"
import type { SdkModel } from "./model.ts"
import { findPackageDir, ScanError, scanClient, scanDocumentClient } from "./scan.ts"

const expectedAcme: SdkModel = {
  client: "acme",
  packageName: "@aws-sdk/client-acme",
  clientClassName: "AcmeClient",
  configInterfaceName: "AcmeClientConfig",
  serviceExceptionName: "AcmeServiceException",
  exceptions: ["AbandonedServiceException", "AccessDeniedException", "ThingNotFound"],
  commands: [
    { name: "GetSAMLConfig", method: "get_saml_config", errors: [], docs: undefined },
    // Deduplicated, sorted, restricted to modeled exceptions (no base one)
    { name: "GetThing", method: "get_thing", errors: ["AccessDeniedException", "ThingNotFound"], docs: "Gets a thing." },
    {
      name: "ListThings",
      method: "list_things",
      errors: [],
      docs: "Lists the things owned by the caller. Set `MaxResults` to page, see [Paging](https://example.com/paging)."
    }
  ],
  paginators: [{ method: "list_things", functionName: "paginateListThings" }],
  waiters: [{ method: "thing_exists", functionName: "waitUntilThingExists" }],
  presigner: undefined,
  base: undefined
}

describe("scanClient", () => {
  it("extracts the client model", async () => {
    const root = await makeTempDir()
    await installAcmeSdk(root)

    const model = await Effect.runPromise(scanClient("acme", root))

    expect(model).toEqual(expectedAcme)
  })

  it("records the presigner package when given", async () => {
    const root = await makeTempDir()
    await installAcmeSdk(root)

    const model = await Effect.runPromise(scanClient("acme", root, { presigner: "@aws-sdk/acme-request-presigner" }))

    expect(model.presigner).toBe("@aws-sdk/acme-request-presigner")
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

describe("scanDocumentClient", () => {
  const spec = { client: "acme-document", packageName: "@aws-sdk/lib-acme" }

  it("maps commands to the base commands they delegate to", async () => {
    const root = await makeTempDir()
    await installAcmeSdk(root)
    await installAcmeDocumentSdk(root)

    const model = await Effect.runPromise(scanDocumentClient(spec, expectedAcme, root))

    expect(model).toEqual({
      client: "acme-document",
      packageName: "@aws-sdk/lib-acme",
      clientClassName: "AcmeDocumentClient",
      configInterfaceName: "TranslateConfig",
      serviceExceptionName: "AcmeServiceException",
      exceptions: expectedAcme.exceptions,
      commands: [
        { name: "Get", method: "get", errors: ["AccessDeniedException", "ThingNotFound"], docs: "Gets a thing." },
        { name: "List", method: "list", errors: [], docs: expectedAcme.commands[2]!.docs }
      ],
      paginators: [{ method: "list", functionName: "paginateList" }],
      waiters: [],
      presigner: undefined,
      base: { client: "acme", packageName: "@aws-sdk/client-acme", clientClassName: "AcmeClient" }
    } satisfies SdkModel)
  })

  it("fails when the library is not installed", async () => {
    const root = await makeTempDir()
    await installAcmeSdk(root)

    const error = await Effect.runPromise(Effect.flip(scanDocumentClient(spec, expectedAcme, root)))

    expect(error.message).toContain("@aws-sdk/lib-acme is not installed")
  })
})
